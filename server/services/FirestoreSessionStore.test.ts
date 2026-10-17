import assert from "node:assert/strict";
import test from "node:test";
import type { SessionData } from "express-session";
import {
  FirestoreSessionStore,
  sessionDocumentId,
  sessionExpiryMillis,
} from "./FirestoreSessionStore";

class FakeDocument {
  constructor(
    private readonly rows: Map<string, Record<string, unknown>>,
    private readonly id: string,
  ) {}

  async get() {
    const data = this.rows.get(this.id);
    const snapshot = data ? { ...data } : undefined;
    return { exists: Boolean(snapshot), data: () => snapshot };
  }

  async set(value: Record<string, unknown>) {
    this.rows.set(this.id, value);
  }

  async update(value: Record<string, unknown>) {
    const current = this.rows.get(this.id);
    if (!current) throw Object.assign(new Error("missing"), { code: 5 });
    this.rows.set(this.id, { ...current, ...value });
  }

  async delete() {
    this.rows.delete(this.id);
  }
}

class FakeFirestore {
  readonly rows = new Map<string, Record<string, unknown>>();
  beforeTransaction: (() => void) | null = null;

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocument(this.rows, `${name}/${id}`),
    };
  }

  async runTransaction<T>(
    update: (transaction: {
      get: (reference: FakeDocument) => ReturnType<FakeDocument["get"]>;
      delete: (reference: FakeDocument) => void;
    }) => Promise<T>,
  ): Promise<T> {
    const beforeTransaction = this.beforeTransaction;
    this.beforeTransaction = null;
    beforeTransaction?.();
    return update({
      get: (reference) => reference.get(),
      delete: (reference) => {
        void reference.delete();
      },
    });
  }
}

function setSession(
  store: FirestoreSessionStore,
  id: string,
  value: SessionData,
): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(id, value, (error) => error ? reject(error) : resolve());
  });
}

function getSession(
  store: FirestoreSessionStore,
  id: string,
): Promise<SessionData | null | undefined> {
  return new Promise((resolve, reject) => {
    store.get(id, (error, value) => error ? reject(error) : resolve(value));
  });
}

function touchSession(
  store: FirestoreSessionStore,
  id: string,
  value: SessionData,
): Promise<void> {
  return new Promise((resolve, reject) => {
    store.touch(id, value, (error) => error ? reject(error) : resolve());
  });
}

test("session ids are stored as stable non-reversible document ids", () => {
  assert.match(sessionDocumentId("sensitive-session-id"), /^[a-f0-9]{64}$/);
  assert.equal(
    sessionDocumentId("sensitive-session-id"),
    sessionDocumentId("sensitive-session-id"),
  );
  assert.notEqual(
    sessionDocumentId("sensitive-session-id"),
    sessionDocumentId("another-session-id"),
  );
});

test("cookie expiry wins over the default session lifetime", () => {
  const now = Date.parse("2026-09-26T10:00:00.000Z");
  const expires = new Date(now + 60_000);
  assert.equal(
    sessionExpiryMillis({ cookie: { expires } } as SessionData, now),
    expires.getTime(),
  );
});

test("Firestore sessions are shared, destroyed, and never revived by touch", async () => {
  const database = new FakeFirestore();
  const first = new FirestoreSessionStore(database as never);
  const second = new FirestoreSessionStore(database as never);
  const value = {
    cookie: { maxAge: 60_000 },
    propertyNumber: "13383",
  } as SessionData;

  await setSession(first, "session-one", value);
  assert.equal((await getSession(second, "session-one") as any)?.propertyNumber, "13383");

  await new Promise<void>((resolve, reject) => {
    first.destroy("session-one", (error) => error ? reject(error) : resolve());
  });
  await touchSession(second, "session-one", value);
  assert.equal(await getSession(first, "session-one"), null);
});

test("a stale touch updates expiry metadata without restoring stale authentication", async () => {
  const database = new FakeFirestore();
  const first = new FirestoreSessionStore(database as never);
  const second = new FirestoreSessionStore(database as never);
  const staleAnonymousSession = {
    cookie: { maxAge: 120_000 },
  } as SessionData;
  const authenticatedSession = {
    cookie: { maxAge: 60_000 },
    isAdmin: true,
  } as SessionData;

  await setSession(first, "shared-session", staleAnonymousSession);
  await setSession(second, "shared-session", authenticatedSession);
  const rowKey = `server_sessions/${sessionDocumentId("shared-session")}`;
  const authenticatedData = database.rows.get(rowKey)?.data;
  const authenticatedExpiry = Number(database.rows.get(rowKey)?.expiresAtMillis);

  await touchSession(first, "shared-session", staleAnonymousSession);

  assert.equal(database.rows.get(rowKey)?.data, authenticatedData);
  assert.ok(Number(database.rows.get(rowKey)?.expiresAtMillis) > authenticatedExpiry);
  assert.equal((await getSession(second, "shared-session") as any)?.isAdmin, true);
});

test("expired or corrupt session rows are removed", async () => {
  const database = new FakeFirestore();
  const store = new FirestoreSessionStore(database as never);
  const expiredId = sessionDocumentId("expired");
  database.rows.set(`server_sessions/${expiredId}`, {
    data: JSON.stringify({ cookie: {} }),
    expiresAtMillis: Date.now() - 1,
  });
  assert.equal(await getSession(store, "expired"), null);
  assert.equal(database.rows.has(`server_sessions/${expiredId}`), false);

  const corruptId = sessionDocumentId("corrupt");
  database.rows.set(`server_sessions/${corruptId}`, {
    data: "{not-json",
    expiresAtMillis: Date.now() + 60_000,
  });
  await assert.rejects(getSession(store, "corrupt"), SyntaxError);
  assert.equal(database.rows.has(`server_sessions/${corruptId}`), false);
});

test("stale cleanup never deletes a concurrently renewed session", async (t) => {
  for (const kind of ["expired", "corrupt"] as const) {
    await t.test(kind, async () => {
      const database = new FakeFirestore();
      const store = new FirestoreSessionStore(database as never);
      const sessionId = `renewed-${kind}`;
      const rowKey = `server_sessions/${sessionDocumentId(sessionId)}`;
      database.rows.set(rowKey, {
        data: kind === "expired"
          ? JSON.stringify({ cookie: {}, stale: true })
          : "{not-json",
        expiresAtMillis: kind === "expired"
          ? Date.now() - 1
          : Date.now() + 60_000,
        updatedAt: "old",
      });
      database.beforeTransaction = () => {
        database.rows.set(rowKey, {
          data: JSON.stringify({
            cookie: { maxAge: 60_000 },
            isAdmin: true,
          }),
          expiresAtMillis: Date.now() + 60_000,
          updatedAt: "renewed",
        });
      };

      if (kind === "expired") {
        assert.equal(await getSession(store, sessionId), null);
      } else {
        await assert.rejects(getSession(store, sessionId), SyntaxError);
      }
      assert.equal(database.rows.has(rowKey), true);
      assert.equal((await getSession(store, sessionId) as any)?.isAdmin, true);
    });
  }
});
