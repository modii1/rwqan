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
  // Split on Arabic comma (،) or Latin comma (,)
  return str.split(/[,،]/).map(s => s.trim()).filter(Boolean);
}

function parseArabicDate(dateStr: any): string | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr.toISOString().split('T')[0];
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return null;
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
    verificationStatus: 'approved',
    muteExpiryNotification: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapSubscription(row: any) {
  const propertyNumber = String(row['رقم العقار'] || '').trim();
  return {
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    packageId: row['نوع الاشتراك'] || 'pkg-free',
    startDate: parseArabicDate(row['تاريخ البداية']) || new Date().toISOString().split('T')[0],
    endDate: parseArabicDate(row['تاريخ الانتهاء']) || new Date().toISOString().split('T')[0],
    status: row['رابط الإيصال'] ? 'نشط' : 'منتهي',
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
    createdAt: new Date().toISOString(),
  };
}

function mapDiscountCode(row: any) {
  return {
    code: String(row['الكود'] || '').trim(),
    type: row['النوع'] === 'نسبة' ? 'نسبة' : 'قيمة ثابتة',
    value: Number(row['القيمة']) || 0,
    expiryDate: parseArabicDate(row['تاريخ الانتهاء']),
    isActive: row['نشط'] === true || row['نشط'] === 'نشط',
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

// ─── Delete Phase ─────────────────────────────────────────────────────────────

async function deleteAll() {
  console.log('\n🗑️  Deleting existing data...');
  await deleteCollection('properties');
  await deleteCollection('subscriptions');
  await deleteCollection('payments');
  await deleteCollection('packages');
  await deleteCollection('discounts');
  await deleteCollection('owners');
  await deleteCollection('fee_configs');
  await deleteCollection('feature_flags');
  console.log('   ✅ All collections cleared');
}

// ─── Migrate Phase ─────────────────────────────────────────────────────────────

async function migrateProperties() {
  console.log('\n📦 Migrating properties...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheet = wb.SheetNames.find(n => n.includes('بيانات') || n.includes('عقار'));
  if (!sheet) { console.log('❌ Properties sheet not found'); return; }

  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
  console.log(`   Found ${data.length} rows`);

  let imported = 0, skipped = 0;
  for (const row of data) {
    const propertyNumber = String(row['🏷 رقم العقار'] || '').trim();
    if (!propertyNumber) { skipped++; continue; }
    const property = mapProperty(row);
    await db.collection('properties').doc(propertyNumber).set(property);
    imported++;
  }
  console.log(`   ✅ Imported ${imported} properties, skipped ${skipped} (no ID)`);
}

async function migrateSubscriptions() {
  console.log('\n📦 Migrating subscriptions...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('اشتراك'));
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
  const sheetName = wb.SheetNames.find(n => n.includes('مدفوع'));
  if (!sheetName) { console.log('❌ Payments sheet not found'); return; }

  const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} rows`);

  let imported = 0, skipped = 0;
  for (const row of data) {
    const id = String(row['معرف الدفع'] || '').trim();
    if (!id) { skipped++; continue; }
    const payment = mapPayment(row);
    await db.collection('payments').doc(id).set(payment);
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
    const discount = mapDiscountCode(row);
    await db.collection('discounts').doc(code).set(discount);
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
    const owner = mapOwner(row);
    await db.collection('owners').doc(propertyNumber).set(owner);
    imported++;
  }
  console.log(`   ✅ Imported ${imported} owners, skipped ${skipped} (no ID)`);
}

async function migratePackages() {
  console.log('\n📦 Creating packages...');

  const packages = [
    {
      id: 'pkg-month-2properties',
      name: 'باقة النخبة - عقارين',
      duration: 30,
      price: 50,
      type: 'مميز',
      features: [
        'تشمل مزايا الباقة الذهبية',
        'عرض مميز بتصميم ذهبي',
        'شارة مميز',
        'أولوية في نتائج البحث',
        'صالح لعقارين',
        'تفاصيل كاملة للعقار',
        'رقم الجوال ظاهر',
      ],
      isActive: true,
      createdAt: '2025-11-17T21:37:41.465Z',
      propertyCount: 2,
    },
    {
      id: 'pkg-month',
      name: 'الباقة الذهبية',
      duration: 30,
      price: 40,
      type: 'مميز',
      features: [
        'عرض مميز بتصميم ذهبي ',
        'تصميم اضافي للعقار',
        'شارة مميز',
        'أولوية في نتائج البحث',
        'تفاصيل كاملة للعقار',
        'رقم الجوال ظاهر',
        'اعلان بقروبات الواتس (كل أيام الاسبوع)',
        'اعلان بانستقرام (ستوري)',
      ],
      isActive: true,
      createdAt: '2025-11-17T21:37:41.465Z',
      propertyCount: 1,
    },
    {
      id: 'pkg-month1',
      name: 'الباقة الفضية',
      duration: 30,
      price: 35,
      type: 'مميز',
      features: [
        'عرض مميز بتصميم ذهبي',
        'تصميم إضافي للعقار',
        'شارة مميز',
        'أولوية في نتائج البحث',
        'تفاصيل كاملة للعقار',
        'رقم الجوال ظاهر',
        'إعلان إنستقرام (ستوري)',
        'الإعلان في قروبات الواتساب ليوم واحد فقط (الثلاثاء)',
      ],
      isActive: true,
      createdAt: '2025-11-17T21:37:41.465Z',
      propertyCount: 1,
    },
    {
      id: 'pkg-camps',
      name: 'باقة المخيمات',
      duration: 30,
      price: 20,
      type: 'مميز',
      features: [
        'عرض مميز بتصميم ذهبي',
        'شارة مميز',
        'أولوية في نتائج البحث',
        'باقة خاصة للمخيمات',
        'تفاصيل كاملة للعقار',
        'رقم الجوال ظاهر',
      ],
      isActive: true,
      createdAt: '2025-11-17T21:37:41.465Z',
      propertyCount: 1,
    },
    {
      id: 'pkg-free',
      name: 'الباقة المجانية',
      duration: 30,
      price: 0,
      type: 'عادي',
      features: [
        'نسبة 10% عند إتمام الحجز من العميل ',
        'بدون تفاصيل العقار',
        'فقط رقم جوال',
        'إعلان بقروب يوم الثلاثاء فقط',
        'بدون تصميم خاص',
        'بدون شارة مميز',
      ],
      isActive: true,
      createdAt: '2025-11-17T21:37:41.465Z',
      propertyCount: 1,
    },
  ];

  for (const pkg of packages) {
    await db.collection('packages').doc(pkg.id).set(pkg);
  }
  console.log(`   ✅ Created ${packages.length} packages`);
}

async function migrateFeeConfigs() {
  console.log('\n📦 Creating fee configs...');

  const fees = [
    { id: 'fee-visa-local', name: 'Visa/Mastercard محلي', nameEn: 'Visa/Mastercard Local', percentage: 2.7, fixedFee: 1, vatRate: 15, isActive: true, isLocal: true },
    { id: 'fee-visa-intl', name: 'Visa/Mastercard دولي', nameEn: 'Visa/Mastercard International', percentage: 3.7, fixedFee: 1, vatRate: 15, isActive: true, isLocal: false },
    { id: 'fee-mada', name: 'مدى', nameEn: 'Mada', percentage: 1.0, fixedFee: 1, vatRate: 15, isActive: true, isLocal: true },
    { id: 'fee-applepay', name: 'Apple Pay', nameEn: 'Apple Pay', percentage: 2.7, fixedFee: 1, vatRate: 15, isActive: true, isLocal: true },
  ];

  for (const fee of fees) {
    await db.collection('fee_configs').doc(fee.id).set(fee);
  }
  console.log(`   ✅ Created ${fees.length} fee configs`);
}

async function migrateFeatureFlags() {
  console.log('\n📦 Creating feature flags...');

  const flags = [
    { id: 'flag-bank-accounts-ui', name: 'واجهة الحسابات البنكية', key: 'FEATURE_BANK_ACCOUNTS_UI', description: 'إظهار واجهة إدارة الحسابات البنكية', isEnabled: true },
    { id: 'flag-bank-receipt-required', name: 'إلزامية رفع الإيصال', key: 'FEATURE_BANK_RECEIPT_REQUIRED', description: 'إجبار المستخدم على رفع إيصال التحويل', isEnabled: false },
    { id: 'flag-ocr-enabled', name: 'التعرف على الإيصالات (OCR)', key: 'FEATURE_OCR_ENABLED', description: 'استخراج البيانات تلقائياً من صور الإيصالات', isEnabled: false },
    { id: 'flag-timeouts', name: 'المهلات الزمنية', key: 'FEATURE_TIMEOUTS', description: 'إلغاء الدفعات المعلقة تلقائياً', isEnabled: true },
  ];

  for (const flag of flags) {
    await db.collection('feature_flags').doc(flag.id).set(flag);
  }
  console.log(`   ✅ Created ${flags.length} feature flags`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting reset & migration to Firebase...');
  console.log('   Project:', serviceAccount.project_id);

  try {
    await deleteAll();

    await migrateProperties();
    await migrateSubscriptions();
    await migratePayments();
    await migrateDiscountCodes();
    await migrateOwners();
    await migratePackages();
    await migrateFeeConfigs();
    await migrateFeatureFlags();

    console.log('\n✅ Reset & migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }

  process.exit(0);
}

main();
