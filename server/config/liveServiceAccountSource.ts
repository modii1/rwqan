/**
 * RWQAN LIVE DATA — locate the dedicated read-only service-account key.
 *
 * The LIVE preview needs a dedicated READ-ONLY Firebase service account that
 * lives OUTSIDE the repository. Instead of pasting the whole JSON body into the
 * environment, `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` may hold:
 *
 *   1. the service-account JSON itself (already supported by the gate), or
 *   2. a file path — absolute, or a bare filename resolved inside the current
 *      Windows user's Downloads folder, or
 *   3. nothing — in which case the Downloads folder is scanned for a single
 *      matching service account.
 *
 * This module only ever reads files. It never logs, copies, or returns a key
 * body inside a reason string: reasons name the path / candidate file names and
 * never the secret content. When zero or several candidates exist it fails
 * closed and states the exact path that must be provided, without guessing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LIVE_FIREBASE_PROJECT_ID_KEY,
  LIVE_FIREBASE_SERVICE_ACCOUNT_KEY,
} from "./liveDataEnvironment";

/** Optional override for the folder that holds the key (defaults to ~/Downloads). */
export const LIVE_SERVICE_ACCOUNT_DIR_KEY = "LIVE_FIREBASE_SERVICE_ACCOUNT_DIR";

export interface LiveServiceAccountSourceDeps {
  homedir: () => string;
  existsSync: (filePath: string) => boolean;
  readFileSync: (filePath: string, encoding: "utf8") => string;
  readdirSync: (dirPath: string) => string[];
}

const defaultDeps: LiveServiceAccountSourceDeps = {
  homedir: () => os.homedir(),
  existsSync: (filePath) => fs.existsSync(filePath),
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  readdirSync: (dirPath) => fs.readdirSync(dirPath),
};

export interface LiveServiceAccountResolution {
  /** The raw service-account JSON, or NULL when the key could not be located. */
  serviceAccountJson: string | null;
  /** The file that was used, or the file that was expected, when relevant. */
  resolvedPath: string | null;
  /** A non-secret explanation suitable for a fail-closed message. */
  reason: string;
}

function isServiceAccount(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "service_account"
  );
}

export function resolveLiveServiceAccount(
  environment: NodeJS.ProcessEnv = process.env,
  deps: LiveServiceAccountSourceDeps = defaultDeps,
): LiveServiceAccountResolution {
  const raw = environment[LIVE_FIREBASE_SERVICE_ACCOUNT_KEY]?.trim() ?? "";
  if (raw.startsWith("{")) {
    return { serviceAccountJson: raw, resolvedPath: null, reason: "" };
  }

  const projectId = environment[LIVE_FIREBASE_PROJECT_ID_KEY]?.trim() ?? "";
  const baseDir =
    environment[LIVE_SERVICE_ACCOUNT_DIR_KEY]?.trim() ||
    path.join(deps.homedir(), "Downloads");

  if (raw) {
    const resolvedPath = path.isAbsolute(raw) ? raw : path.join(baseDir, raw);
    if (!deps.existsSync(resolvedPath)) {
      return {
        serviceAccountJson: null,
        resolvedPath,
        reason: `لم يُعثر على ملف مفتاح LIVE على المسار المطلوب: ${resolvedPath}. ضع ملف حساب الخدمة (قراءة فقط) في هذا المسار أو اضبط ${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} عليه.`,
      };
    }
    try {
      const content = deps.readFileSync(resolvedPath, "utf8").trim();
      if (!content.startsWith("{")) throw new Error("not json");
      return { serviceAccountJson: content, resolvedPath, reason: "" };
    } catch {
      return {
        serviceAccountJson: null,
        resolvedPath,
        reason: `ملف مفتاح LIVE على المسار ${resolvedPath} غير قابل للقراءة أو ليس JSON صالحًا.`,
      };
    }
  }

  let entries: string[];
  try {
    entries = deps.readdirSync(baseDir);
  } catch {
    return {
      serviceAccountJson: null,
      resolvedPath: null,
      reason: `لم يُعثر على مجلد مفتاح LIVE المتوقَّع: ${baseDir}. اضبط ${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} على مسار ملف الحساب (قراءة فقط).`,
    };
  }

  const candidates: string[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    const fullPath = path.join(baseDir, name);
    try {
      const parsed = JSON.parse(deps.readFileSync(fullPath, "utf8")) as unknown;
      if (!isServiceAccount(parsed)) continue;
      if (projectId && parsed.project_id !== projectId) continue;
      candidates.push(fullPath);
    } catch {
      // Not JSON (or unreadable) — ignore, it cannot be a service account.
    }
  }

  if (candidates.length === 1) {
    const content = deps.readFileSync(candidates[0], "utf8").trim();
    return { serviceAccountJson: content, resolvedPath: candidates[0], reason: "" };
  }

  if (candidates.length === 0) {
    return {
      serviceAccountJson: null,
      resolvedPath: null,
      reason: `لم يُعثر على مفتاح حساب خدمة LIVE${
        projectId ? ` للمشروع ${projectId}` : ""
      } في ${baseDir}. ضع ملف JSON في هذا المجلد أو اضبط ${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} على مساره.`,
    };
  }

  return {
    serviceAccountJson: null,
    resolvedPath: null,
    reason: `وُجد أكثر من ملف مفتاح محتمل لـ LIVE في ${baseDir}: ${candidates
      .map((candidate) => path.basename(candidate))
      .join("، ")}. اضبط ${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} على المسار الصحيح دون تخمين.`,
  };
}

/**
 * Resolve the LIVE read-only service account and, on success, replace the
 * environment value (path / filename) with the actual JSON so the pure gate in
 * `liveDataEnvironment` can consume it unchanged.
 */
export function hydrateLiveServiceAccount(
  environment: NodeJS.ProcessEnv = process.env,
  deps: LiveServiceAccountSourceDeps = defaultDeps,
): LiveServiceAccountResolution {
  const resolution = resolveLiveServiceAccount(environment, deps);
  if (resolution.serviceAccountJson) {
    environment[LIVE_FIREBASE_SERVICE_ACCOUNT_KEY] = resolution.serviceAccountJson;
  }
  return resolution;
}
