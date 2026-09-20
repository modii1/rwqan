"use client";

import { Heart, Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CONTACT_IDENTITY_QUERY_KEY,
  customerSessionCacheScopeForIdentity,
  fetchContactIdentity,
  getCustomerSessionCacheScope,
  hasServerResolvedContactIdentity,
  type ContactIdentity,
} from "@/hooks/use-contact-identity";
import {
  customerProfileQueryKey,
  fetchCustomerProfile,
  useCustomerProfileQuery,
  useSetCustomerFavorite,
} from "@/hooks/use-customer-account";
import { customerLoginHref } from "@/lib/customer-login-redirect";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PropertyFavoriteButtonProps {
  propertyNumber: string;
  className?: string;
}

export function PropertyFavoriteButton({
  propertyNumber,
  className,
}: PropertyFavoriteButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const identity = useQuery<ContactIdentity>({
    queryKey: CONTACT_IDENTITY_QUERY_KEY,
    queryFn: ({ signal }) => fetchContactIdentity(signal),
    staleTime: 60_000,
    retry: false,
  });
  const hasResolvedIdentity = hasServerResolvedContactIdentity(identity);
  const customerSessionScope = getCustomerSessionCacheScope(identity);
  const isCustomer = hasResolvedIdentity
    && identity.data?.kind === "client"
    && Boolean(customerSessionScope);
  const profile = useCustomerProfileQuery(isCustomer, customerSessionScope);
  const favoriteMutation = useSetCustomerFavorite(customerSessionScope);
  const isFavorite = isCustomer && Boolean(
    profile.data?.favoritePropertyNumbers.includes(propertyNumber),
  );

  if (
    hasResolvedIdentity
    && (identity.data?.kind === "owner" || identity.data?.kind === "admin")
  ) {
    return null;
  }

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    let resolvedIdentity = identity.data;
    if (!hasResolvedIdentity) {
      const refreshedIdentity = await identity.refetch();
      if (!hasServerResolvedContactIdentity(refreshedIdentity)) return;
      resolvedIdentity = refreshedIdentity.data;
    }

    if (resolvedIdentity?.kind === "owner" || resolvedIdentity?.kind === "admin") {
      return;
    }

    if (resolvedIdentity?.kind !== "client") {
      const returnTo = typeof window === "undefined"
        ? pathname || "/"
        : `${window.location.pathname}${window.location.search}`;
      router.push(customerLoginHref(returnTo, propertyNumber));
      return;
    }

    const requestSessionScope = customerSessionCacheScopeForIdentity(
      resolvedIdentity,
    );
    if (!requestSessionScope) {
      toast({
        title: "تعذر تحديث المفضلة",
        description: "تعذر التحقق من جلسة العميل. حاول تسجيل الدخول مرة أخرى.",
        variant: "destructive",
      });
      return;
    }

    let favoriteAtClick = isFavorite;
    if (
      !isCustomer
      || customerSessionScope !== requestSessionScope
      || !profile.data
    ) {
      try {
        const refreshedProfile = await queryClient.fetchQuery({
          queryKey: customerProfileQueryKey(requestSessionScope),
          queryFn: () => fetchCustomerProfile(requestSessionScope),
          staleTime: 0,
        });
        favoriteAtClick = refreshedProfile.favoritePropertyNumbers
          .includes(propertyNumber);
      } catch (profileError) {
        toast({
          title: "تعذر تحديث المفضلة",
          description: profileError instanceof Error
            ? profileError.message
            : "حاول مرة أخرى.",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      await favoriteMutation.mutateAsync({
        propertyNumber,
        favorite: !favoriteAtClick,
        sessionScope: requestSessionScope,
      });
      toast({
        title: favoriteAtClick ? "تمت الإزالة من المفضلة" : "تمت الإضافة إلى المفضلة",
      });
    } catch (error) {
      toast({
        title: "تعذر تحديث المفضلة",
        description: error instanceof Error ? error.message : "حاول مرة أخرى.",
        variant: "destructive",
      });
    }
  };

  const isBusy = identity.isPending
    || identity.isFetching
    || (isCustomer && (profile.isPending || profile.isFetching))
    || favoriteMutation.isPending;
  const label = isFavorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isBusy}
      aria-label={label}
      title={label}
      aria-pressed={isFavorite}
      data-testid={`button-favorite-${propertyNumber}`}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/90 text-[#6f6249] shadow-md backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a7623] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70",
        isFavorite && "border-[#ead79e] bg-[#fff8df] text-[#9a7623]",
        className,
      )}
    >
      {isBusy ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <Heart
          className={cn("h-5 w-5", isFavorite && "fill-current")}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
