import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

import NotFound from "@/pages/not-found";
import PropertiesPage from "@/pages/properties";
import PropertyDetailsPage from "@/pages/property-details";
import OwnerLogin from "@/pages/owner-login";
import OwnerDashboard from "@/pages/owner-dashboard";
import OwnerImagesPage from "@/pages/owner-images";
import SubscriptionPage from "@/pages/subscription";
import SuggestPage from "@/pages/suggest";
import RegisterPage from "@/pages/register";

import { useSessionQuery } from "@/hooks/use-session";

function Router() {
  return (
    <Switch>
      <Route path="/" component={PropertiesPage} />
      <Route path="/property/:id" component={PropertyDetailsPage} />
      <Route path="/owner/login" component={OwnerLogin} />
      <Route path="/owner/dashboard" component={OwnerDashboard} />
      <Route path="/owner/images" component={OwnerImagesPage} />
      <Route path="/owner/subscription" component={SubscriptionPage} />
      <Route path="/suggest" component={SuggestPage} />
      <Route path="/register" component={RegisterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const [, setLocation] = useLocation();
  const { data: session } = useSessionQuery();



  const isLogged = session?.isLoggedIn === true;


  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen flex flex-col bg-background">

{/* ================= HEADER ================= */}
<header className="bg-white border-b shadow-sm sticky top-0 z-50">
  <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">

    {/* Logo */}
    <h1
      className="text-xl font-bold text-primary cursor-pointer"
      onClick={() => setLocation("/")}
    >
      مودي الذكي - العقارات
    </h1>

    {/* Action Buttons */}
    <div className="flex items-center gap-3">

      {/* ========= غير مسجل دخول ========== */}
      {!isLogged && (
        <>
          <Button
            variant="outline"
            onClick={() => setLocation("/owner/login")}
            className="font-bold px-5 h-11 text-base rounded-xl border-[#b88d2b] text-[#8c6a1e] flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12H3m0 0l4-4m-4 4l4 4m8 4h4a2 2 0 002-2V6a2 2 0 00-2-2h-4" />
            </svg>
            تسجيل الدخول
          </Button>

          <Button
            variant="outline"
            onClick={() => setLocation("/")}
            className="font-bold px-5 h-11 text-base rounded-xl border-[#b88d2b] text-[#8c6a1e] flex items-center gap-2"
          >
            🏠 الصفحة الرئيسية
          </Button>
        </>
      )}

      {/* ========= مسجل دخول ========== */}
      {isLogged && (
        <>
          {/* مرحباً */}
          <span className="text-primary font-bold text-lg px-3 whitespace-nowrap">
            مرحباً: {session?.user?.name}
          </span>

          {/* لوحة التحكم */}
          <Button
            onClick={() => setLocation("/owner/dashboard")}
            className="font-bold px-5 h-11 text-base rounded-xl border border-[#b88d2b] text-[#8c6a1e] bg-white hover:bg-[#fff8e5] flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7m-9 2v8m4-8v8m5-3a2 2 0 110 4h-2" />
            </svg>
            لوحة التحكم
          </Button>

          {/* تسجيل الخروج */}
          <Button
            onClick={logout}
            className="font-bold px-5 h-11 text-base rounded-xl border border-[#b88d2b] text-[#8c6a1e] bg-white hover:bg-[#fff8e5] flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 002 2h2a2 2 0 002-2v-1m-6-8V7a2 2 0 012-2h2a2 2 0 012 2v1" />
            </svg>
            تسجيل خروج
          </Button>
        </>
      )}

    </div>
  </div>
</header>
{/* ================ END HEADER ================ */}




          <main className="flex-1 overflow-auto">
            <Router />
          </main>

          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
