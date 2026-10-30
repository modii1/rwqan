import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchTestDeployWorkflow,
  dispatchLiveDeployWorkflow,
  DEPLOY_GH_TOKEN_ENV_KEY,
  DEPLOY_GH_LIVE_BRANCH_ENV_KEY,
  type GhWorkflowDispatchRequest,
  type GhLiveWorkflowDispatchRequest,
  readDeployWorkflowRunStatus,
} from "./DeployGhWorkflowService";

const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const TOKEN = "ghs_test-token-value-000000000000000000000";
const CWD = "/repo";

function request(): GhWorkflowDispatchRequest {
  return { commit: COMMIT, cwd: CWD };
}

function liveRequest(): GhLiveWorkflowDispatchRequest {
  return { cwd: CWD };
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
      const u = String(url);
      if (u.includes("/branches/")) {
        // read-only branch tip API: the tip MATCHES the approved commit
        return {
          status: 200,
          json: async () => ({ commit: { sha: COMMIT } }),
        } as Response;
      }
      if (u.includes("/runs")) {
        // read-only duplicate-guard probe: nothing running → proceed
        return { status: 200, json: async () => ({ workflow_runs: [] }) } as Response;
      }
      // the dispatch itself
      return { status: 204 } as Response;
    },
    async () => ({ tip: null, reason: "لا remote محلي." }),
  );

  assert.equal(result.kind, "accepted");
  // Order: read-only GET tip → read-only GET runs (dup guard) → POST dispatch.
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/repos\/modii1\/rwqan\/branches\/test%2Funified-gateway-ui-only$/);
  assert.equal(calls[1].method, "GET");
  assert.match(calls[1].url, /\/runs[?/]/);
  assert.equal(calls[2].method, "POST");
  assert.match(calls[2].url, /\/dispatches$/);
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
  assert.equal((call.init.body as string).includes("test/unified-gateway-ui-only"), true);

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") {
    assert.equal(result.branch, "test/unified-gateway-ui-only");
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

// ---------------- LIVE environment tests ----------------

test("LIVE missing token fails closed at stage auth without any API call", async () => {
  const result = await dispatchLiveDeployWorkflow(
    liveRequest(),
    {},
    fetchThatMustNotRun,
    () => {
      throw new Error("readTip must not be called without a token");
    },
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.stage, "auth");
  const reason = result.kind === "blocked" ? result.reason : "";
  assert.match(reason, /إعداد GitHub المطلوب غير متوفر/);
  assert.match(reason, new RegExp(DEPLOY_GH_TOKEN_ENV_KEY));
});

test("LIVE invalid branch override refuses before token/API use", async () => {
  const result = await dispatchLiveDeployWorkflow(
    liveRequest(),
    {
      [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN,
      [DEPLOY_GH_LIVE_BRANCH_ENV_KEY]: "bad branch/name",
    },
    fetchThatMustNotRun,
    () => {
      throw new Error("readTip must not be called");
    },
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.stage, "target");
  assert.match(result.kind === "blocked" ? result.reason : "", /DEPLOY_GITHUB_LIVE_BRANCH/);
});

test("LIVE dispatch accepted: read-only tip via API (ls-remote off), dup guard skipped (none running), then POST — the LIVE request carries NO commit", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const result = await dispatchLiveDeployWorkflow(
    liveRequest(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async (url, init) => {
      calls.push({
        url: String(url),
        method: (init?.method ?? "GET").toUpperCase(),
      });
      const u = String(url);
      if (u.includes("/branches/")) {
        return { status: 200, json: async () => ({ commit: { sha: COMMIT } }) } as Response;
      }
      if (u.includes("/runs")) {
        return { status: 200, json: async () => ({ workflow_runs: [] }) } as Response;
      }
      return { status: 204 } as Response; // dispatch accepted
    },
    async () => ({ tip: null, reason: "ls-remote disabled" }),
  );

  assert.equal(result.kind, "accepted");
  assert.equal(result.branch, "main");
  // No commit comparison for LIVE: the deployed source is the branch tip.
  const postCall = calls.find((c) => c.method === "POST");
  assert.ok(postCall, "a dispatch POST must be sent");
  assert.match(postCall.url, /\/dispatches$/);
  assert.ok(
    !calls.some((c) => c.method === "POST" && String(c.url).includes("commit")),
    "LIVE dispatch body must not contain a commit",
  );
});

test("LIVE dup-guard blocks dispatch when a run is already running", async () => {
  const calls: Array<string> = [];
  const result = await dispatchLiveDeployWorkflow(
    liveRequest(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async (url, init) => {
      calls.push((init?.method ?? "GET").toUpperCase());
      const u = String(url);
      if (u.includes("/branches/")) {
        return { status: 200, json: async () => ({ commit: { sha: COMMIT } }) } as Response;
      }
      if (u.includes("/runs")) {
        return {
          status: 200,
          json: async () => ({
            workflow_runs: [
              {
                status: "in_progress",
                conclusion: null,
                html_url: "https://github.com/modii1/rwqan/actions/runs/9",
              },
            ],
          }),
        } as Response;
      }
      throw new Error("dispatch POST must never be sent while a run is in progress");
    },
    async () => ({ tip: null, reason: "ls-remote disabled" }),
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.stage, "target");
  assert.match(result.kind === "blocked" ? result.reason : "", /قيد التنفيذ/);
  assert.equal(calls.length, 2, "only the read-only GETs may have run");
});

test("LIVE blocked when the branch tip cannot be read at all", async () => {
  const result = await dispatchLiveDeployWorkflow(
    liveRequest(),
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    fetchThatMustNotRun,
    async () => ({ tip: null, reason: "remote unavailable" }),
  );

  assert.equal(result.kind, "blocked");
  assert.equal(result.stage, "source");
  assert.match(result.kind === "blocked" ? result.reason : "", /غير موجود|تعذّر|push/);
});

test("read status returns the real run state per environment (unknown without a token)", async () => {
  const running = await readDeployWorkflowRunStatus(
    "TEST",
    { [DEPLOY_GH_TOKEN_ENV_KEY]: TOKEN },
    async (url) => {
      const u = String(url);
      if (u.includes("/branches/")) {
        return { status: 200, json: async () => ({ commit: { sha: COMMIT } }) } as Response;
      }
      return {
        status: 200,
        json: async () => ({
          workflow_runs: [{ status: "in_progress", conclusion: null, head_sha: COMMIT }],
        }),
      } as Response;
    },
  );
  assert.equal(running.state, "running");
  assert.equal(running.headSha, COMMIT.toLowerCase());

  const noToken = await readDeployWorkflowRunStatus("LIVE", {}, fetchThatMustNotRun);
  assert.equal(noToken.state, "unknown");
  assert.equal(noToken.runUrl, null);
  assert.equal(noToken.headSha, null);
});
