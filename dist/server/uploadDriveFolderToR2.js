"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadDriveFolderToR2 = uploadDriveFolderToR2;
const googleapis_1 = require("googleapis");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_s3_1 = require("@aws-sdk/client-s3");
const googleSheets_js_1 = require("./googleSheets.js");
// ===== تحميل حساب الخدمة =====
const SERVICE_ACCOUNT_PATH = path_1.default.join(process.cwd(), "server", "modi-bot-465120.json");
const credentials = JSON.parse(fs_1.default.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
const auth = new googleapis_1.google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const drive = googleapis_1.google.drive({ version: "v3", auth });
// ===== إعداد R2 =====
const r2 = process.env.R2_REGION && process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? new client_s3_1.S3Client({
        region: process.env.R2_REGION,
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    })
    : null;
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
// استخراج ID من رابط المجلد
function extractFolderId(url) {
    const m = url.match(/folders\/([^/?]+)/);
    return m ? m[1] : null;
}
// جلب الصور داخل Drive
async function listDriveImages(folderId) {
    const res = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/'`,
        fields: "files(id, name)",
    });
    return res.data.files || [];
}
// تنزيل صورة من Drive
async function downloadDriveFile(fileId) {
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(res.data);
}
// رفع إلى R2
async function uploadToR2(propertyId, fileName, buffer) {
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
        await r2.send(new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: `${propertyId}/${fileName}`,
            Body: buffer,
            ContentType: "image/jpeg",
        }));
        console.log(`✅ تم رفع: ${propertyId}/${fileName}`);
        return `${process.env.R2_PUBLIC_URL}/${propertyId}/${fileName}`;
    }
    catch (err) {
        console.error(`❌ فشل رفع ${propertyId}/${fileName}`);
        console.error("سبب الخطأ:", err);
        throw err;
    }
}
// ===============================================================
//         رفع جميع مجلدات Drive لكل العقارات + تحديث الشيت
// ===============================================================
async function uploadDriveFolderToR2() {
    console.log("🚀 بدء رفع جميع مجلدات العقارات إلى R2…");
    const properties = await googleSheets_js_1.googleSheetsService.getProperties();
    console.log(`📖 تم قراءة ${properties.length} عقار من Google Sheets`);
    for (const property of properties) {
        const folderUrl = property.imagesFolderUrl || property.folderUrl || property["🔗 رابط الصور"];
        const propertyId = String(property.propertyNumber);
        if (!folderUrl || !propertyId)
            continue;
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
            if (!file.id)
                continue;
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
