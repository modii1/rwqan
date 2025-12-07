import crypto from 'crypto';

const SECRET_KEY = process.env.PAYMOB_API_KEY!;
const PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY!;
const HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET!;
const INTEGRATION_ID_CARDS = parseInt(process.env.PAYMOB_INTEGRATION_ID_CARDS || '15650');
const INTEGRATION_ID_APPLEPAY = parseInt(process.env.PAYMOB_INTEGRATION_ID_APPLEPAY || '15649');

const PAYMOB_API_URL = 'https://ksa.paymob.com';

// تسجيل معلومات المفاتيح عند بدء التشغيل
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
  async createIntention(
    amount: number,
    propertyNumber: string,
    propertyName: string,
    phone: string,
    packageName: string,
    packageDays: number,
    paymentMethod: 'cards' | 'applepay' = 'cards'
  ): Promise<{ clientSecret: string; intentionId: string; checkoutUrl: string }> {
    const integrationId = paymentMethod === 'applepay' 
      ? INTEGRATION_ID_APPLEPAY 
      : INTEGRATION_ID_CARDS;

    let itemName = `${packageName} للعقار ${propertyName}`;
    if (itemName.length > 50) {
      itemName = itemName.slice(0, 50);
    }

    const amountCents = Math.round(amount * 100);

    const payload = {
      amount: amountCents,
      currency: 'SAR',
      payment_methods: [integrationId],
      items: [
        {
          name: itemName,
          amount: amountCents,
          description: 'الاشتراك يبدأ من تاريخ التفعيل مباشرة وبشكل آلي.',
          quantity: 1,
        },
      ],
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Paymob Intention API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`فشل في إنشاء طلب الدفع: ${response.status} - ${errorText}`);
    }

    const data: IntentionResponse = await response.json();

    if (!data.client_secret) {
      console.error('No client_secret in response:', data);
      throw new Error('لم يتم الحصول على client_secret من Paymob');
    }

    const checkoutUrl = `${PAYMOB_API_URL}/unifiedcheckout/?publicKey=${PUBLIC_KEY}&clientSecret=${data.client_secret}`;

    return {
      clientSecret: data.client_secret,
      intentionId: data.id,
      checkoutUrl,
    };
  }

  async initiatePayment(
    amount: number,
    propertyNumber: string,
    propertyName: string = 'عقار',
    phone: string = '0500000000',
    packageName: string = 'باقة عامة',
    packageDays: number = 30,
    paymentMethod: 'cards' | 'applepay' = 'cards'
  ): Promise<{ clientSecret: string; intentionId: string; checkoutUrl: string }> {
    return this.createIntention(
      amount,
      propertyNumber,
      propertyName,
      phone,
      packageName,
      packageDays,
      paymentMethod
    );
  }

  verifyWebhookSignature(data: any): boolean {
    const {
      amount_cents,
      created_at,
      currency,
      error_occured,
      has_parent_transaction,
      id,
      integration_id,
      is_3d_secure,
      is_auth,
      is_capture,
      is_refunded,
      is_standalone_payment,
      is_voided,
      order,
      owner,
      pending,
      source_data_pan,
      source_data_sub_type,
      source_data_type,
      success,
    } = data.obj;

    const concatenatedString = `${amount_cents}${created_at}${currency}${error_occured}${has_parent_transaction}${id}${integration_id}${is_3d_secure}${is_auth}${is_capture}${is_refunded}${is_standalone_payment}${is_voided}${order.id}${owner}${pending}${source_data_pan}${source_data_sub_type}${source_data_type}${success}`;

    const hash = crypto
      .createHmac('sha512', HMAC_SECRET)
      .update(concatenatedString)
      .digest('hex');

    return hash === data.obj.hmac;
  }

  extractPaymentInfo(data: any) {
    return {
      transactionId: data.obj.id,
      orderId: data.obj.order?.id,
      amount: data.obj.amount_cents / 100,
      currency: data.obj.currency,
      success: data.obj.success,
      pending: data.obj.pending,
      errorOccured: data.obj.error_occured,
      paymentMethod: data.obj.source_data_type,
      createdAt: data.obj.created_at,
      propertyNumber: data.obj.order?.shipping_data?.phone_number || '',
      extras: data.obj.payment_key_claims?.extra?.creation_extras || {},
    };
  }

  /**
   * جلب تفاصيل المعاملة من Paymob API للحصول على الرسوم الحقيقية
   * @param transactionId معرف المعاملة من Paymob
   * @returns تفاصيل المعاملة بما فيها الرسوم
   */
  async getTransactionDetails(transactionId: string): Promise<{
    fees: number;
    vat: number;
    totalFees: number;
    netAmount: number;
    amount: number;
    success: boolean;
  } | null> {
    try {
      console.log(`📡 Fetching transaction details from Paymob API for: ${transactionId}`);
      
      // استخدام Transaction Inquiry API
      // GET https://ksa.paymob.com/api/acceptance/transactions/{transaction_id}
      const response = await fetch(
        `${PAYMOB_API_URL}/api/acceptance/transactions/${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SECRET_KEY}`,
          },
        }
      );

      if (!response.ok) {
        console.error(`❌ Paymob API error: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        console.error(`❌ Error details: ${errorText}`);
        return null;
      }

      const data = await response.json();
      console.log(`📊 Paymob Transaction Response:`, JSON.stringify(data, null, 2));

      // استخراج الرسوم من الـ response
      // الحقول المتوقعة: fees, vat, أو قد تكون في data object
      const amount = (data.amount_cents || 0) / 100;
      const fees = data.fees || data.merchant_fees || data.data?.fees || 0;
      const vat = data.vat || data.data?.vat || 0;
      const totalFees = fees + vat;
      const netAmount = amount - totalFees;

      console.log(`💰 Extracted fees: amount=${amount}, fees=${fees}, vat=${vat}, total=${totalFees}, net=${netAmount}`);

      return {
        fees,
        vat,
        totalFees,
        netAmount,
        amount,
        success: data.success || false,
      };
    } catch (error) {
      console.error(`❌ Error fetching transaction details:`, error);
      return null;
    }
  }
}

export const paymobService = new PaymobService();
