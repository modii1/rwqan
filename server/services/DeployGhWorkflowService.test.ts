import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchTestDeployWorkflow,
  DEPLOY_GH_TOKEN_ENV_KEY,
  type GhWorkflowDispatchRequest,
} from "./DeployGhWorkflowService";

const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const TOKEN = "ghs_test-token-value-000000000000000000000";
const CWD = "/repo";

function request(): GhWorkflowDispatchRequest {
  return { commit: COMMIT, cwd: CWD };
}

/** fetchImpl that must NEVER be reached (used for fail-closed paths). */
function fetchThatMustNotRun(): Promise<Response> {
  throw new Error("fetch must not be called on this path");
}

test("missing token fails closed at stage auth without any API call", async () => {
  const result = await dispatchTestDeployWorkflow(
    request(),
    {},
    fetchThatMustNotRun,
    () => {
      throw new Error("readTip must not be called without a token");
    },
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.kind === "blocked" ? result.stage : null, "auth");
  const reason = result.kind === "blocked" ? result.reason : "";
  assert.match(reason, /إعداد GitHub المطلوب غير متوفر/);
  assert.match(reason, new RegExp(DEPLOY_GH_TOKEN_ENV_KEY));
});

test("invalid environment override refuses before token/API use", async () => {
  const result = await dispatchTestDeployWorkflow(
    request(),
    {
      [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN,
      [`${"DEPLOY_GITHUB_TEST_REPOSITORY"}`]: "bad repo name/with spaces",
    },
    fetchThatMustNotRun,
    () => {
      throw new Error("readTip must not be called");
    },
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.kind === "blocked" ? result.stage : null, "target");
  assert.match(
    result.kind === "blocked" ? result.reason : "",
    /DEPLOY_GITHUB_TEST_REPOSITORY/,
  );
});

test("remote tip failing read-only (ls-remote AND API) is blocked at source and never pushes", async () => {
  const result = await dispatchTestDeployWorkflow(
    request(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    fetchThatMustNotRun, // the API fallback throwing counts as an API failure
    async () => ({
      tip: null,
      reason: "قراءة فقط فشلت.",
    }),
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.kind === "blocked" ? result.stage : null, "source");
  assert.match(result.kind === "blocked" ? result.reason : "", /push/);
});

test("ls-remote failure falls back to a read-only API tip query and dispatches when it matches", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const result = await dispatchTestDeployWorkflow(
    request(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async (url, init) => {
      calls.push({
        url: String(url),
        method: (init?.method ?? "GET").toUpperCase(),
      });
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        return {
          status: 200,
          json: async () => ({ commit: { sha: COMMIT } }),
        } as Response;
      }
      return { status: 204 } as Response; // dispatches accepted
    },
    async () => ({ tip: null, reason: "لا remote محلي." }),
  );

  assert.equal(result.kind, "accepted");
  // First call: read-only GET of the branch; second: the dispatch POST.
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/repos\/modii1\/rwqan\/branches\/apphosting%2Ftest-secret-isolation$/);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/dispatches$/);
});

test("API fallback tip mismatch is refused and NO dispatch POST is ever sent", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const result = await dispatchTestDeployWorkflow(
    request(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async (url, init) => {
      calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        return {
          status: 200,
          json: async () => ({ commit: { sha: "b".repeat(40) } }),
        } as Response;
      }
      throw new Error("dispatch POST must not be called after a tip mismatch");
    },
    async () => ({ tip: null, reason: "لا remote محلي." }),
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.kind === "blocked" ? result.stage : null, "source");
  assert.match(result.kind === "blocked" ? result.reason : "", /لا يطابق الـcommit المعتمد/);
  assert.equal(calls.length, 1, "only the read-only GET may have run");
});

test("API fallback 404 produces a clear 'branch missing' reason", async () => {
  const result = await dispatchTestDeployWorkflow(
    request(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async () => ({ status: 404, json: async () => ({}) } as Response),
    async () => ({ tip: null, reason: "لا remote محلي." }),
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.kind === "blocked" ? result.stage : null, "source");
  assert.match(result.kind === "blocked" ? result.reason : "", /الفرع غير موجود|رفعه|push/);
});

test("remote tip different from the approved commit is refused", async () => {
  const result = await dispatchTestDeployWorkflow(
    { commit: COMMIT, cwd: CWD },
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    fetchThatMustNotRun,
    async () => ({ tip: OTHER_COMMIT.toLowerCase() }),
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.kind === "blocked" ? result.stage : null, "source");
  const reason = result.kind === "blocked" ? result.reason : "";
  assert.match(reason, /bbbbbb/);
  assert.match(reason, /aaaaaa/);
});

test("successful dispatch (204) returns accepted with non-secret fields", async () => {
  let captured: { url: string | URL | Request; init: RequestInit } | null = null;
  const result = await dispatchTestDeployWorkflow(
    request(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async (url, init) => {
      captured = { url, init: init ?? {} };
      return { status: 204 } as Response;
    },
    async () => ({ tip: COMMIT.toLowerCase() }),
  );

  // TypeScript cannot track the assignment inside the callback — re-read the
  // captured value through an explicit typed alias before asserting on it.
  const call = captured as unknown as { url: string | URL | Request; init: RequestInit } | null;
  assert.ok(call);
  assert.match(
    String(call.url),
    /https:\/\/api\.github\.com\/repos\/modii1\/rwqan\/actions\/workflows\/deploy-test\.yml\/dispatches/,
  );
  const headers = new Headers(call.init.headers as HeadersInit);
  assert.equal(headers.get("Authorization"), `Bearer ${TOKEN}`);
  assert.equal((call.init.body as string).includes("apphosting/test-secret-isolation"), true);

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") {
    assert.equal(result.branch, "apphosting/test-secret-isolation");
    assert.match(result.actionsUrl, /actions\/workflows\/deploy-test\.yml$/);
    assert.ok(!result.detail.includes(TOKEN));
  }
});

test("403 response maps to a clear permission failure without echoing the body", async () => {
  const result = await dispatchTestDeployWorkflow(
    request(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async () => ({ status: 403, text: async () => "raw body must never appear" } as Response),
    async () => ({ tip: COMMIT.toLowerCase() }),
  );

  assert.equal(result.kind, "failed");
  const reason = result.kind === "failed" ? result.reason : "";
  assert.match(reason, /403/);
  assert.ok(!reason.includes("raw body"));
  assert.ok(!reason.includes(TOKEN));
});

test("network error maps to a sanitized failure", async () => {
  const result = await dispatchTestDeployWorkflow(
    request(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async () => {
      throw new Error(`leaky ${TOKEN}`);
    },
    async () => ({ tip: COMMIT.toLowerCase() }),
  );

  assert.equal(result.kind, "failed");
  const reason = result.kind === "failed" ? result.reason : "";
  assert.ok(!reason.includes(TOKEN));
  assert.ok(!reason.includes("leaky"));
});
