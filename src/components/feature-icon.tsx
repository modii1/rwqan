import {
  BarChart3,
  Building2,
  Calendar,
  Check,
  Clock,
  Headphones,
  Image as ImageIcon,
  Link as LinkIcon,
  Mic,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Users,
  VolumeX,
} from "lucide-react";
import { isSupportedPackageIcon } from "@shared/packageIcons";
import { PackageIcon } from "@/components/package-icon";

type FeatureIconProps = {
  feature: string;
  icon?: string | null;
  className?: string;
};

/**
 * Uses the admin-selected Lucide icon when present. Legacy features without an
 * icon keep the keyword-based default so existing data never looks broken.
 */
export function FeatureIcon({ feature, icon, className }: FeatureIconProps) {
  if (icon && isSupportedPackageIcon(icon)) {
    return <PackageIcon name={icon} className={className} />;
  }

  const text = String(feature || "").toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => text.includes(term));

  if (has("4k", "hdr", "1080", "جودة", "دقة", "شاشة", "عرض")) {
    return <Monitor className={className} aria-hidden="true" />;
  }
  if (has("جهاز", "أجهزة", "جوال", "مشاهدة")) {
    return <Smartphone className={className} aria-hidden="true" />;
  }
  if (has("ميكروفون", "صوت", "سماع")) {
    return <Mic className={className} aria-hidden="true" />;
  }
  if (has("إعلان", "اعلان", "كتم")) {
    return <VolumeX className={className} aria-hidden="true" />;
  }
  if (has("إحصائ", "احصائ", "تقارير", "تقرير")) {
    return <BarChart3 className={className} aria-hidden="true" />;
  }
  if (has("دعم", "مساعدة")) {
    return <Headphones className={className} aria-hidden="true" />;
  }
  if (has("ربط", "تكامل")) {
    return <LinkIcon className={className} aria-hidden="true" />;
  }
  if (has("عقار", "عقارات", "وحدة", "وحدات")) {
    return <Building2 className={className} aria-hidden="true" />;
  }
  if (has("صور", "صورة", "معرض")) {
    return <ImageIcon className={className} aria-hidden="true" />;
  }
  if (has("طلب", "طلبات", "عملاء", "حجز", "حجوزات")) {
    return <Users className={className} aria-hidden="true" />;
  }
  if (has("ظهور", "أولوية", "اولوية", "مميز", "تميز")) {
    return <Star className={className} aria-hidden="true" />;
  }
  if (has("توثيق", "حماية", "أمان", "امان")) {
    return <ShieldCheck className={className} aria-hidden="true" />;
  }
  if (has("تحديث", "تحديثات")) {
    return <RefreshCw className={className} aria-hidden="true" />;
  }
  if (has("وقت", "مدة", "ساعة")) {
    return <Clock className={className} aria-hidden="true" />;
  }
  if (has("تاريخ", "موعد", "مواعيد")) {
    return <Calendar className={className} aria-hidden="true" />;
  }
  if (has("مزايا", "ميزات")) {
    return <Sparkles className={className} aria-hidden="true" />;
  }
  return <Check className={className} aria-hidden="true" />;
}
