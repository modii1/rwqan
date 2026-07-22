import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ContactIdentitySession } from "../../shared/schema";
import { normalizeSaudiMobilePhone } from "../../shared/phone";
import { firebaseService } from "../firebaseService";

export const CONTACT_IDENTITY_COOKIE_NAME = "rwqan_contact_identity";
export const CONTACT_IDENTITY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const CONTACT_IDENTITY_ISSUE_WINDOW_MS = 60 * 60 * 1000;
export const CONTACT_IDENTITY_MAX_ISSUES_PER_WINDOW = 10;

export interface ContactIdentityStore {
  getContactIdentitySession(id: string): Promise<ContactIdentitySession | null>;
  replaceContactIdentitySession(session: ContactIdentitySession, previousId?: string): Promise<void>;
  deleteContactIdentitySession(id: string): Promise<void>;
  consumeContactIdentityIssueLimit(
    id: string,
    now: number,
    windowMs: number,
    maxIssues: number,
  ): Promise<{ allowed: true; retryAfterMs: 0 } | { allowed: false; retryAfterMs: number }>;
}

export type RememberedContactIdentity = {
  clientPhone: string;
  sessionId: string;
  visitorId: string;
  expiresAt: string;
};

export type IssuedContactIdentity = RememberedContactIdentity & {
  token: string;
};

type ContactIdentityServiceOptions = {
  now?: () => number;
  createToken?: () => string;
  createVisitorId?: () => string;
};

export class ContactIdentityRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("تم إجراء محاولات كثيرة لحفظ رقم التواصل. حاول مرة أخرى لاحقاً.");
    this.name = "ContactIdentityRateLimitError";
  }
}

export function createContactIdentityIssueLimitKey(value: string): string {
  const secret = process.env.SESSION_SECRET || "rwqan-contact-analytics";
  return createHmac("sha256", secret)
    .update(`contact-identity-issue:${value}`)
    .digest("hex");
}

export function getContactIdentityCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: CONTACT_IDENTITY_MAX_AGE_MS,
  };
}

export function getContactIdentityClearCookieOptions() {
  const { maxAge: _maxAge, ...options } = getContactIdentityCookieOptions();
  return options;
}

export function maskContactPhone(value: unknown): string | null {
  const phone = normalizeSaudiMobilePhone(value);
  if (!phone) return null;
  const localPhone = `0${phone}`;
  return `${localPhone.slice(0, 2)}•• ••${localPhone.slice(-4)}`;
}

export class ContactIdentityService {
  private readonly now: () => number;
  private readonly createToken: () => string;
  private readonly createVisitorId: () => string;

  constructor(
    private readonly store: ContactIdentityStore,
    options: ContactIdentityServiceOptions = {},
  ) {
    this.now = options.now || Date.now;
    this.createToken = options.createToken || (() => randomBytes(32).toString("base64url"));
    this.createVisitorId = options.createVisitorId || (() => randomBytes(32).toString("base64url"));
  }

  hashToken(token: string): string {
    return createHash("sha256")
      .update(`rwqan-contact-identity:${token}`)
      .digest("hex");
  }

  async issue(
    value: unknown,
    previousToken?: string,
    issueLimitKey?: string,
  ): Promise<IssuedContactIdentity> {
    const clientPhone = normalizeSaudiMobilePhone(value);
    if (!clientPhone) throw new RangeError("رقم الجوال غير صحيح");

    const now = this.now();
    if (issueLimitKey) {
      const rateLimit = await this.store.consumeContactIdentityIssueLimit(
        issueLimitKey,
        now,
        CONTACT_IDENTITY_ISSUE_WINDOW_MS,
        CONTACT_IDENTITY_MAX_ISSUES_PER_WINDOW,
      );
      if (!rateLimit.allowed) throw new ContactIdentityRateLimitError(rateLimit.retryAfterMs);
    }

    const token = this.createToken();
    if (!this.isTokenWellFormed(token)) {
      throw new Error("Failed to create a valid contact identity token");
    }

    const sessionId = this.hashToken(token);
    const previousIdentity = await this.resolve(previousToken);
    const visitorId = previousIdentity?.visitorId || this.createVisitorId();
    if (!this.isVisitorIdWellFormed(visitorId)) {
      throw new Error("Failed to create a valid contact visitor ID");
    }
    const session: ContactIdentitySession = {
      id: sessionId,
      visitorId,
      clientPhone,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CONTACT_IDENTITY_MAX_AGE_MS).toISOString(),
      expiresAtTtl: new Date(now + CONTACT_IDENTITY_MAX_AGE_MS),
    };

    const previousId = previousToken && previousToken !== token && this.isTokenWellFormed(previousToken)
      ? this.hashToken(previousToken)
      : undefined;
    await this.store.replaceContactIdentitySession(session, previousId);

    return { token, clientPhone, sessionId, visitorId, expiresAt: session.expiresAt };
  }

  async resolve(token: unknown): Promise<RememberedContactIdentity | null> {
    if (typeof token !== "string" || !this.isTokenWellFormed(token)) return null;

    const sessionId = this.hashToken(token);
    const session = await this.store.getContactIdentitySession(sessionId);
    if (!session) return null;

    const expiresAt = Date.parse(session.expiresAt);
    const clientPhone = normalizeSaudiMobilePhone(session.clientPhone);
    if (!clientPhone || !Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      try {
        await this.store.deleteContactIdentitySession(sessionId);
      } catch (error) {
        console.error("Expired contact identity cleanup error:", error);
      }
      return null;
    }

    // Legacy sessions did not have visitorId. Using their token hash preserves
    // the same visitor/cooldown key they had before this field was introduced,
    // and the value is carried forward on the next token rotation.
    const visitorId = this.isVisitorIdWellFormed(session.visitorId)
      ? session.visitorId!
      : sessionId;

    return { clientPhone, sessionId, visitorId, expiresAt: session.expiresAt };
  }

  async revoke(token: unknown): Promise<void> {
    if (typeof token !== "string" || !this.isTokenWellFormed(token)) return;
    await this.store.deleteContactIdentitySession(this.hashToken(token));
  }

  private isTokenWellFormed(token: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(token);
  }

  private isVisitorIdWellFormed(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(value);
  }
}

export const contactIdentityService = new ContactIdentityService(firebaseService);
