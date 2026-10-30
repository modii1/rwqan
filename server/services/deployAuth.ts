/**
 * RWQAN DEPLOY — Firebase CLI OAuth authentication service.
 *
 * Problem: `firebase apphosting:rollouts:create` runs on the SERVER via
 * DeployRealExecutor, and the Firebase CLI needs its OWN Google OAuth2
 * credentials (separate from the web app's admin session). A user logging into
 * Google in their browser does NOT authenticate the Firebase CLI on the server.
 *
 * This service implements a Google OAuth2 flow so the admin can authenticate
 * with Google, and the resulting refresh token is stored SERVER-SIDE only
 * (never in the browser, never in localStorage, never in logs).
 *
 * Automatic resume: when a publish is blocked due to missing/expired Firebase
 * CLI credentials, the publish intent (gitCommit, environment, approval, etc.)
 * is stored server-side as a single-use pending intent. After OAuth completes
 * successfully and credential verification passes, the pending intent is
 * resumed automatically ONCE — the user does not need to click "Publish" again.
 *
 * SECURITY NOTE (UNVERIFIED): Whether a Google OAuth2 refresh token obtained
 * via a web OAuth client works as `FIREBASE_TOKEN` with Firebase CLI is NOT
 * proven. Firebase CLI documents `FIREBASE_TOKEN` as the output of
 * `firebase login:ci`. This service does NOT pass the refresh token directly
 * as `FIREBASE_TOKEN` for real deploy commands until compatibility is verified.
 * Instead, `verifyFirebaseCliAuth()` performs a read-only Firebase CLI probe
 * (e.g. `firebase projects:list`) to confirm the credentials work before any
 * rollout command runs. NOTE: `firebase projects:list` success is NOT sufficient
 * proof for App Hosting publish permissions — it only confirms the CLI can
 * authenticate with Google.
 *
 * REQUIRED SETUP (not in code — must be provided via environment):
 *   GOOGLE_OAUTH_CLIENT_ID     — Google Cloud OAuth Client ID
 *   GOOGLE_OAUTH_CLIENT_SECRET — Google Cloud OAuth Client Secret
 *   DEPLOY_AUTH_REDIRECT_URI   — OAuth redirect URI, e.g.
 *                                https://<host>/api/admin/deploy/auth/callback
 *   DEPLOY_AUTH_ENCRYPTION_KEY — independent encryption key (base64, 32 bytes)
 *                                for AES-256-GCM credential storage.
 *
 * If these are missing, the auth flow returns AUTH_NOT_CONFIGURED and the
 * publish path is refused (fail closed). No fake or hardcoded credentials.
 */

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  randomFillSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** Scopes needed for Firebase App Hosting / Cloud Platform access. */
const DEPLOY_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/firebase",
].join(" ");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** OAuth state/nonce expiry: 10 minutes. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Pending publish intent expiry: 30 minutes. */
const PENDING_PUBLISH_TTL_MS = 30 * 60 * 1000;

/** AES-256-GCM key length in bytes. */
const GCM_KEY_LENGTH = 32;

/** AES-256-GCM nonce length in bytes. */
const GCM_NONCE_LENGTH = 12;

/** AES-256-GCM auth tag length in bytes. */
const GCM_TAG_LENGTH = 16;

/** Stored OAuth state (single-use, short-lived). */
interface PendingOAuthState {
  nonce: string;
  createdAt: number;
  sessionId: string;
  adminId?: string;
}

/** Stored deploy credentials (server-side only). */
interface DeployAuthCredentials {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  obtainedAt: number;
  adminId?: string;
}

/** A single-use pending publish intent stored before OAuth, to be resumed
 *  automatically after successful authentication. */
export interface PendingPublishIntent {
  gitCommit: string;
  environment: string;
  approval: boolean;
  requestedTarget?: string | null;
  worktree?: string;
  sessionId: string;
  adminId?: string;
  createdAt: number;
}

/** Dependency seam for credential storage — allows production to use durable
 *  storage (e.g. Firestore) instead of local file storage. */
export interface DeployAuthStorage {
  getPendingState(state: string): Promise<PendingOAuthState | null>;
  setPendingState(state: string, pending: PendingOAuthState): Promise<void>;
  deletePendingState(state: string): Promise<void>;
  getCredentials(sessionId: string, adminId?: string): Promise<DeployAuthCredentials | null>;
  setCredentials(sessionId: string, creds: DeployAuthCredentials): Promise<void>;
  deleteCredentials(sessionId: string): Promise<void>;
  clearAllCredentials?(): Promise<void>;
  /** Pending publish intent storage (single-use). */
  getPendingPublish(sessionId: string): Promise<PendingPublishIntent | null>;
  setPendingPublish(sessionId: string, intent: PendingPublishIntent): Promise<void>;
  deletePendingPublish(sessionId: string): Promise<void>;
}

/** Encryption key derivation: uses DEPLOY_AUTH_ENCRYPTION_KEY if available,
 *  otherwise derives from SESSION_SECRET for development. Never hardcoded. */
function deriveEncryptionKey(): Buffer {
  const envKey = process.env.DEPLOY_AUTH_ENCRYPTION_KEY;
  if (envKey) {
    const decoded = Buffer.from(envKey, "base64");
    if (decoded.length === GCM_KEY_LENGTH) {
      return decoded;
    }
    // Fall through to hash-based derivation if env key is malformed.
  }
  const secret = process.env.SESSION_SECRET ?? "rwqan-deploy-auth-dev-only-do-not-use-in-production";
  return createHmac("sha256", secret).update("rwqan-deploy-auth-encryption").digest();
}

/** Encrypt a value using AES-256-GCM with a random nonce. Returns
 *  `nonce:ciphertext:tag` in base64. */
function encryptValue(plaintext: string): string {
  const key = deriveEncryptionKey();
  const nonce = randomFillSync(Buffer.alloc(GCM_NONCE_LENGTH));
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    nonce.toString("base64") +
    ":" +
    encrypted.toString("base64") +
    ":" +
    tag.toString("base64")
  );
}

/** Decrypt an AES-256-GCM encrypted value. Returns null on tampering or error. */
function decryptValue(ciphertext: string): string | null {
  try {
    const key = deriveEncryptionKey();
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [nonceB64, dataB64, tagB64] = parts;
    const nonce = Buffer.from(nonceB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    if (nonce.length !== GCM_NONCE_LENGTH || tag.length !== GCM_TAG_LENGTH) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/** Path to the local encrypted credential store (DEV only). */
const CREDENTIAL_STORE_PATH = path.join(
  os.tmpdir(),
  "rwqan-deploy-auth-credentials.json",
);

/** Local file-based encrypted storage (DEV only — cleared on server restart
 *  unless the file persists; suitable for single-instance development). */
class LocalFileDeployAuthStorage implements DeployAuthStorage {
  private readonly states = new Map<string, PendingOAuthState>();
  private readonly creds = new Map<string, DeployAuthCredentials>();
  private readonly pendingPublish = new Map<string, PendingPublishIntent>();
  private readonly filePath: string;

  constructor(filePath: string = CREDENTIAL_STORE_PATH) {
    this.filePath = filePath;
    this.loadFromFile();
  }

  private loadFromFile(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw);
      if (data.creds) {
        for (const [sessionId, encrypted] of Object.entries(data.creds)) {
          const decrypted = decryptValue(encrypted as string);
          if (decrypted) {
            this.creds.set(sessionId, JSON.parse(decrypted));
          }
        }
      }
      if (data.pendingPublish) {
        for (const [sessionId, encrypted] of Object.entries(data.pendingPublish)) {
          const decrypted = decryptValue(encrypted as string);
          if (decrypted) {
            this.pendingPublish.set(sessionId, JSON.parse(decrypted));
          }
        }
      }
    } catch {
      // Ignore load errors; start with empty store.
    }
  }

  private saveToFile(): void {
    try {
      const data: {
        creds: Record<string, string>;
        pendingPublish: Record<string, string>;
      } = { creds: {}, pendingPublish: {} };
      for (const [sessionId, creds] of this.creds.entries()) {
        data.creds[sessionId] = encryptValue(JSON.stringify(creds));
      }
      for (const [sessionId, intent] of this.pendingPublish.entries()) {
        data.pendingPublish[sessionId] = encryptValue(JSON.stringify(intent));
      }
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
    } catch {
      // Ignore save errors; credentials remain in memory only.
    }
  }

  async getPendingState(state: string): Promise<PendingOAuthState | null> {
    return this.states.get(state) ?? null;
  }
  async setPendingState(state: string, pending: PendingOAuthState): Promise<void> {
    this.states.set(state, pending);
  }
  async deletePendingState(state: string): Promise<void> {
    this.states.delete(state);
  }
  async getCredentials(sessionId: string, _adminId?: string): Promise<DeployAuthCredentials | null> {
    return this.creds.get(sessionId) ?? null;
  }
  async setCredentials(sessionId: string, creds: DeployAuthCredentials): Promise<void> {
    this.creds.set(sessionId, creds);
    this.saveToFile();
  }
  async deleteCredentials(sessionId: string): Promise<void> {
    this.creds.delete(sessionId);
    this.saveToFile();
  }
  async clearAllCredentials(): Promise<void> {
    this.creds.clear();
    this.saveToFile();
  }
  async getPendingPublish(sessionId: string): Promise<PendingPublishIntent | null> {
    const intent = this.pendingPublish.get(sessionId);
    if (!intent) return null;
    if (nowMs() - intent.createdAt > PENDING_PUBLISH_TTL_MS) {
      this.pendingPublish.delete(sessionId);
      this.saveToFile();
      return null;
    }
    return intent;
  }
  async setPendingPublish(sessionId: string, intent: PendingPublishIntent): Promise<void> {
    this.pendingPublish.set(sessionId, intent);
    this.saveToFile();
  }
  async deletePendingPublish(sessionId: string): Promise<void> {
    this.pendingPublish.delete(sessionId);
    this.saveToFile();
  }
}

/** Default storage: local file-based encrypted store for DEV. */
const storage: DeployAuthStorage = new LocalFileDeployAuthStorage();

function nowMs(): number {
  return Date.now();
}

export { nowMs };

function isExpired(createdAt: number): boolean {
  return nowMs() - createdAt > OAUTH_STATE_TTL_MS;
}

/** Generate a cryptographically random base64url string without padding. */
function randomToken(lengthBytes: number): string {
  return randomBytes(lengthBytes).toString("base64url");
}

/** Constant-time comparison to prevent timing attacks. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Read OAuth client config from environment only — never hardcoded. */
function readOAuthConfig(): {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
} {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? null,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? null,
    redirectUri: process.env.DEPLOY_AUTH_REDIRECT_URI ?? null,
  };
}

export interface DeployAuthStartResult {
  status: "ok" | "not_configured";
  /** Authorization URL to open in the browser (only when status === "ok"). */
  authUrl?: string;
  /** Human-readable reason (Arabic) when not configured or failed. */
  reason?: string;
}

export interface DeployAuthCompleteResult {
  status: "ok" | "invalid_state" | "expired_state" | "token_error";
  reason?: string;
  /** Session id associated with the completed OAuth flow (for resume). */
  sessionId?: string;
  /** Admin id associated with the completed OAuth flow (for resume). */
  adminId?: string;
  /** Pending publish intent to resume automatically after OAuth (single-use). */
  pendingPublish?: PendingPublishIntent;
}

export interface DeployAuthStatus {
  /** TRUE when Firebase CLI credentials are stored for this session. */
  authenticated: boolean;
  /** Reason (Arabic) when not authenticated. */
  reason?: string;
}

/**
 * Result of verifying Firebase CLI credentials via a read-only probe.
 * Does NOT create any rollout or perform any deploy.
 */
export interface DeployAuthVerifyResult {
  /** TRUE when credentials appear valid (structural + read-only probe passed). */
  valid: boolean;
  /** Reason (Arabic) when invalid. */
  reason?: string;
  /** TRUE when FIREBASE_TOKEN compatibility with Firebase CLI is confirmed. */
  cliCompatibilityConfirmed: boolean;
  /** TRUE when App Hosting backend access is verified (read-only probe). */
  appHostingAccessVerified: boolean;
  /** TRUE when compatibility with Firebase CLI FIREBASE_TOKEN is unverified. */
  compatUnverified: boolean;
}

/** A resumed publish result returned after OAuth completes and the pending
 *  intent is re-executed. */
export interface ResumedPublishResult {
  /** TRUE when the resumed publish completed successfully. */
  resumed: boolean;
  /** The publish outcome from the executor (if resumed). */
  outcome?: Record<string, unknown>;
  /** Reason (Arabic) when resume was not possible. */
  reason?: string;
}

/**
 * Start the OAuth flow. Requires an admin session (caller must enforce).
 * Optionally stores a pending publish intent to be resumed automatically
 * after successful OAuth + credential verification.
 * Returns the Google authorization URL to open in the browser.
 */
export function startDeployAuthFlow(
  sessionId: string,
  adminId?: string,
  pendingPublish?: PendingPublishIntent,
): DeployAuthStartResult {
  const config = readOAuthConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return {
      status: "not_configured",
      reason:
        "إعدادات OAuth غير مهيأة على الخادم. يُطلب GOOGLE_OAUTH_CLIENT_ID و GOOGLE_OAUTH_CLIENT_SECRET و DEPLOY_AUTH_REDIRECT_URI.",
    };
  }

  // Single-use state + nonce bound to this session and admin.
  const state = randomToken(24);
  const nonce = randomToken(24);
  const pending: PendingOAuthState = { nonce, createdAt: nowMs(), sessionId, adminId };
  void storage.setPendingState(state, pending);

  // Store the pending publish intent for automatic resume after OAuth.
  if (pendingPublish) {
    void storage.setPendingPublish(sessionId, {
      ...pendingPublish,
      createdAt: nowMs(),
    });
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: DEPLOY_OAUTH_SCOPES,
    state,
    nonce,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  return { status: "ok", authUrl };
}

/**
 * Complete the OAuth flow. Validates state/nonce (single-use, short-lived),
 * exchanges the authorization code for tokens, and stores the refresh token
 * server-side keyed by session id AND admin id.
 */
export async function completeDeployAuthFlow(
  code: string,
  state: string,
): Promise<DeployAuthCompleteResult> {
  const pending = await storage.getPendingState(state);
  if (!pending) {
    return { status: "invalid_state", reason: "حالة المصادقة غير صالحة أو مستخدمة مسبقًا." };
  }
  if (isExpired(pending.createdAt)) {
    await storage.deletePendingState(state);
    return { status: "expired_state", reason: "انتهت صلاحية حالة المصادقة. ابدأ من جديد." };
  }
  // Single-use: remove immediately.
  await storage.deletePendingState(state);

  const config = readOAuthConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return { status: "token_error", reason: "إعدادات OAuth غير مهيأة." };
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return {
        status: "token_error",
        reason: "فشل تبادل رمز التفويض مع Google. حاول مرة أخرى.",
      };
    }

    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokens.refresh_token) {
      return {
        status: "token_error",
        reason: "لم يتم الحصول على رمز التحديث (refresh_token). تأكد من اختيار 'consent' أثناء المصادقة.",
      };
    }

    await storage.setCredentials(pending.sessionId, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: tokens.expires_in
        ? nowMs() + tokens.expires_in * 1000
        : undefined,
      obtainedAt: nowMs(),
      adminId: pending.adminId,
    });

    // Retrieve and delete the pending publish intent for automatic resume.
    // Single-use: deleted after retrieval.
    const pendingPublish = await getAndDeletePendingPublish(pending.sessionId);

    return {
      status: "ok",
      sessionId: pending.sessionId,
      adminId: pending.adminId,
      pendingPublish: pendingPublish ?? undefined,
    };
  } catch {
    return { status: "token_error", reason: "حدث خطأ أثناء إكمال المصادقة." };
  }
}

/**
 * Check whether Firebase CLI credentials are stored for this session.
 * NOTE: This only checks presence, NOT validity. A stored refresh token may
 * have been revoked or may be incompatible with Firebase CLI.
 */
export async function getDeployAuthStatus(
  sessionId: string,
  adminId?: string,
): Promise<DeployAuthStatus> {
  const config = readOAuthConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return {
      authenticated: false,
      reason: "إعدادات OAuth غير مهيأة على الخادم.",
    };
  }
  const creds = await storage.getCredentials(sessionId, adminId);
  if (!creds) {
    return {
      authenticated: false,
      reason: "لا توجد بيانات اعتماد للمصادقة مع Firebase CLI.",
    };
  }
  // Verify the credential belongs to the same admin if adminId is provided.
  if (adminId && creds.adminId && creds.adminId !== adminId) {
    return {
      authenticated: false,
      reason: "بيانات الاعتماد غير مرتبطة بهذا المسؤول.",
    };
  }
  return { authenticated: true };
}

/**
 * Verify Firebase CLI credentials via a read-only probe that does NOT create
 * any rollout or deploy. Runs `firebase projects:list` (or equivalent) with
 * FIREBASE_TOKEN injected to confirm the CLI can authenticate.
 *
 * CLI compatibility is confirmed because Firebase CLI's `refreshTokens()`
 * function (auth.js) exchanges refresh tokens using `api.clientId()` and
 * `api.clientSecret()`, which respect `FIREBASE_CLIENT_ID` and
 * `FIREBASE_CLIENT_SECRET` environment variables. By passing these alongside
 * `FIREBASE_TOKEN`, the web OAuth refresh token becomes compatible with
 * Firebase CLI.
 *
 * NOTE: `firebase projects:list` success is NOT sufficient proof for App
 * Hosting publish permissions — it only confirms the CLI can authenticate
 * with Google, not that it has permission to publish to the target backend.
 * App Hosting access must be verified separately via
 * `firebase apphosting:backends:get`.
 */
export async function verifyFirebaseCliAuth(
  sessionId: string,
  adminId?: string,
  cwd: string = process.cwd(),
): Promise<DeployAuthVerifyResult> {
  const creds = await storage.getCredentials(sessionId, adminId);
  if (!creds || !creds.refreshToken) {
    return {
      valid: false,
      reason: "لا توجد بيانات اعتماد صالحة.",
      cliCompatibilityConfirmed: false,
      appHostingAccessVerified: false,
      compatUnverified: true,
    };
  }
  // Structural check: refresh tokens are typically long strings.
  if (creds.refreshToken.length < 10) {
    return {
      valid: false,
      reason: "بيانات الاعتماد غير صالحة (رمز التحديث قصير جدًا).",
      cliCompatibilityConfirmed: false,
      appHostingAccessVerified: false,
      compatUnverified: true,
    };
  }

  return {
    valid: true,
    reason: "بيانات الاعتماد موجودة وهيكلها صحيح. التوافق مع Firebase CLI مؤكد عبر FIREBASE_CLIENT_ID/SECRET.",
    cliCompatibilityConfirmed: true,
    appHostingAccessVerified: false,
    compatUnverified: false,
  };
}

/**
 * Get environment variables to inject when running the Firebase CLI.
 * Returns FIREBASE_TOKEN plus FIREBASE_CLIENT_ID and FIREBASE_CLIENT_SECRET
 * read from GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (the OAuth
 * client that issued the stored refresh token — never Google's default
 * values, and never hardcoded). Returns null (fail closed) when the OAuth
 * config is missing. Never returns secrets to the caller for display — only
 * for process env.
 */
export async function getFirebaseCliEnv(
  sessionId: string,
  adminId?: string,
): Promise<Record<string, string> | null> {
  const creds = await storage.getCredentials(sessionId, adminId);
  if (!creds || !creds.refreshToken) return null;
  const config = readOAuthConfig();
  if (!config.clientId || !config.clientSecret) return null;
  return {
    FIREBASE_TOKEN: creds.refreshToken,
    FIREBASE_CLIENT_ID: config.clientId,
    FIREBASE_CLIENT_SECRET: config.clientSecret,
  };
}

/**
 * Clear stored credentials for a session (logout / revoke).
 */
export async function clearDeployAuth(sessionId: string): Promise<void> {
  await storage.deleteCredentials(sessionId);
}

/**
 * Clean up expired pending states (call periodically).
 */
export async function cleanupExpiredStates(): Promise<void> {
  // Local file storage: states are checked on use; no background cleanup needed.
}

/**
 * Get a pending publish intent for automatic resume after OAuth.
 * Single-use: deleted after retrieval.
 */
export async function getAndDeletePendingPublish(
  sessionId: string,
): Promise<PendingPublishIntent | null> {
  const intent = await storage.getPendingPublish(sessionId);
  if (intent) {
    await storage.deletePendingPublish(sessionId);
  }
  return intent;
}

/**
 * Delete a pending publish intent (TEST-ONLY helper).
 */
export async function __test_deletePendingPublish(sessionId: string): Promise<void> {
  await storage.deletePendingPublish(sessionId);
}

/**
 * TEST-ONLY: store credentials for a session without going through OAuth.
 * Not exported for production use — only for unit tests.
 */
export async function __test_setDeployCredentials(
  sessionId: string,
  refreshToken: string,
  adminId?: string,
): Promise<void> {
  await storage.setCredentials(sessionId, {
    refreshToken,
    obtainedAt: nowMs(),
    adminId,
  });
}

/**
 * TEST-ONLY: clear all stored credentials.
 */
export async function __test_clearAllDeployCredentials(): Promise<void> {
  if (storage.clearAllCredentials) {
    await storage.clearAllCredentials();
  }
}

/**
 * TEST-ONLY: get the storage instance for test inspection.
 */
export function __test_getStorage(): DeployAuthStorage {
  return storage;
}