import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

export type ContactIdentityKind = "none" | "client" | "owner" | "admin";

export interface ContactIdentity {
  kind: ContactIdentityKind;
  maskedPhone: string | null;
}

export const CONTACT_IDENTITY_QUERY_KEY = ["/api/contact-identity"] as const;

export const EMPTY_CONTACT_IDENTITY: ContactIdentity = {
  kind: "none",
  maskedPhone: null,
};

export const CONTACT_IDENTITY_HINT_STORAGE_KEY = "rwqan-contact-identity-hint";

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

function readContactIdentityHint(): ContactIdentity | undefined {
  return parseContactIdentityHint(readSerializedContactIdentityHint() ?? null);
}

export async function commitContactIdentityCache(
  queryClient: QueryClient,
  identity: ContactIdentity,
): Promise<void> {
  // A focus-triggered GET may start while POST/DELETE is pending. Cancel it
  // again at commit time so an older response cannot overwrite the mutation.
  await queryClient.cancelQueries({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    exact: true,
  });
  queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, identity);
  syncContactIdentityHint(identity);
}

export async function commitContactIdentityStorageHint(
  queryClient: QueryClient,
  serializedHint: string | null,
): Promise<void> {
  const identity = parseContactIdentityHint(serializedHint) || EMPTY_CONTACT_IDENTITY;
  await queryClient.cancelQueries({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    exact: true,
  });
  queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, identity);
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

  return {
    kind,
    maskedPhone: typeof record.maskedPhone === "string" ? record.maskedPhone : null,
  };
}

async function fetchContactIdentity(signal?: AbortSignal): Promise<ContactIdentity> {
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

async function saveContactIdentity(clientPhone: string): Promise<ContactIdentity> {
  const response = await fetch("/api/contact-identity", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientPhone }),
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(getApiError(payload, "تعذر حفظ رقم التواصل"));
  }

  const identity = parseIdentity(payload);
  if (identity.kind !== "client") {
    throw new Error("تعذر تأكيد حفظ رقم التواصل");
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
      if (event.key !== CONTACT_IDENTITY_HINT_STORAGE_KEY) return;
      void commitContactIdentityStorageHint(queryClient, event.newValue);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [queryClient]);

  return useQuery<ContactIdentity>({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    queryFn: ({ signal }) => fetchContactIdentity(signal),
    initialData: readContactIdentityHint,
    initialDataUpdatedAt: 0,
    staleTime: 1000 * 60,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
}

export function useSaveContactIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveContactIdentity,
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
