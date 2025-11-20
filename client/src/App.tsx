import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

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

// Icons
import { Home, LogIn, LogOut, Settings } from "lucide-react";

// Session Hook
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

  // login check
  const isLogged = !!session?.user;

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  };

  // 🔥 نمط موحد لكل الأيقونات
  const iconStyle =
    "p-2 h-10 w-10 rounded-xl border border-gray-300 text-[#555] bg-white hover:bg-gray-100 flex items-center justify-center transition";

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen flex flex-col bg-background">

          {/* ================= HEADER ================= */}
          <header className="bg-white border-b shadow-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">

              {/* Logo */}
              <h1
                onClick={() => setLocation("/")}
                className="text-lg md:text-xl font-bold text-primary cursor-pointer"
              >
                مودي الذكي - العقارات
              </h1>

              {/* Icons */}
              <div className="flex items-center gap-3">

                {/* الصفحة الرئيسية */}
                <Button
                  onClick={() => setLocation("/")}
                  className={iconStyle}
                >
                  <Home className="w-5 h-5" />
                </Button>

                {/* غير مسجل دخول */}
                {!isLogged && (
                  <Button
                    onClick={() => setLocation("/owner/login")}
                    className={iconStyle}
                  >
                    <LogIn className="w-5 h-5" />
                  </Button>
                )}

                {/* مسجل دخول */}
                {isLogged && (
                  <>
                    {/* الإعدادات */}
                    <Button
                      onClick={() => setLocation("/owner/dashboard")}
                      className={iconStyle}
                    >
                      <Settings className="w-5 h-5" />
                    </Button>

                    {/* تسجيل خروج */}
                    <Button
                      onClick={logout}
                      className={iconStyle}
                    >
                      <LogOut className="w-5 h-5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* ================= END HEADER ================= */}

          <main className="flex-1 overflow-auto">
            <Router />
          </main>

          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
