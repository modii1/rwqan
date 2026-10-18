import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertActiveScanDevOnly,
  assertNoNetworkMode,
  assertSecurityScanTargetSafe,
  SecurityScanGuardError,
  resolveNoNetwork,
  resolveTarget,
  isProductionishUrl,
} from "../src/guards";

const NO_ACTIVE = {
  zapActiveScan: false,
  paymentTests: false,
  mutationTests: false,
  uploadDeleteTests: false,
};

describe("target resolution", () => {
  it("defaults to development", () => {
    assert.equal(resolveTarget(undefined), "development");
    assert.equal(resolveTarget("production"), "production");
    assert.equal(resolveTarget("staging"), "development");
  });

  it("resolveNoNetwork honors flag and env", () => {
    assert.equal(resolveNoNetwork("true"), true);
    assert.equal(resolveNoNetwork("1"), true);
    assert.equal(resolveNoNetwork("false"), false);
    assert.equal(resolveNoNetwork(undefined, { NO_NETWORK: "true" }), true);
    assert.equal(resolveNoNetwork(undefined, {}), false);
  });

  it("isProductionishUrl flags production hosts", () => {
    assert.equal(isProductionishUrl("https://rwqan.sa"), true);
    assert.equal(isProductionishUrl("https://rwqan.example.com"), false);
    assert.equal(isProductionishUrl("http://localhost:3000"), false);
    assert.equal(isProductionishUrl("projects/rwqan-757/databases"), true);
  });
});

describe("production guard", () => {
  it("allows passive scan against production", () => {
    assert.doesNotThrow(() =>
      assertSecurityScanTargetSafe("production", { enableActive: NO_ACTIVE }),
    );
  });

  it("refuses ZAP active scan against production", () => {
    assert.throws(
      () =>
        assertSecurityScanTargetSafe("production", {
          enableActive: { ...NO_ACTIVE, zapActiveScan: true },
        }),
      SecurityScanGuardError,
    );
  });

  it("refuses mutation/payment/upload-delete tests against production", () => {
    for (const key of ["paymentTests", "mutationTests", "uploadDeleteTests"] as const) {
      assert.throws(
        () =>
          assertSecurityScanTargetSafe("production", {
            enableActive: { ...NO_ACTIVE, [key]: true },
          }),
        SecurityScanGuardError,
        key,
      );
    }
  });

  it("refuses scanning a production-looking target URL outright", () => {
    assert.throws(
      () =>
        assertSecurityScanTargetSafe("development", {
          enableActive: NO_ACTIVE,
          targetUrl: "https://rwqan.sa",
        }),
      SecurityScanGuardError,
    );
  });

  it("refuses active testing aimed at a production host", () => {
    assert.throws(
      () =>
        assertSecurityScanTargetSafe("development", {
          enableActive: { ...NO_ACTIVE, zapActiveScan: true },
          targetUrl: "https://rwqan.sa/api",
        }),
      SecurityScanGuardError,
    );
  });

  it("allows active scans only against non-production URLs", () => {
    assert.doesNotThrow(() =>
      assertSecurityScanTargetSafe("development", {
        enableActive: { ...NO_ACTIVE, zapActiveScan: true },
        targetUrl: "http://localhost:3000",
        noNetwork: false,
      }),
    );
  });

  it("refuses ZAP when noNetwork is true", () => {
    assert.throws(
      () =>
        assertSecurityScanTargetSafe("development", {
          enableActive: { ...NO_ACTIVE, zapActiveScan: true },
          noNetwork: true,
          targetUrl: "http://localhost:3000",
        }),
      SecurityScanGuardError,
    );
  });
});

describe("active-scan DEV-only guard", () => {
  it("allows active when target=development", () => {
    assert.doesNotThrow(() => assertActiveScanDevOnly("development", true, "test"));
  });

  it("refuses active when target=production", () => {
    assert.throws(
      () => assertActiveScanDevOnly("production", true, "test"),
      SecurityScanGuardError,
    );
  });

  it("is a no-op when not enabled", () => {
    assert.doesNotThrow(() => assertActiveScanDevOnly("production", false, "test"));
  });
});

describe("no-network guard", () => {
  const base = {
    repoPath: ".",
    baselinePath: "security/baseline.json",
    target: "development" as const,
    noNetwork: true,
    ci: false,
    json: false,
    updateBaseline: false,
    enableActive: NO_ACTIVE,
    scanId: "s",
    consoleOut: () => {},
  };

  it("passes when noNetwork=false even with active zap", () => {
    assert.doesNotThrow(() =>
      assertNoNetworkMode({ ...base, noNetwork: false, enableActive: { ...NO_ACTIVE, zapActiveScan: true } }),
    );
  });

  it("refuses active zap scanning under noNetwork", () => {
    assert.throws(
      () => assertNoNetworkMode({ ...base, enableActive: { ...NO_ACTIVE, zapActiveScan: true } }),
      SecurityScanGuardError,
    );
  });

  it("passes with noNetwork=true and no active scans", () => {
    assert.doesNotThrow(() => assertNoNetworkMode(base));
  });
});