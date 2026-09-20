import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  CONTACT_IDENTITY_QUERY_KEY,
  CONTACT_IDENTITY_HINT_STORAGE_KEY,
  CUSTOMER_BOOKING_SESSION_REVISION_STORAGE_KEY,
  CUSTOMER_BOOKINGS_QUERY_KEY,
  EMPTY_CONTACT_IDENTITY,
  commitContactIdentityCache,
  commitContactIdentityStorageHint,
  handleCustomerSessionStorageChange,
  getCustomerSessionCacheScope,
  hasServerResolvedContactIdentity,
  isCurrentContactIdentityHintEvent,
  parseContactIdentityHint,
  requestContactIdentityCode,
  resetCustomerSessionQueries,
  serializeContactIdentityHint,
  syncContactIdentityHintIfUnchanged,
  verifyContactIdentityCode,
  type ContactIdentity,
} from "./use-contact-identity";
import {
  CUSTOMER_HISTORY_QUERY_KEY,
  CUSTOMER_PROFILE_QUERY_KEY,
} from "./use-customer-account";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("contact identity challenge uses the verification endpoint without committing an identity", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await requestContactIdentityCode(
    "512345678",
    async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return jsonResponse({
        alreadyVerified: false,
        challengeId: "challenge-1",
        maskedPhone: "05•• ••5678",
        expiresInSeconds: 300,
      });
    },
  );

  assert.equal(requestUrl, "/api/contact-identity/challenge");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.credentials, "include");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    clientPhone: "512345678",
  });
  assert.deepEqual(result, {
    alreadyVerified: false,
    challengeId: "challenge-1",
    maskedPhone: "05•• ••5678",
    expiresInSeconds: 300,
  });
});

test("contact identity verification posts the six-digit code and returns a client identity", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const identity = await verifyContactIdentityCode(
    {
      challengeId: "challenge-1",
      code: "123456",
      clientPhone: "512345678",
    },
    async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return jsonResponse({
        kind: "client",
        maskedPhone: "05•• ••5678",
        sessionRevision: "a".repeat(64),
      });
    },
  );

  assert.equal(requestUrl, "/api/contact-identity/verify");
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    challengeId: "challenge-1",
    code: "123456",
    clientPhone: "512345678",
  });
  assert.deepEqual(identity, {
    kind: "client",
    maskedPhone: "05•• ••5678",
    sessionRevision: "a".repeat(64),
  });
});

test("an already verified challenge returns only the server-confirmed client identity", async () => {
  const result = await requestContactIdentityCode(
    "512345678",
    async () => jsonResponse({
      alreadyVerified: true,
      maskedPhone: "05•• ••5678",
      identity: {
        kind: "client",
        maskedPhone: "05•• ••5678",
        sessionRevision: "a".repeat(64),
      },
    }),
  );

  assert.deepEqual(result, {
    alreadyVerified: true,
    maskedPhone: "05•• ••5678",
    identity: {
      kind: "client",
      maskedPhone: "05•• ••5678",
      sessionRevision: "a".repeat(64),
    },
  });
});

test("a client identity without an opaque session revision is rejected", async () => {
  await assert.rejects(
    requestContactIdentityCode(
      "512345678",
      async () => jsonResponse({
        alreadyVerified: true,
        maskedPhone: "05•• ••5678",
        identity: { kind: "client", maskedPhone: "05•• ••5678" },
      }),
    ),
    /تعذر تأكيد رقم التواصل/,
  );
});

test("verification API errors are surfaced without producing a replacement identity", async () => {
  await assert.rejects(
    requestContactIdentityCode(
      "512345678",
      async () => jsonResponse({ error: "تعذر إرسال الرمز" }, 429),
    ),
    /تعذر إرسال الرمز/,
  );
  await assert.rejects(
    verifyContactIdentityCode(
      {
        challengeId: "challenge-1",
        code: "000000",
        clientPhone: "512345678",
      },
      async () => jsonResponse({ error: "الرمز غير صحيح" }, 400),
    ),
    /الرمز غير صحيح/,
  );
  await assert.rejects(
    requestContactIdentityCode(
      "512345678",
      async () => jsonResponse({
        alreadyVerified: false,
        maskedPhone: "05•• ••5678",
      }),
    ),
    /تعذر تأكيد إرسال رمز التحقق/,
  );
});

test("the change-number UI commits only through the successful verification mutation", () => {
  const hookSource = readFileSync(new URL("./use-contact-identity.ts", import.meta.url), "utf8");
  const dialogSource = readFileSync(
    new URL("../components/contact/contact-phone-dialog.tsx", import.meta.url),
    "utf8",
  );
  const menuSource = readFileSync(
    new URL("../components/contact/contact-identity-menu.tsx", import.meta.url),
    "utf8",
  );

  assert.match(hookSource, /mutationFn: \(input: VerifyContactIdentityCodeInput\) =>\s+verifyContactIdentityCode\(input\)/);
  assert.match(hookSource, /onSuccess: \(identity\) => commitContactIdentityCache\(queryClient, identity\)/);
  assert.match(dialogSource, /await verifyCode\.mutateAsync/);
  assert.match(dialogSource, /await completeVerifiedPhone\(phone\)/);
  assert.doesNotMatch(menuSource, /useSaveContactIdentity/);
});

test("the cross-tab hint contains only masked client display state", () => {
  const identity: ContactIdentity = {
    kind: "client",
    maskedPhone: "05•• ••5678",
    sessionRevision: "a".repeat(64),
  };
  const serialized = serializeContactIdentityHint(identity);

  assert.equal(serialized, JSON.stringify({
    kind: "client",
    maskedPhone: "05•• ••5678",
  }));
  assert.deepEqual(parseContactIdentityHint(serialized), {
    kind: "client",
    maskedPhone: "05•• ••5678",
  });
  assert.equal(serialized?.includes("0512345678"), false);
  assert.equal(serialized?.includes("a".repeat(64)), false);
  assert.equal(serializeContactIdentityHint(EMPTY_CONTACT_IDENTITY), null);
  assert.equal(parseContactIdentityHint('{"kind":"owner","maskedPhone":"x"}'), undefined);
  assert.equal(parseContactIdentityHint("invalid json"), undefined);
});

test("only server-updated identity data is treated as resolved", () => {
  assert.equal(hasServerResolvedContactIdentity({
    isSuccess: true,
    dataUpdatedAt: 0,
  }), false);
  assert.equal(hasServerResolvedContactIdentity({
    isSuccess: false,
    dataUpdatedAt: Date.now(),
  }), false);
  assert.equal(hasServerResolvedContactIdentity({
    isSuccess: true,
    dataUpdatedAt: Date.now(),
  }), true);
});

test("customer cache scope follows the opaque server session revision", () => {
  const first = getCustomerSessionCacheScope({
    isSuccess: true,
    dataUpdatedAt: 100,
    data: {
      kind: "client",
      maskedPhone: "05•• ••5678",
      sessionRevision: "a".repeat(64),
    },
  });
  const refreshed = getCustomerSessionCacheScope({
    isSuccess: true,
    dataUpdatedAt: 200,
    data: {
      kind: "client",
      maskedPhone: "05•• ••5678",
      sessionRevision: "a".repeat(64),
    },
  });
  const switched = getCustomerSessionCacheScope({
    isSuccess: true,
    dataUpdatedAt: 200,
    data: {
      kind: "client",
      maskedPhone: "05•• ••5678",
      sessionRevision: "b".repeat(64),
    },
  });

  assert.equal(first, refreshed);
  assert.notEqual(first, switched);
  assert.equal(getCustomerSessionCacheScope({
    isSuccess: true,
    dataUpdatedAt: 300,
    data: { kind: "client", maskedPhone: "05•• ••5678" },
  }), null);
});

test("contact identity does not hydrate from a browser-only storage hint", () => {
  const source = readFileSync(
    new URL("./use-contact-identity.ts", import.meta.url),
    "utf8",
  );
  const hookSource = source.slice(source.indexOf("export function useContactIdentityQuery"));
  assert.doesNotMatch(hookSource, /initialData\s*:/);
  assert.doesNotMatch(hookSource, /readContactIdentityHint/);
});

test("a pre-cookie identity read cannot clear a newer cross-tab client hint", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  const client: ContactIdentity = {
    kind: "client",
    maskedPhone: "05•• ••5678",
  };
  const startSnapshot = storage.getItem(CONTACT_IDENTITY_HINT_STORAGE_KEY);
  storage.setItem(CONTACT_IDENTITY_HINT_STORAGE_KEY, serializeContactIdentityHint(client)!);

  assert.equal(
    syncContactIdentityHintIfUnchanged(
      EMPTY_CONTACT_IDENTITY,
      startSnapshot,
      storage,
    ),
    false,
  );
  assert.deepEqual(
    parseContactIdentityHint(storage.getItem(CONTACT_IDENTITY_HINT_STORAGE_KEY)),
    client,
  );
});

test("a delayed storage event cannot restore an older identity hint", () => {
  const currentHint = serializeContactIdentityHint({
    kind: "client",
    maskedPhone: "05•• ••2222",
  });
  const oldHint = serializeContactIdentityHint({
    kind: "client",
    maskedPhone: "05•• ••1111",
  });
  const storage = {
    getItem: () => currentHint,
  };

  assert.equal(isCurrentContactIdentityHintEvent(oldHint, storage), false);
  assert.equal(isCurrentContactIdentityHintEvent(currentHint, storage), true);
  assert.equal(isCurrentContactIdentityHintEvent(oldHint), true);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a stale identity read cannot overwrite a newly saved client", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, EMPTY_CONTACT_IDENTITY);

  const oldRead = deferred<ContactIdentity>();
  const staleFetch = queryClient.fetchQuery({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    queryFn: () => oldRead.promise,
    staleTime: 0,
  });
  const savedIdentity: ContactIdentity = {
    kind: "client",
    maskedPhone: "05•• ••5678",
  };

  await commitContactIdentityCache(queryClient, savedIdentity);
  oldRead.resolve(EMPTY_CONTACT_IDENTITY);
  await Promise.allSettled([staleFetch]);

  assert.deepEqual(
    queryClient.getQueryData(CONTACT_IDENTITY_QUERY_KEY),
    savedIdentity,
  );
});

test("a stale identity read cannot overwrite a client hint received from another tab", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, EMPTY_CONTACT_IDENTITY);
  const oldRead = deferred<ContactIdentity>();
  const staleFetch = queryClient.fetchQuery({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    queryFn: () => oldRead.promise,
    staleTime: 0,
  });
  const identity: ContactIdentity = {
    kind: "client",
    maskedPhone: "05•• ••5678",
  };

  await commitContactIdentityStorageHint(
    queryClient,
    serializeContactIdentityHint(identity),
  );
  oldRead.resolve(EMPTY_CONTACT_IDENTITY);
  await Promise.allSettled([staleFetch]);

  assert.deepEqual(
    queryClient.getQueryData(CONTACT_IDENTITY_QUERY_KEY),
    identity,
  );
});

test("change and logout commit the latest header identity state", async () => {
  const queryClient = new QueryClient();
  const first: ContactIdentity = {
    kind: "client",
    maskedPhone: "05•• ••1111",
  };
  const changed: ContactIdentity = {
    kind: "client",
    maskedPhone: "05•• ••2222",
  };

  queryClient.setQueryData(CUSTOMER_BOOKINGS_QUERY_KEY, {
    identity: { maskedPhone: "05•• ••9999" },
    bookings: [{ id: "sensitive-stale-row" }],
  });
  queryClient.setQueryData(CUSTOMER_PROFILE_QUERY_KEY, {
    fullName: "Sensitive Name",
  });
  queryClient.setQueryData(CUSTOMER_HISTORY_QUERY_KEY, {
    history: [{ id: "sensitive-history-row" }],
  });
  await commitContactIdentityCache(queryClient, first);
  assert.equal(queryClient.getQueryData(CUSTOMER_BOOKINGS_QUERY_KEY), undefined);
  assert.equal(queryClient.getQueryData(CUSTOMER_PROFILE_QUERY_KEY), undefined);
  assert.equal(queryClient.getQueryData(CUSTOMER_HISTORY_QUERY_KEY), undefined);
  await commitContactIdentityCache(queryClient, changed);
  assert.deepEqual(
    queryClient.getQueryData(CONTACT_IDENTITY_QUERY_KEY),
    changed,
  );

  await commitContactIdentityCache(queryClient, EMPTY_CONTACT_IDENTITY);
  assert.deepEqual(
    queryClient.getQueryData(CONTACT_IDENTITY_QUERY_KEY),
    EMPTY_CONTACT_IDENTITY,
  );
});

test("customer session reset clears active PII before refetching it", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(CUSTOMER_PROFILE_QUERY_KEY, {
    fullName: "Old Customer",
  });
  queryClient.setQueryData(CUSTOMER_HISTORY_QUERY_KEY, {
    history: [{ id: "old-history" }],
  });
  queryClient.setQueryData(CUSTOMER_BOOKINGS_QUERY_KEY, {
    bookings: [{ id: "old-booking" }],
  });
  const nextProfile = deferred<{ fullName: string }>();
  const observer = new QueryObserver(queryClient, {
    queryKey: CUSTOMER_PROFILE_QUERY_KEY,
    queryFn: () => nextProfile.promise,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);

  try {
    const reset = resetCustomerSessionQueries(queryClient);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(queryClient.getQueryData(CUSTOMER_PROFILE_QUERY_KEY), undefined);
    assert.equal(queryClient.getQueryData(CUSTOMER_HISTORY_QUERY_KEY), undefined);
    assert.equal(queryClient.getQueryData(CUSTOMER_BOOKINGS_QUERY_KEY), undefined);

    nextProfile.resolve({ fullName: "New Customer" });
    await reset;
    assert.deepEqual(queryClient.getQueryData(CUSTOMER_PROFILE_QUERY_KEY), {
      fullName: "New Customer",
    });
  } finally {
    unsubscribe();
  }
});

test("a cross-tab revision distrusts identity and clears every customer cache", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, {
    kind: "client",
    maskedPhone: "05•• ••5678",
  });
  queryClient.setQueryData(CUSTOMER_PROFILE_QUERY_KEY, { fullName: "Old Customer" });
  queryClient.setQueryData(CUSTOMER_HISTORY_QUERY_KEY, { history: [{ id: "old" }] });
  queryClient.setQueryData(CUSTOMER_BOOKINGS_QUERY_KEY, { bookings: [{ id: "old" }] });

  assert.equal(await handleCustomerSessionStorageChange(queryClient, {
    key: CUSTOMER_BOOKING_SESSION_REVISION_STORAGE_KEY,
    newValue: "new-revision",
  }), true);
  assert.equal(queryClient.getQueryData(CUSTOMER_PROFILE_QUERY_KEY), undefined);
  assert.equal(queryClient.getQueryData(CUSTOMER_HISTORY_QUERY_KEY), undefined);
  assert.equal(queryClient.getQueryData(CUSTOMER_BOOKINGS_QUERY_KEY), undefined);
  assert.equal(
    queryClient.getQueryState(CONTACT_IDENTITY_QUERY_KEY)?.dataUpdatedAt,
    0,
  );
});

test("an active customer profile is revalidated when the browser identity changes", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let reads = 0;
  const observer = new QueryObserver(queryClient, {
    queryKey: CUSTOMER_BOOKINGS_QUERY_KEY,
    queryFn: async () => {
      reads += 1;
      return reads === 1
        ? { bookings: [{ id: "stale-customer-row" }] }
        : { bookings: [] };
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);

  try {
    await observer.refetch();
    assert.equal(
      (queryClient.getQueryData(CUSTOMER_BOOKINGS_QUERY_KEY) as any)
        ?.bookings?.[0]?.id,
      "stale-customer-row",
    );
    await commitContactIdentityCache(queryClient, {
      kind: "client",
      maskedPhone: "05•• ••2222",
    });
    assert.deepEqual(
      queryClient.getQueryData(CUSTOMER_BOOKINGS_QUERY_KEY),
      { bookings: [] },
    );
    assert.equal(reads, 2);
  } finally {
    unsubscribe();
  }
});
