// server/googleSheets.ts
import { google } from "googleapis";
import type {
  Property,
  InsertProperty,
  Subscription,
  InsertSubscription,
  Package,
  InsertPackage,
  DiscountCode,
  InsertDiscountCode,
  Request,
  InsertRequest,
  Suggestion,
  InsertSuggestion,
  Payment,
  InsertPayment,
} from "@shared/schema";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

// أسماء الشيتات
const SHEETS = {
  PROPERTIES: "بيانات العقارات",
  SUBSCRIPTIONS: "الاشتراكات",
  PACKAGES: "الباقات",
  DISCOUNTS: "أكواد الخصم",
  PROFITS: "الأرباح",
  REQUESTS: "الطلبات",
  SUGGESTIONS: "الاقتراحات",
  PRICES: "الأسعار",
  PAYMENTS: "المدفوعات",
  ANALYTICS: "الإحصائيات",
};

// =======================
// Replit Connectors Auth
// =======================

let connectionSettings: any;

async function getAccessToken() {
  // لو التوكن الكاش شغّال استخدمه
  if (
    connectionSettings?.settings?.expires_at &&
    connectionSettings?.settings?.access_token &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken || !hostname) {
    throw new Error("X_REPLIT_TOKEN or hostname not found for repl/depl");
  }

  const response = await fetch(
    "https://" +
      hostname +
      "/api/v2/connection?include_secrets=true&connector_names=google-sheet",
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch connection settings: ${response.statusText}`,
    );
  }

  const data = await response.json();
  connectionSettings = data.items?.[0];

  if (!connectionSettings?.settings) {
    throw new Error("Google Sheet not connected or settings missing");
  }

  const accessToken =
    connectionSettings.settings.access_token ||
    connectionSettings.settings.oauth?.credentials?.access_token;

  if (!accessToken) {
    throw new Error("Access token not found in connection settings");
  }

  return accessToken;
}

async function getGoogleSheetClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken,
  });

  return google.sheets({ version: "v4", auth: oauth2Client });
}

// =======================
// GoogleSheetsService
// =======================

class GoogleSheetsService {
  private async getSheets() {
    return await getGoogleSheetClient();
  }

  // ================== تهيئة الشيتات (اختياري) ==================
  async initializeSheets() {
    try {
      const sheets = await this.getSheets();
      const response = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
      });

      const existingSheets =
        response.data.sheets?.map((s: any) => s.properties?.title) || [];
      const requiredSheets = Object.values(SHEETS);

      // إنشاء الشيتات المفقودة
      for (const sheetName of requiredSheets) {
        if (!existingSheets.includes(sheetName)) {
          await this.createSheet(sheetName);
        }
      }

      // تهيئة رؤوس الأعمدة
      await this.initializeHeaders();
    } catch (error) {
      console.error("Error initializing sheets:", error);
      throw error;
    }
  }

  private async createSheet(title: string) {
    try {
      const sheets = await this.getSheets();
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title },
              },
            },
          ],
        },
      });
      console.log(`Created sheet: ${title}`);
    } catch (error) {
      console.error(`Error creating sheet ${title}:`, error);
    }
  }

  // ================== تهيئة رؤوس الأعمدة ==================
  private async initializeHeaders() {
    const headers: Record<string, string[]> = {
      [SHEETS.PROPERTIES]: [
        "رقم العقار",
        "اسم العقار",
        "رقم الجوال",
        "الموقع",
        "المنطقة",
        "الاتجاه",
        "النوع",
        "المرافق",
        "رابط الصور",
        "سعر العرض",
        "سعر وسط الأسبوع",
        "سعر نهاية الأسبوع",
        "سعر المبيت",
        "سعر خاص (اختياري)",
        "سعر الإجازات",
        "نوع الاشتراك",
        "آخر تحديث",
        "تاريخ الاشتراك",
        "الرقم السري",
      ],
      [SHEETS.SUBSCRIPTIONS]: [
        "المعرف",
        "رقم العقار",
        "معرف الباقة",
        "تاريخ البدء",
        "تاريخ الانتهاء",
        "الحالة",
        "معرف الدفع",
        "تاريخ الإنشاء",
      ],
      [SHEETS.PACKAGES]: [
        "المعرف",
        "الاسم",
        "المدة (أيام)",
        "السعر (ريال)",
        "النوع",
        "المميزات",
        "نشط",
        "تاريخ الإنشاء",
      ],
      [SHEETS.DISCOUNTS]: [
        "الكود",
        "النوع",
        "القيمة",
        "تاريخ الانتهاء",
        "نشط",
        "عدد الاستخدامات",
        "تاريخ الإنشاء",
      ],
      [SHEETS.PROFITS]: [
        "المعرف",
        "معرف الدفع",
        "رقم العقار",
        "المبلغ",
        "نصيب الشريك",
        "الدورة",
        "التاريخ",
        "تاريخ الإنشاء",
      ],
      [SHEETS.REQUESTS]: [
        "المعرف",
        "رقم العقار",
        "كود الطلب",
        "وقت الطلب",
        "تاريخ الإنشاء",
      ],
      [SHEETS.SUGGESTIONS]: [
        "المعرف",
        "الاسم",
        "الجوال",
        "المدينة",
        "الاقتراح",
        "الحالة",
        "تاريخ الإنشاء",
      ],
      [SHEETS.PAYMENTS]: [
        "المعرف",
        "رقم العقار",
        "معرف الباقة",
        "المبلغ",
        "كود الخصم",
        "قيمة الخصم",
        "المبلغ النهائي",
        "معرف طلب Paymob",
        "الحالة",
        "طريقة الدفع",
        "رابط الإيصال",
        "تاريخ الإنشاء",
        "تاريخ الإكمال",
      ],
      [SHEETS.ANALYTICS]: [
        "الزوار",
        "الأجهزة المحمولة",
        "أجهزة سطح المكتب",
        "الأجهزة اللوحية",
        "المدن",
        "آخر تحديث",
      ],
    };

    for (const [sheetName, headerRow] of Object.entries(headers)) {
      try {
        const sheets = await this.getSheets();
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${sheetName}!A1:Z1`,
        });

        if (!response.data.values || response.data.values.length === 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${sheetName}!A1`,
            valueInputOption: "RAW",
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

  // ================== Helpers قراءة / كتابة ==================

  async readSheet(sheetName: string): Promise<any[][]> {
    try {
      const sheets = await this.getSheets();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A2:ZZ`,
      });

      const rows = response.data.values || [];
      console.log(`📖 Read ${rows.length} row(s) from "${sheetName}"`);
      return rows;
    } catch (error) {
      console.error(`Error reading sheet ${sheetName}:`, error);
      return [];
    }
  }

  async appendToSheet(sheetName: string, values: any[][]) {
    try {
      const sheets = await this.getSheets();
      const existingRows = await this.readSheet(sheetName);
      const nextRow = existingRows.length + 2;

      const result = await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A${nextRow}:ZZ${nextRow}`,
        valueInputOption: "RAW",
        requestBody: {
          values,
        },
      });

      console.log(
        `✅ Added to "${sheetName}" at row ${nextRow}: ${result.data.updatedRows} rows, range: ${result.data.updatedRange}`,
      );
    } catch (error) {
      console.error(`Error appending to sheet ${sheetName}:`, error);
      throw error;
    }
  }

  async updateRow(sheetName: string, rowIndex: number, values: any[]) {
    try {
      const sheets = await this.getSheets();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A${rowIndex}:ZZ${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [values],
        },
      });
    } catch (error) {
      console.error(`Error updating row in ${sheetName}:`, error);
      throw error;
    }
  }

  async deleteRow(sheetName: string, rowIndex: number) {
    try {
      const sheetId = await this.getSheetId(sheetName);
      const sheets = await this.getSheets();
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex - 1,
                  endIndex: rowIndex,
                },
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error(`Error deleting row from ${sheetName}:`, error);
      throw error;
    }
  }

  private async getSheetId(sheetName: string): Promise<number> {
    const sheets = await this.getSheets();
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });

    const sheet = response.data.sheets?.find(
      (s: any) => s.properties?.title === sheetName,
    );

    if (!sheet || sheet.properties?.sheetId == null) {
      throw new Error(`Sheet not found: ${sheetName}`);
    }

    return sheet.properties.sheetId;
  }

  // ================== تحويل الصف <-> Property ==================

  private rowToProperty(row: any[]): Property {
    const p: any = {
      propertyNumber: row[0] || "",
      name: row[1] || "",
      whatsappNumber: row[2] || "",
      location: row[3] || "",
      city: row[4] || "",
      direction: row[5] || "",
      type: row[6] || "",
      // المرافق كنص → مصفوفة
      facilities: row[7]
        ? String(row[7])
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      imagesLink: row[8] || "",
      prices: {
        display: row[9] || "",
        weekday: row[10] || "",
        weekend: row[11] || "",
        overnight: row[12] || "",
        special: row[13] || "",
        holidays: row[14] || "",
      },
      subscriptionType: row[15] || "عادي",
      lastUpdate: row[16] || "",
      subscriptionDate: row[17] || "",
      pin: row[18] || "",
    };

    return p as Property;
  }

  private propertyToRow(property: Property): any[] {
  const p: any = property;

  const facilities =
    Array.isArray(p.facilities)
      ? p.facilities.join(", ")
      : typeof p.facilities === "string"
      ? p.facilities
      : "";

  return [
    p.propertyNumber || "",
    p.name || "",
    p.whatsappNumber || "",
    p.location || "",
    p.city || "",
    p.direction || "",
    p.type || "",
    facilities,
    p.imagesLink || "",
    p.prices?.display || "",
    p.prices?.weekday || "",
    p.prices?.weekend || "",
    p.prices?.overnight || "",
    p.prices?.special || "",
    p.prices?.holidays || "",
    p.subscriptionType || "عادي",
    p.lastUpdate || "",
    p.subscriptionDate || "",
    p.pin || "",
  ];
}

  // ================== العقارات ==================

  async getProperties(): Promise<Property[]> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    const validRows = rows.filter((row) => row[0] && String(row[0]).trim());
    return validRows.map((row) => this.rowToProperty(row));
  }

  async getPropertyByNumber(propertyNumber: string): Promise<Property | null> {
    const properties = await this.getProperties();
    return (
      properties.find((p) => p.propertyNumber === propertyNumber) || null
    );
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    const now = new Date().toISOString();
    const newProperty: any = {
      ...property,
      createdAt: now,
      updatedAt: now,
    };

    const row = this.propertyToRow(newProperty as Property);
    await this.appendToSheet(SHEETS.PROPERTIES, [row]);

    return newProperty as Property;
  }

  async updateProperty(
    propertyNumber: string,
    updates: Partial<Property>,
  ): Promise<Property> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    const rowIndex = rows.findIndex((row) => row[0] === propertyNumber);

    if (rowIndex === -1) {
      throw new Error("Property not found");
    }

    const currentProperty = this.rowToProperty(rows[rowIndex]);
    const updatedProperty: Property = {
      ...(currentProperty as any),
      ...(updates as any),
      updatedAt: new Date().toISOString(),
    };

    const updatedRow = this.propertyToRow(updatedProperty);
    await this.updateRow(SHEETS.PROPERTIES, rowIndex + 2, updatedRow);

    return updatedProperty;
  }

  async deleteProperty(propertyNumber: string): Promise<void> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    const rowIndex = rows.findIndex((row) => row[0] === propertyNumber);

    if (rowIndex === -1) {
      throw new Error("Property not found");
    }

    await this.deleteRow(SHEETS.PROPERTIES, rowIndex + 2);
  }

  // ================== الاشتراكات ==================

  async getSubscriptions(): Promise<Subscription[]> {
    const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
    return rows.map((row) => ({
      id: row[0] || "",
      propertyNumber: row[1] || "",
      packageId: row[2] || "",
      startDate: row[3] || "",
      endDate: row[4] || "",
      status: (row[5] as any) || "نشط",
      paymentId: row[6] || undefined,
      createdAt: row[7] || "",
    }));
  }

  async createSubscription(
    subscription: InsertSubscription,
  ): Promise<Subscription> {
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
      newSubscription.paymentId || "",
      newSubscription.createdAt,
    ];

    await this.appendToSheet(SHEETS.SUBSCRIPTIONS, [row]);
    return newSubscription;
  }

  async updateSubscription(
    id: string,
    updates: Partial<Subscription>,
  ): Promise<Subscription> {
    const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
    const rowIndex = rows.findIndex((row) => row[0] === id);

    if (rowIndex === -1) {
      throw new Error("Subscription not found");
    }

    const current = rows[rowIndex];
    const updated: Subscription = {
      id: current[0],
      propertyNumber: updates.propertyNumber ?? current[1],
      packageId: updates.packageId ?? current[2],
      startDate: updates.startDate ?? current[3],
      endDate: updates.endDate ?? current[4],
      status: updates.status ?? (current[5] as any),
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
      updated.paymentId || "",
      updated.createdAt,
    ];

    await this.updateRow(SHEETS.SUBSCRIPTIONS, rowIndex + 2, row);
    return updated;
  }

  // ================== الباقات ==================

  async getPackages(): Promise<Package[]> {
    const rows = await this.readSheet(SHEETS.PACKAGES);
    return rows.map((row) => ({
      id: row[0] || "",
      name: row[1] || "",
      duration: parseInt(row[2]) || 0,
      price: parseFloat(row[3]) || 0,
      type: (row[4] as any) || "عادي",
      features: row[5] ? JSON.parse(row[5]) : [],
      isActive: row[6] === "true",
      createdAt: row[7] || "",
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

  // ================== أكواد الخصم ==================

  async getDiscountCodes(): Promise<DiscountCode[]> {
    const rows = await this.readSheet(SHEETS.DISCOUNTS);
    return rows.map((row) => ({
      code: row[0] || "",
      type: row[1] as any,
      value: parseFloat(row[2]) || 0,
      expiryDate: row[3] || undefined,
      isActive: row[4] === "true",
      usageCount: parseInt(row[5]) || 0,
      createdAt: row[6] || "",
    }));
  }

  async createDiscountCode(
    discountCode: InsertDiscountCode,
  ): Promise<DiscountCode> {
    const newCode: DiscountCode = {
      ...discountCode,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newCode.code,
      newCode.type,
      newCode.value.toString(),
      newCode.expiryDate || "",
      newCode.isActive.toString(),
      newCode.usageCount.toString(),
      newCode.createdAt,
    ];

    await this.appendToSheet(SHEETS.DISCOUNTS, [row]);
    return newCode;
  }

  // ================== المدفوعات ==================

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
      newPayment.discountCode || "",
      newPayment.discountAmount.toString(),
      newPayment.finalAmount.toString(),
      newPayment.paymobOrderId || "",
      newPayment.status,
      newPayment.paymentMethod || "",
      newPayment.receiptUrl || "",
      newPayment.createdAt,
      newPayment.completedAt || "",
    ];

    console.log(
      `💾 Creating payment in sheet "${SHEETS.PAYMENTS}": ID=${id}, PropertyNumber=${newPayment.propertyNumber}`,
    );
    await this.appendToSheet(SHEETS.PAYMENTS, [row]);
    console.log(`✅ Payment created successfully: ${id}`);
    return newPayment;
  }

  async updatePayment(id: string, updates: Partial<Payment>): Promise<Payment> {
    let rows = await this.readSheet(SHEETS.PAYMENTS);
    let rowIndex = rows.findIndex((row) => row[0] === id);

    if (rowIndex === -1) {
      console.log(
        `⏳ Payment not found on first try, waiting 1s and retrying...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      rows = await this.readSheet(SHEETS.PAYMENTS);
      rowIndex = rows.findIndex((row) => row[0] === id);
    }

    if (rowIndex === -1) {
      console.log(
        `❌ Payment not found after retry. ID: ${id}, Available IDs:`,
        rows.slice(0, 3).map((r) => r[0]),
      );
      throw new Error(`Payment not found: ${id}`);
    }

    const current = rows[rowIndex];

    const updatedPayment: Payment = {
      id: current[0],
      propertyNumber: updates.propertyNumber ?? current[1],
      packageId: updates.packageId ?? current[2],

      amount:
        updates.amount ?? (parseFloat(current[3]) || 0),

      discountCode:
        updates.discountCode ?? (current[4] || undefined),

      discountAmount:
        updates.discountAmount ??
        (parseFloat(current[5]) || 0),

      finalAmount:
        updates.finalAmount ??
        (parseFloat(current[6]) || 0),

      paymobOrderId:
        updates.paymobOrderId ?? (current[7] || undefined),

      status: updates.status ?? (current[8] as any),

      paymentMethod:
        updates.paymentMethod ?? (current[9] || undefined),

      receiptUrl:
        updates.receiptUrl ?? (current[10] || undefined),

      createdAt: current[11],

      completedAt:
        updates.completedAt ?? (current[12] || undefined),
    };

    const row = [
      updatedPayment.id,
      updatedPayment.propertyNumber,
      updatedPayment.packageId,
      updatedPayment.amount.toString(),
      updatedPayment.discountCode || "",
      updatedPayment.discountAmount.toString(),
      updatedPayment.finalAmount.toString(),
      updatedPayment.paymobOrderId || "",
      updatedPayment.status,
      updatedPayment.paymentMethod || "",
      updatedPayment.receiptUrl || "",
      updatedPayment.createdAt,
      updatedPayment.completedAt || "",
    ];

    await this.updateRow(SHEETS.PAYMENTS, rowIndex + 2, row);
    return updatedPayment;
  }

  async getPayments(): Promise<Payment[]> {
    const rows = await this.readSheet(SHEETS.PAYMENTS);
    return rows
      .filter((row) => row[0] && String(row[0]).startsWith("PAY-"))
      .map((row) => ({
        id: row[0] || "",
        propertyNumber: row[1] || "",
        packageId: row[2] || "",
        amount: parseFloat(row[3]) || 0,
        discountCode: row[4] || undefined,
        discountAmount: parseFloat(row[5]) || 0,
        finalAmount: parseFloat(row[6]) || 0,
        paymobOrderId: row[7] || undefined,
        status: (row[8] as any) || "معلق",
        paymentMethod: (row[9] as any) || undefined,
        receiptUrl: row[10] || undefined,
        createdAt: row[11] || new Date().toISOString(),
        completedAt: row[12] || undefined,
      }));
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const payments = await this.getPayments();
    return payments.find((p) => p.id === id) || null;
  }

  // ================== الاقتراحات / الطلبات ==================

  async createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion> {
    const id = `SUG-${Date.now()}`;
    const newSuggestion: Suggestion = {
      id,
      ...suggestion,
      status: "جديد",
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
