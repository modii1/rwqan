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

/** The isolated DEV Firestore (default app). NULL until initialized. */
export function getDevFirestore() {
  return db;
}

const LIVE_APP_NAME = "rwqan-live";

/**
 * Build (once) the named production Firestore app from a DEDICATED service
 * account. Kept separate from the default DEV app so both can coexist in the
 * same process while the environment switch selects which one is active.
 */
export function getOrCreateLiveFirestore(
  serviceAccount: Record<string, unknown>,
) {
  const existing = admin.apps.find((app) => app?.name === LIVE_APP_NAME);
  const app =
    existing ??
    admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount as never) },
      LIVE_APP_NAME,
    );
  const firestore = admin.firestore(app);
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Already started — settings can only be applied once per instance.
  }
  return firestore;
}

export function releaseLiveFirestore() {
  const existing = admin.apps.find((app) => app?.name === LIVE_APP_NAME);
  if (existing) return existing.delete();
  return Promise.resolve();
}
