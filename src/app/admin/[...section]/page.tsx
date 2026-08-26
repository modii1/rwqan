import AdminDashboard, { type AdminSection } from "@/components/admin/admin-dashboard";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "لوحة التحكم | روقان",
  description: "إدارة العقارات والاشتراكات",
};

const validSections: AdminSection[] = [
  "properties",
  "linked-properties",
  "subscriptions",
  "suspended-subscriptions",
  "packages",
  "discounts",
  "addons",
  "requests",
  "contact-analytics",
  "booking-commissions",
  "customers",
  "payments",
  "analytics",
  "verification",
  "verification-logs",
  "backup",
  "code-backup",
  "whatsapp",
  "settings",
  "partner-profits",
  "fee-configs",
  "bank-accounts",
  "feature-flags",
  "blog",
  "occasions",
];

export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string[] }>;
}) {
  const { section } = await params;
  const sectionSlug = section.join("/") as AdminSection;
  const initialSection = validSections.includes(sectionSlug) ? sectionSlug : "";

  return <AdminDashboard initialSection={initialSection} />;
}
