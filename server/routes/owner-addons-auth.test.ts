import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";

import addonsRouter from "./admin/addons";
import { firebaseService } from "../firebaseService";
import { paymobService } from "../integrations/paymob";
import { addOnService, paymentService, propertyService } from "../services";

test("owner add-on routes bind every property operation to the authenticated session", async () => {
  const originals = {
    getForProperty: addOnService.getForProperty,
    getPackageById: addOnService.getPackageById,
    logHistory: addOnService.logHistory,
    propertyGet: propertyService.getByNumber,
    paymentCreate: paymentService.create,
    createPropertyAddOn: firebaseService.createPropertyAddOn,
    initiateAddOnPayment: paymobService.initiateAddOnPayment,
  };
  const propertyReads: string[] = [];
  const addOnReads: string[] = [];
  const createdPayments: any[] = [];
  const createdAddOns: any[] = [];

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
  (firebaseService as any).createPropertyAddOn = async (addOn: any) => {
    createdAddOns.push(addOn);
    return addOn;
  };
  (paymobService as any).initiateAddOnPayment = async () => ({
    checkoutUrl: "https://checkout.example/addon",
  });

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
    assert.equal(createdAddOns.length, 1);
    assert.equal(createdAddOns[0].propertyNumber, "PROP-OWNER");

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
    (firebaseService as any).createPropertyAddOn = originals.createPropertyAddOn;
    (paymobService as any).initiateAddOnPayment = originals.initiateAddOnPayment;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
