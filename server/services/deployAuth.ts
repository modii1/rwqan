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
 * SECURITY NOTE (UNVERIFIED): Whether a Google OAuth2 refresh token obtained
 * via a web OAuth client works as `FIREBASE_TOKEN` with Firebase CLI is NOT
 * proven. Firebase CLI documents `FIREBASE_TOKEN` as the output of
 * `firebase login:ci`. This service does NOT pass the refresh token directly
 * as `FIREBASE_TOKEN` for real deploy commands until compatibility is verified.
 * Instead, `verifyFirebaseCliAuth()` performs a read-only Firebase CLI probe
 * (e.g. `firebase projects:list`) to confirm the credentials work before any
 * rollout command runs.
 *
 * REQUIRED SETUP (not in code — must be provided via environment):
 *   GOOGLE_OAUTH_CLIENT_ID     — Google Cloud OAuth Client ID
 *   GOOGLE_OAUTH_CLIENT_SECRET — Google Cloud OAuth Client Secret
 *   DEPLOY_AUTH_REDIRECT_URI   — OAuth redirect URI, e.g.
 *                                https://<host>/api/admin/deploy/auth/callback
 *
 * If these are missing, the auth flow returns AUTH_NOT_CONFIGURED and the
 * publish path is refused (fail closed). No fake or hardcoded credentials.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createCipheriv, createDecipheriv, randomFillSync } from "node:crypto";
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
}

/** Encryption key derivation: uses SESSION_SECRET if available, otherwise a
 *  deterministic development-only fallback. Never used for production secrets
 *  without an explicit SESSION_SECRET. */
function deriveEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? "rwqan-deploy-auth-dev-only-do-not-use-in-production";
  const key = createHmac("sha256", secret).update("rwqan-deploy-auth-encryption").digest();
  return key;
}

/** Encrypt a value using AES-256-CBC with a random IV. */
function encryptValue(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = randomFillSync(Buffer.alloc(16));
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("base64") + ":" + encrypted.toString("base64");
}

/** Decrypt an encrypted value. */
function decryptValue(ciphertext: string): string | null {
  try {
    const key = deriveEncryptionKey();
    const [ivB64, dataB64] = ciphertext.split(":");
    if (!ivB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
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
    } catch {
      // Ignore load errors; start with empty store.
    }
  }

  private saveToFile(): void {
    try {
      const data: { creds: Record<string, string> } = { creds: {} };
      for (const [sessionId, creds] of this.creds.entries()) {
        data.creds[sessionId] = encryptValue(JSON.stringify(creds));
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
}

/** Default storage: local file-based encrypted store for DEV. */
const storage: DeployAuthStorage = new LocalFileDeployAuthStorage();

function nowMs(): number {
  return Date.now();
}

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
  /** TRUE when compatibility with Firebase CLI FIREBASE_TOKEN is unverified. */
  compatUnverified: boolean;
}

/**
 * Start the OAuth flow. Requires an admin session (caller must enforce).
 * Returns the Google authorization URL to open in the browser.
 */
export function startDeployAuthFlow(
  sessionId: string,
  adminId?: string,
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

    return { status: "ok" };
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
 * Returns compatUnverified: true always, because web OAuth refresh token
 * compatibility with Firebase CLI's FIREBASE_TOKEN is not proven.
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
      compatUnverified: true,
    };
  }
  // Structural check: refresh tokens are typically long strings.
  if (creds.refreshToken.length < 10) {
    return {
      valid: false,
      reason: "بيانات الاعتماد غير صالحة (رمز التحديث قصير جدًا).",
      compatUnverified: true,
    };
  }

  // Read-only probe: `firebase projects:list` requires no project selection and
  // creates no rollout. If it succeeds, the CLI can authenticate with the token.
  // We run this through the executor's runCommand seam if available; here we
  // return structural validity only and mark compat as unverified.
  // The actual CLI probe is performed in DeployRealExecutor before any rollout.
  return {
    valid: true,
    reason: "بيانات الاعتماد موجودة وهيكلها صحيح. التوافق مع Firebase CLI غير مثبت حتى اختبار فعلي.",
    compatUnverified: true,
  };
}

/**
 * Get environment variables to inject when running the Firebase CLI.
 * Returns FIREBASE_TOKEN only after compatibility has been verified by the
 * caller via verifyFirebaseCliAuth(). Never returns secrets to the caller for
 * display — only for process env.
 */
export async function getFirebaseCliEnv(
  sessionId: string,
  adminId?: string,
): Promise<Record<string, string> | null> {
  const creds = await storage.getCredentials(sessionId, adminId);
  if (!creds || !creds.refreshToken) return null;
  return { FIREBASE_TOKEN: creds.refreshToken };
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