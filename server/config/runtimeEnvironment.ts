const PRODUCTION_SECURITY_ENV_KEYS = [
  "ADMIN_CODE",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "PAYMOB_HMAC_SECRET",
  "FIREBASE_SERVICE_ACCOUNT",
] as const;

function assertFirebaseServiceAccount(value: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT must contain valid JSON in production",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT must contain a service-account object in production",
    );
  }

  const record = parsed as Record<string, unknown>;
  const requiredFields = [
    ["project_id", "projectId"],
    ["client_email", "clientEmail"],
    ["private_key", "privateKey"],
  ] as const;
  const missing = requiredFields
    .filter((aliases) => !aliases.some((field) =>
      typeof record[field] === "string" && record[field]!.trim().length > 0
    ))
    .map(([canonical]) => canonical);

  if (missing.length > 0) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT is missing required fields: ${missing.join(", ")}`,
    );
  }
}

/** Refuse to expose privileged routes with missing production credentials. */
export function assertProductionSecurityEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== "production") return;

  const missing = PRODUCTION_SECURITY_ENV_KEYS.filter(
    (key) => !environment[key]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required production security environment variables: ${missing.join(", ")}`,
    );
  }

  assertFirebaseServiceAccount(environment.FIREBASE_SERVICE_ACCOUNT!);

  if (Buffer.byteLength(environment.SESSION_SECRET!, "utf8") < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 bytes in production",
    );
  }

  const ownerAccountHmacSecret =
    environment.OWNER_ACCOUNT_HMAC_SECRET?.trim() || environment.SESSION_SECRET!;
  if (Buffer.byteLength(ownerAccountHmacSecret, "utf8") < 32) {
    throw new Error(
      "OWNER_ACCOUNT_HMAC_SECRET must be at least 32 bytes in production",
    );
  }

  const relaySecret = environment.WHATSAPP_DELIVERY_WEBHOOK_SECRET?.trim() || "";
  const metaAppSecret = environment.META_WHATSAPP_APP_SECRET?.trim() || "";
  const metaVerifyToken =
    environment.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || "";
  const relayConfigured = relaySecret.length > 0;
  const metaAppSecretConfigured = metaAppSecret.length > 0;
  const metaVerifyTokenConfigured = metaVerifyToken.length > 0;

  if (metaAppSecretConfigured !== metaVerifyTokenConfigured) {
    throw new Error(
      "META_WHATSAPP_APP_SECRET and META_WHATSAPP_WEBHOOK_VERIFY_TOKEN must be configured together in production",
    );
  }
  if (!relayConfigured && !metaAppSecretConfigured) {
    throw new Error(
      "Configure either WHATSAPP_DELIVERY_WEBHOOK_SECRET or the Meta WhatsApp webhook credentials in production",
    );
  }

  if (relayConfigured && Buffer.byteLength(relaySecret, "utf8") < 32) {
    throw new Error(
      "WHATSAPP_DELIVERY_WEBHOOK_SECRET must be at least 32 bytes in production",
    );
  }

  if (
    metaAppSecretConfigured &&
    Buffer.byteLength(metaAppSecret, "utf8") < 32
  ) {
    throw new Error(
      "META_WHATSAPP_APP_SECRET must be at least 32 bytes in production",
    );
  }

  if (
    metaVerifyTokenConfigured &&
    Buffer.byteLength(metaVerifyToken, "utf8") < 32
  ) {
    throw new Error(
      "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN must be at least 32 bytes in production",
    );
  }
}

/**
 * A configured credential is not enough: Firebase Admin can still reject it
 * during module initialization. Production must never fall back to an
 * in-memory session store or uncoordinated background jobs in that case.
 */
export function assertProductionFirestoreAvailable(
  database: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== "production") return;

  const candidate = database as {
    collection?: unknown;
    runTransaction?: unknown;
  } | null;
  if (
    !candidate ||
    typeof candidate.collection !== "function" ||
    typeof candidate.runTransaction !== "function"
  ) {
    throw new Error(
      "Firestore failed to initialize; production startup has been stopped",
    );
  }
}
