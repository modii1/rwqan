import { createHash } from "node:crypto";
import session, { type SessionData } from "express-session";
import type {
  DocumentReference,
  Firestore,
} from "firebase-admin/firestore";

const DEFAULT_COLLECTION = "server_sessions";
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

type StoreCallback = (error?: unknown) => void;
type GetCallback = (error: unknown, session?: SessionData | null) => void;

type StoredSession = {
  data: string;
  expiresAtMillis: number;
};

function hasUsableSessionMetadata(
  stored: Partial<StoredSession> | undefined,
  now: number,
): stored is StoredSession {
  const expiresAtMillis = Number(stored?.expiresAtMillis);
  return Boolean(stored?.data) &&
    Number.isFinite(expiresAtMillis) &&
    expiresAtMillis > now;
}

function hasParseableSessionData(
  stored: Partial<StoredSession> | undefined,
): boolean {
  if (!stored?.data) return false;
  try {
    JSON.parse(stored.data);
    return true;
  } catch {
    return false;
  }
}

export function sessionDocumentId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function sessionExpiryMillis(
  value: SessionData,
  now = Date.now(),
): number {
  const expires = value.cookie?.expires
    ? new Date(value.cookie.expires).getTime()
    : Number.NaN;
  if (Number.isFinite(expires) && expires > now) return expires;

  const maxAge = Number(value.cookie?.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) return now + maxAge;

  return now + DEFAULT_MAX_AGE_MS;
}

/**
 * Shared Express session store for horizontally scaled production instances.
 * Session ids are hashed before becoming document ids, and Firestore TTL
 * removes abandoned rows after their cookie expiry.
 */
export class FirestoreSessionStore extends session.Store {
  constructor(
    private readonly database: Firestore,
    private readonly collectionName = DEFAULT_COLLECTION,
  ) {
    super();
  }

  private async deleteIfStillInvalid(
    reference: DocumentReference,
    invalid: (
      stored: Partial<StoredSession> | undefined,
      now: number,
    ) => boolean,
  ): Promise<void> {
    await this.database.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(reference);
      if (!currentSnapshot.exists) return;
      const current = currentSnapshot.data() as Partial<StoredSession> | undefined;
      if (invalid(current, Date.now())) transaction.delete(reference);
    });
  }

  override get(sessionId: string, callback: GetCallback): void {
    const ref = this.database
      .collection(this.collectionName)
      .doc(sessionDocumentId(sessionId));
    ref.get()
      .then(async (snapshot) => {
        if (!snapshot.exists) {
          callback(null, null);
          return;
        }
        const stored = snapshot.data() as Partial<StoredSession> | undefined;
        if (!hasUsableSessionMetadata(stored, Date.now())) {
          await this.deleteIfStillInvalid(
            ref,
            (current, now) => !hasUsableSessionMetadata(current, now),
          ).catch(() => undefined);
          callback(null, null);
          return;
        }
        try {
          callback(null, JSON.parse(stored.data) as SessionData);
        } catch (error) {
          await this.deleteIfStillInvalid(
            ref,
            (current) => !hasParseableSessionData(current),
          ).catch(() => undefined);
          callback(error);
        }
      })
      .catch((error) => callback(error));
  }

  override set(
    sessionId: string,
    value: SessionData,
    callback: StoreCallback = () => undefined,
  ): void {
    const expiresAtMillis = sessionExpiryMillis(value);
    this.database
      .collection(this.collectionName)
      .doc(sessionDocumentId(sessionId))
      .set({
        data: JSON.stringify(value),
        expiresAtMillis,
        expiresAtTtl: new Date(expiresAtMillis),
        updatedAt: new Date().toISOString(),
      })
      .then(() => callback())
      .catch((error) => callback(error));
  }

  override destroy(
    sessionId: string,
    callback: StoreCallback = () => undefined,
  ): void {
    this.database
      .collection(this.collectionName)
      .doc(sessionDocumentId(sessionId))
      .delete()
      .then(() => callback())
      .catch((error) => callback(error));
  }

  override touch(
    sessionId: string,
    value: SessionData,
    callback: StoreCallback = () => undefined,
  ): void {
    const expiresAtMillis = sessionExpiryMillis(value);
    this.database
      .collection(this.collectionName)
      .doc(sessionDocumentId(sessionId))
      .update({
        // `value` belongs to the request that is finishing. Another request
        // may have authenticated this same session since it was loaded, so a
        // touch must never write the stale serialized payload back over it.
        expiresAtMillis,
        expiresAtTtl: new Date(expiresAtMillis),
        updatedAt: new Date().toISOString(),
      })
      .then(() => callback())
      .catch((error: { code?: number | string }) => {
        // A concurrent logout may remove the row before Express performs its
        // final touch. Treat that as a completed touch without recreating it.
        if (error?.code === 5 || error?.code === "not-found") {
          callback();
          return;
        }
        callback(error);
      });
  }
}
