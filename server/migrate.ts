import "dotenv/config";
import { googleSheetsService } from "./googleSheets";
import { db } from "./firebase";

async function migrate() {
    if (!db) {
        console.error("❌ Firebase not initialized. Please provide FIREBASE_SERVICE_ACCOUNT in .env");
        process.exit(1);
    }

    console.log("🚀 Starting migration from Google Sheets to Firestore...");

    const collections = [
        { name: "properties", fetch: () => googleSheetsService.getProperties() },
        { name: "subscriptions", fetch: () => googleSheetsService.getSubscriptions() },
        { name: "packages", fetch: () => googleSheetsService.getPackages() },
        { name: "discount_codes", fetch: () => googleSheetsService.getDiscountCodes() },
        { name: "payments", fetch: () => googleSheetsService.getPayments() },
        { name: "requests", fetch: () => googleSheetsService.getRequests() },
        { name: "suggestions", fetch: () => googleSheetsService.getSuggestions() },
    ];

    for (const collection of collections) {
        try {
            console.log(`📦 Migrating ${collection.name}...`);
            const data = await collection.fetch();
            console.log(`🟢 Fetched ${data.length} items from ${collection.name}`);

            const colRef = db.collection(collection.name);
            const batch = db.batch();

            for (const item of data) {
                // Use propertyNumber or id as document ID if available
                const docId = (item as any).propertyNumber || (item as any).id || (item as any).code || null;
                const docRef = docId ? colRef.doc(String(docId)) : colRef.doc();
                batch.set(docRef, item);
            }

            await batch.commit();
            console.log(`✅ ${collection.name} migrated successfully.`);
        } catch (error) {
            console.error(`❌ Failed to migrate ${collection.name}:`, error);
        }
    }

    console.log("🏁 Migration completed!");
    process.exit(0);
}

migrate().catch(console.error);
