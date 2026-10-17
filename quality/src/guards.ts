import {
  assertDevelopmentIsolation,
  assertFirebaseDevIsolation,
  assertProductionSecurityEnvironment,
} from "../../server/config/runtimeEnvironment";
import { assertR2DevIsolation } from "../../server/utils/r2";

export interface E2ETargetValidationOptions {
  requireDevEnv: boolean;
  blockProduction: boolean;
  blockExternalServicesInDev: boolean;
  blockProdR2InDev: boolean;
  blockProdFirebaseInDev: boolean;
  allowedBaseUrl?: string;
}

const DEFAULT_OPTIONS: E2ETargetValidationOptions = {
  requireDevEnv: true,
  blockProduction: true,
  blockExternalServicesInDev: true,
  blockProdR2InDev: true,
  blockProdFirebaseInDev: true,
};

export interface E2ETargetValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  context: {
    nodeEnv: string | undefined;
    port: string | undefined;
    publicBaseUrl: string | undefined;
    firebaseDevProjectId: string | undefined;
    firebaseServiceAccountProjectId: string | null;
    r2Bucket: string | undefined;
    r2PublicUrl: string | undefined;
    allowExternalServicesInDev: string | undefined;
  };
}

function safeTrim(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getFirebaseServiceAccountProjectId(
  environment: NodeJS.ProcessEnv,
): string | null {
  const raw = safeTrim(environment.FIREBASE_SERVICE_ACCOUNT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { project_id?: unknown };
    if (typeof parsed.project_id === "string" && parsed.project_id.trim()) {
      return parsed.project_id.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export function assertE2ETargetIsDevelopment(
  environment: NodeJS.ProcessEnv = process.env,
  options: Partial<E2ETargetValidationOptions> = {},
): E2ETargetValidationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  const warnings: string[] = [];

  const context: E2ETargetValidationResult["context"] = {
    nodeEnv: safeTrim(environment.NODE_ENV),
    port: safeTrim(environment.PORT),
    publicBaseUrl: safeTrim(environment.PUBLIC_BASE_URL),
    firebaseDevProjectId: safeTrim(environment.FIREBASE_DEV_PROJECT_ID),
    firebaseServiceAccountProjectId: getFirebaseServiceAccountProjectId(environment),
    r2Bucket: safeTrim(environment.R2_BUCKET_NAME),
    r2PublicUrl: safeTrim(environment.R2_PUBLIC_URL),
    allowExternalServicesInDev: safeTrim(environment.ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT),
  };

  if (opts.requireDevEnv && context.nodeEnv !== "development") {
    errors.push(`NODE_ENV must be "development" (found: ${context.nodeEnv ?? "undefined"})`);
  }

  if (opts.blockProduction) {
    try {
      assertProductionSecurityEnvironment(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }

  if (opts.blockExternalServicesInDev) {
    try {
      assertDevelopmentIsolation(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }

  if (opts.blockProdFirebaseInDev) {
    try {
      assertFirebaseDevIsolation(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }

  if (opts.blockProdR2InDev) {
    try {
      assertR2DevIsolation(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }

  if (opts.allowedBaseUrl && context.publicBaseUrl) {
    if (context.publicBaseUrl !== opts.allowedBaseUrl) {
      errors.push(
        `PUBLIC_BASE_URL (${context.publicBaseUrl}) must match allowed target (${opts.allowedBaseUrl})`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    context,
  };
}
