import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { BookingApiError, bookingApiRequest } from "@/components/booking/booking-api";
import {
  CUSTOMER_SESSION_REVISION_HEADER,
  customerSessionRevisionSchema,
} from "@shared/customer";

export interface CustomerProfile {
  fullName: string;
  email: string | null;
  maskedPhone: string | null;
  favoritePropertyNumbers: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

interface CustomerProfilePayload {
  profile: CustomerProfile;
}

interface CustomerFavoritesPayload {
  favoritePropertyNumbers: string[];
}

export const CUSTOMER_PROFILE_QUERY_KEY = ["customer-profile"] as const;
export const CUSTOMER_HISTORY_QUERY_KEY = ["customer-history"] as const;
const CONTACT_IDENTITY_SESSION_QUERY_KEY = ["/api/contact-identity"] as const;

export function customerProfileQueryKey(sessionScope: string | null) {
  return [...CUSTOMER_PROFILE_QUERY_KEY, sessionScope || "unresolved"] as const;
}

export function customerHistoryQueryKey(sessionScope: string | null) {
  return [...CUSTOMER_HISTORY_QUERY_KEY, sessionScope || "unresolved"] as const;
}

export function customerSessionRequestHeaders(
  sessionScope: string | null,
): Record<string, string> {
  const prefix = "session:";
  const revision = sessionScope?.startsWith(prefix)
    ? sessionScope.slice(prefix.length)
    : "";
  const parsed = customerSessionRevisionSchema.safeParse(revision);
  if (!parsed.success) {
    throw new BookingApiError(
      "تغيّرت جلسة العميل. حدّث الصفحة ثم حاول مرة أخرى.",
      409,
      "CUSTOMER_SESSION_CHANGED",
    );
  }
  return { [CUSTOMER_SESSION_REVISION_HEADER]: parsed.data };
}

type CustomerSessionSnapshot = {
  dataUpdatedAt: number;
  dataUpdateCount: number;
  kind: string | null;
  maskedPhone: string | null;
  cacheScope: string;
};

export function captureCustomerSessionSnapshot(
  queryClient: QueryClient,
): CustomerSessionSnapshot {
  const state = queryClient.getQueryState(CONTACT_IDENTITY_SESSION_QUERY_KEY);
  const identity = queryClient.getQueryData<{
    kind?: unknown;
    maskedPhone?: unknown;
    sessionRevision?: unknown;
  }>(CONTACT_IDENTITY_SESSION_QUERY_KEY);
  const sessionRevision = typeof identity?.sessionRevision === "string"
    ? identity.sessionRevision.trim()
    : "";
  return {
    dataUpdatedAt: state?.dataUpdatedAt || 0,
    dataUpdateCount: state?.dataUpdateCount || 0,
    kind: typeof identity?.kind === "string" ? identity.kind : null,
    maskedPhone: typeof identity?.maskedPhone === "string"
      ? identity.maskedPhone
      : null,
    cacheScope: sessionRevision
      ? `session:${sessionRevision}`
      : `resolved:${state?.dataUpdatedAt || 0}:${state?.dataUpdateCount || 0}`,
  };
}

export function isCustomerSessionSnapshotCurrent(
  queryClient: QueryClient,
  snapshot: CustomerSessionSnapshot,
): boolean {
  const current = captureCustomerSessionSnapshot(queryClient);
  return snapshot.kind === "client"
    && current.kind === snapshot.kind
    && current.maskedPhone === snapshot.maskedPhone
    && current.cacheScope === snapshot.cacheScope
    && current.dataUpdatedAt === snapshot.dataUpdatedAt
    && current.dataUpdateCount === snapshot.dataUpdateCount;
}

export function updateFavoritePropertyNumbers(
  current: readonly string[],
  propertyNumber: string,
  favorite: boolean,
): string[] {
  const favorites = new Set(current);
  if (favorite) favorites.add(propertyNumber);
  else favorites.delete(propertyNumber);
  return [...favorites];
}

export async function fetchCustomerProfile(
  sessionScope: string | null,
): Promise<CustomerProfile> {
  const payload = await bookingApiRequest<CustomerProfilePayload>(
    "/api/customer/profile",
    { headers: customerSessionRequestHeaders(sessionScope) },
  );
  return payload.profile;
}

export async function updateCustomerProfile(input: {
  fullName: string;
  email: string | null;
}, sessionScope: string | null): Promise<CustomerProfile> {
  const payload = await bookingApiRequest<CustomerProfilePayload>(
    "/api/customer/profile",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...customerSessionRequestHeaders(sessionScope),
      },
      body: JSON.stringify(input),
    },
  );
  return payload.profile;
}

export async function setCustomerFavorite(
  propertyNumber: string,
  favorite: boolean,
  sessionScope: string | null,
): Promise<string[]> {
  const payload = await bookingApiRequest<CustomerFavoritesPayload>(
    `/api/customer/favorites/${encodeURIComponent(propertyNumber)}`,
    {
      method: favorite ? "PUT" : "DELETE",
      headers: customerSessionRequestHeaders(sessionScope),
    },
  );
  return payload.favoritePropertyNumbers;
}

export function useCustomerProfileQuery(
  enabled = true,
  sessionScope: string | null = null,
) {
  return useQuery<CustomerProfile>({
    queryKey: customerProfileQueryKey(sessionScope),
    queryFn: () => fetchCustomerProfile(sessionScope),
    enabled: enabled && Boolean(sessionScope),
    retry: false,
    staleTime: 30_000,
  });
}

export function useUpdateCustomerProfile(sessionScope: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fullName: string; email: string | null }) =>
      updateCustomerProfile(input, sessionScope),
    onMutate: () => ({
      session: captureCustomerSessionSnapshot(queryClient),
    }),
    onSuccess: (profile, _variables, context) => {
      if (isCustomerSessionSnapshotCurrent(queryClient, context.session)) {
        queryClient.setQueryData(
          customerProfileQueryKey(context.session.cacheScope),
          profile,
        );
      }
    },
    onSettled: () => queryClient.invalidateQueries({
      queryKey: CUSTOMER_PROFILE_QUERY_KEY,
    }),
  });
}

export function useSetCustomerFavorite(sessionScope: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      propertyNumber,
      favorite,
      sessionScope: requestSessionScope,
    }: {
      propertyNumber: string;
      favorite: boolean;
      sessionScope?: string | null;
    }) => setCustomerFavorite(
      propertyNumber,
      favorite,
      requestSessionScope || sessionScope,
    ),
    onMutate: async ({
      propertyNumber,
      favorite,
      sessionScope: requestSessionScope,
    }) => {
      await queryClient.cancelQueries({ queryKey: CUSTOMER_PROFILE_QUERY_KEY });
      const session = captureCustomerSessionSnapshot(queryClient);
      const profileQueryKey = customerProfileQueryKey(
        requestSessionScope || sessionScope,
      );
      const previous = queryClient.getQueryData<CustomerProfile>(
        profileQueryKey,
      );
      if (previous && session.kind === "client") {
        queryClient.setQueryData<CustomerProfile>(profileQueryKey, {
          ...previous,
          favoritePropertyNumbers: updateFavoritePropertyNumbers(
            previous.favoritePropertyNumbers,
            propertyNumber,
            favorite,
          ),
        });
      }
      return { previous, session, profileQueryKey };
    },
    onSuccess: (favoritePropertyNumbers, _variables, context) => {
      if (!isCustomerSessionSnapshotCurrent(queryClient, context.session)) return;
      queryClient.setQueryData<CustomerProfile>(
        context.profileQueryKey,
        (profile) => profile
          ? { ...profile, favoritePropertyNumbers }
          : profile,
      );
    },
    onError: (_error, _variables, context) => {
      if (
        context?.previous
        && isCustomerSessionSnapshotCurrent(queryClient, context.session)
      ) {
        queryClient.setQueryData(context.profileQueryKey, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({
      queryKey: CUSTOMER_PROFILE_QUERY_KEY,
    }),
  });
}

export function isCustomerAuthenticationError(error: unknown): boolean {
  return error instanceof BookingApiError && error.status === 401;
}
