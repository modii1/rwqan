import { useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useSessionQuery } from "@/hooks/use-session";
import { Home, Lightbulb, LogIn, LogOut } from "lucide-react";

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
              <nav className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLocation("/")}
                  title="الرئيسية"
                >
                  <Home className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLocation("/suggest")}
                  title="اقترح لنا"
                >
                  <Lightbulb className="w-5 h-5" />
                </Button>
                
                {session?.user ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setLocation("/owner/dashboard")}
                      title="لوحة التحكم"
                      className="text-primary"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z"></path>
                        <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" clipRule="evenodd"></path>
                      </svg>
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleLogout}
                      title="تسجيل الخروج"
                    >
                      <LogOut className="w-5 h-5" />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="default"
                    size="icon"
                    onClick={() => setLocation("/owner/login")}
                    title="تسجيل الدخول"
                  >
                    <LogIn className="w-5 h-5" />
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
