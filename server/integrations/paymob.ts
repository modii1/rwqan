import crypto from 'crypto';

const SECRET_KEY = process.env.PAYMOB_API_KEY!;
const PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY!;
const HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET!;
const LEGACY_API_KEY = process.env.PAYMOB_LEGACY_API_KEY!;
const INTEGRATION_ID_CARDS = parseInt(process.env.PAYMOB_INTEGRATION_ID_CARDS || '15650');
const INTEGRATION_ID_APPLEPAY = parseInt(process.env.PAYMOB_INTEGRATION_ID_APPLEPAY || '15649');

const PAYMOB_API_URL = 'https://ksa.paymob.com';

type PaymobCallbackData = Record<string, any>;

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

/**
 * Build Paymob's transaction-callback HMAC payload in the documented field
 * order. Paymob sends nested fields in POST callbacks and flattened fields in
 * browser/query callbacks, so both representations are accepted here.
 */
export function buildPaymobWebhookHmacPayload(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const envelope = data as PaymobCallbackData;
  const obj = (envelope.obj && typeof envelope.obj === "object")
    ? envelope.obj as PaymobCallbackData
    : envelope;
  const orderId = firstDefined(
    obj.order?.id,
    obj.order_id,
    typeof obj.order === "object" ? undefined : obj.order,
  );
  const sourcePan = firstDefined(
    obj.source_data?.pan,
    obj.source_data_pan,
    obj["source_data.pan"],
  );
  const sourceSubType = firstDefined(
    obj.source_data?.sub_type,
    obj.source_data_sub_type,
    obj["source_data.sub_type"],
  );
  const sourceType = firstDefined(
    obj.source_data?.type,
    obj.source_data_type,
    obj["source_data.type"],
  );
  const values = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    orderId,
    obj.owner,
    obj.pending,
    sourcePan,
    sourceSubType,
    sourceType,
    obj.success,
  ];
  if (values.some((value) => value === undefined || value === null)) {
    return null;
  }
  return values.map((value) => String(value)).join("");
}

export function calculatePaymobWebhookHmac(
  data: unknown,
  secret: string,
): string | null {
  const payload = buildPaymobWebhookHmacPayload(data);
  if (!payload || !secret) return null;
  return crypto.createHmac("sha512", secret).update(payload).digest("hex");
}

console.log("🔑 Paymob Config:", {
  hasSecretKey: !!SECRET_KEY,
  secretKeyLength: SECRET_KEY?.length || 0,
  hasPublicKey: !!PUBLIC_KEY,
  hasHmacSecret: !!HMAC_SECRET,
  hasLegacyApiKey: !!LEGACY_API_KEY,
  legacyApiKeyLength: LEGACY_API_KEY?.length || 0,
  integrationCards: INTEGRATION_ID_CARDS,
  integrationApplePay: INTEGRATION_ID_APPLEPAY,
});

interface IntentionResponse {
  client_secret: string;
  id: string;
  [key: string]: any;
}

export class PaymobIntentionError extends Error {
  constructor(
    message: string,
    readonly certainty: "rejected" | "unknown",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PaymobIntentionError";
  }
}

export class PaymobService {

  /* ==========================================================
      1) إنشاء Intention للدفع — لا تعديل
  =========================================================== */
  async createIntention(
    amount: number,
    propertyNumber: string,
    propertyName: string,
    phone: string,
    packageName: string,
    packageDays: number,
    paymentMethod: 'cards' | 'applepay' = 'cards',
    attempt?: { merchantAttemptKey?: string; paymentId?: string },
  ) {
    const integrationId = paymentMethod === 'applepay'
      ? INTEGRATION_ID_APPLEPAY
      : INTEGRATION_ID_CARDS;

    let itemName = `${packageName} للعقار ${propertyName}`;
    if (itemName.length > 50) itemName = itemName.slice(0, 50);

    const amountCents = Math.round(amount * 100);

    const payload = {
      amount: amountCents,
      currency: 'SAR',
      payment_methods: [integrationId],
      items: [{
        name: itemName,
        amount: amountCents,
        description: 'الاشتراك يبدأ من تاريخ التفعيل مباشرة وبشكل آلي.',
        quantity: 1,
      }],
      billing_data: {
        first_name: propertyName || 'عميل',
        last_name: 'N/A',
        email: `${phone}@example.com`,
        phone_number: phone,
        country: 'KSA',
        // ⭐⭐⭐ إعادة التوجيه بعد الدفع
        redirect_url: "https://rwqan.sa/api/paymob/webhook",
      },
      customer: {
        first_name: propertyName || 'عميل',
        last_name: 'N/A',
        email: `${phone}@example.com`,
      },
      special_reference: attempt?.merchantAttemptKey || `${propertyNumber}-${Date.now()}`,
      extras: {
        creation_extras: {
          type: "subscription",
          propertyNumber,
          packageName,
          days: packageDays,
          price: amount,
          addonId: undefined,
          paymentId: attempt?.paymentId,
          merchantAttemptKey: attempt?.merchantAttemptKey,

        },
      },
    };

    let response: Response;
    try {
      response = await fetch(`${PAYMOB_API_URL}/v1/intention/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SECRET_KEY}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new PaymobIntentionError(
        "تعذر تأكيد نتيجة إنشاء عملية الدفع لدى مزود الخدمة",
        "unknown",
        { cause: error },
      );
    }

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new PaymobIntentionError(
        message || "رفض مزود الدفع إنشاء العملية",
        new Set([400, 401, 403, 404, 422]).has(response.status)
          ? "rejected"
          : "unknown",
      );
    }

    let data: IntentionResponse;
    try {
      data = await response.json() as IntentionResponse;
    } catch (error) {
      throw new PaymobIntentionError(
        "أنشأ مزود الدفع استجابة غير قابلة للتحقق",
        "unknown",
        { cause: error },
      );
    }
    if (!data?.id || !data?.client_secret) {
      throw new PaymobIntentionError(
        "تعذر التحقق من معرف عملية الدفع التي أنشأها المزود",
        "unknown",
      );
    }

    const checkoutUrl =
      `${PAYMOB_API_URL}/unifiedcheckout/?publicKey=${PUBLIC_KEY}&clientSecret=${data.client_secret}`;

    return {
      clientSecret: data.client_secret,
      intentionId: data.id,
      checkoutUrl,
    };
  }

  initiatePayment(
    amount: number,
    propertyNumber: string,
    propertyName: string = 'عقار',
    phone: string = '0500000000',
    packageName: string = 'باقة عامة',
    packageDays: number = 30,
    paymentMethod: 'cards' | 'applepay' = 'cards'
  ) {
    return this.createIntention(amount, propertyNumber, propertyName, phone, packageName, packageDays, paymentMethod);
  }

  async initiateAddOnPayment(
    amount: number,
    propertyNumber: string,
    propertyName: string,
    phone: string,
    addonId: string,
    addonName: string,
    addonDays: number,
    paymentMethod: 'cards' | 'applepay' = 'cards',
    paymentId?: string // معرف الدفع للتتبع
  ) {
    const integrationId = paymentMethod === 'applepay'
      ? INTEGRATION_ID_APPLEPAY
      : INTEGRATION_ID_CARDS;

    let itemName = `${addonName} للعقار ${propertyName}`;
    if (itemName.length > 50) itemName = itemName.slice(0, 50);

    const amountCents = Math.round(amount * 100);

    const payload = {
      amount: amountCents,
      currency: 'SAR',
      payment_methods: [integrationId],
      items: [{
        name: itemName,
        amount: amountCents,
        description: 'إضافة للعقار',
        quantity: 1,
      }],
      billing_data: {
        first_name: propertyName || 'عميل',
        last_name: 'N/A',
        email: `${phone}@example.com`,
        phone_number: phone,
        country: 'KSA',
        redirect_url: "https://rwqan.sa/api/paymob/webhook",
      },
      customer: {
        first_name: propertyName || 'عميل',
        last_name: 'N/A',
        email: `${phone}@example.com`,
      },
      special_reference: paymentId || `addon-${propertyNumber}-${Date.now()}`,
      extras: {
        creation_extras: {
          type: "addon",
          propertyNumber,
          addonId,
          addonName,
          days: addonDays,
          price: amount,
          paymentId, // إضافة paymentId للتتبع في webhook
        },
      },
    };

    const response = await fetch(`${PAYMOB_API_URL}/v1/intention/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(await response.text());

    const data: IntentionResponse = await response.json();

    const checkoutUrl =
      `${PAYMOB_API_URL}/unifiedcheckout/?publicKey=${PUBLIC_KEY}&clientSecret=${data.client_secret}`;

    return {
      clientSecret: data.client_secret,
      intentionId: data.id,
      checkoutUrl,
    };
  }

  /* ==========================================================
      2) التحقق من Webhook — بدون تعديل
  =========================================================== */
  verifyWebhookSignature(data: unknown, receivedHmac?: unknown): boolean {
    const envelope = data && typeof data === "object"
      ? data as PaymobCallbackData
      : {};
    const suppliedHmac = firstDefined(
      receivedHmac,
      envelope.hmac,
      envelope.obj?.hmac,
    );
    if (
      typeof suppliedHmac !== "string" ||
      !/^[a-f0-9]{128}$/i.test(suppliedHmac.trim())
    ) {
      return false;
    }

    const expectedHmac = calculatePaymobWebhookHmac(
      data,
      process.env.PAYMOB_HMAC_SECRET || HMAC_SECRET || "",
    );
    if (!expectedHmac) return false;

    const supplied = Buffer.from(suppliedHmac.trim(), "hex");
    const expected = Buffer.from(expectedHmac, "hex");
    return supplied.length === expected.length && crypto.timingSafeEqual(
      supplied,
      expected,
    );
  }

  extractPaymentInfo(data: any) {
    return {
      transactionId: data.obj.id,
      orderId: data.obj.order?.id,
      amount: data.obj.amount_cents / 100,
      currency: data.obj.currency,
      success: data.obj.success,
      pending: data.obj.pending,
      propertyNumber: data.obj.order?.shipping_data?.phone_number || '',
      extras: data.obj.payment_key_claims?.extra?.creation_extras || {},
    };
  }

  /* ==========================================================
      3) الحصول على Auth Token من Paymob
         يستخدم LEGACY_API_KEY للحصول على token للـ Transaction Inquiry API
         
         ملاحظة: Transaction Inquiry API يتطلب "API Key" من لوحة تحكم Paymob
         وهو مختلف عن "Secret Key" (sau_sk_...)
         
         للحصول على API Key:
         1. سجل دخول إلى: https://ksa.paymob.com/portal2/en/login
         2. اذهب إلى: Settings → Account Info
         3. ابحث عن حقل "API Key" (ليس Secret Key أو Public Key)
         4. اضغط "View" وانسخ القيمة
  =========================================================== */
  async getAuthToken(): Promise<string | null> {
    try {
      console.log("🔐 Getting Paymob auth token...");
      
      if (!LEGACY_API_KEY) {
        console.log("   ⚠️ PAYMOB_LEGACY_API_KEY is not set - Transaction Inquiry disabled");
        return null;
      }

      let apiKey = LEGACY_API_KEY;
      console.log("   API Key length:", apiKey.length);
      
      // Check if it's already a JWT token (starts with eyJ)
      if (apiKey.startsWith('eyJ')) {
        console.log("   Provided value is a JWT token (might be expired)");
        return apiKey;
      }
      
      // Try to decode base64 - the key might be base64 encoded
      try {
        const decoded = Buffer.from(apiKey, 'base64').toString('utf-8');
        if (decoded.startsWith('eyJ')) {
          console.log("   Decoded base64 to JWT token (might be expired)");
          return decoded;
        }
      } catch (e) {
        // Not base64
      }
      
      // Use as API key to get fresh token
      console.log("   Requesting fresh auth token from Paymob...");
      const response = await fetch(
        "https://ksa.paymob.com/api/auth/tokens",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: apiKey,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.token) {
        console.error("❌ Auth token error:", data);
        console.log("   ⚠️ Make sure PAYMOB_LEGACY_API_KEY contains the 'API Key' from Paymob dashboard");
        console.log("   ⚠️ The 'API Key' is different from 'Secret Key' (sau_sk_...)");
        return null;
      }

      console.log("✅ Got fresh auth token successfully");
      return data.token;
    } catch (err) {
      console.error("❌ Auth token exception:", err);
      return null;
    }
  }

  /* ==========================================================
      4) 🚀 Transaction Inquiry API - باستخدام Legacy API Key
  =========================================================== */
  async inquiryTransaction(body: {
    order_id?: string;
    merchant_order_id?: string;
  }) {
    try {
      console.log("📡 Calling Transaction Inquiry API...");
      console.log("   Request body:", JSON.stringify(body));
      
      // Get auth token using Legacy API Key
      const authToken = await this.getAuthToken();
      
      if (!authToken) {
        console.error("❌ Failed to get auth token");
        return null;
      }

      console.log("📡 Sending inquiry request...");
      
      const response = await fetch(
        "https://ksa.paymob.com/api/ecommerce/orders/transaction_inquiry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            auth_token: authToken,
            ...body,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error("❌ Inquiry error:", data);
        return null;
      }

      console.log("📊 Inquiry raw response:", JSON.stringify(data, null, 2));

      // Extract fee information from transaction
      const merchantFees = data.merchant_fees ?? 0;
      const acqFees = data.acq_fees ?? 0;
      const vat = data.vat ?? 0;
      const totalFees = merchantFees + acqFees + vat;

      const originalAmount = (data.amount_cents || 0) / 100;
      const netAmount = originalAmount - totalFees;

      return {
        ok: true,
        originalAmount,
        merchantFees,
        acqFees,
        vat,
        totalFees,
        netAmount,
        raw: data,
      };
    } catch (err) {
      console.error("❌ Inquiry Exception:", err);
      return null;
    }
  }

  async inquiryByOrderId(orderId: string) {
    return this.inquiryTransaction({ order_id: orderId });
  }

  async inquiryBySpecialReference(ref: string) {
    return this.inquiryTransaction({ merchant_order_id: ref });
  }

  /* ==========================================================
      5) حساب الرسوم التقريبية بناءً على نوع البطاقة
         يُستخدم عندما لا يتوفر Transaction Inquiry API
         
         النسب التقريبية:
         - Apple Pay: 6.9%
         - Visa/Mastercard: 5.0%
         - Mada: 4.4%
         - Default: 4.6%
  =========================================================== */
  calculateEstimatedFees(amount: number, cardType?: string, paymentMethod?: string): {
    merchantFees: number;
    acqFees: number;
    vat: number;
    totalFees: number;
    netAmount: number;
    isEstimated: boolean;
  } {
    let feePercentage = 0.046; // Default 4.6%
    
    if (paymentMethod === 'applepay' || paymentMethod === 'apple_pay') {
      feePercentage = 0.069; // Apple Pay: 6.9%
    } else if (cardType) {
      const cardTypeLower = cardType.toLowerCase();
      if (cardTypeLower.includes('mada')) {
        feePercentage = 0.044; // Mada: 4.4%
      } else if (cardTypeLower.includes('visa') || cardTypeLower.includes('mastercard')) {
        feePercentage = 0.050; // Visa/Mastercard: 5.0%
      }
    }
    
    // Calculate fees (VAT is included in the total fee percentage)
    const totalFees = Math.round(amount * feePercentage * 100) / 100;
    const vatRate = 0.15; // 15% VAT in Saudi Arabia
    const feesBeforeVat = totalFees / (1 + vatRate);
    const vat = Math.round((totalFees - feesBeforeVat) * 100) / 100;
    const merchantFees = Math.round(feesBeforeVat * 100) / 100;
    const acqFees = 0; // Included in merchant fees for estimation
    
    return {
      merchantFees,
      acqFees,
      vat,
      totalFees,
      netAmount: Math.round((amount - totalFees) * 100) / 100,
      isEstimated: true,
    };
  }
}

export const paymobService = new PaymobService();
