import { GoogleSheetsService } from './server/googleSheets';

async function updateProperty() {
  const googleSheets = new GoogleSheetsService();
  await googleSheets.init();
  
  const propertyNumber = "11677";
  
  // تحديث بيانات العقار
  const updates = {
    // إضافة صور
    imageUrls: [
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800",
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800",
      "https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800"
    ],
    // إضافة المرافق
    amenities: ["مسبح", "جلسات خارجية", "مكيف", "واي فاي", "موقف سيارات", "شواية", "مطبخ مجهز", "تلفزيون"],
    // إضافة الأسعار
    prices: {
      weekday: 500,
      weekend: 700,
      overnight: 300,
      holidays: 900
    },
    // إضافة النوع والمنطقة
    type: "شاليه",
    region: "القصيم",
    location: "بريدة - حي الريان"
  };
  
  const updated = await googleSheets.updateProperty(propertyNumber, updates as any);
  console.log("✅ تم تحديث العقار:", updated.propertyNumber);
  console.log("📷 الصور:", (updated as any).imageUrls?.length);
  console.log("🏠 المرافق:", (updated as any).amenities?.length);
  console.log("💰 الأسعار:", JSON.stringify((updated as any).prices));
}

updateProperty().catch(console.error);
