const DEVELOPMENT_SCHEDULER_OPT_IN =
  "ENABLE_SCHEDULERS_IN_DEVELOPMENT";

/**
 * Scheduled background work is automatic only in production. Development can
 * opt in explicitly, while test and other environments always remain inert.
 */
export function shouldStartScheduledBackgroundWork(
  environment: NodeJS.ProcessEnv = process.env,
  additionalDevelopmentOptInKeys: readonly string[] = [],
): boolean {
  if (environment.NODE_ENV === "production") return true;
  if (environment.NODE_ENV !== "development") return false;

  return [
    DEVELOPMENT_SCHEDULER_OPT_IN,
    ...additionalDevelopmentOptInKeys,
  ].some((key) => environment[key] === "true");
}
