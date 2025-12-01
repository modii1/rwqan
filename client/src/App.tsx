import { useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useSessionQuery } from "@/hooks/use-session";

// Pages
import NotFound from "@/pages/not-found";
import PropertiesPage from "@/pages/properties";
import PropertyDetailsPage from "@/pages/property-details";
import OwnerLogin from "@/pages/owner-login";
import OwnerDashboard from "@/pages/owner-dashboard";
import OwnerImagesPage from "@/pages/owner-images";
import OwnerUpdateProperty from "@/pages/owner-update-property";
import SubscriptionPage from "@/pages/subscription";
import SuggestPage from "@/pages/suggest";
import RegisterPage from "@/pages/register";
import TestImages from "@/pages/test-images";
import AdminDashboard from "@/pages/admin";
import AdminImagesPage from "@/pages/admin/admin-images";

function Router() {
  return (
    <Switch>
      {/* صفحات عامة */}
      <Route path="/" component={PropertiesPage} />
      <Route path="/property/:id" component={PropertyDetailsPage} />

      {/* صفحات المالك */}
      <Route path="/owner/login" component={OwnerLogin} />
      <Route path="/owner/dashboard" component={OwnerDashboard} />
      <Route path="/owner/images" component={OwnerImagesPage} />
      <Route path="/owner/update-property" component={OwnerUpdateProperty} />
      <Route path="/owner/subscription" component={SubscriptionPage} />

      {/* صفحات عامة */}
      <Route path="/suggest" component={SuggestPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/test-images" component={TestImages} />

      {/* صفحات الأدمن */}
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/images/:propertyNumber" component={AdminImagesPage} />

      {/* صفحة 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const [, setLocation] = useLocation();
  const { data: session } = useSessionQuery();
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAppReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  };

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

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen flex flex-col bg-background">
          {/* Header */}
          <header className="bg-white border-b shadow-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
              <a
                href="/"
                className="text-xl font-bold text-primary hover:opacity-80 transition"
              >
                مودي الذكي
              </a>
              <nav className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation("/")}
                  className="text-base"
                >
                  الرئيسية
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation("/suggest")}
                  className="text-base"
                >
                  اقترح لنا
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation("/register")}
                  className="text-base"
                >
                  اشترك معنا
                </Button>
                
                {session?.user ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLocation("/owner/dashboard")}
                      className="text-base text-primary"
                    >
                      لوحة التحكم
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLogout}
                    >
                      تسجيل الخروج
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setLocation("/owner/login")}
                  >
                    تسجيل الدخول
                  </Button>
                )}
              </nav>
            </div>
          </header>

          <main className="flex-1">
            <Router />
          </main>
          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
