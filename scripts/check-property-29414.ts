import "dotenv/config";
import { firebaseService } from "../server/firebaseService";

async function main() {
  const propertyNumber = "29414";
  
  console.log(`\n🔍 Checking property ${propertyNumber}...\n`);

  // Get property data
  const property = await firebaseService.getPropertyByNumber(propertyNumber);
  if (!property) {
    console.log("❌ Property not found");
    process.exit(1);
  }

  console.log("📋 Property Data:");
  console.log(`  Name: ${property.name}`);
  console.log(`  City: ${property.city}`);
  console.log(`  subscriptionType: ${property.subscriptionType}`);
  console.log(`  verificationStatus: ${property.verificationStatus}`);
  console.log(`  WhatsApp: ${property.whatsappNumber}`);

  // Get subscription data
  const subscription = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
  if (subscription) {
    console.log("\n📦 Subscription Data:");
    console.log(`  ID: ${subscription.id}`);
    console.log(`  Status: ${subscription.status}`);
    console.log(`  subscriptionType: ${subscription.subscriptionType}`);
    console.log(`  packageId: ${subscription.packageId}`);
    console.log(`  startDate: ${subscription.startDate}`);
    console.log(`  endDate: ${subscription.endDate}`);
    console.log(`  cancelledAt: ${(subscription as any).cancelledAt || 'N/A'}`);
    console.log(`  cancelReason: ${(subscription as any).cancelReason || 'N/A'}`);

    // Check for stale cancelledAt (subscription was reactivated after cancellation)
    const cancelledAt = (subscription as any).cancelledAt;
    if (cancelledAt && subscription.startDate) {
      const cancelDate = new Date(cancelledAt);
      const startDate = new Date(subscription.startDate);
      
      if (startDate > cancelDate) {
        console.log("\n⚠️  STALE cancelledAt DETECTED: Subscription was reactivated after cancellation!");
        console.log(`   cancelledAt: ${cancelledAt}`);
        console.log(`   startDate (later): ${subscription.startDate}`);
        console.log("   Fixing: Clearing cancelledAt and cancelReason...");
        
        await firebaseService.updateSubscription(subscription.id, { 
          cancelledAt: null, 
          cancelReason: null 
        });
        console.log("   ✅ Fixed! Subscription should now show as 'ساري' in admin dashboard.");
      }
    }

    // Check for expired + premium conflict
    const now = new Date();
    const endDate = subscription.endDate ? new Date(subscription.endDate) : null;
    const isExpired = !endDate || endDate < now || subscription.status === "منتهي";
    const isPremium = property.subscriptionType === "مميز";

    if (isExpired && isPremium) {
      console.log("\n⚠️  CONFLICT DETECTED: Property is marked as 'مميز' but subscription is expired!");
      console.log("   Fixing: Setting subscriptionType to 'عادي'...");
      
      await firebaseService.updateProperty(propertyNumber, { subscriptionType: "عادي" });
      await firebaseService.updateSubscription(subscription.id, { subscriptionType: "عادي" });
      console.log("   ✅ Fixed!");
    } else if (!isExpired) {
      console.log("\n✅ Subscription is active - no type conflict");
    }
  } else {
    console.log("\n❌ No subscription found for this property");
    if (property.subscriptionType === "مميز") {
      console.log("⚠️  CONFLICT: Property is marked as premium but has no subscription!");
      console.log("   Fixing: Setting subscriptionType to 'عادي'...");
      await firebaseService.updateProperty(propertyNumber, { subscriptionType: "عادي" });
      console.log("   ✅ Fixed!");
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
