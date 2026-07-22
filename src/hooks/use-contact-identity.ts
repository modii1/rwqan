import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

async function fetchContactIdentity(): Promise<ContactIdentity> {
  const response = await fetch("/api/contact-identity", {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(getApiError(payload, "تعذر التحقق من رقم التواصل المحفوظ"));
  }

  return parseIdentity(payload);
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
  return useQuery<ContactIdentity>({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    queryFn: fetchContactIdentity,
    staleTime: 1000 * 60,
    refetchOnWindowFocus: "always",
    retry: false,
  });
}

export function useSaveContactIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveContactIdentity,
    onSuccess: (identity) => {
      queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, identity);
    },
  });
}

export function useDeleteContactIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteContactIdentity,
    onSuccess: () => {
      queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, EMPTY_CONTACT_IDENTITY);
    },
  });
}
