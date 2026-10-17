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
import {
  FREE_COMMISSION_BASIS_POINTS,
  FREE_COMMISSION_CONSENT_TEXT,
  FREE_COMMISSION_TERMS_VERSION,
  createPublicRegistrationPlan,
} from "../../shared/freeCommissionConsent";

test("public onboarding establishes an owner-bound payment session", async () => {
  const originals = {
    propertyGet: propertyService.getByNumber,
    propertyCreate: propertyService.create,
    notifyNewProperty: notificationService.newProperty,
    getPackage: firebaseService.getPurchasablePackageById,
    getFirebaseProperty: firebaseService.getPropertyByNumber,
    getSubscription: firebaseService.getSubscriptionByPropertyNumber,
    getLinkedSubscriptions: firebaseService.getSubscriptionsLinkedToProperty,
    getOwnerSubscription: subscriptionService.getByProperty,
    getPaymentsByProperty: paymentService.getByProperty,
    paymentCreate: paymentService.create,
    paymentUpdate: paymentService.update,
    createIntention: paymobService.createIntention,
    releaseReservation: firebaseService.releasePaymentActionReservation,
  };
  const properties = new Map<string, any>();
  const subscriptions = new Map<string, any>();
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
  (firebaseService as any).getPurchasablePackageById = async (packageId: string) =>
    packageId === "pkg-unavailable"
      ? null
      : packageId === "pkg-free"
      ? {
          id: packageId,
          name: "Free",
          price: 0,
          duration: 30,
          type: "free",
          maxProperties: 1,
        }
      : packageId === "pkg-month-2properties"
      ? {
          id: packageId,
          name: "VIP",
          price: 25,
          duration: 30,
          type: "premium",
          maxProperties: 5,
        }
      : {
          id: packageId,
          name: "Package",
          price: 100,
          duration: 30,
          type: "premium",
          maxProperties: packageId === "PKG-2" ? 2 : 1,
        };
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) =>
    properties.get(propertyNumber) || null;
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => subscriptions.get(propertyNumber) || null;
  (firebaseService as any).getSubscriptionsLinkedToProperty = async (
    mainPropertyNumber: string,
  ) => Array.from(subscriptions.values()).filter(
    (subscription) => subscription.linkedProperty === mainPropertyNumber,
  );
  (subscriptionService as any).getByProperty = async (propertyNumber: string) => {
    ownerSubscriptionLookups.push(propertyNumber);
    return subscriptions.get(propertyNumber) || null;
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
  app.post("/test/session/:propertyNumber", (req, res) => {
    req.session.propertyNumber = req.params.propertyNumber;
    req.session.save((error) => {
      if (error) return res.status(500).json({ error: error.message });
      res.json({ propertyNumber: req.session.propertyNumber });
    });
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
    const missingPackage = await fetch(`${baseUrl}/api/properties/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyNumber: "PROP-MISSING-PACKAGE" }),
    });
    assert.equal(missingPackage.status, 400);
    assert.equal(properties.has("PROP-MISSING-PACKAGE"), false);

    const unavailablePackage = await fetch(
      `${baseUrl}/api/properties/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyNumber: "PROP-UNAVAILABLE-PACKAGE",
          packageId: "pkg-unavailable",
        }),
      },
    );
    assert.equal(unavailablePackage.status, 404);
    assert.equal(properties.has("PROP-UNAVAILABLE-PACKAGE"), false);

    const freeWithoutConsent = await fetch(
      `${baseUrl}/api/properties/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyNumber: "PROP-FREE-NO-CONSENT",
          packageId: "pkg-free",
        }),
      },
    );
    assert.equal(freeWithoutConsent.status, 400);
    assert.equal(
      (await freeWithoutConsent.json()).code,
      "FREE_COMMISSION_CONSENT_REQUIRED",
    );
    assert.equal(properties.has("PROP-FREE-NO-CONSENT"), false);

    const freeRegistration = await fetch(
      `${baseUrl}/api/properties/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyNumber: "PROP-FREE",
          name: "Free property",
          whatsappNumber: "0500000000",
          location: "https://maps.example/free",
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
          packageId: "pkg-free",
          freeCommissionConsentAccepted: true,
          commissionBasisPoints: 1,
          termsVersion: "caller-controlled",
        }),
      },
    );
    assert.equal(freeRegistration.status, 200);
    const persistedFreeProperty = properties.get("PROP-FREE");
    assert.equal(persistedFreeProperty.registrationPlan.packageId, "pkg-free");
    assert.equal(persistedFreeProperty.registrationPlan.isFree, true);
    assert.equal(
      persistedFreeProperty.registrationPlan.selectedAt,
      persistedFreeProperty.freeCommissionConsent.acceptedAt,
    );
    assert.equal(persistedFreeProperty.freeCommissionConsent.accepted, true);
    assert.equal(
      persistedFreeProperty.freeCommissionConsent.commissionBasisPoints,
      FREE_COMMISSION_BASIS_POINTS,
    );
    assert.equal(
      persistedFreeProperty.freeCommissionConsent.termsVersion,
      FREE_COMMISSION_TERMS_VERSION,
    );
    assert.equal(
      persistedFreeProperty.freeCommissionConsent.statement,
      FREE_COMMISSION_CONSENT_TEXT,
    );

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
        packageId: "PKG-1",
      }),
    });
    assert.equal(registration.status, 200);
    const persistedPaidProperty = properties.get("PROP-OWNER");
    assert.equal(persistedPaidProperty.registrationPlan.packageId, "PKG-1");
    assert.equal(persistedPaidProperty.registrationPlan.isFree, false);
    assert.equal("freeCommissionConsent" in persistedPaidProperty, false);
    const cookie = registration.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const sessionState = await fetch(`${baseUrl}/test/session`, {
      headers: { cookie },
    });
    assert.deepEqual(await sessionState.json(), { propertyNumber: "PROP-OWNER" });

    properties.set("PROP-FREE-MISSING-CONSENT", {
      propertyNumber: "PROP-FREE-MISSING-CONSENT",
      name: "Tracked free property",
      verificationStatus: "rejected",
      registrationPlan: createPublicRegistrationPlan({
        packageId: "pkg-free",
        isFree: true,
        selectedAt: "2026-08-24T10:00:00.000Z",
      }),
    });
    const trackedFreeSession = await fetch(
      `${baseUrl}/test/session/PROP-FREE-MISSING-CONSENT`,
      { method: "POST" },
    );
    const trackedFreeCookie = trackedFreeSession.headers
      .get("set-cookie")
      ?.split(";")[0];
    assert.ok(trackedFreeCookie);
    const trackedFreeActivation = await fetch(
      `${baseUrl}/api/owner/property/activate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: trackedFreeCookie,
        },
        body: JSON.stringify({ status: "approved" }),
      },
    );
    assert.equal(trackedFreeActivation.status, 409);
    assert.equal(
      (await trackedFreeActivation.json()).code,
      "FREE_COMMISSION_CONSENT_REQUIRED",
    );

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

    intentionMode = "success";
    properties.set("99655", {
      ...properties.get("PROP-OWNER"),
      propertyNumber: "99655",
      name: "Main property",
      pin: "1234",
    });
    properties.set("99651", {
      ...properties.get("PROP-OWNER"),
      propertyNumber: "99651",
      name: "Linked child",
      pin: "1234",
      linkedProperty: "99655",
    });
    const expiringEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    subscriptions.set("99655", {
      id: "SUB-99655",
      propertyNumber: "99655",
      packageId: "pkg-month-2properties",
      status: "نشط",
      startDate: new Date().toISOString(),
      endDate: expiringEnd,
      linkedProperties: ["99651"],
      propertyCount: 2,
    });
    subscriptions.set("99651", {
      id: "SUB-99651",
      propertyNumber: "99651",
      packageId: "pkg-month-2properties",
      status: "نشط",
      startDate: new Date().toISOString(),
      endDate: expiringEnd,
      linkedProperty: "99655",
      propertyCount: 1,
    });
    const childSession = await fetch(`${baseUrl}/test/session/99651`, {
      method: "POST",
    });
    const childCookie = childSession.headers.get("set-cookie")?.split(";")[0];
    assert.ok(childCookie);

    const childExtension = await fetch(`${baseUrl}/api/owner/payment/initiate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: childCookie },
      body: JSON.stringify({
        propertyNumber: "99651",
        packageId: "pkg-month-2properties",
        action: "extend",
      }),
    });
    assert.equal(childExtension.status, 200);
    const childExtensionBody = await childExtension.json();
    assert.equal(childExtensionBody.finalAmount, 50);
    const childPayment = payments.get("PAY-4");
    assert.equal(childPayment.propertyNumber, "99655");
    assert.equal(childPayment.amount, 50);
    assert.deepEqual(childPayment.additionalProperties, ["99651"]);
    assert.equal(childPayment.secondPropertyNumber, "99651");

    const childHistoryResponse = await fetch(`${baseUrl}/api/owner/payments`, {
      headers: { cookie: childCookie },
    });
    assert.equal(childHistoryResponse.status, 200);
    assert.ok(
      (await childHistoryResponse.json() as any[])
        .some((payment) => payment.id === "PAY-4"),
    );

    failRegistration = true;
    const failedRegistration = await fetch(`${baseUrl}/api/properties/register`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        propertyNumber: "PROP-FAIL",
        name: "Failure",
        whatsappNumber: "0500000000",
        prices: {},
        packageId: "PKG-1",
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
            packageId: "PKG-1",
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
    (firebaseService as any).getSubscriptionsLinkedToProperty = originals.getLinkedSubscriptions;
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
