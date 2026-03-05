/**
 * PaymentService
 * Encapsulates payment creation, status management, Paymob integration,
 * and bank-transfer approval / rejection flows.
 */

import { firebaseService } from "../firebaseService";
import type { Payment, InsertPayment } from "../../shared/schema";
import {
  calculateSubscriptionEndDate,
  calculateExtensionEndDate,
  getStartOfDayRiyadh,
  formatDateRiyadh,
} from "../utils/dateUtils";
import { paymobService } from "../integrations/paymob";
import { notifyOwnerSubscriptionActivated } from "../integrations/whatsapp";

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
   * Approve a pending bank-transfer payment.
   * - Activates (or extends) the subscription for the property.
   * - If payment is for two properties, activates both and creates a multi-property record.
   * - Auto-approves verification for the property.
   * - Logs the verification action.
   * - Sends a WhatsApp notification to the owner.
   */
  async approveBankTransfer(paymentId: string): Promise<void> {
    const payment = await firebaseService.getPaymentById(paymentId);
    if (!payment) throw new Error("الدفع غير موجود");

    const pendingStatuses = ["قيد المراجعة", "معلق", "قيد التحقق", "pending", "نجح - قيد التحقق", "مرفوض"];
    if (!pendingStatuses.includes(payment.status)) {
      throw new Error("الدفع ليس معلقاً");
    }

    await firebaseService.updatePaymentStatus(paymentId, "مكتمل");

    const property = await firebaseService.getPropertyByNumber(payment.propertyNumber);
    if (property && payment.packageId) {
      const pkg = await firebaseService.getPackageById(payment.packageId);
      if (pkg) {
        const today = getStartOfDayRiyadh();
        const currentSub = await firebaseService.getSubscriptionByPropertyNumber(payment.propertyNumber);

        let startDate = today;
        let endDate = calculateSubscriptionEndDate(null, pkg.duration);

        if (currentSub && new Date(currentSub.endDate) > today) {
          startDate = new Date(currentSub.endDate);
          endDate = calculateExtensionEndDate(startDate, pkg.duration);
        }

        const isMultiProperty = !!(payment as any).secondPropertyNumber;
        const pricePerProperty = isMultiProperty ? payment.finalAmount / 2 : payment.finalAmount;
        const isPremium = pkg.type === "موثوق" || pkg.type === "مميز" || pricePerProperty > 0;

        const subscriptionData = {
          packageId: pkg.id,
          price: pricePerProperty,
          subscriptionType: isPremium ? "مميز" : "عادي",
          packageType: isPremium ? "مميز" : "عادي",
          startDate: formatDateRiyadh(startDate),
          endDate: formatDateRiyadh(endDate),
          paymentId: payment.id,
        };

        await firebaseService.addSubscriptionToSheet(
          payment.propertyNumber,
          subscriptionData,
          property,
          payment.receiptUrl ?? ""
        );

        if ((payment as any).secondPropertyNumber) {
          const secondProperty = await firebaseService.getPropertyByNumber((payment as any).secondPropertyNumber);
          if (secondProperty) {
            await firebaseService.addSubscriptionToSheet(
              (payment as any).secondPropertyNumber,
              { ...subscriptionData, linkedProperty: payment.propertyNumber },
              secondProperty,
              payment.receiptUrl ?? ""
            );

            await firebaseService.createMultiPropertySubscription({
              packageId: pkg.id,
              propertyNumber1: payment.propertyNumber,
              propertyNumber2: (payment as any).secondPropertyNumber,
              startDate: subscriptionData.startDate,
              endDate: subscriptionData.endDate,
              status: "نشط",
              paymentId: payment.id,
            });
          }
        }
      }
    }

    // Verification
    await firebaseService.updateVerificationStatus(payment.propertyNumber, "approved");
    if ((payment as any).secondPropertyNumber) {
      await firebaseService.updateVerificationStatus((payment as any).secondPropertyNumber, "approved");
    }

    await firebaseService.addVerificationLog({
      date: new Date().toISOString(),
      propertyNumber: payment.propertyNumber,
      action: "قبول التحقق",
      reason: "تم التأكد من صحة الإيصال وتفعيل الاشتراك",
      admin: "النظام",
    });

    // WhatsApp notification
    if (property && property.whatsappNumber && payment.packageId) {
      const pkg = await firebaseService.getPackageById(payment.packageId);
      if (pkg) {
        const notifyEndDate = calculateSubscriptionEndDate(null, pkg.duration);
        try {
          await notifyOwnerSubscriptionActivated({
            ownerPhone: property.whatsappNumber,
            propertyNumber: payment.propertyNumber,
            propertyName: property.name ?? "",
            endDate: formatDateRiyadh(notifyEndDate),
          });
        } catch (err) {
          console.error("❌ Failed to send owner notification:", err);
        }
      }
    }
  }

  // ─── Bank Transfer: Reject ──────────────────────────────────────────────────

  async rejectBankTransfer(paymentId: string): Promise<void> {
    await firebaseService.updatePaymentStatus(paymentId, "مرفوض");

    const payment = await firebaseService.getPaymentById(paymentId);
    if (payment?.propertyNumber) {
      await firebaseService.updateVerificationStatus(payment.propertyNumber, "rejected");
      await firebaseService.addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "رفض التحقق",
        reason: "إيصال دفع غير صحيح",
        admin: "النظام",
      });
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

      await firebaseService.addSubscriptionToSheet(
        payment.propertyNumber,
        {
          propertyNumber: payment.propertyNumber,
          packageId: payment.packageId,
          startDate: payment.pendingStartDate,
          endDate: payment.pendingEndDate,
          status: "نشط",
          paymentId,
          price: payment.amount ?? "",
          packageType: payment.pendingSubscriptionType ?? "مميز",
        },
        property,
        undefined
      );

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
