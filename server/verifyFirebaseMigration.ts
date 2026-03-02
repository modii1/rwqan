import "dotenv/config";
import { googleSheetsService } from "./googleSheets";
import { firebaseService } from "./firebaseService";
import { db } from "./firebase";

async function verify() {
    console.log("🔍 Verifying migration integrity...");
    const results: any[] = [];

    // Properties
    const sheetProps = await googleSheetsService.getProperties();
    const fireProps = await firebaseService.getProperties();
    results.push({ name: "Properties", sheet: sheetProps.length, fire: fireProps.length, match: sheetProps.length === fireProps.length });

    // Subscriptions
    const sheetSubs = await googleSheetsService.getSubscriptions();
    const fireSubs = await firebaseService.getSubscriptions();
    results.push({ name: "Subscriptions", sheet: sheetSubs.length, fire: fireSubs.length, match: sheetSubs.length === fireSubs.length });

    // Packages
    const sheetPkgs = await googleSheetsService.getPackages();
    const firePkgs = await firebaseService.getPackages();
    results.push({ name: "Packages", sheet: sheetPkgs.length, fire: firePkgs.length, match: sheetPkgs.length === firePkgs.length });

    // Payments
    const sheetPayments = await googleSheetsService.getPayments();
    const firePayments = await firebaseService.getPayments();
    results.push({ name: "Payments", sheet: sheetPayments.length, fire: firePayments.length, match: sheetPayments.length === firePayments.length });

    // Blog Posts
    const sheetPosts = await googleSheetsService.getBlogPosts();
    // firebaseService doesn't have a direct getBlogPosts equivalent yet? 
    // Wait, createBlogPost calls getBlogPosts in firebaseService? No, let's check.
    // In migration script: await db.collection("blog_posts").doc(post.id).set(post);
    // So query collection manually.
    const firePostsSnap = await db?.collection("blog_posts").get();
    const firePostsCount = firePostsSnap ? firePostsSnap.docs.length : 0;
    results.push({ name: "Blog Posts", sheet: sheetPosts.length, fire: firePostsCount, match: sheetPosts.length === firePostsCount });

    // Bank Accounts
    const sheetBanks = await googleSheetsService.getBankAccounts();
    const fireBanks = await firebaseService.getBankAccounts();
    results.push({ name: "Bank Accounts", sheet: sheetBanks.length, fire: fireBanks.length, match: sheetBanks.length === fireBanks.length });

    // Feature Flags
    const sheetFlags = await googleSheetsService.getFeatureFlags();
    const fireFlags = await firebaseService.getFeatureFlags();
    results.push({ name: "Feature Flags", sheet: sheetFlags.length, fire: fireFlags.length, match: sheetFlags.length === fireFlags.length });

    // Owners
    // googleSheetsService has no direct getOwners except specific method, but we read sheet manually in migration script.
    const sheetOwners = await googleSheetsService.readSheet("الملاك");
    const validSheetOwners = sheetOwners.filter(r => r[0]);
    const fireOwnersSnap = await db?.collection("owners").get();
    const fireOwnersCount = fireOwnersSnap ? fireOwnersSnap.docs.length : 0;
    results.push({ name: "Owners", sheet: validSheetOwners.length, fire: fireOwnersCount, match: validSheetOwners.length === fireOwnersCount });

    // Suggestions
    const sheetSuggestions = await googleSheetsService.readSheet("الاقتراحات");
    const validSheetSuggestions = sheetSuggestions.filter(r => r[0]);
    const fireSuggestionsSnap = await db?.collection("suggestions").get();
    const fireSuggestionsCount = fireSuggestionsSnap ? fireSuggestionsSnap.docs.length : 0;
    results.push({ name: "Suggestions", sheet: validSheetSuggestions.length, fire: fireSuggestionsCount, match: validSheetSuggestions.length === fireSuggestionsCount });

    // Discount Codes
    const sheetDiscounts = await googleSheetsService.getDiscountCodes();
    const fireDiscounts = await firebaseService.getDiscountCodes();
    results.push({ name: "Discount Codes", sheet: sheetDiscounts.length, fire: fireDiscounts.length, match: sheetDiscounts.length === fireDiscounts.length });

    // Fee Configs
    const sheetFeeConfigs = await googleSheetsService.getFeeConfigs();
    const fireFeeConfigs = await firebaseService.getFeeConfigs();
    results.push({ name: "Fee Configs", sheet: sheetFeeConfigs.length, fire: fireFeeConfigs.length, match: sheetFeeConfigs.length === fireFeeConfigs.length });

    // Expenses
    const sheetExpenses = await googleSheetsService.getExpenses();
    const fireExpenses = await firebaseService.getExpenses();
    results.push({ name: "Expenses", sheet: sheetExpenses.length, fire: fireExpenses.length, match: sheetExpenses.length === fireExpenses.length });

    // Partner Profits
    const sheetProfits = await googleSheetsService.readSheet("أرباح الشريك");
    const validSheetProfits = sheetProfits.filter(r => r[0]);
    const fireProfitsSnap = await db?.collection("partner_profits").get();
    const fireProfitsCount = fireProfitsSnap ? fireProfitsSnap.docs.length : 0;
    results.push({ name: "Partner Profits", sheet: validSheetProfits.length, fire: fireProfitsCount, match: validSheetProfits.length === fireProfitsCount });

    console.log(JSON.stringify(results, null, 2));

    const allMatch = results.every(r => r.match);
    if (allMatch) {
        console.log("✅ Verification PASSED: All counts match.");
    } else {
        console.error("❌ Verification FAILED: Some counts do not match.");
        process.exit(1);
    }
}

verify().then(() => process.exit(0));
