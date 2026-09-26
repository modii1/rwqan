import { z } from "zod";

export const ownerAccountIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const ownerAccountPhoneSubjectSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ownerAccountOtpPurposeSchema = z.enum([
  "login",
  "claim_current_property",
  "attach_property",
]);

export type OwnerAccountOtpPurpose = z.infer<
  typeof ownerAccountOtpPurposeSchema
>;

export const ownerAccountSchema = z.object({
  id: ownerAccountIdSchema,
  schemaVersion: z.literal(1),
  phoneSubject: ownerAccountPhoneSubjectSchema,
  authVersion: z.number().int().positive(),
  status: z.enum(["active", "disabled"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
}).strict();

export type OwnerAccount = z.infer<typeof ownerAccountSchema>;

export const ownerAccountPhoneIndexSchema = z.object({
  schemaVersion: z.literal(1),
  phoneSubject: ownerAccountPhoneSubjectSchema,
  ownerAccountId: ownerAccountIdSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type OwnerAccountPhoneIndex = z.infer<
  typeof ownerAccountPhoneIndexSchema
>;

export const ownerPropertyMembershipSchema = z.object({
  schemaVersion: z.literal(1),
  ownerAccountId: ownerAccountIdSchema,
  propertyNumber: z.string().trim().min(1).max(160),
  status: z.enum(["active", "revoked"]),
  isPrimary: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
}).strict();

export type OwnerPropertyMembership = z.infer<
  typeof ownerPropertyMembershipSchema
>;

export const ownerAccountOtpChallengeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  schemaVersion: z.literal(1),
  purpose: ownerAccountOtpPurposeSchema,
  phoneSubject: ownerAccountPhoneSubjectSchema,
  ownerAccountId: ownerAccountIdSchema.nullable(),
  propertyNumber: z.string().trim().min(1).max(160).nullable(),
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  attemptCount: z.number().int().min(0).max(5),
  maxAttempts: z.number().int().min(1).max(5),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable(),
  exhaustedAt: z.string().datetime().nullable(),
  expiresAtTtl: z.date(),
}).strict();

export type OwnerAccountOtpChallenge = z.infer<
  typeof ownerAccountOtpChallengeSchema
>;

export const ownerAccountOtpIssueLimitSchema = z.object({
  id: z.string(),
  scope: z.enum(["ip", "phone"]),
  windowStartedAt: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  expiresAtTtl: z.date(),
}).strict();

export type OwnerAccountOtpIssueLimit = z.infer<
  typeof ownerAccountOtpIssueLimitSchema
>;

export type OwnerAccountPropertyOption = {
  propertyNumber: string;
  name: string | null;
  city: string | null;
  isCurrent: boolean;
  isMain: boolean;
};
