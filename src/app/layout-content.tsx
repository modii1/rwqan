"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { DeployBar } from "@/components/deploy-bar";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import QueryProvider from "@/lib/query-provider";

export default function LayoutContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isAdmin = pathname?.startsWith("/admin") ?? false;
    const isPropertyDetails = /^\/property\/[^/]+\/?$/.test(pathname || "");

    return (
        <QueryProvider>
            <TooltipProvider>
                <div className="min-h-screen flex flex-col bg-background">
                    <DeployBar />
                    <Header />
                    <main className="flex-1">
                        {children}
                    </main>
                    {!isAdmin && !isPropertyDetails && <Footer />}
                    <Toaster />
                </div>
            </TooltipProvider>
        </QueryProvider>
    );
}
