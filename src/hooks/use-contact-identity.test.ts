import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  CONTACT_IDENTITY_QUERY_KEY,
  CONTACT_IDENTITY_HINT_STORAGE_KEY,
  EMPTY_CONTACT_IDENTITY,
  commitContactIdentityCache,
  commitContactIdentityStorageHint,
  parseContactIdentityHint,
  serializeContactIdentityHint,
  syncContactIdentityHintIfUnchanged,
  type ContactIdentity,
} from "./use-contact-identity";

test("the cross-tab hint contains only masked client display state", () => {
  const identity: ContactIdentity = {
    kind: "client",
    maskedPhone: "05•• ••5678",
  };
  const serialized = serializeContactIdentityHint(identity);

  assert.equal(serialized, JSON.stringify(identity));
  assert.deepEqual(parseContactIdentityHint(serialized), identity);
  assert.equal(serialized?.includes("0512345678"), false);
  assert.equal(serializeContactIdentityHint(EMPTY_CONTACT_IDENTITY), null);
  assert.equal(parseContactIdentityHint('{"kind":"owner","maskedPhone":"x"}'), undefined);
  assert.equal(parseContactIdentityHint("invalid json"), undefined);
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

  await commitContactIdentityCache(queryClient, first);
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
