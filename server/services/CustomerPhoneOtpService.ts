import {
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";
import { isIP } from "node:net";

import type { CustomerPhoneOtpChallenge } from "../../shared/schema";
import { normalizeSaudiMobilePhone } from "../../shared/phone";
import {
  firebaseService,
  type CreateCustomerPhoneOtpChallengeInput,
  type CreateCustomerPhoneOtpChallengeResult,
  type CustomerPhoneOtpIssueScope,
  type VerifyCustomerPhoneOtpChallengeInput,
  type VerifyCustomerPhoneOtpChallengeResult,
} from "../firebaseService";
import { sendOwnerWhatsApp } from "../integrations/whatsapp";

export const CUSTOMER_PHONE_OTP_TTL_MS = 10 * 60 * 1000;
export const CUSTOMER_PHONE_OTP_MAX_ATTEMPTS = 5;
export const CUSTOMER_PHONE_OTP_ISSUE_WINDOW_MS = 60 * 60 * 1000;
export const CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_PHONE = 3;
export const CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_IP = 10;

const MINIMUM_SECRET_BYTES = 32;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OTP_CODE_PATTERN = /^\d{6}$/;
const MAX_CHALLENGE_ID_COLLISIONS = 3;
const PHONE_SUBJECT_DOMAIN = "rwqan.customer-phone-otp.phone.v1\0";
const IP_SUBJECT_DOMAIN = "rwqan.customer-phone-otp.ip.v1\0";
const CODE_HASH_DOMAIN = "rwqan.customer-phone-otp.code.v1\0";

export type CustomerPhoneOtpErrorCode =
  | "INVALID_PHONE"
  | "INVALID_IP"
  | "INVALID_CHALLENGE"
  | "INVALID_CODE_FORMAT"
  | "RATE_LIMITED"
  | "DELIVERY_FAILED"
  | "CHALLENGE_NOT_FOUND"
  | "CODE_INVALID"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_USED"
  | "ATTEMPTS_EXHAUSTED"
  | "SERVICE_UNAVAILABLE";

export class CustomerPhoneOtpError extends Error {
  constructor(
    readonly code: CustomerPhoneOtpErrorCode,
    readonly status: number,
    message: string,
    readonly options: {
      retryAfterMs?: number;
      scope?: CustomerPhoneOtpIssueScope;
      remainingAttempts?: number;
    } = {},
  ) {
    super(message);
    this.name = "CustomerPhoneOtpError";
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }

  get scope(): CustomerPhoneOtpIssueScope | undefined {
    return this.options.scope;
  }

  get remainingAttempts(): number | undefined {
    return this.options.remainingAttempts;
  }
}

export class CustomerPhoneOtpConfigurationError extends Error {
  readonly code = "OTP_CONFIGURATION_ERROR";
  readonly status = 500;

  constructor(message: string) {
    super(message);
    this.name = "CustomerPhoneOtpConfigurationError";
  }
}

export interface CustomerPhoneOtpStore {
  createCustomerPhoneOtpChallenge(
    input: CreateCustomerPhoneOtpChallengeInput,
  ): Promise<CreateCustomerPhoneOtpChallengeResult>;
  verifyCustomerPhoneOtpChallenge(
    input: VerifyCustomerPhoneOtpChallengeInput,
  ): Promise<VerifyCustomerPhoneOtpChallengeResult>;
  deleteCustomerPhoneOtpChallenge(id: string): Promise<void>;
}

export type CustomerPhoneOtpSender = (
  phone: string,
  message: string,
  retries?: number,
) => Promise<{ success: boolean; error?: string }>;

export interface CustomerPhoneOtpServiceOptions {
  secret?: string | Buffer;
  now?: () => number;
  createCode?: () => string;
  createChallengeId?: () => string;
  sender?: CustomerPhoneOtpSender;
  issueWindowMs?: number;
  maxIssuesPerPhone?: number;
  maxIssuesPerIp?: number;
}

export interface IssueCustomerPhoneOtpInput {
  phone: unknown;
  ipAddress: unknown;
}

export interface IssuedCustomerPhoneOtpChallenge {
  challengeId: string;
  maskedPhone: string;
  expiresAt: string;
}

export interface VerifyCustomerPhoneOtpInput {
  challengeId: unknown;
  phone: unknown;
  code: unknown;
}

export interface VerifiedCustomerPhoneOtpChallenge {
  verified: true;
  challengeId: string;
  verifiedAt: string;
}

function copySecret(value: string | Buffer | undefined): Buffer | undefined {
  if (value === undefined) return undefined;
  return Buffer.isBuffer(value)
    ? Buffer.from(value)
    : Buffer.from(value, "utf8");
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CustomerPhoneOtpConfigurationError(
      `${name} must be a positive safe integer`,
    );
  }
  return value;
}

function normalizeIpAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  const version = isIP(candidate);
  if (!version) return null;
  if (version === 4) {
    return candidate.split(".").map((part) => String(Number(part))).join(".");
  }

  try {
    // WHATWG URL parsing provides one canonical compressed IPv6 spelling, so
    // equivalent textual forms cannot bypass the per-IP issue limit.
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function normalizeSaudiPhoneSafely(value: unknown): string | null {
  try {
    return normalizeSaudiMobilePhone(value);
  } catch {
    return null;
  }
}

function maskSaudiPhone(phone: string): string {
  const localPhone = `0${phone}`;
  return `${localPhone.slice(0, 2)}••••${localPhone.slice(-4)}`;
}

export class CustomerPhoneOtpService {
  private readonly configuredSecret: Buffer | undefined;
  private readonly now: () => number;
  private readonly createCode: () => string;
  private readonly createChallengeId: () => string;
  private readonly sender: CustomerPhoneOtpSender;
  private readonly issueWindowMs: number;
  private readonly maxIssuesPerPhone: number;
  private readonly maxIssuesPerIp: number;

  constructor(
    private readonly store: CustomerPhoneOtpStore,
    options: CustomerPhoneOtpServiceOptions = {},
  ) {
    this.configuredSecret = copySecret(options.secret);
    this.now = options.now || Date.now;
    this.createCode = options.createCode || (() => randomInt(0, 1_000_000)
      .toString()
      .padStart(6, "0"));
    this.createChallengeId = options.createChallengeId || (() =>
      randomBytes(32).toString("base64url"));
    this.sender = options.sender || sendOwnerWhatsApp;
    this.issueWindowMs = requirePositiveSafeInteger(
      options.issueWindowMs ?? CUSTOMER_PHONE_OTP_ISSUE_WINDOW_MS,
      "Customer phone OTP issue window",
    );
    this.maxIssuesPerPhone = requirePositiveSafeInteger(
      options.maxIssuesPerPhone ?? CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_PHONE,
      "Customer phone OTP per-phone issue limit",
    );
    this.maxIssuesPerIp = requirePositiveSafeInteger(
      options.maxIssuesPerIp ?? CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_IP,
      "Customer phone OTP per-IP issue limit",
    );
  }

  async issue(
    input: IssueCustomerPhoneOtpInput,
  ): Promise<IssuedCustomerPhoneOtpChallenge> {
    const phone = normalizeSaudiPhoneSafely(input.phone);
    if (!phone) {
      throw new CustomerPhoneOtpError(
        "INVALID_PHONE",
        400,
        "رقم الجوال السعودي غير صحيح.",
      );
    }
    const ipAddress = normalizeIpAddress(input.ipAddress);
    if (!ipAddress) {
      throw new CustomerPhoneOtpError(
        "INVALID_IP",
        400,
        "تعذر التحقق من مصدر الطلب.",
      );
    }

    const secret = this.resolveSecret();
    const now = this.getCurrentTime();
    const expiresAtMs = now + CUSTOMER_PHONE_OTP_TTL_MS;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new CustomerPhoneOtpConfigurationError(
        "Customer phone OTP expiry is outside the supported range",
      );
    }

    const code = this.createCode();
    if (!OTP_CODE_PATTERN.test(code)) {
      throw new CustomerPhoneOtpConfigurationError(
        "Customer phone OTP generator returned an invalid code",
      );
    }
    const phoneSubject = this.subjectDigest(secret, PHONE_SUBJECT_DOMAIN, phone);
    const ipSubject = this.subjectDigest(secret, IP_SUBJECT_DOMAIN, ipAddress);

    for (let collisionAttempt = 0;
      collisionAttempt < MAX_CHALLENGE_ID_COLLISIONS;
      collisionAttempt += 1) {
      const challengeId = this.createChallengeId();
      if (!CHALLENGE_ID_PATTERN.test(challengeId)) {
        throw new CustomerPhoneOtpConfigurationError(
          "Customer phone OTP generator returned an invalid challenge ID",
        );
      }

      const createdAt = new Date(now).toISOString();
      const expiresAt = new Date(expiresAtMs).toISOString();
      const challenge: CustomerPhoneOtpChallenge = {
        id: challengeId,
        schemaVersion: 1,
        phoneSubject,
        codeHash: this.codeDigest(
          secret,
          challengeId,
          phoneSubject,
          code,
        ),
        attemptCount: 0,
        maxAttempts: CUSTOMER_PHONE_OTP_MAX_ATTEMPTS,
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        expiresAtTtl: new Date(expiresAtMs),
        consumedAt: null,
        exhaustedAt: null,
      };

      let creation: CreateCustomerPhoneOtpChallengeResult;
      try {
        creation = await this.store.createCustomerPhoneOtpChallenge({
          challenge,
          ipSubject,
          now,
          windowMs: this.issueWindowMs,
          maxIssuesPerIp: this.maxIssuesPerIp,
          maxIssuesPerPhone: this.maxIssuesPerPhone,
        });
      } catch {
        throw this.serviceUnavailable();
      }

      if (creation.status === "collision") continue;
      if (creation.status === "rate_limited") {
        throw new CustomerPhoneOtpError(
          "RATE_LIMITED",
          429,
          "تم طلب رموز تحقق كثيرة. حاول مرة أخرى لاحقاً.",
          {
            retryAfterMs: creation.retryAfterMs,
            scope: creation.scope,
          },
        );
      }

      let delivered = false;
      try {
        const delivery = await this.sender(
          phone,
          this.buildMessage(code),
          2,
        );
        delivered = delivery.success;
      } catch {
        delivered = false;
      }

      if (!delivered) {
        try {
          await this.store.deleteCustomerPhoneOtpChallenge(challengeId);
        } catch {
          // The challenge remains opaque, is never returned, and expires via
          // Firestore TTL. Do not log identifiers or OTP delivery details.
        }
        throw new CustomerPhoneOtpError(
          "DELIVERY_FAILED",
          502,
          "تعذر إرسال رمز التحقق. حاول مرة أخرى لاحقاً.",
        );
      }

      return {
        challengeId,
        maskedPhone: maskSaudiPhone(phone),
        expiresAt,
      };
    }

    throw this.serviceUnavailable();
  }

  async verify(
    input: VerifyCustomerPhoneOtpInput,
  ): Promise<VerifiedCustomerPhoneOtpChallenge> {
    if (
      typeof input.challengeId !== "string" ||
      !CHALLENGE_ID_PATTERN.test(input.challengeId)
    ) {
      throw new CustomerPhoneOtpError(
        "INVALID_CHALLENGE",
        400,
        "طلب التحقق غير صحيح.",
      );
    }
    const phone = normalizeSaudiPhoneSafely(input.phone);
    if (!phone) {
      throw new CustomerPhoneOtpError(
        "INVALID_PHONE",
        400,
        "رقم الجوال السعودي غير صحيح.",
      );
    }
    if (typeof input.code !== "string" || !OTP_CODE_PATTERN.test(input.code)) {
      throw new CustomerPhoneOtpError(
        "INVALID_CODE_FORMAT",
        400,
        "رمز التحقق يجب أن يتكون من 6 أرقام.",
      );
    }

    const secret = this.resolveSecret();
    const now = this.getCurrentTime();
    const phoneSubject = this.subjectDigest(secret, PHONE_SUBJECT_DOMAIN, phone);
    const candidateCodeHash = this.codeDigest(
      secret,
      input.challengeId,
      phoneSubject,
      input.code,
    );

    let verification: VerifyCustomerPhoneOtpChallengeResult;
    try {
      verification = await this.store.verifyCustomerPhoneOtpChallenge({
        challengeId: input.challengeId,
        phoneSubject,
        candidateCodeHash,
        now,
      });
    } catch {
      throw this.serviceUnavailable();
    }

    switch (verification.status) {
      case "verified":
        return {
          verified: true,
          challengeId: input.challengeId,
          verifiedAt: verification.verifiedAt,
        };
      case "invalid":
        throw new CustomerPhoneOtpError(
          "CODE_INVALID",
          401,
          "رمز التحقق غير صحيح.",
          { remainingAttempts: verification.remainingAttempts },
        );
      case "missing":
        throw new CustomerPhoneOtpError(
          "CHALLENGE_NOT_FOUND",
          404,
          "طلب التحقق غير موجود.",
        );
      case "expired":
        throw new CustomerPhoneOtpError(
          "CHALLENGE_EXPIRED",
          410,
          "انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.",
        );
      case "used":
        throw new CustomerPhoneOtpError(
          "CHALLENGE_USED",
          409,
          "تم استخدام رمز التحقق مسبقاً.",
        );
      case "exhausted":
        throw new CustomerPhoneOtpError(
          "ATTEMPTS_EXHAUSTED",
          429,
          "تم تجاوز عدد محاولات التحقق. اطلب رمزاً جديداً.",
        );
    }
  }

  private resolveSecret(): Buffer {
    const secret = this.configuredSecret || copySecret(process.env.SESSION_SECRET);
    if (!secret || secret.length < MINIMUM_SECRET_BYTES) {
      throw new CustomerPhoneOtpConfigurationError(
        `SESSION_SECRET must be at least ${MINIMUM_SECRET_BYTES} bytes for customer phone OTP`,
      );
    }
    return secret;
  }

  private getCurrentTime(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new CustomerPhoneOtpConfigurationError(
        "Customer phone OTP clock returned an invalid time",
      );
    }
    return now;
  }

  private subjectDigest(secret: Buffer, domain: string, value: string): string {
    return createHmac("sha256", secret)
      .update(domain, "utf8")
      .update(value, "utf8")
      .digest("hex");
  }

  private codeDigest(
    secret: Buffer,
    challengeId: string,
    phoneSubject: string,
    code: string,
  ): string {
    return createHmac("sha256", secret)
      .update(CODE_HASH_DOMAIN, "utf8")
      .update(challengeId, "ascii")
      .update("\0", "ascii")
      .update(phoneSubject, "ascii")
      .update("\0", "ascii")
      .update(code, "ascii")
      .digest("hex");
  }

  private buildMessage(code: string): string {
    return `رمز التحقق الخاص بك في روقان هو: ${code}\nصالح لمدة 10 دقائق.\nلا تشارك هذا الرمز مع أي شخص.`;
  }

  private serviceUnavailable(): CustomerPhoneOtpError {
    return new CustomerPhoneOtpError(
      "SERVICE_UNAVAILABLE",
      503,
      "خدمة التحقق غير متاحة مؤقتاً. حاول مرة أخرى لاحقاً.",
    );
  }
}

export function createCustomerPhoneOtpService(
  options: CustomerPhoneOtpServiceOptions & {
    store?: CustomerPhoneOtpStore;
  } = {},
): CustomerPhoneOtpService {
  const { store = firebaseService, ...serviceOptions } = options;
  return new CustomerPhoneOtpService(store, serviceOptions);
}

// Secret validation is intentionally lazy so importing routes remains safe in
// tooling; production startup already requires SESSION_SECRET.
export const customerPhoneOtpService = createCustomerPhoneOtpService();
