import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashValue,
  isPotentialSecret,
  redactFinding,
  redactText,
  SECRET_ENV_KEY_NAMES,
} from "../src/redact";
import type { Finding } from "../src/types";

function makeFinding(): Finding {
  return {
    id: "X",
    severity: "medium",
    category: "secrets",
    section: "Secrets",
    title: "token AIzaSyFake0123456789abcdefghijklmnop",
    description: "GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----",
    evidence: "PAYMOB_API_KEY=sk-test-abc123def456",
    file: "a.ts",
    detectionSource: "ruqan-static",
    affectedFlow: undefined,
    productionImpact: "YES",
    remediation: undefined,
    status: "open",
    classification: "new",
    fingerprint: "fp",
  };
}

describe("redactText", () => {
  it("masks values for known secret env key names", () => {
    const out = redactText("PAYMOB_API_KEY=sk_live_1111");
    assert.ok(out.includes("PAYMOB_API_KEY=[REDACTED]"));
    assert.ok(!out.includes("sk_live_1111"));
  });

  it("masks private key blocks", () => {
    const out = redactText("-----BEGIN PRIVATE KEY-----Zm9vZm9vZm9vZm9v-----END PRIVATE KEY-----");
    assert.ok(out.includes("[REDACTED:PRIVATE_KEY]"));
    assert.ok(!out.includes("Zm9v"));
  });

  it("masks generic tokens and SA emails", () => {
    assert.ok(redactText("key eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.withalsocontent").includes("[REDACTED:TOKEN]"));
    assert.ok(redactText("svc rwqan@prod.iam.gserviceaccount.com").includes("[REDACTED:SERVICE_ACCOUNT_EMAIL]"));
    assert.ok(redactText("used sk-proj-abcdefghi1234567890").includes("[REDACTED:TOKEN]"));
  });

  it("does not mangle plain harmless prose", () => {
    const out = redactText("hello world, this is innocuous");
    assert.equal(out, "hello world, this is innocuous");
  });

  it("returns empty string unchanged", () => {
    assert.equal(redactText(""), "");
  });
});

describe("redactFinding", () => {
  it("redacts title, description and evidence, keeping structure", () => {
    const f = makeFinding();
    const out = redactFinding(f);
    assert.ok(!out.title.includes("AIzaSy"));
    assert.ok(!out.description.includes("PRIVATE KEY"));
    assert.ok(!out.evidence.includes("sk-test"));
    assert.equal(out.id, f.id);
    assert.equal(out.fingerprint, f.fingerprint);
    assert.equal(out.line, undefined);
  });
});

describe("isPotentialSecret", () => {
  it("detects private key blocks and common tokens", () => {
    assert.equal(isPotentialSecret("-----BEGIN RSA PRIVATE KEY-----"), true);
    assert.equal(isPotentialSecret("sk-live-abcdefghijklmnopqrst"), true);
    assert.equal(isPotentialSecret("AIzaSy1234567890abcdefghijklmno"), true);
    assert.equal(isPotentialSecret("plain config text"), false);
  });
});

describe("SECRET_ENV_KEY_NAMES", () => {
  it("covers the known secret env keys", () => {
    for (const key of ["PAYMOB_API_KEY", "META_WHATSAPP_TOKEN", "GOOGLE_PRIVATE_KEY", "R2_SECRET_ACCESS_KEY"]) {
      assert.ok(SECRET_ENV_KEY_NAMES.includes(key), key);
    }
  });
});

describe("hashValue", () => {
  it("is stable and truncated", () => {
    assert.equal(hashValue("foo"), hashValue("foo"));
    assert.equal(hashValue("foo").length, 12);
    assert.notEqual(hashValue("foo"), hashValue("bar"));
  });
});