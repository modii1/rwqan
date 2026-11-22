import type { Metadata } from "next";
import "./globals.css";
import LayoutContent from "./layout-content";
import { firebaseService } from "../../server/firebaseService";
import {
  DEFAULT_PLATFORM_FONT_ID,
  PLATFORM_FONT_STYLESHEET_URL,
  getPlatformFontFamilyStack,
  normalizePlatformFontId,
} from "@shared/platformFonts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "روقـان | نُـزل ورفـاهية",
    description: "نظام إدارة عقارات شامل للشاليهات والاستراحات في منطقة القصيم",
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // Read the single central font setting on the server so the first paint
    // already uses the customer font (no per-page configuration, no FOUT).
    let fontId = DEFAULT_PLATFORM_FONT_ID;
    try {
        fontId = normalizePlatformFontId(await firebaseService.getPlatformFontId());
    } catch {
        fontId = DEFAULT_PLATFORM_FONT_ID;
    }
    const fontFamilyStack = getPlatformFontFamilyStack(fontId);

    return (
        <html lang="ar" dir="rtl" data-platform-font={fontId}>
            <head>
                <link rel="icon" href="/assets/rwqan-logo.jpeg" type="image/jpeg" />
                <link rel="shortcut icon" href="/assets/rwqan-logo.jpeg" type="image/jpeg" />
                <meta name="google-site-verification" content="YP-NxidFz8ZdzkgmHj24_gsaL0okWiIW5G4o7kkcetY" />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link rel="stylesheet" href={PLATFORM_FONT_STYLESHEET_URL} />
            </head>
            <body
                className="font-sans antialiased bg-background text-foreground custom-scrollbar modern-layout"
                style={{ "--font-sans": fontFamilyStack } as React.CSSProperties}
            >
                <LayoutContent>{children}</LayoutContent>
            </body>
        </html>
    );
}
