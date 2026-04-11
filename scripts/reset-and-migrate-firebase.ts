import 'dotenv/config';
import XLSX from 'xlsx';
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const EXCEL_PATH = '/home/iheb/Downloads/عقارات القصيم.xlsx';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseFacilities(raw: any): string[] {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  return str.split(/[,،]/).map(s => s.trim()).filter(Boolean);
}

function parseArabicDate(dateStr: any): string | null {
  if (!dateStr) return null;
  
  // If it's a number, treat as Excel serial date
  if (typeof dateStr === 'number') {
    // Excel serial date: days since 1900-01-01
    // Formula: date = new Date((serial - 25569) * 86400 * 1000)
    const ms = (dateStr - 25569) * 86400 * 1000;
    const date = new Date(ms);
    if (!isNaN(date.getTime()) && date.getFullYear() >= 1970) {
      return date.toISOString().split('T')[0];
    }
    return null;
  }
  
  if (dateStr instanceof Date) {
    if (dateStr.getFullYear() < 1970) return null;
    return dateStr.toISOString().split('T')[0];
  }
  const str = String(dateStr).trim();
  if (!str) return null;
  // Fix malformed formats like "2025-/09/21" -> "2025-09-21"
  const cleaned = str.replace(/-\//g, '-').replace(/\//g, '-');
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1970) {
    return parsed.toISOString().split('T')[0];
  }
  return null;
}

function parseBool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  const s = String(val || '').trim().toLowerCase();
  return s === 'true' || s === 'نعم' || s === '1';
}

function parseJsonArray(val: any): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(String(val));
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return parseFacilities(val);
}

async function deleteCollection(collectionName: string) {
  const ref = db.collection(collectionName);
  const snapshot = await ref.get();
  if (snapshot.empty) {
    console.log(`   ℹ️  ${collectionName} is already empty`);
    return;
  }
  const batchSize = 400;
  let deleted = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    docs.slice(i, i + batchSize).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += Math.min(batchSize, docs.length - i);
  }
  console.log(`   🗑️  Deleted ${deleted} docs from ${collectionName}`);
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapProperty(row: any) {
  return {
    propertyNumber: String(row['🏷 رقم العقار'] || '').trim(),
    name: String(row['🏡 اسم العقار'] || '').trim(),
    whatsappNumber: String(row['📞 رقم الجوال'] || '').trim(),
    location: row['📍 الموقع'] || '',
    city: row['📍 المنطقة'] || 'بريدة',
    direction: row['🧭 الاتجاه'] || 'شمال',
    type: row['🏠 النوع'] || 'قسم',
    facilities: parseFacilities(row['🔹 المرافق']),
    imagesFolderUrl: row['🔗 رابط الصور'] || '',
    imagesLink: row['🔗 رابط الصور'] || '',
    prices: {
      display: String(row['💰 سعر العرض'] || ''),
      weekday: String(row['💰 سعر وسط الأسبوع'] || ''),
      weekend: String(row['💰 سعر نهاية الأسبوع'] || ''),
      overnight: String(row['💰 سعر المبيت'] || ''),
      special: String(row['💰 سعر خاص (اختياري)'] || ''),
      holidays: String(row['💰 سعر الإجازات'] || ''),
    },
    subscriptionType: row['نوع الاشتراك'] || 'free',
    lastUpdate: parseArabicDate(row['🕒 آخر تحديث']),
    subscriptionDate: parseArabicDate(row['تاريخ الاشتراك']),
    pin: String(row['الرقم السري'] || ''),
    verificationStatus: row['حالة التحقق'] || 'approved',
    muteExpiryNotification: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapSubscription(row: any) {
  const propertyNumber = String(row['رقم العقار'] || '').trim();
  const packageId = row['نوع الباقة'] || row['نوع الاشتراك'] || 'pkg-free';
  return {
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    packageId,
    startDate: parseArabicDate(row['تاريخ البداية']) || null,
    endDate: parseArabicDate(row['تاريخ الانتهاء']) || null,
    status: row['رابط الإيصال'] ? 'نشط' : 'منتهي',
    receiptUrl: row['رابط الإيصال'] || '',
    muteExpiryFlag: parseBool(row['علم انتهاء الاشتراك']),
    receiptNotificationFlag: parseBool(row['علم إشعار الإيصال']),
    lastCycle: row['آخر دورة'] || '',
    secondPropertyNumber: row['رقم العقار الثاني'] || '',
    createdAt: new Date().toISOString(),
  };
}

function mapPayment(row: any) {
  return {
    id: String(row['معرف الدفع'] || '').trim(),
    propertyNumber: String(row['رقم العقار'] || '').trim(),
    packageId: row['الباقة'] || '',
    amount: Number(row['السعر الأصلي']) || 0,
    discountCode: row['كود الخصم'] || '',
    discountAmount: Number(row['قيمة الخصم']) || 0,
    finalAmount: Number(row['السعر النهائي']) || 0,
    paymobOrderId: row['معرف Paymob'] || '',
    status: row['الحالة'] || 'معلق',
    paymentMethod: row['طريقة الدفع'] || 'بطاقة',
    receiptUrl: row['رابط الإيصال'] || '',
    createdAt: parseArabicDate(row['تاريخ الإنشاء']) || new Date().toISOString(),
    completedAt: parseArabicDate(row['تاريخ الإكمال']) || '',
    action: row['نوع الإجراء'] || '',
    pendingStartDate: parseArabicDate(row['تاريخ البدء المعلق']) || '',
    pendingEndDate: parseArabicDate(row['تاريخ الانتهاء المعلق']) || '',
    pendingSubscriptionType: row['نوع الاشتراك المعلق'] || '',
    pendingPrice: Number(row['السعر المعلق']) || 0,
    transactionId: row['معرف العملية'] || '',
    feeAmount: Number(row['مجموع الرسوم']) || 0,
    vatAmount: Number(row['ضريبة القيمة المضافة']) || 0,
    totalFees: Number(row['إجمالي الرسوم']) || 0,
    netAmount: Number(row['المبلغ الصافي']) || 0,
    merchantFees: Number(row['رسوم التاجر']) || 0,
    acqFees: Number(row['رسوم البنك']) || 0,
    secondPropertyNumber: row['رقم العقار الثاني'] || '',
  };
}

function mapDiscountCode(row: any) {
  return {
    code: String(row['الكود'] || '').trim(),
    type: row['النوع'] === 'نسبة' ? 'نسبة' : 'قيمة ثابتة',
    value: Number(row['القيمة']) || 0,
    expiryDate: parseArabicDate(row['تاريخ الانتهاء']),
    isActive: parseBool(row['نشط']),
    usageCount: Number(row['عدد الاستخدامات']) || 0,
    createdAt: parseArabicDate(row['تاريخ الإنشاء']) || new Date().toISOString(),
  };
}

function mapOwner(row: any) {
  const propertyNumber = String(row['رقم العقار'] || '').trim();
  return {
    ownerId: propertyNumber,
    phone: String(row['رقم الجوال'] || '').trim(),
    password: String(row['الرقم السري الحالي'] || '').trim(),
    resetCode: '',
    resetExpire: '',
    lastReset: '',
  };
}

function mapPackage(row: any) {
  return {
    id: String(row['معرف الباقة'] || '').trim(),
    name: row['اسم الباقة'] || '',
    duration: Number(row['المدة (أيام)']) || 30,
    durationDays: Number(row['المدة (أيام)']) || 30,
    price: Number(row['السعر']) || 0,
    type: row['النوع'] || 'عادي',
    features: parseJsonArray(row['المميزات']),
    isActive: parseBool(row['حالة التفعيل']),
    createdAt: row['تاريخ الإنشاء'] || new Date().toISOString(),
  };
}

function mapFeeConfig(row: any) {
  // Sheet has no header row — columns positional:
  // [0]=id, [1]=nameAr, [2]=nameEn, [3]=percentage, [4]=fixedFee, [5]=vatRate, [6]=isActive, [7]=isLocal, [8]=updatedAt
  return {
    id: String(row[0] || '').trim(),
    name: row[1] || '',
    nameEn: row[2] || '',
    percentage: Number(row[3]) || 0,
    fixedFee: Number(row[4]) || 1,
    vatRate: Number(row[5]) || 15,
    isActive: parseBool(row[6]),
    isLocal: parseBool(row[7]),
    updatedAt: row[8] || new Date().toISOString(),
  };
}

function mapFeatureFlag(row: any) {
  return {
    id: String(row['المعرف'] || '').trim(),
    name: row['الاسم'] || '',
    key: row['المفتاح'] || '',
    description: row['الوصف'] || '',
    isEnabled: parseBool(row['مفعل']),
    updatedAt: row['آخر تحديث'] || new Date().toISOString(),
  };
}

function mapBankAccount(row: any) {
  return {
    id: String(row['المعرف'] || '').trim(),
    bankName: row['اسم البنك'] || '',
    beneficiaryName: row['اسم المستفيد'] || '',
    iban: row['الآيبان'] || '',
    accountNumber: row['رقم الحساب'] || '',
    isActive: parseBool(row['نشط']),
    isDefault: parseBool(row['افتراضي']),
    createdAt: row['تاريخ الإنشاء'] || new Date().toISOString(),
  };
}

function mapAddonPackage(row: any) {
  return {
    id: String(row['المعرف'] || '').trim(),
    name: row['الاسم'] || '',
    description: row['الوصف'] || '',
    price: Number(row['السعر']) || 0,
    duration: Number(row['المدة']) || 30,
    isActive: parseBool(row['حالة التفعيل']),
    category: row['الفئة'] || '',
    createdAt: parseArabicDate(row['تاريخ الإنشاء']) || new Date().toISOString(),
  };
}

function mapPropertyAddon(row: any) {
  return {
    id: String(row['المعرف'] || '').trim(),
    propertyNumber: String(row['رقم العقار'] || '').trim(),
    addOnPackageId: row['معرف الباقة'] || '',
    status: row['الحالة'] || 'active',
    startDate: parseArabicDate(row['تاريخ البدء']) || '',
    endDate: parseArabicDate(row['تاريخ الانتهاء']) || '',
    paymentId: row['معرف الدفع'] || '',
    createdAt: parseArabicDate(row['تاريخ الإنشاء']) || new Date().toISOString(),
    createdBy: row['جهة الإنشاء'] || '',
  };
}

function mapAddonLog(row: any) {
  return {
    id: String(row['المعرف'] || '').trim(),
    propertyNumber: String(row['رقم العقار'] || '').trim(),
    addOnPackageId: row['معرف الباقة'] || '',
    action: row['الإجراء'] || '',
    timestamp: parseArabicDate(row['الطابع الزمني']) || new Date().toISOString(),
    notes: row['ملاحظات'] || '',
  };
}

function mapExpense(row: any) {
  return {
    id: String(row['المعرف'] || '').trim(),
    title: row['العنوان'] || '',
    amount: Number(row['المبلغ']) || 0,
    category: row['التصنيف'] || '',
    description: row['الوصف'] || '',
    date: parseArabicDate(row['التاريخ']) || '',
    createdAt: parseArabicDate(row['تاريخ الإنشاء']) || new Date().toISOString(),
  };
}

// ─── Delete Phase ─────────────────────────────────────────────────────────────

async function deleteAll() {
  console.log('\n🗑️  Deleting existing data...');
  const collections = [
    'properties', 'subscriptions', 'payments', 'packages', 'discounts',
    'owners', 'fee_configs', 'feature_flags', 'bank_accounts', 'requests',
    'verification_logs', 'whatsapp_notifications', 'suggestions', 'ocr_results',
    'addon_packages', 'property_addons', 'addon_logs', 'expenses',
  ];
  for (const col of collections) {
    await deleteCollection(col);
  }
  console.log('   ✅ All collections cleared');
}

// ─── Migrate Phase ─────────────────────────────────────────────────────────────

async function migrateProperties() {
  console.log('\n📦 Migrating properties...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('بيانات') || n.includes('عقار'));
  if (!sheetName) { console.log('❌ Properties sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const propertyNumber = String(row['🏷 رقم العقار'] || '').trim();
    if (!propertyNumber) { skipped++; continue; }
    await db.collection('properties').doc(propertyNumber).set(mapProperty(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} properties, skipped ${skipped} (no ID)`);
}

async function migrateSubscriptions() {
  console.log('\n📦 Migrating subscriptions...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'الاشتراكات');
  if (!sheetName) { console.log('❌ Subscriptions sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const propertyNumber = String(row['رقم العقار'] || '').trim();
    if (!propertyNumber) { skipped++; continue; }
    const sub = mapSubscription(row);
    await db.collection('subscriptions').doc(sub.id).set(sub);
    imported++;
  }
  console.log(`   ✅ Imported ${imported} subscriptions, skipped ${skipped} (no ID)`);
}

async function migratePayments() {
  console.log('\n📦 Migrating payments...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'المدفوعات');
  if (!sheetName) { console.log('❌ Payments sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['معرف الدفع'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('payments').doc(id).set(mapPayment(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} payments, skipped ${skipped} (no ID)`);
}

async function migrateDiscountCodes() {
  console.log('\n📦 Migrating discount codes...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('خصم'));
  if (!sheetName) { console.log('❌ Discount codes sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const code = String(row['الكود'] || '').trim();
    if (!code) { skipped++; continue; }
    await db.collection('discounts').doc(code).set(mapDiscountCode(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} discount codes, skipped ${skipped} (no ID)`);
}

async function migrateOwners() {
  console.log('\n📦 Migrating owners...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('ملاك'));
  if (!sheetName) { console.log('❌ Owners sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const propertyNumber = String(row['رقم العقار'] || '').trim();
    if (!propertyNumber) { skipped++; continue; }
    await db.collection('owners').doc(propertyNumber).set(mapOwner(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} owners, skipped ${skipped} (no ID)`);
}

async function migratePackages() {
  console.log('\n📦 Migrating packages from Excel (الباقات)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'الباقات');
  if (!sheetName) { console.log('❌ Packages sheet not found'); return; }
  // Sheet has an empty first row then headers on row 2 — use header: 1 to get raw arrays
  const rawData: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  // Find header row index
  const headerRowIdx = rawData.findIndex(r => r.some(c => c && String(c).includes('معرف الباقة')));
  if (headerRowIdx === -1) { console.log('❌ Could not find header row in packages sheet'); return; }
  const headers = rawData[headerRowIdx];
  const dataRows = rawData.slice(headerRowIdx + 1).filter(r => r.some(c => c != null && c !== ''));
  // Convert to keyed objects
  const data = dataRows.map(r => {
    const obj: any = {};
    headers.forEach((h: any, i: number) => { if (h) obj[h] = r[i]; });
    return obj;
  });
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['معرف الباقة'] || '').trim();
    if (!id) { skipped++; continue; }
    const pkg = mapPackage(row);
    // Preserve extra fields that some packages have (propertyCount, maxProperties)
    const extra: any = {};
    if (row['عدد العقارات'] != null) extra.propertyCount = Number(row['عدد العقارات']);
    if (row['الحد الأقصى للعقارات'] != null) extra.maxProperties = Number(row['الحد الأقصى للعقارات']);
    await db.collection('packages').doc(id).set({ ...pkg, ...extra });
    imported++;
  }
  console.log(`   ✅ Imported ${imported} packages, skipped ${skipped} (no ID)`);
}

async function migrateFeeConfigs() {
  console.log('\n📦 Migrating fee configs from Excel (إعدادات الرسوم)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'إعدادات الرسوم');
  if (!sheetName) { console.log('❌ Fee configs sheet not found'); return; }
  // Sheet has no header row — use raw array mode
  const rawData: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  const dataRows = rawData.filter(r => r[0] && String(r[0]).startsWith('fee-'));
  console.log(`   Found ${dataRows.length} rows`);
  let imported = 0;
  for (const row of dataRows) {
    const fee = mapFeeConfig(row);
    if (!fee.id) continue;
    await db.collection('fee_configs').doc(fee.id).set(fee);
    imported++;
  }
  console.log(`   ✅ Imported ${imported} fee configs`);
}

async function migrateFeatureFlags() {
  console.log('\n📦 Migrating feature flags from Excel (أعلام الميزات)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'أعلام الميزات');
  if (!sheetName) { console.log('❌ Feature flags sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['المعرف'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('feature_flags').doc(id).set(mapFeatureFlag(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} feature flags, skipped ${skipped} (no ID)`);
}

async function migrateBankAccounts() {
  console.log('\n📦 Migrating bank accounts from Excel (الحسابات البنكية)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'الحسابات البنكية');
  if (!sheetName) {
    console.log('❌ Bank accounts sheet not found — creating default');
    const defaultAccount = {
      id: 'BANK-default',
      bankName: 'بنك الراجحي',
      beneficiaryName: 'مؤسسة موضي بنت عبدالعزيز بن مح',
      iban: 'SA3400000100060861372330',
      accountNumber: '340000010006086137233',
      isActive: true,
      isDefault: true,
      createdAt: new Date().toISOString(),
    };
    await db.collection('bank_accounts').doc(defaultAccount.id).set(defaultAccount);
    console.log('   ✅ Created default bank account');
    return;
  }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['المعرف'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('bank_accounts').doc(id).set(mapBankAccount(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} bank accounts, skipped ${skipped} (no ID)`);
}

async function migrateRequests() {
  console.log('\n📦 Migrating requests (الطلبات)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'الطلبات');
  if (!sheetName) { console.log('❌ Requests sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0;
  for (const row of data) {
    const propertyNumber = String(row['رقم العقار'] || '').trim();
    if (!propertyNumber) continue;
    const id = `REQ-${propertyNumber}-${imported}`;
    const day   = row['اليوم_1'] || row['اليوم'] || '';
    const month = row['الشهر'] || '';
    const year  = row['السنة'] || '';
    const time  = row['الوقت'] || row['الساعة'] || '';
    const timestamp = (year && month && day)
      ? new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${time || '00:00:00'}`).toISOString()
      : new Date().toISOString();
    const request = {
      id,
      propertyNumber,
      propertyName: row['اسم العقار'] || '',
      requestCode: row['كود الطلب'] || '',
      ip: row['IP'] || '',
      timestamp,
      device: row['الجهاز'] || '',
      requestCount: Number(row['عدد الطلبات']) || 1,
    };
    await db.collection('requests').doc(id).set(request);
    imported++;
  }
  console.log(`   ✅ Imported ${imported} requests`);
}

async function migrateVerificationLogs() {
  console.log('\n📦 Migrating verification logs (سجل التحقق)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('سجل التحقق'));
  if (!sheetName) { console.log('❌ Verification logs sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0;
  for (const row of data) {
    const propertyNumber = String(row['رقم العقار'] || '').trim();
    if (!propertyNumber) continue;
    await db.collection('verification_logs').add({
      propertyNumber,
      action: row['الإجراء'] || '',
      reason: row['السبب'] || '',
      admin: row['الأدمن'] || '',
      date: parseArabicDate(row['التاريخ']) || new Date().toISOString(),
    });
    imported++;
  }
  console.log(`   ✅ Imported ${imported} verification logs`);
}

async function migrateWhatsappNotifications() {
  console.log('\n📦 Migrating WhatsApp notifications (تنبيهات الواتساب)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('تنبيهات') || n.includes('واتساب'));
  if (!sheetName) { console.log('❌ WhatsApp notifications sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['المعرف'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('whatsapp_notifications').doc(id).set({
      id,
      propertyNumber: String(row['رقم العقار'] || '').trim(),
      propertyName: row['اسم العقار'] || '',
      ownerPhone: row['رقم المالك'] || '',
      type: row['نوع الإشعار'] || '',
      message: row['الرسالة'] || '',
      status: row['الحالة'] || '',
      apiResponse: row['رد API'] || '',
      createdAt: parseArabicDate(row['التاريخ']) || new Date().toISOString(),
    });
    imported++;
  }
  console.log(`   ✅ Imported ${imported} WhatsApp notifications, skipped ${skipped} (no ID)`);
}

async function migrateOcrResults() {
  console.log('\n📦 Migrating OCR results (نتائج OCR)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('OCR'));
  if (!sheetName) { console.log('❌ OCR results sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const paymentId = String(row['معرف الدفع'] || '').trim();
    if (!paymentId) { skipped++; continue; }
    await db.collection('ocr_results').doc(paymentId).set({
      paymentId,
      extractedAmount: row['المبلغ المستخرج'] || '',
      extractedDate: row['التاريخ المستخرج'] || '',
      extractedIban: row['الآيبان المستخرج'] || '',
      extractedReference: row['المرجع المستخرج'] || '',
      confidence: Number(row['نسبة الثقة']) || 0,
      fullText: row['النص الكامل'] || '',
      createdAt: parseArabicDate(row['تاريخ الإنشاء']) || new Date().toISOString(),
    });
    imported++;
  }
  console.log(`   ✅ Imported ${imported} OCR results, skipped ${skipped} (no ID)`);
}

async function migrateAddonPackages() {
  console.log('\n📦 Migrating addon packages (باقات الإضافات)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'باقات الإضافات');
  if (!sheetName) { console.log('❌ Addon packages sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['المعرف'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('addon_packages').doc(id).set(mapAddonPackage(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} addon packages, skipped ${skipped} (no ID)`);
}

async function migratePropertyAddons() {
  console.log('\n📦 Migrating property addons (إضافات العقارات)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'إضافات العقارات');
  if (!sheetName) { console.log('❌ Property addons sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['المعرف'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('property_addons').doc(id).set(mapPropertyAddon(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} property addons, skipped ${skipped} (no ID)`);
}

async function migrateAddonLogs() {
  console.log('\n📦 Migrating addon logs (سجل الإضافات)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'سجل الإضافات');
  if (!sheetName) { console.log('❌ Addon logs sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['المعرف'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('addon_logs').doc(id).set(mapAddonLog(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} addon logs, skipped ${skipped} (no ID)`);
}

async function migrateExpenses() {
  console.log('\n📦 Migrating expenses (التكاليف)...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n === 'التكاليف');
  if (!sheetName) { console.log('❌ Expenses sheet not found'); return; }
  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);
  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['المعرف'] || '').trim();
    if (!id) { skipped++; continue; }
    await db.collection('expenses').doc(id).set(mapExpense(row));
    imported++;
  }
  console.log(`   ✅ Imported ${imported} expenses, skipped ${skipped} (no ID)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting reset & migration to Firebase....');
  console.log('   Project:', serviceAccount.project_id);
  try {
    await deleteAll();
    await migrateProperties();
    await migrateSubscriptions();
    await migratePayments();         // PAY-ADDON-* rows are skipped automatically
    await migrateDiscountCodes();
    await migrateOwners();
    await migratePackages();         // read from Excel الباقات sheet
    await migrateFeeConfigs();       // read from Excel إعدادات الرسوم sheet
    await migrateFeatureFlags();     // read from Excel أعلام الميزات sheet
    await migrateBankAccounts();     // read from Excel الحسابات البنكية sheet
    await migrateRequests();
    await migrateVerificationLogs();
    await migrateWhatsappNotifications();
    await migrateOcrResults();
    await migrateAddonPackages();
    await migratePropertyAddons();
    await migrateAddonLogs();
    await migrateExpenses();
    console.log('\n✅ Reset & migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
  process.exit(0);
}

main();