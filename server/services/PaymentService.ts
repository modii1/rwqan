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

    await firebaseService.updatePaymentStatus(paymentId, "مكتمل");
    console.log(`[approveBankTransfer] ✅ Payment status updated to "مكتمل"`);

    const property = await firebaseService.getPropertyByNumber(payment.propertyNumber);
    console.log(`[approveBankTransfer] Property found: ${property?.name}, packageId from payment: ${payment.packageId}`);
    
    if (property && payment.packageId) {
      console.log(`[approveBankTransfer] Processing subscription for packageId: ${payment.packageId}`);
      const pkg = await firebaseService.getPackageById(payment.packageId);
      if (pkg) {
        console.log(`[approveBankTransfer] Package found: ${pkg.name}, type: ${pkg.type}, price: ${pkg.price}, duration: ${pkg.duration}`);
        const today = getStartOfDayRiyadh();
        const currentSub = await firebaseService.getSubscriptionByPropertyNumber(payment.propertyNumber);
        console.log(`[approveBankTransfer] Current subscription: ${currentSub ? `exists (status: ${currentSub.status})` : "none"}`);

        let startDate = today;
        let endDate = calculateSubscriptionEndDate(null, pkg.duration);

        if (currentSub && new Date(currentSub.endDate) > today) {
          startDate = new Date(currentSub.endDate);
          endDate = calculateExtensionEndDate(startDate, pkg.duration);
        }

        const additionalProps = (payment as any).additionalProperties || [];
        const secondProp = (payment as any).secondPropertyNumber;
        if (secondProp && !additionalProps.includes(secondProp)) {
          additionalProps.push(secondProp);
        }
        const totalProperties = 1 + additionalProps.length;
        
        const pricePerProperty = (payment.finalAmount || pkg.price) / totalProperties;
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

        // Update property's subscriptionType to match the package
        await firebaseService.updateProperty(payment.propertyNumber, { 
          subscriptionType: isPremium ? "مميز" : "عادي" 
        });

        // Mark additional properties as pending approval (don't activate yet)
        for (const propNumber of additionalProps) {
          const additionalProperty = await firebaseService.getPropertyByNumber(propNumber);
          if (additionalProperty) {
            // Mark as pending admin approval
            await firebaseService.updateProperty(propNumber, {
              pendingApprovalFrom: payment.propertyNumber,
              subscriptionType: isPremium ? "مميز" : "عادي"
            });
            
            // Set verification status to pending
            await firebaseService.updateVerificationStatus(propNumber, "pending");
          }
        }

        // Create multi-property subscription record with pending status
        if (additionalProps.length > 0) {
          await firebaseService.createMultiPropertySubscription({
            packageId: pkg.id,
            propertyNumber1: payment.propertyNumber,
            propertyNumber2: additionalProps[0],
            additionalProperties: additionalProps,
            startDate: subscriptionData.startDate,
            endDate: subscriptionData.endDate,
            status: "نشط",
            paymentId: payment.id,
            additionalPropertiesPendingApproval: additionalProps.map(pn => ({
              propertyNumber: pn,
              status: "pending",
              requestedAt: new Date().toISOString()
            }))
          });
        }
      }
    }

    // Verification - only for main property, additional properties need admin approval
    await firebaseService.updateVerificationStatus(payment.propertyNumber, "approved");
    
    // Log verification for main property
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

    // Notify additional property owners about pending approval
    const additionalProps = (payment as any).additionalProperties || [];
    for (const propNumber of additionalProps) {
      const additionalProperty = await firebaseService.getPropertyByNumber(propNumber);
      if (additionalProperty && additionalProperty.whatsappNumber) {
        try {
          await notifyOwnerSubscriptionActivated({
            ownerPhone: additionalProperty.whatsappNumber,
            propertyNumber: propNumber,
            propertyName: additionalProperty.name ?? "",
            endDate: formatDateRiyadh(new Date()),
          });
        } catch (err) {
          console.error("❌ Failed to send additional property owner notification:", err);
        }
      }
    }
  }

  // ─── Bank Transfer: Reject ──────────────────────────────────────────────────

  async rejectBankTransfer(paymentId: string): Promise<void> {
    await firebaseService.updatePaymentStatus(paymentId, "مرفوض");

    const payment = await firebaseService.getPaymentById(paymentId);
    if (payment?.propertyNumber) {
      // Set to pending - admin should manually review and decide to reject or approve
      await firebaseService.updateVerificationStatus(payment.propertyNumber, "pending");
      await firebaseService.addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "رفض الدفع - قيد المراجعة",
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
