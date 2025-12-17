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
  NotificationSettings,
  PartnerProfit,
  InsertPartnerProfit,
  MultiPropertySubscription,
  InsertMultiPropertySubscription,
  FeeConfig,
  InsertFeeConfig,
} from "@shared/schema";
import { DEFAULT_FEE_CONFIGS } from "@shared/schema";
import { getNowInRiyadh, toRiyadhISO, getStartOfMonthRiyadh, getEndOfMonthRiyadh, addDays, addMonths } from "./dateUtils";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

// أسماء الشيتات
const SHEETS = {
  PROPERTIES: "بيانات العقارات",
  SUBSCRIPTIONS: "الاشتراكات",
  PACKAGES: "الباقات",
  DISCOUNTS: "أكواد الخصم",
  PROFITS: "الأرباح",
  PARTNER_PROFITS: "أرباح الشريك",
  REQUESTS: "الطلبات",
  SUGGESTIONS: "الاقتراحات",
  PRICES: "الأسعار",
  PAYMENTS: "المدفوعات",
  ANALYTICS: "الإحصائيات",
  WHATSAPP: "تنبيهات الواتساب",
  VERIFICATION_LOGS: "سجل التحقق",
  SETTINGS: "الإعدادات",
  MULTI_PROPERTY_SUBS: "اشتراكات العقارين",
  FEE_CONFIGS: "إعدادات الرسوم",
};

// عمود حالة التحقق — العمود 20 (T)
const COL_VERIFICATION = 20;

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
        "رقم العقار",
        "اسم العقار",
        "رقم الجوال",
        "رسوم الاشتراك",
        "نوع الاشتراك",
        "تاريخ البداية",
        "تاريخ الانتهاء",
        "الأيام المتبقية",
        "رابط الإيصال",
        "علم انتهاء الاشتراك",
        "علم إشعار الإيصال",
        "آخر دورة",
        "رمز التحديث",
        "العقار المرتبط",
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
        "عدد العقارات",
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
        "رقم العقار",
        "اسم العقار",
        "كود الطلب",
        "عنوان IP",
        "يوم الأسبوع",
        "الساعة",
        "اليوم",
        "الشهر",
        "السنة",
        "الوقت",
        "نوع الجهاز",
        "عدد الطلبات",
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

      [SHEETS.WHATSAPP]: [
        "المعرف",
        "رقم العقار",
        "اسم العقار",
        "رقم المالك",
        "نوع الإشعار",
        "الرسالة",
        "الحالة",
        "رد API",
        "التاريخ",
      ],

      [SHEETS.VERIFICATION_LOGS]: [
        "التاريخ",
        "رقم العقار",
        "الإجراء",
        "السبب",
        "الأدمن",
      ],
      [SHEETS.SETTINGS]: [
        "المفتاح",
        "القيمة",
        "آخر تحديث",
      ],
      [SHEETS.PARTNER_PROFITS]: [
        "المعرف",
        "الشهر/السنة",
        "عدد الاشتراكات الفعالة",
        "إجمالي الإيرادات",
        "نصيب الشريك",
        "نسبة الشريك",
        "تاريخ التحويل",
        "حالة التحويل",
        "ملاحظات",
        "تاريخ الإنشاء",
        "تاريخ التحديث",
      ],
      [SHEETS.MULTI_PROPERTY_SUBS]: [
        "المعرف",
        "معرف الباقة",
        "رقم العقار الأول",
        "رقم العقار الثاني",
        "تاريخ البداية",
        "تاريخ الانتهاء",
        "الحالة",
        "معرف الدفع",
        "تاريخ الإنشاء",
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
      verificationStatus: row[COL_VERIFICATION - 1] || undefined,
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
    p.verificationStatus || "pending",
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
      verificationStatus: "pending",       

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

  // ================== تحديث حالة التحقق ==================
  async updateVerificationStatus(
    propertyNumber: string,
    newStatus: "pending" | "approved" | "rejected" | "incomplete"
  ): Promise<Property> {
    // 1) قراءة كل العقارات
    const rows = await this.readSheet(SHEETS.PROPERTIES);

    // 2) البحث عن العقار
    const rowIndex = rows.findIndex((row) => row[0] === propertyNumber);
    if (rowIndex === -1) {
      throw new Error(`Property not found: ${propertyNumber}`);
    }

    // 3) تحويل الصف إلى كائن
    const currentProperty = this.rowToProperty(rows[rowIndex]);

    // 4) تحديث الحالة فقط
    currentProperty.verificationStatus = newStatus;

    // 5) تحويل الكائن إلى صف
    const updatedRow = this.propertyToRow(currentProperty);

    // 6) كتابة الصف في الشيت
    await this.updateRow(SHEETS.PROPERTIES, rowIndex + 2, updatedRow);

    // 7) إعادة العقار المحدث
    return currentProperty;
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
  
  // قراءة من ورقة الاشتراكات الفعلية
  // الأعمدة: رقم العقار(0), اسم العقار(1), رقم الجوال(2), رسوم الاشتراك(3), نوع الاشتراك(4), تاريخ البداية(5), تاريخ الانتهاء(6), الأيام المتبقية(7), رابط الإيصال(8), علم انتهاء(9), علم إشعار(10), آخر دورة(11), رمز التحديث(12), العقار المرتبط(13)
  private rowToSubscriptionFromSheet(row: any[]): Subscription & { price?: number; subscriptionType?: string; propertyName?: string } {
    const propertyName = row[1] ? String(row[1]).trim() : "";  // قراءة اسم العقار من العمود 1
    const startDate = row[5] ? String(row[5]) : "";
    const endDate = row[6] ? String(row[6]) : "";
    const packageId = row[12] ? String(row[12]) : "pkg-free";  // قراءة packageId من العمود 12
    const price = row[3] ? parseFloat(String(row[3])) : 0;  // قراءة السعر من العمود 3
    const subscriptionType = row[4] ? String(row[4]).trim() : "عادي";  // قراءة نوع الاشتراك من العمود 4
    const linkedProperty = row[13] ? String(row[13]).trim() : undefined;  // العقار المرتبط (العمود 13)
    
    // حساب الحالة تلقائياً من تاريخ الانتهاء
    let status = "نشط";
    if (endDate) {
      try {
        const endDateObj = new Date(endDate);
        if (endDateObj < new Date()) {
          status = "منتهي";
        }
      } catch (e) {}
    }
    
    return {
      id: `SUB-${row[0]}`,
      propertyNumber: row[0] || "",
      packageId: packageId,  // استخدام packageId المخزن في العمود 12
      startDate,
      endDate,
      status: status as any,
      price,  // إضافة السعر
      subscriptionType,  // نوع الاشتراك من الشيت مباشرة (العمود 4)
      propertyName,  // اسم العقار من الشيت مباشرة (العمود 1)
      linkedProperty,  // العقار المرتبط
    };
  }

private subscriptionToRow(propertyNumber: string, subscription: any, property: any, receiptUrl?: string): any[] {
  const endDate = new Date(subscription.endDate);
  const now = new Date();
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // منطق تحديد نوع الاشتراك
  const isPremium =
    subscription.packageType === "مميز" ||
    subscription.packageId?.includes("premium") ||
    subscription.packageId === "pkg-trusted" ||
    (subscription.price && Number(subscription.price) > 0);

  const subscriptionType = isPremium ? "مميز" : "عادي";

  return [
    propertyNumber,                              // 0 رقم العقار
    property?.name || "",                        // 1 اسم العقار
    property?.whatsappNumber || "",              // 2 رقم الجوال
    subscription.price || "",                    // 3 رسوم الاشتراك
    subscriptionType,                            // 4 نوع الاشتراك
    subscription.startDate?.split("T")[0] || "", // 5 تاريخ البداية
    subscription.endDate?.split("T")[0] || "",   // 6 تاريخ الانتهاء
    Math.max(daysRemaining, 0),                  // 7 الأيام المتبقية
    receiptUrl || "",                            // 8 رابط الإيصال
    "",                                          // 9 علم انتهاء الاشتراك
    "",                                          // 10 علم إشعار الإيصال
    "",                                          // 11 آخر دورة ← تم حذف التاريخ
    subscription.packageId || "",                // 12 رمز التحديث (packageId)
    subscription.linkedProperty || "",           // 13 العقار المرتبط
  ];
}



  async getSubscriptions(): Promise<Subscription[]> {
    // قراءة من ورقة الاشتراكات
    const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
    console.log(`📋 Read ${rows.length} subscription(s) from "${SHEETS.SUBSCRIPTIONS}"`);
    
    return rows
      .filter(row => row[0] && row[1]) // تحقق من وجود معرف ورقم عقار
      .map((row) => this.rowToSubscriptionFromSheet(row));
  }
  
  async getSubscriptionByPropertyNumber(propertyNumber: string): Promise<Subscription | null> {
    const subscriptions = await this.getSubscriptions();
    // البحث عن آخر اشتراك للعقار (الأحدث)
    const propertySubscriptions = subscriptions
      .filter(s => s.propertyNumber === propertyNumber)
      .sort((a, b) => {
        const dateA = new Date(a.endDate || 0).getTime();
        const dateB = new Date(b.endDate || 0).getTime();
        return dateB - dateA; // ترتيب تنازلي
      });
    
    return propertySubscriptions[0] || null;
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    const rowIndex = rows.findIndex((row) => row[0] === subscription.propertyNumber);

    if (rowIndex === -1) {
      throw new Error("Property not found");
    }

    const propertyRow = rows[rowIndex];

    // 👌 تحديد إذا كانت الباقة مميزة
    const isPremium =
      subscription.packageId?.includes("premium") ||
      subscription.packageId === "pkg-trusted" ||
      subscription.status === "نشط";

    // 🟡 15 = نوع الاشتراك
    propertyRow[15] = isPremium ? "مميز" : "عادي";

    // 🟡 16 = آخر تحديث
    propertyRow[16] = toRiyadhISO(getNowInRiyadh()).split("T")[0];

    // 🟡 17 = تاريخ الاشتراك
    propertyRow[17] = subscription.startDate.split("T")[0];

    // الرقم السري لا نلمسه (18)

    await this.updateRow(SHEETS.PROPERTIES, rowIndex + 2, propertyRow);

    return {
      id: `SUB-${subscription.propertyNumber}`,
      ...subscription,
    };
  }



  // إضافة أو تحديث اشتراك في ورقة الاشتراكات
 async addSubscriptionToSheet(propertyNumber: string, subscriptionData: any, property: any, receiptUrl?: string): Promise<void> {

  const newRow = this.subscriptionToRow(propertyNumber, subscriptionData, property, receiptUrl);

  // تحديث / إنشاء صف الاشتراكات
  const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
  const existingRowIndex = rows.findIndex((row) => row[0] === propertyNumber);

  if (existingRowIndex !== -1) {
    console.log(`🔄 Updating existing subscription for property ${propertyNumber}`);
    await this.updateRow(SHEETS.SUBSCRIPTIONS, existingRowIndex + 2, newRow);
  } else {
    console.log(`✨ Creating new subscription row for property ${propertyNumber}`);
    await this.appendToSheet(SHEETS.SUBSCRIPTIONS, [newRow]);
  }


  // ============================
  // ⭐ تحديث ورقة "بيانات العقارات"
  // ============================

  const props = await this.readSheet(SHEETS.PROPERTIES);
  const propIndex = props.findIndex(r => r[0] === propertyNumber);

  if (propIndex !== -1) {
    const propRow = props[propIndex];

    // 15 = نوع الاشتراك
    propRow[15] = "مميز";

    // 16 = آخر تحديث
    propRow[16] = new Date().toISOString().split("T")[0];

    // 17 = تاريخ الاشتراك
    try {
      propRow[17] = subscriptionData.startDate.split("T")[0];
    } catch {
      propRow[17] = subscriptionData.startDate || "";
    }

    await this.updateRow(SHEETS.PROPERTIES, propIndex + 2, propRow);

    console.log(`⭐ Updated property subscriptionType → مميز for ${propertyNumber}`);
  } else {
    console.log(`⚠️ Property ${propertyNumber} not found in main sheet`);
  }
}

  // تحديث العقار المرتبط في الاشتراك
  async updateSubscriptionLinkedProperty(propertyNumber: string, linkedProperty: string): Promise<void> {
    try {
      const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
      const rowIndex = rows.findIndex((row) => row[0] === propertyNumber);
      
      if (rowIndex === -1) {
        console.log(`⚠️ Subscription not found for property ${propertyNumber}`);
        return;
      }
      
      const row = rows[rowIndex];
      row[13] = linkedProperty; // العمود 13 = العقار المرتبط
      
      await this.updateRow(SHEETS.SUBSCRIPTIONS, rowIndex + 2, row);
      console.log(`🔗 Updated linkedProperty for ${propertyNumber} → ${linkedProperty}`);
    } catch (error) {
      console.error(`❌ خطأ في تحديث العقار المرتبط للعقار ${propertyNumber}:`, error);
    }
  }

  async updateSubscription(
    id: string,
    updates: Partial<Subscription>,
  ): Promise<Subscription> {
    const rows = await this.readSheet(SHEETS.PROPERTIES);
    const propertyNumber = id.replace("SUB-", "");
    const rowIndex = rows.findIndex((row) => row[0] === propertyNumber);

    if (rowIndex === -1) {
      throw new Error("Property not found");
    }

    const propertyRow = rows[rowIndex];

    const isPremium =
      updates.packageId?.includes("premium") ||
      updates.packageId === "pkg-trusted" ||
      updates.status === "نشط";

    // 🟡 نوع الاشتراك
    if (updates.packageId) {
      propertyRow[15] = isPremium ? "مميز" : "عادي";
    }

    // 🟡 آخر تحديث
    propertyRow[16] = new Date().toISOString().split("T")[0];

    // 🟡 تاريخ الاشتراك
    if (updates.startDate) {
      propertyRow[17] = updates.startDate.split("T")[0];
    }

    // ❌ نترك الرقم السري كما هو (18)

    await this.updateRow(SHEETS.PROPERTIES, rowIndex + 2, propertyRow);

    const endDate = updates.endDate || "";
    const status = endDate && new Date(endDate) > new Date() ? "نشط" : "منتهي";

    return {
      id: `SUB-${propertyNumber}`,
      propertyNumber,
      packageId: isPremium ? "pkg-trusted" : "pkg-free",
      startDate: propertyRow[17] || "",
      endDate: endDate,
      status: status as any,
    };
  }

  /**
   * تحديث الأيام المتبقية في ورقة الاشتراكات
   * العمود 7 = الأيام المتبقية
   */
  async updateSubscriptionRemainingDays(propertyNumber: string, remainingDays: number): Promise<void> {
    try {
      const rows = await this.readSheet(SHEETS.SUBSCRIPTIONS);
      const rowIndex = rows.findIndex((row) => row[0] === propertyNumber);
      
      if (rowIndex === -1) {
        // لا يوجد اشتراك لهذا العقار
        return;
      }
      
      const row = rows[rowIndex];
      row[7] = Math.max(0, remainingDays); // العمود 7 = الأيام المتبقية
      
      await this.updateRow(SHEETS.SUBSCRIPTIONS, rowIndex + 2, row);
    } catch (error) {
      console.error(`❌ خطأ في تحديث الأيام المتبقية للعقار ${propertyNumber}:`, error);
    }
  }

  // ================== الباقات ==================
  
  // قراءة الباقات من ورقة الباقات
  // الأعمدة: المعرف(0), الاسم(1), المدة(2), السعر(3), النوع(4), المميزات(5), نشط(6), تاريخ الإنشاء(7), عدد العقارات(8)
  private rowToPackage(row: any[]): Package {
    const featuresRaw = row[5] || "";
    let features: string[] = [];
    
    if (featuresRaw) {
      try {
        // محاولة parse JSON أولاً
        features = JSON.parse(featuresRaw);
      } catch {
        // إذا فشل، افصل بالفاصلة
        features = String(featuresRaw).split(",").map(s => s.trim()).filter(Boolean);
      }
    }
    
    const id = row[0] || `pkg-${Date.now()}`;
    // تحديد عدد العقارات: إما من العمود أو افتراضي للباقة ذات العقارين
    let propertyCount = parseInt(row[8]) || 1;
    if (id === 'pkg-month-2properties' && propertyCount === 1) {
      propertyCount = 2; // القيمة الافتراضية لباقة العقارين
    }
    
    return {
      id,
      name: row[1] || "",
      duration: parseInt(row[2]) || 30,
      price: parseFloat(row[3]) || 0,
      type: (row[4] as any) || "عادي",
      features,
      isActive: row[6] !== "false" && row[6] !== "لا",
      createdAt: row[7] || undefined,
      propertyCount,
    };
  }

  async getPackages(): Promise<Package[]> {
    const rows = await this.readSheet(SHEETS.PACKAGES);
    console.log(`📦 Read ${rows.length} package(s) from "${SHEETS.PACKAGES}"`);
    
    return rows
      .filter(row => row[0] && row[1]) // تحقق من وجود معرف واسم
      .map((row) => this.rowToPackage(row))
      .filter(pkg => pkg.isActive); // فقط الباقات النشطة
  }

  async getPackageById(id: string): Promise<Package | null> {
    const packages = await this.getPackages();
    return packages.find(p => p.id === id) || null;
  }

  async createPackage(pkg: InsertPackage): Promise<Package> {
    const id = `pkg-${Date.now()}`;
    const newPkg: Package = {
      id,
      ...pkg,
      createdAt: new Date().toISOString(),
    };
    
    const features = Array.isArray(newPkg.features) ? newPkg.features.join(", ") : "";
    
    const row = [
      newPkg.id,
      newPkg.name,
      newPkg.duration.toString(),
      newPkg.price.toString(),
      newPkg.type,
      features,
      newPkg.isActive ? "نعم" : "لا",
      newPkg.createdAt,
      (newPkg.propertyCount || 1).toString(), // عدد العقارات
    ];
    
    await this.appendToSheet(SHEETS.PACKAGES, [row]);
    return newPkg;
  }

  async updatePackage(id: string, updates: Partial<Package>): Promise<Package | null> {
    const rows = await this.readSheet(SHEETS.PACKAGES);
    const rowIndex = rows.findIndex((row) => row[0] === id);
    
    if (rowIndex === -1) {
      return null;
    }
    
    const currentPkg = this.rowToPackage(rows[rowIndex]);
    const updatedPkg = { ...currentPkg, ...updates };
    
    const features = Array.isArray(updatedPkg.features) ? updatedPkg.features.join(", ") : "";
    
    const newRow = [
      updatedPkg.id,
      updatedPkg.name,
      updatedPkg.duration.toString(),
      updatedPkg.price.toString(),
      updatedPkg.type,
      features,
      updatedPkg.isActive ? "نعم" : "لا",
      updatedPkg.createdAt || "",
      (updatedPkg.propertyCount || 1).toString(), // عدد العقارات
    ];
    
    await this.updateRow(SHEETS.PACKAGES, rowIndex + 2, newRow);
    return updatedPkg;
  }

  async deletePackage(id: string): Promise<void> {
    const rows = await this.readSheet(SHEETS.PACKAGES);
    const rowIndex = rows.findIndex((row) => row[0] === id);
    
    if (rowIndex === -1) {
      throw new Error("الباقة غير موجودة");
    }
    
    await this.deleteRow(SHEETS.PACKAGES, rowIndex + 2);
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

  async updateDiscountCode(code: string, updates: Partial<DiscountCode>): Promise<DiscountCode | null> {
    const rows = await this.readSheet(SHEETS.DISCOUNTS);
    const rowIndex = rows.findIndex((row) => row[0] === code);
    
    if (rowIndex === -1) {
      return null;
    }
    
    const currentDiscount = {
      code: rows[rowIndex][0] || "",
      type: rows[rowIndex][1] as any,
      value: parseFloat(rows[rowIndex][2]) || 0,
      expiryDate: rows[rowIndex][3] || undefined,
      isActive: rows[rowIndex][4] === "true",
      usageCount: parseInt(rows[rowIndex][5]) || 0,
      createdAt: rows[rowIndex][6] || "",
    };
    
    const updatedDiscount = { ...currentDiscount, ...updates };
    
    const newRow = [
      updatedDiscount.code,
      updatedDiscount.type,
      updatedDiscount.value.toString(),
      updatedDiscount.expiryDate || "",
      updatedDiscount.isActive.toString(),
      updatedDiscount.usageCount.toString(),
      updatedDiscount.createdAt,
    ];
    
    await this.updateRow(SHEETS.DISCOUNTS, rowIndex + 2, newRow);
    return updatedDiscount;
  }

  async deleteDiscountCode(code: string): Promise<void> {
    const rows = await this.readSheet(SHEETS.DISCOUNTS);
    const rowIndex = rows.findIndex((row) => row[0] === code);
    
    if (rowIndex === -1) {
      throw new Error("كود الخصم غير موجود");
    }
    
    await this.deleteRow(SHEETS.DISCOUNTS, rowIndex + 2);
  }

  // ================== المدفوعات ==================

  // تحديث عناوين أعمدة ورقة المدفوعات
  async setupPaymentsSheetHeaders(): Promise<void> {
    const headers = [
      "معرف الدفع",           // A
      "رقم العقار",           // B
      "الباقة",               // C
      "السعر الأصلي",         // D
      "كود الخصم",            // E
      "قيمة الخصم",           // F
      "السعر النهائي",        // G
      "معرف Paymob",         // H
      "الحالة",               // I
      "طريقة الدفع",          // J
      "رابط الإيصال",         // K
      "تاريخ الإنشاء",        // L
      "تاريخ الإكمال",        // M
      "نوع الإجراء",          // N
      "تاريخ البدء المعلق",   // O
      "تاريخ الانتهاء المعلق", // P
      "نوع الاشتراك المعلق",  // Q
      "السعر المعلق",         // R
      "معرف العملية",         // S - Transaction ID
      "مجموع الرسوم",         // T - feeAmount (merchant + acq)
      "ضريبة القيمة المضافة", // U - vatAmount
      "إجمالي الرسوم",       // V - totalFees
      "المبلغ الصافي",        // W - netAmount
      "رسوم التاجر",          // X - merchantFees
      "رسوم البنك",           // Y - acqFees
    ];

    try {
      const sheets = await getGoogleSheetClient();
      
      // تحديث الصف الأول بالعناوين (A إلى Y = 25 عمود)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.PAYMENTS}!A1:Y1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [headers],
        },
      });
      
      console.log(`✅ Payment sheet headers updated successfully`);
    } catch (error) {
      console.error("❌ Error updating payment sheet headers:", error);
      throw error;
    }
  }

  // تحديث رسوم معاملة معينة (بواسطة transactionId)
  async updatePaymentFees(transactionId: string, fees: {
    feeAmount: number;
    vatAmount: number;
    totalFees: number;
    merchantFees: number;
    acqFees: number;
  }): Promise<void> {
    const rows = await this.readSheet(SHEETS.PAYMENTS);
    
    // البحث عن الصف بناءً على transactionId (العمود S = index 18)
    const rowIndex = rows.findIndex((row) => row[18] === transactionId);
    
    if (rowIndex === -1) {
      throw new Error(`المعاملة ${transactionId} غير موجودة`);
    }
    
    const existingRow = rows[rowIndex];
    const amount = parseFloat(existingRow[6]) || 0; // العمود G = السعر النهائي
    const netAmount = Math.round((amount - fees.totalFees) * 100) / 100;
    
    // تحديث أعمدة الرسوم (T إلى Y = الأعمدة 19-24 في الـ array، الصف الفعلي = rowIndex + 2)
    // T: مجموع الرسوم | U: ضريبة | V: إجمالي | W: صافي | X: رسوم التاجر | Y: رسوم البنك
    const sheets = await getGoogleSheetClient();
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEETS.PAYMENTS}!T${rowIndex + 2}:Y${rowIndex + 2}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          fees.feeAmount.toString(),      // T
          fees.vatAmount.toString(),      // U
          fees.totalFees.toString(),      // V
          netAmount.toString(),           // W
          fees.merchantFees.toString(),   // X
          fees.acqFees.toString(),        // Y
        ]],
      },
    });
    
    console.log(`✅ Updated fees for transaction ${transactionId}: total=${fees.totalFees}, net=${netAmount}`);
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const id = `PAY-${Date.now()}`;
    const newPayment: Payment = {
      id,
      ...payment,
      createdAt: toRiyadhISO(getNowInRiyadh()),
    };

    // ترتيب الأعمدة:
    // A: ID | B: رقم العقار | C: الباقة | D: السعر الأصلي | E: كود الخصم
    // F: قيمة الخصم | G: السعر النهائي | H: معرف Paymob | I: الحالة | J: طريقة الدفع
    // K: رابط الإيصال | L: تاريخ الإنشاء | M: تاريخ الإكمال | N: نوع الإجراء
    // O: تاريخ البدء المعلق | P: تاريخ الانتهاء المعلق | Q: نوع الاشتراك المعلق | R: السعر المعلق
    // S: معرف العملية | T: رسوم التاجر+البنك | U: ضريبة القيمة المضافة | V: إجمالي الرسوم | W: المبلغ الصافي
    // X: رسوم التاجر | Y: رسوم البنك | Z: رقم العقار الثاني
    const row = [
      newPayment.id,                              // A
      newPayment.propertyNumber,                  // B
      newPayment.packageId,                       // C
      newPayment.amount.toString(),               // D - السعر الأصلي
      newPayment.discountCode || "",              // E
      newPayment.discountAmount.toString(),       // F
      newPayment.finalAmount.toString(),          // G - السعر بعد الخصم
      newPayment.paymobOrderId || "",             // H
      newPayment.status,                          // I
      newPayment.paymentMethod || "",             // J
      newPayment.receiptUrl || "",                // K
      newPayment.createdAt,                       // L
      newPayment.completedAt || "",               // M
      newPayment.action || "",                    // N
      newPayment.pendingStartDate || "",          // O
      newPayment.pendingEndDate || "",            // P
      newPayment.pendingSubscriptionType || "",   // Q
      newPayment.pendingPrice?.toString() || "",  // R
      newPayment.transactionId || "",             // S
      newPayment.feeAmount?.toString() || "",     // T - مجموع الرسوم (merchant + acq)
      newPayment.vatAmount?.toString() || "",     // U
      newPayment.totalFees?.toString() || "",     // V
      newPayment.netAmount?.toString() || "",     // W
      newPayment.merchantFees?.toString() || "",  // X - رسوم التاجر
      newPayment.acqFees?.toString() || "",       // Y - رسوم البنك
      (newPayment as any).secondPropertyNumber || "",  // Z - رقم العقار الثاني
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
      amount: updates.amount ?? (parseFloat(current[3]) || 0),
      discountCode: updates.discountCode ?? (current[4] || undefined),
      discountAmount: updates.discountAmount ?? (parseFloat(current[5]) || 0),
      finalAmount: updates.finalAmount ?? (parseFloat(current[6]) || 0),
      paymobOrderId: updates.paymobOrderId ?? (current[7] || undefined),
      status: updates.status ?? (current[8] as any),
      paymentMethod: updates.paymentMethod ?? (current[9] || undefined),
      receiptUrl: updates.receiptUrl ?? (current[10] || undefined),
      createdAt: current[11],
      completedAt: updates.completedAt ?? (current[12] || undefined),
      action: updates.action ?? (current[13] as any || undefined),
      pendingStartDate: updates.pendingStartDate ?? (current[14] || undefined),
      pendingEndDate: updates.pendingEndDate ?? (current[15] || undefined),
      pendingSubscriptionType: updates.pendingSubscriptionType ?? (current[16] || undefined),
      pendingPrice: updates.pendingPrice ?? (parseFloat(current[17]) || undefined),
      // حقول Paymob الجديدة
      transactionId: updates.transactionId ?? (current[18] || undefined),
      feeAmount: updates.feeAmount ?? (parseFloat(current[19]) || undefined),
      vatAmount: updates.vatAmount ?? (parseFloat(current[20]) || undefined),
      totalFees: updates.totalFees ?? (parseFloat(current[21]) || undefined),
      netAmount: updates.netAmount ?? (parseFloat(current[22]) || undefined),
      merchantFees: updates.merchantFees ?? (parseFloat(current[23]) || undefined),
      acqFees: updates.acqFees ?? (parseFloat(current[24]) || undefined),
    };

    // نفس ترتيب الأعمدة كما في createPayment
    const row = [
      updatedPayment.id,                              // A
      updatedPayment.propertyNumber,                  // B
      updatedPayment.packageId,                       // C
      updatedPayment.amount.toString(),               // D
      updatedPayment.discountCode || "",              // E
      updatedPayment.discountAmount.toString(),       // F
      updatedPayment.finalAmount.toString(),          // G
      updatedPayment.paymobOrderId || "",             // H
      updatedPayment.status,                          // I
      updatedPayment.paymentMethod || "",             // J
      updatedPayment.receiptUrl || "",                // K
      updatedPayment.createdAt,                       // L
      updatedPayment.completedAt || "",               // M
      updatedPayment.action || "",                    // N
      updatedPayment.pendingStartDate || "",          // O
      updatedPayment.pendingEndDate || "",            // P
      updatedPayment.pendingSubscriptionType || "",   // Q
      updatedPayment.pendingPrice?.toString() || "",  // R
      updatedPayment.transactionId || "",             // S
      updatedPayment.feeAmount?.toString() || "",     // T - مجموع الرسوم
      updatedPayment.vatAmount?.toString() || "",     // U
      updatedPayment.totalFees?.toString() || "",     // V
      updatedPayment.netAmount?.toString() || "",     // W
      updatedPayment.merchantFees?.toString() || "",  // X - رسوم التاجر
      updatedPayment.acqFees?.toString() || "",       // Y - رسوم البنك
      (updatedPayment as any).secondPropertyNumber || "",  // Z - رقم العقار الثاني
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
        action: (row[13] as any) || undefined,
        pendingStartDate: row[14] || undefined,
        pendingEndDate: row[15] || undefined,
        pendingSubscriptionType: row[16] || undefined,
        pendingPrice: parseFloat(row[17]) || undefined,
        // حقول Paymob الجديدة
        transactionId: row[18] || undefined,
        feeAmount: parseFloat(row[19]) || undefined,
        vatAmount: parseFloat(row[20]) || undefined,
        totalFees: parseFloat(row[21]) || undefined,
        netAmount: parseFloat(row[22]) || undefined,
        merchantFees: parseFloat(row[23]) || undefined,
        acqFees: parseFloat(row[24]) || undefined,
        // العقار الثاني (لباقات العقارين)
        secondPropertyNumber: row[25] || undefined,
      }));
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const payments = await this.getPayments();
    return payments.find((p) => p.id === id) || null;
  }

  // جلب مدفوعات عقار معين
  async getPaymentsByProperty(propertyNumber: string): Promise<Payment[]> {
    const payments = await this.getPayments();
    return payments
      .filter((p) => p.propertyNumber === propertyNumber)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }


  // ================== تحديث حالة الدفع ==================
  async updatePaymentStatus(paymentId: string, newStatus: string): Promise<void> {
    const rows = await this.readSheet(SHEETS.PAYMENTS);

    // العمود A = "معرف الدفع" → index = 0
    const rowIndex = rows.findIndex(r => String(r[0]) === String(paymentId));

    if (rowIndex === -1) {
      throw new Error(`لم يتم العثور على الدفع: ${paymentId}`);
    }

    // عمود الحالة = العمود 9 → index = 8
    const STATUS_COLUMN = 8;

    const sheets = await getGoogleSheetClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEETS.PAYMENTS}!I${rowIndex + 2}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[newStatus]],
      },
    });

    console.log(`✅ Payment status updated → ${paymentId}: ${newStatus}`);
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

  async getRequests(): Promise<Request[]> {
    try {
      const rows = await this.readSheet(SHEETS.REQUESTS);
      if (!rows || rows.length === 0) return [];
      return rows.map((row, idx) => {
        // row[0]: propertyNumber, row[3]: ipAddress, row[6]: day, row[7]: month, row[8]: year, row[9]: time, row[10]: deviceType
        const propertyNumber = row[0] || "";
        const requestCode = row[2] || "";
        const ipAddress = row[3] || "";
        const day = String(row[6] || "01").padStart(2, "0");
        const month = String(row[7] || "01").padStart(2, "0");
        const year = row[8] || "2025";
        const time = row[9] || "00:00";
        const deviceType = (row[10] || "desktop") as 'mobile' | 'desktop' | 'tablet';
        
        // بناء ISO timestamp: YYYY-MM-DDTHH:mm:ssZ
        const timestamp = `${year}-${month}-${day}T${time}:00Z`;
        
        return {
          id: `REQ-${idx}`,
          propertyNumber,
          requestCode,
          timestamp,
          ipAddress,
          deviceType,
          dayOfWeek: row[4] || "",
          hourOfDay: parseInt(row[5] || "0", 10),
          createdAt: new Date().toISOString(),
        };
      });
    } catch (err) {
      console.error("getRequests error:", err);
      return [];
    }
  }

  async createRequest(request: InsertRequest, requestCountFromIP?: number): Promise<Request> {
    try {
      // الحصول على وقت الرياض (UTC+3)
      const utcNow = new Date();
      const now = new Date(utcNow.getTime() + (3 * 60 * 60 * 1000));
      
      const propertyName = (await this.getPropertyByNumber(request.propertyNumber))?.name || "";
      
      // استخدم العدد المُمرّر من IP (حسب نفس IP)
      // أو احسبه من الشيت إذا لم يُمرّ
      let requestCount = requestCountFromIP || 0;
      
      if (!requestCountFromIP) {
        const rows = await this.readSheet(SHEETS.REQUESTS);
        if (rows && rows.length > 1) {
          for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === request.propertyNumber) {
              requestCount++;
            }
          }
        }
        requestCount++;
      }
      
      // استخراج التاريخ والوقت بتوقيت الرياض
      const day = now.getUTCDate();
      const month = now.getUTCMonth() + 1;
      const year = now.getUTCFullYear();
      const hours = String(now.getUTCHours()).padStart(2, "0");
      const minutes = String(now.getUTCMinutes()).padStart(2, "0");
      const time = `${hours}:${minutes}`;

      // صف الشيت بالترتيب الصحيح
      // A: propertyNumber, B: propertyName, C: requestCode, D: ipAddress, E: dayOfWeek, F: hourOfDay, G: day, H: month, I: year, J: time, K: deviceType, L: requestCount
      const row = [
        request.propertyNumber,
        propertyName,
        request.requestCode,
        request.ipAddress,
        request.dayOfWeek,
        String(request.hourOfDay),
        String(day),
        String(month),
        String(year),
        time,
        request.deviceType || 'desktop',
        String(requestCount),
      ];

      await this.appendToSheet(SHEETS.REQUESTS, [row]);
      
      // تحديث الإحصائيات بتحديث صف واحد فقط (بدون إضافة صفوف مكررة)
      await this.updateAnalyticsRow();
      
      return {
        id: `REQ-${Date.now()}`,
        ...request,
        createdAt: utcNow.toISOString(),
      };
    } catch (err) {
      console.error("createRequest error:", err);
      throw err;
    }
  }

  // ================== تحديث الإحصائيات ==================
  async clearOldAnalyticsData() {
    try {
      const sheets = await this.getSheets();
      // مسح الطلبات القديمة
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.REQUESTS}!A2:K1000`,
      });
      // مسح الإحصائيات القديمة
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.ANALYTICS}!A2:F1000`,
      });
      console.log("🧹 Cleared old analytics data");
    } catch (err) {
      console.error("clearOldAnalyticsData error:", err);
    }
  }

  async getAnalyticsFromSheet() {
    try {
      const analyticsRows = await this.readSheet(SHEETS.ANALYTICS);
      if (!analyticsRows || analyticsRows.length === 0) return null;
      
      // قراءة آخر صف (أحدث إحصائيات)
      const lastRow = analyticsRows[analyticsRows.length - 1];
      
      return {
        visitors: parseInt(lastRow[0] || "0", 10),
        mobile: parseInt(lastRow[1] || "0", 10),
        desktop: parseInt(lastRow[2] || "0", 10),
        tablet: parseInt(lastRow[3] || "0", 10),
        cities: lastRow[4] || "لا توجد بيانات",
        lastUpdated: lastRow[5] || "لم يتم التحديث",
      };
    } catch (err) {
      console.error("getAnalyticsFromSheet error:", err);
      return null;
    }
  }

  // تحديث صف الإحصائيات الواحد (بدون إضافة صفوف مكررة)
  async updateAnalyticsRow() {
    try {
      const allRequestsRows = await this.readSheet(SHEETS.REQUESTS);
      const totalProps = await this.getProperties();

      // حساب الـ IPs الفريدة فقط
      const uniqueIPMap: Record<string, { ipAddress: string; deviceType: 'mobile' | 'desktop' | 'tablet'; propertyNumber: string }> = {};
      
      allRequestsRows.forEach(row => {
        const propertyNumber = row[0] || "";
        const ipAddress = row[3] || "";
        const deviceType = (row[10] as 'mobile' | 'desktop' | 'tablet') || 'desktop';
        
        if (!propertyNumber || !ipAddress) return;
        
        // استخدم IP كمفتاح - كل IP يُحسب مرة واحدة فقط
        const key = `${propertyNumber}:${ipAddress}`;
        if (!uniqueIPMap[key]) {
          uniqueIPMap[key] = { ipAddress, deviceType, propertyNumber };
        }
      });

      const uniqueRequests = Object.values(uniqueIPMap);
      
      // 1. إجمالي الزوار الفريدين (حسب IP)
      const visitors = uniqueRequests.length;

      // 2. توزيع الأجهزة الفريدة (كل IP يُحسب مرة واحدة)
      const devices = { mobile: 0, desktop: 0, tablet: 0 };
      uniqueRequests.forEach(r => {
        if (r.deviceType === 'mobile') devices.mobile++;
        else if (r.deviceType === 'tablet') devices.tablet++;
        else devices.desktop++;
      });

      // 3. توزيع المدن (حسب الـ IPs الفريدة)
      const cityCounts: Record<string, Set<string>> = {};
      uniqueRequests.forEach(r => {
        const prop = totalProps.find(p => p.propertyNumber === r.propertyNumber);
        const city = prop?.city || 'غير محدد';
        
        if (!cityCounts[city]) {
          cityCounts[city] = new Set();
        }
        cityCounts[city].add(r.ipAddress);
      });

      const cities = Object.entries(cityCounts)
        .sort((a, b) => b[1].size - a[1].size)
        .map(([name, ips]) => `${name}: ${ips.size}`)
        .join(" | ");

      // 4. آخر تحديث (بتوقيت الرياض +3)
      const utcNow = new Date();
      const riyadhTime = new Date(utcNow.getTime() + (3 * 60 * 60 * 1000));
      const lastUpdated = riyadhTime.toLocaleString('ar-SA');

      // تحديث صف واحد فقط (صف #2) بدلاً من إضافة صفوف جديدة
      const analyticsRow = [
        String(visitors),
        String(devices.mobile),
        String(devices.desktop),
        String(devices.tablet),
        cities || 'لا توجد بيانات',
        lastUpdated,
      ];

      const sheets = await this.getSheets();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.ANALYTICS}!A2:F2`,
        valueInputOption: 'RAW',
        requestBody: { values: [analyticsRow] },
      });

      console.log(`📊 Analytics (Unique IPs): ${visitors} visitors, Mobile: ${devices.mobile}, Desktop: ${devices.desktop}, Tablet: ${devices.tablet}`);
    } catch (err) {
      console.error("updateAnalyticsRow error:", err);
    }
  }

  async updateAnalytics() {
    // للتوافقية فقط - استدعاء updateAnalyticsRow
    return this.updateAnalyticsRow();
  }

  // ================== تنظيف وإصلاح الشيتات ==================
  async fixAndCleanSheets() {
    try {
      console.log("🔧 بدء تنظيف وإصلاح الشيتات...");
      const sheets = await this.getSheets();

      // 1️⃣ تحديث رؤوس جدول الطلبات بالرؤوس الصحيحة
      console.log("✏️ تحديث رؤوس جدول الطلبات...");
      const requestsHeaders = [
        ["رقم العقار", "اسم العقار", "كود الطلب", "عنوان IP", "يوم الأسبوع", "الساعة", "اليوم", "الشهر", "السنة", "الوقت", "نوع الجهاز"],
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.REQUESTS}!A1:K1`,
        valueInputOption: 'RAW',
        requestBody: { values: requestsHeaders },
      });
      console.log("✅ تم تحديث رؤوس جدول الطلبات");

      // 2️⃣ تحديث رؤوس جدول الإحصائيات بالرؤوس الصحيحة
      console.log("✏️ تحديث رؤوس جدول الإحصائيات...");
      const analyticsHeaders = [
        ["الزوار", "الأجهزة المحمولة", "أجهزة سطح المكتب", "الأجهزة اللوحية", "المدن", "آخر تحديث"],
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.ANALYTICS}!A1:F1`,
        valueInputOption: 'RAW',
        requestBody: { values: analyticsHeaders },
      });
      console.log("✅ تم تحديث رؤوس جدول الإحصائيات");

      // 3️⃣ مسح بيانات جدول الإحصائيات (ترك الرؤوس فقط)
      console.log("🗑️ مسح بيانات جدول الإحصائيات القديمة...");
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.ANALYTICS}!A2:F1000`,
      });
      console.log("✅ تم مسح بيانات الإحصائيات");

      // 4️⃣ إضافة صف إحصائيات فارغ في الصف 2 (جاهز للتحديث)
      console.log("📝 إضافة صف الإحصائيات الأول...");
      const utcNow2 = new Date();
      const riyadhTime2 = new Date(utcNow2.getTime() + (3 * 60 * 60 * 1000));
      const initialAnalytics = [
        ["0", "0", "0", "0", "لا توجد بيانات", riyadhTime2.toLocaleString('ar-SA')],
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEETS.ANALYTICS}!A2:F2`,
        valueInputOption: 'RAW',
        requestBody: { values: initialAnalytics },
      });
      console.log("✅ تم إضافة صف الإحصائيات");

      console.log("✨ تم إصلاح وتنظيف الشيتات بنجاح!");
      return { success: true, message: "✨ تم إصلاح وتنظيف الشيتات بنجاح!" };
    } catch (err) {
      console.error("❌ خطأ في إصلاح الشيتات:", err);
      throw err;
    }
  }





// ======================
// 📲 سجلات تنبيهات الواتساب
// ======================
async addWhatsAppLog(log: {
  id: string;
  type: string;
  message: string;
  phone: string;          // رقم المستلم (أنت كأدمن)
  status: string;
  response: string;
  createdAt: string;
  propertyNumber?: string;
  propertyName?: string;
  ownerPhone?: string;
}) {

  const row = [
    log.id,
    log.propertyNumber || "",
    log.propertyName || "",
    log.ownerPhone || "",
    log.type,
    log.message,
    log.status,
    log.response,
    log.createdAt,
  ];

  await this.appendToSheet(SHEETS.WHATSAPP, [row]);
}

async getWhatsAppLogs() {
  const rows = await this.readSheet(SHEETS.WHATSAPP);

  return rows.map((row, idx) => ({
    id: row[0] || `WA-${idx}`,
    propertyNumber: row[1] || "",
    propertyName: row[2] || "",
    ownerPhone: row[3] || "",
    type: row[4] || "",
    message: row[5] || "",
    status: row[6] || "",
    response: row[7] || "",
    createdAt: row[8] || "",
  }));
 }

  // ======================
  // 📌 سجل التحقق (Verification Logs)
  // ======================

  async addVerificationLogToSheet(log: {
    date: string;
    propertyNumber: string;
    action: string;
    reason: string;
    admin: string;
  }) {
    const row = [
      log.date,
      log.propertyNumber,
      log.action,
      log.reason,
      log.admin,
    ];

    await this.appendToSheet(SHEETS.VERIFICATION_LOGS, [row]);
  }

  async getVerificationLogsFromSheet() {
    const rows = await this.readSheet(SHEETS.VERIFICATION_LOGS);

    return rows.map((r) => ({
      date: r[0] || "",
      propertyNumber: r[1] || "",
      action: r[2] || "",
      reason: r[3] || "",
      admin: r[4] || "",
    }));
  }

  // ======================
  // ⚙️ إعدادات الإشعارات
  // ======================

  async getNotificationSettings(): Promise<NotificationSettings> {
    const rows = await this.readSheet(SHEETS.SETTINGS);
    const settingsRow = rows.find(r => r[0] === 'notification_settings');
    
    if (settingsRow && settingsRow[1]) {
      try {
        return JSON.parse(settingsRow[1]);
      } catch {
        console.error("Error parsing notification settings");
      }
    }
    
    return {
      allNotifications: true,
      newProperty: true,
      newSubscription: true,
      subscriptionRenewal: true,
      receiptUpload: true,
      propertyUpdate: true,
      newPayment: true,
      smartRequest: true,
      propertyVerification: true,
      subscriptionExpired: true,
    };
  }

  async saveNotificationSettings(settings: NotificationSettings): Promise<void> {
    const sheets = await this.getSheets();
    const rows = await this.readSheet(SHEETS.SETTINGS);
    const rowIndex = rows.findIndex(r => r[0] === 'notification_settings');
    
    const settingsData = {
      ...settings,
      updatedAt: new Date().toISOString(),
    };
    
    const row = ['notification_settings', JSON.stringify(settingsData), new Date().toISOString()];
    
    if (rowIndex !== -1) {
      await this.updateRow(SHEETS.SETTINGS, rowIndex + 2, row);
    } else {
      await this.appendToSheet(SHEETS.SETTINGS, [row]);
    }
  }

  // ======================
  // 💰 أرباح الشريك
  // ======================

  async getPartnerProfits(): Promise<PartnerProfit[]> {
    const rows = await this.readSheet(SHEETS.PARTNER_PROFITS);
    return rows.map((row, idx) => ({
      id: row[0] || `PP-${idx}`,
      monthYear: row[1] || "",
      activeSubscriptions: parseInt(row[2]) || 0,
      totalRevenue: parseFloat(row[3]) || 0,
      partnerShare: parseFloat(row[4]) || 0,
      partnerPercentage: parseFloat(row[5]) || 50,
      transferDate: row[6] || undefined,
      transferStatus: (row[7] as any) || "pending",
      notes: row[8] || undefined,
      createdAt: row[9] || undefined,
      updatedAt: row[10] || undefined,
    }));
  }

  async createPartnerProfit(profit: InsertPartnerProfit): Promise<PartnerProfit> {
    const id = `PP-${Date.now()}`;
    const newProfit: PartnerProfit = {
      id,
      ...profit,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newProfit.id,
      newProfit.monthYear,
      newProfit.activeSubscriptions.toString(),
      newProfit.totalRevenue.toString(),
      newProfit.partnerShare.toString(),
      newProfit.partnerPercentage.toString(),
      newProfit.transferDate || "",
      newProfit.transferStatus,
      newProfit.notes || "",
      newProfit.createdAt,
      newProfit.updatedAt || "",
    ];

    await this.appendToSheet(SHEETS.PARTNER_PROFITS, [row]);
    return newProfit;
  }

  async updatePartnerProfit(id: string, updates: Partial<PartnerProfit>): Promise<PartnerProfit | null> {
    const rows = await this.readSheet(SHEETS.PARTNER_PROFITS);
    const rowIndex = rows.findIndex(r => r[0] === id);
    
    if (rowIndex === -1) return null;

    const existingRow = rows[rowIndex];
    const updatedProfit: PartnerProfit = {
      id: existingRow[0],
      monthYear: updates.monthYear ?? existingRow[1],
      activeSubscriptions: updates.activeSubscriptions ?? (parseInt(existingRow[2]) || 0),
      totalRevenue: updates.totalRevenue ?? (parseFloat(existingRow[3]) || 0),
      partnerShare: updates.partnerShare ?? (parseFloat(existingRow[4]) || 0),
      partnerPercentage: updates.partnerPercentage ?? (parseFloat(existingRow[5]) || 50),
      transferDate: updates.transferDate ?? (existingRow[6] || undefined),
      transferStatus: updates.transferStatus ?? (existingRow[7] || "pending"),
      notes: updates.notes ?? (existingRow[8] || undefined),
      createdAt: existingRow[9],
      updatedAt: new Date().toISOString(),
    };

    const row = [
      updatedProfit.id,
      updatedProfit.monthYear,
      updatedProfit.activeSubscriptions.toString(),
      updatedProfit.totalRevenue.toString(),
      updatedProfit.partnerShare.toString(),
      updatedProfit.partnerPercentage.toString(),
      updatedProfit.transferDate || "",
      updatedProfit.transferStatus,
      updatedProfit.notes || "",
      updatedProfit.createdAt || "",
      updatedProfit.updatedAt,
    ];

    await this.updateRow(SHEETS.PARTNER_PROFITS, rowIndex + 2, row);
    return updatedProfit;
  }

  async calculateMonthlyProfits(): Promise<{
    monthYear: string;
    activeSubscriptions: number;
    totalRevenue: number;
    partnerShare: number;
    payments: any[];
  }> {
    const now = getNowInRiyadh();
    const monthYear = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    
    const payments = await this.getPayments();
    const startOfMonth = getStartOfMonthRiyadh(now);
    const endOfMonth = getEndOfMonthRiyadh(now);
    
    const monthlyPayments = payments.filter(p => {
      const paymentDate = new Date(p.createdAt || "");
      return paymentDate >= startOfMonth && 
             paymentDate <= endOfMonth && 
             p.status === "مكتمل";
    });
    
    const totalRevenue = monthlyPayments.reduce((sum, p) => sum + (p.finalAmount || 0), 0);
    const partnerShare = Math.round(totalRevenue * 0.5 * 100) / 100;
    
    return {
      monthYear,
      activeSubscriptions: monthlyPayments.length,
      totalRevenue,
      partnerShare,
      payments: monthlyPayments,
    };
  }

  async getProfitsSummary(): Promise<{
    currentMonth: {
      monthYear: string;
      totalRevenue: number;
      partnerShare: number;
      paymentsCount: number;
    };
    allTime: {
      totalRevenue: number;
      partnerShare: number;
      paymentsCount: number;
    };
    pendingPayments: number;
    recentPayments: any[];
  }> {
    const payments = await this.getPayments();
    const feeConfigs = await this.getFeeConfigs();
    const now = getNowInRiyadh();
    const startOfMonth = getStartOfMonthRiyadh(now);
    
    const completedPayments = payments.filter(p => 
      p.status === "مكتمل"
    );
    
    const currentMonthPayments = completedPayments.filter(p => {
      const paymentDate = new Date(p.createdAt || "");
      return paymentDate >= startOfMonth;
    });
    
    const pendingPayments = payments.filter(p => 
      p.status === "قيد المراجعة" || p.status === "معلق"
    ).length;
    
    // حساب الأرباح مع الرسوم الحقيقية من نظام FeeConfig
    const calculateNetProfit = (paymentsList: any[]) => {
      let totalRevenue = 0;
      let totalNetAfterFees = 0;
      
      for (const p of paymentsList) {
        const amount = p.finalAmount || 0;
        totalRevenue += amount;
        
        // إذا كان لدينا رسوم فعلية من Paymob، استخدمها
        if (p.totalFees !== undefined && p.totalFees > 0) {
          const netAmount = p.netAmount || (amount - p.totalFees);
          totalNetAfterFees += netAmount;
        } else {
          // حساب الرسوم من FeeConfig بناءً على طريقة الدفع
          const paymentMethod = (p.paymentMethod || "").toLowerCase();
          
          // البحث عن إعدادات الرسوم المناسبة
          let feeConfig = feeConfigs.find(fc => {
            const fcName = (fc.nameEn || "").toLowerCase();
            return (
              (paymentMethod.includes("mada") || paymentMethod.includes("مدى")) && fcName.includes("mada") ||
              paymentMethod.includes("stc") && fcName.includes("stc") ||
              (paymentMethod.includes("apple") || paymentMethod.includes("Apple Pay")) && fcName.includes("apple") ||
              (paymentMethod.includes("تحويل") || paymentMethod.includes("bank")) && fc.feePercentage === 0
            );
          });
          
          // افتراضي: Visa/MC محلي
          if (!feeConfig) {
            feeConfig = feeConfigs.find(fc => (fc.nameEn || "").toLowerCase().includes("visa") && fc.cardType === "local");
          }
          
          if (feeConfig) {
            const baseFee = (amount * feeConfig.feePercentage / 100) + feeConfig.fixedFee;
            const vatOnFee = baseFee * (feeConfig.vatPercentage / 100);
            const totalFees = baseFee + vatOnFee;
            const netAmount = amount - totalFees;
            totalNetAfterFees += netAmount;
          } else {
            // في حالة عدم وجود إعدادات، نفترض رسوم 0% (تحويل بنكي)
            totalNetAfterFees += amount;
          }
        }
      }
      
      // حصة الشريك 50% من الصافي
      const partnerShare = Math.round(totalNetAfterFees * 0.5 * 100) / 100;
      
      return { totalRevenue, partnerShare };
    };
    
    const currentMonthCalc = calculateNetProfit(currentMonthPayments);
    const allTimeCalc = calculateNetProfit(completedPayments);
    
    const recentPayments = payments
      .sort((a, b) => new Date(b.createdAt || "").getTime() - new Date(a.createdAt || "").getTime())
      .slice(0, 10);
    
    return {
      currentMonth: {
        monthYear: `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}`,
        totalRevenue: currentMonthCalc.totalRevenue,
        partnerShare: currentMonthCalc.partnerShare,
        paymentsCount: currentMonthPayments.length,
      },
      allTime: {
        totalRevenue: allTimeCalc.totalRevenue,
        partnerShare: allTimeCalc.partnerShare,
        paymentsCount: completedPayments.length,
      },
      pendingPayments,
      recentPayments,
    };
  }

  // ======================
  // 🏠🏠 اشتراكات العقارين
  // ======================

  async getMultiPropertySubscriptions(): Promise<MultiPropertySubscription[]> {
    const rows = await this.readSheet(SHEETS.MULTI_PROPERTY_SUBS);
    return rows.map((row, idx) => ({
      id: row[0] || `MPS-${idx}`,
      packageId: row[1] || "",
      propertyNumber1: row[2] || "",
      propertyNumber2: row[3] || "",
      startDate: row[4] || "",
      endDate: row[5] || "",
      status: (row[6] as any) || "معلق",
      paymentId: row[7] || undefined,
      createdAt: row[8] || undefined,
    }));
  }

  async createMultiPropertySubscription(sub: InsertMultiPropertySubscription): Promise<MultiPropertySubscription> {
    const id = `MPS-${Date.now()}`;
    const newSub: MultiPropertySubscription = {
      id,
      ...sub,
      createdAt: new Date().toISOString(),
    };

    const row = [
      newSub.id,
      newSub.packageId,
      newSub.propertyNumber1,
      newSub.propertyNumber2,
      newSub.startDate,
      newSub.endDate,
      newSub.status,
      newSub.paymentId || "",
      newSub.createdAt,
    ];

    await this.appendToSheet(SHEETS.MULTI_PROPERTY_SUBS, [row]);
    
    const pkg = await this.getPackageById(newSub.packageId);
    if (pkg) {
      await this.activatePropertySubscription(newSub.propertyNumber1, pkg, newSub.startDate, newSub.endDate);
      await this.activatePropertySubscription(newSub.propertyNumber2, pkg, newSub.startDate, newSub.endDate);
    }
    
    return newSub;
  }

  private async activatePropertySubscription(propertyNumber: string, pkg: Package, startDate: string, endDate: string) {
    const props = await this.readSheet(SHEETS.PROPERTIES);
    const propIndex = props.findIndex(r => r[0] === propertyNumber);
    
    if (propIndex !== -1) {
      const propRow = props[propIndex];
      propRow[15] = "مميز";
      propRow[16] = new Date().toISOString().split("T")[0];
      propRow[17] = startDate.split("T")[0];
      await this.updateRow(SHEETS.PROPERTIES, propIndex + 2, propRow);
      console.log(`✅ Activated subscription for property ${propertyNumber}`);
    }
  }

  // ======================
  // 💰 إعدادات الرسوم (Paymob Fees)
  // ======================

  async initializeFeeConfigs(): Promise<void> {
    try {
      const existingConfigs = await this.getFeeConfigs();
      if (existingConfigs.length === 0) {
        console.log("🔧 Initializing default fee configs...");
        for (const config of DEFAULT_FEE_CONFIGS) {
          await this.createFeeConfig(config);
        }
        console.log(`✅ Created ${DEFAULT_FEE_CONFIGS.length} default fee configs`);
      }
    } catch (err) {
      console.error("Error initializing fee configs:", err);
    }
  }

  async getFeeConfigs(): Promise<FeeConfig[]> {
    const rows = await this.readSheet(SHEETS.FEE_CONFIGS);
    return rows.map((row) => ({
      id: row[0] || "",
      name: row[1] || "",
      nameEn: row[2] || "",
      percentage: parseFloat(row[3]) || 0,
      fixedFee: parseFloat(row[4]) || 1,
      vatRate: parseFloat(row[5]) || 15,
      isActive: row[6] === "true",
      isLocal: row[7] === "true",
      updatedAt: row[8] || undefined,
    }));
  }

  async getFeeConfigById(id: string): Promise<FeeConfig | null> {
    const configs = await this.getFeeConfigs();
    return configs.find(c => c.id === id) || null;
  }

  async createFeeConfig(config: InsertFeeConfig | FeeConfig): Promise<FeeConfig> {
    const id = (config as any).id || `fee-${Date.now()}`;
    const newConfig: FeeConfig = {
      id,
      name: config.name,
      nameEn: config.nameEn,
      percentage: config.percentage,
      fixedFee: config.fixedFee ?? 1,
      vatRate: config.vatRate ?? 15,
      isActive: config.isActive ?? true,
      isLocal: config.isLocal ?? true,
      updatedAt: new Date().toISOString(),
    };

    const row = [
      newConfig.id,
      newConfig.name,
      newConfig.nameEn,
      newConfig.percentage.toString(),
      newConfig.fixedFee.toString(),
      newConfig.vatRate.toString(),
      newConfig.isActive.toString(),
      newConfig.isLocal.toString(),
      newConfig.updatedAt,
    ];

    await this.appendToSheet(SHEETS.FEE_CONFIGS, [row]);
    return newConfig;
  }

  async updateFeeConfig(id: string, updates: Partial<FeeConfig>): Promise<FeeConfig | null> {
    const rows = await this.readSheet(SHEETS.FEE_CONFIGS);
    const rowIndex = rows.findIndex(r => r[0] === id);
    
    if (rowIndex === -1) return null;

    const existingRow = rows[rowIndex];
    const updatedConfig: FeeConfig = {
      id: existingRow[0],
      name: updates.name ?? existingRow[1],
      nameEn: updates.nameEn ?? existingRow[2],
      percentage: updates.percentage ?? (parseFloat(existingRow[3]) || 0),
      fixedFee: updates.fixedFee ?? (parseFloat(existingRow[4]) || 1),
      vatRate: updates.vatRate ?? (parseFloat(existingRow[5]) || 15),
      isActive: updates.isActive ?? (existingRow[6] === "true"),
      isLocal: updates.isLocal ?? (existingRow[7] === "true"),
      updatedAt: new Date().toISOString(),
    };

    const row = [
      updatedConfig.id,
      updatedConfig.name,
      updatedConfig.nameEn,
      updatedConfig.percentage.toString(),
      updatedConfig.fixedFee.toString(),
      updatedConfig.vatRate.toString(),
      updatedConfig.isActive.toString(),
      updatedConfig.isLocal.toString(),
      updatedConfig.updatedAt,
    ];

    await this.updateRow(SHEETS.FEE_CONFIGS, rowIndex + 2, row);
    return updatedConfig;
  }

  async deleteFeeConfig(id: string): Promise<void> {
    const rows = await this.readSheet(SHEETS.FEE_CONFIGS);
    const rowIndex = rows.findIndex(r => r[0] === id);
    
    if (rowIndex === -1) {
      throw new Error("إعدادات الرسوم غير موجودة");
    }
    
    await this.deleteRow(SHEETS.FEE_CONFIGS, rowIndex + 2);
  }

  calculatePaymentFees(amount: number, paymentMethod?: string, cardType?: string): {
    feeAmount: number;
    vatAmount: number;
    totalFees: number;
    netAmount: number;
    feePercentage: number;
    fixedFee: number;
    feeConfigId: string;
    feeConfigName: string;
  } {
    let percentage = 2.7;
    let fixedFee = 1;
    let vatRate = 15;
    let feeConfigId = "fee-visa-local";
    let feeConfigName = "Visa/Mastercard محلي";

    const method = (paymentMethod || "").toLowerCase();
    const card = (cardType || "").toLowerCase();

    if (card.includes("mada") || method.includes("mada")) {
      percentage = 1.0;
      feeConfigId = "fee-mada";
      feeConfigName = "مدى";
    } else if (card.includes("stc") || method.includes("stc")) {
      percentage = 1.0;
      feeConfigId = "fee-stc";
      feeConfigName = "STC Pay";
    } else if (method.includes("apple") || card.includes("apple")) {
      percentage = 2.7;
      feeConfigId = "fee-applepay";
      feeConfigName = "Apple Pay";
    } else if (card.includes("international") || !card.includes("local")) {
      if (card.includes("visa") || card.includes("master")) {
        percentage = 3.7;
        feeConfigId = "fee-visa-intl";
        feeConfigName = "Visa/Mastercard دولي";
      }
    }

    const baseFee = (amount * percentage / 100) + fixedFee;
    const vatAmount = Math.round(baseFee * vatRate / 100 * 100) / 100;
    const feeAmount = Math.round(baseFee * 100) / 100;
    const totalFees = Math.round((feeAmount + vatAmount) * 100) / 100;
    const netAmount = Math.round((amount - totalFees) * 100) / 100;

    return {
      feeAmount,
      vatAmount,
      totalFees,
      netAmount,
      feePercentage: percentage,
      fixedFee,
      feeConfigId,
      feeConfigName,
    };
  }

  async calculatePaymentFeesFromConfigs(amount: number, paymentMethod?: string, cardType?: string): Promise<{
    feeAmount: number;
    vatAmount: number;
    totalFees: number;
    netAmount: number;
    feePercentage: number;
    fixedFee: number;
    feeConfigId: string;
    feeConfigName: string;
  }> {
    const configs = await this.getFeeConfigs();
    const method = (paymentMethod || "").toLowerCase();
    const card = (cardType || "").toLowerCase();

    let config = configs.find(c => c.isActive && (
      c.nameEn.toLowerCase().includes("mada") && (card.includes("mada") || method.includes("mada"))
    ));

    if (!config) {
      config = configs.find(c => c.isActive && (
        c.nameEn.toLowerCase().includes("stc") && (card.includes("stc") || method.includes("stc"))
      ));
    }

    if (!config) {
      config = configs.find(c => c.isActive && (
        c.nameEn.toLowerCase().includes("apple") && (method.includes("apple") || card.includes("apple"))
      ));
    }

    if (!config && (card.includes("visa") || card.includes("master") || method.includes("card"))) {
      const isIntl = card.includes("international") || !card.includes("local");
      config = configs.find(c => c.isActive && 
        c.nameEn.toLowerCase().includes("visa") &&
        (isIntl ? !c.isLocal : c.isLocal)
      );
    }

    if (!config) {
      config = configs.find(c => c.isActive && c.nameEn.toLowerCase().includes("visa") && c.isLocal);
    }

    if (!config) {
      return this.calculatePaymentFees(amount, paymentMethod, cardType);
    }

    const baseFee = (amount * config.percentage / 100) + config.fixedFee;
    const vatAmount = Math.round(baseFee * config.vatRate / 100 * 100) / 100;
    const feeAmount = Math.round(baseFee * 100) / 100;
    const totalFees = Math.round((feeAmount + vatAmount) * 100) / 100;
    const netAmount = Math.round((amount - totalFees) * 100) / 100;

    return {
      feeAmount,
      vatAmount,
      totalFees,
      netAmount,
      feePercentage: config.percentage,
      fixedFee: config.fixedFee,
      feeConfigId: config.id,
      feeConfigName: config.name,
    };
  }
  
}
export const googleSheetsService = new GoogleSheetsService();


