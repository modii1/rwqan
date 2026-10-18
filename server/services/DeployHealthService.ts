/**
 * RWQAN DEPLOY — Phase E post-deploy verification.
 *
 * After a (DEV-only) deploy we must prove the RUNNING app matches the deployed
 * commit — a finished deploy command is not proof. This performs a read-only
 * HTTP probe of a version endpoint and compares the reported commit.
 *
 * The probe is side-effect free, refuses production hosts, and never prints a
 * secret (the endpoint returns only a commit/version). The `fetch` implementation
 * is injectable so unit tests never touch the network.
 */
import {
  isFullGitSha,
  type DeployPostDeployVerification,
} from "../../shared/deploySystem";
import { isProductionHost } from "../config/deployTarget";

/** Path a deployed app must expose for verification (JSON `{ commit, version }`). */
export const DEPLOY_VERSION_PATH = "/api/deploy-version";

export interface DeployHealthInput {
  baseUrl: string;
  expectedCommit: string;
  expectedVersion?: string | null;
  timeoutMs?: number;
  /**
   * When FALSE the probe only proves the app is reachable (HTTP 200), not that
   * the reported commit matches. This may be used ONLY when an independent,
   * stronger source-identity proof is mandatory elsewhere (see
   * DeployBuildSourceService / DeployRealExecutor). Defaults to TRUE (strict).
   */
  requireCommitProof?: boolean;
  /**
   * When TRUE the production-host guard is lifted so a LIVE deploy to the real
   * production backend can be verified. Only the LIVE target (which is itself
   * gated by the production opt-in) may set this. Defaults to FALSE.
   */
  allowProductionHost?: boolean;
  /** Injectable fetch (defaults to the global fetch). */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface VersionBody {
  commit?: unknown;
  commitSource?: unknown;
  version?: unknown;
}

function emptyResult(
  input: DeployHealthInput,
  verifiedAt: string,
  overrides: Partial<DeployPostDeployVerification>,
): DeployPostDeployVerification {
  return {
    attempted: true,
    reachable: false,
    ok: false,
    url: null,
    httpStatus: null,
    expectedCommit: input.expectedCommit,
    reportedCommit: null,
    reportedCommitSource: null,
    reportedVersion: null,
    match: false,
    verifiedAt,
    ...overrides,
  };
}

/**
 * Probe `<baseUrl>/api/deploy-version`. `ok` is TRUE only when the endpoint is
 * reachable, returns HTTP 200 with a JSON body whose `commit` is a full 40-char
 * SHA equal to the expected full SHA, whose `commitSource` is `"env"` (the value
 * was injected by the build, not read from local Git), and whose `version`
 * matches the expected version when one is supplied. Any uncertainty
 * (unreachable, bad status, unparseable body, non-SHA/mismatched commit,
 * untrusted source, mismatched/missing version, production host, or bad input)
 * fails closed with `ok:false`.
 *
 * With `requireCommitProof:false` the probe proves ONLY reachability (HTTP 200);
 * it must be used solely when a stronger source-identity proof is mandatory in
 * the caller. It never claims a commit match in that mode.
 */
export async function probeDeployHealth(
  input: DeployHealthInput,
): Promise<DeployPostDeployVerification> {
  const now = input.now ?? (() => new Date());
  const verifiedAt = now().toISOString();
  const fetchImpl = input.fetchImpl ?? fetch;
  const requireCommitProof = input.requireCommitProof ?? true;

  const rawBase = input.baseUrl?.trim();
  if (!rawBase) {
    return emptyResult(input, verifiedAt, { attempted: false, reason: "لا يوجد رابط تحقق مُهيَّأ." });
  }
  if (!input.allowProductionHost && isProductionHost(rawBase)) {
    return emptyResult(input, verifiedAt, { reason: "رابط التحقق يشير إلى مضيف الإنتاج — يُرفض." });
  }

  let url: string;
  try {
    const parsed = new URL(rawBase);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return emptyResult(input, verifiedAt, { reason: "بروتوكول رابط التحقق غير مدعوم." });
    }
    url = new URL(DEPLOY_VERSION_PATH, parsed).toString();
  } catch {
    return emptyResult(input, verifiedAt, { reason: "رابط التحقق غير صالح." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return emptyResult(input, verifiedAt, {
        url,
        httpStatus: response.status,
        reason: `استجابة غير ناجحة من نقطة الإصدار (HTTP ${response.status}).`,
      });
    }
    let body: VersionBody;
    try {
      body = (await response.json()) as VersionBody;
    } catch {
      // A 200 with an unparseable body proves reachability but not identity.
      if (!requireCommitProof) {
        return emptyResult(input, verifiedAt, {
          url,
          httpStatus: response.status,
          reachable: true,
          ok: true,
        });
      }
      return emptyResult(input, verifiedAt, {
        url,
        httpStatus: response.status,
        reachable: true,
        reason: "تعذّر تحليل استجابة الإصدار.",
      });
    }

    const reportedCommit =
      typeof body.commit === "string" && body.commit ? body.commit : null;
    const reportedCommitSource =
      typeof body.commitSource === "string" && body.commitSource
        ? body.commitSource
        : null;
    const reportedVersion =
      typeof body.version === "string" && body.version ? body.version : null;
    // Both sides must be a full 40-char hex SHA, and they must be equal. A short
    // or malformed value is never accepted as proof.
    const match =
      reportedCommit !== null &&
      isFullGitSha(input.expectedCommit) &&
      isFullGitSha(reportedCommit) &&
      reportedCommit === input.expectedCommit;
    // The reported commit is only trusted when it was injected by the build
    // (commitSource "env"); a value read from `git rev-parse HEAD` or an unknown
    // source is never accepted as a verified deployed revision.
    const sourceTrusted = reportedCommitSource === "env";
    // Version is fail-closed: when an expected version is supplied it MUST be
    // present and equal; a missing reported version fails verification.
    const versionOk = !input.expectedVersion || reportedVersion === input.expectedVersion;
    // When commit proof is required: match + trusted source + version all needed.
    // When it is NOT required (a stronger control-plane proof is mandatory in the
    // caller), a reachable HTTP 200 is enough and no identity is claimed.
    const ok = requireCommitProof ? match && sourceTrusted && versionOk : true;

    let reason: string | undefined;
    if (requireCommitProof && !match) {
      reason = "الـcommit الذي يعمل فعليًا لا يطابق الـcommit المنشور.";
    } else if (requireCommitProof && !sourceTrusted) {
      reason = "هوية الإصدار غير موثوقة — لم تُحقن من عملية البناء (commitSource يساوي env مطلوب).";
    } else if (requireCommitProof && !versionOk) {
      reason = "الإصدار الذي يعمل فعليًا لا يطابق الإصدار المنشور.";
    }

    return {
      attempted: true,
      reachable: true,
      ok,
      url,
      httpStatus: response.status,
      expectedCommit: input.expectedCommit,
      reportedCommit,
      reportedCommitSource,
      reportedVersion,
      match,
      verifiedAt,
      ...(reason ? { reason } : {}),
    };
  } catch (error) {
    return emptyResult(input, verifiedAt, {
      url,
      reason:
        error instanceof Error && error.name === "AbortError"
          ? "انتهت مهلة التحقق بعد النشر."
          : "تعذّر الوصول إلى التطبيق المنشور للتحقق.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
