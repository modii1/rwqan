import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  captureCustomerSessionSnapshot,
  customerHistoryQueryKey,
  customerProfileQueryKey,
  customerSessionRequestHeaders,
  isCustomerSessionSnapshotCurrent,
  setCustomerFavorite,
  updateFavoritePropertyNumbers,
} from "./use-customer-account";
import { CUSTOMER_SESSION_REVISION_HEADER } from "@shared/customer";

test("favorite state adds once and remains deterministic", () => {
  assert.deepEqual(updateFavoritePropertyNumbers(["100", "200"], "300", true), ["100", "200", "300"]);
  assert.deepEqual(updateFavoritePropertyNumbers(["100", "200"], "200", true), ["100", "200"]);
});

test("favorite state removes only the selected property", () => {
  assert.deepEqual(updateFavoritePropertyNumbers(["100", "200", "300"], "200", false), ["100", "300"]);
  assert.deepEqual(updateFavoritePropertyNumbers(["100"], "999", false), ["100"]);
});

test("late customer mutations cannot write across an identity revision", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["/api/contact-identity"], {
    kind: "client",
    maskedPhone: "05•••1111",
  });
  const sessionA = captureCustomerSessionSnapshot(queryClient);
  assert.equal(isCustomerSessionSnapshotCurrent(queryClient, sessionA), true);

  queryClient.setQueryData(["/api/contact-identity"], {
    kind: "client",
    maskedPhone: "05•••2222",
  });
  assert.equal(isCustomerSessionSnapshotCurrent(queryClient, sessionA), false);
});

test("even an indistinguishable masked phone gets a new mutation boundary", () => {
  const queryClient = new QueryClient();
  const identity = { kind: "client", maskedPhone: "05•••1111" };
  queryClient.setQueryData(["/api/contact-identity"], identity);
  const earlierSession = captureCustomerSessionSnapshot(queryClient);

  queryClient.setQueryData(["/api/contact-identity"], { ...identity });
  assert.equal(
    isCustomerSessionSnapshotCurrent(queryClient, earlierSession),
    false,
  );
});

test("profile and history caches are partitioned by customer session", () => {
  const profileAKey = customerProfileQueryKey("session-a");
  const profileBKey = customerProfileQueryKey("session-b");
  assert.notDeepEqual(profileAKey, profileBKey);
  assert.notDeepEqual(
    customerHistoryQueryKey("session-a"),
    customerHistoryQueryKey("session-b"),
  );

  const queryClient = new QueryClient();
  queryClient.setQueryData(profileAKey, { fullName: "Customer A" });
  assert.equal(queryClient.getQueryData(profileBKey), undefined);
});

test("customer requests carry only the exact scoped server session revision", () => {
  const revision = "a".repeat(64);
  assert.deepEqual(customerSessionRequestHeaders(`session:${revision}`), {
    [CUSTOMER_SESSION_REVISION_HEADER]: revision,
  });
  assert.throws(
    () => customerSessionRequestHeaders(null),
    (error: unknown) => Boolean(
      error instanceof Error
      && (error as { code?: string }).code === "CUSTOMER_SESSION_CHANGED",
    ),
  );
  assert.throws(
    () => customerSessionRequestHeaders("session:not-a-session-revision"),
    (error: unknown) => Boolean(
      error instanceof Error
      && (error as { code?: string }).code === "CUSTOMER_SESSION_CHANGED",
    ),
  );
});

test("favorite mutations bind the request to the selected customer session", async () => {
  const originalFetch = globalThis.fetch;
  const revision = "b".repeat(64);
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      favoritePropertyNumbers: ["PROP-100"],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    assert.deepEqual(
      await setCustomerFavorite("PROP-100", true, `session:${revision}`),
      ["PROP-100"],
    );
    assert.equal(capturedUrl, "/api/customer/favorites/PROP-100");
    assert.equal(capturedInit?.method, "PUT");
    assert.equal(
      (capturedInit?.headers as Record<string, string>)[
        CUSTOMER_SESSION_REVISION_HEADER
      ],
      revision,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
