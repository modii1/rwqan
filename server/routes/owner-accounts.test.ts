import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

import cookieParser from "cookie-parser";
import express from "express";

import { firebaseService } from "../firebaseService";
import { contactIdentityService } from "../services/ContactIdentityService";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import ownerAccountRouter, {
  createOwnerOtpSender,
  ownerAccountService,
  readPropertyRegisteredPhone,
} from "./owner-accounts";

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

test("attach challenge binds the session account, current property, and requested target", async () => {
  const originals = {
    issueAttach: ownerAccountService.issueAttach,
    validate: ownerAccountStore.validateActiveMembership,
  };
  const { account } = accountFixture();
  const session: Record<string, any> = {
    propertyNumber: "P-1",
    ownerAccountId: account.id,
    authVersion: account.authVersion,
  };
  let input: Record<string, unknown> | null = null;
  const captured = () => input as Record<string, unknown> | null;
  (ownerAccountStore as any).validateActiveMembership = async () => true;
  (ownerAccountService as any).issueAttach = async (value: Record<string, unknown>) => {
    input = value;
    return {
      challengeId: "C".repeat(43),
      maskedPhone: "05••••4567",
      expiresInSeconds: 600,
    };
  };
  const server = await startRouter(session);
  try {
    const response = await fetch(
      `${server.baseUrl}/api/owner/account/properties/challenge`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyNumber: "00001" }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      challengeId: "C".repeat(43),
      maskedPhone: "05••••4567",
      expiresInSeconds: 600,
    });
    assert.equal(captured()?.ownerAccountId, account.id);
    assert.equal(captured()?.authVersion, account.authVersion);
    assert.equal(captured()?.currentPropertyNumber, "P-1");
    assert.equal(captured()?.propertyNumber, "00001");
    assert.equal(typeof captured()?.ipAddress, "string");
  } finally {
    ownerAccountService.issueAttach = originals.issueAttach;
    ownerAccountStore.validateActiveMembership = originals.validate;
    await server.close();
  }
});

test("attach phone source is the property record and never requires an owners document", async () => {
  const originals = {
    property: firebaseService.getPropertyByNumber,
    owner: firebaseService.getOwnerByPropertyNumber,
  };
  let ownerReads = 0;
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: "Property",
    city: "بريدة",
    whatsappNumber: "0551234567",
  });
  (firebaseService as any).getOwnerByPropertyNumber = async () => {
    ownerReads += 1;
    return null;
  };

  try {
    assert.deepEqual(await readPropertyRegisteredPhone("00001"), {
      propertyNumber: "00001",
      whatsappNumber: "0551234567",
    });
    assert.equal(ownerReads, 0);

    (firebaseService as any).getPropertyByNumber = async () => null;
    assert.equal(await readPropertyRegisteredPhone("MISSING"), null);
    assert.equal(ownerReads, 0);
  } finally {
    firebaseService.getPropertyByNumber = originals.property;
    firebaseService.getOwnerByPropertyNumber = originals.owner;
  }
});

test("owner OTP console sink logs the code only when enabled and never calls the provider", async () => {
  const logs: string[] = [];
  const sent: Array<{ phone: string; message: string }> = [];
  const send = async (phone: string, message: string) => {
    sent.push({ phone, message });
    return { success: true };
  };

  const sinkOn = createOwnerOtpSender({
    sinkEnabled: () => true,
    send,
    log: (line) => logs.push(line),
  });
  const sinkResult = await sinkOn("551234567", "رمز التحقق: 123456", 2);
  assert.deepEqual(sinkResult, { success: true });
  assert.equal(sent.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[DEV OWNER OTP\] to=05••••4567 :: /);
  assert.match(logs[0], /123456/);

  const sinkOff = createOwnerOtpSender({
    sinkEnabled: () => false,
    send,
    log: (line) => logs.push(line),
  });
  const providerResult = await sinkOff("551234567", "رمز التحقق: 654321", 2);
  assert.deepEqual(providerResult, { success: true });
  assert.deepEqual(sent, [
    { phone: "551234567", message: "رمز التحقق: 654321" },
  ]);
  assert.equal(logs.length, 1);
});
