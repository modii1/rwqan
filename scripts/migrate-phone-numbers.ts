/**
 * Migration script to fix phone numbers in Firestore
 * - Finds numbers starting with "050" and removes the leading 0
 * - Converts to 9-digit format
 * 
 * Usage: npx tsx scripts/migrate-phone-numbers.ts
 */
import 'dotenv/config';
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

async function migratePhoneNumbers() {
  console.log("🔄 Starting phone number migration...");
  
  const propertiesRef = db.collection("properties");
  const snapshot = await propertiesRef.get();
  
  console.log(`📊 Found ${snapshot.size} properties`);
  
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const propertyNumber = doc.id;
    const currentPhone = data.whatsappNumber;
    
    if (!currentPhone) {
      console.log(`⏭️ ${propertyNumber}: No phone number, skipping`);
      skipped++;
      continue;
    }
    
    try {
      // Remove any non-digits
      const digits = currentPhone.replace(/\D/g, "");
      
      // Check if starts with 966, remove it
      let cleaned = digits.startsWith("966") ? digits.slice(3) : digits;
      
      // If starts with 0, remove it (10 digits with leading 0 -> 9 digits)
      if (cleaned.startsWith("0")) {
        cleaned = cleaned.slice(1);
      }
      
      // Validate it's 9 digits and starts with 5
      if (cleaned.length === 9 && cleaned.startsWith("5")) {
        if (cleaned !== currentPhone) {
          await doc.ref.update({ whatsappNumber: cleaned });
          console.log(`✅ ${propertyNumber}: ${currentPhone} -> ${cleaned}`);
          migrated++;
        } else {
          console.log(`⏭️ ${propertyNumber}: Already correct (${currentPhone})`);
          skipped++;
        }
      } else {
        console.log(`⚠️ ${propertyNumber}: Invalid format (${currentPhone} -> digits: ${cleaned}), skipping`);
        skipped++;
      }
    } catch (err: any) {
      console.error(`❌ ${propertyNumber}: Error - ${err.message}`);
      errors++;
    }
  }
  
  console.log(`
📈 Migration Summary:
   - Migrated: ${migrated}
   - Skipped: ${skipped}
   - Errors: ${errors}
   - Total: ${snapshot.size}
  `);
  
  if (migrated > 0) {
    console.log("✅ Phone number migration completed!");
  } else if (errors > 0) {
    console.log("❌ Migration completed with errors");
    process.exit(1);
  } else {
    console.log("ℹ️ No changes needed");
  }
  
  process.exit(0);
}

migratePhoneNumbers().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});