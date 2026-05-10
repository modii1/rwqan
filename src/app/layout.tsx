import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import QueryProvider from "@/lib/query-provider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "روقـان | نُـزل ورفـاهية",
    description: "نظام إدارة عقارات شامل للشاليهات والاستراحات في منطقة القصيم",
};

import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ar" dir="rtl">
            <head>
                <link rel="icon" href="/assets/rwqan-logo.jpeg" type="image/jpeg" />
                <link rel="shortcut icon" href="/assets/rwqan-logo.jpeg" type="image/jpeg" />
                <meta name="google-site-verification" content="YP-NxidFz8ZdzkgmHj24_gsaL0okWiIW5G4o7kkcetY" />
            </head>
            <body className="font-sans antialiased bg-background text-foreground custom-scrollbar modern-layout">
                <QueryProvider>
                    <TooltipProvider>
                        <div className="min-h-screen flex flex-col bg-background">
                            <Header />
                            <main className="flex-1">
                                {children}
                            </main>
                            <Footer />
                            <Toaster />
                        </div>
                    </TooltipProvider>
                </QueryProvider>
            </body>
        </html>
    );
}
