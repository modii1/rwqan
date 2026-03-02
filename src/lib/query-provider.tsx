"use client";

import { QueryClient, QueryClientProvider, QueryFunction } from "@tanstack/react-query";
import { useState } from "react";

async function throwIfResNotOk(res: Response) {
    if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
    }
}

type UnauthorizedBehavior = "returnNull" | "throw";
const getQueryFn: <T>(options: {
    on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
    ({ on401: unauthorizedBehavior }) =>
        async ({ queryKey }) => {
            const res = await fetch(queryKey.join("/") as string, {
                credentials: "include",
            });

            if (unauthorizedBehavior === "returnNull" && res.status === 401) {
                return null;
            }

            await throwIfResNotOk(res);
            return await res.json();
        };

export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        queryFn: getQueryFn({ on401: "throw" }),
                        refetchOnWindowFocus: false,  // لا تحديث عند العودة للنافذة
                        staleTime: 1000 * 60 * 5, // البيانات صالحة لـ 5 دقائق
                        gcTime: 1000 * 60 * 10, // حفظ الكاش لـ 10 دقائق
                        retry: false,
                    },
                    mutations: {
                        retry: false,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}
