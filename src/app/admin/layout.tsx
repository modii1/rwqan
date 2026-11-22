import AdminFontScope from "@/components/admin/admin-font-scope";

/**
 * Admin routes always use the platform's original Cairo font, independently of
 * the central customer font setting.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminFontScope>{children}</AdminFontScope>;
}
