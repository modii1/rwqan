import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import {
  CUSTOMER_HISTORY_QUERY_KEY,
  CUSTOMER_PROFILE_QUERY_KEY,
} from "@/hooks/use-customer-account";

export type ContactIdentityKind = "none" | "client" | "owner" | "admin";

export interface ContactIdentity {
  kind: ContactIdentityKind;
  maskedPhone: string | null;
  sessionRevision?: string;
}

export interface ContactIdentityChallenge {
  alreadyVerified: boolean;
  challengeId?: string;
  maskedPhone: string;
  expiresInSeconds?: number;
  identity?: ContactIdentity;
}

export interface VerifyContactIdentityCodeInput {
  challengeId: string;
  code: string;
  clientPhone: string;
}

export const CONTACT_IDENTITY_QUERY_KEY = ["/api/contact-identity"] as const;
export const CUSTOMER_BOOKINGS_QUERY_KEY = ["customer-bookings"] as const;
export const CUSTOMER_BOOKING_SESSION_REVISION_STORAGE_KEY =
  "rwqan-customer-booking-session-revision";

export const EMPTY_CONTACT_IDENTITY: ContactIdentity = {
  kind: "none",
  maskedPhone: null,
};

export const CONTACT_IDENTITY_HINT_STORAGE_KEY = "rwqan-contact-identity-hint";

export function hasServerResolvedContactIdentity(query: {
  isSuccess: boolean;
  dataUpdatedAt: number;
}): boolean {
  return query.isSuccess && query.dataUpdatedAt > 0;
}

export function getCustomerSessionCacheScope(query: {
  isSuccess: boolean;
  dataUpdatedAt: number;
  data?: ContactIdentity;
}): string | null {
  if (!hasServerResolvedContactIdentity(query)) {
    return null;
  }
  return customerSessionCacheScopeForIdentity(query.data);
}

export function customerSessionCacheScopeForIdentity(
  identity: ContactIdentity | undefined,
): string | null {
  if (identity?.kind !== "client") return null;
  const revision = String(identity.sessionRevision || "").trim();
  return /^[a-f0-9]{64}$/.test(revision) ? `session:${revision}` : null;
}

export function parseContactIdentityHint(value: string | null): ContactIdentity | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.kind !== "client" || typeof parsed.maskedPhone !== "string") {
      return undefined;
    }
    return { kind: "client", maskedPhone: parsed.maskedPhone };
  } catch {
    return undefined;
  }
}

export function serializeContactIdentityHint(identity: ContactIdentity): string | null {
  if (identity.kind !== "client" || !identity.maskedPhone) return null;
  return JSON.stringify({ kind: "client", maskedPhone: identity.maskedPhone });
}

function syncContactIdentityHint(identity: ContactIdentity): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = serializeContactIdentityHint(identity);
    if (serialized) {
      window.localStorage.setItem(CONTACT_IDENTITY_HINT_STORAGE_KEY, serialized);
    } else {
      window.localStorage.removeItem(CONTACT_IDENTITY_HINT_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export function broadcastCustomerBookingSessionChange(): void {
  if (typeof window === "undefined") return;
  try {
    const nonce = typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    window.localStorage.setItem(
      CUSTOMER_BOOKING_SESSION_REVISION_STORAGE_KEY,
      `${Date.now()}-${nonce}`,
    );
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

type ContactIdentityHintStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function syncContactIdentityHintIfUnchanged(
  identity: ContactIdentity,
  expectedSerializedHint: string | null,
  storage: ContactIdentityHintStorage,
): boolean {
  if (storage.getItem(CONTACT_IDENTITY_HINT_STORAGE_KEY) !== expectedSerializedHint) {
    return false;
  }
  const serialized = serializeContactIdentityHint(identity);
  if (serialized) {
    storage.setItem(CONTACT_IDENTITY_HINT_STORAGE_KEY, serialized);
  } else {
    storage.removeItem(CONTACT_IDENTITY_HINT_STORAGE_KEY);
  }
  return true;
}

function readSerializedContactIdentityHint(): string | null | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(CONTACT_IDENTITY_HINT_STORAGE_KEY);
  } catch {
    return undefined;
  }
}

export async function commitContactIdentityCache(
  queryClient: QueryClient,
  identity: ContactIdentity,
): Promise<void> {
  // A focus-triggered GET may start while POST/DELETE is pending. Cancel it
  // again at commit time so an older response cannot overwrite the mutation.
  const identityCancellation = queryClient.cancelQueries({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    exact: true,
  });
  queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, identity);
  const customerQueriesReset = resetCustomerSessionQueries(queryClient);
  syncContactIdentityHint(identity);
  broadcastCustomerBookingSessionChange();
  await Promise.all([identityCancellation, customerQueriesReset]);
}

export async function resetCustomerSessionQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({
      queryKey: CUSTOMER_PROFILE_QUERY_KEY,
      exact: false,
    }),
    queryClient.cancelQueries({
      queryKey: CUSTOMER_HISTORY_QUERY_KEY,
      exact: false,
    }),
    queryClient.cancelQueries({
      queryKey: CUSTOMER_BOOKINGS_QUERY_KEY,
      exact: true,
    }),
  ]);
  await Promise.all([
    queryClient.resetQueries({
      queryKey: CUSTOMER_PROFILE_QUERY_KEY,
      exact: false,
    }),
    queryClient.resetQueries({
      queryKey: CUSTOMER_HISTORY_QUERY_KEY,
      exact: false,
    }),
    queryClient.resetQueries({
      queryKey: CUSTOMER_BOOKINGS_QUERY_KEY,
      exact: true,
    }),
  ]);
}

export function isCurrentContactIdentityHintEvent(
  serializedHint: string | null,
  storage?: Pick<Storage, "getItem">,
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(CONTACT_IDENTITY_HINT_STORAGE_KEY) === serializedHint;
  } catch {
    return true;
  }
}

export async function commitContactIdentityStorageHint(
  queryClient: QueryClient,
  serializedHint: string | null,
): Promise<void> {
  const identity = parseContactIdentityHint(serializedHint) || EMPTY_CONTACT_IDENTITY;
  const identityCancellation = queryClient.cancelQueries({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    exact: true,
  });
  queryClient.setQueryData(
    CONTACT_IDENTITY_QUERY_KEY,
    identity,
    { updatedAt: 0 },
  );
  const customerQueriesReset = resetCustomerSessionQueries(queryClient);
  await identityCancellation;
  await Promise.all([
    customerQueriesReset,
    queryClient.invalidateQueries({
      queryKey: CONTACT_IDENTITY_QUERY_KEY,
      exact: true,
    }),
  ]);
}

export async function handleCustomerSessionStorageChange(
  queryClient: QueryClient,
  event: Pick<StorageEvent, "key" | "newValue">,
): Promise<boolean> {
  if (event.key === CONTACT_IDENTITY_HINT_STORAGE_KEY) {
    let storage: Pick<Storage, "getItem"> | undefined;
    if (typeof window !== "undefined") {
      try {
        storage = window.localStorage;
      } catch {
        // Storage can be unavailable in private/restricted browser contexts.
      }
    }
    if (!isCurrentContactIdentityHintEvent(event.newValue, storage)) {
      return true;
    }
    await commitContactIdentityStorageHint(queryClient, event.newValue);
    return true;
  }
  if (event.key !== CUSTOMER_BOOKING_SESSION_REVISION_STORAGE_KEY) {
    return false;
  }

  const identityCancellation = queryClient.cancelQueries({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    exact: true,
  });
  const currentIdentity = queryClient.getQueryData<ContactIdentity>(
    CONTACT_IDENTITY_QUERY_KEY,
  );
  if (currentIdentity) {
    queryClient.setQueryData(
      CONTACT_IDENTITY_QUERY_KEY,
      currentIdentity,
      { updatedAt: 0 },
    );
  }
  const customerQueriesReset = resetCustomerSessionQueries(queryClient);
  await identityCancellation;
  await Promise.all([
    customerQueriesReset,
    queryClient.invalidateQueries({
      queryKey: CONTACT_IDENTITY_QUERY_KEY,
      exact: true,
    }),
  ]);
  return true;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  return response.json();
}

function getApiError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.error || record.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function parseIdentity(payload: unknown): ContactIdentity {
  if (!payload || typeof payload !== "object") return EMPTY_CONTACT_IDENTITY;

  const record = payload as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "none" && kind !== "client" && kind !== "owner" && kind !== "admin") {
    return EMPTY_CONTACT_IDENTITY;
  }

  const sessionRevision = typeof record.sessionRevision === "string"
    ? record.sessionRevision.trim()
    : "";
  return {
    kind,
    maskedPhone: typeof record.maskedPhone === "string" ? record.maskedPhone : null,
    ...(sessionRevision ? { sessionRevision } : {}),
  };
}

function parseClientIdentity(payload: unknown, fallback: string): ContactIdentity {
  const identity = parseIdentity(payload);
  if (
    identity.kind !== "client"
    || !identity.maskedPhone
    || !customerSessionCacheScopeForIdentity(identity)
  ) {
    throw new Error(fallback);
  }
  return identity;
}

type ContactIdentityFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function requestContactIdentityCode(
  clientPhone: string,
  fetcher: ContactIdentityFetch = fetch,
): Promise<ContactIdentityChallenge> {
  const response = await fetcher("/api/contact-identity/challenge", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientPhone }),
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(getApiError(payload, "تعذر إرسال رمز التحقق"));
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("تعذر تأكيد إرسال رمز التحقق");
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.alreadyVerified !== "boolean") {
    throw new Error("تعذر تأكيد إرسال رمز التحقق");
  }
  const maskedPhone = typeof record.maskedPhone === "string"
    ? record.maskedPhone.trim()
    : "";
  if (!maskedPhone) {
    throw new Error("تعذر تأكيد إرسال رمز التحقق");
  }

  const challengeId = typeof record.challengeId === "string"
    ? record.challengeId.trim()
    : "";
  if (!record.alreadyVerified && !challengeId) {
    throw new Error("تعذر تأكيد إرسال رمز التحقق");
  }

  const identity = record.identity === undefined
    ? undefined
    : parseClientIdentity(record.identity, "تعذر تأكيد رقم التواصل");
  const expiresInSeconds = Number(record.expiresInSeconds);
  return {
    alreadyVerified: record.alreadyVerified,
    ...(challengeId ? { challengeId } : {}),
    maskedPhone,
    ...(Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? { expiresInSeconds: Math.floor(expiresInSeconds) }
      : {}),
    ...(identity ? { identity } : {}),
  };
}

export async function verifyContactIdentityCode(
  input: VerifyContactIdentityCodeInput,
  fetcher: ContactIdentityFetch = fetch,
): Promise<ContactIdentity> {
  const response = await fetcher("/api/contact-identity/verify", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId: input.challengeId,
      code: input.code,
      clientPhone: input.clientPhone,
    }),
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(getApiError(payload, "رمز التحقق غير صحيح أو منتهي"));
  }
  return parseClientIdentity(payload, "تعذر تأكيد رقم التواصل");
}

export async function fetchContactIdentity(signal?: AbortSignal): Promise<ContactIdentity> {
  const hintAtRequestStart = readSerializedContactIdentityHint();
  const response = await fetch("/api/contact-identity", {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(getApiError(payload, "تعذر التحقق من رقم التواصل المحفوظ"));
  }

  const identity = parseIdentity(payload);
  if (identity.kind === "client" && !customerSessionCacheScopeForIdentity(identity)) {
    throw new Error("تعذر التحقق من رقم التواصل المحفوظ");
  }
  if (hintAtRequestStart !== undefined && typeof window !== "undefined") {
    try {
      syncContactIdentityHintIfUnchanged(
        identity,
        hintAtRequestStart,
        window.localStorage,
      );
    } catch {
      // Storage can be unavailable in private/restricted browser contexts.
    }
  }
  return identity;
}

async function deleteContactIdentity(): Promise<void> {
  const response = await fetch("/api/contact-identity", {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await readJson(response);
    throw new Error(getApiError(payload, "تعذر تسجيل الخروج"));
  }
}

export function useContactIdentityQuery() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      void handleCustomerSessionStorageChange(queryClient, event);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [queryClient]);

  return useQuery<ContactIdentity>({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    queryFn: ({ signal }) => fetchContactIdentity(signal),
    staleTime: 1000 * 60,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
}

export function useRequestContactIdentityCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clientPhone: string) => requestContactIdentityCode(clientPhone),
    onSuccess: async (challenge) => {
      if (!challenge.alreadyVerified) return;
      if (challenge.identity) {
        await commitContactIdentityCache(queryClient, challenge.identity);
        return;
      }

      await resetCustomerSessionQueries(queryClient);
      await queryClient.invalidateQueries({
        queryKey: CONTACT_IDENTITY_QUERY_KEY,
        exact: true,
      });
      broadcastCustomerBookingSessionChange();
    },
  });
}

export function useVerifyContactIdentityCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: VerifyContactIdentityCodeInput) =>
      verifyContactIdentityCode(input),
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: CONTACT_IDENTITY_QUERY_KEY,
        exact: true,
      });
    },
    onSuccess: (identity) => commitContactIdentityCache(queryClient, identity),
  });
}

export function useDeleteContactIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteContactIdentity,
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: CONTACT_IDENTITY_QUERY_KEY,
        exact: true,
      });
    },
    onSuccess: () =>
      commitContactIdentityCache(queryClient, EMPTY_CONTACT_IDENTITY),
  });
}
