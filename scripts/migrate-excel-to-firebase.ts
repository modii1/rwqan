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

function parseArabicDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr.toISOString().split('T')[0];
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return null;
}

function mapProperty(row) {
  return {
    propertyNumber: String(row['🏷 رقم العقار'] || '').trim(),
    name: String(row['🏡 اسم العقار'] || '').trim(),
    whatsappNumber: String(row['📞 رقم الجوال'] || '').trim(),
    location: row['📍 الموقع'] || '',
    city: row['📍 المنطقة'] || 'بريدة',
    direction: row['🧭 الاتجاه'] || 'شمال',
    type: row['🏠 النوع'] || 'قسم',
    facilities: [],
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

function mapSubscription(row) {
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

function mapPayment(row) {
  return {
    id: String(row['معرف الدفع'] || `PAY-${Date.now()}`).trim(),
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

function mapPackage(row) {
  return {
    id: String(row['معرف الباقة'] || `pkg-${Date.now()}`).trim(),
    name: row['اسم الباقة'] || '',
    duration: Number(row['المدة (أيام)']) || 30,
    price: Number(row['السعر']) || 0,
    type: row['النوع'] || 'عادي',
    features: String(row['المميزات'] || '').split(',').map(f => f.trim()).filter(Boolean),
    isActive: row['حالة التفعيل'] === 'مفعل' || row['حالة التفعيل'] === true,
    createdAt: parseArabicDate(row['تاريخ الإنشاء']) || new Date().toISOString(),
  };
}

function mapDiscountCode(row) {
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

function mapRequest(row) {
  const year = parseInt(row['السنة']) || 2026;
  const month = parseInt(row['الشهر']) || 1;
  const day = parseInt(row['اليوم_1']) || parseInt(row['اليوم']) || 1;
  const hour = parseInt(row['الساعة']) || 12;
  
  const validDate = !isNaN(year) && !isNaN(month) && !isNaN(day);
  
  return {
    id: `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    propertyNumber: String(row['رقم العقار'] || '').trim(),
    requestCode: String(row['كود الطلب'] || '').trim(),
    timestamp: validDate ? new Date(year, month - 1, day, hour).toISOString() : new Date().toISOString(),
    ipAddress: row['IP'] || '',
    deviceType: row['الجهاز'] || 'desktop',
    dayOfWeek: row['اليوم'] || 'الجمعة',
    hourOfDay: hour,
    createdAt: new Date().toISOString(),
  };
}

function mapOwner(row) {
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

async function migrateProperties() {
  console.log('\n📦 Migrating_properties...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheet = wb.SheetNames.find(n => n.includes('بيانات') || n.includes('عقار'));
  if (!sheet) { console.log('❌ Properties sheet not found'); return; }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
  console.log(`   Found ${data.length} properties`);
  
  let imported = 0;
  for (const row of data) {
    const property = mapProperty(row);
    if (property.propertyNumber) {
      await db.collection('properties').doc(property.propertyNumber).set(property);
      imported++;
    }
  }
  console.log(`   ✅ Imported ${imported} properties`);
}

async function migrateSubscriptions() {
  console.log('\n📦 Migrating subscriptions...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('اشتراك'));
  if (!sheetName) { console.log('❌ Subscriptions sheet not found'); return; }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} subscriptions`);
  
  let imported = 0;
  for (const row of data) {
    const sub = mapSubscription(row);
    if (sub.propertyNumber) {
      await db.collection('subscriptions').doc(sub.id).set(sub);
      imported++;
    }
  }
  console.log(`   ✅ Imported ${imported} subscriptions`);
}

async function migratePayments() {
  console.log('\n📦 Migrating payments...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('مدفوع'));
  if (!sheetName) { console.log('❌ Payments sheet not found'); return; }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} payments`);
  
  let imported = 0;
  for (const row of data) {
    const payment = mapPayment(row);
    if (payment.propertyNumber) {
      await db.collection('payments').doc(payment.id).set(payment);
      imported++;
    }
  }
  console.log(`   ✅ Imported ${imported} payments`);
}

async function migratePackages() {
  console.log('\n📦 Migrating packages...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('باقات') && !n.includes('إضافات'));
  if (!sheetName) { console.log('❌ Packages sheet not found'); return; }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} packages`);
  
  let imported = 0;
  for (const row of data) {
    const pkg = mapPackage(row);
    if (pkg.name) {
      await db.collection('packages').doc(pkg.id).set(pkg);
      imported++;
    }
  }
  console.log(`   ✅ Imported ${imported} packages`);
}

async function migrateDiscountCodes() {
  console.log('\n📦 Migrating discount codes...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('خصم'));
  if (!sheetName) { console.log('❌ Discount codes sheet not found'); return; }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} discount codes`);
  
  let imported = 0;
  for (const row of data) {
    const code = mapDiscountCode(row);
    if (code.code) {
      await db.collection('discounts').doc(code.code).set(code);
      imported++;
    }
  }
  console.log(`   ✅ Imported ${imported} discount codes`);
}

async function migrateRequests() {
  console.log('\n📦 Migrating requests...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('طلبات'));
  if (!sheetName) { console.log('❌ Requests sheet not found'); return; }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} requests`);
  
  let imported = 0;
  for (const row of data) {
    const req = mapRequest(row);
    if (req.propertyNumber) {
      await db.collection('requests').doc(req.id).set(req);
      imported++;
    }
  }
  console.log(`   ✅ Imported ${imported} requests`);
}

async function migrateOwners() {
  console.log('\n📦 Migrating owners...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(n => n.includes('ملاك'));
  if (!sheetName) { console.log('❌ Owners sheet not found'); return; }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`   Found ${data.length} owners`);
  
  let imported = 0;
  for (const row of data) {
    const owner = mapOwner(row);
    if (owner.ownerId) {
      await db.collection('owners').doc(owner.ownerId).set(owner);
      imported++;
    }
  }
  console.log(`   ✅ Imported ${imported} owners`);
}

async function migrateDefaultPackages() {
  console.log('\n📦 Creating default packages...');
  
  const defaultPackages = [
    { id: 'pkg-free', name: 'مجاني', duration: 365, price: 0, type: 'free', features: [], isActive: true },
    { id: 'pkg-basic', name: 'أساسي', duration: 30, price: 150, type: 'normal', features: ['عرض في القائمة', 'طلبات واتساب'], isActive: true },
    { id: 'pkg-premium', name: 'مميز', duration: 30, price: 250, type: 'premium', features: ['عرض في القائمة', 'طلبات واتساب', 'صور متعددة', 'متميز'], isActive: true },
    { id: 'pkg-trusted', name: 'موثوق', duration: 30, price: 350, type: 'trusted', features: ['عرض في القائمة', 'طلبات واتساب', 'صور متعددة', 'موثوق', 'دعم فني'], isActive: true },
  ];
  
  for (const pkg of defaultPackages) {
    await db.collection('packages').doc(pkg.id).set({ ...pkg, createdAt: new Date().toISOString() });
  }
  console.log(`   ✅ Created ${defaultPackages.length} default packages`);
}

async function migrateDefaultFeeConfigs() {
  console.log('\n📦 Creating default fee configs...');
  
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

async function migrateDefaultFeatureFlags() {
  console.log('\n📦 Creating default feature flags...');
  
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

async function main() {
  console.log('🚀 Starting migration to Firebase...');
  console.log('   Project:', serviceAccount.project_id);
  
  try {
    await migrateProperties();
    await migrateSubscriptions();
    await migratePayments();
    await migratePackages();
    await migrateDiscountCodes();
    await migrateRequests();
    await migrateOwners();
    await migrateDefaultPackages();
    await migrateDefaultFeeConfigs();
    await migrateDefaultFeatureFlags();
    
    console.log('\n✅ Migration complete!');
    console.log('\n📊 Collections created:');
    console.log('   - properties');
    console.log('   - subscriptions');
    console.log('   - payments');
    console.log('   - packages');
    console.log('   - discounts');
    console.log('   - requests');
    console.log('   - owners');
    console.log('   - fee_configs');
    console.log('   - feature_flags');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
  
  process.exit(0);
}

main();
