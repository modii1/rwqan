router.post("/paymob/webhook", async (req, res) => {
  try {
    const webhook = req.body;
    const hmac = req.query.hmac || "";

    if (!verifyHMAC(webhook, hmac)) {
      return res.status(400).json({ error: "Invalid HMAC" });
    }

    const t = webhook.obj;

    const amount = t.amount_cents / 100;
    const transactionId = t.id;
    const paymentMethod = t.source_data_type;
    const isSuccess = t.success;

    // -------------------------------
    // 🔥 جلب تفاصيل المعاملة كاملة من Paymob
    // -------------------------------
    const detailsRes = await fetch(`https://ksa.paymob.com/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${SECRET_KEY}` },
    });

    const full = await detailsRes.json();

    const fees = full.data?.fees || 0;
    const vat = full.data?.tax || 0;
    const totalFees = fees + vat;

    const platformNet = +(amount - totalFees).toFixed(2);

    const partnerShare = +(platformNet * 0.50).toFixed(2);
    const modiShare = +(platformNet * 0.50).toFixed(2);

    // -------------------------------
    // ✨ إرسال البيانات إلى Google Sheet / Database
    // -------------------------------
    await savePartnerPayment({
      transactionId,
      amount,
      fees,
      vat,
      totalFees,
      platformNet,
      partnerShare,
      modiShare,
      paymentMethod,
      date: t.created_at
    });

    res.json({
      ok: true,
      transactionId,
      amount,
      fees,
      vat,
      totalFees,
      partnerShare,
      modiShare,
    });

  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({ error: "server error" });
  }
});
