"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const googleapis_1 = require("googleapis");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_s3_1 = require("@aws-sdk/client-s3");
const stream_1 = __importDefault(require("stream"));
// ===== إعداد Google Drive =====
const SERVICE_ACCOUNT_PATH = path_1.default.join(process.cwd(), "server", "modi-bot-465120.json");
const credentials = JSON.parse(fs_1.default.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
const auth = new googleapis_1.google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = googleapis_1.google.drive({ version: "v3", auth });
// ===== إعداد R2 =====
const r2 = new client_s3_1.S3Client({
    region: process.env.R2_REGION,
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});
const BUCKET = process.env.R2_BUCKET_NAME;
// ===== وظائف R2 → Drive =====
// إنشاء أو جلب مجلد في Drive
async function getOrCreateDriveFolder(name, parentId) {
    const q = parentId
        ? `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`
        : `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
    const res = await drive.files.list({ q, fields: "files(id,name)" });
    if (res.data.files && res.data.files.length)
        return res.data.files[0].id;
    const folder = await drive.files.create({
        requestBody: {
            name,
            mimeType: "application/vnd.google-apps.folder",
            parents: parentId ? [parentId] : undefined,
        },
        fields: "id",
    });
    return folder.data.id;
}
// تنزيل ملف من R2
async function downloadR2Object(key) {
    const res = await r2.send(new client_s3_1.GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks = [];
    const body = res.Body;
    for await (const chunk of body)
        chunks.push(chunk);
    return Buffer.concat(chunks);
}
// رفع ملف إلى Drive
async function uploadToDrive(folderId, buffer, filename, mimeType = "image/jpeg") {
    await drive.files.create({
        requestBody: { name: filename, parents: [folderId] },
        media: { body: stream_1.default.Readable.from(buffer), mimeType },
        fields: "id",
    });
    console.log(`✔ تم رفع: ${filename}`);
}
// قائمة كل ملفات R2 الجديدة حسب التاريخ
async function listAllR2Objects(prefix = "", fromDate = new Date("2025-11-01")) {
    const objects = [];
    let ContinuationToken;
    do {
        const res = await r2.send(new client_s3_1.ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
            ContinuationToken,
        }));
        res.Contents?.forEach((obj) => {
            if (obj.Key &&
                !obj.Key.endsWith("/") &&
                obj.LastModified &&
                obj.LastModified >= fromDate) {
                objects.push({ Key: obj.Key, LastModified: obj.LastModified });
            }
        });
        ContinuationToken = res.NextContinuationToken;
    } while (ContinuationToken);
    return objects;
}
// مزامنة كل ملفات R2 الجديدة إلى Drive
async function syncR2ToDrive({ sinceDate = new Date("2025-11-01") } = {}) {
    console.log(`🚀 بدء مزامنة R2 → Google Drive منذ ${sinceDate.toISOString()} …`);
    const rootFolderId = await getOrCreateDriveFolder("Cloudflare_Images_All");
    const allObjects = await listAllR2Objects("", sinceDate);
    console.log(`📦 ${allObjects.length} ملف سيتم رفعه`);
    for (const obj of allObjects) {
        const key = obj.Key;
        const parts = key.split("/");
        const fileName = parts.pop();
        let parentId = rootFolderId;
        for (const part of parts) {
            parentId = await getOrCreateDriveFolder(part, parentId);
        }
        const buffer = await downloadR2Object(key);
        await uploadToDrive(parentId, buffer, fileName);
    }
    console.log("✅ تمت مزامنة جميع الملفات الجديدة من R2 إلى Google Drive!");
}
// تشغيل تلقائي عند التنفيذ
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        try {
            await syncR2ToDrive({ sinceDate: new Date("2025-11-01") });
        }
        catch (err) {
            console.error(err);
        }
    })();
}
