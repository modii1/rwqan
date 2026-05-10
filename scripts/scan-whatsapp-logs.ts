import admin from "firebase-admin";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT not found in .env");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

async function scanWhatsAppLogs() {
  console.log("📲 جاري فحص سجلات WhatsApp...\n");

  const snapshot = await db.collection("whatsapp_logs").orderBy("createdAt", "desc").get();
  const logs = snapshot.docs.map((doc) => doc.data());

  console.log(`📊 إجمالي السجلات: ${logs.length}\n`);

  if (logs.length === 0) {
    console.log("⚠️ لا توجد سجلات WhatsApp في قاعدة البيانات");
    return;
  }

  const typeCount: Record<string, number> = {};
  const statusCount: Record<string, number> = {};
  const dailyStats: Record<string, number> = {};
  const monthlyStats: Record<string, number> = {};

  logs.forEach((log: any) => {
    if (log.type) {
      typeCount[log.type] = (typeCount[log.type] || 0) + 1;
    }
    if (log.status) {
      statusCount[log.status] = (statusCount[log.status] || 0) + 1;
    }
    if (log.createdAt) {
      const date = new Date(log.createdAt);
      const dayKey = date.toISOString().split("T")[0];
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      dailyStats[dayKey] = (dailyStats[dayKey] || 0) + 1;
      monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
    }
  });

  console.log("=" .repeat(50));
  console.log("📈 إحصائيات حسب نوع الإشعار:");
  console.log("=" .repeat(50));
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const percentage = ((count / logs.length) * 100).toFixed(1);
      console.log(`  ${type}: ${count} (${percentage}%)`);
    });

  console.log("\n" + "=".repeat(50));
  console.log("✅ إحصائيات حسب الحالة:");
  console.log("=".repeat(50));
  Object.entries(statusCount).forEach(([status, count]) => {
    const percentage = ((count / logs.length) * 100).toFixed(1);
    console.log(`  ${status}: ${count} (${percentage}%)`);
  });

  console.log("\n" + "=".repeat(50));
  console.log("📅 إحصائيات حسب الشهر:");
  console.log("=".repeat(50));
  Object.entries(monthlyStats)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12)
    .forEach(([month, count]) => {
      console.log(`  ${month}: ${count} رسالة`);
    });

  const lastLog = logs[0];
  const firstLog = logs[logs.length - 1];
  console.log("\n" + "=".repeat(50));
  console.log("📆 نطاق البيانات:");
  console.log("=".repeat(50));
  console.log(`  أقدم سجل: ${firstLog?.createdAt || "غير معروف"}`);
  console.log(`  أحدث سجل: ${lastLog?.createdAt || "غير معروف"}`);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const last30Days = logs.filter(
    (log: any) => log.createdAt && new Date(log.createdAt) >= thirtyDaysAgo
  ).length;

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last7Days = logs.filter(
    (log: any) => log.createdAt && new Date(log.createdAt) >= sevenDaysAgo
  ).length;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last24Hours = logs.filter(
    (log: any) => log.createdAt && new Date(log.createdAt) >= todayStart
  ).length;

  console.log("\n" + "=".repeat(50));
  console.log("📊 رسائل WhatsApp المرسلة:");
  console.log("=".repeat(50));
  console.log(` آخر 24 ساعة: ${last24Hours} رسالة`);
  console.log(` آخر 7 أيام: ${last7Days} رسالة`);
  console.log(` آخر 30 يوم: ${last30Days} رسالة`);
  console.log(` الإجمالي الكلي: ${logs.length} رسالة`);

  console.log("\n✅ تم إنهاء الفحص بنجاح!");
}

scanWhatsAppLogs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });