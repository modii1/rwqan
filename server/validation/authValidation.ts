/**
 * authValidation.ts
 * Zod schemas + validateBody middleware for all authentication routes.
 */

import { z } from "zod";
import { validateBody } from "./subscriptionValidation";

// ─── Primitives ───────────────────────────────────────────────────────────────

const nonEmptyStr = (label: string) =>
  z.string({ required_error: `${label} مطلوب` }).trim().min(1, `${label} لا يمكن أن يكون فارغاً`);

const pinSchema = nonEmptyStr("رمز الدخول");

const passwordSchema = nonEmptyStr("كلمة المرور").min(4, "كلمة المرور يجب أن تكون 4 أحرف على الأقل");

// ─── Owner Login ──────────────────────────────────────────────────────────────

/** POST /api/owner/login */
export const ownerLoginSchema = z.object({
  propertyNumber: nonEmptyStr("رقم العقار"),
  pin: pinSchema,
});

export type OwnerLoginBody = z.infer<typeof ownerLoginSchema>;
export const validateOwnerLogin = validateBody(ownerLoginSchema);

// ─── Admin Login ──────────────────────────────────────────────────────────────

/** POST /api/admin/login */
export const adminLoginSchema = z.object({
  code: nonEmptyStr("كود الدخول"),
  password: nonEmptyStr("كلمة المرور"),
});

export type AdminLoginBody = z.infer<typeof adminLoginSchema>;
export const validateAdminLogin = validateBody(adminLoginSchema);

// ─── Password Reset ───────────────────────────────────────────────────────────

/** POST /api/auth/send-reset-code */
export const sendResetCodeSchema = z.object({
  ownerId: nonEmptyStr("رقم العقار"),
});

export type SendResetCodeBody = z.infer<typeof sendResetCodeSchema>;
export const validateSendResetCode = validateBody(sendResetCodeSchema);

/** POST /api/auth/set-new-password */
export const setNewPasswordSchema = z.object({
  ownerId: nonEmptyStr("رقم العقار"),
  resetCode: nonEmptyStr("رمز التحقق"),
  newPassword: passwordSchema,
});

export type SetNewPasswordBody = z.infer<typeof setNewPasswordSchema>;
export const validateSetNewPassword = validateBody(setNewPasswordSchema);

/** POST /api/owner/change-password */
export const changePasswordSchema = z.object({
  currentPassword: pinSchema,
  newPassword: passwordSchema,
});

export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
export const validateChangePassword = validateBody(changePasswordSchema);
