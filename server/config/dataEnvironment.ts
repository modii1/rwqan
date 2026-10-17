/**
 * RWQAN — active data-environment resolver (Firestore).
 *
 * This is the SINGLE seam that makes the whole DEV application switch its data
 * source between TEST and LIVE. Every data access that used to hard-code the DEV
 * Firestore now resolves through here:
 *
 *   TEST -> the isolated DEV project (rwqan-sa-dev).
 *   LIVE -> a DEDICATED production connection built from the `LIVE_*` variables
 *           in `liveDataEnvironment.ts`.
 *
 * Safety:
 *   - The active environment is read from `dataEnvironmentStore` on every call.
 *   - LIVE fails CLOSED: if LIVE is selected but no safe production configuration
 *     exists, the resolver throws instead of silently falling back to DEV.
 *   - LIVE defaults to READ-ONLY: writes, updates, deletes, batches, and
 *     transactions are rejected in-process unless `LIVE_WRITE_MODE=enabled`.
 *   - Nothing here stores or exposes secrets.
 *
 * The image store (R2) is switched by the same toggle via the live bindings in
 * `server/utils/r2.ts` (see `syncR2Environment`).
 */
import type { Firestore } from "firebase-admin/firestore";
import admin from "firebase-admin";
import {
  getDevFirestore,
  getOrCreateLiveFirestore,
  releaseLiveFirestore,
} from "./firebase";
import {
  dataEnvironmentStore,
  type DataEnvironmentStore,
} from "../services/LiveDataEnvironmentStore";
import { readLiveDataConfig, liveWriteEnabled } from "./liveDataEnvironment";
import { getFirebaseProjectId } from "./runtimeEnvironment";
import type { DataEnvironment } from "../../shared/liveData";

export class LiveDataSourceError extends Error {
  code = "LIVE_DATA_UNAVAILABLE";
  constructor(
    message = "تعذّر تأكيد اتصال آمن بمشروع الإنتاج — أُوقف الوصول (فشل مغلق).",
  ) {
    super(message);
    this.name = "LiveDataSourceError";
  }
}

export class LiveWriteBlockedError extends Error {
  code = "LIVE_WRITE_BLOCKED";
  constructor(
    message = "وضع الإنتاج للقراءة فقط: الكتابة والتعديل والحذف محظورة. لتمكين الكتابة اضبط LIVE_WRITE_MODE=enabled.",
  ) {
    super(message);
    this.name = "LiveWriteBlockedError";
  }
}

export function getActiveDataEnvironment(): DataEnvironment {
  return dataEnvironmentStore.get();
}

/**
 * The ACTUAL project id backing the active data source, read from the live
 * Firebase app / configuration. This is the runtime proof of which project the
 * server is really reading (never a secret). Returns NULL only when unknown.
 */
export function getActiveFirestoreProjectId(
  store: DataEnvironmentStore = dataEnvironmentStore,
): string | null {
  if (store.get() === "LIVE") {
    const { config } = readLiveDataConfig(process.env);
    return config?.firebase.projectId ?? null;
  }
  try {
    const app = admin.app();
    const projectId = (app?.options as { projectId?: unknown } | undefined)
      ?.projectId;
    if (typeof projectId === "string" && projectId) return projectId;
  } catch {
    // No default app — fall through to the configured project id.
  }
  return getFirebaseProjectId(process.env);
}

// ── Firestore resolution ────────────────────────────────────────────────────

let cachedLive: { projectId: string; firestore: Firestore } | null = null;
let cachedReadOnlyFirestore: Firestore | null = null;
let injectedDevFirestore: Firestore | null | undefined;

/** Test seam: override the DEV Firestore used in TEST mode. */
export function setDevFirestoreForTests(firestore: Firestore | null): void {
  injectedDevFirestore = firestore;
}

function resolveLiveFirestore(): Firestore | null {
  const { config } = readLiveDataConfig(process.env);
  if (!config) return null;
  if (!cachedLive || cachedLive.projectId !== config.firebase.projectId) {
    try {
      const firestore = getOrCreateLiveFirestore(
        config.firebase.serviceAccount,
      ) as unknown as Firestore;
      cachedLive = { projectId: config.firebase.projectId, firestore };
    } catch (error) {
      throw new LiveDataSourceError();
    }
  }
  return cachedLive.firestore;
}

export function getActiveFirestore(): Firestore {
  if (dataEnvironmentStore.get() === "LIVE") {
    const live = resolveLiveFirestore();
    if (!live) {
      throw new LiveDataSourceError();
    }
    if (liveWriteEnabled()) return live;
    if (!cachedReadOnlyFirestore) {
      cachedReadOnlyFirestore = wrapReadOnlyFirestore(live);
    }
    return cachedReadOnlyFirestore;
  }

  const dev =
    injectedDevFirestore !== undefined
      ? injectedDevFirestore
      : (getDevFirestore() as Firestore | null);
  if (!dev) throw new Error("Firebase not initialized");
  return dev as unknown as Firestore;
}

/**
 * A stable, environment-aware Firestore handle. Existing modules that imported
 * the DEV `db` import this instead and keep calling it unchanged; every property
 * access resolves the ACTIVE environment on demand, so a single toggle switches
 * the whole app between TEST and LIVE.
 */
export const activeFirestore: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    const firestore = getActiveFirestore();
    const value = Reflect.get(firestore as unknown as object, prop, firestore);
    return typeof value === "function" ? value.bind(firestore) : value;
  },
});

// ── Read-only write guard (LIVE, default) ───────────────────────────────────

function blockedWrite(): never {
  throw new LiveWriteBlockedError();
}

const WRITE_METHODS = new Set(["set", "update", "delete", "create"]);

function guardWriteMethods<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
        return () => blockedWrite();
      }
      return value.bind(obj);
    },
  });
}

function wrapCollection(coll: any): any {
  return new Proxy(coll, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "add") return () => blockedWrite();
      if (prop === "doc") return (id?: string) => wrapDoc(target.doc(id));
      return value.bind(target);
    },
  });
}

function wrapDoc(doc: any): any {
  return guardWriteMethods(doc);
}

function wrapReadOnlyFirestore(fs: Firestore): Firestore {
  return new Proxy(fs, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      switch (prop) {
        case "collection":
          return (name: string) => wrapCollection((target as any).collection(name));
        case "doc":
          return (path: string) => wrapDoc((target as any).doc(path));
        case "collectionGroup":
          return (id: string) =>
            wrapCollection((target as any).collectionGroup(id));
        case "batch":
          return () => guardWriteMethods((target as any).batch());
        case "bulkWriter":
          return () => guardWriteMethods((target as any).bulkWriter());
        case "runTransaction":
          return (fn: (tx: any) => unknown, options?: unknown) =>
            (target as any).runTransaction(
              (tx: any) => fn(guardWriteMethods(tx)),
              options,
            );
        default:
          return value.bind(target);
      }
    },
  });
}

// ── Test helpers ────────────────────────────────────────────────────────────

export function resetDataEnvironmentForTests(): void {
  cachedLive = null;
  cachedReadOnlyFirestore = null;
  injectedDevFirestore = undefined;
  void releaseLiveFirestore();
}
