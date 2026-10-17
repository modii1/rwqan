import { randomUUID } from "node:crypto";
import { db } from "../config/firebase";
import { deployPersistenceProjectConfirmed } from "../config/deployEnvironment";
import {
  DEPLOY_AUDIT_HISTORY_LIMIT,
  DEPLOY_RELEASE_HISTORY_LIMIT,
  type DeployAuditEntry,
  type DeployCheckRun,
  type DeployEnvironment,
  type DeployRelease,
} from "../../shared/deploySystem";
import {
  buildReleaseRecord,
  DeployStoreUnavailableError,
  evaluateRestore,
  UnavailableDeploySystemStore,
  type CreateReleaseInput,
  type DeployRestoreOutcome,
  type DeploySystemStoreContract,
  type RecordAuditInput,
} from "./DeploySystemStore";

/**
 * RWQAN DEPLOY — durable DEV release registry (Phase C).
 *
 * Backed by the isolated DEV Firestore project (`rwqan-sa-dev`) through the
 * Admin SDK only; Firestore security rules deny all client access. This module
 * is imported by the server entrypoint (never by tests), and the factory below
 * fails closed: if the active project cannot be proven to be `rwqan-sa-dev`, or
 * the Firebase Admin SDK is unavailable, an `UnavailableDeploySystemStore` is
 * returned instead and every write is rejected.
 *
 * Collections:
 *   - `deploy_releases`       one doc per release (newest kept, max 5)
 *   - `deploy_audit_log`      append-only audit entries (max 50)
 *   - `deploy_system_state`   single doc `current` holding the environment
 *
 * No secrets are stored: only ids, timestamps, checks, Git provenance (already
 * sanitized of credentials), and free-text change summaries.
 */

type FirestoreDb = NonNullable<typeof db>;

const RELEASES_COLLECTION = "deploy_releases";
const AUDIT_COLLECTION = "deploy_audit_log";
const STATE_COLLECTION = "deploy_system_state";
const CHECK_RUNS_COLLECTION = "deploy_check_runs";
const STATE_DOC_ID = "current";
const CHECK_RUN_DOC_ID = "latest";
const TRIM_OVERSCAN = 5;

export class FirestoreDeploySystemStore implements DeploySystemStoreContract {
  constructor(private readonly firestore: FirestoreDb) {}

  isPersistent(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async getEnvironment(): Promise<DeployEnvironment> {
    try {
      const snapshot = await this.firestore
        .collection(STATE_COLLECTION)
        .doc(STATE_DOC_ID)
        .get();
      const value = snapshot.exists ? snapshot.get("environment") : undefined;
      return value === "LIVE" ? "LIVE" : "TEST";
    } catch {
      return "TEST";
    }
  }

  async setEnvironment(environment: DeployEnvironment): Promise<DeployEnvironment> {
    await this.firestore
      .collection(STATE_COLLECTION)
      .doc(STATE_DOC_ID)
      .set(
        { environment, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    return environment;
  }

  async listReleases(): Promise<DeployRelease[]> {
    const snapshot = await this.firestore
      .collection(RELEASES_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(DEPLOY_RELEASE_HISTORY_LIMIT)
      .get();
    return snapshot.docs
      .map((doc) => toRelease(doc.id, doc.data()))
      .filter((release): release is DeployRelease => release !== null);
  }

  async listAudit(): Promise<DeployAuditEntry[]> {
    const snapshot = await this.firestore
      .collection(AUDIT_COLLECTION)
      .orderBy("at", "desc")
      .limit(DEPLOY_AUDIT_HISTORY_LIMIT)
      .get();
    return snapshot.docs
      .map((doc) => toAudit(doc.data()))
      .filter((entry): entry is DeployAuditEntry => entry !== null);
  }

  async getRelease(releaseId: string): Promise<DeployRelease | undefined> {
    const doc = await this.firestore
      .collection(RELEASES_COLLECTION)
      .doc(releaseId)
      .get();
    if (!doc.exists) return undefined;
    return toRelease(doc.id, doc.data()) ?? undefined;
  }

  async recordAudit(input: RecordAuditInput): Promise<DeployAuditEntry> {
    const entry: DeployAuditEntry = {
      id: `audit-${randomUUID()}`,
      at: new Date().toISOString(),
      actor: "admin",
      action: input.action,
      environment: input.environment,
      result: input.result,
      ...(input.releaseId ? { releaseId: input.releaseId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    };
    await this.firestore.collection(AUDIT_COLLECTION).doc(entry.id).set(entry);
    await this.trim(AUDIT_COLLECTION, "at", DEPLOY_AUDIT_HISTORY_LIMIT);
    return entry;
  }

  async createRelease(input: CreateReleaseInput): Promise<DeployRelease> {
    const release = buildReleaseRecord(input);
    await this.firestore
      .collection(RELEASES_COLLECTION)
      .doc(release.releaseId)
      .set(release);
    await this.trim(RELEASES_COLLECTION, "createdAt", DEPLOY_RELEASE_HISTORY_LIMIT);
    return release;
  }

  async restoreRelease(releaseId: string): Promise<DeployRestoreOutcome> {
    return evaluateRestore(await this.getRelease(releaseId));
  }

  async recordCheckRun(run: DeployCheckRun): Promise<DeployCheckRun> {
    await this.firestore
      .collection(CHECK_RUNS_COLLECTION)
      .doc(CHECK_RUN_DOC_ID)
      .set(run);
    return run;
  }

  async getLatestCheckRun(): Promise<DeployCheckRun | null> {
    const doc = await this.firestore
      .collection(CHECK_RUNS_COLLECTION)
      .doc(CHECK_RUN_DOC_ID)
      .get();
    if (!doc.exists) return null;
    return toCheckRun(doc.data());
  }

  /** Keep only the newest `keep` documents, deleting the rest. */
  private async trim(
    collection: string,
    orderField: string,
    keep: number,
  ): Promise<void> {
    const snapshot = await this.firestore
      .collection(collection)
      .orderBy(orderField, "desc")
      .limit(keep + TRIM_OVERSCAN)
      .get();
    const stale = snapshot.docs.slice(keep);
    if (stale.length === 0) return;
    const batch = this.firestore.batch();
    for (const doc of stale) batch.delete(doc.ref);
    await batch.commit();
  }
}

function toRelease(id: string, data: Record<string, unknown> | undefined): DeployRelease | null {
  if (!data) return null;
  const checks = data.checks as DeployRelease["checks"] | undefined;
  if (
    typeof data.version !== "string" ||
    typeof data.createdAt !== "string" ||
    typeof data.gitCommit !== "string" ||
    !checks
  ) {
    return null;
  }
  return { ...(data as unknown as DeployRelease), releaseId: id };
}

function toCheckRun(
  data: Record<string, unknown> | undefined,
): DeployCheckRun | null {
  if (!data) return null;
  if (typeof data.ranAt !== "string" || !data.checks) return null;
  return data as unknown as DeployCheckRun;
}

function toAudit(data: Record<string, unknown> | undefined): DeployAuditEntry | null {
  if (!data) return null;
  if (typeof data.id !== "string" || typeof data.at !== "string" || typeof data.action !== "string") {
    return null;
  }
  return data as unknown as DeployAuditEntry;
}

/**
 * Fail-closed factory: only returns a durable store when the isolated DEV
 * project is positively confirmed AND the Admin SDK is available. Otherwise an
 * unavailable store is returned (reads empty, writes rejected).
 */
export function createFirestoreDeploySystemStore(): DeploySystemStoreContract {
  if (db && deployPersistenceProjectConfirmed()) {
    return new FirestoreDeploySystemStore(db);
  }
  return new UnavailableDeploySystemStore(
    "تعذّر تأكيد مشروع Firebase DEV (rwqan-sa-dev) أو أن Admin SDK غير متاح — أوقِفت الكتابة (فشل مغلق).",
  );
}

export { DeployStoreUnavailableError };
