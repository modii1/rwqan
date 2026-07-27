import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";

import publicRouter from "./public";
import ownerRouter from "./owner";
import {
  notificationService,
  paymentService,
  propertyService,
  subscriptionService,
} from "../services";
import { firebaseService } from "../firebaseService";
import { PaymobIntentionError, paymobService } from "../integrations/paymob";

test("public onboarding establishes an owner-bound payment session", async () => {
  const originals = {
    propertyGet: propertyService.getByNumber,
    propertyCreate: propertyService.create,
    notifyNewProperty: notificationService.newProperty,
    getPackage: firebaseService.getPurchasablePackageById,
    getFirebaseProperty: firebaseService.getPropertyByNumber,
    getSubscription: firebaseService.getSubscriptionByPropertyNumber,
    getOwnerSubscription: subscriptionService.getByProperty,
    getPaymentsByProperty: paymentService.getByProperty,
    paymentCreate: paymentService.create,
    paymentUpdate: paymentService.update,
    createIntention: paymobService.createIntention,
    releaseReservation: firebaseService.releasePaymentActionReservation,
  };
  const properties = new Map<string, any>();
  const payments = new Map<string, any>();
  let paymentCreateCount = 0;
  let failRegistration = false;
  let intentionMode: "success" | "unknown" | "rejected" = "success";
  const ownerSubscriptionLookups: string[] = [];
  const ownerPaymentLookups: string[] = [];
  const releasedReservations: Array<{ id: string; updates: any }> = [];

  (propertyService as any).getByNumber = async (propertyNumber: string) =>
    properties.get(propertyNumber) || null;
  (propertyService as any).create = async (data: any) => {
    if (failRegistration) throw new Error("simulated create failure");
    properties.set(data.propertyNumber, data);
    return data;
  };
  (notificationService as any).newProperty = async () => undefined;
  (firebaseService as any).getPurchasablePackageById = async (packageId: string) => ({
    id: "PKG-1",
    name: "Package",
    price: 100,
    duration: 30,
    type: "premium",
    maxProperties: packageId === "PKG-2" ? 2 : 1,
  });
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) =>
    properties.get(propertyNumber) || null;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (subscriptionService as any).getByProperty = async (propertyNumber: string) => {
    ownerSubscriptionLookups.push(propertyNumber);
    return null;
  };
  (paymentService as any).getByProperty = async (propertyNumber: string) => {
    ownerPaymentLookups.push(propertyNumber);
    return Array.from(payments.values()).filter(
      (payment) => payment.propertyNumber === propertyNumber,
    );
  };
  (paymentService as any).create = async (data: any) => {
    paymentCreateCount += 1;
    const payment = { ...data, id: `PAY-${paymentCreateCount}` };
    payments.set(payment.id, payment);
    return payment;
  };
  (paymentService as any).update = async (id: string, updates: any) => {
    const payment = { ...payments.get(id), ...updates };
    payments.set(id, payment);
    return payment;
  };
  (paymobService as any).createIntention = async () => {
    if (intentionMode !== "success") {
      throw new PaymobIntentionError("provider result", intentionMode);
    }
    return {
      intentionId: "INT-1",
      clientSecret: "secret",
      checkoutUrl: "https://checkout.example/INT-1",
    };
  };
  (firebaseService as any).releasePaymentActionReservation = async (
    id: string,
    updates: any,
  ) => {
    releasedReservations.push({ id, updates });
    return true;
  };

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-payment-auth-test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    const failureMode = req.get("x-test-registration-session-failure");
    if (failureMode === "regenerate") {
      req.session.regenerate = (callback) => {
        callback(new Error("simulated session regeneration failure"));
        return req.session;
      };
    } else if (failureMode === "save") {
      const regenerate = req.session.regenerate.bind(req.session);
      req.session.regenerate = (callback) => {
        regenerate((error) => {
          if (!error) {
            const save = req.session.save.bind(req.session);
            let failedOnce = false;
            req.session.save = (saveCallback) => {
              if (!failedOnce) {
                failedOnce = true;
                saveCallback?.(new Error("simulated session save failure"));
                return req.session;
              }
              return save(saveCallback);
            };
          }
          callback(error);
        });
        return req.session;
      };
    }
    next();
  });
  app.get("/test/session", (req, res) => {
    res.json({ propertyNumber: req.session.propertyNumber || null });
  });
  app.use(publicRouter);
  app.use(ownerRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const registration = await fetch(`${baseUrl}/api/properties/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyNumber: "PROP-OWNER",
        name: "Owner property",
        whatsappNumber: "0500000000",
        location: "https://maps.example/property",
        city: "Riyadh",
        direction: "north",
        type: "Chalet",
        facilities: ["pool"],
        pin: "1234",
        prices: {
          weekday: "100",
          weekend: "120",
          overnight: "150",
          holidays: "180",
        },
      }),
    });
    assert.equal(registration.status, 200);
    const cookie = registration.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const sessionState = await fetch(`${baseUrl}/test/session`, {
      headers: { cookie },
    });
    assert.deepEqual(await sessionState.json(), { propertyNumber: "PROP-OWNER" });

    const anonymous = await fetch(`${baseUrl}/api/owner/payment/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyNumber: "PROP-OWNER", packageId: "PKG-1", action: "new" }),
    });
    assert.equal(anonymous.status, 401);
    assert.equal(paymentCreateCount, 0);

    const anonymousBank = await fetch(`${baseUrl}/api/owner/payment/bank-transfer`, {
      method: "POST",
    });
    assert.equal(anonymousBank.status, 401);
    assert.equal(paymentCreateCount, 0);

    const mismatch = await fetch(`${baseUrl}/api/owner/payment/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ propertyNumber: "PROP-VICTIM", packageId: "PKG-1", action: "new" }),
    });
    assert.equal(mismatch.status, 403);
    assert.equal((await mismatch.json()).code, "PROPERTY_SESSION_MISMATCH");
    assert.equal(paymentCreateCount, 0);

    properties.set("PROP-VICTIM", {
      ...properties.get("PROP-OWNER"),
      propertyNumber: "PROP-VICTIM",
      pin: "9999",
    });
    const forgedLinkedProperty = await fetch(`${baseUrl}/api/owner/payment/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        propertyNumber: "PROP-OWNER",
        packageId: "PKG-2",
        action: "new",
        additionalProperties: ["PROP-VICTIM"],
      }),
    });
    assert.equal(forgedLinkedProperty.status, 403);
    assert.equal(
      (await forgedLinkedProperty.json()).code,
      "LINKED_PROPERTY_FORBIDDEN",
    );
    assert.equal(paymentCreateCount, 0);

    const ownerPayment = await fetch(`${baseUrl}/api/owner/payment/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ propertyNumber: "PROP-OWNER", packageId: "PKG-1", action: "new" }),
    });
    assert.equal(ownerPayment.status, 200);
    assert.equal((await ownerPayment.json()).redirectUrl, "https://checkout.example/INT-1");
    assert.equal(paymentCreateCount, 1);

    payments.set("PAY-VICTIM", {
      id: "PAY-VICTIM",
      propertyNumber: "PROP-VICTIM",
      packageId: "PKG-1",
      amount: 100,
      discountAmount: 0,
      finalAmount: 100,
      status: "pending",
      merchantAttemptKey: "VICTIM-ATTEMPT",
      paymentCheckoutUrl: "https://checkout.example/victim-secret",
      paymentReference: "VICTIM-REFERENCE",
      transactionId: "VICTIM-TRANSACTION",
    });
    const forgedOwnerCookie = `${cookie}; ownerPropertyNumber=PROP-VICTIM`;
    const ownerHistoryResponse = await fetch(`${baseUrl}/api/owner/payments`, {
      headers: { cookie: forgedOwnerCookie },
    });
    assert.equal(ownerHistoryResponse.status, 200);
    assert.equal(ownerPaymentLookups.at(-1), "PROP-OWNER");
    const ownerHistory = await ownerHistoryResponse.json() as any[];
    assert.deepEqual(ownerHistory.map((payment) => payment.id), ["PAY-1"]);
    for (const privateField of [
      "merchantAttemptKey",
      "paymentCheckoutUrl",
      "paymentReference",
      "transactionId",
      "intentionState",
      "fulfillmentActionLockKeys",
      "retryReservationToken",
    ]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(ownerHistory[0], privateField),
        false,
        `${privateField} must remain server-only`,
      );
    }

    const ownerSubscriptionResponse = await fetch(
      `${baseUrl}/api/owner/current-subscription`,
      { headers: { cookie: forgedOwnerCookie } },
    );
    assert.equal(ownerSubscriptionResponse.status, 200);
    assert.equal(ownerSubscriptionLookups.at(-1), "PROP-OWNER");
    assert.equal(
      (await ownerSubscriptionResponse.json()).propertyNumber,
      "PROP-OWNER",
    );

    intentionMode = "unknown";
    const ambiguousProvider = await fetch(`${baseUrl}/api/owner/payment/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ propertyNumber: "PROP-OWNER", packageId: "PKG-1", action: "new" }),
    });
    assert.equal(ambiguousProvider.status, 500);
    assert.equal(payments.get("PAY-2")?.intentionState, "unknown");
    assert.equal(releasedReservations.length, 0);

    intentionMode = "rejected";
    const rejectedProvider = await fetch(`${baseUrl}/api/owner/payment/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ propertyNumber: "PROP-OWNER", packageId: "PKG-1", action: "new" }),
    });
    assert.equal(rejectedProvider.status, 500);
    assert.equal(releasedReservations.length, 1);
    assert.equal(releasedReservations[0].id, "PAY-3");
    assert.equal(releasedReservations[0].updates.intentionState, "failed");

    failRegistration = true;
    const failedRegistration = await fetch(`${baseUrl}/api/properties/register`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        propertyNumber: "PROP-FAIL",
        name: "Failure",
        whatsappNumber: "0500000000",
        prices: {},
      }),
    });
    assert.equal(failedRegistration.status, 500);
    const preservedSession = await fetch(`${baseUrl}/test/session`, {
      headers: { cookie },
    });
    assert.deepEqual(await preservedSession.json(), {
      propertyNumber: "PROP-OWNER",
    });

    failRegistration = false;
    for (const failureMode of ["regenerate", "save"] as const) {
      const propertyNumber = `PROP-SESSION-${failureMode.toUpperCase()}`;
      const sessionFailureRegistration = await fetch(
        `${baseUrl}/api/properties/register`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-registration-session-failure": failureMode,
          },
          body: JSON.stringify({
            propertyNumber,
            name: "Registered despite session failure",
            whatsappNumber: "0500000000",
            location: "https://maps.example/session-failure",
            city: "Riyadh",
            direction: "north",
            type: "Chalet",
            facilities: ["pool"],
            pin: "1234",
            prices: {},
          }),
        },
      );
      assert.equal(sessionFailureRegistration.status, 201);
      const partialRegistration = await sessionFailureRegistration.json();
      assert.equal(partialRegistration.propertyNumber, propertyNumber);
      assert.equal(partialRegistration.registered, true);
      assert.equal(partialRegistration.partial, true);
      assert.equal(partialRegistration.sessionEstablished, false);
      assert.equal(partialRegistration.loginRequired, true);
      assert.match(partialRegistration.message, /سجّل الدخول/);
      assert.equal(properties.has(propertyNumber), true);
    }
  } finally {
    (propertyService as any).getByNumber = originals.propertyGet;
    (propertyService as any).create = originals.propertyCreate;
    (notificationService as any).newProperty = originals.notifyNewProperty;
    (firebaseService as any).getPurchasablePackageById = originals.getPackage;
    (firebaseService as any).getPropertyByNumber = originals.getFirebaseProperty;
    (firebaseService as any).getSubscriptionByPropertyNumber = originals.getSubscription;
    (subscriptionService as any).getByProperty = originals.getOwnerSubscription;
    (paymentService as any).getByProperty = originals.getPaymentsByProperty;
    (paymentService as any).create = originals.paymentCreate;
    (paymentService as any).update = originals.paymentUpdate;
    (paymobService as any).createIntention = originals.createIntention;
    (firebaseService as any).releasePaymentActionReservation = originals.releaseReservation;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
