import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { firebaseService } from "../firebaseService";
import { authService } from "./AuthService";
import { isArgon2idHash } from "../utils/password";

type Stub = (...args: any[]) => any;

const originals: Record<string, Stub | undefined> = {};
const stubbed: string[] = [];
const writeCalls: Array<[string, string]> = [];
const clearResetCalls: string[] = [];

function stubMethod(name: string, impl: Stub): void {
  if (!(name in originals)) {
    originals[name] = (firebaseService as any)[name];
    stubbed.push(name);
  }
  (firebaseService as any)[name] = impl;
}

function noop(): Promise<void> {
  return Promise.resolve();
}

before(() => {
  stubMethod("getOwnerByPropertyNumber", async () => null);
  stubMethod("getPropertyByNumber", async () => ({ pin: "1234" }));
  stubMethod("syncOwnerFromProperties", noop);
  stubMethod("validateResetCode", async () => ({ valid: true, message: "" }));
  stubMethod("updateOwnerPassword", async (propertyNumber: string, newPassword: string) => {
    writeCalls.push([propertyNumber, newPassword]);
  });
  stubMethod("updateOwnerResetCode", noop);
  stubMethod("clearOwnerResetCode", async (propertyNumber: string) => {
    clearResetCalls.push(propertyNumber);
  });
  stubMethod("canSendResetCode", async () => ({ canSend: true }));
  stubMethod("getOwnerPhone", async () => "966500000000");
  stubMethod("ensureOwnersSheetExists", noop);
});

after(() => {
  for (const name of stubbed) {
    (firebaseService as any)[name] = originals[name];
  }
  baselineEnv();
});

function baselineEnv(): void {
  const env = process.env as Record<string, string | undefined>;
  env["NODE_ENV"] = "test";
  env["AUTH_ENFORCE_HASHED_ONLY"] = "false";
  env["AUTH_HASH_MIGRATION_ENABLED"] = "false";
}

async function withEnv(
  env: Record<string, string | undefined> | undefined,
  fn: () => Promise<void>
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const PROD = { NODE_ENV: "production" };
const TRANSITION = {
  NODE_ENV: "production",
  AUTH_ENFORCE_HASHED_ONLY: "false",
  AUTH_HASH_MIGRATION_ENABLED: "false",
};
const MIGRATION = {
  NODE_ENV: "production",
  AUTH_ENFORCE_HASHED_ONLY: "false",
  AUTH_HASH_MIGRATION_ENABLED: "true",
};

test("validateOwnerPin accepts a valid hashed password without rewriting", async () => {
  writeCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "998877",
    password: await hashForTest("5531"),
  }));
  stubMethod("getPropertyByNumber", async () => ({ pin: "whatever" }));

  assert.equal(await authService.validateOwnerPin("998877", "5531"), true);
  assert.equal(await authService.validateOwnerPin("998877", "wrong"), false);
  assert.equal(writeCalls.length, 0);
});

test("validateOwnerPin rejects a legacy plaintext password in enforcement mode", async () => {
  writeCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "332211",
    password: "1234",
  }));

  await withEnv(
    {
      NODE_ENV: "development",
      AUTH_ENFORCE_HASHED_ONLY: "true",
      AUTH_HASH_MIGRATION_ENABLED: "true",
    },
    async () => {
      assert.equal(await authService.validateOwnerPin("332211", "1234"), false);
      assert.equal(writeCalls.length, 0);
    }
  );
});

test("validateOwnerPin accepts and migrates a legacy plaintext password when enabled", async () => {
  writeCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "445566",
    password: "9876",
  }));

  await withEnv(MIGRATION, async () => {
    assert.equal(await authService.validateOwnerPin("445566", "9876"), true);
    assert.equal(writeCalls.length, 1);
    assert.equal(writeCalls[0][0], "445566");
    assert.equal(isArgon2idHash(writeCalls[0][1]), true);
  });
});

test("validateOwnerPin keeps legacy plaintext accepted when transition flags are off", async () => {
  writeCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "778899",
    password: "1357",
  }));

  await withEnv(TRANSITION, async () => {
    assert.equal(await authService.validateOwnerPin("778899", "1357"), true);
    assert.equal(writeCalls.length, 0);
  });
});

test("validateOwnerPin falls back to property.pin when owner password is missing", async () => {
  stubMethod("getOwnerByPropertyNumber", async () => null);
  stubMethod("getPropertyByNumber", async () => ({ pin: "2468" }));

  await withEnv(TRANSITION, async () => {
    assert.equal(await authService.validateOwnerPin("112233", "2468"), true);
  });
});

test("validateOwnerPin migration failure does not block a successful login", async () => {
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "665544",
    password: "8642",
  }));
  let calls = 0;
  stubMethod("updateOwnerPassword", async () => {
    calls += 1;
    throw new Error("db unavailable");
  });

  await withEnv(MIGRATION, async () => {
    assert.equal(await authService.validateOwnerPin("665544", "8642"), true);
    assert.equal(calls, 1);
  });

  stubMethod("updateOwnerPassword", async (propertyNumber: string, newPassword: string) => {
    writeCalls.push([propertyNumber, newPassword]);
  });
});

test("setNewPassword writes an argon2id hash, never the plaintext", async () => {
  writeCalls.length = 0;
  await authService.setNewPassword("334455", "000000", "4321");
  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0][0], "334455");
  assert.equal(isArgon2idHash(writeCalls[0][1]), true);
  assert.notEqual(writeCalls[0][1], "4321");
});

test("setNewPassword rejects short passwords", async () => {
  await assert.rejects(
    () => authService.setNewPassword("334455", "000000", "123"),
    (err: any) => err?.code === 400
  );
});

test("changePassword verifies a hashed current password and writes a new hash", async () => {
  writeCalls.length = 0;
  clearResetCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "556677",
    password: await hashForTest("7410"),
  }));

  await withEnv(PROD, async () => {
    await authService.changePassword("556677", "7410", "9630");
    assert.equal(writeCalls.length, 1);
    assert.equal(writeCalls[0][0], "556677");
    assert.equal(isArgon2idHash(writeCalls[0][1]), true);
    assert.deepEqual(clearResetCalls, ["556677"]);
  });
});

test("changePassword rejects a wrong current password without writing", async () => {
  writeCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "556677",
    password: await hashForTest("7410"),
  }));

  await withEnv(PROD, async () => {
    await assert.rejects(
      () => authService.changePassword("556677", "nope", "9630"),
      (err: any) => err?.code === 400
    );
    assert.equal(writeCalls.length, 0);
  });
});

test("changePassword accepts legacy plaintext current password in transition mode", async () => {
  writeCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "889900",
    password: "3160",
  }));

  await withEnv(TRANSITION, async () => {
    await authService.changePassword("889900", "3160", "1245");
    assert.equal(writeCalls.length, 1);
    assert.equal(isArgon2idHash(writeCalls[0][1]), true);
  });
});

test("changePassword rejects legacy plaintext current password when enforcement is on", async () => {
  writeCalls.length = 0;
  stubMethod("getOwnerByPropertyNumber", async () => ({
    ownerId: "889900",
    password: "3160",
  }));

  await withEnv(
    {
      NODE_ENV: "development",
      AUTH_ENFORCE_HASHED_ONLY: "true",
      AUTH_HASH_MIGRATION_ENABLED: "true",
    },
    async () => {
      await assert.rejects(
        () => authService.changePassword("889900", "3160", "1245"),
        (err: any) => err?.code === 400
      );
      assert.equal(writeCalls.length, 0);
    }
  );
});

async function hashForTest(pin: string): Promise<string> {
  const { hashPassword } = await import("../utils/password");
  return hashPassword(pin);
}