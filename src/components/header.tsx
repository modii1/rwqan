"use client";

import { useSessionQuery } from "@/hooks/use-session";
import { useContactIdentityQuery } from "@/hooks/use-contact-identity";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Home, Lightbulb, Loader2, LogIn, LogOut, LayoutDashboard, Shield, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactIdentityMenu } from "@/components/contact/contact-identity-menu";
import { deriveHeaderAccountMode } from "@/components/contact/header-contact-state";
import Link from "next/link";

export function Header() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { data: session } = useSessionQuery();
    const { data: contactIdentity, isPending: isContactIdentityPending } = useContactIdentityQuery();

    // التحقق من الأدمن
    const { data: adminSession } = useQuery<{ isAdmin: boolean }>({
        queryKey: ["/api/admin/session"],
        staleTime: 1000 * 60 * 5,
    });

    const accountMode = deriveHeaderAccountMode({
        contactIdentityKind: contactIdentity?.kind,
        contactIdentityPending: isContactIdentityPending,
        ownerLoggedIn: Boolean(session?.user),
        adminLoggedIn: Boolean(adminSession?.isAdmin),
    });
    const isAuthenticated = accountMode === "owner" || accountMode === "admin";

    const handleHome = () => {
        sessionStorage.removeItem("propertyFilters");
        sessionStorage.removeItem("visibleCount");
        sessionStorage.removeItem("scrollPosition");
        sessionStorage.removeItem("shuffleKey");
        window.location.href = "/";
    };

    const handleLogout = async () => {
        try {
            await fetch("/api/owner/logout", {
                method: "POST",
                credentials: "include",
            });
            queryClient.clear();
        } catch (e) {
            console.error("Logout error:", e);
        }
        window.location.href = "/";
    };

    return (
        <header className="header-glass sticky top-0 z-50 h-[70px] overflow-visible">
            <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
                <Link
                    href="/"
                    className="flex items-center hover:opacity-80 transition-opacity duration-300"
                    onClick={handleHome}
                >
                    <img
                        src="/assets/logo-icon.png"
                        alt="روقـان"
                        className="h-[80px] w-auto drop-shadow-sm"
                    />
                </Link>
                <nav className="flex items-center gap-0.5 sm:gap-1 md:gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleHome}
                        title="الرئيسية - مسح الفلاتر"
                        data-testid="button-home-clear-filters"
                        className="hover:bg-primary/10 transition-colors duration-200 rounded-xl h-10 w-10"
                    >
                        <Home className="w-5 h-5 text-foreground/80" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push("/suggest")}
                        title="اقترح لنا"
                        className="hover:bg-primary/10 transition-colors duration-200 rounded-xl h-10 w-10"
                    >
                        <Lightbulb className="w-5 h-5 text-foreground/80" />
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push("/blog")}
                        title="المدونة"
                        data-testid="button-blog"
                        className="hover:bg-primary/10 transition-colors duration-200 rounded-xl h-10 w-10"
                    >
                        <BookOpen className="w-5 h-5 text-foreground/80" />
                    </Button>

                    {accountMode === "owner" && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push("/owner/dashboard")}
                            title="لوحة التحكم"
                            className="hover:bg-primary/10 transition-colors duration-200 rounded-xl h-10 w-10"
                        >
                            <LayoutDashboard className="w-5 h-5 text-primary" />
                        </Button>
                    )}

                    {accountMode === "admin" && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push("/admin")}
                            title="لوحة الأدمن"
                            data-testid="button-admin-panel"
                            className="hover:bg-red-50 transition-colors duration-200 rounded-xl h-10 w-10"
                        >
                            <Shield className="w-5 h-5 text-red-600" />
                        </Button>
                    )}

                    {accountMode === "loading" ? (
                        <div
                            role="status"
                            aria-label="جاري التحقق من حالة التواصل"
                            data-testid="header-account-loading"
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground"
                        >
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        </div>
                    ) : accountMode === "client" && contactIdentity ? (
                        <ContactIdentityMenu identity={contactIdentity} />
                    ) : (
                        <Button
                            variant={isAuthenticated ? "outline" : "default"}
                            size="icon"
                            onClick={isAuthenticated ? handleLogout : () => router.push("/owner/login")}
                            title={isAuthenticated ? "تسجيل الخروج" : "تسجيل الدخول"}
                            className={`transition-all duration-200 rounded-xl h-10 w-10 ${!isAuthenticated ? 'gradient-golden hover:shadow-golden' : 'border-primary/30 hover:bg-primary/5'}`}
                        >
                            {isAuthenticated ? (
                                <LogOut className="w-5 h-5 text-foreground/80" />
                            ) : (
                                <LogIn className="w-5 h-5 text-white" />
                            )}
                        </Button>
                    )}
                </nav>
            </div>
        </header>
    );
}
