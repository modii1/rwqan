/**
 * AuthService
 * Handles owner and admin authentication, OTP-based password reset,
 * and PIN management.
 */

import { timingSafeEqual } from "node:crypto";
import { firebaseService } from "../firebaseService";

const ADMIN_CODE = process.env.ADMIN_CODE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const ENJAZATIK_URL = process.env.ENJAZATIK_URL;
const ENJAZATIK_TOKEN = process.env.ENJAZATIK_TOKEN;

export class AuthService {
  // ─── Admin Auth ─────────────────────────────────────────────────────────────

  validateAdminCredentials(code: unknown, password: unknown): boolean {
    return (
      this._safeCredentialMatch(code, ADMIN_CODE) &&
      this._safeCredentialMatch(password, ADMIN_PASSWORD)
    );
  }

  // ─── Owner Auth ─────────────────────────────────────────────────────────────

  async validateOwnerPin(propertyNumber: string, pin: string): Promise<boolean> {
    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    return Boolean(property && property.pin === pin);
  }

  // ─── Password Reset ──────────────────────────────────────────────────────────

  /**
   * Send a 6-digit OTP to the owner's WhatsApp number.
   * Returns maskPhone and expiresIn (minutes) on success.
   */
  async sendResetCode(ownerId: string): Promise<{
    maskedPhone: string;
    expiresIn: number;
  }> {
    await firebaseService.ensureOwnersSheetExists();
    await firebaseService.syncOwnerFromProperties(ownerId);

    const owner = await firebaseService.getOwnerByPropertyNumber(ownerId);
    if (!owner) throw Object.assign(new Error("رقم العقار غير موجود"), { code: 404 });
    if (!owner.phone) throw Object.assign(new Error("لا يوجد رقم جوال مسجل لهذا العقار"), { code: 400 });

    const canSend = await firebaseService.canSendResetCode(ownerId);
    if (!canSend.canSend) {
      throw Object.assign(
        new Error(`يمكنك إعادة تعيين الرقم السري بعد ${canSend.remainingDays} يوم`),
        { code: 429 }
      );
    }

    const resetCode = Math.floor(100_000 + Math.random() * 900_000).toString();
    const expireTime = new Date(Date.now() + 10 * 60 * 1000);

    await firebaseService.updateOwnerResetCode(
      ownerId,
      resetCode,
      expireTime.toISOString(),
      new Date().toISOString()
    );

    const cleanPhone = this._normalizePhone(owner.phone.toString());

    if (!ENJAZATIK_URL || !ENJAZATIK_TOKEN) {
      await firebaseService.clearOwnerResetCode(ownerId);
      throw Object.assign(new Error("إعدادات الإرسال غير مكتملة"), { code: 500 });
    }

    const resp = await fetch(ENJAZATIK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENJAZATIK_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: cleanPhone,
        message: `رمز إعادة تعيين الرقم السري لروقان هو: ${resetCode} (صالح 10 دقائق)`,
      }),
    });

    if (!resp.ok) {
      await firebaseService.clearOwnerResetCode(ownerId);
      throw Object.assign(new Error("فشل في إرسال الرسالة، حاول لاحقاً"), { code: 500 });
    }

    const maskedPhone =
      cleanPhone.slice(0, cleanPhone.length - 4).replace(/./g, "*") + cleanPhone.slice(-4);

    return { maskedPhone, expiresIn: 10 };
  }

  /**
   * Validate OTP code and set new PIN for the owner.
   */
  async setNewPassword(ownerId: string, resetCode: string, newPassword: string): Promise<void> {
    if (newPassword.length < 4) {
      throw Object.assign(new Error("الرقم السري يجب أن يكون 4 أرقام على الأقل"), { code: 400 });
    }

    const validation = await firebaseService.validateResetCode(ownerId, resetCode);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.message), { code: 400 });
    }

    await firebaseService.updateOwnerPassword(ownerId, newPassword);
  }

  /**
   * Change password — requires current password verification.
   */
  async changePassword(
    propertyNumber: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    if (newPassword.length < 4) {
      throw Object.assign(new Error("الرقم السري يجب أن يكون 4 أرقام على الأقل"), { code: 400 });
    }

    await firebaseService.syncOwnerFromProperties(propertyNumber);
    const owner = await firebaseService.getOwnerByPropertyNumber(propertyNumber);

    if (!owner) throw Object.assign(new Error("بيانات المالك غير موجودة"), { code: 404 });
    if (owner.password !== currentPassword) {
      throw Object.assign(new Error("الرقم السري الحالي غير صحيح"), { code: 400 });
    }

    await firebaseService.updateOwnerPassword(propertyNumber, newPassword);
    await firebaseService.clearOwnerResetCode(propertyNumber);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private _normalizePhone(raw: string): string {
    let phone = raw.replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "966" + phone.slice(1);
    if (!phone.startsWith("966")) phone = "966" + phone;
    return phone;
  }

  private _safeCredentialMatch(candidate: unknown, expected?: string): boolean {
    if (typeof candidate !== "string" || !expected) return false;

    const candidateBytes = Buffer.from(candidate);
    const expectedBytes = Buffer.from(expected);
    return (
      candidateBytes.length === expectedBytes.length &&
      timingSafeEqual(candidateBytes, expectedBytes)
    );
  }
}

export const authService = new AuthService();
