import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_VERSION_PATH,
  probeDeployHealth,
} from "./DeployHealthService";

const EXPECTED = "a".repeat(40);
const NOW = () => new Date("2026-01-01T00:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("verification passes only when the running commit matches", async () => {
  let calledUrl = "";
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async (url: string | URL) => {
      calledUrl = String(url);
      return jsonResponse({ commit: EXPECTED, commitSource: "env", version: "1.2.3" });
    }) as typeof fetch,
  });
  assert.equal(calledUrl, `https://dev.example.com${DEPLOY_VERSION_PATH}`);
  assert.equal(result.ok, true);
  assert.equal(result.match, true);
  assert.equal(result.reportedCommit, EXPECTED);
  assert.equal(result.httpStatus, 200);
});

test("a mismatched running commit fails verification with a reason", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () =>
      jsonResponse({ commit: "b".repeat(40), commitSource: "env", version: "1.2.3" })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.match, false);
  assert.ok(result.reason?.includes("لا يطابق"));
});

test("a commit read from local git is never accepted as a deployed proof", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () =>
      jsonResponse({ commit: EXPECTED, commitSource: "git", version: "1.2.3" })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.match, true);
  assert.equal(result.reportedCommitSource, "git");
  assert.ok(result.reason?.includes("غير موثوق"));
});

test("a short (non-40-hex) reported commit is not accepted as proof", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () =>
      jsonResponse({ commit: EXPECTED.slice(0, 7), commitSource: "env", version: "1.2.3" })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.match, false);
});

test("a missing reported version fails when a version is expected", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    expectedVersion: "2.0.0",
    now: NOW,
    fetchImpl: (async () =>
      jsonResponse({ commit: EXPECTED, commitSource: "env" })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.match, true);
  assert.ok(result.reason?.includes("الإصدار"));
});

test("a non-200 response fails verification", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () => jsonResponse({ commit: EXPECTED }, 503)) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reachable, false);
  assert.equal(result.httpStatus, 503);
});

test("a missing endpoint (404) fails verification", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () =>
      new Response("Not Found", { status: 404 })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reachable, false);
  assert.equal(result.httpStatus, 404);
  assert.ok(result.reason);
});

test("a 200 response without a reportable commit fails verification", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () =>
      jsonResponse({ commit: null, version: "1.0.0" })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.match, false);
  assert.equal(result.reportedCommit, null);
  assert.ok(result.reason?.includes("لا يطابق"));
});

test("an unparseable body fails verification", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () =>
      new Response("not json", { status: 200 })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reachable, true);
});

test("a network failure fails closed without throwing", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reachable, false);
  assert.ok(result.reason);
});

test("an aborted (timed out) probe is reported as a timeout", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("مهلة"));
});

test("a production host is refused without any network call", async () => {
  let called = false;
  const result = await probeDeployHealth({
    baseUrl: "https://rwqan.sa",
    expectedCommit: EXPECTED,
    now: NOW,
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({ commit: EXPECTED });
    }) as typeof fetch,
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("الإنتاج"));
});

test("an empty base url is not attempted", async () => {
  const result = await probeDeployHealth({
    baseUrl: "",
    expectedCommit: EXPECTED,
    now: NOW,
  });
  assert.equal(result.attempted, false);
  assert.equal(result.ok, false);
});

test("a mismatched version fails verification", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    expectedVersion: "2.0.0",
    now: NOW,
    fetchImpl: (async () =>
      jsonResponse({ commit: EXPECTED, commitSource: "env", version: "1.0.0" })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.match, true);
  assert.ok(result.reason?.includes("الإصدار"));
});

test("when commit proof is not required, a reachable 200 proves liveness only", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    requireCommitProof: false,
    now: NOW,
    fetchImpl: (async () => jsonResponse({ version: "1.0.0" })) as typeof fetch,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reachable, true);
  assert.equal(result.match, false);
});

test("when commit proof is not required, a non-200 still fails closed", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    requireCommitProof: false,
    now: NOW,
    fetchImpl: (async () => jsonResponse({}, 503)) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reachable, false);
});

test("when commit proof is not required, an unparseable 200 still proves liveness", async () => {
  const result = await probeDeployHealth({
    baseUrl: "https://dev.example.com",
    expectedCommit: EXPECTED,
    requireCommitProof: false,
    now: NOW,
    fetchImpl: (async () => new Response("not json", { status: 200 })) as typeof fetch,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reachable, true);
});
