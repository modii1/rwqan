"use client";

import { useEffect } from "react";
import { ADMIN_FONT_FAMILY_STACK } from "@shared/platformFonts";

/**
 * Keeps the whole admin area on Cairo even when the central customer font is
 * changed. The wrapper covers the visible admin UI immediately (server render),
 * and the effect covers body-level portals such as Radix dialogs.
 */
export default function AdminFontScope({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const body = document.body;
    const previousVariable = body.style.getPropertyValue("--font-sans");
    const previousPriority = body.style.getPropertyPriority("--font-sans");
    const previousFamily = body.style.fontFamily;

    body.style.setProperty("--font-sans", ADMIN_FONT_FAMILY_STACK);
    body.style.fontFamily = ADMIN_FONT_FAMILY_STACK;

    return () => {
      if (previousVariable) {
        body.style.setProperty(
          "--font-sans",
          previousVariable,
          previousPriority,
        );
      } else {
        body.style.removeProperty("--font-sans");
      }
      if (previousFamily) {
        body.style.fontFamily = previousFamily;
      } else {
        body.style.removeProperty("font-family");
      }
    };
  }, []);

  return (
    <div
      dir="rtl"
      data-admin-font-scope="cairo"
      style={{
        fontFamily: ADMIN_FONT_FAMILY_STACK,
        "--font-sans": ADMIN_FONT_FAMILY_STACK,
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
