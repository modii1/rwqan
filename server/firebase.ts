import admin from "firebase-admin";

/**
 * Initialize Firebase Admin SDK
 * Expects FIREBASE_SERVICE_ACCOUNT environment variable with JSON content
 */
function initializeFirebase() {
    if (admin.apps.length > 0) {
        return admin.firestore();
    }

    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!serviceAccountVar) {
        console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT not found in environment. Firebase storage will not be available.");
        return null;
    }

    try {
        const serviceAccount = JSON.parse(serviceAccountVar);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        admin.firestore().settings({ ignoreUndefinedProperties: true });
        console.log("🔥 Firebase Admin initialized successfully.");
        return admin.firestore();
    } catch (error) {
        console.error("❌ Failed to initialize Firebase Admin:", error);
        return null;
    }
}

export const db = initializeFirebase();
export default admin;
