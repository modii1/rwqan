/**
 * Migration: Remove مvoxوق (trusted) tier
 * Converts all subscriptionType: "موثوق" → "مميز" in Firebase
 *
 * Run: npx tsx scripts/migrate-remove-mawthouq.ts
 */

import "dotenv/config";
import { firebaseService } from '../server/firebaseService';

async function main() {
  console.log('🔄 Starting migration: Remove مvoxوق (trusted) tier\n');

  let propertiesUpdated = 0;
  let subscriptionsUpdated = 0;
  let packagesUpdated = 0;

  // 1. Update properties collection
  console.log('📦 Updating properties...');
  const properties = await firebaseService.getProperties();
  for (const prop of properties) {
    if ((prop as any).subscriptionType === 'موثوق') {
      await firebaseService.updateProperty(prop.propertyNumber, { subscriptionType: 'مميز' } as any);
      console.log(`  ✅ Property ${prop.propertyNumber}: مvoxوق → مميز`);
      propertiesUpdated++;
    }
  }
  console.log(`  Total properties updated: ${propertiesUpdated}\n`);

  // 2. Update subscriptions collection
  console.log('📋 Updating subscriptions...');
  const subscriptions = await firebaseService.getSubscriptions();
  for (const sub of subscriptions) {
    let changed = false;
    if ((sub as any).subscriptionType === 'موثوق') {
      await firebaseService.updateSubscription(sub.id, { subscriptionType: 'مميز' } as any);
      console.log(`  ✅ Subscription ${sub.id}: subscriptionType مvoxوق → مميز`);
      subscriptionsUpdated++;
      changed = true;
    }
    if ((sub as any).packageType === 'موثوق') {
      await firebaseService.updateSubscription(sub.id, { packageType: 'مميز' } as any);
      console.log(`  ✅ Subscription ${sub.id}: packageType مvoxوق → مميز`);
      if (!changed) subscriptionsUpdated++;
      changed = true;
    }
  }
  console.log(`  Total subscriptions updated: ${subscriptionsUpdated}\n`);

  // 3. Update packages collection
  console.log('📦 Updating packages...');
  const packages = await firebaseService.getPackages();
  for (const pkg of packages) {
    if ((pkg as any).type === 'موثوق') {
      await firebaseService.updatePackage(pkg.id, { type: 'مميز' } as any);
      console.log(`  ✅ Package ${pkg.id}: type مvoxوق → مميز`);
      packagesUpdated++;
    }
  }
  console.log(`  Total packages updated: ${packagesUpdated}\n`);

  // 4. Update payments collection (pendingSubscriptionType field)
  console.log('💳 Updating payments (pendingSubscriptionType)...');
  let paymentsUpdated = 0;
  const payments = await firebaseService.getPayments();
  for (const payment of payments) {
    if ((payment as any).pendingSubscriptionType === 'موثوق') {
      await firebaseService.updatePayment(payment.id, { pendingSubscriptionType: 'مميز' } as any);
      console.log(`  ✅ Payment ${payment.id}: pendingSubscriptionType مvoxوق → مميز`);
      paymentsUpdated++;
    }
  }
  console.log(`  Total payments updated: ${paymentsUpdated}\n`);

  // Summary
  console.log('═══════════════════════════════════════════════');
  console.log('Migration complete!');
  console.log(`  Properties:  ${propertiesUpdated} updated`);
  console.log(`  Subscriptions: ${subscriptionsUpdated} updated`);
  console.log(`  Packages:    ${packagesUpdated} updated`);
  console.log(`  Payments:    ${paymentsUpdated} updated`);
  console.log('═══════════════════════════════════════════════');
}

main().catch(console.error);
