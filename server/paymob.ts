import crypto from 'crypto';

const SECRET_KEY = process.env.PAYMOB_API_KEY!;
const PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY!;
const HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET!;
const INTEGRATION_ID_CARDS = parseInt(process.env.PAYMOB_INTEGRATION_ID_CARDS || '15650');
const INTEGRATION_ID_APPLEPAY = parseInt(process.env.PAYMOB_INTEGRATION_ID_APPLEPAY || '15649');

const PAYMOB_API_URL = 'https://ksa.paymob.com';

console.log("🔑 Paymob Config:", {
  hasSecretKey: !!SECRET_KEY,
  secretKeyLength: SECRET_KEY?.length || 0,
  secretKeyPrefix: SECRET_KEY?.substring(0, 10) || "none",
  hasPublicKey: !!PUBLIC_KEY,
  hasHmacSecret: !!HMAC_SECRET,
  integrationCards: INTEGRATION_ID_CARDS,
  integrationApplePay: INTEGRATION_ID_APPLEPAY,
});

interface IntentionResponse {
  client_secret: string;
  id: string;
  [key: string]: any;
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
    paymentMethod: 'cards' | 'applepay' = 'cards'
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
      },
      customer: {
        first_name: propertyName || 'عميل',
        last_name: 'N/A',
        email: `${phone}@example.com`,
      },
      special_reference: `${propertyNumber}-${Date.now()}`,
      extras: {
        creation_extras: {
          propertyNumber,
          packageName,
          days: packageDays,
          price: amount,
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

  /* ==========================================================
      2) التحقق من Webhook — بدون تعديل
  =========================================================== */
  verifyWebhookSignature(data: any): boolean {
    const obj = data.obj;

    const concatenatedString =
      `${obj.amount_cents}${obj.created_at}${obj.currency}${obj.error_occured}` +
      `${obj.has_parent_transaction}${obj.id}${obj.integration_id}${obj.is_3d_secure}` +
      `${obj.is_auth}${obj.is_capture}${obj.is_refunded}${obj.is_standalone_payment}` +
      `${obj.is_voided}${obj.order.id}${obj.owner}${obj.pending}${obj.source_data_pan}` +
      `${obj.source_data_sub_type}${obj.source_data_type}${obj.success}`;

    const hash = crypto
      .createHmac('sha512', HMAC_SECRET)
      .update(concatenatedString)
      .digest('hex');

    return hash === obj.hmac;
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
         ملاحظة: هذا يتطلب API Key وليس Secret Key
         الـ API Key مختلف عن Secret Key (الذي يبدأ بـ sau_sk_)
  =========================================================== */
  async getAuthToken(): Promise<string | null> {
    try {
      console.log("🔐 Getting Paymob auth token...");
      console.log("   Using key prefix:", SECRET_KEY?.substring(0, 15));
      
      const response = await fetch(
        "https://ksa.paymob.com/api/auth/tokens",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: SECRET_KEY,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.token) {
        console.error("❌ Auth token error:", data);
        console.log("   Note: Transaction Inquiry API requires the 'API Key' from Paymob dashboard");
        console.log("   The 'Secret Key' (sau_sk_...) is for Unified Checkout only");
        return null;
      }

      console.log("✅ Got auth token successfully");
      return data.token;
    } catch (err) {
      console.error("❌ Auth token exception:", err);
      return null;
    }
  }

  /* ==========================================================
      4) 🚀 Transaction Inquiry API - باستخدام Secret Key مباشرة
         نستخدم endpoint مختلف يدعم Bearer token
  =========================================================== */
  async inquiryTransaction(body: {
    order_id?: string;
    merchant_order_id?: string;
  }) {
    try {
      console.log("📡 Trying Transaction Inquiry API...");
      console.log("   Request body:", JSON.stringify(body));
      
      // Method 1: Try using Secret Key directly as Bearer token with v1 endpoint
      const orderId = body.order_id;
      if (orderId) {
        console.log("   Attempting direct Bearer token auth...");
        
        // Try getting order details directly
        const directResponse = await fetch(
          `https://ksa.paymob.com/v1/orders/${orderId}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SECRET_KEY}`,
            },
          }
        );

        if (directResponse.ok) {
          const orderData = await directResponse.json();
          console.log("📊 Direct order lookup response:", JSON.stringify(orderData, null, 2));
          
          // Extract fee information if available
          if (orderData) {
            const amountCents = orderData.amount_cents || orderData.amount || 0;
            const originalAmount = amountCents > 100 ? amountCents / 100 : amountCents;
            
            return {
              ok: true,
              originalAmount,
              merchantFees: orderData.merchant_fees || 0,
              acqFees: orderData.acq_fees || 0,
              vat: orderData.vat || 0,
              totalFees: (orderData.merchant_fees || 0) + (orderData.acq_fees || 0) + (orderData.vat || 0),
              netAmount: originalAmount - ((orderData.merchant_fees || 0) + (orderData.acq_fees || 0) + (orderData.vat || 0)),
              raw: orderData,
            };
          }
        } else {
          const errorText = await directResponse.text();
          console.log("   Direct lookup failed:", directResponse.status, errorText);
        }
      }

      // Method 2: Fall back to legacy auth token method
      const authToken = await this.getAuthToken();
      
      if (!authToken) {
        console.error("❌ Failed to get auth token - Transaction Inquiry API not available");
        console.log("   To enable Transaction Inquiry, add the 'API Key' from Paymob Dashboard");
        console.log("   Go to: Settings → Account Info → API Key (different from Secret Key)");
        return null;
      }

      console.log("📡 Calling Legacy Transaction Inquiry API...");
      
      const response = await fetch(
        "https://ksa.paymob.com/api/ecommerce/orders/transaction_inquiry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`,
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
}

export const paymobService = new PaymobService();
