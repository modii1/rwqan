import { Router } from "express";
import { propertyService, paymentService, subscriptionService, addOnService } from "../services";
import { firebaseService } from "../firebaseService";
import { paymobService } from "../integrations/paymob";
import { sendWhatsAppNotification, notifyNewPayment, notifyOwnerSubscriptionActivated, sendPropertyOwnerWhatsApp } from "../integrations/whatsapp";
import { checkPropertyDataComplete } from "../utils/verification";
import { countR2Images } from "../utils/r2";
import {
  activateVerifiedPaymentSubscription,
  calculateActionDates,
  hasPriorSubscription,
  queueVerifiedNewPropertyForAdminApproval,
} from "../utils/paymentScenarioFlow";
import { isPropertySuspended } from "../services/propertySuspension";

const router = Router();

function callbackBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function callbackMatchesPayment(
  payment: { finalAmount: unknown },
  transaction: { amount_cents?: unknown; currency?: unknown },
): boolean {
  const amountCents = Number(transaction.amount_cents);
  const finalAmount = Number(payment.finalAmount);
  return (
    Number.isSafeInteger(amountCents) &&
    Number.isFinite(finalAmount) &&
    amountCents === Math.round(finalAmount * 100) &&
    String(transaction.currency || "").trim().toUpperCase() === "SAR"
  );
}

  // ======================
  // PAYMOB RETURN URL - GET (browser UX only)
  // ======================
  router.get("/api/paymob/webhook", (req, res) => {
    // This URL is opened in the customer's browser and every query parameter
    // can be forged. It must never settle a payment or fulfill a subscription.
    // The signed server-to-server POST callback below is the only mutation path.
    const success = req.query.success === "true";
    const specialReference = typeof req.query.special_reference === "string"
      ? req.query.special_reference
      : "";
    const isAddon = specialReference.startsWith("PAY-ADDON-") ||
      specialReference.startsWith("addon-");

    if (!success) {
      return res.redirect("/subscription?payment=failed");
    }
    return res.redirect(
      isAddon
        ? "/owner/dashboard?addon_payment=processing"
        : "/subscription?payment=processing",
    );
  });


  // ======================
  // PAYMOB WEBHOOK - POST (Server-to-Server notification)
  // ======================
  router.post("/api/paymob/webhook", async (req, res) => {
    try {
      console.log("📥 Paymob webhook received");

      const webhook = req.body;
      const receivedHmac =
        (typeof req.query.hmac === "string" ? req.query.hmac : undefined) ||
        (typeof webhook?.hmac === "string" ? webhook.hmac : undefined) ||
        (typeof webhook?.obj?.hmac === "string" ? webhook.obj.hmac : undefined);
      if (!paymobService.verifyWebhookSignature(webhook, receivedHmac)) {
        console.error("Rejected Paymob webhook with an invalid signature");
        return res.status(401).json({
          ok: false,
          error: "Invalid Paymob webhook signature",
        });
      }

      const t = webhook?.obj;
      if (!t) {
        console.log("⚠️ Missing obj");
        return res.status(400).json({ ok: false, error: "Missing callback object" });
      }

      // استخراج المعلومات الأساسية
      const transactionId = String(t.id ?? "");
      const isSuccess = callbackBoolean(t.success);
      const isPending = callbackBoolean(t.pending);
      const paymobOrderId = String(t.order?.id || t.order || "");
      const merchantOrderId = String(
        t.merchant_order_id || t.order?.merchant_order_id || "",
      );
      const amount = (t.amount_cents || 0) / 100;
      const creationExtras = t.order?.extras?.creation_extras || {};

      if (!transactionId) {
        return res.status(400).json({ ok: false, error: "Missing transaction id" });
      }

      // A pending callback is informational, not a final failure or success.
      // Waiting for Paymob's final signed callback prevents premature retries.
      if (isPending) {
        return res.json({ ok: true, status: "pending" });
      }

      // ===============================
      // معالجة دفعات الإضافات - طريقة موحدة
      // البحث في السجلات المعلقة أو من extras
      // ===============================
      const specialReference = String(
        t.order?.special_reference || merchantOrderId || "",
      );
      const callbackAttemptKey = String(
        creationExtras?.merchantAttemptKey ||
        specialReference ||
        merchantOrderId ||
        "",
      );
      const isAddonPayment = specialReference.startsWith("PAY-ADDON-") || creationExtras?.type === "addon";

      if (isAddonPayment) {
        console.log(`📦 Processing add-on payment webhook, special_reference: ${specialReference}`);

        // Correlate add-on payments only by an explicit local payment id.
        const allPayments = await paymentService.getAll();
        let pendingPayment = null;
        const callbackPaymentIds = new Set<string>();
        if (specialReference.startsWith("PAY-ADDON-")) {
          callbackPaymentIds.add(specialReference);
        }
        if (creationExtras?.paymentId) {
          callbackPaymentIds.add(String(creationExtras.paymentId));
        }
        if (callbackPaymentIds.size === 1) {
          const [paymentId] = callbackPaymentIds;
          pendingPayment = allPayments.find((payment) => payment.id === paymentId) || null;
        } else if (callbackPaymentIds.size > 1) {
          console.error("Conflicting add-on payment identifiers in Paymob callback");
          return res.status(409).json({ error: "Callback identifiers conflict" });
        }

        if (!pendingPayment) {
          console.log(`⚠️ No pending addon payment found for: ${specialReference}`);
          return res.json({ ok: true });
        }

        if (!callbackMatchesPayment(pendingPayment, t)) {
          console.error(`Paymob amount/currency mismatch for add-on ${pendingPayment.id}`);
          return res.status(422).json({ error: "Callback amount or currency mismatch" });
        }

        if (!isSuccess) {
          const failureSettlement = await firebaseService.settleAddOnPaymentCallback(
            pendingPayment.id,
            {
              transactionId,
              paymobOrderId,
              amountCents: Number(t.amount_cents),
              currency: String(t.currency || ""),
              success: false,
            },
          );
          if (failureSettlement.status === "already_processed") {
            console.warn(`Ignoring late failed callback for add-on ${pendingPayment.id}`);
            return res.json({ ok: true, status: "ignored_late_failure" });
          }
          if (failureSettlement.status === "rejected") {
            const status = failureSettlement.reason === "amount_or_currency_mismatch"
              ? 422
              : failureSettlement.reason === "not_found"
                ? 404
                : 409;
            return res.status(status).json({
              error: "Add-on callback could not be accepted",
              reason: failureSettlement.reason,
            });
          }
          if (failureSettlement.status !== "recorded_failure") {
            return res.status(409).json({
              error: "Add-on failure callback reached an unexpected state",
            });
          }
          console.log(`❌ Addon payment failed: ${pendingPayment.id}`);
          return res.json({ ok: true });
        }

        // ===============================
        // حساب الرسوم للإضافات
        // ===============================
        let addonMerchantFees = 0;
        let addonAcqFees = 0;
        let addonVatAmount = 0;
        let addonTotalFees = 0;
        let addonNetAmount = amount;

        try {
          const { paymobService } = await import("../integrations/paymob");
          console.log(`📡 Calling Paymob Inquiry API for addon with order_id: ${paymobOrderId}`);
          const inquiry = await paymobService.inquiryByOrderId(paymobOrderId);

          if (inquiry?.ok) {
            addonMerchantFees = inquiry.merchantFees || 0;
            addonAcqFees = inquiry.acqFees || 0;
            addonVatAmount = inquiry.vat || 0;
            addonTotalFees = inquiry.totalFees || 0;
            addonNetAmount = inquiry.netAmount || (amount - addonTotalFees);
            console.log(`✅ Got real fees for addon: total=${addonTotalFees}, net=${addonNetAmount}`);
          } else {
            addonTotalFees = Math.round(amount * 0.069 * 100) / 100;
            addonNetAmount = Math.round((amount - addonTotalFees) * 100) / 100;
          }
        } catch (err) {
          console.log("❌ Inquiry API Error for addon:", err);
          addonTotalFees = Math.round(amount * 0.069 * 100) / 100;
          addonNetAmount = Math.round((amount - addonTotalFees) * 100) / 100;
        }

        const successSettlement = await firebaseService.settleAddOnPaymentCallback(
          pendingPayment.id,
          {
            transactionId,
            paymobOrderId,
            amountCents: Number(t.amount_cents),
            currency: String(t.currency || ""),
            success: true,
          },
          {
            merchantFees: addonMerchantFees,
            acqFees: addonAcqFees,
            vatAmount: addonVatAmount,
            totalFees: addonTotalFees,
            netAmount: addonNetAmount,
          },
        );
        if (successSettlement.status === "already_processed") {
          return res.json({ ok: true, status: "already_processed" });
        }
        if (successSettlement.status === "rejected") {
          const status = successSettlement.reason === "amount_or_currency_mismatch"
            ? 422
            : successSettlement.reason === "not_found"
              ? 404
              : 409;
          return res.status(status).json({
            error: "Add-on callback could not be accepted",
            reason: successSettlement.reason,
          });
        }
        if (successSettlement.status !== "accepted_success") {
          return res.status(409).json({
            error: "Add-on callback did not reach a successful terminal state",
          });
        }
        pendingPayment = successSettlement.payment;
        const addonPropertyNumber = pendingPayment.propertyNumber;
        const addonId = pendingPayment.packageId;
        const addonName = pendingPayment.packageName;
        const addonPrice = pendingPayment.finalAmount;
        console.log(`📦 Accepted add-on payment ${pendingPayment.id} for property ${addonPropertyNumber}`);

        // تسجيل العملية في سجل الإضافات
        await addOnService.logHistory({
          propertyNumber: addonPropertyNumber,
          addOnPackageId: addonId,
          action: "pending",
          notes: `تم استلام الدفع الإلكتروني بنجاح - المبلغ: ${addonPrice} ر.س - الرسوم: ${addonTotalFees} ر.س - بانتظار مراجعة الإدارة`,
          timestamp: new Date().toISOString(),
          createdBy: "system",
        });

        // إرسال إشعار واتساب للإدارة
        try {
          const property = await propertyService.getByNumber(addonPropertyNumber);
          await sendWhatsAppNotification(
            `🔔 طلب إضافة جديد (دفع إلكتروني) - قيد المراجعة\n` +
            `العقار: ${addonPropertyNumber} - ${property?.name || ''}\n` +
            `الإضافة: ${addonName}\n` +
            `المبلغ: ${addonPrice} ر.س\n` +
            `الرسوم: ${addonTotalFees} ر.س\n` +
            `صافي: ${addonNetAmount} ر.س\n` +
            `📋 الحالة: قيد مراجعة الإدارة`
          );
        } catch (e) {
          console.error("Failed to send WhatsApp notification for addon:", e);
        }

        console.log(`✅ Add-on payment ${pendingPayment.id} updated successfully, pending admin approval`);
        return res.json({ ok: true });
      }


      // استخراج رقم العقار
      let propertyNumber = "";
      if (merchantOrderId?.includes("-")) {
        propertyNumber = merchantOrderId.split("-")[0];
      }
      if (!propertyNumber) {
        propertyNumber =
          t.payment_key_claims?.extra?.creation_extras?.propertyNumber || "";
      }
      if (!propertyNumber) {
        propertyNumber = t.order?.merchant_order_id?.split("-")[0] || ""; // Fallback if merchant_order_id is directly on order
      }

      const paymentMethod = t.source_data?.type || "";
      const cardSubType = t.source_data?.sub_type || "";

      console.log("🧾 Transaction:", transactionId, propertyNumber, amount);

      // ===============================
      // 1) جلب الرسوم من Paymob Inquiry API
      // ===============================
      let merchantFees = 0;
      let acqFees = 0;
      let vatAmount = 0;
      let totalFees = 0;
      let netAmount = 0;

      try {
        const { paymobService } = await import("../integrations/paymob");

        // استخدام inquiryByOrderId لجلب الرسوم الحقيقية
        console.log(`📡 Calling Paymob Inquiry API with order_id: ${paymobOrderId}`);
        const inquiry = await paymobService.inquiryByOrderId(paymobOrderId);

        console.log("📡 Inquiry Response:", JSON.stringify(inquiry, null, 2));

        if (inquiry?.ok) {
          merchantFees = inquiry.merchantFees || 0;
          acqFees = inquiry.acqFees || 0;
          vatAmount = inquiry.vat || 0;
          totalFees = inquiry.totalFees || 0;
          netAmount = inquiry.netAmount || (amount - totalFees);
          console.log(`✅ Got real fees from Paymob: merchant=${merchantFees}, acq=${acqFees}, vat=${vatAmount}, total=${totalFees}`);
        } else {
          console.log("⚠️ Inquiry returned no data, using fallback calculation");
          // حساب احتياطي: 6.9% شامل الضريبة
          totalFees = Math.round(amount * 0.069 * 100) / 100;
          const baseFee = Math.round((totalFees / 1.15) * 100) / 100;
          vatAmount = Math.round((totalFees - baseFee) * 100) / 100;
          merchantFees = Math.round(baseFee * 0.30 * 100) / 100;
          acqFees = Math.round(baseFee * 0.70 * 100) / 100;
          netAmount = Math.round((amount - totalFees) * 100) / 100;
        }
      } catch (err) {
        console.log("❌ Inquiry API Error:", err);
        // حساب احتياطي عند الفشل
        totalFees = Math.round(amount * 0.069 * 100) / 100;
        netAmount = Math.round((amount - totalFees) * 100) / 100;
      }

      console.log(
        "🏦 Final Fees → merchant:",
        merchantFees,
        "acq:",
        acqFees,
        "vat:",
        vatAmount,
        "total:",
        totalFees,
        "net:",
        netAmount
      );

      if (!isSuccess) {
        console.log("⚠️ Payment failed");
        const failedPayments = await paymentService.getAll();
        const callbackPaymentId = creationExtras?.paymentId
          ? String(creationExtras.paymentId)
          : "";
        const paymentById = callbackPaymentId
          ? failedPayments.find((payment) => payment.id === callbackPaymentId) || null
          : null;
        const paymentByAttempt = callbackAttemptKey
          ? failedPayments.find(
            (payment) =>
              payment.merchantAttemptKey === callbackAttemptKey,
          ) || null
          : null;
        let failedPayment = null;
        if (paymentById && paymentByAttempt && paymentById.id !== paymentByAttempt.id) {
          console.error("Conflicting failed-payment identifiers in Paymob callback");
        } else if (
          paymentById?.merchantAttemptKey &&
          callbackPaymentId &&
          callbackAttemptKey &&
          paymentByAttempt?.id === paymentById.id
        ) {
          // Modern intentions must supply both identifiers. An attempt key by
          // itself is not enough to select a local payment.
          failedPayment = paymentById;
        } else if (paymobOrderId && !paymentByAttempt) {
          // Legacy intentions predate stable attempt keys. The Paymob order id
          // is covered by the callback HMAC, so only a unique exact match is
          // eligible for this compatibility path.
          const legacyMatches = failedPayments.filter(
            (payment) =>
              !payment.merchantAttemptKey &&
              payment.paymobOrderId === paymobOrderId,
          );
          if (
            legacyMatches.length === 1 &&
            (!paymentById || paymentById.id === legacyMatches[0].id)
          ) {
            failedPayment = legacyMatches[0];
          }
        }
        if (failedPayment) {
          if (!callbackMatchesPayment(failedPayment, t)) {
            console.error(
              `Paymob amount/currency mismatch for failed payment ${failedPayment.id}`,
            );
            return res.status(422).json({
              error: "Callback amount or currency mismatch",
            });
          }
          const finalized = await firebaseService.finalizeFailedPaymentIntention(
            failedPayment.id,
            {
              merchantAttemptKey: failedPayment.merchantAttemptKey
                ? callbackAttemptKey
                : "",
              transactionId,
              paymobOrderId,
              amountCents: Number(t.amount_cents),
              currency: String(t.currency || ""),
            },
          );
          if (!finalized) {
            console.error(
              `Failed webhook could not finalize payment ${failedPayment.id}`,
            );
          }
        } else {
          // Property/amount matching is intentionally not used for failures:
          // two attempts can share both values, and releasing the wrong lock
          // could permit a duplicate charge.
          console.error("Failed Paymob webhook requires exact reconciliation", {
            paymentId: creationExtras?.paymentId,
            specialReference,
          });
        }
        return res.json({ ok: true });
      }

      // ===============================
      // 2) البحث عن سجل الدفع
      // ===============================
      const payments = await paymentService.getAll();
      let payment = null;

      console.log("🔍 Searching for payment with:", { merchantOrderId, paymobOrderId, propertyNumber, amount });
      console.log("🔍 Available pending payments:", payments.filter(p => p.status === "معلق" || p.status === "قيد المراجعة").map(p => ({
        id: p.id,
        propertyNumber: p.propertyNumber,
        amount: p.finalAmount,
        paymobOrderId: p.paymobOrderId,
        status: p.status
      })));

      const callbackPaymentId = creationExtras?.paymentId
        ? String(creationExtras.paymentId)
        : "";
      const paymentById = callbackPaymentId
        ? payments.find((candidate) => candidate.id === callbackPaymentId) || null
        : null;
      const paymentByAttempt = callbackAttemptKey
        ? payments.find(
          (candidate) => candidate.merchantAttemptKey === callbackAttemptKey,
        ) || null
        : null;

      if (paymentById && paymentByAttempt && paymentById.id !== paymentByAttempt.id) {
        console.error("Conflicting payment identifiers in Paymob callback");
        return res.status(409).json({ error: "Callback identifiers conflict" });
      }
      if (paymentById?.merchantAttemptKey) {
        // Modern records are bound to both the local id and the currently
        // reserved provider-attempt key. A late callback from an old retry may
        // carry the same local id and must not be applied to the new attempt.
        if (
          !callbackPaymentId ||
          !callbackAttemptKey ||
          paymentByAttempt?.id !== paymentById.id
        ) {
          console.error(`Stale Paymob attempt for payment ${paymentById.id}`);
          return res.status(409).json({ error: "Stale payment attempt" });
        }
        payment = paymentById;
      } else if (paymobOrderId) {
        // Legacy fallback is permitted only for a unique record that predates
        // merchant-attempt keys. Property/amount/recent-payment heuristics are
        // intentionally excluded because retries can share those values.
        const legacyMatches = payments.filter(
          (candidate) =>
            !candidate.merchantAttemptKey &&
            candidate.paymobOrderId === paymobOrderId,
        );
        if (
          !paymentByAttempt &&
          legacyMatches.length === 1 &&
          (!paymentById || paymentById.id === legacyMatches[0].id)
        ) {
          payment = legacyMatches[0];
        }
      }

      if (!payment) {
        console.error("❌ Payment not found for:", { merchantOrderId, paymobOrderId, propertyNumber, amount });
        return res.status(404).json({ error: "Payment not found" });
      }

      if (!callbackMatchesPayment(payment, t)) {
        console.error(`Paymob amount/currency mismatch for payment ${payment.id}`);
        return res.status(422).json({
          error: "Callback amount or currency mismatch",
        });
      }

      console.log("✅ Found Payment:", payment.id);

      // ===============================
      // 3) تحديث الدفع بالرسوم الحقيقية — جميع أنواع الدفع تبدأ بالتحقق
      // ===============================
      const successAcceptance = await firebaseService.acceptSuccessfulPaymentIntention(
        payment.id,
        {
          merchantAttemptKey: payment.merchantAttemptKey
            ? callbackAttemptKey
            : "",
          transactionId,
          paymobOrderId,
          amountCents: Number(t.amount_cents),
          currency: String(t.currency || ""),
        },
        {
          paymentMethod: cardSubType || paymentMethod || "بطاقة",
          merchantFees,
          acqFees,
        vatAmount,
          totalFees,
          feeAmount: merchantFees + acqFees,
          netAmount,
        },
      );
      if (successAcceptance.status === "already_processed") {
        console.log("⚠️ Payment success was already processed");
        return res.json({ ok: true, status: "already_processed" });
      }
      if (successAcceptance.status === "rejected") {
        if (successAcceptance.reason === "terminal_failure") {
          console.warn(`Ignoring late success for terminal payment ${payment.id}`);
          return res.json({ ok: true, status: "ignored_late_success" });
        }
        const status = successAcceptance.reason === "not_found"
          ? 404
          : successAcceptance.reason === "amount_or_currency_mismatch"
            ? 422
            : 409;
        console.error(
          `Paymob success acceptance rejected for ${payment.id}: ${successAcceptance.reason}`,
        );
        return res.status(status).json({
          error: "Payment callback could not be accepted",
          reason: successAcceptance.reason,
        });
      }
      payment = successAcceptance.payment;

      console.log(`💰 Payment Updated: ${payment.id} - Status: نجح - قيد التحقق`);

      // ===============================
      // 4) التحقق التلقائي من بيانات العقار (مرحلة إجبارية قبل التفعيل)
      // ===============================
      const property = await propertyService.getByNumber(payment.propertyNumber);

      // A signed financial success is still accepted while an administrator has
      // paused the subscription. Keep it pending, but do not verify, activate,
      // or notify the owner until the administrator explicitly resumes it.
      if (await isPropertySuspended(payment.propertyNumber)) {
        await paymentService.update(payment.id, {
          status: "نجح - قيد التحقق" as any,
          completedAt: new Date().toISOString(),
          transactionId,
          notes:
            "تم استلام الدفع بنجاح، لكن التفعيل مؤجل لأن الاشتراك موقوف مؤقتاً من الإدارة.",
        });
        console.log(
          `⏸️ [Webhook] Payment ${payment.id} accepted and held for suspended property ${payment.propertyNumber}`,
        );
        return res.json({
          ok: true,
          status: "property_suspended",
          paymentId: payment.id,
        });
      }

      let verificationPassed = false;
      let verificationMissingFields: string[] = [];

      if (property) {
        const r2ImgCount = await countR2Images(payment.propertyNumber);
        const propertyDataCheck = await checkPropertyDataComplete(property, r2ImgCount);
        verificationMissingFields = propertyDataCheck.missingFields;
        verificationPassed = propertyDataCheck.isComplete;

        if (verificationPassed) {
          const verificationSub = await firebaseService.getSubscriptionByPropertyNumber(payment.propertyNumber);
          if (hasPriorSubscription(verificationSub)) {
            await firebaseService.updateVerificationStatus(payment.propertyNumber, "approved");
            console.log(`✅ [Auto Verify] العقار القديم ${payment.propertyNumber} - البيانات مكتملة - تمت الموافقة تلقائياً`);
          } else {
            await firebaseService.updateProperty(payment.propertyNumber, {
              verificationStatus: "pending",
              smartVerificationPassed: true,
              smartVerificationPassedAt: new Date().toISOString(),
              pendingPaidSubscription: true,
            } as any);
            console.log(`✅ [Auto Verify] العقار الجديد ${payment.propertyNumber} - البيانات مكتملة وينتظر اعتماد الإدارة`);
          }
        } else {
          await firebaseService.updateVerificationStatus(payment.propertyNumber, "pending");
          console.log(`⏳ [Auto Verify] العقار ${payment.propertyNumber} - بيانات ناقصة: ${verificationMissingFields.join(', ')} - بانتظار الاستكمال`);
        }
      }

      if (!verificationPassed) {
        // الدفع ناجح لكن لا يتم التفعيل لأن بيانات العقار غير مكتملة
        await paymentService.update(payment.id, {
          status: "نجح - قيد التحقق" as any,
          completedAt: new Date().toISOString(),
          transactionId,
          notes: `بيانات العقار غير مكتملة (${verificationMissingFields.join('، ')})`,
        });
        if (property) {
          await firebaseService.updateVerificationStatus(payment.propertyNumber, "pending");
        }
        console.log(`⏳ Payment awaiting verification: ${payment.id} - property ${payment.propertyNumber} has incomplete data`);

        // إرسال إشعار بأن الدفع ناجح لكن ينتظر استكمال بيانات العقار
        try {
          await notifyNewPayment({
            propertyNumber: payment.propertyNumber,
            propertyName: property?.name || payment.propertyNumber,
            amount: payment.finalAmount,
            paymentMethod: cardSubType || paymentMethod || "بطاقة",
            transactionId,
          });
        } catch (err) {
          console.error("❌ WhatsApp notification failed:", err);
        }

        if (property?.whatsappNumber) {
          try {
            await sendPropertyOwnerWhatsApp({
              ownerPhone: property.whatsappNumber,
              propertyNumber: payment.propertyNumber,
              message: `تم استلام الدفع، لكن بيانات العقار ${property.name || payment.propertyNumber} غير مكتملة.\n\nالحقول المطلوبة: ${verificationMissingFields.join("، ")}\n\nالخطوة التالية: عدّل بيانات العقار وارفع الصور المطلوبة ثم شغّل التحقق من صفحة الاشتراك.`,
            });
          } catch (err) {
            console.error("❌ Owner rejection notification failed:", err);
          }
        }

        return res.json({ ok: true, status: "pending_verification", reason: `بيانات العقار غير مكتملة: ${verificationMissingFields.join('، ')}` });
      }

      // ===============================
      // 4.5) فحص: هل هذا عقار جديد (لا يملك اشتراك سابق)؟
      // ===============================
      const existingSub = await firebaseService.getSubscriptionByPropertyNumber(payment.propertyNumber);
      const isOldProperty = hasPriorSubscription(existingSub);

      if (!isOldProperty) {
        console.log(`🆕 [Webhook] العقار الجديد ${payment.propertyNumber} - تحقق ناجح + دفع مكتمل → انتظار اعتماد الإدارة`);
      }

      // ===============================
      // 5) تفعيل الاشتراك (بعد نجاح التحقق — العقار القديم والجديد)
      // ===============================
      if (property) {
        const pkg = await subscriptionService.getPackageById(payment.packageId);
        if (!pkg) {
          await paymentService.update(payment.id, {
            status: "مرفوض" as any,
            notes: "تم رفض الدفع: الباقة غير موجودة",
          });
          return res.json({ ok: true, status: "rejected", reason: "الباقة غير موجودة" });
        }

        const calculatedDates = calculateActionDates(payment.action, existingSub, pkg.duration);
        if (!isOldProperty) {
          const queued = await queueVerifiedNewPropertyForAdminApproval({
            payment,
            property,
            pkg,
            startDate: payment.pendingStartDate || calculatedDates.startDate,
            endDate: payment.pendingEndDate || calculatedDates.endDate,
            finalAmount: payment.pendingPrice || payment.finalAmount,
          });
          console.log(`🆕 [Webhook] Payment queued for admin approval for new property ${payment.propertyNumber}. Linked: ${queued.linkedProperties.join(", ") || "none"}`);

          if (property.whatsappNumber) {
            try {
              await sendPropertyOwnerWhatsApp({
                ownerPhone: property.whatsappNumber,
                propertyNumber: payment.propertyNumber,
                message: `تم التحقق من الدفع وبيانات العقار ${property.name || payment.propertyNumber} بنجاح.\n\nلأن العقار جديد، سيبقى الطلب بانتظار اعتماد الإدارة قبل تفعيل الاشتراك.\n\nالخطوة التالية: لا يلزمك إجراء إضافي الآن.`,
              });
            } catch (err) {
              console.error("❌ Owner pending approval notification failed:", err);
            }
          }
        } else {
          const activation = await activateVerifiedPaymentSubscription({
            payment,
            property,
            pkg,
            startDate: payment.pendingStartDate || calculatedDates.startDate,
            endDate: payment.pendingEndDate || calculatedDates.endDate,
            finalAmount: payment.pendingPrice || payment.finalAmount,
          });

          await paymentService.update(payment.id, {
            status: "مكتمل" as any,
            completedAt: new Date().toISOString(),
          });
          console.log(`🎉 [Webhook] Subscription activated for ${payment.propertyNumber}. Linked: ${activation.linkedProperties.join(", ") || "none"}`);

          if (property.whatsappNumber) {
            try {
              await notifyOwnerSubscriptionActivated({
                ownerPhone: property.whatsappNumber,
                propertyNumber: payment.propertyNumber,
                propertyName: property.name || "",
                endDate: activation.endDate,
              });
            } catch (err) {
              console.error("❌ Owner activation notification failed:", err);
            }
          }
        }
      }

      // إرسال إشعار WhatsApp عند نجاح الدفع
      try {
        const property = await propertyService.getByNumber(payment.propertyNumber);
        const pkg = await subscriptionService.getPackageById(payment.packageId);

        await notifyNewPayment({
          propertyNumber: payment.propertyNumber,
          propertyName: property?.name || payment.propertyNumber,
          amount: payment.finalAmount,
          paymentMethod: cardSubType || paymentMethod || "بطاقة",
          transactionId,
        });
        console.log("✅ WhatsApp notification sent for payment:", transactionId);
      } catch (err) {
        console.error("❌ WhatsApp notification failed:", err);
      }

      return res.json({ ok: true, paymentId: payment.id });
    } catch (err) {
      console.error("❌ Webhook Error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

export default router;
