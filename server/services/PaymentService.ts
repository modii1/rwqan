/**
 * PaymentService
 * Encapsulates payment creation, status management, Paymob integration,
 * and bank-transfer approval / rejection flows.
 */

import { firebaseService } from "../firebaseService";
import type { Payment, InsertPayment } from "../../shared/schema";
import { paymobService } from "../integrations/paymob";
import { notifyOwnerSubscriptionActivated, sendPropertyOwnerWhatsApp } from "../integrations/whatsapp";
import {
  AdminApprovalError,
  PartialMutationError,
  runAdminApprovalStage,
} from "../errors/AdminApprovalError";
import { adminApprovalService } from "./AdminApprovalService";
import {
  activateVerifiedPaymentSubscription,
  calculateActionDates,
  hasPriorSubscription,
  normalizeSubscriptionBoundaryEndDate,
  normalizeLinkedPropertyNumbers,
  queueVerifiedNewPropertyForAdminApproval,
  resolvePaymentPropertyPlan,
} from "../utils/paymentScenarioFlow";
import { assertPropertyNotSuspended } from "./propertySuspension";
import {
  getExactPaymobPaymentMethod,
  isGenericPaymobPaymentMethod,
} from "../utils/paymobPaymentMethod";

function hasAnyPaymobIdentity(payment: Payment): boolean {
  const paymentMethod = String(payment.paymentMethod || "").trim();
  // Strong provider identity always wins over a potentially stale or corrupt
  // display label. Only an identity-free bank-transfer record may enter the
  // manual approval/rejection path.
  const hasStrongProviderIdentity = Boolean(
    String(payment.merchantAttemptKey || "").trim() ||
    String(payment.paymentCheckoutUrl || "").trim() ||
    String(payment.paymobOrderId || "").trim() ||
    String(payment.transactionId || "").trim() ||
    String(payment.intentionState || "").trim()
  );
  if (hasStrongProviderIdentity) return true;
  if (paymentMethod === "تحويل بنكي") return false;
  const methodSignalsElectronicProvider = Boolean(
    paymentMethod &&
    paymentMethod !== "بطاقة" &&
    paymentMethod !== "تأكيد يدوي",
  );
  return Boolean(
    String(payment.paymentReference || "").trim() ||
    String(payment.merchantAttemptKey || "").trim() ||
    String(payment.paymentCheckoutUrl || "").trim() ||
    String(payment.paymobOrderId || "").trim() ||
    String(payment.transactionId || "").trim() ||
    String(payment.intentionState || "").trim() ||
    methodSignalsElectronicProvider,
  );
}

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

  /**
   * Approve a payment from the admin dashboard.
   *
   * A current Paymob checkout is not a bank transfer and cannot be manually
   * asserted as paid. It must first be matched to the exact provider
   * intention, attempt, amount, order and signed transaction. Any partial or
   * ambiguous Paymob identity fails closed; only identity-free legacy records
   * retain the existing manual fallback.
   */
  async approveAdminPayment(paymentId: string): Promise<{
    outcome: "queued" | "activated";
    alreadyProcessed?: boolean;
  }> {
    const payment = await runAdminApprovalStage(
      () => firebaseService.getPaymentById(paymentId),
      {
        status: 503,
        code: "PAYMENT_LOOKUP_FAILED",
        message:
          "تعذر تحميل بيانات الدفع حالياً. تحقق من الاتصال بقاعدة البيانات ثم حاول مرة أخرى.",
      },
    );
    if (!payment) {
      throw new AdminApprovalError({
        status: 404,
        code: "PAYMENT_NOT_FOUND",
        message: "الدفع المطلوب غير موجود.",
      });
    }

    if (!hasAnyPaymobIdentity(payment)) {
      return this.approveBankTransfer(paymentId);
    }

    const reconciliation = await this.reconcilePaymobIntention(paymentId, {
      propagateActivationError: true,
      repairProcessedMetadata: true,
    });
    switch (reconciliation.status) {
      case "paid":
        if (reconciliation.activation === "pending") {
          throw new AdminApprovalError({
            status: 409,
            code: "PAYMENT_ACTIVATION_FAILED",
            message:
              "أكد Paymob الدفع، لكن لم يكتمل تفعيل الاشتراك. راجع بيانات العقار وحالة الاشتراك قبل إعادة المحاولة.",
          });
        }
        return { outcome: reconciliation.activation };
      case "already_processed":
        return { outcome: "activated", alreadyProcessed: true };
      case "unpaid":
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_PAYMENT_NOT_PAID",
          message:
            "لم يؤكد Paymob اكتمال هذه الدفعة، لذلك لم يتم تفعيل الاشتراك. تحقق من العملية لدى Paymob ولا تعتمدها يدوياً.",
        });
      case "provider_unavailable":
        throw new AdminApprovalError({
          status: 503,
          code: "PAYMOB_PROVIDER_UNAVAILABLE",
          message:
            "تعذر التحقق من حالة الدفعة لدى Paymob حالياً. لم يتم تفعيل الاشتراك؛ حاول مرة أخرى بعد قليل.",
        });
      case "identity_mismatch":
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
          message:
            "بيانات دفعة Paymob لا تطابق محاولة الدفع المسجلة أو العملية الموقعة. لم يتم التفعيل ويجب مراجعة العملية.",
        });
      case "not_supported":
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_PAYMENT_NOT_RECONCILABLE",
          message:
            "لا يمكن مطابقة دفعة Paymob هذه بأمان من شاشة الاشتراكات. لم يتم تفعيل الاشتراك.",
        });
    }
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
  async approveBankTransfer(paymentId: string): Promise<{
    outcome: "queued" | "activated";
    alreadyProcessed?: boolean;
  }> {
    console.log(`[approveBankTransfer] Starting for paymentId: ${paymentId}`);
    const payment = await runAdminApprovalStage(
      () => firebaseService.getPaymentById(paymentId),
      {
        status: 503,
        code: "PAYMENT_LOOKUP_FAILED",
        message:
          "تعذر تحميل بيانات الدفع حالياً. تحقق من الاتصال بقاعدة البيانات ثم حاول مرة أخرى.",
      },
    );
    if (!payment) {
      throw new AdminApprovalError({
        status: 404,
        code: "PAYMENT_NOT_FOUND",
        message: "الدفع المطلوب غير موجود.",
      });
    }

    // This durable completion marker is written only after every property and
    // unlink mutation for the queue succeeds. The earlier pending flag alone
    // may represent a partial write that still needs stale-claim recovery.
    if (
      payment.propertyApprovalQueuedAt &&
      payment.pendingPropertyApproval &&
      payment.status === "نجح - قيد التحقق"
    ) {
      return { outcome: "queued", alreadyProcessed: true };
    }

    await assertPropertyNotSuspended(payment.propertyNumber);

    console.log(`[approveBankTransfer] Found payment: id=${payment.id}, propertyNumber="${payment.propertyNumber}", status="${payment.status}", packageId="${payment.packageId}"`);

    const pendingStatuses = ["قيد المراجعة", "معلق", "قيد التحقق", "pending", "نجح - قيد التحقق", "مرفوض"];
    if (!pendingStatuses.includes(payment.status)) {
      console.log(`[approveBankTransfer] ⚠️ Payment status "${payment.status}" not in pending statuses: ${pendingStatuses.join(", ")}`);
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_NOT_PENDING",
        message:
          "لا يمكن قبول هذا الدفع لأن حالته لم تعد معلقة. حدّث الصفحة وتحقق من الحالة الحالية.",
      });
    }

    if (!payment.packageId) {
      throw new AdminApprovalError({
        status: 422,
        code: "PAYMENT_PACKAGE_MISSING",
        message:
          "لا توجد باقة مرتبطة بهذا الدفع. حدّث بيانات الدفع قبل محاولة القبول.",
      });
    }

    const pkg = await runAdminApprovalStage(
      () => firebaseService.getPackageById(payment.packageId!),
      {
        status: 503,
        code: "PACKAGE_LOOKUP_FAILED",
        message:
          "تعذر تحميل الباقة المرتبطة بالدفع حالياً. حدّث الصفحة ثم حاول مرة أخرى.",
      },
    );
    if (!pkg) {
      throw new AdminApprovalError({
        status: 404,
        code: "PACKAGE_NOT_FOUND",
        message: "الباقة المرتبطة بالدفع غير موجودة أو حُذفت.",
      });
    }

    // This read-only preflight must finish before any approval or fulfillment
    // mutation. It uses the live R2 object count and returns structured errors.
    const { property: mainPropertyForApproval } =
      await adminApprovalService.requireCompleteProperty(payment.propertyNumber);

    const currentSub = await runAdminApprovalStage(
      () =>
        firebaseService.getSubscriptionByPropertyNumber(
          payment.propertyNumber,
        ),
      {
        status: 503,
        code: "SUBSCRIPTION_LOOKUP_FAILED",
        message:
          "تعذر تحميل حالة الاشتراك الحالية. حدّث الصفحة ثم حاول مرة أخرى.",
      },
    );
    const propertyPlan = await runAdminApprovalStage(
      () => resolvePaymentPropertyPlan(payment, pkg, currentSub),
      {
        status: 503,
        code: "SUBSCRIPTION_PREPARATION_FAILED",
        message:
          "تعذر تحديد العقارات المرتبطة بهذا الدفع. حدّث الصفحة وراجع روابط العقارات قبل إعادة المحاولة.",
      },
    );
    await adminApprovalService.requireCompleteLinkedProperties(
      propertyPlan.kept,
    );
    const calculatedDates = await runAdminApprovalStage(
      () => calculateActionDates((payment as any).action, currentSub, pkg.duration),
      {
        status: 500,
        code: "SUBSCRIPTION_PREPARATION_FAILED",
        message:
          "تعذر تجهيز مدة الاشتراك من بيانات الدفع والباقة. راجع الباقة وتواريخ الدفع قبل إعادة المحاولة.",
      },
    );
    if (!hasPriorSubscription(currentSub)) {
      const queued = await runAdminApprovalStage(
        () =>
          queueVerifiedNewPropertyForAdminApproval({
            payment,
            property: mainPropertyForApproval,
            pkg,
            startDate:
              (payment as any).pendingStartDate || calculatedDates.startDate,
            endDate:
              (payment as any).pendingEndDate || calculatedDates.endDate,
            finalAmount: payment.finalAmount || pkg.price,
            propertyPlan,
            allowedPaymentStatuses: [String(payment.status || "")],
          }),
        {
          status: 500,
          code: "PAYMENT_QUEUE_FAILED",
          message:
            "تعذر إكمال وضع الدفع والعقار في انتظار اعتماد الإدارة. حدّث الصفحة وتحقق من حالتهما قبل إعادة المحاولة.",
        },
      );
      if (queued.alreadyFulfilled) {
        return { outcome: "activated", alreadyProcessed: true };
      }
      if (queued.alreadyQueued) {
        return { outcome: "queued", alreadyProcessed: true };
      }
      await firebaseService.addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "قبول الدفع",
        reason: "تم قبول الدفع والتحقق من البيانات - العقار الجديد ينتظر اعتماد الإدارة",
        admin: "النظام",
      }).catch((error) =>
        console.error("Failed to add queued-payment verification log:", error),
      );
      if (mainPropertyForApproval.whatsappNumber) {
        await sendPropertyOwnerWhatsApp({
          ownerPhone: mainPropertyForApproval.whatsappNumber,
          propertyNumber: payment.propertyNumber,
          message: `تم التحقق من الدفع وبيانات العقار ${mainPropertyForApproval.name || payment.propertyNumber} بنجاح.\n\nلأن العقار جديد، سيبقى الطلب بانتظار اعتماد الإدارة قبل تفعيل الاشتراك.`,
        }).catch(err => console.error("Failed to notify owner about pending approval:", err));
      }
      return { outcome: "queued" };
    }

    const activation = await runAdminApprovalStage(
      () =>
        activateVerifiedPaymentSubscription({
          payment,
          property: mainPropertyForApproval,
          pkg,
          receiptUrl: payment.receiptUrl ?? "",
          startDate:
            (payment as any).pendingStartDate || calculatedDates.startDate,
          endDate:
            (payment as any).pendingEndDate || calculatedDates.endDate,
          finalAmount: payment.finalAmount || pkg.price,
          propertyPlan,
          allowedPaymentStatuses: [String(payment.status || "")],
        }),
      {
        status: 500,
        code: "PAYMENT_ACTIVATION_FAILED",
        message:
          "تعذر إكمال تفعيل الاشتراك. قد تكون بعض خطوات التفعيل حُفظت؛ حدّث الصفحة وتحقق من حالة العقار والدفع قبل إعادة المحاولة.",
      },
    );

    if (activation.alreadyFulfilled) {
      return { outcome: "activated", alreadyProcessed: true };
    }

    await runAdminApprovalStage(
      () =>
        firebaseService.updatePayment(paymentId, {
          status: "مكتمل",
          completedAt: new Date().toISOString(),
        } as any),
      {
        status: 500,
        code: "APPROVAL_PARTIALLY_COMPLETED",
        message:
          "تم تفعيل الاشتراك، لكن تعذر إنهاء حالة الدفع. حدّث الصفحة وراجع الدفع قبل تنفيذ أي محاولة أخرى.",
        partial: true,
      },
    );
    await firebaseService.addVerificationLog({
      date: new Date().toISOString(),
      propertyNumber: payment.propertyNumber,
      action: "قبول التحقق",
      reason: "تمت الموافقة اليدوية على الدفع بعد اكتمال بيانات العقار",
      admin: "النظام",
    }).catch((error) =>
      console.error("Failed to add payment approval verification log:", error),
    );

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

    return { outcome: "activated" };
  }

  // ─── Bank Transfer: Reject ──────────────────────────────────────────────────

  /**
   * Reject a payment from the admin dashboard.
   *
   * Modern Paymob attempts fail closed: a confirmed payment is reconciled and
   * activated instead of rejected, while an unpaid or unreadable provider
   * state remains recoverable for the signed callback / timeout scheduler.
   */
  async rejectAdminPayment(paymentId: string): Promise<void> {
    const payment = await runAdminApprovalStage(
      () => firebaseService.getPaymentById(paymentId),
      {
        status: 503,
        code: "PAYMENT_LOOKUP_FAILED",
        message:
          "تعذر تحميل بيانات الدفع قبل الرفض. تحقق من الاتصال بقاعدة البيانات ثم حاول مرة أخرى.",
      },
    );
    if (!payment) {
      throw new AdminApprovalError({
        status: 404,
        code: "PAYMENT_NOT_FOUND",
        message: "الدفع المطلوب رفضه غير موجود.",
      });
    }

    if (!hasAnyPaymobIdentity(payment)) {
      return this.rejectBankTransfer(paymentId);
    }

    const reconciliation = await this.reconcilePaymobIntention(paymentId, {
      propagateActivationError: true,
      repairProcessedMetadata: true,
    });
    switch (reconciliation.status) {
      case "paid":
      case "already_processed":
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_PAYMENT_ALREADY_PAID",
          message:
            "أكد Paymob اكتمال هذه الدفعة، لذلك تمت مطابقتها ولم تُرفض. حدّث الصفحة وراجع حالة الاشتراك.",
        });
      case "unpaid":
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_REJECTION_DEFERRED",
          message:
            "لم يؤكد Paymob الدفع بعد. تُركت المحاولة قابلة لاستقبال النتيجة الموقعة، وسيتولى النظام إنهاء مهلة الدفع تلقائياً إن بقيت غير مدفوعة.",
        });
      case "provider_unavailable":
        throw new AdminApprovalError({
          status: 503,
          code: "PAYMOB_PROVIDER_UNAVAILABLE",
          message:
            "تعذر التحقق من حالة الدفعة لدى Paymob حالياً. لم يتم رفضها حتى لا تضيع نتيجة دفع متأخرة؛ حاول مرة أخرى لاحقاً.",
        });
      case "identity_mismatch":
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
          message:
            "بيانات دفعة Paymob لا تطابق محاولة الدفع المسجلة أو العملية الموقعة. لم يتم رفضها ويجب مراجعة العملية.",
        });
      case "not_supported":
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_PAYMENT_NOT_RECONCILABLE",
          message:
            "لا يمكن مطابقة دفعة Paymob هذه بأمان من شاشة الاشتراكات. لم يتم رفضها.",
        });
    }
  }

  async rejectBankTransfer(paymentId: string): Promise<void> {
    const payment = await runAdminApprovalStage(
      () => firebaseService.getPaymentById(paymentId),
      {
        status: 503,
        code: "PAYMENT_LOOKUP_FAILED",
        message:
          "تعذر تحميل بيانات الدفع قبل الرفض. تحقق من الاتصال بقاعدة البيانات ثم حاول مرة أخرى.",
      },
    );
    if (!payment) {
      throw new AdminApprovalError({
        status: 404,
        code: "PAYMENT_NOT_FOUND",
        message: "الدفع المطلوب رفضه غير موجود.",
      });
    }

    if (payment.status === "مرفوض") return;

    const rejectableStatuses = [
      "قيد المراجعة",
      "معلق",
      "قيد التحقق",
      "pending",
      "نجح - قيد التحقق",
    ];
    if (!rejectableStatuses.includes(String(payment.status || ""))) {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_NOT_PENDING",
        message:
          "لا يمكن رفض هذا الدفع لأن حالته لم تعد قابلة للرفض. حدّث الصفحة وتحقق من الحالة الحالية.",
      });
    }

    const mainSubscription = await runAdminApprovalStage(
      () =>
        firebaseService.getSubscriptionByPropertyNumber(
          payment.propertyNumber,
        ),
      {
        status: 503,
        code: "SUBSCRIPTION_LOOKUP_FAILED",
        message:
          "تعذر تحميل اشتراك العقار قبل رفض الدفع. حدّث الصفحة ثم حاول مرة أخرى.",
      },
    );
    const mainSubscriptionOwnedByPayment =
      mainSubscription?.paymentId === payment.id;
    const linkedPropertyNumbers = new Set(
      normalizeLinkedPropertyNumbers(payment as any, payment.propertyNumber),
    );
    if (mainSubscriptionOwnedByPayment) {
      for (const linkedPropertyNumber of
        mainSubscription?.linkedProperties ?? []) {
        linkedPropertyNumbers.add(linkedPropertyNumber);
      }
    }
    const linkedSubscriptions = new Map<
      string,
      Awaited<ReturnType<typeof firebaseService.getSubscriptionByPropertyNumber>>
    >();
    for (const linkedPropertyNumber of linkedPropertyNumbers) {
      const linkedSubscription = await runAdminApprovalStage(
        () =>
          firebaseService.getSubscriptionByPropertyNumber(
            linkedPropertyNumber,
          ),
        {
          status: 503,
          code: "SUBSCRIPTION_LOOKUP_FAILED",
          message: `تعذر تحميل اشتراك العقار المرتبط ${linkedPropertyNumber} قبل رفض الدفع. حدّث الصفحة ثم حاول مرة أخرى.`,
        },
      );
      linkedSubscriptions.set(linkedPropertyNumber, linkedSubscription);
    }

    const fulfillmentClaim = await runAdminApprovalStage(
      () =>
        firebaseService.claimPaymentFulfillment(
          payment.id,
          rejectableStatuses,
          { purpose: "reject" },
        ),
      {
        status: 503,
        code: "PAYMENT_REJECTION_FAILED",
        message:
          "تعذر حجز الدفع لتنفيذ الرفض بأمان. حدّث الصفحة ثم حاول مرة أخرى.",
      },
    );
    if (fulfillmentClaim.status === "fulfilled") {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_NOT_PENDING",
        message:
          "تم تفعيل هذا الدفع بالفعل، لذلك لا يمكن رفضه من قائمة الدفعات المعلقة. راجع الاشتراك قبل أي إلغاء يدوي.",
      });
    }
    if (fulfillmentClaim.status === "processing") {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_FULFILLMENT_IN_PROGRESS",
        message:
          "توجد عملية قبول أو رفض أخرى قيد التنفيذ لهذا الدفع. حدّث الصفحة وحاول مرة أخرى بعد قليل.",
      });
    }
    if (fulfillmentClaim.status === "invalid_status") {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_NOT_PENDING",
        message:
          "تغيّرت حالة الدفع أثناء تنفيذ الرفض. حدّث الصفحة وتحقق من حالته الحالية.",
      });
    }
    if (fulfillmentClaim.status === "action_conflict") {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_ACTION_IN_PROGRESS",
        message:
          "يوجد طلب اشتراك آخر قيد التنفيذ لهذا العقار. يمكن رفض هذه الدفعة بعد تحديث الصفحة والتحقق من الدفع الجاري.",
      });
    }
    if (fulfillmentClaim.status === "action_ineligible") {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_ACTION_NO_LONGER_ELIGIBLE",
        message:
          "لم تعد حالة الاشتراك تسمح بتنفيذ إجراء هذه الدفعة. حدّث الصفحة وراجع الاشتراك قبل المتابعة.",
      });
    }
    const fulfillmentToken = fulfillmentClaim.token;

    const runRejectMutation = async (
      operation: () => Promise<unknown>,
      message: string,
    ) =>
      runAdminApprovalStage(
        async () => {
          try {
            await operation();
          } catch (error) {
            // A database write can commit before its request reports failure,
            // so every failed rejection write is conservatively partial.
            throw new PartialMutationError(error);
          }
        },
        {
          status: 500,
          code: "PAYMENT_REJECTION_FAILED",
          message,
        },
      );

    for (const [linkedPropertyNumber, linkedSubscription] of
      linkedSubscriptions) {
      if (linkedSubscription?.paymentId !== payment.id) continue;
      await runRejectMutation(
        async () => {
          const cancelled = await firebaseService.cancelSubscriptionIfOwnedByPayment(
            linkedPropertyNumber,
            payment.id,
            "تم رفض الدفع — تراجع عن العقارات المرتبطة",
          );
          if (!cancelled) {
            throw new Error("Linked subscription ownership changed before cancellation");
          }
        },
        `بدأ رفض الدفع، لكن تعذر إلغاء الاشتراك الذي فعّله للعقار المرتبط ${linkedPropertyNumber}. راجع اشتراكه قبل أي محاولة أخرى.`,
      );
    }

    if (mainSubscriptionOwnedByPayment) {
      await runRejectMutation(
        async () => {
          const cancelled = await firebaseService.cancelSubscriptionIfOwnedByPayment(
            payment.propertyNumber,
            payment.id,
            "تم رفض الدفع",
          );
          if (!cancelled) {
            throw new Error("Main subscription ownership changed before cancellation");
          }
        },
        "بدأ رفض الدفع، لكن تعذر إلغاء الاشتراك الذي فعّله للعقار الرئيسي. راجع الاشتراك قبل أي محاولة أخرى.",
      );
    } else if (
      payment.status === "نجح - قيد التحقق" &&
      (
        payment.pendingPropertyApproval === true ||
        (
          payment.pendingPropertyApproval === undefined &&
          (payment.action === undefined || payment.action === "new") &&
          !mainSubscription
        )
      )
    ) {
      await runRejectMutation(
        () =>
          firebaseService.updateProperty(payment.propertyNumber, {
            pendingPaidSubscription: false,
            verificationStatus: "rejected",
          } as any),
        "تعذر إزالة علامة انتظار التفعيل المدفوع من العقار. حدّث الصفحة وراجع حالة العقار.",
      );
    }

    await runRejectMutation(
      () => firebaseService.updatePaymentStatus(paymentId, "مرفوض"),
      "تعذر تأكيد حفظ حالة رفض الدفع. حدّث الصفحة وتحقق من حالته قبل إعادة المحاولة.",
    );
    await runRejectMutation(
      () =>
        firebaseService.releasePaymentFulfillment(
          payment.id,
          fulfillmentToken,
        ),
      "تم حفظ رفض الدفع، لكن تعذر تحرير قفل المعالجة. انتظر قليلاً قبل محاولة قبول الدفع من جديد.",
    );

    await firebaseService
      .addVerificationLog({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "رفض الدفع",
        reason: "إيصال دفع غير صحيح",
        admin: "النظام",
      })
      .catch((error) =>
        console.error("Failed to add payment rejection log:", error),
      );
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

  /**
   * Recover a Paymob payment when the normal signed callback was delayed or
   * missed. Provider data is accepted only when the stored intention,
   * merchant attempt, amount, currency and (when present) order all agree.
   * A provider/network ambiguity never changes the local payment state.
   */
  async reconcilePaymobIntention(
    paymentId: string,
    options: {
      propagateActivationError?: boolean;
      repairProcessedMetadata?: boolean;
    } = {},
  ): Promise<
    | { status: "not_supported" | "provider_unavailable" | "unpaid" | "identity_mismatch" }
    | { status: "already_processed" }
    | { status: "paid"; activation: "activated" | "queued" | "pending" }
  > {
    const payment = await firebaseService.getPaymentById(paymentId);
    if (!payment) return { status: "not_supported" };
    // Add-ons have their own review-only settlement path. They must never
    // enter subscription fulfillment, including after a failed transaction
    // is later shown as paid by Paymob.
    if (payment.action === "addon") return { status: "not_supported" };
    const processed =
      payment.status === "مكتمل" ||
      payment.status === "completed" ||
      payment.fulfillmentState === "fulfilled" ||
      Boolean(payment.fulfilledAt);
    const storedTransactionId = String(payment.transactionId || "").trim();
    const storedIntentionId = String(payment.paymentReference || "").trim();
    const needsProcessedMetadataRepair =
      isGenericPaymobPaymentMethod(payment.paymentMethod) ||
      !String(payment.paymobOrderId || "").trim() ||
      !storedTransactionId ||
      storedTransactionId === storedIntentionId;
    if (
      processed &&
      !(options.repairProcessedMetadata && needsProcessedMetadataRepair)
    ) {
      return { status: "already_processed" };
    }

    const intentionId = String(payment.paymentReference || "").trim();
    const attemptKey = String(payment.merchantAttemptKey || "").trim();
    const checkoutUrl = String(payment.paymentCheckoutUrl || "").trim();
    if (!intentionId || !attemptKey || !checkoutUrl) {
      return { status: "not_supported" };
    }

    const lookup = await paymobService.retrieveIntention(checkoutUrl);
    if (!lookup.ok) return { status: "provider_unavailable" };
    const { snapshot } = lookup;
    const amountCents = Math.round(Number(payment.finalAmount) * 100);
    if (
      snapshot.intentionId !== intentionId ||
      snapshot.specialReference !== attemptKey ||
      !Number.isSafeInteger(amountCents) ||
      snapshot.amountCents !== amountCents ||
      snapshot.currency !== "SAR" ||
      (payment.paymobOrderId && payment.paymobOrderId !== snapshot.orderId)
    ) {
      console.error(`Paymob reconciliation identity mismatch for ${payment.id}`);
      return { status: "identity_mismatch" };
    }
    if (!snapshot.paid) return { status: "unpaid" };
    if (!snapshot.confirmed) {
      console.error(
        `Paymob paid intention is not provider-confirmed for ${payment.id}`,
      );
      return { status: "identity_mismatch" };
    }
    const signedTransaction = snapshot.signedTransaction;
    if (
      !signedTransaction ||
      signedTransaction.orderId !== snapshot.orderId ||
      signedTransaction.merchantOrderId !== attemptKey ||
      signedTransaction.amountCents !== snapshot.amountCents ||
      signedTransaction.currency !== snapshot.currency
    ) {
      console.error(
        `Paymob paid intention lacks matching signed transaction evidence for ${payment.id}`,
      );
      return { status: "identity_mismatch" };
    }
    const providerPaymentMethod = getExactPaymobPaymentMethod(signedTransaction);
    if (!providerPaymentMethod) {
      console.error(
        `Paymob paid intention lacks an exact card subtype for ${payment.id}`,
      );
      return { status: "identity_mismatch" };
    }
    if (
      storedTransactionId &&
      storedTransactionId !== intentionId &&
      storedTransactionId !== signedTransaction.transactionId
    ) {
      console.error(
        `Paymob paid intention conflicts with the stored transaction for ${payment.id}`,
      );
      return { status: "identity_mismatch" };
    }

    const reconciledAt = new Date().toISOString();
    const acceptance = await firebaseService.acceptSuccessfulPaymentIntention(
      payment.id,
      {
        merchantAttemptKey: attemptKey,
        transactionId: signedTransaction.transactionId,
        paymobOrderId: snapshot.orderId,
        amountCents: snapshot.amountCents,
        currency: snapshot.currency,
      },
      {
        paymentMethod: providerPaymentMethod,
        providerReconciledAt: reconciledAt,
        ...(snapshot.paidAt ? { providerPaidAt: snapshot.paidAt } : {}),
      },
    );
    if (acceptance.status === "rejected") {
      console.error(
        `Paymob reconciliation rejected for ${payment.id}: ${acceptance.reason}`,
      );
      return { status: "identity_mismatch" };
    }
    if (acceptance.status === "already_processed") {
      if (needsProcessedMetadataRepair) {
        await firebaseService.updatePayment(payment.id, {
          paymentMethod: providerPaymentMethod,
          transactionId: signedTransaction.transactionId,
          paymobOrderId: snapshot.orderId,
          providerReconciledAt: reconciledAt,
          ...(snapshot.paidAt ? { providerPaidAt: snapshot.paidAt } : {}),
        });
      }
      return { status: "already_processed" };
    }
    if (
      acceptance.status === "already_accepted" &&
      (isGenericPaymobPaymentMethod(acceptance.payment.paymentMethod) ||
        acceptance.payment.paymentMethod !== providerPaymentMethod)
    ) {
      await firebaseService.updatePayment(payment.id, {
        paymentMethod: providerPaymentMethod,
        transactionId: signedTransaction.transactionId,
        paymobOrderId: snapshot.orderId,
        providerReconciledAt: reconciledAt,
        ...(snapshot.paidAt ? { providerPaidAt: snapshot.paidAt } : {}),
      });
    }

    try {
      const result = await this.approveBankTransfer(payment.id);
      return { status: "paid", activation: result.outcome };
    } catch (error) {
      // Financial success is authoritative even when property verification or
      // subscription activation still needs attention. Never roll it back to a
      // timeout/failure state.
      console.error(
        `Paymob payment ${payment.id} was reconciled but activation is pending:`,
        error,
      );
      if (options.propagateActivationError) throw error;
      return { status: "paid", activation: "pending" };
    }
  }

  /**
   * Recover an add-on checkout whose signed callback was delayed or missed.
   * Add-ons remain pending for admin review after financial settlement. Every
   * provider identifier must already be persisted and unique; reconciliation
   * never binds an order discovered after the fact.
   */
  async reconcilePaymobAddonIntention(paymentId: string): Promise<
    | { status: "not_supported" | "provider_unavailable" | "unpaid" | "identity_mismatch" }
    | { status: "already_processed" }
    | { status: "paid"; review: "pending" }
  > {
    const payment = await firebaseService.getPaymentById(paymentId);
    if (!payment || payment.action !== "addon") {
      return { status: "not_supported" };
    }
    if (
      payment.status === "مكتمل" ||
      payment.status === "completed" ||
      payment.completedAt ||
      payment.fulfilledAt ||
      payment.fulfillmentState === "fulfilled"
    ) {
      return { status: "already_processed" };
    }

    const intentionId = String(payment.paymentReference || "").trim();
    const attemptKey = String(payment.merchantAttemptKey || "").trim();
    const checkoutUrl = String(payment.paymentCheckoutUrl || "").trim();
    const persistedOrderId = String(payment.paymobOrderId || "").trim();
    if (
      !intentionId ||
      !attemptKey ||
      !checkoutUrl ||
      !persistedOrderId ||
      payment.intentionState !== "created"
    ) {
      return { status: "not_supported" };
    }

    const lookup = await paymobService.retrieveIntention(checkoutUrl);
    if (!lookup.ok) return { status: "provider_unavailable" };
    const { snapshot } = lookup;
    const amountCents = Math.round(Number(payment.finalAmount) * 100);
    if (
      snapshot.intentionId !== intentionId ||
      snapshot.specialReference !== attemptKey ||
      snapshot.orderId !== persistedOrderId ||
      !Number.isSafeInteger(amountCents) ||
      snapshot.amountCents !== amountCents ||
      snapshot.currency !== "SAR"
    ) {
      console.error(`Paymob add-on reconciliation identity mismatch for ${payment.id}`);
      return { status: "identity_mismatch" };
    }
    if (!snapshot.paid) return { status: "unpaid" };
    if (!snapshot.confirmed) {
      console.error(
        `Paymob paid add-on intention is not provider-confirmed for ${payment.id}`,
      );
      return { status: "identity_mismatch" };
    }

    const signedTransaction = snapshot.signedTransaction;
    if (
      !signedTransaction ||
      signedTransaction.orderId !== persistedOrderId ||
      signedTransaction.merchantOrderId !== attemptKey ||
      signedTransaction.amountCents !== amountCents ||
      signedTransaction.currency !== "SAR"
    ) {
      console.error(
        `Paymob paid add-on intention lacks matching signed transaction evidence for ${payment.id}`,
      );
      return { status: "identity_mismatch" };
    }

    const exactPaymentMethod = getExactPaymobPaymentMethod({
      cardSubType: signedTransaction.cardSubType,
      paymentMethod: signedTransaction.paymentMethod,
    });
    if (!exactPaymentMethod) {
      console.error(
        `Paymob paid add-on intention lacks an exact payment subtype for ${payment.id}`,
      );
      return { status: "identity_mismatch" };
    }

    const amount = Number(payment.finalAmount);
    const merchantFees = 0;
    const acqFees = 0;
    const vatAmount = 0;
    const totalFees = Math.round(amount * 0.069 * 100) / 100;
    const netAmount = Math.round((amount - totalFees) * 100) / 100;
    // The legacy Transaction Inquiry endpoint has no bounded request timeout.
    // Reconciliation runs inside the scheduler, so use the same documented
    // fallback as the callback instead of allowing one fee lookup to stall all
    // subsequent payment recovery. The exact signed transaction above remains
    // the authoritative financial evidence.

    const reconciledAt = new Date().toISOString();
    const settlement = await firebaseService.settleAddOnPaymentCallback(
      payment.id,
      {
        merchantAttemptKey: attemptKey,
        transactionId: signedTransaction.transactionId,
        paymobOrderId: persistedOrderId,
        amountCents,
        currency: "SAR",
        success: true,
      },
      {
        paymentMethod: exactPaymentMethod,
        merchantFees,
        acqFees,
        vatAmount,
        totalFees,
        netAmount,
        providerReconciledAt: reconciledAt,
        ...(snapshot.paidAt ? { providerPaidAt: snapshot.paidAt } : {}),
      },
      {
        recordReconciliationHistory: true,
        expectedIntentionId: intentionId,
      },
    );
    if (settlement.status === "accepted_success") {
      return { status: "paid", review: "pending" };
    }
    if (settlement.status === "already_processed") {
      return { status: "already_processed" };
    }
    console.error(
      settlement.status === "rejected"
        ? `Paymob add-on reconciliation rejected for ${payment.id}: ${settlement.reason}`
        : `Paymob add-on reconciliation reached an unexpected state for ${payment.id}: ${settlement.status}`,
    );
    return { status: "identity_mismatch" };
  }

  // ─── Manual Confirmation ─────────────────────────────────────────────────────

  async confirmManually(paymentId: string): Promise<void> {
    const payment = await firebaseService.getPaymentById(paymentId);
    if (!payment) throw new Error("الدفعة غير موجودة");
    const hasPendingSubscriptionDates = Boolean(
      payment.pendingStartDate && payment.pendingEndDate,
    );
    const normalizedPendingEndDate = payment.pendingEndDate
      ? normalizeSubscriptionBoundaryEndDate(payment.pendingEndDate)
      : undefined;

    // Payments without a pending subscription retain the original status-only flow.
    if (!hasPendingSubscriptionDates) {
      if (payment.status === "مكتمل") throw new Error("الدفعة مكتملة مسبقاً");
      await firebaseService.updatePayment(paymentId, {
        status: "مكتمل",
        completedAt: new Date().toISOString(),
        paymentMethod: payment.paymentMethod ?? "تأكيد يدوي",
      });
      return;
    }
    await assertPropertyNotSuspended(payment.propertyNumber);

    // Resolve and validate every paid group member before claiming fulfillment
    // or mutating the main subscription. A suspended child must not turn a
    // manual confirmation into a partial activation.
    const rawAdditionalProperties = Array.isArray(
      (payment as any).additionalProperties,
    )
      ? (payment as any).additionalProperties
      : [];
    const additionalProps = [...new Set<string>(
      rawAdditionalProperties
        .map((value: unknown) => String(value || "").trim())
        .filter(
          (propertyNumber: string) =>
            propertyNumber && propertyNumber !== payment.propertyNumber,
        ),
    )];
    const secondProp = String(
      (payment as any).secondPropertyNumber || "",
    ).trim();
    if (
      secondProp &&
      secondProp !== payment.propertyNumber &&
      !additionalProps.includes(secondProp)
    ) {
      additionalProps.push(secondProp);
    }
    for (const additionalPropertyNumber of additionalProps) {
      await assertPropertyNotSuspended(additionalPropertyNumber);
    }

    const fulfillmentClaim = await firebaseService.claimPaymentFulfillment(paymentId);
    if (fulfillmentClaim.status === "fulfilled") {
      if (payment.status !== "مكتمل") {
        await firebaseService.updatePayment(paymentId, {
          status: "مكتمل",
          completedAt: payment.completedAt ?? new Date().toISOString(),
          paymentMethod: payment.paymentMethod ?? "تأكيد يدوي",
        });
      }
      return;
    }
    if (fulfillmentClaim.status === "processing") {
      throw new Error("Payment fulfillment is already in progress");
    }
    if (fulfillmentClaim.status === "action_conflict") {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_ACTION_IN_PROGRESS",
        message:
          "يوجد طلب اشتراك آخر قيد التنفيذ لهذا العقار. لا يمكن تفعيل هذه الدفعة بالتوازي.",
      });
    }
    if (fulfillmentClaim.status === "action_ineligible") {
      throw new AdminApprovalError({
        status: 409,
        code: "PAYMENT_ACTION_NO_LONGER_ELIGIBLE",
        message:
          "لم تعد حالة الاشتراك تسمح بتفعيل هذه الدفعة. حدّث الصفحة وراجع الإجراء المناسب.",
      });
    }

    const fulfillmentToken = fulfillmentClaim.token;
    try {
      const property = await firebaseService.getPropertyByNumber(payment.propertyNumber);

      const paidAmount = Number(
        payment.pendingPrice ?? payment.finalAmount ?? payment.amount ?? 0,
      );
      const subscriptionType = payment.pendingSubscriptionType ??
        (paidAmount > 0 ? "مميز" : "عادي");
      const subscriptionData = {
        propertyNumber: payment.propertyNumber,
        packageId: payment.packageId,
        startDate: payment.pendingStartDate!,
        endDate: normalizedPendingEndDate!,
        status: "نشط",
        paymentId,
        price: payment.amount ?? "",
        subscriptionType,
        packageType: subscriptionType,
        linkedProperties: additionalProps.length > 0 ? additionalProps : undefined,
        propertyCount: 1 + additionalProps.length,
      };

      await firebaseService.addSubscriptionToSheet(
        payment.propertyNumber,
        subscriptionData,
        property,
        undefined,
      );

      // Activate linked/additional properties with the same dates — sync BOTH docs
      // and force verification=approved so linked props never lag behind the main.
      for (const propNumber of additionalProps) {
        const additionalProperty = await firebaseService.getPropertyByNumber(propNumber);
        if (additionalProperty) {
          await firebaseService.syncLinkedProperty(propNumber, payment.propertyNumber, {
            subscriptionType,
            startDate: payment.pendingStartDate!,
            endDate: normalizedPendingEndDate!,
            status: "نشط",
            paymentId,
            packageId: payment.packageId,
          });
          console.log(`[confirmManually] ✅ Linked property synced (sub + property + approved): ${propNumber}`);
        }
      }

      await firebaseService.completePaymentFulfillment(
        paymentId,
        fulfillmentToken,
        `SUB-${payment.propertyNumber}`,
      );
      await firebaseService.updatePayment(paymentId, {
        status: "مكتمل",
        completedAt: new Date().toISOString(),
        paymentMethod: payment.paymentMethod ?? "تأكيد يدوي",
      });

      if (property?.whatsappNumber) {
        try {
          await notifyOwnerSubscriptionActivated({
            ownerPhone: property.whatsappNumber,
            propertyNumber: payment.propertyNumber,
            propertyName: property.name ?? "",
            endDate: normalizedPendingEndDate!,
          });
        } catch (err) {
          console.error("❌ Failed to send owner notification:", err);
        }
      }
    } catch (error) {
      await firebaseService.releasePaymentFulfillment(paymentId, fulfillmentToken)
        .catch((releaseError) => console.error(
          "Failed to release manual payment fulfillment claim:",
          releaseError,
        ));
      throw error;
    }
  }
}

export const paymentService = new PaymentService();
