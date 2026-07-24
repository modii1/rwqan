import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  CONTACT_IDENTITY_QUERY_KEY,
  EMPTY_CONTACT_IDENTITY,
  commitContactIdentityCache,
  type ContactIdentity,
} from "./use-contact-identity";

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
