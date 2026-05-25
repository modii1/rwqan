require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    admin.firestore().settings({ ignoreUndefinedProperties: true });
}
const db = admin.firestore();

const COLLECTIONS = [
    "properties", "subscriptions", "packages", "payments", "discounts",
    "requests", "suggestions", "expenses", "bank_accounts", "feature_flags",
    "partner_profits", "addon_packages", "property_addons", "multi_property_subscriptions",
    "fee_configs", "owners", "property_seo", "backups", "profits", "verification_logs",
];

async function main() {
    const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const backupDir = path.resolve(__dirname, "..", "backups", `firebase-${dateStr}`);
    fs.mkdirSync(backupDir, { recursive: true });

    let totalDocs = 0;

    for (const colName of COLLECTIONS) {
        process.stdout.write(`Exporting ${colName}... `);
        try {
            const snapshot = await db.collection(colName).get();
            const docs = {};
            snapshot.forEach(doc => { docs[doc.id] = doc.data(); });
            const filePath = path.join(backupDir, `${colName}.json`);
            fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), "utf-8");
            const count = Object.keys(docs).length;
            totalDocs += count;
            console.log(`${count} documents`);
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
        }
    }

    console.log(`\n✅ Backup complete: ${totalDocs} total documents written to ${backupDir}`);

    // Compress
    const tarPath = path.resolve(__dirname, "..", "backups", `backup-firebase-${dateStr}.tar.gz`);
    try {
        execSync(`tar -czf "${tarPath}" -C "${path.dirname(backupDir)}" "${path.basename(backupDir)}"`, { stdio: "pipe" });
        console.log(`✅ Compressed: ${tarPath}`);
    } catch (err) {
        console.log(`⚠️  Compression failed: ${err.message}`);
    }
}

main().catch(err => console.error(err));
