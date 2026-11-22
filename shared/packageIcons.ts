export type PackageIconCategory = {
  id: string;
  label: string;
  icons: ReadonlyArray<{ name: string; label: string }>;
};

/**
 * Curated Lucide icon catalog for package features. Keep the names in sync
 * with `src/components/package-icon.tsx`; the server validates against this
 * list so unsupported icon names can never be saved.
 */
export const PACKAGE_ICON_CATEGORIES: ReadonlyArray<PackageIconCategory> = [
  {
    id: "video",
    label: "الفيديو والجودة",
    icons: [
      { name: "monitor", label: "شاشة / جودة العرض" },
      { name: "tv", label: "تلفاز" },
      { name: "video", label: "فيديو" },
      { name: "camera", label: "كاميرا" },
      { name: "play-circle", label: "تشغيل" },
      { name: "film", label: "فيلم" },
      { name: "clapperboard", label: "إنتاج" },
    ],
  },
  {
    id: "devices",
    label: "الأجهزة",
    icons: [
      { name: "smartphone", label: "جوال" },
      { name: "tablet", label: "جهاز لوحي" },
      { name: "laptop", label: "حاسوب" },
      { name: "monitor-smartphone", label: "شاشة وجوال" },
      { name: "cast", label: "بث إلى الشاشة" },
      { name: "tv-2", label: "شاشتان" },
    ],
  },
  {
    id: "ads",
    label: "الإعلانات",
    icons: [
      { name: "megaphone", label: "إعلانات" },
      { name: "megaphone-off", label: "بدون إعلانات" },
      { name: "volume-x", label: "كتم الصوت" },
      { name: "bell-off", label: "بدون تنبيهات" },
    ],
  },
  {
    id: "audio",
    label: "الصوت",
    icons: [
      { name: "mic", label: "ميكروفون" },
      { name: "headphones", label: "سماعات" },
      { name: "volume-2", label: "صوت" },
      { name: "music", label: "موسيقى" },
      { name: "radio", label: "راديو" },
    ],
  },
  {
    id: "property",
    label: "العقارات",
    icons: [
      { name: "building-2", label: "عقار / مبنى" },
      { name: "house", label: "منزل" },
      { name: "images", label: "معرض صور" },
      { name: "image", label: "صورة" },
      { name: "map-pin", label: "موقع" },
      { name: "bed-double", label: "إقامة" },
      { name: "bath", label: "مرافق" },
      { name: "utensils", label: "مطبخ" },
      { name: "wifi", label: "واي فاي" },
      { name: "car", label: "مواقف" },
      { name: "waves", label: "مسبح" },
      { name: "parking-circle", label: "موقف" },
    ],
  },
  {
    id: "management",
    label: "الإدارة",
    icons: [
      { name: "settings", label: "إعدادات" },
      { name: "chart-column", label: "إحصائيات" },
      { name: "users", label: "عملاء" },
      { name: "layout-dashboard", label: "لوحة تحكم" },
      { name: "clipboard-list", label: "قوائم" },
      { name: "file-text", label: "تقارير" },
      { name: "link", label: "ربط" },
      { name: "link-2", label: "رابط" },
    ],
  },
  {
    id: "security",
    label: "الحماية",
    icons: [
      { name: "shield-check", label: "حماية" },
      { name: "lock", label: "قفل" },
      { name: "badge-check", label: "توثيق" },
      { name: "key-round", label: "مفتاح" },
      { name: "fingerprint", label: "بصمة" },
      { name: "scan-face", label: "تحقق" },
      { name: "eye", label: "مراقبة" },
    ],
  },
  {
    id: "support",
    label: "الدعم",
    icons: [
      { name: "headset", label: "دعم" },
      { name: "message-circle", label: "محادثة" },
      { name: "life-buoy", label: "مساعدة" },
      { name: "messages-square", label: "رسائل" },
      { name: "phone", label: "هاتف" },
      { name: "mail", label: "بريد" },
      { name: "send", label: "إرسال" },
      { name: "share-2", label: "مشاركة" },
    ],
  },
  {
    id: "time",
    label: "الوقت والاشتراكات",
    icons: [
      { name: "calendar", label: "تقويم" },
      { name: "clock", label: "ساعة" },
      { name: "refresh-cw", label: "تجديد" },
      { name: "timer", label: "مؤقت" },
      { name: "hourglass", label: "مدة" },
      { name: "history", label: "سجل" },
      { name: "repeat", label: "تكرار" },
    ],
  },
  {
    id: "general",
    label: "المميزات العامة",
    icons: [
      { name: "star", label: "نجمة" },
      { name: "sparkles", label: "مميزات" },
      { name: "zap", label: "سريع" },
      { name: "check-circle", label: "مؤكد" },
      { name: "heart", label: "مفضل" },
      { name: "thumbs-up", label: "موصى به" },
      { name: "rocket", label: "انطلاق" },
      { name: "gift", label: "هدية" },
      { name: "percent", label: "خصم" },
      { name: "credit-card", label: "دفع" },
      { name: "wallet", label: "محفظة" },
      { name: "award", label: "جائزة" },
      { name: "trophy", label: "إنجاز" },
      { name: "target", label: "هدف" },
      { name: "trending-up", label: "نمو" },
      { name: "pie-chart", label: "تحليلات" },
      { name: "line-chart", label: "رسوم بيانية" },
      { name: "database", label: "بيانات" },
      { name: "cloud", label: "سحابة" },
      { name: "server", label: "خادم" },
      { name: "code", label: "كود" },
      { name: "terminal", label: "أوامر" },
      { name: "qr-code", label: "رمز QR" },
      { name: "bookmark", label: "محفوظ" },
      { name: "flag", label: "إشارة" },
      { name: "compass", label: "اكتشاف" },
      { name: "map", label: "خريطة" },
      { name: "navigation", label: "اتجاه" },
      { name: "route", label: "مسار" },
      { name: "layers", label: "طبقات" },
      { name: "grid-3x3", label: "شبكة" },
      { name: "sliders-horizontal", label: "خيارات" },
      { name: "filter", label: "تصفية" },
      { name: "search", label: "بحث" },
      { name: "download", label: "تنزيل" },
      { name: "upload", label: "رفع" },
      { name: "save", label: "حفظ" },
      { name: "printer", label: "طباعة" },
      { name: "pencil", label: "تعديل" },
      { name: "trash-2", label: "حذف" },
      { name: "plus", label: "إضافة" },
      { name: "minus", label: "تقليل" },
      { name: "x", label: "إغلاق" },
      { name: "check", label: "صح" },
    ],
  },
] as const;

export const PACKAGE_ICON_LIBRARY = PACKAGE_ICON_CATEGORIES.flatMap((category) =>
  category.icons.map((icon) => ({
    ...icon,
    category: category.id,
    categoryLabel: category.label,
  })),
);

export const PACKAGE_ICON_NAMES = PACKAGE_ICON_LIBRARY.map((icon) => icon.name);

export function isSupportedPackageIcon(value: unknown): value is string {
  return typeof value === "string" && PACKAGE_ICON_NAMES.includes(value);
}

export function getPackageIconLabel(name: string): string {
  return PACKAGE_ICON_LIBRARY.find((icon) => icon.name === name)?.label || name;
}
