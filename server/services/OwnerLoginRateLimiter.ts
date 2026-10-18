import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { activeFirestore as db } from "../config/dataEnvironment";
import { AdminLoginRateLimiter } from "./AdminLoginRateLimiter";

export const OWNER_LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const OWNER_LOGIN_MAX_ATTEMPTS_PER_PROPERTY = 5;
export const OWNER_LOGIN_MAX_ATTEMPTS_PER_IP = 20;

const IP_DOMAIN = "rwqan.owner-legacy-login.ip.v1\0";
const PROPERTY_DOMAIN = "rwqan.owner-legacy-login.property.v1\0";
const COLLECTION = "owner_login_attempt_limits";

export type OwnerLoginLimitResult =
  | { allowed: true; retryAfterMs: 0 }
  | { allowed: false; retryAfterMs: number };

export interface OwnerLoginLimitStore {
  consume(input: {
    ipSubject: string;
    propertySubject: string;
    now: number;
    windowMs: number;
    maxAttemptsPerIp: number;
    maxAttemptsPerProperty: number;
  }): Promise<OwnerLoginLimitResult>;
  clear(input: { ipSubject: string; propertySubject: string }): Promise<void>;
}

class FirestoreOwnerLoginLimitStore implements OwnerLoginLimitStore {
  async consume(input: {
    ipSubject: string;
    propertySubject: string;
    now: number;
    windowMs: number;
    maxAttemptsPerIp: number;
    maxAttemptsPerProperty: number;
  }): Promise<OwnerLoginLimitResult> {
    if (!db) throw new Error("Firebase not initialized");
    const collection = db.collection(COLLECTION);
    const ipRef = collection.doc(`ip-${input.ipSubject}`);
    const propertyRef = collection.doc(`property-${input.propertySubject}`);
    return db.runTransaction(async (transaction) => {
      const [ipSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(ipRef),
        transaction.get(propertyRef),
      ]);
      const read = (
        value: FirebaseFirestore.DocumentData | undefined,
        maximum: number,
      ) => {
        const storedStart = Number(value?.windowStartedAt);
        const hasStart = Number.isSafeInteger(storedStart) && storedStart >= 0;
        const elapsed = hasStart ? Math.max(0, input.now - storedStart) : input.windowMs;
        const active = hasStart && elapsed < input.windowMs;
        const storedAttempts = Number(value?.attempts);
        const attempts = active && Number.isSafeInteger(storedAttempts)
          ? Math.max(0, storedAttempts)
          : 0;
        return {
          windowStartedAt: active ? storedStart : input.now,
          attempts,
          blocked: attempts >= maximum,
          retryAfterMs: Math.max(1, input.windowMs - (active ? elapsed : 0)),
        };
      };
      const ip = read(ipSnapshot.data(), input.maxAttemptsPerIp);
      const property = read(
        propertySnapshot.data(),
        input.maxAttemptsPerProperty,
      );
      if (ip.blocked || property.blocked) {
        return {
          allowed: false,
          retryAfterMs: Math.max(
            ip.blocked ? ip.retryAfterMs : 0,
            property.blocked ? property.retryAfterMs : 0,
          ),
        } as const;
      }
      const updatedAt = new Date(input.now).toISOString();
      const value = (
        scope: "ip" | "property",
        state: { windowStartedAt: number; attempts: number },
      ) => ({
        schemaVersion: 1,
        scope,
        windowStartedAt: state.windowStartedAt,
        attempts: state.attempts + 1,
        updatedAt,
        expiresAtTtl: new Date(state.windowStartedAt + input.windowMs * 2),
      });
      transaction.set(ipRef, value("ip", ip));
      transaction.set(propertyRef, value("property", property));
      return { allowed: true, retryAfterMs: 0 } as const;
    });
  }

  async clear(input: { ipSubject: string; propertySubject: string }): Promise<void> {
    if (!db) throw new Error("Firebase not initialized");
    const collection = db.collection(COLLECTION);
    // A successful credential may reset that property's consecutive-attempt
    // window, but must not erase the broader IP abuse budget.
    await collection.doc(`property-${input.propertySubject}`).delete();
  }
}

export class OwnerLoginRateLimiter {
  private readonly ipLimiter: AdminLoginRateLimiter;
  private readonly propertyLimiter: AdminLoginRateLimiter;

  constructor(
    private readonly store: OwnerLoginLimitStore,
    private readonly options: {
      secret?: string | Buffer;
      now?: () => number;
      windowMs?: number;
      maxAttemptsPerIp?: number;
      maxAttemptsPerProperty?: number;
    } = {},
  ) {
    this.ipLimiter = new AdminLoginRateLimiter(
      options.maxAttemptsPerIp ?? OWNER_LOGIN_MAX_ATTEMPTS_PER_IP,
      options.windowMs ?? OWNER_LOGIN_RATE_LIMIT_WINDOW_MS,
    );
    this.propertyLimiter = new AdminLoginRateLimiter(
      options.maxAttemptsPerProperty ?? OWNER_LOGIN_MAX_ATTEMPTS_PER_PROPERTY,
      options.windowMs ?? OWNER_LOGIN_RATE_LIMIT_WINDOW_MS,
    );
  }

  async consume(input: {
    ipAddress: unknown;
    propertyNumber: unknown;
  }): Promise<OwnerLoginLimitResult> {
    const subjects = this.subjects(input);
    const now = (this.options.now || Date.now)();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error("Invalid owner login rate-limit clock");
    }
    const ipLocal = this.ipLimiter.consume(subjects.ipSubject, now);
    const propertyLocal = this.propertyLimiter.consume(
      subjects.propertySubject,
      now,
    );
    if (!ipLocal.allowed || !propertyLocal.allowed) {
      return {
        allowed: false,
        retryAfterMs: Math.max(ipLocal.retryAfterMs, propertyLocal.retryAfterMs),
      };
    }
    return this.store.consume({
      ...subjects,
      now,
      windowMs: this.options.windowMs ?? OWNER_LOGIN_RATE_LIMIT_WINDOW_MS,
      maxAttemptsPerIp: this.options.maxAttemptsPerIp ??
        OWNER_LOGIN_MAX_ATTEMPTS_PER_IP,
      maxAttemptsPerProperty: this.options.maxAttemptsPerProperty ??
        OWNER_LOGIN_MAX_ATTEMPTS_PER_PROPERTY,
    });
  }

  async clear(input: {
    ipAddress: unknown;
    propertyNumber: unknown;
  }): Promise<void> {
    const subjects = this.subjects(input);
    // Clear the process-local reservation made by this successful request;
    // the durable IP document remains and still enforces the shared budget.
    this.ipLimiter.clear(subjects.ipSubject);
    this.propertyLimiter.clear(subjects.propertySubject);
    await this.store.clear(subjects);
  }

  private subjects(input: {
    ipAddress: unknown;
    propertyNumber: unknown;
  }): { ipSubject: string; propertySubject: string } {
    const ipAddress = normalizeIp(input.ipAddress);
    const propertyNumber = typeof input.propertyNumber === "string"
      ? input.propertyNumber.trim()
      : "";
    if (!ipAddress || !propertyNumber || propertyNumber.length > 160) {
      throw new Error("Invalid owner login rate-limit subject");
    }
    return {
      ipSubject: this.digest(IP_DOMAIN, ipAddress),
      propertySubject: this.digest(PROPERTY_DOMAIN, propertyNumber),
    };
  }

  private digest(domain: string, value: string): string {
    const configured = this.options.secret ??
      process.env.OWNER_ACCOUNT_HMAC_SECRET ??
      process.env.SESSION_SECRET;
    const secret = Buffer.isBuffer(configured)
      ? configured
      : Buffer.from(configured || "", "utf8");
    if (secret.length < 32) throw new Error("Owner account HMAC secret is too short");
    return createHmac("sha256", secret)
      .update(domain, "utf8")
      .update(value, "utf8")
      .digest("hex");
  }
}

function normalizeIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  const version = isIP(candidate);
  if (!version) return null;
  if (version === 4) {
    return candidate.split(".").map((part) => String(Number(part))).join(".");
  }
  try {
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export const ownerLoginRateLimiter = new OwnerLoginRateLimiter(
  new FirestoreOwnerLoginLimitStore(),
);
