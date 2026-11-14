import assert from "node:assert/strict";
import test from "node:test";

import { firebaseService } from "../firebaseService";
import {
  ensureArgon2idHash,
  hashPassword,
  isArgon2idHash,
  verifyPassword,
} from "../utils/password";

type FakeOwner = { password?: string };

function installFakeDb(db: unknown): void {
  Object.defineProperty(firebaseService, "db", {
    configurable: true,
    value: db,
  });
}

function restoreFakeDb(): void {
  delete (firebaseService as any).db;
}

function fakeOwnerDb(initialPassword: string) {
  const state = { owner: { password: initialPassword } as FakeOwner, writes: [] as any[] };

  const db = {
    collection(_name: string) {
      return {
        doc(_id: string) {
          return {
            get: async () => ({
              exists: true,
              data: () => state.owner,
            }),
            update: async (data: Record<string, unknown>) => {
              state.owner = { ...state.owner, ...data };
              state.writes.push(data);
            },
            create: async () => {
              throw Object.assign(new Error("already exists"), { code: 6 });
            },
          };
        },
      };
    },
    runTransaction: async (callback: (transaction: any) => Promise<boolean>) =>
      callback({
        get: async () => ({
          exists: true,
          data: () => state.owner,
        }),
        update: (_ref: unknown, data: Record<string, unknown>) => {
          state.owner = { ...state.owner, ...data };
          state.writes.push(data);
        },
      }),
  };

  return { db, state };
}

test("migrateOwnerPasswordHash replaces only the exact verified legacy value", async () => {
  const { db, state } = fakeOwnerDb("0123");
  installFakeDb(db);
  try {
    const digest = await hashPassword("0123");
    assert.equal(
      await firebaseService.migrateOwnerPasswordHash("90001", digest, {
        expectedLegacyPassword: "0123",
      }),
      true,
    );
    assert.equal(isArgon2idHash(state.owner.password), true);
    assert.equal(await verifyPassword(state.owner.password!, "0123"), true);
  } finally {
    restoreFakeDb();
  }
});

test("migrateOwnerPasswordHash never overwrites a newer password", async () => {
  const { db, state } = fakeOwnerDb("");
  installFakeDb(db);
  try {
    const newerHash = await hashPassword("9999");
    state.owner.password = newerHash;
    assert.equal(
      await firebaseService.migrateOwnerPasswordHash(
        "90001",
        await hashPassword("0123"),
        { expectedLegacyPassword: "0123" },
      ),
      false,
    );
    assert.equal(state.owner.password, newerHash);
    assert.equal(await verifyPassword(state.owner.password!, "9999"), true);
  } finally {
    restoreFakeDb();
  }
});

test("migrateOwnerPasswordHash requires an expected legacy value", async () => {
  const { db, state } = fakeOwnerDb("0123");
  installFakeDb(db);
  try {
    assert.equal(
      await firebaseService.migrateOwnerPasswordHash(
        "90001",
        await hashPassword("0123"),
      ),
      false,
    );
    assert.equal(state.owner.password, "0123");
  } finally {
    restoreFakeDb();
  }
});

test("updateOwnerPassword stores Argon2id even when given plaintext", async () => {
  const originalUpdateProperty = (firebaseService as any).updateProperty;
  const { db, state } = fakeOwnerDb("");
  let propertyPin = "";
  installFakeDb(db);
  (firebaseService as any).updateProperty = async (
    _propertyNumber: string,
    updates: { pin?: string },
  ) => {
    propertyPin = updates.pin ?? "";
  };
  try {
    await firebaseService.updateOwnerPassword("90001", "0123");
    assert.equal(isArgon2idHash(state.owner.password), true);
    assert.equal(isArgon2idHash(propertyPin), true);
    assert.equal(await verifyPassword(state.owner.password!, "0123"), true);
  } finally {
    restoreFakeDb();
    (firebaseService as any).updateProperty = originalUpdateProperty;
  }
});

test("updateOwnerPassword does not double-hash an existing hash", async () => {
  const originalUpdateProperty = (firebaseService as any).updateProperty;
  const { db, state } = fakeOwnerDb("");
  installFakeDb(db);
  (firebaseService as any).updateProperty = async () => undefined;
  try {
    const digest = await hashPassword("0123");
    await firebaseService.updateOwnerPassword("90001", digest);
    assert.equal(state.owner.password, digest);
  } finally {
    restoreFakeDb();
    (firebaseService as any).updateProperty = originalUpdateProperty;
  }
});

test("syncOwnerFromProperties creates an Argon2id owner from a plaintext property PIN", async () => {
  const originalGetProperty = (firebaseService as any).getPropertyByNumber;
  const originalGetOwner = (firebaseService as any).getOwnerByPropertyNumber;
  let created: any = null;
  (firebaseService as any).getPropertyByNumber = async () => ({
    pin: "0123",
    whatsappNumber: "966500000000",
  });
  (firebaseService as any).getOwnerByPropertyNumber = async () => null;
  installFakeDb({
    collection: () => ({
      doc: () => ({
        create: async (data: any) => {
          created = data;
        },
      }),
    }),
  });
  try {
    await firebaseService.syncOwnerFromProperties("90001");
    assert.ok(created);
    assert.equal(isArgon2idHash(created.password), true);
    assert.equal(await verifyPassword(created.password, "0123"), true);
  } finally {
    restoreFakeDb();
    (firebaseService as any).getPropertyByNumber = originalGetProperty;
    (firebaseService as any).getOwnerByPropertyNumber = originalGetOwner;
  }
});

test("syncOwnerFromProperties does not overwrite a concurrently created owner", async () => {
  const originalGetProperty = (firebaseService as any).getPropertyByNumber;
  const originalGetOwner = (firebaseService as any).getOwnerByPropertyNumber;
  (firebaseService as any).getPropertyByNumber = async () => ({
    pin: "0123",
    whatsappNumber: "966500000000",
  });
  (firebaseService as any).getOwnerByPropertyNumber = async () => null;
  installFakeDb({
    collection: () => ({
      doc: () => ({
        create: async () => {
          throw Object.assign(new Error("already exists"), { code: 6 });
        },
      }),
    }),
  });
  try {
    await assert.doesNotReject(() =>
      firebaseService.syncOwnerFromProperties("90001"),
    );
  } finally {
    restoreFakeDb();
    (firebaseService as any).getPropertyByNumber = originalGetProperty;
    (firebaseService as any).getOwnerByPropertyNumber = originalGetOwner;
  }
});

test("ensureArgon2idHash preserves a verified PIN with a leading zero", async () => {
  const digest = await ensureArgon2idHash("0123");
  assert.equal(isArgon2idHash(digest), true);
  assert.equal(await verifyPassword(digest, "0123"), true);
  assert.equal(await verifyPassword(digest, "123"), false);
});
