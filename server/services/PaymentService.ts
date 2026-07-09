/**
 * PaymentService
 * Encapsulates payment creation, status management, Paymob integration,
 * and bank-transfer approval / rejection flows.
 */

import { firebaseService } from "../firebaseService";
import type { Payment, InsertPayment } from "../../shared/schema";
import { paymobService } from "../integrations/paymob";
import { notifyOwnerSubscriptionActivated, sendOwnerWhatsApp } from "../integrations/whatsapp";
import { checkPropertyDataComplete } from "../utils/verification";
import { countR2Images } from "../utils/r2";
import {
  activateVerifiedPaymentSubscription,
  calculateActionDates,
  hasPriorSubscription,
  queueVerifiedNewPropertyForAdminApproval,
} from "../utils/paymentScenarioFlow";

export class PaymentService {
  // ─── Read ───────────────────────────────────────────────────────────────────

  async getAll(): Promise<Payment[]> {
    return firebaseService.getPayments();
  }

  async getById(id: string): Promise<Payment | null> {
    return firebaseService.getPaymentById(id);
  }

  async getByProperty(propertyNumber: string): Promise<Payment[]> {
    return firebaseService.getPaymentsByProperty(propertyNumber);
  }

  // ─── Create ─────────────────────────────────────────────────────────────────

  async create(data: InsertPayment): Promise<Payment> {
    return firebaseService.createPayment(data);
  }

  async update(id: string, updates: Partial<Payment>): Promise<Payment> {
    return firebaseService.updatePayment(id, updates);
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  async setStatus(paymentId: string, status: string): Promise<void> {
    return firebaseService.updatePaymentStatus(paymentId, status);
  }

  // ─── Bank Transfer: Approve ─────────────────────────────────────────────────

  /**
   * Approve a pending bank-transfer payment (FALLBACK path).
   *
   * The primary flow now goes through Smart Verify in the bank-transfer endpoint.
   * Old properties auto-activate when data is complete; new properties are queued
   * for admin property approval before activation. This method is only used when
   * admin manually approves a payment that couldn't be auto-verified.
   *
   * - Activates (or extends) the subscription for the property.
   * - If payment is for multiple properties, activates all and creates multi-property records.
   * - Auto-approves verification for the property.
   * - Logs the verification action.
   * - Sends a WhatsApp notification to the owner.
   */
  async approveBankTransfer(paymentId: string): Promise<void> {
    console.log(`[approveBankTransfer] Starting for paymentId: ${paymentId}`);
    const payment = await firebaseService.getPaymentById(paymentId);
    if (!payment) throw new Error("الدفع غير موجود");

    console.log(`[approveBankTransfer] Found payment: id=${payment.id}, propertyNumber="${payment.propertyNumber}", status="${payment.status}", packageId="${payment.packageId}"`);

    const pendingStatuses = ["قيد المراجعة", "معلق", "قيد التحقق", "pending", "نجح - قيد التحقق", "مرفوض"];
    if (!pendingStatuses.includes(payment.status)) {
      console.log(`[approveBankTransfer] ⚠️ Payment status "${payment.status}" not in pending statuses: ${pendingStatuses.join(", ")}`);
      throw new Error("الدفع ليس معلقاً");
    }

    const mainPropertyForApproval = await firebaseService.getPropertyByNumber(payment.propertyNumber);
    if (!mainPropertyForApproval) {
      await firebaseService.updatePaymentStatus(paymentId, "مرفوض");
      throw new Error("العقار غير موجود");
    }

    if (!payment.packageId) {
      await firebaseService.updatePaymentStatus(paymentId, "مرفوض");
      throw new Error("الباقة غير موجودة");
    }

    const pkg = await firebaseService.getPackageById(payment.packageId);
    if (!pkg) {
      await firebaseService.updatePaymentStatus(paymentId, "مرفوض");
      throw new Error("الباقة غير موجودة");
    }

    const mainR2ImageCount = await countR2Images(payment.propertyNumber);
    const mainDataCheck = await checkPropertyDataComplete(mainPropertyForApproval, mainR2ImageCount);
    if (!mainDataCheck.isComplete) {
      await firebaseService.updatePayment(paymentId, {
        status: "قيد المراجعة",
        notes: `بيانات العقار غير مكتملة: ${mainDataCheck.missingFields.join("، ")}`,
      } as any);
      await firebaseService.updateVerificationStatus(payment.propertyNumber, "pending");
      await firebaseService.addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "تعذر التحقق",
        reason: `بيانات العقار غير مكتملة: ${mainDataCheck.missingFields.join("، ")}`,
        admin: "النظام",
      });
      if (mainPropertyForApproval.whatsappNumber) {
        await sendOwnerWhatsApp(
          mainPropertyForApproval.whatsappNumber,
          `تعذر إكمال التحقق لعقارك ${mainPropertyForApproval.name || payment.propertyNumber} لأن البيانات غير مكتملة.\n\nالحقول المطلوبة: ${mainDataCheck.missingFields.join("، ")}\n\nالخطوة التالية: عدّل بيانات العقار وارفع الصور المطلوبة ثم شغّل التحقق من صفحة الاشتراك.`,
        ).catch(err => console.error("Failed to notify owner about rejection:", err));
      }
      throw new Error(`بيانات العقار غير مكتملة: ${mainDataCheck.missingFields.join("، ")}`);
    }

    const currentSub = await firebaseService.getSubscriptionByPropertyNumber(payment.propertyNumber);
    const calculatedDates = calculateActionDates((payment as any).action, currentSub, pkg.duration);
    if (!hasPriorSubscription(currentSub)) {
      await queueVerifiedNewPropertyForAdminApproval({
        payment,
        property: mainPropertyForApproval,
        pkg,
        startDate: (payment as any).pendingStartDate || calculatedDates.startDate,
        endDate: (payment as any).pendingEndDate || calculatedDates.endDate,
        finalAmount: payment.finalAmount || pkg.price,
      });
      await firebaseService.addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "قبول الدفع",
        reason: "تم قبول الدفع والتحقق من البيانات - العقار الجديد ينتظر اعتماد الإدارة",
        admin: "النظام",
      });
      if (mainPropertyForApproval.whatsappNumber) {
        await sendOwnerWhatsApp(
          mainPropertyForApproval.whatsappNumber,
          `تم التحقق من الدفع وبيانات العقار ${mainPropertyForApproval.name || payment.propertyNumber} بنجاح.\n\nلأن العقار جديد، سيبقى الطلب بانتظار اعتماد الإدارة قبل تفعيل الاشتراك.`,
        ).catch(err => console.error("Failed to notify owner about pending approval:", err));
      }
      return;
    }

    const activation = await activateVerifiedPaymentSubscription({
      payment,
      property: mainPropertyForApproval,
      pkg,
      receiptUrl: payment.receiptUrl ?? "",
      startDate: (payment as any).pendingStartDate || calculatedDates.startDate,
      endDate: (payment as any).pendingEndDate || calculatedDates.endDate,
      finalAmount: payment.finalAmount || pkg.price,
    });

    await firebaseService.updatePayment(paymentId, {
      status: "مكتمل",
      completedAt: new Date().toISOString(),
    } as any);
    await firebaseService.addVerificationLog({
      date: new Date().toISOString(),
      propertyNumber: payment.propertyNumber,
      action: "قبول التحقق",
      reason: "تمت الموافقة اليدوية على الدفع بعد اكتمال بيانات العقار",
      admin: "النظام",
    });

    if (mainPropertyForApproval.whatsappNumber) {
      try {
        await notifyOwnerSubscriptionActivated({
          ownerPhone: mainPropertyForApproval.whatsappNumber,
          propertyNumber: payment.propertyNumber,
          propertyName: mainPropertyForApproval.name ?? "",
          endDate: activation.endDate,
        });
      } catch (err) {
        console.error("❌ Failed to send owner notification:", err);
      }
    }

    return;
  }

  // ─── Bank Transfer: Reject ──────────────────────────────────────────────────

  async rejectBankTransfer(paymentId: string): Promise<void> {
    await firebaseService.updatePaymentStatus(paymentId, "مرفوض");

    const payment = await firebaseService.getPaymentById(paymentId);
    if (payment?.propertyNumber) {
      // Cancel linked property subscriptions first (before main, to avoid duplicate cascading)
      const additionalProps: string[] = (payment as any).additionalProperties || [];
      const secondProp = (payment as any).secondPropertyNumber;
      if (secondProp && !additionalProps.includes(secondProp)) {
        additionalProps.push(secondProp);
      }
      for (const pn of additionalProps) {
        await firebaseService.cancelSubscription(pn, "تم رفض الدفع — تراجع عن العقارات المرتبطة");
      }

      await firebaseService.updateVerificationStatus(payment.propertyNumber, "rejected");
      await firebaseService.addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "رفض الدفع",
        reason: "إيصال دفع غير صحيح",
        admin: "النظام",
      });
      
      // Cancel the subscription when payment is rejected
      await firebaseService.cancelSubscription(payment.propertyNumber, "تم رفض الدفع");
    }
  }

  // ─── Paymob ─────────────────────────────────────────────────────────────────

  async createPaymobIntention(...args: Parameters<typeof paymobService.createIntention>) {
    return paymobService.createIntention(...args);
  }

  async createPaymobAddonPayment(...args: Parameters<typeof paymobService.initiateAddOnPayment>) {
    return paymobService.initiateAddOnPayment(...args);
  }

  async inquiryByOrderId(orderId: string) {
    return paymobService.inquiryByOrderId(orderId);
  }

  async inquiryByReference(ref: string) {
    return paymobService.inquiryBySpecialReference(ref);
  }

  // ─── Manual Confirmation ─────────────────────────────────────────────────────

  async confirmManually(paymentId: string): Promise<void> {
    const payment = await firebaseService.getPaymentById(paymentId);
    if (!payment) throw new Error("الدفعة غير موجودة");
    if (payment.status === "مكتمل") throw new Error("الدفعة مكتملة مسبقاً");

    await firebaseService.updatePayment(paymentId, {
      status: "مكتمل",
      completedAt: new Date().toISOString(),
      paymentMethod: (payment.paymentMethod as any) ?? "تأكيد يدوي",
    });

    if (payment.pendingStartDate && payment.pendingEndDate) {
      const property = await firebaseService.getPropertyByNumber(payment.propertyNumber);

      // Gather linked/additional properties from the payment record
      const additionalProps: string[] = (payment as any).additionalProperties || [];
      const secondProp = (payment as any).secondPropertyNumber;
      if (secondProp && !additionalProps.includes(secondProp)) {
        additionalProps.push(secondProp);
      }

      const subscriptionData = {
        propertyNumber: payment.propertyNumber,
        packageId: payment.packageId,
        startDate: payment.pendingStartDate,
        endDate: payment.pendingEndDate,
        status: "نشط",
        paymentId,
        price: payment.amount ?? "",
        packageType: payment.pendingSubscriptionType ?? "مميز",
        linkedProperties: additionalProps.length > 0 ? additionalProps : undefined,
        propertyCount: 1 + additionalProps.length,
      };

      await firebaseService.addSubscriptionToSheet(
        payment.propertyNumber,
        subscriptionData,
        property,
        undefined
      );

      // Activate linked/additional properties with the same dates — sync BOTH docs
      // and force verification=approved so linked props never lag behind the main.
      const linkedSyncType = (payment.pendingSubscriptionType ?? "مميز") as string;
      for (const propNumber of additionalProps) {
        const additionalProperty = await firebaseService.getPropertyByNumber(propNumber);
        if (additionalProperty) {
          await firebaseService.syncLinkedProperty(propNumber, payment.propertyNumber, {
            subscriptionType: linkedSyncType,
            startDate: payment.pendingStartDate,
            endDate: payment.pendingEndDate,
            status: "نشط",
            paymentId,
            packageId: payment.packageId,
          });
          console.log(`[confirmManually] ✅ Linked property synced (sub + property + approved): ${propNumber}`);
        }
      }

      if (property?.whatsappNumber) {
        try {
          await notifyOwnerSubscriptionActivated({
            ownerPhone: property.whatsappNumber,
            propertyNumber: payment.propertyNumber,
            propertyName: property.name ?? "",
            endDate: payment.pendingEndDate,
          });
        } catch (err) {
          console.error("❌ Failed to send owner notification:", err);
        }
      }
    }
  }
}

export const paymentService = new PaymentService();
