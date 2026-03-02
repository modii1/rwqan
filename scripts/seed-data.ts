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
      whatsappNumber: '966500000001',
      location: '',
      city: 'بريدة' as const,
      direction: 'شمال' as const,
      type: 'قسمين' as const,
      facilities: ['مسبح', 'ملعب', 'مكيف', 'واي فاي', 'ألعاب مائية', 'مبيت', 'مناسبات'],
      imagesFolderUrl: '',
      prices: {
        display: '1000',
        weekday: '800',
        weekend: '1200',
        overnight: '1500',
        special: '',
        holidays: '1400',
      },
      subscriptionType: 'موثوق' as const,
      lastUpdate: new Date().toISOString(),
      subscriptionDate: new Date().toISOString(),
      pin: '123456',
      driveFolderId: '',
      imageUrls: [],
    },
    {
      propertyNumber: '00002',
      name: 'استراحة النخيل',
      whatsappNumber: '966500000002',
      location: '',
      city: 'عنيزة' as const,
      direction: 'جنوب' as const,
      type: 'قسم' as const,
      facilities: ['بدون مسبح', 'ملعب', 'مكيف', 'واي فاي', 'شتاء', 'صيف'],
      imagesFolderUrl: '',
      prices: {
        display: '800',
        weekday: '600',
        weekend: '900',
        overnight: '1100',
        special: '',
        holidays: '1000',
      },
      subscriptionType: 'عادي' as const,
      lastUpdate: new Date().toISOString(),
      subscriptionDate: new Date().toISOString(),
      pin: '123456',
      driveFolderId: '',
      imageUrls: [],
    },
    {
      propertyNumber: '00003',
      name: 'شاليه الواحة',
      whatsappNumber: '966500000003',
      location: '',
      city: 'بريدة' as const,
      direction: 'شرق' as const,
      type: 'قسمين' as const,
      facilities: ['مسبح', 'ألعاب مائية', 'مكيف', 'واي فاي', 'مبيت', 'مناسبات', 'ملعب'],
      imagesFolderUrl: '',
      prices: {
        display: '1200',
        weekday: '900',
        weekend: '1300',
        overnight: '1600',
        special: '850',
        holidays: '1500',
      },
      subscriptionType: 'موثوق' as const,
      lastUpdate: new Date().toISOString(),
      subscriptionDate: new Date().toISOString(),
      pin: '123456',
      driveFolderId: '',
      imageUrls: [],
    },
    {
      propertyNumber: '00004',
      name: 'مزرعة الربيع',
      whatsappNumber: '966500000004',
      location: '',
      city: 'الرس' as const,
      direction: 'غرب' as const,
      type: 'قسم' as const,
      facilities: ['بدون مسبح', 'ملعب', 'مناسبات', 'مكيف', 'واي فاي'],
      imagesFolderUrl: '',
      prices: {
        display: '650',
        weekday: '500',
        weekend: '700',
        overnight: '900',
        special: '',
        holidays: '800',
      },
      subscriptionType: 'عادي' as const,
      lastUpdate: new Date().toISOString(),
      subscriptionDate: new Date().toISOString(),
      pin: '123456',
      driveFolderId: '',
      imageUrls: [],
    },
    {
      propertyNumber: '00005',
      name: 'استراحة الأمل',
      whatsappNumber: '966500000005',
      location: '',
      city: 'بريدة' as const,
      direction: 'شمال' as const,
      type: 'قسمين' as const,
      facilities: ['مسبح', 'ألعاب مائية', 'ملعب', 'مبيت', 'مكيف', 'واي فاي'],
      imagesFolderUrl: '',
      prices: {
        display: '950',
        weekday: '750',
        weekend: '1100',
        overnight: '1400',
        special: '',
        holidays: '1250',
      },
      subscriptionType: 'عادي' as const,
      lastUpdate: new Date().toISOString(),
      subscriptionDate: new Date().toISOString(),
      pin: '123456',
      driveFolderId: '',
      imageUrls: [],
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
