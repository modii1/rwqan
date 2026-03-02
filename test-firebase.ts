import "dotenv/config";
import { db } from './server/firebase.js';

console.log('Firebase connection test...');
console.log('db object:', db ? 'Connected!' : 'Not connected');

if (db) {
  console.log('Checking Firestore...');
  const snapshot = await db.collection('properties').limit(1).get();
  console.log('Properties in Firebase:', snapshot.size);
  console.log('\n✅ Firebase is working!');
} else {
  console.log('❌ Firebase not connected');
}
