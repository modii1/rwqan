/**
 * Password hashing and verification utilities using Argon2id
 */
import { hash, verify } from "argon2";

export const ARGON2ID_HASH_PREFIX = "$argon2id$";

export type PasswordFormat = "hashed" | "plaintext" | "missing";

export function isArgon2idHash(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.startsWith(ARGON2ID_HASH_PREFIX);
}

export function detectPasswordFormat(value: unknown): PasswordFormat {
  if (typeof value !== "string") return "missing";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "missing";
  if (isArgon2idHash(trimmed)) return "hashed";
  return "plaintext";
}

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string") {
    throw new TypeError("Password must be a string");
  }
  return hash(plain);
}

/**
 * Store an Argon2id hash. An existing Argon2id value is returned unchanged so
 * callers can safely pass either a plaintext PIN or an already-hashed value.
 */
export async function ensureArgon2idHash(value: string): Promise<string> {
  if (typeof value !== "string") {
    throw new TypeError("Password must be a string");
  }
  return isArgon2idHash(value) ? value : hashPassword(value);
}

export async function verifyPassword(stored: string, candidate: string): Promise<boolean> {
  if (typeof stored !== "string" || typeof candidate !== "string") {
    return false;
  }
  const format = detectPasswordFormat(stored);
  if (format === "missing") return false;
  if (format === "hashed") {
    try {
      return await verify(stored, candidate);
    } catch {
      return false;
    }
  }
  return stored === candidate;
}