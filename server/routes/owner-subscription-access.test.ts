import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";

import ownerRouter from "./owner";
import { firebaseService } from "../firebaseService";

test("owner subscription endpoint is scoped to the session property and its linked group", async () => {
  const originalGetSubscription = firebaseService.getSubscriptionByPropertyNumber;
  const originalGetProperty = firebaseService.getPropertyByNumber;

  const subscriptions = new Map<string, any>([
    [
      "11111",
      {
        propertyNumber: "11111",
        subscriptionType: "owner",
        status: "active",
        endDate: "2027-01-01",
        linkedProperties: ["22222"],
      },
    ],
    [
      "22222",
      {
        propertyNumber: "22222",
        subscriptionType: "owner",
        status: "active",
        endDate: "2027-01-01",
        linkedProperty: "11111",
      },
    ],
  ]);

  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => subscriptions.get(propertyNumber) || null;
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) =>
    subscriptions.has(propertyNumber) ? { name: "Property", city: "Riyadh" } : null;

  const app = express();
  app.use(
    session({
      secret: "owner-subscription-scope-test-secret-1234567890",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );
  app.post("/test/session/:propertyNumber", (req, res) => {
    req.session.propertyNumber = req.params.propertyNumber;
    req.session.save((error) => {
      if (error) return res.status(500).json({ error: error.message });
      res.json({ propertyNumber: req.session.propertyNumber });
    });
  });
  app.use(ownerRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function asOwner(propertyNumber: string) {
    const login = await fetch(`${baseUrl}/test/session/${propertyNumber}`, { method: "POST" });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie") || "";
    return (headers: Record<string, string> = {}) => ({
      "cookie": cookie.split(";")[0],
      ...headers,
    });
  }

  try {
    const ownHeaders = await asOwner("11111");

    const own = await fetch(`${baseUrl}/api/owner/subscription/11111`, {
      headers: ownHeaders(),
    });
    assert.equal(own.status, 200, "an owner may read its own subscription");
    assert.equal((await own.json()).found, true);

    const linked = await fetch(`${baseUrl}/api/owner/subscription/22222`, {
      headers: ownHeaders(),
    });
    assert.equal(linked.status, 200, "an owner may read a linked group member's subscription");
    assert.equal((await linked.json()).found, true);

    const foreign = await fetch(`${baseUrl}/api/owner/subscription/99999`, {
      headers: ownHeaders(),
    });
    assert.equal(foreign.status, 403, "a foreign property must be rejected");
    assert.equal(foreign.headers.get("content-type")!.includes("application/json"), true);

    const childHeaders = await asOwner("22222");
    const groupMain = await fetch(`${baseUrl}/api/owner/subscription/11111`, {
      headers: childHeaders(),
    });
    assert.equal(groupMain.status, 200, "a child owner may read its group's main property");

    const unauthenticated = await fetch(`${baseUrl}/api/owner/subscription/11111`);
    assert.equal(unauthenticated.status, 401, "unauthenticated access is rejected");
  } finally {
    server.close();
    (firebaseService as any).getSubscriptionByPropertyNumber = originalGetSubscription;
    (firebaseService as any).getPropertyByNumber = originalGetProperty;
  }
});