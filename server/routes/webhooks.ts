import { Router } from "express";
import { propertyService, paymentService, addOnService } from "../services";
import { firebaseService } from "../firebaseService";
import { paymobService } from "../integrations/paymob";
import { sendWhatsAppNotification, notifyNewPayment, notifyOwnerSubscriptionActivated, sendPropertyOwnerWhatsApp } from "../integrations/whatsapp";
import { getExactPaymobPaymentMethod } from "../utils/paymobPaymentMethod";

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
    // Paymob's browser transaction redirect uses `merchant_order_id`, while
    // some callback variants also expose `special_reference`. Both values are
    // untrusted UX hints only, but either can safely select the destination.
    const callbackReferences = [
      req.query.merchant_order_id,
      req.query.special_reference,
    ].filter((value): value is string => typeof value === "string");
    const isAddon = callbackReferences.some((reference) => {
      const normalizedReference = reference.trim();
      return normalizedReference.startsWith("RWQN-ADDON-") ||
        normalizedReference.startsWith("PAY-ADDON-") ||
        normalizedReference.startsWith("addon-");
    });

    return res.redirect(
      isAddon
        ? `/owner/dashboard?addon_payment=${success ? "processing" : "failed"}`
        : `/subscription?payment=${success ? "processing" : "failed"}`,
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
      const reportsSuccess = callbackBoolean(t.success);
      const isPending = callbackBoolean(t.pending);
      const isSuccess =
        reportsSuccess &&
        !callbackBoolean(t.error_occured) &&
        !callbackBoolean(t.is_refunded) &&
        !callbackBoolean(t.is_voided) &&
        (
          callbackBoolean(t.is_standalone_payment) ||
          callbackBoolean(t.is_capture)
        );
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

      // A signed callback can report `success=true` for a refund, void, error,
      // or authorization-only transaction. Those events are neither a payable
      // sale nor a declined checkout attempt: acknowledge them without
      // activating anything or changing the intention's failure state.
      if (reportsSuccess && !isSuccess) {
        console.warn("Ignoring non-payable successful Paymob transaction", {
          transactionId,
          errorOccurred: callbackBoolean(t.error_occured),
          refunded: callbackBoolean(t.is_refunded),
          voided: callbackBoolean(t.is_voided),
          standalone: callbackBoolean(t.is_standalone_payment),
          capture: callbackBoolean(t.is_capture),
        });
        return res.json({
          ok: true,
          status: "ignored_non_payable_settlement",
        });
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
      const callbackPayments = await paymentService.getAll();
      const signedOrderMatches = paymobOrderId
        ? callbackPayments.filter(
            (candidate) => candidate.paymobOrderId === paymobOrderId,
          )
        : [];
      if (signedOrderMatches.length > 1) {
        console.error(`Duplicate Paymob order id in callback: ${paymobOrderId}`);
        return res.status(409).json({ error: "Callback order is not unique" });
      }
      const signedOrderPayment = signedOrderMatches[0] || null;
      const isAddonPayment =
        signedOrderPayment?.action === "addon" ||
        specialReference.startsWith("PAY-ADDON-") ||
        creationExtras?.type === "addon";

      if (isAddonPayment) {
        console.log(`📦 Processing add-on payment webhook, special_reference: ${specialReference}`);

        // The numeric provider order participates in Paymob's verified HMAC.
        // Unsigned references may only agree with that persisted match; they
        // can never select or bind an add-on payment themselves.
        let pendingPayment = signedOrderPayment;
        const callbackPaymentIds = new Set<string>();
        if (specialReference.startsWith("PAY-ADDON-")) {
          callbackPaymentIds.add(specialReference);
        }
        if (creationExtras?.paymentId) {
          callbackPaymentIds.add(String(creationExtras.paymentId));
        }
        if (callbackPaymentIds.size > 1) {
          console.error("Conflicting add-on payment identifiers in Paymob callback");
          return res.status(409).json({ error: "Callback identifiers conflict" });
        }

        const explicitPaymentId = [...callbackPaymentIds][0] || "";
        if (
          !pendingPayment ||
          pendingPayment.action !== "addon" ||
          !pendingPayment.merchantAttemptKey ||
          (explicitPaymentId && explicitPaymentId !== pendingPayment.id) ||
          (
            creationExtras?.merchantAttemptKey &&
            String(creationExtras.merchantAttemptKey) !==
              pendingPayment.merchantAttemptKey
          )
        ) {
          console.error("Add-on callback lacks an exact persisted provider identity", {
            paymobOrderId,
            explicitPaymentId,
          });
          return res.status(409).json({
            error: "Add-on payment requires exact provider reconciliation",
          });
        }

        if (!callbackMatchesPayment(pendingPayment, t)) {
          console.error(`Paymob amount/currency mismatch for add-on ${pendingPayment.id}`);
          return res.status(422).json({ error: "Callback amount or currency mismatch" });
        }

        if (!isSuccess) {
          const failureSettlement = await firebaseService.settleAddOnPaymentCallback(
            pendingPayment.id,
            {
              merchantAttemptKey: pendingPayment.merchantAttemptKey,
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

        const exactAddonPaymentMethod = getExactPaymobPaymentMethod({
          cardSubType: t.source_data?.sub_type,
          paymentMethod: t.source_data?.type,
        });
        if (!exactAddonPaymentMethod) {
          console.error(
            `Paymob success lacks an exact payment subtype for add-on ${pendingPayment.id}`,
          );
          return res.status(422).json({
            error: "Add-on callback requires an exact payment subtype",
            reason: "generic_payment_method",
          });
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
            merchantAttemptKey: pendingPayment.merchantAttemptKey,
            transactionId,
            paymobOrderId,
            amountCents: Number(t.amount_cents),
            currency: String(t.currency || ""),
            success: true,
          },
          {
            paymentMethod: exactAddonPaymentMethod,
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
        const paymentsByAttempt = callbackAttemptKey
          ? failedPayments.filter(
            (payment) => payment.merchantAttemptKey === callbackAttemptKey,
          )
          : [];
        if (paymentsByAttempt.length > 1) {
          console.error(
            `Duplicate merchant attempt key in failed Paymob callback: ${callbackAttemptKey}`,
          );
          return res.status(409).json({ error: "Callback attempt is not unique" });
        }
        const paymentByAttempt = paymentsByAttempt[0] || null;
        const paymentsByOrder = paymobOrderId
          ? failedPayments.filter(
            (payment) => payment.paymobOrderId === paymobOrderId,
          )
          : [];
        if (paymentsByOrder.length > 1) {
          console.error(
            `Duplicate Paymob order id in failed callback: ${paymobOrderId}`,
          );
          return res.status(409).json({ error: "Callback order is not unique" });
        }
        const paymentByOrder = paymentsByOrder[0] || null;

        if (callbackPaymentId && !paymentById) {
          console.error(
            `Unknown local payment id in failed Paymob callback: ${callbackPaymentId}`,
          );
          return res.status(404).json({ error: "Payment not found" });
        }

        const correlatedPaymentIds = new Set(
          [paymentById, paymentByAttempt, paymentByOrder]
            .filter(Boolean)
            .map((candidate) => candidate!.id),
        );
        if (correlatedPaymentIds.size > 1) {
          console.error("Conflicting failed-payment identifiers in Paymob callback");
          return res.status(409).json({ error: "Callback identifiers conflict" });
        }

        let failedPayment = null;
        if (paymentByOrder) {
          // Paymob's order id participates in the callback HMAC. Prefer its
          // unique persisted match even when a declined transaction omits
          // creation_extras, while still rejecting a stale supplied attempt.
          if (
            callbackAttemptKey &&
            paymentByOrder.merchantAttemptKey &&
            paymentByOrder.merchantAttemptKey !== callbackAttemptKey
          ) {
            console.error(
              `Stale Paymob attempt for failed payment ${paymentByOrder.id}`,
            );
            return res.status(409).json({ error: "Stale payment attempt" });
          }
          failedPayment = paymentByOrder;
        } else if (paymentById?.merchantAttemptKey) {
          if (
            !callbackPaymentId ||
            !callbackAttemptKey ||
            paymentByAttempt?.id !== paymentById.id
          ) {
            console.error(
              `Stale Paymob attempt for failed payment ${paymentById.id}`,
            );
            return res.status(409).json({ error: "Stale payment attempt" });
          }
          failedPayment = paymentById;
        } else if (!callbackPaymentId && paymentByAttempt) {
          // Some intention callbacks preserve only special_reference. Older
          // records without a persisted order are verified against the exact
          // provider intention below before any mutation is attempted.
          failedPayment = paymentByAttempt;
        } else if (paymobOrderId) {
          // Legacy compatibility is limited to a unique HMAC-covered order
          // belonging to a record that predates merchant-attempt keys.
          const legacyMatches = failedPayments.filter(
            (payment) =>
              !payment.merchantAttemptKey &&
              payment.paymobOrderId === paymobOrderId,
          );
          if (
            !paymentByAttempt &&
            legacyMatches.length === 1 &&
            (!paymentById || paymentById.id === legacyMatches[0].id)
          ) {
            failedPayment = legacyMatches[0];
          }
        }

        if (!failedPayment) {
          // Property/amount matching is intentionally not used for failures:
          // two attempts can share both values, and releasing the wrong lock
          // could permit a duplicate charge.
          console.error("Failed Paymob webhook requires exact reconciliation", {
            paymentId: creationExtras?.paymentId,
            specialReference,
            paymobOrderId,
          });
          return res.status(404).json({ error: "Payment not found" });
        }

        if (failedPayment.merchantAttemptKey && !failedPayment.paymobOrderId) {
          // special_reference and creation_extras are not HMAC-covered. Bind
          // an older attempt-only record to the callback's signed order through
          // its exact stored checkout intention before accepting it.
          const checkoutUrl = String(
            failedPayment.paymentCheckoutUrl || "",
          ).trim();
          const expectedIntentionId = String(
            failedPayment.paymentReference || "",
          ).trim();
          if (!checkoutUrl || !expectedIntentionId) {
            console.error(
              `Modern failed Paymob payment ${failedPayment.id} requires exact provider reconciliation`,
            );
            return res.status(409).json({
              error: "Payment requires provider reconciliation",
            });
          }
          const providerLookup = await paymobService.retrieveIntention(checkoutUrl);
          if (!providerLookup.ok) {
            console.error(
              `Paymob intention lookup unavailable for failed payment ${failedPayment.id}`,
            );
            return res.status(503).json({
              error: "Payment provider verification unavailable",
            });
          }
          const providerIntention = providerLookup.snapshot;
          const signedProviderTransaction = providerIntention.signedTransaction;
          if (
            providerIntention.intentionId !== expectedIntentionId ||
            providerIntention.specialReference !==
              failedPayment.merchantAttemptKey ||
            providerIntention.orderId !== paymobOrderId ||
            providerIntention.amountCents !== Number(t.amount_cents) ||
            providerIntention.currency !==
              String(t.currency || "").trim().toUpperCase() ||
            (
              signedProviderTransaction &&
              (
                signedProviderTransaction.transactionId !== transactionId ||
                signedProviderTransaction.orderId !== paymobOrderId
              )
            )
          ) {
            console.error(
              `Paymob provider identity mismatch for failed payment ${failedPayment.id}`,
            );
            return res.status(409).json({
              error: "Payment provider identity mismatch",
            });
          }
        }

        if (!callbackMatchesPayment(failedPayment, t)) {
          console.error(
            `Paymob amount/currency mismatch for failed payment ${failedPayment.id}`,
          );
          return res.status(422).json({
            error: "Callback amount or currency mismatch",
          });
        }
        const failedPaymentStatus = String(failedPayment.status || "")
          .trim()
          .toLowerCase();
        const financiallyAcceptedStatuses = new Set([
          "مكتمل",
          "نجح",
          "نجح - قيد التحقق",
          "مدفوع",
          "paid",
          "success",
          "successful",
          "completed",
          "processing",
        ]);
        if (
          failedPayment.completedAt ||
          failedPayment.fulfilledAt ||
          failedPayment.fulfillmentState === "processing" ||
          failedPayment.fulfillmentState === "fulfilled" ||
          financiallyAcceptedStatuses.has(failedPaymentStatus)
        ) {
          console.warn(
            `Ignoring late failed callback for accepted payment ${failedPayment.id}`,
          );
          return res.json({ ok: true, status: "ignored_late_failure" });
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
          return res.status(409).json({
            error: "Payment callback could not be accepted",
          });
        }
        return res.json({ ok: true, status: "recorded_failure" });
      }

      // ===============================
      // 2) البحث عن سجل الدفع
      // ===============================
      const payments = callbackPayments;
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
      const paymentsByAttempt = callbackAttemptKey
        ? payments.filter(
          (candidate) => candidate.merchantAttemptKey === callbackAttemptKey,
        )
        : [];
      if (paymentsByAttempt.length > 1) {
        console.error(
          `Duplicate merchant attempt key in Paymob callback: ${callbackAttemptKey}`,
        );
        return res.status(409).json({ error: "Callback attempt is not unique" });
      }
      const paymentByAttempt = paymentsByAttempt[0] || null;
      const paymentsByOrder = paymobOrderId
        ? payments.filter(
          (candidate) => candidate.paymobOrderId === paymobOrderId,
        )
        : [];
      if (paymentsByOrder.length > 1) {
        console.error(`Duplicate Paymob order id in callback: ${paymobOrderId}`);
        return res.status(409).json({ error: "Callback order is not unique" });
      }
      const paymentByOrder = paymentsByOrder[0] || null;

      if (callbackPaymentId && !paymentById) {
        console.error(`Unknown local payment id in Paymob callback: ${callbackPaymentId}`);
        return res.status(404).json({ error: "Payment not found" });
      }

      const correlatedPaymentIds = new Set(
        [paymentById, paymentByAttempt, paymentByOrder]
          .filter(Boolean)
          .map((candidate) => candidate!.id),
      );
      if (correlatedPaymentIds.size > 1) {
        console.error("Conflicting payment identifiers in Paymob callback");
        return res.status(409).json({ error: "Callback identifiers conflict" });
      }
      if (paymentByOrder) {
        // The order id participates in Paymob's HMAC and is therefore the
        // strongest persisted correlation key. Any supplied local identifiers
        // were checked for conflicts above before preferring it.
        if (
          callbackAttemptKey &&
          paymentByOrder.merchantAttemptKey &&
          paymentByOrder.merchantAttemptKey !== callbackAttemptKey
        ) {
          console.error(`Stale Paymob attempt for payment ${paymentByOrder.id}`);
          return res.status(409).json({ error: "Stale payment attempt" });
        }
        payment = paymentByOrder;
      } else if (paymentById?.merchantAttemptKey) {
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
      } else if (!callbackPaymentId && paymentByAttempt) {
        // Paymob's live intention callback may preserve special_reference while
        // omitting creation_extras. The HMAC-verified final transaction can
        // still be correlated to one exact current merchant attempt. The
        // transactional acceptance below repeats the attempt and uniqueness
        // checks before mutating the payment.
        payment = paymentByAttempt;
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

      if (payment.merchantAttemptKey && !payment.paymobOrderId) {
        // Paymob does not include special_reference in its transaction HMAC.
        // For an older/local record whose numeric order was not persisted at
        // intention creation, bind the callback's HMAC-covered order back to
        // the exact stored checkout intention through Paymob before accepting
        // it. This prevents a valid redirect HMAC from being replayed with a
        // different, non-HMAC-covered merchant reference.
        const checkoutUrl = String(payment.paymentCheckoutUrl || "").trim();
        const expectedIntentionId = String(
          payment.paymentReference || "",
        ).trim();
        if (!checkoutUrl || !expectedIntentionId) {
          console.error(
            `Modern Paymob payment ${payment.id} requires exact provider reconciliation`,
          );
          return res.status(409).json({
            error: "Payment requires provider reconciliation",
          });
        }
        const providerLookup = await paymobService.retrieveIntention(checkoutUrl);
        if (!providerLookup.ok) {
          console.error(
            `Paymob intention lookup unavailable for callback payment ${payment.id}`,
          );
          return res.status(503).json({
            error: "Payment provider verification unavailable",
          });
        }
        const providerIntention = providerLookup.snapshot;
        const signedProviderTransaction = providerIntention.signedTransaction;
        if (
          providerIntention.intentionId !== expectedIntentionId ||
          providerIntention.specialReference !== payment.merchantAttemptKey ||
          providerIntention.orderId !== paymobOrderId ||
          providerIntention.amountCents !== Number(t.amount_cents) ||
          providerIntention.currency !==
            String(t.currency || "").trim().toUpperCase() ||
          (
            signedProviderTransaction &&
            (
              signedProviderTransaction.transactionId !== transactionId ||
              signedProviderTransaction.orderId !== paymobOrderId
            )
          )
        ) {
          console.error(
            `Paymob provider identity mismatch for callback payment ${payment.id}`,
          );
          return res.status(409).json({
            error: "Payment provider identity mismatch",
          });
        }
      }

      if (!callbackMatchesPayment(payment, t)) {
        console.error(`Paymob amount/currency mismatch for payment ${payment.id}`);
        return res.status(422).json({
          error: "Callback amount or currency mismatch",
        });
      }

      const exactSubscriptionPaymentMethod = getExactPaymobPaymentMethod({
        cardSubType,
        paymentMethod,
      });
      if (!exactSubscriptionPaymentMethod) {
        // A signed success proves the financial event, but a generic "card"
        // label cannot satisfy the dashboard invariant or distinguish Apple
        // Pay, Visa, Mada, etc. Leave the attempt recoverable instead of
        // permanently fulfilling it with invented metadata.
        console.error(
          `Paymob success lacks an exact payment subtype for ${payment.id}`,
        );
        return res.status(422).json({
          error: "Payment callback requires an exact payment subtype",
          reason: "generic_payment_method",
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
          paymentMethod: exactSubscriptionPaymentMethod,
          merchantFees,
          acqFees,
        vatAmount,
          totalFees,
          feeAmount: merchantFees + acqFees,
          netAmount,
        },
      );
      const wasAlreadyAccepted =
        successAcceptance.status === "already_accepted";
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

      // Both the first callback and every exact replay use the same
      // claim-protected fulfillment service. This removes the former race
      // between the webhook's inline activation path and replay recovery.
      try {
        const fulfillment = await paymentService.approveBankTransfer(payment.id);

        // Only the fulfillment winner emits the general paid notification.
        // Replays that observe an already activated or queued payment have no
        // notification side effects.
        if (!fulfillment.alreadyProcessed) {
          try {
            const paidProperty = await propertyService.getByNumber(
              payment.propertyNumber,
            );
            await notifyNewPayment({
              propertyNumber: payment.propertyNumber,
              propertyName: paidProperty?.name || payment.propertyNumber,
              amount: payment.finalAmount,
              paymentMethod: exactSubscriptionPaymentMethod,
              transactionId,
            });
          } catch (notificationError) {
            console.error("Paymob payment notification failed:", notificationError);
          }
        }

        const responseStatus = fulfillment.outcome === "activated"
          ? (
              wasAlreadyAccepted || fulfillment.alreadyProcessed
                ? "activation_resumed"
                : "activated"
            )
          : "pending_activation";
        return res.json({
          ok: true,
          status: responseStatus,
          activation: fulfillment.outcome,
          paymentId: payment.id,
        });
      } catch (error) {
        const reason =
          error instanceof Error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : error instanceof Error &&
                error.message === "Payment fulfillment is already in progress"
              ? "PAYMENT_FULFILLMENT_IN_PROGRESS"
              : "ACTIVATION_PENDING";
        const explanation = error instanceof Error
          ? error.message
          : "تعذر إكمال التفعيل بعد تأكيد الدفع";

        // Financial success is terminal even when business activation must
        // wait for images, package repair, or an administrative suspension.
        // Keep the paid state recoverable and expose the exact reason in the
        // dashboard instead of ever rewriting a charged payment as rejected.
        if (reason !== "PAYMENT_FULFILLMENT_IN_PROGRESS") {
          await firebaseService.recordPaidPaymentActivationPending(
            payment.id,
            transactionId,
            `تم تأكيد الدفع لدى Paymob، والتفعيل بانتظار المعالجة: ${explanation}`,
          ).catch((updateError) =>
            console.error(
              `Failed to store pending activation reason for ${payment.id}:`,
              updateError,
            ),
          );
        }

        console.warn(
          `Paymob payment ${payment.id} is accepted but activation remains pending:`,
          error,
        );
        return res.json({
          ok: true,
          status:
            reason === "PROPERTY_SUSPENDED"
              ? "property_suspended"
              : reason.includes("PROPERTY_") || reason.includes("IMAGE")
                ? "pending_verification"
                : "pending_activation",
          paymentId: payment.id,
          reason,
        });
      }
    } catch (err) {
      console.error("❌ Webhook Error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

export default router;
