import { createHash } from "node:crypto";
import type { Finding } from "./types";

/**
 * Secret-aware redaction. The scanner MUST never print or persist secret values.
 * This module masks values for known secret env keys and generic long-token /
 * key-material patterns. Evidence strings from tool output are run through this
 * before being stored or rendered.
 */

export const SECRET_ENV_KEY_NAMES: readonly string[] = [
  "ADMIN_CODE",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "PAYMOB_API_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_LEGACY_API_KEY",
  "META_WHATSAPP_TOKEN",
  "META_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "ENJAZATIK_URL",
  "ENJAZATIK_TOKEN",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_CLIENT_EMAIL",
  "GEMINI_API_KEY",
  "OCR_API_KEY",
  "OPENAI_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "FIREBASE_SERVICE_ACCOUNT",
  "BOOKING_WORKER_SECRET",
];

const KEY_VALUE_PATTERNS: RegExp[] = SECRET_ENV_KEY_NAMES.map(
  (key) => new RegExp(`(${escapeRegExp(key)}\\s*[=:]\\s*)([^\\s,;'"}]+)`, "gi"),
);

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g;

const GENERIC_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{32,})\b/g;

const HEX_SECRET = /\b(?:[0-9a-f]{40,})\b/g;

const SA_EMAIL = /\b[\w.+-]+@[\w-]+\.(?:iam\.gserviceaccount\.com|gserviceaccount\.com)\b/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactText(value: string): string {
  if (!value) return value;
  let out = value;
  out = out.replace(PRIVATE_KEY_BLOCK, "[REDACTED:PRIVATE_KEY]");
  out = out.replace(SA_EMAIL, "[REDACTED:SERVICE_ACCOUNT_EMAIL]");
  for (const pattern of KEY_VALUE_PATTERNS) {
    out = out.replace(pattern, "$1[REDACTED]");
  }
  out = out.replace(GENERIC_TOKEN, "[REDACTED:TOKEN]");
  out = out.replace(HEX_SECRET, "[REDACTED:HEX]");
  return out;
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function redactFinding(finding: Finding): Finding {
  return {
    ...finding,
    title: redactText(finding.title),
    description: redactText(finding.description),
    evidence: redactText(finding.evidence),
  };
}

export function isPotentialSecret(value: string): boolean {
  return (
    PRIVATE_KEY_BLOCK.test(value) ||
    /(?:sk-[A-Za-z0-9_-]{10,})/.test(value) ||
    /(?:AIza[A-Za-z0-9_-]{20,})/.test(value) ||
    /(?:BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY)/.test(value)
  );
}