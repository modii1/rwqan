import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDeployChecks,
  containsRealPemPrivateKey,
  evaluateChecks,
  isEnvTemplateFile,
  isSecretFileName,
  parseChangedFiles,
  sanitizeGitRemote,
  secretContentDetected,
  secretContentDetectedIn,
  type DeployChecksDependencies,
} from "./DeployChecksService";

// Fixtures are assembled at runtime so the scanner never meets its own source.
const PEM_BEGIN = `-----BEGIN ${"PRIVATE"} KEY-----`;
const PEM_END = `-----END ${"PRIVATE"} KEY-----`;
const RSA_BEGIN = `-----BEGIN ${"RSA"} ${"PRIVATE"} KEY-----`;
const PRIVATE_KEY_JSON = `"private_${"key"}": "abc"`;
const PEM_BODY =
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==";
const GOOGLE_KEY = `AIza${"0".repeat(35)}`;

const SAFE_TEMPLATE = [
  "# Documented template — placeholders only, no credentials.",
  `SERVICE_ACCOUNT_KEY=${PEM_BEGIN}${PEM_END}`,
  "API_TOKEN=replace_with_a_private_token",
].join("\n");

const REAL_PRIVATE_KEY = [PEM_BEGIN, PEM_BODY, PEM_BODY, PEM_BODY, PEM_END].join(
  "\n",
);

const SECRET_IN_TEMPLATE = [
  "# Someone filled this template with a real credential.",
  `WEB_API_KEY=${GOOGLE_KEY}`,
].join("\n");

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
  assert.equal(secretContentDetected(RSA_BEGIN), true);
  assert.equal(secretContentDetected(PRIVATE_KEY_JSON), true);
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

test("env templates are recognised as templates", () => {
  assert.equal(isEnvTemplateFile(".env.template"), true);
  assert.equal(isEnvTemplateFile(".env.example"), true);
  assert.equal(isEnvTemplateFile(".env.sample"), true);
  assert.equal(isEnvTemplateFile(".env.production"), false);
  assert.equal(isEnvTemplateFile("src/index.ts"), false);
});

test("a placeholder marker in an env template is not a secret", () => {
  assert.equal(containsRealPemPrivateKey(SAFE_TEMPLATE), false);
  assert.equal(secretContentDetectedIn(SAFE_TEMPLATE, ".env.template"), false);
  assert.equal(secretContentDetectedIn(SAFE_TEMPLATE, ".env.example"), false);
  // The very same text outside a template is still reported.
  assert.equal(secretContentDetectedIn(SAFE_TEMPLATE, "src/config.ts"), true);
});

test("a real private key fails everywhere, templates included", () => {
  assert.equal(containsRealPemPrivateKey(REAL_PRIVATE_KEY), true);
  assert.equal(secretContentDetectedIn(REAL_PRIVATE_KEY, "src/config.ts"), true);
  assert.equal(secretContentDetectedIn(REAL_PRIVATE_KEY, ".env.template"), true);
  assert.equal(containsRealPemPrivateKey(SAFE_TEMPLATE), false);
});

test("a real credential inside an env template is still a secret", () => {
  assert.equal(secretContentDetectedIn(SECRET_IN_TEMPLATE, ".env.template"), true);
  assert.equal(secretContentDetectedIn(SECRET_IN_TEMPLATE, "config.env"), true);
});

test("collectDeployChecks applies the real-secret bar to env templates", async () => {
  const depsFor = (content: string): DeployChecksDependencies => ({
    gitSource: async () => ({
      commit: "abc",
      branch: "main",
      tag: null,
      repoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    }),
    listChangedFiles: async () => ({
      files: [".env.template"],
      gitAvailable: true,
    }),
    readTextFile: async () => content,
  });

  const safe = await collectDeployChecks("/repo", depsFor(SAFE_TEMPLATE));
  assert.equal(safe.checks.secretScan, "PASS");

  const planted = await collectDeployChecks("/repo", depsFor(SECRET_IN_TEMPLATE));
  assert.equal(planted.checks.secretScan, "FAIL");

  const key = await collectDeployChecks("/repo", depsFor(REAL_PRIVATE_KEY));
  assert.equal(key.checks.secretScan, "FAIL");
});
