import { Router } from "express";
import { propertyService, paymentService, subscriptionService, addOnService } from "../services";
import { firebaseService } from "../firebaseService";
import { paymobService } from "../integrations/paymob";
import { sendWhatsAppNotification, notifyNewPayment, notifyOwnerSubscriptionActivated, sendOwnerWhatsApp } from "../integrations/whatsapp";
import { checkPropertyDataComplete } from "../utils/verification";
import { countR2Images } from "../utils/r2";
import {
  activateVerifiedPaymentSubscription,
  calculateActionDates,
  hasPriorSubscription,
  queueVerifiedNewPropertyForAdminApproval,
} from "../services/payments/paymentScenarioFlow";

const router = Router();

  // ======================
  // PAYMOB WEBHOOK - GET (Return URL redirect)
  // ======================
  router.get("/api/paymob/webhook", async (req, res) => {
    try {
      console.log("📥 Paymob GET redirect received");
      console.log("📥 Query params:", req.query);

      const success = req.query.success === "true";
      const orderId = (req.query.order as string) || "";
      const transactionId = (req.query.id as string) || "";
      const merchantOrderId = (req.query.merchant_order_id as string) || "";

      console.log(`📊 success=${success}, order=${orderId}, txn=${transactionId}, merchantOrderId=${merchantOrderId}`);

      // 🔍 استخراج رقم العقار من merchant_order_id أو special_reference
      let propertyNumber = "";
      let isAddonPaymentFromRef = false;

      // التحقق من special_reference أولاً للإضافات
      const specialRef = req.query.special_reference as string || "";
      if (specialRef && specialRef.startsWith("addon-")) {
        // صيغة الإضافات: addon-propertyNumber-timestamp
        const parts = specialRef.split("-");
        if (parts.length >= 2) {
          propertyNumber = parts[1];
          isAddonPaymentFromRef = true;
        }
      }

      // إذا لم نجد من special_reference، نحاول من merchant_order_id
      if (!propertyNumber && merchantOrderId && merchantOrderId.includes("-")) {
        if (merchantOrderId.startsWith("addon-")) {
          // صيغة الإضافات
          const parts = merchantOrderId.split("-");
          if (parts.length >= 2) {
            propertyNumber = parts[1];
            isAddonPaymentFromRef = true;
          }
        } else {
          // صيغة الاشتراكات العادية: propertyNumber-timestamp
          propertyNumber = merchantOrderId.split("-")[0];
        }
      }

      console.log("🏡 Extracted property number:", propertyNumber, "isAddon:", isAddonPaymentFromRef);

      // 🔎 استعلام الرسوم (اختياري)
      if (success && orderId) {
        try {
          const { paymobService } = await import("../integrations/paymob");
          console.log(`📡 Calling Paymob Inquiry API with order_id: ${orderId}`);
          const inquiry = await paymobService.inquiryByOrderId(orderId);

          if (inquiry?.ok) {
            console.log("✅ Inquiry fees:", inquiry);
          } else {
            console.log("⚠️ Inquiry returned no data");
          }
        } catch (err) {
          console.log("❌ Inquiry API Error:", err);
        }
      }

      // 🎯 إعادة التوجيه بناءً على نوع العملية
      if (success) {
        let paymentAction = '';

        // 📲 إرسال إشعار واتساب عند نجاح الدفع الإلكتروني + تحديث حالة الدفع
        if (propertyNumber) {
          try {
            const property = await propertyService.getByNumber(propertyNumber);
            const payments = await paymentService.getAll();

            // البحث عن الدفعة الأحدث للعقار (POST webhook قد يصل قبل GET ويغير الحالة)
            // لذلك نبحث عن أي دفعة أُنشئت خلال آخر 10 دقائق
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            const payment = payments
              .filter(p => p.propertyNumber === propertyNumber && new Date(p.createdAt || 0) > tenMinutesAgo)
              .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];

            console.log(`🔍 Looking for payment: propertyNumber=${propertyNumber}, found=${!!payment}, action=${(payment as any)?.action}, status=${payment?.status}`);

            // حفظ نوع العملية
            paymentAction = (payment as any)?.action || '';

            // تحديث حالة الدفع (فقط إذا كان لا يزال معلقاً - POST webhook قد يكون سبقنا)
            if (payment && (payment.status === "معلق" || payment.status === "قيد المراجعة")) {
              // جميع المدفوعات تذهب للمرحلة الإجبارية: التحقق
              await paymentService.update(payment.id, {
                status: "نجح - قيد التحقق" as any,
                transactionId,
                completedAt: new Date().toISOString()
              });

              // التحقق التلقائي من بيانات العقار
              let autoVerified = false;
              let missingFields: string[] = [];
              if (property) {
                const { checkPropertyDataComplete } = await import("../utils/verification");
                const { countR2Images } = await import("../utils/r2");
                const r2ImgCount = await countR2Images(propertyNumber);
                const dataCheck = await checkPropertyDataComplete(property, r2ImgCount);
                missingFields = dataCheck.missingFields;
                autoVerified = dataCheck.isComplete;
              }

              if (autoVerified) {
                // فحص: هل هذا عقار جديد (لا يملك اشتراك سابق)؟
                const existingSubGet = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
                const pkg = await subscriptionService.getPackageById(payment.packageId);
                if (property && pkg) {
                  const calculatedDates = calculateActionDates(payment.action, existingSubGet, pkg.duration);
                  if (!hasPriorSubscription(existingSubGet)) {
                    const queued = await queueVerifiedNewPropertyForAdminApproval({
                      payment,
                      property,
                      pkg,
                      startDate: payment.pendingStartDate || calculatedDates.startDate,
                      endDate: payment.pendingEndDate || calculatedDates.endDate,
                      finalAmount: payment.pendingPrice || payment.finalAmount,
                    });
                    if (property.whatsappNumber) {
                      await sendOwnerWhatsApp(
                        property.whatsappNumber,
                        `تم التحقق من الدفع وبيانات العقار ${property.name || propertyNumber} بنجاح.\n\nلأن العقار جديد، سيبقى الطلب بانتظار اعتماد الإدارة قبل تفعيل الاشتراك.\n\nالخطوة التالية: لا يلزمك إجراء إضافي الآن.`,
                      ).catch(err => console.error("Owner pending approval notification failed:", err));
                    }
                    console.log(`🆕 Payment verified for new property ${propertyNumber}; queued for admin approval until ${queued.endDate}`);
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
                    if (property.whatsappNumber) {
                      await notifyOwnerSubscriptionActivated({
                        ownerPhone: property.whatsappNumber,
                        propertyNumber,
                        propertyName: property.name || "",
                        endDate: activation.endDate,
                      }).catch(err => console.error("Owner activation notification failed:", err));
                    }
                  }
                } else {
                  await paymentService.update(payment.id, {
                    status: "مرفوض" as any,
                    notes: "تعذر تفعيل الاشتراك: الباقة غير موجودة",
                  });
                }
                console.log(`✅ Payment auto-verified: ${payment.id} (property ${propertyNumber}, hasPrior: ${hasPriorSubscription(existingSubGet)})`);
              } else {
                await paymentService.update(payment.id, {
                  status: "نجح - قيد التحقق" as any,
                  notes: `بيانات العقار غير مكتملة: ${missingFields.join('، ')}`
                });
                if (property) {
                  await firebaseService.updateVerificationStatus(propertyNumber, "pending");
                  if (property.whatsappNumber) {
                    await sendOwnerWhatsApp(
                      property.whatsappNumber,
                      `تم استلام الدفع، لكن بيانات العقار ${property.name || propertyNumber} غير مكتملة.\n\nالحقول المطلوبة: ${missingFields.join("، ")}\n\nالخطوة التالية: عدّل بيانات العقار وارفع الصور المطلوبة ثم شغّل التحقق من صفحة الاشتراك.`,
                    ).catch(err => console.error("Owner incomplete data notification failed:", err));
                  }
                }
                console.log("⏳ Payment kept pending verification (incomplete data):", payment.id, missingFields);
              }
            } else if (payment && payment.status === "مرفوض") {
              console.log("⚠️ Payment was already rejected by POST webhook:", payment.id);
            }

            // رسالة مختلفة حسب نوع العملية
            const isAddonPayment = payment?.packageId?.startsWith('addon-') || isAddonPaymentFromRef;
            let actionLabel = 'اشتراك جديد';
            if (isAddonPayment) {
              actionLabel = 'شراء إضافة';
            } else if (paymentAction === 'upgrade') {
              actionLabel = 'ترقية';
            } else if (paymentAction === 'extend') {
              actionLabel = 'تمديد';
            }

            const paymentStatus = payment?.status || "غير معروف";
            const isRejected = paymentStatus === "مرفوض";
            const isAwaitingAdminApproval = paymentStatus === "نجح - قيد التحقق";
            const paymentStateLabel = isRejected
              ? "مرفوض - راجع سبب الرفض"
              : isAddonPayment
                ? "نجح - قيد مراجعة الإدارة"
                : isAwaitingAdminApproval
                  ? "نجح - بانتظار اعتماد الإدارة أو استكمال البيانات"
                  : "نجح - تم التحقق التلقائي";
            
            await sendWhatsAppNotification(
              `💳 *${isRejected ? 'تم رفض الدفع' : 'تم استلام دفعة إلكترونية'}*\n\n` +
              `🏠 العقار: ${property?.name || propertyNumber}\n` +
              `🔢 رقم العقار: ${propertyNumber}\n` +
              `💰 المبلغ: ${payment?.finalAmount || 'غير محدد'} ر.س\n` +
              `🔢 رقم العملية: ${transactionId}\n` +
              `📋 نوع العملية: ${actionLabel}\n` +
              `📋 الحالة: ${paymentStateLabel}`
            );
            console.log("✅ WhatsApp notification sent for electronic payment:", transactionId);
          } catch (notifyErr) {
            console.log("⚠️ Failed to send WhatsApp notification:", notifyErr);
          }
        }

        // التوجيه حسب نوع العملية وحالة الدفع
        let redirectUrl: string;
        let currentPaymentStatus = '';

        // التحقق من حالة الدفع (قد يكون مرفوضاً بسبب سبب نهائي مثل باقة غير موجودة)
        if (propertyNumber) {
          const payments = await paymentService.getAll();
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          const recentPayment = payments
            .filter(p => p.propertyNumber === propertyNumber && new Date(p.createdAt || 0) > tenMinutesAgo)
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
          currentPaymentStatus = recentPayment?.status || '';
        }

        // التحقق من نوع الباقة (إضافة أم اشتراك)
        let isAddonPaymentRedirect = isAddonPaymentFromRef;
        if (!isAddonPaymentRedirect && propertyNumber) {
          const payments = await paymentService.getAll();
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          const recentPayment = payments
            .filter(p => p.propertyNumber === propertyNumber && new Date(p.createdAt || 0) > tenMinutesAgo)
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
          isAddonPaymentRedirect = recentPayment?.packageId?.startsWith('addon-') || false;
        }

        if (currentPaymentStatus === "مرفوض") {
          // تم رفض الدفع بسبب سبب نهائي
          redirectUrl = `/subscription?payment=rejected&property=${propertyNumber}&reason=verification_failed`;
        } else if (isAddonPaymentRedirect) {
          // إضافة: توجيه للوحة التحكم مع تحديد نجاح الدفع
          redirectUrl = `/owner/dashboard?addon_payment=success`;
        } else if (paymentAction === 'upgrade' || paymentAction === 'extend') {
          // الترقية والتمديد: توجيه للوحة التحكم
          redirectUrl = `/owner/dashboard?payment=success`;
        } else {
          // تسجيل جديد: توجيه لصفحة المراجعة
          redirectUrl = `/subscription?payment=success&property=${propertyNumber}`;
        }

        console.log(`🔁 Redirecting to: ${redirectUrl} (action: ${paymentAction || 'new'}, isAddon: ${isAddonPaymentRedirect}, status: ${currentPaymentStatus})`);
        return res.redirect(redirectUrl);
      } else {
        return res.redirect(`/subscription?payment=failed`);
      }

    } catch (error) {
      console.error("❌ GET Webhook Error:", error);
      return res.redirect(`/subscription?payment=error`);
    }
  });


  // ======================
  // PAYMOB WEBHOOK - POST (Server-to-Server notification)
  // ======================
  router.post("/api/paymob/webhook", async (req, res) => {
    try {
      console.log("📥 Paymob webhook received");
      console.log("📥 Body:", JSON.stringify(req.body, null, 2));

      const webhook = req.body;
      const t = webhook.obj;
      if (!t) {
        console.log("⚠️ Missing obj");
        return res.json({ ok: true });
      }

      // استخراج المعلومات الأساسية
      const transactionId = String(t.id || "");
      const isSuccess = t.success;
      const paymobOrderId = String(t.order?.id || t.order || "");
      const merchantOrderId =
        t.merchant_order_id || t.order?.merchant_order_id || "";
      const amount = (t.amount_cents || 0) / 100;
      const creationExtras = t.order?.extras?.creation_extras || {};

      // ===============================
      // معالجة دفعات الإضافات - طريقة موحدة
      // البحث في السجلات المعلقة أو من extras
      // ===============================
      const specialReference = t.order?.special_reference || merchantOrderId || "";
      const isAddonPayment = specialReference.startsWith("PAY-ADDON-") || creationExtras?.type === "addon";

      if (isAddonPayment) {
        console.log(`📦 Processing add-on payment webhook, special_reference: ${specialReference}`);

        // البحث عن سجل الدفع المعلق
        const allPayments = await paymentService.getAll();
        let pendingPayment = null;

        // أولاً: البحث بـ special_reference (paymentId)
        if (specialReference.startsWith("PAY-ADDON-")) {
          pendingPayment = allPayments.find(p => p.id === specialReference);
        }

        // ثانياً: البحث بـ extras إذا لم نجد
        if (!pendingPayment && creationExtras?.paymentId) {
          pendingPayment = allPayments.find(p => p.id === creationExtras.paymentId);
        }

        // ثالثاً: البحث بالحالة والمصدر
        if (!pendingPayment) {
          pendingPayment = allPayments.find(p =>
            p.action === "addon" &&
            p.status === "قيد الدفع" &&
            p.paymentMethod === "paymob" &&
            Math.abs(p.finalAmount - amount) < 1 // نفس المبلغ تقريباً
          );
        }

        if (!pendingPayment) {
          console.log(`⚠️ No pending addon payment found for: ${specialReference}`);
          return res.json({ ok: true });
        }

        const addonPropertyNumber = pendingPayment.propertyNumber;
        const addonId = pendingPayment.packageId;
        const addonName = pendingPayment.packageName;
        const addonPrice = pendingPayment.finalAmount;

        if (!isSuccess) {
          // فشل الدفع - تحديث الحالة
          await paymentService.update(pendingPayment.id, {
            status: "فشل",
            paymobOrderId,
            transactionId,
          });
          console.log(`❌ Addon payment failed: ${pendingPayment.id}`);
          return res.json({ ok: true });
        }

        console.log(`📦 Found pending addon payment: ${pendingPayment.id} for property ${addonPropertyNumber}`);

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

        // تحديث سجل الدفع المعلق بدلاً من إنشاء جديد
        await paymentService.update(pendingPayment.id, {
          paymobOrderId,
          status: "نجح - قيد التحقق",
          transactionId,
          merchantFees: addonMerchantFees,
          acqFees: addonAcqFees,
          vatAmount: addonVatAmount,
          totalFees: addonTotalFees,
          netAmount: addonNetAmount,
          completedAt: new Date().toISOString(),
        });

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

      // البحث 1: بـ merchant_order_id (الصيغة: propertyNumber-timestamp أو id)
      if (!payment && merchantOrderId) {
        // استخراج رقم العقار من merchant_order_id
        const propNum = merchantOrderId.split("-")[0];
        if (propNum) {
          payment = payments.find((p) =>
            p.propertyNumber === propNum &&
            (p.status === "معلق" || p.status === "قيد المراجعة") &&
            Math.abs(p.finalAmount - amount) < 0.01
          );
          if (payment) console.log("✅ Found by merchant_order_id property match");
        }
      }

      // البحث 2: بـ paymobOrderId المباشر (لو نفس الصيغة)
      if (!payment && paymobOrderId) {
        payment = payments.find((p) => p.paymobOrderId === paymobOrderId);
        if (payment) console.log("✅ Found by paymobOrderId exact match");
      }

      // البحث 3: برقم العقار + مبلغ (معلق أو قيد المراجعة)
      if (!payment && propertyNumber) {
        payment = payments.find(
          (p) =>
            p.propertyNumber === propertyNumber &&
            (p.status === "معلق" || p.status === "قيد المراجعة") &&
            Math.abs(p.finalAmount - amount) < 0.01
        );
        if (payment) console.log("✅ Found by property + amount");
      }

      // البحث 4: آخر دفعة معلقة لنفس رقم العقار
      if (!payment && propertyNumber) {
        const pendingPayments = payments.filter(
          (p) =>
            p.propertyNumber === propertyNumber &&
            (p.status === "معلق" || p.status === "قيد المراجعة")
        ).sort((a, b) => new Date(b.createdAt || "").getTime() - new Date(a.createdAt || "").getTime());

        if (pendingPayments.length > 0) {
          payment = pendingPayments[0];
          console.log("✅ Found latest pending payment for property");
        }
      }

      if (!payment) {
        console.error("❌ Payment not found for:", { merchantOrderId, paymobOrderId, propertyNumber, amount });
        return res.status(404).json({ error: "Payment not found" });
      }

      console.log("✅ Found Payment:", payment.id);

      if (payment.status === "مكتمل") {
        console.log("⚠️ Already completed");
        return res.json({ ok: true });
      }

      // ===============================
      // 3) تحديث الدفع بالرسوم الحقيقية — جميع أنواع الدفع تبدأ بالتحقق
      // ===============================
      await paymentService.update(payment.id, {
        status: "نجح - قيد التحقق" as any,
        completedAt: new Date().toISOString(),
        transactionId,
        paymentMethod: cardSubType || paymentMethod || "بطاقة",
        merchantFees,
        acqFees,
        vatAmount,
        totalFees,
        feeAmount: merchantFees + acqFees,
        netAmount,
      });

      console.log(`💰 Payment Updated: ${payment.id} - Status: نجح - قيد التحقق`);

      // ===============================
      // 4) التحقق التلقائي من بيانات العقار (مرحلة إجبارية قبل التفعيل)
      // ===============================
      const property = await propertyService.getByNumber(payment.propertyNumber);
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
            await sendOwnerWhatsApp(
              property.whatsappNumber,
              `تم استلام الدفع، لكن بيانات العقار ${property.name || payment.propertyNumber} غير مكتملة.\n\nالحقول المطلوبة: ${verificationMissingFields.join("، ")}\n\nالخطوة التالية: عدّل بيانات العقار وارفع الصور المطلوبة ثم شغّل التحقق من صفحة الاشتراك.`,
            );
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
              await sendOwnerWhatsApp(
                property.whatsappNumber,
                `تم التحقق من الدفع وبيانات العقار ${property.name || payment.propertyNumber} بنجاح.\n\nلأن العقار جديد، سيبقى الطلب بانتظار اعتماد الإدارة قبل تفعيل الاشتراك.\n\nالخطوة التالية: لا يلزمك إجراء إضافي الآن.`,
              );
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
