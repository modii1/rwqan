import { useQuery } from "@tanstack/react-query";

export function useSessionQuery() {
  return useQuery({
    queryKey: ["owner-session"],
    queryFn: async () => {
      // 1) نجيب حالة الجلسة
      const res = await fetch("/api/owner/session");
      if (!res.ok) return null;

      const data = await res.json();
      if (!data.isLoggedIn || !data.propertyNumber) {
        return null;
      }

      // 2) نجيب بيانات العقار عشان الاسم
      const propRes = await fetch("/api/owner/property");
      if (!propRes.ok) {
        // نرجع أقل شيء رقم العقار
        return {
          user: { propertyNumber: data.propertyNumber },
        };
      }

      const property = await propRes.json();

      // الشكل اللي الهيدر يفهمه
      return {
        user: {
          propertyNumber: data.propertyNumber,
          name: property.name,
        },
      };
    },
    staleTime: 0,
    cacheTime: 0,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchInterval: 2000, // يحدث كل ثانيتين
  });
}
