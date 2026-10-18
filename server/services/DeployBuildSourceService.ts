/**
 * RWQAN DEPLOY — authoritative source-identity verification for App Hosting.
 *
 * WHY THIS EXISTS
 * Firebase App Hosting does NOT expose the built git commit to the running
 * container (the only Firebase-provided env vars are `FIREBASE_CONFIG` and
 * `FIREBASE_WEBAPP_CONFIG`; there is no commit/build-id variable, and env var
 * names cannot start with `X_FIREBASE_`). Therefore the app can NOT truthfully
 * self-report the commit it was built from, and `GET /api/deploy-version` (which
 * reports an injected env value when present) is NOT by itself proof of the
 * deployed revision.
 *
 * The ONE trustworthy link between a source commit and a deployed build lives in
 * the App Hosting control plane: for a backend connected to a GitHub repo, the
 * `Build` resource carries `source.codebase.hash` — the full SHA-1 of the commit
 * the build was created from, recorded by Google at build time.
 *
 * WHICH build is "the deployed one" is resolved from the backend's LIVE traffic
 * (`traffic.current`): the single split at 100% while NOT reconciling. We never
 * assume the newest SUCCEEDED rollout — that rollout may not be serving. This
 * service reads the serving build's `source.codebase.hash` and compares it
 * against the expected commit.
 * HARD LIMITS (fail closed, never invent a guarantee):
 *   - A LOCAL `firebase deploy` uploads an archive with NO commit, so its Build
 *     `source` is an `archive`/`container` with no `codebase.hash`. In that case
 *     verification can NEVER pass — this is reported explicitly.
 *   - The backend must be GitHub-connected (Developer Connect) and rolled out
 *     with `apphosting:rollouts:create --git-commit <full-sha>` for a commit to
 *     be recorded at all.
 *   - Everything is injectable so the logic is unit-tested with no network. The
 *     live client is READ-ONLY and requires credentials; it is never exercised
 *     by tests and is off unless explicitly enabled.
 */
import { isFullGitSha } from "../../shared/deploySystem";
import { DEPLOY_APP_HOSTING_LOCATION_ENV_KEY } from "../config/deployTarget";

/** Opt-in flag for the control-plane source verification (default: off). */
export const DEPLOY_BUILD_SOURCE_VERIFY_ENV_KEY = "DEPLOY_BUILD_SOURCE_VERIFY";
export const DEPLOY_BUILD_SOURCE_VERIFY_ENABLED_VALUE = "enabled";
/** App Hosting location (region) of the backend, e.g. `us-central1`. */
export { DEPLOY_APP_HOSTING_LOCATION_ENV_KEY };

/** Which kind of source the App Hosting Build was created from. */
export type AppHostingSourceKind =
  | "codebase"
  | "container"
  | "archive"
  | "unknown";

/**
 * Traffic resolution state of the backend, read from the traffic control plane.
 * Only `"ready"` supports a source proof; every other state fails closed so we
 * never mistake a non-serving build for the live revision.
 */
export type AppHostingTrafficState =
  | "ready"
  | "reconciling"
  | "no-traffic"
  | "ambiguous"
  | "unknown";

/** The source identity recorded by App Hosting for the build SERVING traffic. */
export interface AppHostingBuildSource {
  /** Full 40-char commit SHA, only for a `codebase` source; else null. */
  commitSha: string | null;
  sourceKind: AppHostingSourceKind;
  /** Resource name of the build that currently serves 100% of traffic. */
  buildName: string | null;
  /** Whether traffic could be resolved to exactly one 100% build. */
  state: AppHostingTrafficState;
}

export interface AppHostingBackendRef {
  projectId: string;
  backendId: string;
  location: string;
}

/** Reads the source identity of the build currently serving a backend. */
export interface AppHostingBuildSourceClient {
  getServingBuildSource(
    backend: AppHostingBackendRef,
  ): Promise<AppHostingBuildSource>;
}

/** Result of comparing the expected commit with the build's recorded source. */
export interface BuildSourceVerification {
  /** TRUE when the control plane was actually queried. */
  attempted: boolean;
  /** TRUE only when the build source is a codebase whose hash equals expected. */
  ok: boolean;
  backend: string;
  expectedCommit: string;
  reportedCommit: string | null;
  sourceKind: AppHostingSourceKind;
  reason?: string;
  verifiedAt: string;
}

/**
 * Compare the expected full SHA with the commit App Hosting recorded for the
 * serving build. Fails closed on ANY uncertainty: a malformed/empty expected
 * value, a read error, a non-`codebase` source (no commit), a non-full reported
 * SHA, or a mismatch.
 */
export async function verifyAppHostingBuildSource(
  input: { expectedCommit: string; backend: AppHostingBackendRef },
  client: AppHostingBuildSourceClient,
  now: () => string = () => new Date().toISOString(),
): Promise<BuildSourceVerification> {
  const verifiedAt = now();
  const base: BuildSourceVerification = {
    attempted: false,
    ok: false,
    backend: input.backend.backendId,
    expectedCommit: input.expectedCommit,
    reportedCommit: null,
    sourceKind: "unknown",
    verifiedAt,
  };

  if (!isFullGitSha(input.expectedCommit)) {
    return {
      ...base,
      reason: "الـcommit المتوقع ليس SHA كاملًا (40 خانة سداسية) — لا يمكن التحقق.",
    };
  }

  let source: AppHostingBuildSource;
  try {
    source = await client.getServingBuildSource(input.backend);
  } catch {
    return {
      ...base,
      attempted: true,
      reason: "تعذّر قراءة هوية مصدر البناء من لوحة تحكم App Hosting.",
    };
  }

  const result: BuildSourceVerification = {
    ...base,
    attempted: true,
    reportedCommit: source.commitSha,
    sourceKind: source.sourceKind,
  };

  // The serving build must be resolved unambiguously from the backend's live
  // traffic first; anything else fails closed (never assume "newest SUCCEEDED").
  if (source.state !== "ready") {
    return {
      ...result,
      reason: trafficStateReason(source.state),
    };
  }

  if (source.sourceKind !== "codebase") {
    return {
      ...result,
      reason:
        "مصدر البناء ليس مستودعًا مرتبطًا (archive/container) — لا يوجد commit موثوق مخزَّن (النشر المحلي لا يسجّل commit).",
    };
  }
  const reported = source.commitSha;
  if (typeof reported !== "string" || !isFullGitSha(reported)) {
    return {
      ...result,
      reason: "البناء لا يحمل SHA كاملًا في source.codebase.hash.",
    };
  }
  if (reported.toLowerCase() !== input.expectedCommit.toLowerCase()) {
    return {
      ...result,
      reason: "commit المخزَّن في البناء لا يطابق الـcommit المتوقع.",
    };
  }

  return { ...result, ok: true };
}

/** Non-secret, fail-closed explanation for a non-`ready` traffic state. */
function trafficStateReason(state: AppHostingTrafficState): string {
  switch (state) {
    case "reconciling":
      return "حركة المرور قيد المزامنة (reconciling) — لا يمكن تأكيد الإصدار الذي يخدم فعليًا.";
    case "no-traffic":
      return "لا توجد حركة مرور مُخصَّصة (لا يوجد build بنسبة 100%).";
    case "ambiguous":
      return "حركة المرور ملتبسة (أكثر من build بنسبة 100%) — لا يمكن تأكيد الإصدار الفعلي.";
    default:
      return "تعذّر تحديد الإصدار الذي يخدم حركة المرور فعليًا.";
  }
}

export interface AppHostingVerifyConfig {
  enabled: boolean;
  location: string | null;
  reason?: string;
}

/**
 * Resolve whether control-plane verification is enabled. Fail closed: it is off
 * unless the explicit flag AND a location are provided.
 */
export function resolveAppHostingVerifyConfig(
  environment: Record<string, string | undefined> = process.env,
): AppHostingVerifyConfig {
  const enabled =
    environment[DEPLOY_BUILD_SOURCE_VERIFY_ENV_KEY]?.trim() ===
    DEPLOY_BUILD_SOURCE_VERIFY_ENABLED_VALUE;
  if (!enabled) {
    return { enabled: false, location: null, reason: "التحقق من مصدر البناء غير مُفعَّل." };
  }
  const location =
    environment[DEPLOY_APP_HOSTING_LOCATION_ENV_KEY]?.trim() ?? "";
  if (!location) {
    return {
      enabled: false,
      location: null,
      reason: `مطلوب ${DEPLOY_APP_HOSTING_LOCATION_ENV_KEY} لتفعيل التحقق من مصدر البناء.`,
    };
  }
  return { enabled: true, location };
}

/** Signature the executor uses; project/backend come from the fixed DEV target. */
export type BuildSourceVerifier = (input: {
  expectedCommit: string;
  projectId: string;
  backendId: string;
}) => Promise<BuildSourceVerification>;

/**
 * Build the executor dependency, or `undefined` when verification is disabled or
 * misconfigured (so the caller stays fail-closed by NOT claiming a proof).
 */
export function createAppHostingVerifyDependency(
  environment: Record<string, string | undefined> = process.env,
  client?: AppHostingBuildSourceClient,
): BuildSourceVerifier | undefined {
  const config = resolveAppHostingVerifyConfig(environment);
  if (!config.enabled || !config.location) return undefined;
  const location = config.location;
  const sourceClient = client ?? createAppHostingBuildSourceClient();
  return (input) =>
    verifyAppHostingBuildSource(
      {
        expectedCommit: input.expectedCommit,
        backend: {
          projectId: input.projectId,
          backendId: input.backendId,
          location,
        },
      },
      sourceClient,
    );
}

/** Minimal structural view of the App Hosting REST client we depend on. */
export interface AppHostingApiLike {
  projects: {
    locations: {
      backends: {
        traffic: {
          get(params: { name: string }): Promise<{
            data: AppHostingTrafficLike;
          }>;
        };
        builds: {
          get(params: { name: string }): Promise<{
            data: AppHostingBuildLike;
          }>;
        };
      };
    };
  };
}

interface AppHostingTrafficLike {
  reconciling?: boolean | null;
  current?: {
    splits?: Array<{ build?: string | null; percent?: number | null }> | null;
  } | null;
}

interface AppHostingBuildLike {
  source?: {
    codebase?: { hash?: string | null } | null;
    container?: unknown;
    archive?: unknown;
  } | null;
}

/**
 * Real, READ-ONLY client over the App Hosting v1beta REST API. The serving build
 * is resolved from the backend's LIVE traffic (`traffic.current`): exactly one
 * split at 100% while not reconciling. Anything else (reconciling, no traffic,
 * multiple 100% splits) is reported as a non-`ready` state and fails closed.
 * The build's `source.codebase.hash` is then returned. `googleapis` is imported
 * lazily so it is only loaded when verification is actually enabled.
 */
export function createAppHostingBuildSourceClient(options: {
  api?: AppHostingApiLike;
} = {}): AppHostingBuildSourceClient {
  return {
    async getServingBuildSource(backend) {
      const api = options.api ?? (await loadAppHostingApi());
      const name = `projects/${backend.projectId}/locations/${backend.location}/backends/${backend.backendId}/traffic`;

      const trafficResponse = await api.projects.locations.backends.traffic.get({
        name,
      });
      const traffic = trafficResponse.data;

      if (traffic.reconciling === true) {
        return unknownSource("reconciling");
      }

      const splits = traffic.current?.splits ?? [];
      const active = splits.filter((split) => split.percent === 100);
      if (active.length === 0) {
        return unknownSource("no-traffic");
      }
      if (active.length > 1) {
        return unknownSource("ambiguous");
      }

      const buildName = active[0]!.build ?? null;
      if (!buildName) {
        return unknownSource("unknown");
      }

      const buildResponse = await api.projects.locations.backends.builds.get({
        name: buildName,
      });
      const source = buildSource(buildResponse.data.source);
      return {
        commitSha: source.commitSha,
        sourceKind: source.sourceKind,
        buildName,
        state: "ready",
      };
    },
  };
}

function unknownSource(state: AppHostingTrafficState): AppHostingBuildSource {
  return { commitSha: null, sourceKind: "unknown", buildName: null, state };
}

function buildSource(source: AppHostingBuildLike["source"]): {
  commitSha: string | null;
  sourceKind: AppHostingSourceKind;
} {
  if (!source) return { commitSha: null, sourceKind: "unknown" };
  if (source.codebase) {
    return { commitSha: source.codebase.hash ?? null, sourceKind: "codebase" };
  }
  if (source.container) return { commitSha: null, sourceKind: "container" };
  if (source.archive) return { commitSha: null, sourceKind: "archive" };
  return { commitSha: null, sourceKind: "unknown" };
}

async function loadAppHostingApi(): Promise<AppHostingApiLike> {
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  // `google.firebaseapphosting` is the version-selectable factory exposed by the
  // installed googleapis build; `firebaseapphosting_v1beta` does not exist and
  // would throw a TypeError, silently failing the mandatory source proof.
  const factory = (
    google as unknown as {
      firebaseapphosting: (options: {
        version: string;
        auth: unknown;
      }) => unknown;
    }
  ).firebaseapphosting;
  const client = factory({ version: "v1beta", auth });
  return client as AppHostingApiLike;
}
