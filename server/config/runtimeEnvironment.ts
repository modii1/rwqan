const PRODUCTION_SECURITY_ENV_KEYS = [
  "ADMIN_CODE",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "PAYMOB_HMAC_SECRET",
  "FIREBASE_SERVICE_ACCOUNT",
] as const;

const DEVELOPMENT_EXTERNAL_SERVICE_ENV_KEYS = [
  "PAYMOB_API_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_LEGACY_API_KEY",
  "META_WHATSAPP_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "ENJAZATIK_URL",
  "ENJAZATIK_TOKEN",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "GEMINI_API_KEY",
  "OCR_API_KEY",
  "BOOKING_WORKER_SECRET",
] as const;

const ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT_KEY =
  "ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT";

/**
 * Paymob-only development opt-in. Deliberately independent from
 * ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT so a DEV Paymob test cannot enable
 * WhatsApp, Gemini, OCR, or disable the DEV customer OTP console sink.
 */
const PAYMOB_ALLOW_IN_DEVELOPMENT_KEY = "PAYMOB_ALLOW_IN_DEVELOPMENT";

const PAYMOB_DEVELOPMENT_ENV_KEYS = new Set<string>([
  "PAYMOB_API_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_LEGACY_API_KEY",
]);

/**
 * Paymob Secret Keys and Public Keys embed their target environment as an
 * explicit `sk_test_` / `sk_live_` (or `pk_test_` / `pk_live_`) segment, usually
 * prefixed by a region code such as `sau_`. The API Key and the HMAC secret are
 * shared across both environments and therefore carry no mode marker, so they
 * are intentionally excluded from this check.
 */
const PAYMOB_MODE_BEARING_KEY_PATTERN =
  /^(?:[a-z]{2,4}_)?(?:sk|pk)_(test|live)_[A-Za-z0-9]+$/;

const PAYMOB_MODE_BEARING_ENV_KEYS = [
  "PAYMOB_API_KEY",
  "PAYMOB_PUBLIC_KEY",
] as const;

export type PaymobKeyMode = "test" | "live" | "unknown";

export function classifyPaymobKeyMode(value: string): PaymobKeyMode {
  const match = value.trim().match(PAYMOB_MODE_BEARING_KEY_PATTERN);
  if (!match) return "unknown";
  return match[1] === "live" ? "live" : "test";
}

/**
 * Refuse to start when a Paymob key targets the wrong environment. Production
 * must use `live` keys; every non-production runtime (including a missing or
 * unexpected NODE_ENV) must use `test` keys. A key that does not carry a
 * recognizable mode marker is never guessed: it fails closed. Absent keys are
 * skipped so runtimes with Paymob disabled still boot. Never prints key values.
 */
export function assertPaymobKeyEnvironmentMatch(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const expected: PaymobKeyMode =
    environment.NODE_ENV === "production" ? "live" : "test";

  for (const key of PAYMOB_MODE_BEARING_ENV_KEYS) {
    const raw = environment[key]?.trim();
    if (!raw) continue;

    const mode = classifyPaymobKeyMode(raw);
    if (mode === "unknown") {
      throw new Error(
        `Paymob key environment check: ${key} does not carry a recognizable test/live mode marker; refusing to start rather than guess the environment.`,
      );
    }

    if (mode !== expected) {
      throw new Error(
        `Paymob key environment mismatch: ${key} is a ${mode} key but the runtime requires ${expected} keys. Refusing to start.`,
      );
    }
  }
}

export function externalServicesEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.NODE_ENV !== "development") return true;
  return environment[ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT_KEY] === "true";
}

/**
 * Paymob is enabled only in production, or outside production when the dedicated
 * PAYMOB_ALLOW_IN_DEVELOPMENT="true" opt-in is set. A missing or unexpected
 * NODE_ENV is treated like development: blocked unless explicitly opted in, so
 * an ambiguously configured runtime can never start a Paymob payment. This never
 * enables the other external services and never disables the DEV customer OTP
 * console sink.
 */
export function paymobEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.NODE_ENV === "production") return true;
  return environment[PAYMOB_ALLOW_IN_DEVELOPMENT_KEY] === "true";
}

const FIREBASE_DEV_PROJECT_ID_KEY = "FIREBASE_DEV_PROJECT_ID";

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

export function assertDevelopmentIsolation(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV === "production") return;
  if (environment[ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT_KEY] === "true") {
    return;
  }

  const paymobOptIn =
    environment[PAYMOB_ALLOW_IN_DEVELOPMENT_KEY] === "true";

  const present = DEVELOPMENT_EXTERNAL_SERVICE_ENV_KEYS.filter((key) => {
    if (!environment[key]?.trim()) return false;
    // Paymob keys are allowed under their own explicit DEV opt-in. All other
    // external-service credentials still require the global opt-in flag.
    if (paymobOptIn && PAYMOB_DEVELOPMENT_ENV_KEYS.has(key)) return false;
    return true;
  });

  if (present.length > 0) {
    throw new Error(
      `Development isolation block: external service credentials present without ${ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT_KEY}="true": ${present.join(", ")}`,
    );
  }
}

export function getFirebaseProjectId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = environment.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { project_id?: unknown };
    return typeof parsed.project_id === "string" && parsed.project_id
      ? parsed.project_id
      : null;
  } catch {
    return null;
  }
}

export function assertFirebaseDevIsolation(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV === "production") return;

  const projectId = getFirebaseProjectId(environment);
  if (projectId === null) return;

  const expected = environment[FIREBASE_DEV_PROJECT_ID_KEY]?.trim();
  if (!expected) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT is present but ${FIREBASE_DEV_PROJECT_ID_KEY} is not set; refusing to start against an unknown Firebase project.`,
    );
  }

  if (projectId !== expected) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT does not match ${FIREBASE_DEV_PROJECT_ID_KEY}; refusing to start against the wrong Firebase project.`,
    );
  }
}

/**
 * DEV-only admin credentials must never be usable outside the isolated local
 * development target. Credentials are flagged as DEV-only either by the
 * DEV_ONLY_ prefix on ADMIN_CODE/ADMIN_PASSWORD (a non-secret sentinel) or by an
 * explicit DEV_ONLY_ADMIN_CREDENTIALS=true marker in the ignored
 * .env.development.local file. When flagged, this guard refuses to start unless
 * NODE_ENV is "development" AND the configured Firebase project is the isolated
 * DEV project. The actual credential values live only in the ignored
 * .env.development.local file and are never echoed in the error messages.
 */
export const DEV_ONLY_ADMIN_CREDENTIAL_PREFIX = "DEV_ONLY_";
export const DEV_ONLY_ADMIN_CREDENTIALS_KEY = "DEV_ONLY_ADMIN_CREDENTIALS";
export const DEV_FIREBASE_PROJECT_ID = "rwqan-sa-dev";

function devOnlyAdminCredentialsMarked(
  environment: NodeJS.ProcessEnv,
): boolean {
  const marker = environment[DEV_ONLY_ADMIN_CREDENTIALS_KEY];
  return typeof marker === "string" && marker.trim().toLowerCase() === "true";
}

export function assertDevOnlyAdminCredentialsIsolation(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const code = environment.ADMIN_CODE?.trim() ?? "";
  const password = environment.ADMIN_PASSWORD?.trim() ?? "";
  const isDevOnlyCredential =
    devOnlyAdminCredentialsMarked(environment) ||
    code.startsWith(DEV_ONLY_ADMIN_CREDENTIAL_PREFIX) ||
    password.startsWith(DEV_ONLY_ADMIN_CREDENTIAL_PREFIX);

  if (!isDevOnlyCredential) return;

  if (environment.NODE_ENV !== "development") {
    throw new Error(
      `Environment isolation block: DEV-only admin credentials (${DEV_ONLY_ADMIN_CREDENTIALS_KEY} marker or ${DEV_ONLY_ADMIN_CREDENTIAL_PREFIX} prefix) are only allowed when NODE_ENV=development.`,
    );
  }

  const projectId = getFirebaseProjectId(environment);
  if (projectId !== DEV_FIREBASE_PROJECT_ID) {
    throw new Error(
      `Environment isolation block: DEV-only admin credentials require Firebase project ${DEV_FIREBASE_PROJECT_ID} (found: ${projectId ?? "none"}).`,
    );
  }
}

const DEV_CUSTOMER_OTP_SINK_KEY = "DEV_CUSTOMER_OTP_SINK";
const DEV_CUSTOMER_OTP_SINK_CONSOLE = "console";

/**
 * Local-only override for the customer phone OTP *transport*. When enabled, the
 * real (random, HMAC-hashed) OTP is written to the server console instead of
 * being sent over WhatsApp, so the customer sign-in ceremony can be exercised in
 * an isolated DEV run without contacting any external service. It only changes
 * delivery, never code generation or verification.
 *
 * Enabled strictly when ALL hold: NODE_ENV=development, DEV_CUSTOMER_OTP_SINK
 * =console, external services are disabled, and the Firebase project is the
 * isolated DEV project. Any other environment keeps the real WhatsApp sender.
 */
export function devCustomerOtpSinkEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.NODE_ENV !== "development") return false;
  if (environment[DEV_CUSTOMER_OTP_SINK_KEY]?.trim() !== DEV_CUSTOMER_OTP_SINK_CONSOLE) {
    return false;
  }
  if (externalServicesEnabled(environment)) return false;
  return getFirebaseProjectId(environment) === DEV_FIREBASE_PROJECT_ID;
}
