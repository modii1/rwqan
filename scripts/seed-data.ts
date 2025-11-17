import { googleSheetsService } from '../server/googleSheets';

async function seedData() {
  console.log('🌱 Starting data seeding...');

  // Seed packages
  console.log('Adding packages...');
  const packages = [
    {
      id: 'pkg-regular-30',
      name: 'باقة الشهر - عادي',
      duration: 30,
      price: 100,
      type: 'عادي' as const,
      features: ['عرض في القائمة الرئيسية', 'صور العقار', 'معلومات الأسعار'],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'pkg-regular-90',
      name: 'باقة 3 أشهر - عادي',
      duration: 90,
      price: 250,
      type: 'عادي' as const,
      features: ['عرض في القائمة الرئيسية', 'صور العقار', 'معلومات الأسعار', 'خصم 17%'],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'pkg-verified-30',
      name: 'باقة الشهر - موثوق',
      duration: 30,
      price: 200,
      type: 'موثوق' as const,
      features: ['عرض في الأعلى دائماً ⭐', 'شارة موثوق الذهبية', 'تصميم مميز', 'صور العقار', 'معلومات الأسعار'],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'pkg-verified-90',
      name: 'باقة 3 أشهر - موثوق',
      duration: 90,
      price: 500,
      type: 'موثوق' as const,
      features: ['عرض في الأعلى دائماً ⭐', 'شارة موثوق الذهبية', 'تصميم مميز', 'صور العقار', 'معلومات الأسعار', 'خصم 17%'],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];

  for (const pkg of packages) {
    try {
      await googleSheetsService.createPackage(pkg);
      console.log(`✅ Added package: ${pkg.name}`);
    } catch (error) {
      console.error(`❌ Error adding package ${pkg.name}:`, error);
    }
  }

  // Seed discount codes
  console.log('\nAdding discount codes...');
  const discounts = [
    {
      code: 'WELCOME2025',
      type: 'نسبة' as const,
      value: 20,
      expiryDate: '2025-12-31',
      isActive: true,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    },
    {
      code: 'SAVE50',
      type: 'ثابت' as const,
      value: 50,
      expiryDate: '2025-06-30',
      isActive: true,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    },
    {
      code: 'VIP100',
      type: 'ثابت' as const,
      value: 100,
      isActive: true,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    },
  ];

  for (const discount of discounts) {
    try {
      await googleSheetsService.createDiscountCode(discount);
      console.log(`✅ Added discount code: ${discount.code}`);
    } catch (error) {
      console.error(`❌ Error adding discount ${discount.code}:`, error);
    }
  }

  // Seed sample properties
  console.log('\nAdding sample properties...');
  const properties = [
    {
      propertyNumber: '00001',
      name: 'استراحة الفردوس',
      pin: '123456',
      city: 'بريدة',
      direction: 'شمال',
      type: 'قسمين',
      facilities: ['مسبح', 'ملعب', 'مكيف', 'واي فاي', 'ألعاب مائية', 'مبيت', 'مناسبات'],
      prices: {
        weekday: '800',
        weekend: '1200',
        overnight: '1500',
        holidays: '1400',
      },
      offers: '',
      subscriptionType: 'موثوق' as const,
      subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      driveFolderId: '',
      imageUrls: [],
      whatsappNumber: '966500000001',
    },
    {
      propertyNumber: '00002',
      name: 'استراحة النخيل',
      pin: '123456',
      city: 'عنيزة',
      direction: 'جنوب',
      type: 'قسم',
      facilities: ['بدون مسبح', 'ملعب', 'مكيف', 'واي فاي', 'شتاء', 'صيف'],
      prices: {
        weekday: '600',
        weekend: '900',
        overnight: '1100',
        holidays: '1000',
      },
      offers: '',
      subscriptionType: 'عادي' as const,
      driveFolderId: '',
      imageUrls: [],
      whatsappNumber: '966500000002',
    },
    {
      propertyNumber: '00003',
      name: 'شاليه الواحة',
      pin: '123456',
      city: 'بريدة',
      direction: 'شرق',
      type: 'قسمين',
      facilities: ['مسبح', 'ألعاب مائية', 'مكيف', 'واي فاي', 'مبيت', 'مناسبات', 'ملعب'],
      prices: {
        weekday: '900',
        weekend: '1300',
        overnight: '1600',
        holidays: '1500',
      },
      offers: 'خصم 10% للحجز المبكر',
      subscriptionType: 'موثوق' as const,
      subscriptionEndDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      driveFolderId: '',
      imageUrls: [],
      whatsappNumber: '966500000003',
    },
    {
      propertyNumber: '00004',
      name: 'مزرعة الربيع',
      pin: '123456',
      city: 'الرس',
      direction: 'غرب',
      type: 'قسم',
      facilities: ['بدون مسبح', 'ملعب', 'مناسبات', 'مكيف', 'واي فاي'],
      prices: {
        weekday: '500',
        weekend: '700',
        overnight: '900',
        holidays: '800',
      },
      offers: '',
      subscriptionType: 'عادي' as const,
      driveFolderId: '',
      imageUrls: [],
      whatsappNumber: '966500000004',
    },
    {
      propertyNumber: '00005',
      name: 'استراحة الأمل',
      pin: '123456',
      city: 'بريدة',
      direction: 'شمال',
      type: 'قسمين',
      facilities: ['مسبح', 'ألعاب مائية', 'ملعب', 'مبيت', 'مكيف', 'واي فاي'],
      prices: {
        weekday: '750',
        weekend: '1100',
        overnight: '1400',
        holidays: '1250',
      },
      offers: '',
      subscriptionType: 'عادي' as const,
      driveFolderId: '',
      imageUrls: [],
      whatsappNumber: '966500000005',
    },
  ];

  for (const property of properties) {
    try {
      await googleSheetsService.createProperty(property);
      console.log(`✅ Added property: ${property.name} (${property.propertyNumber})`);
    } catch (error) {
      console.error(`❌ Error adding property ${property.name}:`, error);
    }
  }

  console.log('\n✅ Data seeding completed!');
  console.log('\n📊 Summary:');
  console.log(`- ${packages.length} packages added`);
  console.log(`- ${discounts.length} discount codes added`);
  console.log(`- ${properties.length} properties added`);
  console.log('\n🔑 Test credentials:');
  console.log('Property Number: 00001, 00002, 00003, 00004, 00005');
  console.log('PIN: 123456');
}

seedData().catch(console.error);
