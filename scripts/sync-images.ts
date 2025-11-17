import { googleSheetsService } from '../server/googleSheets';
import { googleDriveService } from '../server/googleDrive';

// دالة لاستخراج معرف المجلد من رابط Google Drive
function extractFolderId(url: string): string | null {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function syncImagesAndFolders() {
  console.log('🔄 بدء مزامنة الصور والمجلدات من Google Drive...\n');

  const properties = await googleSheetsService.getProperties();
  console.log(`📊 وجدت ${properties.length} عقار\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const property of properties) {
    console.log(`\n🔍 معالجة ${property.propertyNumber} - ${property.name}...`);

    // 1. معالجة معرف المجلد
    const folderUrl = property.imagesFolderUrl;
    if (folderUrl) {
      const folderId = extractFolderId(folderUrl);
      if (folderId && !property.driveFolderId) {
        try {
          await googleSheetsService.updateProperty(property.propertyNumber, {
            driveFolderId: folderId
          });
          console.log(`   ✅ تم حفظ معرف المجلد: ${folderId}`);
        } catch (error) {
          console.error(`   ❌ خطأ في حفظ معرف المجلد:`, error);
          errorCount++;
        }
      }
    }

    // 2. معالجة الصور
    if (property.imageUrls && property.imageUrls.length > 0) {
      console.log(`   ⏭️  العقار لديه ${property.imageUrls.length} صور بالفعل`);
      skippedCount++;
      continue;
    }

    if (!property.driveFolderId) {
      console.log(`   ⚠️  لا يوجد معرف مجلد Drive`);
      skippedCount++;
      continue;
    }

    // 3. تحميل الصور من Google Drive
    try {
      console.log(`   📥 تحميل الصور من المجلد...`);
      const imageUrls = await googleDriveService.listFolderImages(property.driveFolderId);
      
      if (imageUrls.length === 0) {
        console.log(`   ⚠️  لا توجد صور في المجلد`);
        skippedCount++;
        continue;
      }

      // 4. حفظ روابط الصور في Google Sheets
      await googleSheetsService.updateProperty(property.propertyNumber, {
        imageUrls: imageUrls.slice(0, 10) // Max 10 images
      });

      console.log(`   ✅ تم تحميل وحفظ ${imageUrls.length} صورة`);
      updatedCount++;
    } catch (error) {
      console.error(`   ❌ خطأ في تحميل الصور:`, error);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ انتهت المزامنة!');
  console.log('='.repeat(60));
  console.log(`📊 الإحصائيات:`);
  console.log(`   ✅ تم تحديث: ${updatedCount} عقار`);
  console.log(`   ⏭️  تم تخطي: ${skippedCount} عقار`);
  console.log(`   ❌ أخطاء: ${errorCount} عقار`);
  console.log('='.repeat(60));
}

syncImagesAndFolders().catch(console.error);
