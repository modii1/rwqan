import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDeployChecks,
  evaluateChecks,
  isSecretFileName,
  parseChangedFiles,
  sanitizeGitRemote,
  secretContentDetected,
  type DeployChecksDependencies,
} from "./DeployChecksService";

test("secret file names are detected but documented examples are allowed", () => {
  assert.equal(isSecretFileName(".env"), true);
  assert.equal(isSecretFileName(".env.production"), true);
  assert.equal(isSecretFileName("config/service-account.json"), true);
  assert.equal(isSecretFileName("certs/server.pem"), true);
  assert.equal(isSecretFileName("id_rsa"), true);
  assert.equal(isSecretFileName(".env.example"), false);
  assert.equal(isSecretFileName("src/index.ts"), false);
});

test("secret-looking content is detected without returning the value", () => {
  assert.equal(secretContentDetected("-----BEGIN RSA PRIVATE KEY-----"), true);
  assert.equal(secretContentDetected('"private_key": "abc"'), true);
  assert.equal(secretContentDetected("const x = 1;"), false);
});

test("git remotes are sanitized of embedded credentials", () => {
  assert.equal(
    sanitizeGitRemote("https://user:token@github.com/iheeb1/rwqan-sa.git"),
    "https://github.com/iheeb1/rwqan-sa.git",
  );
  assert.equal(
    sanitizeGitRemote("git@github.com:iheeb1/rwqan-sa.git"),
    "ssh://github.com/iheeb1/rwqan-sa.git",
  );
});

test("evaluateChecks fails closed when git (and thus the secret scan) is unavailable", () => {
  const blocked = evaluateChecks({
    gitAvailable: false,
    secretFiles: [],
    secretContentMatch: false,
  });
  assert.equal(blocked.checks.secretScan, "BLOCKED");
  assert.equal(blocked.checks.typescript, "NOT_RUN");

  const fileFail = evaluateChecks({
    gitAvailable: true,
    secretFiles: [".env.production"],
    secretContentMatch: false,
  });
  assert.equal(fileFail.checks.secretScan, "FAIL");

  const contentFail = evaluateChecks({
    gitAvailable: true,
    secretFiles: [],
    secretContentMatch: true,
  });
  assert.equal(contentFail.checks.secretScan, "FAIL");

  const clean = evaluateChecks({
    gitAvailable: true,
    secretFiles: [],
    secretContentMatch: false,
  });
  assert.equal(clean.checks.secretScan, "PASS");
  assert.equal(clean.checks.postDeployHealth, "NOT_RUN");
});

test("collectDeployChecks scans changed files and reports the git source", async () => {
  const deps: DeployChecksDependencies = {
    gitSource: async () => ({
      commit: "abc",
      branch: "main",
      tag: null,
      repoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    }),
    listChangedFiles: async () => ({ files: ["src/app.ts"], gitAvailable: true }),
    readTextFile: async () => "const app = 1;",
  };

  const report = await collectDeployChecks("/repo", deps);
  assert.equal(report.checks.secretScan, "PASS");
  assert.equal(report.git?.commit, "abc");
});

test("collectDeployChecks flags a secret file without reading it", async () => {
  let readCount = 0;
  const deps: DeployChecksDependencies = {
    gitSource: async () => null,
    listChangedFiles: async () => ({
      files: [".env.local", "src/app.ts"],
      gitAvailable: true,
    }),
    readTextFile: async () => {
      readCount += 1;
      return "";
    },
  };

  const report = await collectDeployChecks("/repo", deps);
  assert.equal(report.checks.secretScan, "FAIL");
  assert.equal(readCount, 1, "the secret file itself must not be read");
});

test("parseChangedFiles skips deletions (a deleted file leaks nothing)", () => {
  const output = [
    "D  .env",
    " M src/app.ts",
    "?? newfile.txt",
    "M  .env.production",
  ].join("\n");
  const files = parseChangedFiles(output);
  assert.ok(!files.includes(".env"), "a deleted .env must not be flagged");
  assert.ok(files.includes("src/app.ts"));
  assert.ok(files.includes("newfile.txt"));
  assert.ok(files.includes(".env.production"));
});

test("collectDeployChecks never throws when git is missing", async () => {
  const deps: DeployChecksDependencies = {
    gitSource: async () => {
      throw new Error("no git");
    },
    listChangedFiles: async () => ({ files: [], gitAvailable: false }),
    readTextFile: async () => null,
  };

  const report = await collectDeployChecks("/repo", deps);
  assert.equal(report.git, null);
  assert.equal(report.checks.secretScan, "BLOCKED");
});
