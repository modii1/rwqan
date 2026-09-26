import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

import cookieParser from "cookie-parser";
import express from "express";

import { firebaseService } from "../firebaseService";
import { contactIdentityService } from "../services/ContactIdentityService";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import ownerAccountRouter, { ownerAccountService } from "./owner-accounts";

function accountFixture() {
  const timestamp = "2026-09-26T00:00:00.000Z";
  const account = {
    id: "A".repeat(43),
    schemaVersion: 1 as const,
    phoneSubject: "b".repeat(64),
    authVersion: 2,
    status: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: timestamp,
  };
  const memberships = [{
    schemaVersion: 1 as const,
    ownerAccountId: account.id,
    propertyNumber: "P-1",
    status: "active" as const,
    isPrimary: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    revokedAt: null,
  }];
  return { account, memberships };
}

async function startRouter(session: Record<string, any>) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  app.use(ownerAccountRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("owner account challenge and login verify endpoints expose only the safe contract", async () => {
  const originals = {
    issueLogin: ownerAccountService.issueLogin,
    verifyLogin: ownerAccountService.verifyLogin,
    getProperty: firebaseService.getPropertyByNumber,
    revoke: contactIdentityService.revoke,
  };
  const { account, memberships } = accountFixture();
  const session: Record<string, any> = {
    isAdmin: true,
    regenerate(callback: (error?: Error) => void) {
      for (const key of Object.keys(session)) {
        if (!["regenerate", "save"].includes(key)) delete session[key];
      }
      callback();
      return session;
    },
    save(callback: (error?: Error) => void) { callback(); },
  };
  (ownerAccountService as any).issueLogin = async () => ({
    challengeId: "C".repeat(43),
    maskedPhone: "05••••4567",
    expiresInSeconds: 600,
  });
  (ownerAccountService as any).verifyLogin = async () => ({ account, memberships });
  (firebaseService as any).getPropertyByNumber = async () => ({
    propertyNumber: "P-1",
    name: "Property",
    city: "بريدة",
  });
  (contactIdentityService as any).revoke = async () => {};
  const server = await startRouter(session);
  try {
    const challenge = await fetch(
      `${server.baseUrl}/api/owner/account/login/challenge`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "0551234567" }),
      },
    );
    assert.equal(challenge.status, 200);
    assert.deepEqual(await challenge.json(), {
      challengeId: "C".repeat(43),
      maskedPhone: "05••••4567",
      expiresInSeconds: 600,
    });

    const verified = await fetch(
      `${server.baseUrl}/api/owner/account/login/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: "C".repeat(43),
          phone: "0551234567",
          code: "123456",
        }),
      },
    );
    assert.equal(verified.status, 200);
    const payload = await verified.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.propertyNumber, "P-1");
    assert.deepEqual(payload.properties, [{
      propertyNumber: "P-1",
      name: "Property",
      city: "بريدة",
      isCurrent: true,
      isMain: true,
    }]);
    assert.equal("phone" in payload, false);
    assert.equal("ownerAccountId" in payload, false);
    assert.equal(session.ownerAccountId, account.id);
    assert.equal(session.authVersion, 2);
    assert.equal(session.propertyNumber, "P-1");
    assert.equal("isAdmin" in session, false);
  } finally {
    ownerAccountService.issueLogin = originals.issueLogin;
    ownerAccountService.verifyLogin = originals.verifyLogin;
    firebaseService.getPropertyByNumber = originals.getProperty;
    contactIdentityService.revoke = originals.revoke;
    await server.close();
  }
});

test("attach verification derives its property solely from the purpose-bound challenge", async () => {
  const originals = {
    verifyAttach: ownerAccountService.verifyAttach,
    validate: ownerAccountStore.validateActiveMembership,
    getProperty: firebaseService.getPropertyByNumber,
    revoke: contactIdentityService.revoke,
  };
  const { account, memberships } = accountFixture();
  const attachedMembership = {
    ...memberships[0],
    propertyNumber: "P-2",
    isPrimary: false,
  };
  const session: Record<string, any> = {
    propertyNumber: "P-1",
    ownerAccountId: account.id,
    authVersion: account.authVersion,
    regenerate(callback: (error?: Error) => void) {
      for (const key of Object.keys(session)) {
        if (!["regenerate", "save"].includes(key)) delete session[key];
      }
      callback();
      return session;
    },
    save(callback: (error?: Error) => void) { callback(); },
  };
  let verifyInput: Record<string, unknown> | null = null;
  (ownerAccountStore as any).validateActiveMembership = async () => true;
  (ownerAccountService as any).verifyAttach = async (input: Record<string, unknown>) => {
    verifyInput = input;
    return { account, memberships: [...memberships, attachedMembership] };
  };
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: propertyNumber,
    city: "بريدة",
  });
  (contactIdentityService as any).revoke = async () => {};
  const server = await startRouter(session);
  try {
    const response = await fetch(
      `${server.baseUrl}/api/owner/account/properties/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: "C".repeat(43),
          code: "123456",
          propertyNumber: "ATTACKER-CONTROLLED",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(verifyInput, {
      challengeId: "C".repeat(43),
      code: "123456",
      ownerAccountId: account.id,
      authVersion: account.authVersion,
    });
    const payload = await response.json();
    assert.equal(payload.propertyNumber, "P-1");
    assert.equal(payload.properties.length, 2);
  } finally {
    ownerAccountService.verifyAttach = originals.verifyAttach;
    ownerAccountStore.validateActiveMembership = originals.validate;
    firebaseService.getPropertyByNumber = originals.getProperty;
    contactIdentityService.revoke = originals.revoke;
    await server.close();
  }
});

test("account login selects the first existing membership when the primary property was removed", async () => {
  const originals = {
    verifyLogin: ownerAccountService.verifyLogin,
    getProperty: firebaseService.getPropertyByNumber,
    revoke: contactIdentityService.revoke,
  };
  const { account, memberships } = accountFixture();
  const fallbackMembership = {
    ...memberships[0],
    propertyNumber: "P-2",
    isPrimary: false,
  };
  const session: Record<string, any> = {
    regenerate(callback: (error?: Error) => void) {
      for (const key of Object.keys(session)) {
        if (!["regenerate", "save"].includes(key)) delete session[key];
      }
      callback();
      return session;
    },
    save(callback: (error?: Error) => void) { callback(); },
  };
  (ownerAccountService as any).verifyLogin = async () => ({
    account,
    memberships: [...memberships, fallbackMembership],
  });
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) =>
    propertyNumber === "P-2"
      ? { propertyNumber, name: "Fallback", city: "بريدة" }
      : null;
  (contactIdentityService as any).revoke = async () => {};
  const server = await startRouter(session);
  try {
    const response = await fetch(
      `${server.baseUrl}/api/owner/account/login/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: "C".repeat(43),
          phone: "0551234567",
          code: "123456",
        }),
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.propertyNumber, "P-2");
    assert.deepEqual(payload.properties, [{
      propertyNumber: "P-2",
      name: "Fallback",
      city: "بريدة",
      isCurrent: true,
      isMain: false,
    }]);
    assert.equal(session.propertyNumber, "P-2");
    assert.equal(session.ownerAccountId, account.id);
  } finally {
    ownerAccountService.verifyLogin = originals.verifyLogin;
    firebaseService.getPropertyByNumber = originals.getProperty;
    contactIdentityService.revoke = originals.revoke;
    await server.close();
  }
});
