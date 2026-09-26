import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";

import addonsRouter from "./admin/addons";
import { firebaseService } from "../firebaseService";
import { PaymobIntentionError, paymobService } from "../integrations/paymob";
import { addOnService, paymentService, propertyService } from "../services";
import { ownerAccountStore } from "../services/OwnerAccountStore";

const OWNER_ACCOUNT_ID = "A".repeat(43);

test("owner add-on routes bind every property operation to the authenticated session", async () => {
  const originals = {
    getForProperty: addOnService.getForProperty,
    getPackageById: addOnService.getPackageById,
    logHistory: addOnService.logHistory,
    propertyGet: propertyService.getByNumber,
    paymentCreate: paymentService.create,
    paymentUpdate: paymentService.update,
    createPropertyAddOn: firebaseService.createPropertyAddOn,
    cancelRejectedAddOnIntentionCreation:
      firebaseService.cancelRejectedAddOnIntentionCreation,
    initiateAddOnPayment: paymobService.initiateAddOnPayment,
    validateMembership: ownerAccountStore.validateActiveMembership,
  };
  const propertyReads: string[] = [];
  const addOnReads: string[] = [];
  const createdPayments: any[] = [];
  const paymentUpdates: Array<{ id: string; updates: any }> = [];
  const createdAddOns: any[] = [];
  const rejectedCreationCancellations: Array<{
    paymentId: string;
    addonId: string;
  }> = [];
  const paymobCalls: any[][] = [];
  let failCreatedIdentityUpdateOnce = false;
  let paymobImplementation = async (..._args: any[]) => ({
    intentionId: "INT-ADDON-1",
    checkoutUrl: "https://checkout.example/addon",
    paymobOrderId: "ORDER-ADDON-1",
  });

  (addOnService as any).getForProperty = async (propertyNumber: string) => {
    addOnReads.push(propertyNumber);
    return [{ id: `ADDON-${propertyNumber}`, propertyNumber }];
  };
  (addOnService as any).getPackageById = async () => ({
    id: "ADDON-PACKAGE",
    name: "Featured placement",
    price: 25,
    durationDays: 7,
  });
  (addOnService as any).logHistory = async () => undefined;
  (propertyService as any).getByNumber = async (propertyNumber: string) => {
    propertyReads.push(propertyNumber);
    return {
      propertyNumber,
      name: `Property ${propertyNumber}`,
      whatsappNumber: "0500000000",
    };
  };
  (paymentService as any).create = async (payment: any) => {
    createdPayments.push(payment);
    return payment;
  };
  (paymentService as any).update = async (id: string, updates: any) => {
    paymentUpdates.push({ id, updates });
    if (failCreatedIdentityUpdateOnce && updates.intentionState === "created") {
      failCreatedIdentityUpdateOnce = false;
      throw new Error("simulated local persistence outage");
    }
    return { ...createdPayments.find((payment) => payment.id === id), ...updates };
  };
  (firebaseService as any).createPropertyAddOn = async (addOn: any) => {
    createdAddOns.push(addOn);
    return addOn;
  };
  (firebaseService as any).cancelRejectedAddOnIntentionCreation = async (
    paymentId: string,
    addonId: string,
  ) => {
    rejectedCreationCancellations.push({ paymentId, addonId });
    return true;
  };
  (paymobService as any).initiateAddOnPayment = async (...args: any[]) => {
    paymobCalls.push(args);
    return paymobImplementation(...args);
  };
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === OWNER_ACCOUNT_ID &&
    input.authVersion === 1 &&
    input.propertyNumber === "PROP-OWNER";

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-addons-auth-test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    const propertyNumber = req.get("x-test-owner-property");
    if (propertyNumber) req.session.propertyNumber = propertyNumber;
    if (req.get("x-test-owner-account") === "true") {
      (req.session as any).ownerAccountId = OWNER_ACCOUNT_ID;
      (req.session as any).authVersion = 1;
    }
    next();
  });
  app.use(addonsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const anonymousRead = await fetch(
      `${baseUrl}/api/owner/property-addons?propertyNumber=PROP-VICTIM`,
    );
    assert.equal(anonymousRead.status, 401);
    assert.deepEqual(addOnReads, []);

    const ownerRead = await fetch(
      `${baseUrl}/api/owner/property-addons?propertyNumber=PROP-VICTIM`,
      { headers: { "x-test-owner-property": "PROP-OWNER" } },
    );
    assert.equal(ownerRead.status, 200);
    assert.deepEqual(addOnReads, ["PROP-OWNER"]);
    assert.equal((await ownerRead.json())[0].propertyNumber, "PROP-OWNER");

    const anonymousPayment = await fetch(`${baseUrl}/api/owner/addons/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyNumber: "PROP-VICTIM",
        addOnPackageId: "ADDON-PACKAGE",
      }),
    });
    assert.equal(anonymousPayment.status, 401);
    assert.equal(createdPayments.length, 0);

    const ownerPayment = await fetch(`${baseUrl}/api/owner/addons/pay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-owner-property": "PROP-OWNER",
        "x-test-owner-account": "true",
      },
      body: JSON.stringify({
        propertyNumber: "PROP-VICTIM",
        addOnPackageId: "ADDON-PACKAGE",
      }),
    });
    assert.equal(ownerPayment.status, 200);
    assert.deepEqual(propertyReads, ["PROP-OWNER"]);
    assert.equal(createdPayments.length, 1);
    assert.equal(createdPayments[0].propertyNumber, "PROP-OWNER");
    assert.equal(createdPayments[0].ownerAccountId, OWNER_ACCOUNT_ID);
    assert.ok(createdPayments[0].merchantAttemptKey);
    assert.equal(createdPayments[0].intentionState, "creating");
    assert.equal(createdAddOns.length, 1);
    assert.equal(createdAddOns[0].propertyNumber, "PROP-OWNER");
    assert.equal(paymobCalls.length, 1);
    assert.deepEqual(paymobCalls[0][8], {
      merchantAttemptKey: createdPayments[0].merchantAttemptKey,
      paymentId: createdPayments[0].id,
    });
    assert.deepEqual(paymentUpdates, [{
      id: createdPayments[0].id,
      updates: {
        paymentReference: "INT-ADDON-1",
        transactionId: "INT-ADDON-1",
        paymentCheckoutUrl: "https://checkout.example/addon",
        paymobOrderId: "ORDER-ADDON-1",
        intentionState: "created",
      },
    }]);

    const postOwnerAddon = () => fetch(`${baseUrl}/api/owner/addons/pay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-owner-property": "PROP-OWNER",
        "x-test-owner-account": "true",
      },
      body: JSON.stringify({ addOnPackageId: "ADDON-PACKAGE" }),
    });

    paymobImplementation = async () => {
      throw new PaymobIntentionError("provider timeout", "unknown");
    };
    const ambiguousResponse = await postOwnerAddon();
    assert.equal(ambiguousResponse.status, 500);
    const ambiguousPayment = createdPayments.at(-1);
    assert.deepEqual(paymentUpdates.at(-1), {
      id: ambiguousPayment.id,
      updates: { intentionState: "unknown" },
    });

    paymobImplementation = async () => {
      throw new PaymobIntentionError("provider rejected", "rejected");
    };
    const rejectedResponse = await postOwnerAddon();
    assert.equal(rejectedResponse.status, 500);
    const rejectedPayment = createdPayments.at(-1);
    const rejectedAddOn = createdAddOns.at(-1);
    assert.deepEqual(rejectedCreationCancellations.at(-1), {
      paymentId: rejectedPayment.id,
      addonId: rejectedAddOn.id,
    });
    assert.equal(
      paymentUpdates.some(
        ({ id, updates }) =>
          id === rejectedPayment.id && updates.intentionState === "failed",
      ),
      false,
    );

    paymobImplementation = async () => {
      throw new PaymobIntentionError(
        "order lookup unavailable",
        "unknown",
        {
          createdIntention: {
            intentionId: "INT-ADDON-PARTIAL",
            checkoutUrl: "https://checkout.example/addon-partial",
          },
        },
      );
    };
    const partialResponse = await postOwnerAddon();
    assert.equal(partialResponse.status, 500);
    const partialPayment = createdPayments.at(-1);
    assert.deepEqual(paymentUpdates.at(-1), {
      id: partialPayment.id,
      updates: {
        paymentReference: "INT-ADDON-PARTIAL",
        transactionId: "INT-ADDON-PARTIAL",
        paymentCheckoutUrl: "https://checkout.example/addon-partial",
        intentionState: "unknown",
      },
    });

    paymobImplementation = async () => ({
      intentionId: "INT-ADDON-RECOVERED",
      checkoutUrl: "https://checkout.example/addon-recovered",
      paymobOrderId: "ORDER-ADDON-RECOVERED",
    });
    failCreatedIdentityUpdateOnce = true;
    const callsBeforeRecovery = paymobCalls.length;
    const recoveryResponse = await postOwnerAddon();
    assert.equal(recoveryResponse.status, 500);
    assert.equal(paymobCalls.length, callsBeforeRecovery + 1);
    const recoveredPayment = createdPayments.at(-1);
    const recoveredUpdates = paymentUpdates.filter(
      ({ id }) => id === recoveredPayment.id,
    );
    assert.equal(recoveredUpdates.length, 2);
    assert.deepEqual(recoveredUpdates[0].updates, recoveredUpdates[1].updates);
    assert.equal(recoveredUpdates[1].updates.intentionState, "created");
    assert.equal(
      recoveredUpdates[1].updates.paymobOrderId,
      "ORDER-ADDON-RECOVERED",
    );

    const anonymousBankTransfer = await fetch(
      `${baseUrl}/api/owner/addons/bank-transfer`,
      { method: "POST" },
    );
    assert.equal(anonymousBankTransfer.status, 401);
  } finally {
    (addOnService as any).getForProperty = originals.getForProperty;
    (addOnService as any).getPackageById = originals.getPackageById;
    (addOnService as any).logHistory = originals.logHistory;
    (propertyService as any).getByNumber = originals.propertyGet;
    (paymentService as any).create = originals.paymentCreate;
    (paymentService as any).update = originals.paymentUpdate;
    (firebaseService as any).createPropertyAddOn = originals.createPropertyAddOn;
    (firebaseService as any).cancelRejectedAddOnIntentionCreation =
      originals.cancelRejectedAddOnIntentionCreation;
    (paymobService as any).initiateAddOnPayment = originals.initiateAddOnPayment;
    ownerAccountStore.validateActiveMembership = originals.validateMembership;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
