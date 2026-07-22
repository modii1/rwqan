import "dotenv/config";
import { db } from '../server/config/firebase.js';

console.log('Firebase connection test - writing test data...');

if (!db) {
  console.log('❌ Firebase not connected');
  process.exit(1);
}

const testProperty = {
  propertyNumber: "TEST-001",
  ownerName: "Test Owner",
  city: "Riyadh",
  district: "Al-Malaz",
  propertyType: "apartment",
  price: 150000,
  status: "نشط",
  whatsapp: "966501234567",
  verified: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

await db.collection('properties').doc('TEST-001').set(testProperty);
console.log('✅ Test property written to Firebase!');

// Verify it was written
const doc = await db.collection('properties').doc('TEST-001').get();
console.log('✅ Verification - Property exists:', doc.exists);
console.log('Property data:', doc.data());

console.log('\n🎉 Firebase is fully working!');
