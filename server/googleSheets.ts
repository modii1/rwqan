import { google } from 'googleapis';
import type {
  Property,
  InsertProperty,
  Subscription,
  InsertSubscription,
  Package,
  InsertPackage,
  DiscountCode,
  InsertDiscountCode,
  Profit,
  InsertProfit,
  Request,
  InsertRequest,
  Suggestion,
  InsertSuggestion,
  Payment,
  InsertPayment,
  Analytics,
} from '@shared/schema';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

// Sheet names
const SHEETS = {
  PROPERTIES: 'بيانات العقارات',
  SUBSCRIPTIONS: 'الاشتراكات',
  PACKAGES: 'الباقات',
  DISCOUNTS: 'أكواد الخصم',
  PROFITS: 'الأرباح',
  REQUESTS: 'الطلبات',
  SUGGESTIONS: 'الاقتراحات',
  PRICES: 'الأسعار',
  PAYMENTS: 'المدفوعات',
  ANALYTICS: 'الإحصائيات',
};

class GoogleSheetsService {
  private sheets: any;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  // Initialize sheets with headers if they don't exist
  async initializeSheets() {
    try {
      // Check if required sheets exist
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
      });

      const existingSheets = response.data.sheets.map((s: any) => s.properties.title);
      const requiredSheets = Object.values(SHEETS);

      // Create missing sheets
      for (const sheetName of requiredSheets) {
        if (!existingSheets.includes(sheetName)) {
          await this.createSheet(sheetName);
        }
      }

      // Initialize headers for each sheet
      await this.initializeHeaders();
    } catch (error) {
      console.error('Error initializing sheets:', error);
      throw error;
    }
  }

  private async createSheet(title: string) {
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title },
            },
          }],
        },
      });
      console.log(`Created sheet: ${title}`);
    } catch (error) {
      console.error(`Error creating sheet ${title}:`, error);
    }
  }

  private async initializeHeaders() {
    const headers: Record<string, string[]> = {
      [SHEETS.PROPERTIES]: [
        'رقم العقار', 'الاسم', 'الرقم السري', 'المدينة', 'الاتجاه', 'النوع',
        'المرافق', 'أسعار وسط الأسبوع', 'أسعار نهاية الأسبوع', 'أسعار المبيت',
        'أسعار الإجازات', 'العروض', 'نوع الاشتراك', 'تاريخ انتهاء الاشتراك',
        'معرف مجلد Drive', 'روابط الصور', 'رقم واتساب', 'تاريخ الإنشاء', 'تاريخ التحديث'
      ],
      [SHEETS.SUBSCRIPTIONS]: [
        'المعرف', 'رقم العقار', 'معرف الباقة', 'تاريخ البدء', 'تاريخ الانتهاء',
        'الحالة', 'معرف الدفع', 'تاريخ الإنشاء'
      ],
      [SHEETS.PACKAGES]: [
        'المعرف', 'الاسم', 'المدة (أيام)', 'السعر (ريال)', 'النوع',
        'المميزات', 'نشط', 'تاريخ الإنشاء'
      ],
      [SHEETS.DISCOUNTS]: [
        'الكود', 'النوع', 'القيمة', 'تاريخ الانتهاء', 'نشط', 'عدد الاستخدامات', 'تاريخ الإنشاء'
      ],
      [SHEETS.PROFITS]: [
        'المعرف', 'معرف الدفع', 'رقم العقار', 'المبلغ', 'نصيب الشريك',
        'الدورة', 'التاريخ', 'تاريخ الإنشاء'
      ],
      [SHEETS.REQUESTS]: [
        'المعرف', 'رقم العقار', 'كود الطلب', 'وقت الطلب', 'تاريخ الإنشاء'
      ],
      [SHEETS.SUGGESTIONS]: [
        'المعرف', 'الاسم', 'الجوال', 'المدينة', 'الاقتراح', 'الحالة', 'تاريخ الإنشاء'
      ],
      [SHEETS.PAYMENTS]: [
        'المعرف', 'رقم العقار', 'معرف الباقة', 'المبلغ', 'كود الخصم',
        'قيمة الخصم', 'المبلغ النهائي', 'معرف طلب Paymob', 'الحالة',
        'طريقة الدفع', 'رابط الإيصال', 'تاريخ الإنشاء', 'تاريخ الإكمال'
      ],
      [SHEETS.ANALYTICS]: [
        'الزوار', 'الأجهزة المحمولة', 'أجهزة سطح المكتب', 'الأجهزة اللوحية',
        'المدن', 'آخر تحديث'
      ],
    };

    for (const [sheetName, headerRow] of Object.entries(headers)) {
      try {
        // Check if sheet has data
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${sheetName}!A1:Z1`,
        });

        // If no data, add headers
        if (!response.data.values || response.data.values.length === 0) {
          await this.sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [headerRow],
            },
          });
          console.log(`Initialized headers for: ${sheetName}`);
        }
      } catch (error) {
        console.error(`Error initializing headers for ${sheetName}:`, error);
      }
    }
  }

  // Helper method to read all rows from a sheet
  async readSheet(sheetName: string): Promise<any[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A2:Z`,
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`Error reading sheet ${sheetName}:`, error);
      return [];
    }
  }

  // Helper method to append rows to a sheet
  async appendToSheet(sheetName: string, values: any[][]) {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'RAW',
        requestBody: {
          values,
        },
      });
    } catch (error) {
      console.error(`Error appending to sheet ${sheetName}:`, error);
      throw error;
    }
  }

  // Helper method to update a specific row
  async updateRow(sheetName: string, rowIndex: number, values: any[]) {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [values],
        },
      });
    } catch (error) {
      console.error(`Error updating row in ${sheetName}:`, error);
      throw error;
    }
  }

  // Helper method to delete a row
  async deleteRow(sheetName: string, rowIndex: number) {
    try {
      const sheetId = await this.getSheetId(sheetName);
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1,
                endIndex: rowIndex,
              },
            },
          }],
        },
      });
    } catch (error) {
      console.error(`Error deleting row from ${sheetName}:`, error);
      throw error;
    }
  }

  // Helper to get sheet ID by name
  private async getSheetId(sheetName: string): Promise<number> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });

    const sheet = response.data.sheets.find(
      (s: any) => s.properties.title === sheetName
    );

    if (!sheet) {
      throw new Error(`Sheet not found: ${sheetName}`);
    }

    return sheet.properties.sheetId;
  }

  // Properties methods
  async getProperties(): Promise<Property[]> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    return rows.map(row => this.rowToProperty(row));
  }

  async getPropertyByNumber(propertyNumber: string): Promise<Property | null> {
    const properties = await this.getProperties();
    return properties.find(p => p.propertyNumber === propertyNumber) || null;
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    const now = new Date().toISOString();
    const newProperty: Property = {
      ...property,
      createdAt: now,
      updatedAt: now,
    };

    const row = this.propertyToRow(newProperty);
    await this.appendToSheet(SHEETS.PROPERTIES, [row]);

    return newProperty;
  }

  async updateProperty(propertyNumber: string, updates: Partial<Property>): Promise<Property> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    const rowIndex = rows.findIndex(row => row[0] === propertyNumber);

    if (rowIndex === -1) {
      throw new Error('Property not found');
    }

    const currentProperty = this.rowToProperty(rows[rowIndex]);
    const updatedProperty: Property = {
      ...currentProperty,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const row = this.propertyToRow(updatedProperty);
    await this.updateRow(SHEETS.PROPERTIES, rowIndex + 2, row);

    return updatedProperty;
  }

  async deleteProperty(propertyNumber: string): Promise<void> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    const rowIndex = rows.findIndex(row => row[0] === propertyNumber);

    if (rowIndex === -1) {
      throw new Error('Property not found');
    }

    await this.deleteRow(SHEETS.PROPERTIES, rowIndex + 2);
  }

  // Conversion methods
  private rowToProperty(row: any[]): Property {
    return {
      propertyNumber: row[0] || '',
      name: row[1] || '',
      pin: row[2] || '',
      city: row[3] as any,
      direction: row[4] as any,
      type: row[5] as any,
      facilities: row[6] ? JSON.parse(row[6]) : [],
      prices: {
        weekday: row[7] || '',
        weekend: row[8] || '',
        overnight: row[9] || '',
        holidays: row[10] || '',
        offers: row[11] || '',
      },
      subscriptionType: row[12] as any || 'عادي',
      subscriptionEndDate: row[13] || undefined,
      driveFolderId: row[14] || undefined,
      imageUrls: row[15] ? JSON.parse(row[15]) : [],
      whatsappNumber: row[16] || '',
      createdAt: row[17] || '',
      updatedAt: row[18] || '',
    };
  }

  private propertyToRow(property: Property): any[] {
    return [
      property.propertyNumber,
      property.name,
      property.pin,
      property.city,
      property.direction,
      property.type,
      JSON.stringify(property.facilities),
      property.prices.weekday,
      property.prices.weekend,
      property.prices.overnight,
      property.prices.holidays,
      property.prices.offers || '',
      property.subscriptionType,
      property.subscriptionEndDate || '',
      property.driveFolderId || '',
      JSON.stringify(property.imageUrls),
      property.whatsappNumber,
      property.createdAt || '',
      property.updatedAt || '',
    ];
  }

  // Similar methods for other entities will be added in the next implementation
  // For now, returning placeholder methods

  async getSubscriptions(): Promise<Subscription[]> {
    const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
    return rows.map(row => ({
      id: row[0] || '',
      propertyNumber: row[1] || '',
      packageId: row[2] || '',
      startDate: row[3] || '',
      endDate: row[4] || '',
      status: row[5] as any || 'نشط',
      paymentId: row[6] || undefined,
      createdAt: row[7] || '',
    }));
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const id = `SUB-${Date.now()}`;
    const newSubscription: Subscription = {
      id,
      ...subscription,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newSubscription.id,
      newSubscription.propertyNumber,
      newSubscription.packageId,
      newSubscription.startDate,
      newSubscription.endDate,
      newSubscription.status,
      newSubscription.paymentId || '',
      newSubscription.createdAt,
    ];

    await this.appendToSheet(SHEETS.SUBSCRIPTIONS, [row]);
    return newSubscription;
  }

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription> {
    const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
    const rowIndex = rows.findIndex(row => row[0] === id);

    if (rowIndex === -1) {
      throw new Error('Subscription not found');
    }

    const current = rows[rowIndex];
    const updated: Subscription = {
      id: current[0],
      propertyNumber: updates.propertyNumber ?? current[1],
      packageId: updates.packageId ?? current[2],
      startDate: updates.startDate ?? current[3],
      endDate: updates.endDate ?? current[4],
      status: updates.status ?? current[5],
      paymentId: updates.paymentId ?? current[6],
      createdAt: current[7],
    };

    const row = [
      updated.id,
      updated.propertyNumber,
      updated.packageId,
      updated.startDate,
      updated.endDate,
      updated.status,
      updated.paymentId || '',
      updated.createdAt,
    ];

    await this.updateRow(SHEETS.SUBSCRIPTIONS, rowIndex + 2, row);
    return updated;
  }

  async getPackages(): Promise<Package[]> {
    const rows = await this.readSheet(SHEETS.PACKAGES);
    return rows.map(row => ({
      id: row[0] || '',
      name: row[1] || '',
      duration: parseInt(row[2]) || 0,
      price: parseFloat(row[3]) || 0,
      type: row[4] as any || 'عادي',
      features: row[5] ? JSON.parse(row[5]) : [],
      isActive: row[6] === 'true',
      createdAt: row[7] || '',
    }));
  }

  async createPackage(pkg: InsertPackage): Promise<Package> {
    const id = `PKG-${Date.now()}`;
    const newPackage: Package = {
      id,
      ...pkg,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newPackage.id,
      newPackage.name,
      newPackage.duration.toString(),
      newPackage.price.toString(),
      newPackage.type,
      JSON.stringify(newPackage.features),
      newPackage.isActive.toString(),
      newPackage.createdAt,
    ];

    await this.appendToSheet(SHEETS.PACKAGES, [row]);
    return newPackage;
  }

  async getDiscountCodes(): Promise<DiscountCode[]> {
    const rows = await this.readSheet(SHEETS.DISCOUNTS);
    return rows.map(row => ({
      code: row[0] || '',
      type: row[1] as any,
      value: parseFloat(row[2]) || 0,
      expiryDate: row[3] || undefined,
      isActive: row[4] === 'true',
      usageCount: parseInt(row[5]) || 0,
      createdAt: row[6] || '',
    }));
  }

  async createDiscountCode(discountCode: InsertDiscountCode): Promise<DiscountCode> {
    const newCode: DiscountCode = {
      ...discountCode,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newCode.code,
      newCode.type,
      newCode.value.toString(),
      newCode.expiryDate || '',
      newCode.isActive.toString(),
      newCode.usageCount.toString(),
      newCode.createdAt,
    ];

    await this.appendToSheet(SHEETS.DISCOUNTS, [row]);
    return newCode;
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const id = `PAY-${Date.now()}`;
    const newPayment: Payment = {
      id,
      ...payment,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newPayment.id,
      newPayment.propertyNumber,
      newPayment.packageId,
      newPayment.amount.toString(),
      newPayment.discountCode || '',
      newPayment.discountAmount.toString(),
      newPayment.finalAmount.toString(),
      newPayment.paymobOrderId || '',
      newPayment.status,
      newPayment.paymentMethod || '',
      newPayment.receiptUrl || '',
      newPayment.createdAt,
      newPayment.completedAt || '',
    ];

    await this.appendToSheet(SHEETS.PAYMENTS, [row]);
    return newPayment;
  }

  async createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion> {
    const id = `SUG-${Date.now()}`;
    const newSuggestion: Suggestion = {
      id,
      ...suggestion,
      status: 'جديد',
      createdAt: new Date().toISOString(),
    };

    const row = [
      newSuggestion.id,
      newSuggestion.name,
      newSuggestion.phone,
      newSuggestion.city,
      newSuggestion.suggestion,
      newSuggestion.status,
      newSuggestion.createdAt,
    ];

    await this.appendToSheet(SHEETS.SUGGESTIONS, [row]);
    return newSuggestion;
  }

  async createRequest(request: InsertRequest): Promise<Request> {
    const id = `REQ-${Date.now()}`;
    const newRequest: Request = {
      id,
      ...request,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newRequest.id,
      newRequest.propertyNumber,
      newRequest.requestCode,
      newRequest.timestamp,
      newRequest.createdAt,
    ];

    await this.appendToSheet(SHEETS.REQUESTS, [row]);
    return newRequest;
  }
}

export const googleSheetsService = new GoogleSheetsService();
