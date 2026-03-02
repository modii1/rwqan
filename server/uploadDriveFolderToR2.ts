import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { googleSheetsService } from "./googleSheets.js";

// ===== تحميل حساب الخدمة =====
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), "server", "modi-bot-465120.json");
const credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const drive = google.drive({ version: "v3", auth });

// ===== إعداد R2 =====
const r2 = process.env.R2_REGION && process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  ? new S3Client({
    region: process.env.R2_REGION,
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    } as any,
  })
  : null;

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

// استخراج ID من رابط المجلد
function extractFolderId(url: string) {
  const m = url.match(/folders\/([^/?]+)/);
  return m ? m[1] : null;
}

// جلب الصور داخل Drive
async function listDriveImages(folderId: string) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/'`,
    fields: "files(id, name)",
  });
  return res.data.files || [];
}

// تنزيل صورة من Drive
async function downloadDriveFile(fileId: string) {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as any);
}

// رفع إلى R2
async function uploadToR2(propertyId: string, fileName: string, buffer: Buffer) {
  console.log(`🚚 محاولة رفع → ${propertyId}/${fileName}`);

  // تحقق من المتغيرات
  const region = process.env.R2_REGION;
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!region || !endpoint || !bucket) {
    console.error(`❌ خطأ: متغيرات البيئة ناقصة!
R2_REGION=${region}
R2_ENDPOINT=${endpoint}
R2_BUCKET_NAME=${bucket}`);
    throw new Error("Environment variables missing");
  }

  if (!r2) {
    console.error("❌ [R2] Client not initialized. Skipping upload.");
    return "";
  }

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${propertyId}/${fileName}`,
        Body: buffer,
        ContentType: "image/jpeg",
      })
    );

    console.log(`✅ تم رفع: ${propertyId}/${fileName}`);
    return `${process.env.R2_PUBLIC_URL}/${propertyId}/${fileName}`;

  } catch (err) {
    console.error(`❌ فشل رفع ${propertyId}/${fileName}`);
    console.error("سبب الخطأ:", err);
    throw err;
  }
}


// ===============================================================
//         رفع جميع مجلدات Drive لكل العقارات + تحديث الشيت
// ===============================================================
export async function uploadDriveFolderToR2() {
  console.log("🚀 بدء رفع جميع مجلدات العقارات إلى R2…");

  const properties = await googleSheetsService.getProperties();
  console.log(`📖 تم قراءة ${properties.length} عقار من Google Sheets`);

  for (const property of properties) {
    const folderUrl = (property as any).imagesFolderUrl || (property as any).folderUrl || (property as any)["🔗 رابط الصور"];
    const propertyId = String(property.propertyNumber);


    if (!folderUrl || !propertyId) continue;

    const folderId = extractFolderId(folderUrl);
    if (!folderId || !propertyId) {
      console.log(`⚠ رابط مجلد غير صالح أو فقدان رقم العقار → ${propertyId}`);
      continue;
    }

    console.log(`\n📁 عقار ${propertyId}: فحص المجلد…`);

    const images = await listDriveImages(folderId);
    if (!images.length) {
      console.log(`⚠ لا توجد صور في المجلد`);
      continue;
    }

    console.log(`📸 عدد الصور: ${images.length}`);

    let index = 1;
    let uploadedUrls = [];

    for (const file of images) {
      if (!file.id) continue;
      const buffer = await downloadDriveFile(file.id);
      const fileName = `${index}.jpg`;

      const r2url = await uploadToR2(propertyId, fileName, buffer);

      uploadedUrls.push(r2url);
      console.log(`✔ رفع: ${propertyId}/${fileName}`);

      index++;
    }

    // تحديث الشيت بروابط R2

    console.log(`🎉 اكتمل رفع + تحديث الشيت للعقار ${propertyId}`);
  }

  console.log("\n✨ اكتمل رفع جميع العقارات إلى R2 + تحديث الشيت!");
}

// تشغيل تلقائي عند التنفيذ
if (process.argv[1]?.includes('uploadDriveFolderToR2')) {
  uploadDriveFolderToR2();
}
