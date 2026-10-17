import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../src/rules/context";
import { RUQAN_RULES } from "../src/rules/ruqanRules";
import { runRuqanStaticChecks } from "../src/checks";
import type { Finding } from "../src/types";

let tmp: string;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function makeRepo(files: Record<string, string>): string {
  tmp = mkdtempSync(join(tmpdir(), "ruqan-rules-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(tmp, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return tmp;
}

const SILENT = () => {};

describe("createContext exclusions", () => {
  it("excludes .env files, binary files and the security directory", () => {
    const repo = makeRepo({
      "a.ts": "export const a = 1;",
      ".env": "PAYMOB_API_KEY=sk_test_value",
      ".env.development.local": "x=1",
      "logo.png": "\u0000\u0000binary",
      ".env.template": "YOUR_KEY=",
      "security/src/whatever.ts": "console.log('hi')",
    });
    const ctx = createContext(repo, SILENT);
    const rels = ctx.files.map((f) => f.rel);
    assert.ok(rels.includes("a.ts"));
    assert.ok(rels.includes(".env.template"), "template must be scanned");
    assert.ok(!rels.includes(".env"), ".env content must never be read");
    assert.ok(!rels.includes(".env.development.local"));
    assert.ok(!rels.includes("logo.png"));
    assert.ok(!rels.includes("security/src/whatever.ts"));
  });
});

describe("rule catalog", () => {
  it("runs every rule without throwing on an empty repo", () => {
    const repo = makeRepo({});
    const ctx = createContext(repo, SILENT);
    assert.equal(RUQAN_RULES.length, 32);
    for (const rule of RUQAN_RULES) {
      const out = rule.run(ctx);
      assert.ok(Array.isArray(out), `rule ${rule.id} must return an array`);
    }
  });

  it("produces findings with valid fingerprints and redacted evidence", () => {
    const repo = makeRepo({
      "server/routes/owner.ts":
        'router.get("/api/owner/subscription/:propertyNumber", requireOwner, async (req, res) => {\n  const propertyNumber = req.params.propertyNumber;\n  const sub = await getSubscriptionByPropertyNumber(propertyNumber);\n  res.json(sub);\n});\n',
    });
    const ctx = createContext(repo, SILENT);
    const findings: Finding[] = runRuqanStaticChecks(ctx);
    const idor = findings.find((f) => f.id === "AUTHZ-001");
    assert.ok(idor, "IDOR rule should fire on the fixture");
    assert.ok(typeof idor!.fingerprint === "string" && idor!.fingerprint.length > 0);
    assert.equal(idor!.classification, "new");
    assert.match(idor!.title, /IDOR/);
  });

  it("PAY-001 does not fire when usage limits are enforced", () => {
    const repo = makeRepo({
      "server/services/DiscountService.ts":
        "export function apply({ usageCount, maxUses }) {\n" +
        "  if (usageCount >= maxUses) return 0;\n" +
        "  return Math.max(0, originalAmount);\n" +
        "}\n",
    });
    const ctx = createContext(repo, SILENT);
    const findings = runRuqanStaticChecks(ctx);
    assert.ok(!findings.some((f) => f.id === "PAY-001"));
  });

  it("PAY-001 fires when no usage limit is enforced", () => {
    const repo = makeRepo({
      "server/services/DiscountService.ts":
        "export function apply() {\n  return Math.max(0, originalAmount);\n}\n",
    });
    const ctx = createContext(repo, SILENT);
    const findings = runRuqanStaticChecks(ctx);
    assert.ok(findings.some((f) => f.id === "PAY-001"));
  });

  it("DEPS-001 only flags genuinely unreferenced packages", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({
        dependencies: { "openai": "^6.0.0", "express": "^4.0.0" },
      }),
      "server/a.ts": "import express from 'express';\nconsole.log(express);\n",
    });
    const ctx = createContext(repo, SILENT);
    const findings = runRuqanStaticChecks(ctx);
    const deps = findings.filter((f) => f.id === "DEPS-001");
    assert.equal(deps.length, 1, "only openai is unreferenced");
    assert.match(deps[0].evidence, /openai/);
  });
});