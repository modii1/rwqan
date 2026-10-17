import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";

export interface TrackedFile {
  rel: string;
  abs: string;
  content: string;
}

export interface ScanContext {
  repoPath: string;
  files: TrackedFile[];
  gitTracked: Set<string>;
  console: (line: string) => void;
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".firebase",
  ".backup-history",
  "_client_backup",
]);

const EXCLUDED_FILES = new Set([
  ".env",
  ".env.development",
  ".env.production",
  ".env.local",
  ".env.development.local",
  ".env.production.local",
]);

function isSecretEnvFile(rel: string): boolean {
  const name = rel.split(sep).pop() ?? rel;
  return name.startsWith(".env") && name !== ".env.template";
}

export function isExcludedFile(rel: string, name: string): boolean {
  if (EXCLUDED_FILES.has(rel)) return true;
  if (isSecretEnvFile(rel)) return true;
  return (EXCLUDED_FILES as Set<string>).has(name);
}

function walk(dir: string, repoPath: string, out: TrackedFile[], consoleOut: (s: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  entries.sort();
  for (const entry of entries) {
    const abs = join(dir, entry);
    const rel = relative(repoPath, abs).split("\\").join("/");
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const parts = rel.split("/");
      if (parts.some((p) => EXCLUDED_DIRS.has(p))) continue;
      walk(abs, repoPath, out, consoleOut);
      continue;
    }
    if (!stat.isFile()) continue;
    const isBinary = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|otf|map|lock)$/i.test(rel);
    if (isBinary) continue;
    if (isExcludedFile(rel, entry)) continue;
    if (rel.startsWith("security/")) continue;
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\u0000")) continue;
    out.push({ rel, abs, content });
  }
}

export function tryGitTrackedFiles(repoPath: string): Set<string> | null {
  try {
    const raw = execSync("git ls-files", {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024 * 16,
    });
    return new Set(raw.split("\n").map((l) => l.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

export function createContext(repoPath: string, consoleOut: (s: string) => void): ScanContext {
  const files: TrackedFile[] = [];
  walk(repoPath, repoPath, files, consoleOut);
  const gitTracked = tryGitTrackedFiles(repoPath) ?? new Set<string>();
  return { repoPath, files, gitTracked, console: consoleOut };
}

export function findLines(file: TrackedFile, pattern: RegExp): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = file.content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      out.push({ line: i + 1, text: lines[i].trim() });
    }
  }
  return out;
}

export function hasFile(ctx: ScanContext, rel: string): boolean {
  return ctx.files.some((f) => f.rel === rel);
}

export function getFile(ctx: ScanContext, rel: string): TrackedFile | undefined {
  return ctx.files.find((f) => f.rel === rel);
}

export function searchInFile(file: TrackedFile, pattern: RegExp): boolean {
  return pattern.test(file.content);
}

export function searchAll(ctx: ScanContext, pattern: RegExp): TrackedFile[] {
  return ctx.files.filter((f) => pattern.test(f.content));
}

export function quote(evidence: string): string {
  return `"${evidence.replace(/"/g, "'").slice(0, 320)}"`;
}