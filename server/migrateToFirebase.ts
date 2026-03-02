import "dotenv/config";
import { googleSheetsService } from "./googleSheets";
import { firebaseService } from "./firebaseService";
import { db } from "./firebase";

async function migrate() {
    console.log("🚀 Starting migration from Google Sheets to Firebase...");

    try {
        // 1. Migrate Properties
        console.log("📋 Migrating Properties...");
        const properties = await googleSheetsService.getProperties();
        console.log(`Found ${properties.length} properties.`);
        for (const prop of properties) {
            await firebaseService.createProperty(prop as any);
        }
        console.log("✅ Properties migrated.");

        // 2. Migrate Subscriptions
        console.log("💳 Migrating Subscriptions...");
        const subscriptions = await googleSheetsService.getSubscriptions();
        console.log(`Found ${subscriptions.length} subscriptions.`);
        for (const sub of subscriptions) {
            await db.collection("subscriptions").doc(sub.id).set(sub);
        }
        console.log("✅ Subscriptions migrated.");

        // 3. Migrate Packages
        console.log("📦 Migrating Packages...");
        const packages = await googleSheetsService.getPackages();
        console.log(`Found ${packages.length} packages.`);
        for (const pkg of packages) {
            await firebaseService.createPackage(pkg as any);
        }
        console.log("✅ Packages migrated.");

        // 4. Migrate Payments
        console.log("💰 Migrating Payments...");
        const payments = await googleSheetsService.getPayments();
        console.log(`Found ${payments.length} payments.`);
        for (const payment of payments) {
            await firebaseService.createPayment(payment as any);
        }
        console.log("✅ Payments migrated.");

        // 5. Migrate Blog Posts
        console.log("📝 Migrating Blog Posts...");
        const posts = await googleSheetsService.getBlogPosts();
        console.log(`Found ${posts.length} blog posts.`);
        for (const post of posts) {
            await db.collection("blog_posts").doc(post.id).set(post);
        }
        console.log("✅ Blog posts migrated.");

        // 6. Migrate Bank Accounts
        console.log("🏦 Migrating Bank Accounts...");
        const bankAccounts = await googleSheetsService.getBankAccounts();
        for (const account of bankAccounts) {
            await db.collection("bank_accounts").doc(account.id).set(account);
        }
        console.log("✅ Bank accounts migrated.");

        // 7. Migrate Feature Flags
        console.log("🚩 Migrating Feature Flags...");
        const flags = await googleSheetsService.getFeatureFlags();
        for (const flag of flags) {
            await db.collection("feature_flags").doc(flag.id).set(flag);
        }
        console.log("✅ Feature flags migrated.");

        // 8. Migrate Analytics (Summarized)
        console.log("📊 Migrating Analytics...");
        const analytics = await googleSheetsService.getAnalyticsFromSheet();
        if (analytics) {
            await db.collection("settings").doc("analytics").set(analytics);
        }
        console.log("✅ Analytics migrated.");

        // 9. Migrate Owners
        console.log("👤 Migrating Owners...");
        // internal helper to get owners from sheet
        const ownersSheet = await googleSheetsService.readSheet("الملاك"); // Accessing private helper via public method equivalent if exists or just reading raw
        // validRows logic from googleSheets.getProperties but for owners
        // Actually googleSheetsService does not expose getOwners() public method returning all owners.
        // But we can use dbProxy pattern or just add a getter in googleSheets.ts temporarily?
        // Or just read the sheet using the service if it had a public method.
        // payload: syncOwnerFromProperties checks if owner exists, so we might need to rely on that or just get all properties and ensure owners exist?
        // Let's implement a getOwners method in googleSheetsService or just read the sheet if we can.
        // GoogleSheetsService has readSheet as public! (line 500 in my view)
        const ownersRows = await googleSheetsService.readSheet("الملاك");
        console.log(`Found ${ownersRows.length} owners.`);
        for (const row of ownersRows) {
            if (!row[0]) continue;
            const owner = {
                ownerId: row[0],
                phone: row[1] || "",
                password: row[2] || "",
                resetCode: row[3] || "",
                resetExpire: row[4] || "",
                lastReset: row[5] || "",
            };
            await db.collection("owners").doc(owner.ownerId).set(owner);
        }
        console.log("✅ Owners migrated.");

        // 10. Migrate Suggestions
        console.log("💡 Migrating Suggestions...");
        const suggestionsRows = await googleSheetsService.readSheet("الاقتراحات");
        for (const row of suggestionsRows) {
            if (!row[0]) continue;
            const suggestion = {
                id: row[0],
                name: row[1] || "",
                phone: row[2] || "",
                city: row[3] || "",
                suggestion: row[4] || "",
                status: row[5] || "جديد",
                createdAt: row[6] || "",
            };
            await db.collection("suggestions").doc(suggestion.id).set(suggestion);
        }
        console.log("✅ Suggestions migrated.");

        // 11. Migrate Discount Codes
        console.log("🎟️ Migrating Discount Codes...");
        const discounts = await googleSheetsService.getDiscountCodes();
        for (const discount of discounts) {
            await db.collection("discounts").doc(discount.code).set(discount);
        }
        console.log("✅ Discount Codes migrated.");

        // 12. Migrate Fee Configs
        console.log("💸 Migrating Fee Configs...");
        const feeConfigs = await googleSheetsService.getFeeConfigs();
        for (const config of feeConfigs) {
            await db.collection("fee_configs").doc(config.id).set(config);
        }
        console.log("✅ Fee Configs migrated.");

        // 13. Migrate Expenses
        console.log("💵 Migrating Expenses...");
        const expenses = await googleSheetsService.getExpenses();
        for (const expense of expenses) {
            await db.collection("expenses").doc(expense.id).set(expense);
        }
        console.log("✅ Expenses migrated.");

        // 14. Migrate Partner Profits
        console.log("🤝 Migrating Partner Profits...");
        const partnerProfitsRows = await googleSheetsService.readSheet("أرباح الشريك");
        for (const row of partnerProfitsRows) {
            if (!row[0]) continue;
            const profit = {
                id: row[0],
                monthYear: row[1] || "",
                activeSubscriptions: parseInt(row[2]) || 0,
                totalRevenue: parseFloat(row[3]) || 0,
                partnerShare: parseFloat(row[4]) || 0,
                percentage: parseFloat(row[5]) || 50,
                transferDate: row[6] || "",
                status: row[7] || "معلق",
                notes: row[8] || "",
                createdAt: row[9] || "",
                updatedAt: row[10] || "",
            };
            await db.collection("partner_profits").doc(profit.id).set(profit);
        }
        console.log("✅ Partner Profits migrated.");


        console.log("✨ Migration completed successfully!");
    } catch (error) {
        console.error("❌ Migration failed:", error);
    }
}

migrate().then(() => process.exit(0));
