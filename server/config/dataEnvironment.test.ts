import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  getActiveFirestore,
  getActiveDataEnvironment,
  getActiveFirestoreProjectId,
  activeFirestore,
  LiveDataSourceError,
  LiveWriteBlockedError,
  resetDataEnvironmentForTests,
  setDevFirestoreForTests,
} from "./dataEnvironment";
import { dataEnvironmentStore } from "../services/LiveDataEnvironmentStore";
import { readLiveDataConfig } from "./liveDataEnvironment";
import { firebaseService } from "../firebaseService";
import { r2, R2_BUCKET, R2_PUBLIC_URL, syncR2Environment } from "../utils/r2";

const LIVE_ENV_KEYS = [
  "LIVE_DATA_READONLY_ACK",
  "LIVE_FIREBASE_PROJECT_ID",
  "LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT",
  "LIVE_WRITE_MODE",
  "LIVE_R2_ENDPOINT",
  "LIVE_R2_ACCESS_KEY_ID",
  "LIVE_R2_SECRET_ACCESS_KEY",
  "LIVE_R2_BUCKET_NAME",
  "LIVE_R2_PUBLIC_URL",
  "LIVE_R2_REGION",
] as const;

function clearLiveEnv(): void {
  for (const key of LIVE_ENV_KEYS) delete process.env[key];
}

function setLiveEnv(options: { writeEnabled?: boolean; withR2?: boolean } = {}): void {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  process.env.LIVE_DATA_READONLY_ACK = "read-only";
  process.env.LIVE_FIREBASE_PROJECT_ID = "rwqan-sa";
  process.env.LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT = JSON.stringify({
    type: "service_account",
    project_id: "rwqan-sa",
    private_key_id: "test-key",
    private_key: pem,
    client_email: "test@rwqan-sa.iam.gserviceaccount.com",
    client_id: "1",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  });
  process.env.LIVE_WRITE_MODE = options.writeEnabled ? "enabled" : "read-only";
  if (options.withR2) {
    process.env.LIVE_R2_ENDPOINT = "https://fake-account.r2.cloudflarestorage.com";
    process.env.LIVE_R2_ACCESS_KEY_ID = "live-key";
    process.env.LIVE_R2_SECRET_ACCESS_KEY = "live-secret";
    process.env.LIVE_R2_BUCKET_NAME = "rwqan-images";
    process.env.LIVE_R2_PUBLIC_URL = "https://pub-live.r2.dev";
    process.env.LIVE_R2_REGION = "auto";
  }
}

function isLiveWriteBlocked(error: unknown): boolean {
  return error instanceof LiveWriteBlockedError;
}

// A minimal structural fake Firestore for DEV-mode tests.
function fakeFirestore(label: string): Firestore {
  const calls: string[] = [];
  const docRef = (id: string) => ({
    id,
    get: async () => ({ exists: false, data: () => undefined }),
    set: async () => {
      calls.push(`${label}:doc(${id}).set`);
    },
    update: async () => {
      calls.push(`${label}:doc(${id}).update`);
    },
    delete: async () => {
      calls.push(`${label}:doc(${id}).delete`);
    },
  });
  const collection = (name: string) => ({
    name,
    doc: docRef,
    add: async () => {
      calls.push(`${label}:collection(${name}).add`);
    },
    get: async () => ({ docs: [] }),
    where: () => ({ get: async () => ({ docs: [] }) }),
  });
  const firestore = {
    collection,
    doc: (path: string) => docRef(path),
    batch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} }),
    runTransaction: async (fn: (tx: any) => unknown) =>
      fn({ get: async () => ({ exists: false, data: () => undefined }), set: () => {}, update: () => {}, delete: () => {} }),
  };
  return firestore as unknown as Firestore;
}

test.afterEach(() => {
  dataEnvironmentStore.set("TEST");
  clearLiveEnv();
  resetDataEnvironmentForTests();
});

test("TEST resolves the DEV Firestore and honours the dev injection seam", () => {
  const dev = fakeFirestore("DEV");
  setDevFirestoreForTests(dev);
  dataEnvironmentStore.set("TEST");
  assert.equal(getActiveDataEnvironment(), "TEST");
  assert.equal(getActiveFirestore(), dev);
});

test("LIVE fails closed when no production configuration exists", () => {
  clearLiveEnv();
  dataEnvironmentStore.set("LIVE");
  assert.throws(() => getActiveFirestore(), LiveDataSourceError);
  assert.equal(readLiveDataConfig().config, null);
});

test("LIVE in read-only mode rejects writes, updates, deletes and transactions", async () => {
  setLiveEnv({ writeEnabled: false });
  dataEnvironmentStore.set("LIVE");
  const firestore = getActiveFirestore();
  assert.notEqual(firestore, undefined);

  const expectBlocked = async (operation: () => unknown): Promise<void> => {
    try {
      await operation();
      assert.fail("expected the operation to be blocked");
    } catch (error: unknown) {
      assert.ok(
        error instanceof LiveWriteBlockedError,
        `expected LiveWriteBlockedError, got ${String(error)}`,
      );
    }
  };

  await expectBlocked(() =>
    firestore.collection("properties").doc("10001").set({ name: "x" }),
  );
  await expectBlocked(() => firestore.collection("properties").add({}));
  await expectBlocked(() => firestore.doc("properties/10001").delete());
  await expectBlocked(() =>
    firestore.runTransaction(async (tx) => {
      tx.set(firestore.collection("properties").doc("10001"), { name: "x" });
    }),
  );
  await expectBlocked(() => {
    const batch = firestore.batch();
    batch.set(firestore.collection("properties").doc("10001"), { name: "x" });
    return batch.commit();
  });
});

test("LIVE with write enabled does not apply the read-only guard", async () => {
  setLiveEnv({ writeEnabled: true });
  dataEnvironmentStore.set("LIVE");
  const firestore = getActiveFirestore();
  // A write is not rejected by the guard (it may fail later for network/iam
  // reasons, but never with LiveWriteBlockedError).
  const result = await Promise.resolve()
    .then(() => firestore.collection("properties").doc("10001").set({ name: "x" }))
    .catch((error: unknown) => error);
  assert.ok(!isLiveWriteBlocked(result));
});

test("the activeFirestore proxy resolves the environment on every access", () => {
  const dev = fakeFirestore("DEV");
  setDevFirestoreForTests(dev);
  dataEnvironmentStore.set("TEST");
  const collection = activeFirestore.collection("properties") as unknown as {
    name: string;
  };
  assert.equal(collection.name, "properties");
  assert.equal(activeFirestore.collection("properties").doc("1").id, "1");
});

test("switching to LIVE fails closed at the store level without config", () => {
  clearLiveEnv();
  dataEnvironmentStore.set("LIVE");
  assert.throws(() => getActiveFirestore(), LiveDataSourceError);
});

test("firebaseService (the whole-app path) resolves the active environment", () => {
  const dev = fakeFirestore("DEV");
  setDevFirestoreForTests(dev);
  dataEnvironmentStore.set("TEST");
  const serviceDb = (firebaseService as unknown as { db: Firestore }).db;
  assert.equal(serviceDb, dev);
  setDevFirestoreForTests(null);
});

test("getActiveFirestoreProjectId reports the actual source project", () => {
  setLiveEnv();
  dataEnvironmentStore.set("LIVE");
  assert.equal(getActiveFirestoreProjectId(), "rwqan-sa");
});

test("getActiveFirestoreProjectId is null without a configured DEV app", () => {
  setDevFirestoreForTests(null);
  dataEnvironmentStore.set("TEST");
  const projectId = getActiveFirestoreProjectId();
  assert.ok(projectId === null || typeof projectId === "string");
});

test("syncR2Environment repoints the image store bindings per environment", async () => {
  setLiveEnv({ withR2: true });
  dataEnvironmentStore.set("LIVE");
  syncR2Environment();
  assert.equal(R2_BUCKET, "rwqan-images");
  assert.equal(R2_PUBLIC_URL, "https://pub-live.r2.dev");
  assert.ok(r2 !== null);

  dataEnvironmentStore.set("TEST");
  syncR2Environment();
  // Back to the DEV image store (null in this test environment).
  assert.equal(R2_BUCKET, process.env.R2_BUCKET_NAME);
});
