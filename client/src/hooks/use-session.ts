import { useQuery } from "@tanstack/react-query";

export interface SessionResponse {
  user?: {
    id: string;
    name: string;
    phone: string;
    subscriptionType: string;
  };
}

export function useSessionQuery() {
  return useQuery<SessionResponse>({
    queryKey: ["session"],
    queryFn: async () => {
      const res = await fetch("/api/session");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
