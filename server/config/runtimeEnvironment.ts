const PRODUCTION_SECURITY_ENV_KEYS = [
  "ADMIN_CODE",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
] as const;

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
}
