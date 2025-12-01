import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import AdminDashboard from "@/pages/admin";


// Pages
import NotFound from "@/pages/not-found";
import PropertiesPage from "@/pages/properties";
import PropertyDetailsPage from "@/pages/property-details";
import OwnerLogin from "@/pages/owner-login";
import OwnerDashboard from "@/pages/owner-dashboard";
import OwnerImagesPage from "@/pages/owner-images";
import SubscriptionPage from "@/pages/subscription";
import SuggestPage from "@/pages/suggest";
import RegisterPage from "@/pages/register";
import TestImages from "@/pages/test-images";
import AdminImagesPage from "@/pages/admin/admin-images";



// Icons
import { Home, LogIn, LogOut, Settings } from "lucide-react";

// Session Hook
import { useSessionQuery } from "@/hooks/use-session";

function Router() {
  return (
    <Switch>
      {/* الصفحات العامة */}
      <Route path="/" component={PropertiesPage} />
      <Route path="/property/:id" component={PropertyDetailsPage} />

      {/* صفحات المالك */}
      <Route path="/owner/login" component={OwnerLogin} />
      <Route path="/owner/dashboard" component={OwnerDashboard} />
      <Route path="/owner/images" component={OwnerImagesPage} />
      <Route path="/owner/subscription" component={SubscriptionPage} />

      {/* صفحات عامة */}
      <Route path="/suggest" component={SuggestPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/test-images" component={TestImages} />

      {/* ======================= */}
      {/* صفحات الأدمن الجديدة */}
      {/* ======================= */}

      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/images/:propertyNumber" component={AdminImagesPage} />




      {/* صفحة 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}


export default function App() {
  const [location, setLocation] = useLocation();
  const { data: session } = useSessionQuery();
  const [appReady, setAppReady] = useState(false);

  // SPA Redirect Handler for static deployment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    if (redirect) {
      const decodedPath = decodeURIComponent(redirect);
      window.history.replaceState(null, '', decodedPath);
      setLocation(decodedPath);
    }
  }, [setLocation]);

  useEffect(() => {
    const t = setTimeout(() => setAppReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  if (!appReady) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "22px",
          color: "#b88d2b",
          fontFamily: "Cairo",
        }}
      >
        جاري التحميل...
      </div>
    );
  }
  // ⭐ نهاية شاشة التحميل

  // login check
  const isLogged = !!session?.user;

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  };

  const iconStyle =
    "p-2 h-10 w-10 rounded-xl border border-gray-300 text-[#555] bg-white hover:bg-gray-100 flex items-center justify-center transition";

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen flex flex-col bg-background">

          {/* ================= HEADER ================= */}
          <header className="bg-white border-b shadow-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">

              <h1
                onClick={() => setLocation("/")}
                className="text-lg md:text-xl font-bold text-primary cursor-pointer"
              >
                مودي الذكي - العقارات
              </h1>

              <div className="flex items-center gap-3">

                {/* الصفحة الرئيسية */}
                <Button onClick={() => setLocation("/")} className={iconStyle}>
                  <Home className="w-5 h-5" />
                </Button>

                {/* زر تسجيل الدخول */}
                {!isLogged && (
                  <Button
                    onClick={() => setLocation("/owner/login")}
                    className={iconStyle}
                  >
                    <LogIn className="w-5 h-5" />
                  </Button>
                )}

                {isLogged && (
                  <>
                    <Button
                      onClick={() => setLocation("/owner/dashboard")}
                      className={iconStyle}
                    >
                      <Settings className="w-5 h-5" />
                    </Button>

                    <Button onClick={logout} className={iconStyle}>
                      <LogOut className="w-5 h-5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-auto">
            <Router />
          </main>

          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}