import { useQuery } from "@tanstack/react-query";

export function useSessionQuery() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const res = await fetch("/api/session", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },

    // أهم شيء
    staleTime: 0,
    cacheTime: 0,
    refetchInterval: 2000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
}
