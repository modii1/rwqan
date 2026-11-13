import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPLOY_GITHUB_TOKEN_ENV_KEY,
  resolveDeployGithubToken,
} from "./GitHubAuthService";

const FAKE_TOKEN = "test_token_".padEnd(32, "a");

test("an explicit server token wins and is marked as env", async () => {
  const result = await resolveDeployGithubToken(
    {
      [DEPLOY_GITHUB_TOKEN_ENV_KEY]: FAKE_TOKEN,
      NODE_ENV: "development",
    },
    {
      allowGhCli: true,
      runGh: async () => {
        throw new Error("gh must not be called when env token exists");
      },
    },
  );
  assert.equal(result.token, FAKE_TOKEN);
  assert.equal(result.source, "env");
  assert.equal(result.reason, null);
});

test("a development server reuses the existing gh session without a new token", async () => {
  const result = await resolveDeployGithubToken(
    { NODE_ENV: "development" },
    { allowGhCli: true, runGh: async () => `${FAKE_TOKEN}\n` },
  );
  assert.equal(result.token, FAKE_TOKEN);
  assert.equal(result.source, "gh_cli");
  assert.equal(result.reason, null);
});

test("production never reads the host gh keyring", async () => {
  let called = false;
  const result = await resolveDeployGithubToken(
    { NODE_ENV: "production" },
    {
      allowGhCli: true,
      runGh: async () => {
        called = true;
        return FAKE_TOKEN;
      },
    },
  );
  assert.equal(called, false);
  assert.equal(result.token, null);
  assert.equal(result.source, "none");
  assert.match(result.reason ?? "", /DEPLOY_GITHUB_TOKEN/);
});

test("a missing/unauthenticated gh session fails closed with a clear reason", async () => {
  const result = await resolveDeployGithubToken(
    { NODE_ENV: "development" },
    {
      allowGhCli: true,
      runGh: async () => {
        throw new Error("not logged in");
      },
    },
  );
  assert.equal(result.token, null);
  assert.equal(result.source, "none");
  assert.match(result.reason ?? "", /gh auth login/);
  assert.doesNotMatch(result.reason ?? "", /not logged in/);
});

test("callers that do not opt in never read the gh keyring", async () => {
  let called = false;
  const result = await resolveDeployGithubToken(
    { NODE_ENV: "development" },
    {
      runGh: async () => {
        called = true;
        return FAKE_TOKEN;
      },
    },
  );
  assert.equal(called, false);
  assert.equal(result.token, null);
});
