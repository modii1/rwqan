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
  capAtMaxDays,
  getStartOfDayRiyadh,
  formatDateRiyadh,
} from "../utils/dateUtils";
import { paymobService } from "../integrations/paymob";
import { notifyOwnerSubscriptionActivated } from "../integrations/whatsapp";
import { checkPropertyDataComplete } from "../utils/verification";
import { countR2Images } from "../utils/r2";

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

        // For upgrades/changes use the pending dates saved at payment creation time
        const pendingStart = (payment as any).pendingStartDate;
        const pendingEnd = (payment as any).pendingEndDate;
        if (pendingStart && pendingEnd) {
          startDate = new Date(pendingStart);
          endDate = capAtMaxDays(new Date(pendingEnd));
        } else if ((payment as any).action === 'extend' && currentSub && new Date(currentSub.endDate) > today) {
          // Extend only: append after current subscription ends
          startDate = new Date(currentSub.endDate);
          endDate = calculateExtensionEndDate(startDate, pkg.duration);
        }
        // For multi-property packages OR new subscriptions → always start from today
        // This prevents double-counting remaining days on main property

        const additionalProps: string[] = (payment as any).additionalProperties || [];
        const secondProp = (payment as any).secondPropertyNumber;
        if (secondProp && !additionalProps.includes(secondProp)) {
          additionalProps.push(secondProp);
        }

        // If no additional properties were specified in the payment,
        // look up existing linked properties from the current subscription
        // and the multi-property subscriptions collection.
        // This ensures that when extending/upgrading, ALL linked properties
        // get the same subscription dates (whether main or added property initiated it).
        if (additionalProps.length === 0) {
          // Check current subscription's linkedProperties array
          if (currentSub?.linkedProperties && currentSub.linkedProperties.length > 0) {
            for (const lp of currentSub.linkedProperties) {
              if (lp !== payment.propertyNumber && !additionalProps.includes(lp)) {
                additionalProps.push(lp);
              }
            }
          }

          // Check if this property is a linked (secondary) property pointing to a main
          if (currentSub?.linkedProperty) {
            const mainPropNumber = currentSub.linkedProperty;
            if (!additionalProps.includes(mainPropNumber)) {
              additionalProps.push(mainPropNumber);
            }
            // Also get other linked properties from the main property's subscription
            const mainSub = await firebaseService.getSubscriptionByPropertyNumber(mainPropNumber);
            if (mainSub?.linkedProperties) {
              for (const lp of mainSub.linkedProperties) {
                if (lp !== payment.propertyNumber && !additionalProps.includes(lp)) {
                  additionalProps.push(lp);
                }
              }
            }
          }

          // Also check multi_property_subscriptions collection
          if (additionalProps.length === 0) {
            const multiSubs = await firebaseService.getMultiPropertySubscriptions();
            const activeGroup = multiSubs.find(
              ms => ms.status === "نشط" && (
                ms.propertyNumber1 === payment.propertyNumber ||
                ms.propertyNumber2 === payment.propertyNumber ||
                (ms.additionalProperties && ms.additionalProperties.includes(payment.propertyNumber))
              )
            );
            if (activeGroup) {
              if (activeGroup.propertyNumber1 !== payment.propertyNumber && !additionalProps.includes(activeGroup.propertyNumber1)) {
                additionalProps.push(activeGroup.propertyNumber1);
              }
              if (activeGroup.propertyNumber2 && activeGroup.propertyNumber2 !== payment.propertyNumber && !additionalProps.includes(activeGroup.propertyNumber2)) {
                additionalProps.push(activeGroup.propertyNumber2);
              }
              if (activeGroup.additionalProperties) {
                for (const ap of activeGroup.additionalProperties) {
                  if (ap !== payment.propertyNumber && !additionalProps.includes(ap)) {
                    additionalProps.push(ap);
                  }
                }
              }
            }
          }

          if (additionalProps.length > 0) {
            console.log(`[approveBankTransfer] 🔗 Found ${additionalProps.length} linked properties to sync: ${additionalProps.join(', ')}`);
          }
        }

        const totalProperties = 1 + additionalProps.length;
        
        const pricePerProperty = (payment.finalAmount || pkg.price) / totalProperties;
        const isPremium = pkg.type === "مميز" || pricePerProperty > 0;

        const subscriptionData = {
          packageId: pkg.id,
          price: pricePerProperty,
          subscriptionType: isPremium ? "مميز" : "عادي",
          packageType: isPremium ? "مميز" : "عادي",
          startDate: formatDateRiyadh(startDate),
          endDate: formatDateRiyadh(endDate),
          paymentId: payment.id,
          linkedProperties: additionalProps.length > 0 ? additionalProps : undefined,
          propertyCount: totalProperties,
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

        // Activate linked/additional properties with the SAME subscription dates
        const activatedLinkedPropertyNumbers: string[] = [];
        try {
          for (const propNumber of additionalProps) {
            const additionalProperty = await firebaseService.getPropertyByNumber(propNumber);
            if (additionalProperty) {
              // Create a real subscription for the linked property (same dates as main)
              await firebaseService.addSubscriptionToSheet(
                propNumber,
                {
                  ...subscriptionData,
                  linkedProperty: payment.propertyNumber,
                  linkedProperties: undefined,
                  propertyCount: undefined,
                },
                additionalProperty,
                payment.receiptUrl ?? ""
              );

              // Approve the linked property — linked props inherit the main's verified state
              // (force approved, do NOT smart-verify, which previously left linked props pending
              // while the main was active — the "active parent, inactive linked" bug).
              await firebaseService.updateProperty(propNumber, {
                pendingApprovalFrom: undefined,
                subscriptionType: isPremium ? "مميز" : "عادي"
              });
              await firebaseService.updateVerificationStatus(propNumber, "approved");
              console.log(`[approveBankTransfer] ✅ Linked property ${propNumber} approved (inherits main's verification)`);
              activatedLinkedPropertyNumbers.push(propNumber);
            }
          }
        } catch (linkErr) {
          // Rollback: if any linked property activation fails, cancel what was already activated
          console.error(`[approveBankTransfer] ❌ Failed to activate linked properties, rolling back:`, linkErr);
          for (const pn of activatedLinkedPropertyNumbers) {
            await firebaseService.cancelSubscription(pn, "فشل تفعيل العقارات المرتبطة — تراجع");
          }
          throw new Error("فشل في تفعيل العقارات المرتبطة");
        }

        // Create or update multi-property subscription record
        if (additionalProps.length > 0) {
          // Check if there's an existing multi-property subscription to update
          const existingMultiSubs = await firebaseService.getMultiPropertySubscriptions();
          const existingGroup = existingMultiSubs.find(
            ms => ms.propertyNumber1 === payment.propertyNumber ||
              ms.propertyNumber2 === payment.propertyNumber ||
              (ms.additionalProperties && ms.additionalProperties.includes(payment.propertyNumber))
          );
          
          if (existingGroup) {
            // Update existing group with new dates
            await firebaseService.updateMultiPropertySubscription(existingGroup.id, {
              startDate: subscriptionData.startDate,
              endDate: subscriptionData.endDate,
              status: "نشط",
              paymentId: payment.id,
            });
            console.log(`[approveBankTransfer] 🔄 Updated existing multi-property group: ${existingGroup.id}`);
          } else {
            await firebaseService.createMultiPropertySubscription({
              packageId: pkg.id,
              propertyNumber1: payment.propertyNumber,
              propertyNumber2: additionalProps[0],
              additionalProperties: additionalProps,
              startDate: subscriptionData.startDate,
              endDate: subscriptionData.endDate,
              status: "نشط",
              paymentId: payment.id,
            });
          }
        }
      }
    }

    // Smart Verification - check data completeness before approving
    const mainProperty = property || await firebaseService.getPropertyByNumber(payment.propertyNumber);
    if (mainProperty) {
      const mainR2ImageCount = await countR2Images(payment.propertyNumber);
      const mainDataCheck = await checkPropertyDataComplete(mainProperty, mainR2ImageCount);
      if (mainDataCheck.isComplete) {
        await firebaseService.updateVerificationStatus(payment.propertyNumber, "approved");
        console.log(`[approveBankTransfer] ✅ Smart verify: ${payment.propertyNumber} - data complete`);
        
        await firebaseService.addVerificationLog({
          date: new Date().toISOString(),
          propertyNumber: payment.propertyNumber,
          action: "قبول التحقق",
          reason: "تم التأكد من صحة الإيصال واكتمال بيانات العقار",
          admin: "النظام",
        });
      } else {
        await firebaseService.updateVerificationStatus(payment.propertyNumber, "rejected");
        // Reject the payment since property data is incomplete
        await firebaseService.updatePaymentStatus(paymentId, "مرفوض");
        await firebaseService.cancelSubscription(payment.propertyNumber, "بيانات العقار غير مكتملة");
        console.log(`[approveBankTransfer] ❌ Rejected: ${payment.propertyNumber} - missing: ${mainDataCheck.missingFields.join(', ')}`);
        
        // Rollback linked property subscriptions that were already created
        const additionalProps = (payment as any).additionalProperties || [];
        const secondProp = (payment as any).secondPropertyNumber;
        if (secondProp && !additionalProps.includes(secondProp)) additionalProps.push(secondProp);
        for (const pn of additionalProps) {
          await firebaseService.cancelSubscription(pn, "تم رفض الدفع — تراجع عن العقارات المرتبطة");
        }

        await firebaseService.addVerificationLog({
          date: new Date().toISOString(),
          propertyNumber: payment.propertyNumber,
          action: "رفض التحقق",
          reason: `بيانات العقار غير مكتملة: ${mainDataCheck.missingFields.join('، ')}`,
          admin: "النظام",
        });
        
        throw new Error(`بيانات العقار غير مكتملة: ${mainDataCheck.missingFields.join('، ')}`);
      }
    } else {
      await firebaseService.updateVerificationStatus(payment.propertyNumber, "approved");
      
      await firebaseService.addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "قبول التحقق",
        reason: "تم التأكد من صحة الإيصال وتفعيل الاشتراك",
        admin: "النظام",
      });
    }

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
