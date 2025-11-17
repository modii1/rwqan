import crypto from 'crypto';

const API_KEY = process.env.PAYMOB_API_KEY!;
const PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY!;
const HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET!;
const INTEGRATION_ID_CARDS = process.env.PAYMOB_INTEGRATION_ID_CARDS!;
const INTEGRATION_ID_APPLEPAY = process.env.PAYMOB_INTEGRATION_ID_APPLEPAY!;
const IFRAME_ID_CARDS = process.env.PAYMOB_IFRAME_ID_CARDS || '869748'; // Default iframe ID
const IFRAME_ID_APPLEPAY = process.env.PAYMOB_IFRAME_ID_APPLEPAY || '869749'; // Default iframe ID

const PAYMOB_API_URL = 'https://ksa.paymob.com/api';

interface PaymobAuthResponse {
  token: string;
}

interface PaymobOrderResponse {
  id: number;
  [key: string]: any;
}

interface PaymobPaymentKeyResponse {
  token: string;
}

export class PaymobService {
  private authToken: string | null = null;
  private tokenExpiry: number = 0;

  async getAuthToken(): Promise<string> {
    // Reuse token if still valid (expires in 1 hour, refresh after 55 mins)
    if (this.authToken && Date.now() < this.tokenExpiry) {
      return this.authToken;
    }

    const response = await fetch(`${PAYMOB_API_URL}/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Paymob auth error:', errorText);
      throw new Error(`فشل في المصادقة مع Paymob: ${response.status}`);
    }

    const data: PaymobAuthResponse = await response.json();
    
    if (!data.token) {
      console.error('No token in response:', data);
      throw new Error('لم يتم الحصول على رمز المصادقة من Paymob');
    }

    this.authToken = data.token;
    this.tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 minutes

    return this.authToken;
  }

  async createOrder(
    amount: number,
    propertyNumber: string,
    items: any[] = []
  ): Promise<number> {
    const token = await this.getAuthToken();

    const response = await fetch(`${PAYMOB_API_URL}/ecommerce/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        delivery_needed: 'false',
        amount_cents: Math.round(amount * 100), // Convert to cents
        currency: 'SAR',
        merchant_order_id: `PROP-${propertyNumber}-${Date.now()}`,
        items: items.length > 0 ? items : [{
          name: 'اشتراك عقار',
          amount_cents: Math.round(amount * 100),
          description: `اشتراك عقار رقم ${propertyNumber}`,
          quantity: 1,
        }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Paymob create order error:', errorText);
      throw new Error(`فشل في إنشاء طلب الدفع: ${response.status}`);
    }

    const data: PaymobOrderResponse = await response.json();
    
    if (!data.id) {
      console.error('No order ID in response:', data);
      throw new Error('لم يتم الحصول على معرف الطلب من Paymob');
    }

    return data.id;
  }

  async createPaymentKey(
    orderId: number,
    amount: number,
    propertyNumber: string,
    paymentMethod: 'cards' | 'applepay' = 'cards'
  ): Promise<string> {
    const token = await this.getAuthToken();
    const integrationId = paymentMethod === 'applepay' 
      ? INTEGRATION_ID_APPLEPAY 
      : INTEGRATION_ID_CARDS;

    const response = await fetch(`${PAYMOB_API_URL}/acceptance/payment_keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        amount_cents: Math.round(amount * 100),
        expiration: 3600, // 1 hour
        order_id: orderId,
        billing_data: {
          apartment: 'NA',
          email: `property${propertyNumber}@moddy.sa`,
          floor: 'NA',
          first_name: 'عقار',
          street: 'NA',
          building: 'NA',
          phone_number: '0500000000',
          shipping_method: 'NA',
          postal_code: 'NA',
          city: 'القصيم',
          country: 'SA',
          last_name: propertyNumber,
          state: 'SA',
        },
        currency: 'SAR',
        integration_id: integrationId,
        lock_order_when_paid: 'true',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Paymob create payment key error:', errorText);
      throw new Error(`فشل في إنشاء مفتاح الدفع: ${response.status}`);
    }

    const data: PaymobPaymentKeyResponse = await response.json();
    
    if (!data.token) {
      console.error('No payment token in response:', data);
      throw new Error('لم يتم الحصول على رمز الدفع من Paymob');
    }

    return data.token;
  }

  async initiatePayment(
    amount: number,
    propertyNumber: string,
    paymentMethod: 'cards' | 'applepay' = 'cards'
  ): Promise<{ orderId: number; paymentToken: string; iframeUrl: string }> {
    const orderId = await this.createOrder(amount, propertyNumber);
    const paymentToken = await this.createPaymentKey(orderId, amount, propertyNumber, paymentMethod);

    const iframeId = paymentMethod === 'applepay' ? IFRAME_ID_APPLEPAY : IFRAME_ID_CARDS;
    const iframeUrl = `https://ksa.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;

    return {
      orderId,
      paymentToken,
      iframeUrl,
    };
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
      orderId: data.obj.order.id,
      amount: data.obj.amount_cents / 100,
      currency: data.obj.currency,
      success: data.obj.success,
      pending: data.obj.pending,
      errorOccured: data.obj.error_occured,
      paymentMethod: data.obj.source_data_type,
      createdAt: data.obj.created_at,
    };
  }
}

export const paymobService = new PaymobService();
