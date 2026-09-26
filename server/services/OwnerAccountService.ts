import { createHmac, randomBytes, randomInt } from "node:crypto";
import { isIP } from "node:net";

import type {
  OwnerAccount,
  OwnerAccountOtpChallenge,
  OwnerAccountOtpPurpose,
  OwnerPropertyMembership,
} from "../../shared/owner-accounts";
import { normalizeSaudiMobilePhone } from "../../shared/phone";

export const OWNER_ACCOUNT_OTP_TTL_MS = 10 * 60 * 1000;
export const OWNER_ACCOUNT_OTP_MAX_ATTEMPTS = 5;
export const OWNER_ACCOUNT_OTP_ISSUE_WINDOW_MS = 60 * 60 * 1000;
export const OWNER_ACCOUNT_OTP_MAX_ISSUES_PER_PHONE = 3;
export const OWNER_ACCOUNT_OTP_MAX_ISSUES_PER_IP = 10;

const MINIMUM_SECRET_BYTES = 32;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OTP_CODE_PATTERN = /^\d{6}$/;
const MAX_ID_COLLISIONS = 3;
const PHONE_SUBJECT_DOMAIN = "rwqan.owner-account.phone.v1\0";
const IP_SUBJECT_DOMAIN = "rwqan.owner-account.ip.v1\0";
const CODE_HASH_DOMAIN = "rwqan.owner-account.otp-code.v1\0";

export type OwnerAccountOtpIssueScope = "ip" | "phone";

export type CreateOwnerAccountChallengeResult =
  | { status: "created" }
  | { status: "collision" }
  | {
      status: "rate_limited";
      scope: OwnerAccountOtpIssueScope;
      retryAfterMs: number;
    };

export type OwnerChallengeFailureStatus =
  | "missing"
  | "invalid"
  | "expired"
  | "used"
  | "exhausted"
  | "binding_mismatch";

export type VerifyOwnerLoginChallengeResult =
  | { status: "verified"; account: OwnerAccount; verifiedAt: string }
  | { status: "invalid"; remainingAttempts: number }
  | { status: Exclude<OwnerChallengeFailureStatus, "invalid"> }
  | { status: "account_unavailable" };

export type VerifyOwnerPropertyChallengeResult =
  | {
      status: "verified";
      account: OwnerAccount;
      membership: OwnerPropertyMembership;
      verifiedAt: string;
    }
  | { status: "invalid"; remainingAttempts: number }
  | { status: Exclude<OwnerChallengeFailureStatus, "invalid"> }
  | { status: "account_unavailable" }
  | { status: "property_claimed" };

export interface OwnerAccountStore {
  getAccountByPhoneSubject(phoneSubject: string): Promise<OwnerAccount | null>;
  getAccount(id: string): Promise<OwnerAccount | null>;
  getChallengeContext(challengeId: string): Promise<Pick<
    OwnerAccountOtpChallenge,
    "purpose" | "ownerAccountId" | "propertyNumber"
  > | null>;
  getMembership(propertyNumber: string): Promise<OwnerPropertyMembership | null>;
  listActiveMemberships(ownerAccountId: string): Promise<OwnerPropertyMembership[]>;
  validateActiveMembership(input: {
    ownerAccountId: string;
    authVersion: number;
    propertyNumber: string;
  }): Promise<boolean>;
  createChallenge(input: {
    challenge: OwnerAccountOtpChallenge;
    ipSubject: string;
    now: number;
    windowMs: number;
    maxIssuesPerIp: number;
    maxIssuesPerPhone: number;
  }): Promise<CreateOwnerAccountChallengeResult>;
  deleteChallenge(challengeId: string): Promise<void>;
  verifyLoginChallenge(input: {
    challengeId: string;
    phoneSubject: string;
    ownerAccountId: string;
    candidateCodeHash: string;
    now: number;
  }): Promise<VerifyOwnerLoginChallengeResult>;
  verifyAndClaimProperty(input: {
    challengeId: string;
    phoneSubject: string;
    propertyNumber: string;
    candidateCodeHash: string;
    proposedOwnerAccountId: string;
    now: number;
  }): Promise<VerifyOwnerPropertyChallengeResult>;
  verifyAndAttachProperty(input: {
    challengeId: string;
    phoneSubject: string;
    propertyNumber: string;
    ownerAccountId: string;
    authVersion: number;
    candidateCodeHash: string;
    now: number;
  }): Promise<VerifyOwnerPropertyChallengeResult>;
}

export type OwnerAccountOtpSender = (
  phone: string,
  message: string,
  retries?: number,
) => Promise<{ success: boolean; error?: string }>;

export type OwnerAccountPropertyReader = (propertyNumber: string) => Promise<{
  propertyNumber: string;
  whatsappNumber?: string | null;
} | null>;

export type OwnerAccountOtpErrorCode =
  | "INVALID_PHONE"
  | "INVALID_IP"
  | "INVALID_CHALLENGE"
  | "INVALID_CODE_FORMAT"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_DISABLED"
  | "PROPERTY_NOT_FOUND"
  | "PROPERTY_PHONE_INVALID"
  | "RATE_LIMITED"
  | "DELIVERY_FAILED"
  | "CHALLENGE_NOT_FOUND"
  | "CODE_INVALID"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_USED"
  | "CHALLENGE_CONTEXT_INVALID"
  | "ATTEMPTS_EXHAUSTED"
  | "PROPERTY_ALREADY_CLAIMED"
  | "ACCOUNT_SESSION_INVALID"
  | "SERVICE_UNAVAILABLE";

export class OwnerAccountOtpError extends Error {
  constructor(
    readonly code: OwnerAccountOtpErrorCode,
    readonly status: number,
    message: string,
    readonly details: {
      retryAfterMs?: number;
      remainingAttempts?: number;
    } = {},
  ) {
    super(message);
    this.name = "OwnerAccountOtpError";
  }
}

export interface OwnerAccountServiceOptions {
  secret?: string | Buffer;
  now?: () => number;
  createCode?: () => string;
  createOpaqueId?: () => string;
  sender: OwnerAccountOtpSender;
  propertyReader: OwnerAccountPropertyReader;
  issueWindowMs?: number;
  maxIssuesPerPhone?: number;
  maxIssuesPerIp?: number;
}

export interface IssuedOwnerAccountChallenge {
  challengeId: string;
  maskedPhone: string;
  expiresInSeconds: number;
}

function copySecret(value: string | Buffer | undefined): Buffer | undefined {
  if (value === undefined) return undefined;
  return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, "utf8");
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
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function maskSaudiPhone(phone: string): string {
  const localPhone = `0${phone}`;
  return `${localPhone.slice(0, 2)}••••${localPhone.slice(-4)}`;
}

function normalizePropertyNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 160 ? normalized : null;
}

export class OwnerAccountService {
  private readonly secret: Buffer | undefined;
  private readonly now: () => number;
  private readonly createCode: () => string;
  private readonly createOpaqueId: () => string;
  private readonly issueWindowMs: number;
  private readonly maxIssuesPerPhone: number;
  private readonly maxIssuesPerIp: number;

  constructor(
    private readonly store: OwnerAccountStore,
    private readonly options: OwnerAccountServiceOptions,
  ) {
    this.secret = copySecret(options.secret);
    this.now = options.now || Date.now;
    this.createCode = options.createCode || (() =>
      randomInt(0, 1_000_000).toString().padStart(6, "0"));
    this.createOpaqueId = options.createOpaqueId || (() =>
      randomBytes(32).toString("base64url"));
    this.issueWindowMs = options.issueWindowMs ?? OWNER_ACCOUNT_OTP_ISSUE_WINDOW_MS;
    this.maxIssuesPerPhone = options.maxIssuesPerPhone ??
      OWNER_ACCOUNT_OTP_MAX_ISSUES_PER_PHONE;
    this.maxIssuesPerIp = options.maxIssuesPerIp ??
      OWNER_ACCOUNT_OTP_MAX_ISSUES_PER_IP;
  }

  async issueLogin(input: {
    phone: unknown;
    ipAddress: unknown;
  }): Promise<IssuedOwnerAccountChallenge> {
    const phone = this.requirePhone(input.phone);
    const phoneSubject = this.subject(PHONE_SUBJECT_DOMAIN, phone);
    let account: OwnerAccount | null;
    try {
      account = await this.store.getAccountByPhoneSubject(phoneSubject);
    } catch {
      throw this.unavailable();
    }
    // Unknown and disabled accounts intentionally follow the same issue path.
    // This prevents the public challenge endpoint from becoming a phone-account
    // enumeration oracle. Verification still fails closed after code proof.
    const opaqueAccountId = account?.status === "active"
      ? account.id
      : this.newOpaqueId();
    return this.issue({
      purpose: "login",
      phone,
      phoneSubject,
      ownerAccountId: opaqueAccountId,
      propertyNumber: null,
      ipAddress: input.ipAddress,
      deliver: account?.status === "active",
    });
  }

  async issueClaim(input: {
    propertyNumber: unknown;
    ipAddress: unknown;
  }): Promise<IssuedOwnerAccountChallenge> {
    const propertyNumber = this.requirePropertyNumber(input.propertyNumber);
    const phone = await this.readPropertyPhone(propertyNumber);
    return this.issue({
      purpose: "claim_current_property",
      phone,
      phoneSubject: this.subject(PHONE_SUBJECT_DOMAIN, phone),
      ownerAccountId: null,
      propertyNumber,
      ipAddress: input.ipAddress,
    });
  }

  async issueAttach(input: {
    ownerAccountId: unknown;
    authVersion: unknown;
    currentPropertyNumber: unknown;
    propertyNumber: unknown;
    ipAddress: unknown;
  }): Promise<IssuedOwnerAccountChallenge> {
    const ownerAccountId = this.requireOpaqueId(input.ownerAccountId);
    const authVersion = this.requireAuthVersion(input.authVersion);
    const currentPropertyNumber = this.requirePropertyNumber(
      input.currentPropertyNumber,
    );
    const propertyNumber = this.requirePropertyNumber(input.propertyNumber);
    const validSession = await this.store.validateActiveMembership({
      ownerAccountId,
      authVersion,
      propertyNumber: currentPropertyNumber,
    }).catch(() => false);
    if (!validSession) {
      throw new OwnerAccountOtpError(
        "ACCOUNT_SESSION_INVALID",
        401,
        "جلسة المالك غير صالحة.",
      );
    }
    const existing = await this.store.getMembership(propertyNumber)
      .catch(() => { throw this.unavailable(); });
    if (existing) {
      throw new OwnerAccountOtpError(
        "PROPERTY_ALREADY_CLAIMED",
        409,
        "العقار مرتبط بحساب مالك.",
      );
    }
    const phone = await this.readPropertyPhone(propertyNumber);
    return this.issue({
      purpose: "attach_property",
      phone,
      phoneSubject: this.subject(PHONE_SUBJECT_DOMAIN, phone),
      ownerAccountId,
      propertyNumber,
      ipAddress: input.ipAddress,
    });
  }

  async verifyLogin(input: {
    challengeId: unknown;
    phone: unknown;
    code: unknown;
  }): Promise<{ account: OwnerAccount; memberships: OwnerPropertyMembership[] }> {
    const challengeId = this.requireChallengeId(input.challengeId);
    const phone = this.requirePhone(input.phone);
    const code = this.requireCode(input.code);
    const phoneSubject = this.subject(PHONE_SUBJECT_DOMAIN, phone);
    const context = await this.store.getChallengeContext(challengeId)
      .catch(() => { throw this.unavailable(); });
    if (
      !context ||
      context.purpose !== "login" ||
      !context.ownerAccountId ||
      context.propertyNumber !== null
    ) {
      throw new OwnerAccountOtpError(
        "CHALLENGE_CONTEXT_INVALID",
        403,
        "طلب التحقق لا يخص هذه العملية.",
      );
    }
    const candidateCodeHash = this.codeHash({
      challengeId,
      purpose: "login",
      phoneSubject,
      ownerAccountId: context.ownerAccountId,
      propertyNumber: null,
      code,
    });
    let result: VerifyOwnerLoginChallengeResult;
    try {
      result = await this.store.verifyLoginChallenge({
        challengeId,
        phoneSubject,
        ownerAccountId: context.ownerAccountId,
        candidateCodeHash,
        now: this.currentTime(),
      });
    } catch {
      throw this.unavailable();
    }
    const verified = this.requireVerified(result);
    const memberships = await this.store.listActiveMemberships(
      verified.account.id,
    ).catch(() => { throw this.unavailable(); });
    if (memberships.length === 0) {
      throw new OwnerAccountOtpError(
        "ACCOUNT_SESSION_INVALID",
        401,
        "لا توجد عقارات مرتبطة بحساب المالك.",
      );
    }
    return { account: verified.account, memberships };
  }

  async verifyClaim(input: {
    challengeId: unknown;
    code: unknown;
    propertyNumber: unknown;
  }): Promise<{ account: OwnerAccount; memberships: OwnerPropertyMembership[] }> {
    const challengeId = this.requireChallengeId(input.challengeId);
    const code = this.requireCode(input.code);
    const propertyNumber = this.requirePropertyNumber(input.propertyNumber);
    const phone = await this.readPropertyPhone(propertyNumber);
    const phoneSubject = this.subject(PHONE_SUBJECT_DOMAIN, phone);
    const candidateCodeHash = this.codeHash({
      challengeId,
      purpose: "claim_current_property",
      phoneSubject,
      ownerAccountId: null,
      propertyNumber,
      code,
    });
    let result: VerifyOwnerPropertyChallengeResult;
    try {
      result = await this.store.verifyAndClaimProperty({
        challengeId,
        phoneSubject,
        propertyNumber,
        candidateCodeHash,
        proposedOwnerAccountId: this.newOpaqueId(),
        now: this.currentTime(),
      });
    } catch {
      throw this.unavailable();
    }
    const verified = this.requireVerified(result);
    const memberships = await this.store.listActiveMemberships(
      verified.account.id,
    ).catch(() => { throw this.unavailable(); });
    return { account: verified.account, memberships };
  }

  async verifyAttach(input: {
    challengeId: unknown;
    code: unknown;
    ownerAccountId: unknown;
    authVersion: unknown;
  }): Promise<{ account: OwnerAccount; memberships: OwnerPropertyMembership[] }> {
    const challengeId = this.requireChallengeId(input.challengeId);
    const code = this.requireCode(input.code);
    const ownerAccountId = this.requireOpaqueId(input.ownerAccountId);
    const authVersion = this.requireAuthVersion(input.authVersion);
    const context = await this.store.getChallengeContext(challengeId)
      .catch(() => { throw this.unavailable(); });
    if (
      !context ||
      context.purpose !== "attach_property" ||
      context.ownerAccountId !== ownerAccountId ||
      !context.propertyNumber
    ) {
      throw new OwnerAccountOtpError(
        "CHALLENGE_CONTEXT_INVALID",
        403,
        "طلب التحقق لا يخص هذه العملية.",
      );
    }
    const propertyNumber = this.requirePropertyNumber(context.propertyNumber);
    const phone = await this.readPropertyPhone(propertyNumber);
    const phoneSubject = this.subject(PHONE_SUBJECT_DOMAIN, phone);
    const candidateCodeHash = this.codeHash({
      challengeId,
      purpose: "attach_property",
      phoneSubject,
      ownerAccountId,
      propertyNumber,
      code,
    });
    let result: VerifyOwnerPropertyChallengeResult;
    try {
      result = await this.store.verifyAndAttachProperty({
        challengeId,
        phoneSubject,
        propertyNumber,
        ownerAccountId,
        authVersion,
        candidateCodeHash,
        now: this.currentTime(),
      });
    } catch {
      throw this.unavailable();
    }
    const verified = this.requireVerified(result);
    const memberships = await this.store.listActiveMemberships(
      verified.account.id,
    ).catch(() => { throw this.unavailable(); });
    return { account: verified.account, memberships };
  }

  phoneSubject(value: unknown): string {
    return this.subject(PHONE_SUBJECT_DOMAIN, this.requirePhone(value));
  }

  private async issue(input: {
    purpose: OwnerAccountOtpPurpose;
    phone: string;
    phoneSubject: string;
    ownerAccountId: string | null;
    propertyNumber: string | null;
    ipAddress: unknown;
    deliver?: boolean;
  }): Promise<IssuedOwnerAccountChallenge> {
    const ipAddress = normalizeIpAddress(input.ipAddress);
    if (!ipAddress) {
      throw new OwnerAccountOtpError(
        "INVALID_IP",
        400,
        "تعذر التحقق من مصدر الطلب.",
      );
    }
    const now = this.currentTime();
    const expiresAtMs = now + OWNER_ACCOUNT_OTP_TTL_MS;
    const code = this.createCode();
    if (!OTP_CODE_PATTERN.test(code)) throw this.unavailable();
    const ipSubject = this.subject(IP_SUBJECT_DOMAIN, ipAddress);

    for (let attempt = 0; attempt < MAX_ID_COLLISIONS; attempt += 1) {
      const challengeId = this.newOpaqueId();
      const timestamp = new Date(now).toISOString();
      const challenge: OwnerAccountOtpChallenge = {
        id: challengeId,
        schemaVersion: 1,
        purpose: input.purpose,
        phoneSubject: input.phoneSubject,
        ownerAccountId: input.ownerAccountId,
        propertyNumber: input.propertyNumber,
        codeHash: this.codeHash({ ...input, challengeId, code }),
        attemptCount: 0,
        maxAttempts: OWNER_ACCOUNT_OTP_MAX_ATTEMPTS,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtTtl: new Date(expiresAtMs),
        consumedAt: null,
        exhaustedAt: null,
      };

      let creation: CreateOwnerAccountChallengeResult;
      try {
        creation = await this.store.createChallenge({
          challenge,
          ipSubject,
          now,
          windowMs: this.issueWindowMs,
          maxIssuesPerIp: this.maxIssuesPerIp,
          maxIssuesPerPhone: this.maxIssuesPerPhone,
        });
      } catch {
        throw this.unavailable();
      }
      if (creation.status === "collision") continue;
      if (creation.status === "rate_limited") {
        throw new OwnerAccountOtpError(
          "RATE_LIMITED",
          429,
          "تم طلب رموز تحقق كثيرة. حاول مرة أخرى لاحقاً.",
          { retryAfterMs: creation.retryAfterMs },
        );
      }

      if (input.deliver === false) {
        return {
          challengeId,
          maskedPhone: maskSaudiPhone(input.phone),
          expiresInSeconds: Math.floor(OWNER_ACCOUNT_OTP_TTL_MS / 1000),
        };
      }

      let delivered = false;
      try {
        const delivery = await this.options.sender(
          input.phone,
          this.otpMessage(code),
          2,
        );
        delivered = delivery.success;
      } catch {
        delivered = false;
      }
      if (!delivered) {
        await this.store.deleteChallenge(challengeId).catch(() => undefined);
        throw new OwnerAccountOtpError(
          "DELIVERY_FAILED",
          502,
          "تعذر إرسال رمز التحقق. حاول مرة أخرى لاحقاً.",
        );
      }
      return {
        challengeId,
        maskedPhone: maskSaudiPhone(input.phone),
        expiresInSeconds: Math.floor(OWNER_ACCOUNT_OTP_TTL_MS / 1000),
      };
    }
    throw this.unavailable();
  }

  private requireVerified<T extends { status: string }>(result: T): Extract<T, { status: "verified" }> {
    switch (result.status) {
      case "verified":
        return result as Extract<T, { status: "verified" }>;
      case "invalid":
        throw new OwnerAccountOtpError(
          "CODE_INVALID",
          401,
          "رمز التحقق غير صحيح.",
          { remainingAttempts: (result as { remainingAttempts?: number }).remainingAttempts },
        );
      case "missing":
        throw new OwnerAccountOtpError(
          "CHALLENGE_NOT_FOUND",
          404,
          "طلب التحقق غير موجود.",
        );
      case "expired":
        throw new OwnerAccountOtpError(
          "CHALLENGE_EXPIRED",
          410,
          "انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.",
        );
      case "used":
        throw new OwnerAccountOtpError(
          "CHALLENGE_USED",
          409,
          "تم استخدام رمز التحقق مسبقاً.",
        );
      case "exhausted":
        throw new OwnerAccountOtpError(
          "ATTEMPTS_EXHAUSTED",
          429,
          "تم تجاوز عدد محاولات التحقق. اطلب رمزاً جديداً.",
        );
      case "binding_mismatch":
        throw new OwnerAccountOtpError(
          "CHALLENGE_CONTEXT_INVALID",
          403,
          "طلب التحقق لا يخص هذه العملية.",
        );
      case "property_claimed":
        throw new OwnerAccountOtpError(
          "PROPERTY_ALREADY_CLAIMED",
          409,
          "العقار مرتبط بحساب مالك.",
        );
      case "account_unavailable":
      default:
        throw new OwnerAccountOtpError(
          "ACCOUNT_SESSION_INVALID",
          401,
          "جلسة المالك غير صالحة.",
        );
    }
  }

  private async readPropertyPhone(propertyNumber: string): Promise<string> {
    let property: Awaited<ReturnType<OwnerAccountPropertyReader>>;
    try {
      property = await this.options.propertyReader(propertyNumber);
    } catch {
      throw this.unavailable();
    }
    if (!property || property.propertyNumber !== propertyNumber) {
      throw new OwnerAccountOtpError(
        "PROPERTY_NOT_FOUND",
        404,
        "العقار غير موجود.",
      );
    }
    const phone = normalizeSaudiMobilePhone(property.whatsappNumber);
    if (!phone) {
      throw new OwnerAccountOtpError(
        "PROPERTY_PHONE_INVALID",
        409,
        "رقم واتساب العقار غير صالح للتحقق.",
      );
    }
    return phone;
  }

  private codeHash(input: {
    challengeId: string;
    purpose: OwnerAccountOtpPurpose;
    phoneSubject: string;
    ownerAccountId: string | null;
    propertyNumber: string | null;
    code: string;
  }): string {
    return createHmac("sha256", this.resolveSecret())
      .update(CODE_HASH_DOMAIN, "utf8")
      .update(input.challengeId, "ascii")
      .update("\0", "ascii")
      .update(input.purpose, "utf8")
      .update("\0", "ascii")
      .update(input.phoneSubject, "ascii")
      .update("\0", "ascii")
      .update(input.ownerAccountId || "", "utf8")
      .update("\0", "ascii")
      .update(input.propertyNumber || "", "utf8")
      .update("\0", "ascii")
      .update(input.code, "ascii")
      .digest("hex");
  }

  private subject(domain: string, value: string): string {
    return createHmac("sha256", this.resolveSecret())
      .update(domain, "utf8")
      .update(value, "utf8")
      .digest("hex");
  }

  private resolveSecret(): Buffer {
    const secret = this.secret ||
      copySecret(process.env.OWNER_ACCOUNT_HMAC_SECRET) ||
      copySecret(process.env.SESSION_SECRET);
    if (!secret || secret.length < MINIMUM_SECRET_BYTES) throw this.unavailable();
    return secret;
  }

  private currentTime(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) throw this.unavailable();
    return value;
  }

  private newOpaqueId(): string {
    const value = this.createOpaqueId();
    if (!CHALLENGE_ID_PATTERN.test(value)) throw this.unavailable();
    return value;
  }

  private requireOpaqueId(value: unknown): string {
    if (typeof value !== "string" || !CHALLENGE_ID_PATTERN.test(value)) {
      throw new OwnerAccountOtpError(
        "ACCOUNT_SESSION_INVALID",
        401,
        "جلسة المالك غير صالحة.",
      );
    }
    return value;
  }

  private requireChallengeId(value: unknown): string {
    if (typeof value !== "string" || !CHALLENGE_ID_PATTERN.test(value)) {
      throw new OwnerAccountOtpError(
        "INVALID_CHALLENGE",
        400,
        "طلب التحقق غير صحيح.",
      );
    }
    return value;
  }

  private requireCode(value: unknown): string {
    if (typeof value !== "string" || !OTP_CODE_PATTERN.test(value)) {
      throw new OwnerAccountOtpError(
        "INVALID_CODE_FORMAT",
        400,
        "رمز التحقق يجب أن يتكون من 6 أرقام.",
      );
    }
    return value;
  }

  private requirePhone(value: unknown): string {
    const phone = normalizeSaudiMobilePhone(value);
    if (!phone) {
      throw new OwnerAccountOtpError(
        "INVALID_PHONE",
        400,
        "رقم الجوال السعودي غير صحيح.",
      );
    }
    return phone;
  }

  private requirePropertyNumber(value: unknown): string {
    const propertyNumber = normalizePropertyNumber(value);
    if (!propertyNumber) {
      throw new OwnerAccountOtpError(
        "PROPERTY_NOT_FOUND",
        404,
        "العقار غير موجود.",
      );
    }
    return propertyNumber;
  }

  private requireAuthVersion(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      throw new OwnerAccountOtpError(
        "ACCOUNT_SESSION_INVALID",
        401,
        "جلسة المالك غير صالحة.",
      );
    }
    return Number(value);
  }

  // This is intentionally byte-for-byte identical to the existing generic OTP
  // message so the additive owner-account path does not introduce new copy.
  private otpMessage(code: string): string {
    return `رمز التحقق الخاص بك في روقان هو: ${code}\nصالح لمدة 10 دقائق.\nلا تشارك هذا الرمز مع أي شخص.`;
  }

  private unavailable(): OwnerAccountOtpError {
    return new OwnerAccountOtpError(
      "SERVICE_UNAVAILABLE",
      503,
      "خدمة التحقق غير متاحة مؤقتاً. حاول مرة أخرى لاحقاً.",
    );
  }
}
