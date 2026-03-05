"use client";

import { useSessionQuery } from "@/hooks/use-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Home, Lightbulb, LogIn, LogOut, LayoutDashboard, Shield, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";

import { useState, useEffect } from "react";
// import { Database, FileSpreadsheet } from "lucide-react"; // DB toggle disabled - Firebase only

export function Header() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { data: session } = useSessionQuery();
    // DB toggle disabled - always use Firebase
    // const [dbSource, setDbSource] = useState<'sheets' | 'firebase'>('sheets');

    // useEffect(() => {
    //     const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    //         const [key, value] = cookie.trim().split('=');
    //         acc[key] = value;
    //         return acc;
    //     }, {} as Record<string, string>);
    //
    //     if (cookies['db_source']) {
    //         setDbSource(cookies['db_source'] as 'sheets' | 'firebase');
    //     }
    // }, []);

    // const toggleDbSource = () => {
    //     const newSource = dbSource === 'sheets' ? 'firebase' : 'sheets';
    //     setDbSource(newSource);
    //     document.cookie = `db_source=${newSource}; path=/; max-age=31536000`;
    //     window.location.reload();
    // };

    // التحقق من الأدمن
    const { data: adminSession } = useQuery<{ isAdmin: boolean }>({
        queryKey: ["/api/admin/session"],
        staleTime: 1000 * 60 * 5, // 5 دقائق
    });

    // Check if user is authenticated (owner or admin)
    const isAuthenticated = session?.user || adminSession?.isAdmin;

    const handleHome = () => {
        // مسح جميع الفلاتر والترتيب العشوائي لإعادة ترتيب جديد
        sessionStorage.removeItem("propertyFilters");
        sessionStorage.removeItem("visibleCount");
        sessionStorage.removeItem("scrollPosition");
        sessionStorage.removeItem("shuffleKey");
        // تحديث الصفحة بالكامل لإلغاء كل شيء
        window.location.href = "/";
    };

    const handleLogout = async () => {
        try {
            // Try owner logout first
            await fetch("/api/owner/logout", {
                method: "POST",
                credentials: "include",
            });
            // Clear all queries from cache
            queryClient.clear();
        } catch (e) {
            console.error("Logout error:", e);
        }
        // Force full page reload to clear all state
        window.location.href = "/";
    };

    return (
        <header className="bg-white border-b shadow-sm sticky top-0 z-50 h-[70px] overflow-visible">
            <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
                <Link
                    href="/"
                    className="flex items-center hover:opacity-80 transition"
                    onClick={handleHome}
                >
                    <img
                        src="/assets/logo-icon.png"
                        alt="روقـان"
                        className="h-[110px] w-auto"
                    />
                </Link>
                <nav className="flex items-center gap-2">
                    {/* Database Toggle - Disabled (Firebase only)
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleDbSource}
                        title={`Current DB: ${dbSource === 'sheets' ? 'Google Sheets' : 'Firebase'}`}
                        className={`flex items-center gap-2 px-2 ${dbSource === 'firebase' ? 'text-orange-500 bg-orange-50' : 'text-green-600 bg-green-50'}`}
                    >
                        {dbSource === 'sheets' ? <FileSpreadsheet className="w-4 h-4" /> : <Database className="w-4 h-4" />}
                        <span className="text-xs font-semibold hidden md:inline">
                            {dbSource === 'sheets' ? 'Sheets' : 'Firebase'}
                        </span>
                    </Button>
                    */}

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleHome}
                        title="الرئيسية - مسح الفلاتر"
                        data-testid="button-home-clear-filters"
                    >
                        <Home className="w-5 h-5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push("/suggest")}
                        title="اقترح لنا"
                    >
                        <Lightbulb className="w-5 h-5" />
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push("/blog")}
                        title="المدونة"
                        data-testid="button-blog"
                    >
                        <BookOpen className="w-5 h-5" />
                    </Button>

                    {session?.user && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push("/owner/dashboard")}
                            title="لوحة التحكم"
                            className="text-primary"
                        >
                            <LayoutDashboard className="w-5 h-5" />
                        </Button>
                    )}

                    {adminSession?.isAdmin && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push("/admin")}
                            title="لوحة الأدمن"
                            className="text-red-600"
                            data-testid="button-admin-panel"
                        >
                            <Shield className="w-5 h-5" />
                        </Button>
                    )}

                    <Button
                        variant={isAuthenticated ? "outline" : "default"}
                        size="icon"
                        onClick={isAuthenticated ? handleLogout : () => router.push("/owner/login")}
                        title={isAuthenticated ? "تسجيل الخروج" : "تسجيل الدخول"}
                    >
                        {isAuthenticated ? (
                            <LogOut className="w-5 h-5" />
                        ) : (
                            <LogIn className="w-5 h-5" />
                        )}
                    </Button>
                </nav>
            </div>
        </header>
    );
}
