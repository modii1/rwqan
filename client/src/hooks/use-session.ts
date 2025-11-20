import { useQuery } from "@tanstack/react-query";

export function useSessionQuery() {
  return useQuery({
    queryKey: ["owner-session"],
    queryFn: async () => {
      const res = await fetch("/api/owner/session", {
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) return null;

      const session = await res.json();

      if (!session.isLoggedIn || !session.propertyNumber) return null;

      return {
        isLoggedIn: true,
        user: {
          propertyNumber: session.propertyNumber,
        },
      };
    },

    staleTime: 0,
    gcTime: 0,

    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,

    // 🔥 تحديث فوري
    refetchInterval: 500,
  });
}
