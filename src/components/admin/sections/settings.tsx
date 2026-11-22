"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Bell, BellOff, Save, Loader2, MessageCircle, Home, CreditCard, Receipt, Edit, DollarSign, Smartphone, ShieldCheck, Clock, Type, RotateCcw, Check } from "lucide-react";
import type { NotificationSettings } from "@shared/schema";
import {
  DEFAULT_PLATFORM_FONT_ID,
  PLATFORM_FONTS,
  getPlatformFontFamilyStack,
  getPlatformFontOption,
  normalizePlatformFontId,
  type PlatformFontId,
} from "@shared/platformFonts";
import {
  DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
  OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_PLACEHOLDERS,
  normalizeStoredOwnerSubscriptionWhatsAppTemplates,
  ownerSubscriptionWhatsAppTemplatesSchema,
  type OwnerSubscriptionWhatsAppTemplateKey,
} from "@shared/subscription-whatsapp";

type SmartScheduleDay = NonNullable<
  NotificationSettings["smartSchedule"]
>["sendDays"][number];

const SMART_SCHEDULE_DAYS: readonly SmartScheduleDay[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function isSmartScheduleDay(value: string): value is SmartScheduleDay {
  return (SMART_SCHEDULE_DAYS as readonly string[]).includes(value);
}

const notificationTypes = [
  { key: "newProperty" as const, label: "عقار جديد", description: "عند إضافة عقار جديد", icon: Home },
  { key: "newSubscription" as const, label: "اشتراك جديد", description: "عند إنشاء اشتراك جديد", icon: CreditCard },
  { key: "subscriptionRenewal" as const, label: "تجديد الاشتراك", description: "عند تجديد اشتراك", icon: CreditCard },
  { key: "receiptUpload" as const, label: "رفع إيصال", description: "عند رفع إيصال دفع", icon: Receipt },
  { key: "propertyUpdate" as const, label: "تعديل عقار", description: "عند تعديل بيانات عقار", icon: Edit },
  { key: "newPayment" as const, label: "دفعة جديدة", description: "عند استلام دفعة جديدة", icon: DollarSign },
  { key: "smartRequest" as const, label: "طلب واتساب", description: "عند طلب واتساب ذكي", icon: Smartphone },
  { key: "propertyVerification" as const, label: "تحقق من عقار", description: "عند قبول أو رفض عقار", icon: ShieldCheck },
  { key: "subscriptionExpired" as const, label: "انتهاء الاشتراك", description: "عند انتهاء صلاحية اشتراك", icon: Clock },
];

const ownerSubscriptionTemplateDefinitions: ReadonlyArray<{
  key: OwnerSubscriptionWhatsAppTemplateKey;
  label: string;
  description: string;
}> = [
  {
    key: "activated",
    label: "تفعيل الاشتراك",
    description: "تُرسل للمالك بعد تفعيل الاشتراك.",
  },
  {
    key: "expiringSoon",
    label: "قرب انتهاء الاشتراك",
    description: "تُرسل للمالك قبل انتهاء الاشتراك.",
  },
  {
    key: "expired",
    label: "انتهاء الاشتراك",
    description: "تُرسل للمالك بعد انتهاء الاشتراك.",
  },
];

export function WhatsAppNotificationSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<NotificationSettings>({
    allNotifications: true,
    newProperty: true,
    newSubscription: true,
    subscriptionRenewal: true,
    receiptUpload: true,
    propertyUpdate: true,
    newPayment: true,
    smartRequest: true,
    propertyVerification: true,
    subscriptionExpired: true,
    ownerSubscriptionWhatsAppTemplates: {
      ...DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
    },
    smartSchedule: {
      enabled: true,
      sendDays: ["Sunday", "Wednesday"],
      sendTimes: { Sunday: "09:00", Wednesday: "21:00" },
      batchSize: 10,
      slotIntervalMinutes: 60,
      dailyMaxRecipients: 50,
    },
  });

  const { data: savedSettings, isLoading, isError, refetch } = useQuery<NotificationSettings>({
    queryKey: ["/api/admin/settings/notifications"],
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings({
        ...savedSettings,
        ownerSubscriptionWhatsAppTemplates:
          normalizeStoredOwnerSubscriptionWhatsAppTemplates(
            savedSettings.ownerSubscriptionWhatsAppTemplates,
          ),
      });
    }
  }, [savedSettings]);

  const ownerTemplatesValid = ownerSubscriptionWhatsAppTemplatesSchema
    .safeParse(settings.ownerSubscriptionWhatsAppTemplates).success;

  const saveMutation = useMutation({
    mutationFn: async (newSettings: NotificationSettings) => {
      return apiRequest("PUT", "/api/admin/settings/notifications", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/notifications"] });
      toast({
        title: "تم الحفظ",
        description: "تم حفظ إعدادات الإشعارات بنجاح",
      });
    },
    onError: () => {
      toast({
        title: "خطأ",
        description: "فشل في حفظ الإعدادات",
        variant: "destructive",
      });
    },
  });

  const handleToggleAll = (checked: boolean) => {
    setSettings({
      ...settings,
      allNotifications: checked,
    });
  };

  const handleToggleSingle = (key: keyof NotificationSettings, checked: boolean) => {
    setSettings({
      ...settings,
      [key]: checked,
    });
  };

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="min-w-0 p-4 text-center sm:p-6" dir="rtl">
        <p className="text-sm font-semibold text-destructive">
          تعذر تحميل إعدادات الإشعارات
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refetch()}
          className="mt-4 w-full sm:w-auto"
        >
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6" dir="rtl">
      <PlatformFontSettings />

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            إعدادات الإشعارات
          </CardTitle>
          <CardDescription>
            تحكم في إشعارات الواتساب التي يتم إرسالها للمدير
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-stretch gap-3 rounded-lg border bg-muted/50 p-4 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {settings.allNotifications ? (
                <Bell className="w-6 h-6 text-primary" />
              ) : (
                <BellOff className="w-6 h-6 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <Label className="text-base font-semibold">جميع الإشعارات</Label>
                <p className="text-sm text-muted-foreground">
                  تفعيل أو تعطيل جميع الإشعارات
                </p>
              </div>
            </div>
            <Switch
              checked={settings.allNotifications}
              onCheckedChange={handleToggleAll}
              data-testid="switch-all-notifications"
              className="self-end min-[360px]:self-auto"
            />
          </div>

          <div className="grid gap-4">
            {notificationTypes.map((type) => {
              const IconComponent = type.icon;
              const isEnabled = settings.allNotifications && settings[type.key];
              
              return (
                <div
                  key={type.key}
                  className={`flex flex-col items-stretch gap-3 rounded-lg border p-4 transition-opacity min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between ${
                    !settings.allNotifications ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`p-2 rounded-lg ${isEnabled ? "bg-primary/10" : "bg-muted"}`}>
                      <IconComponent className={`w-4 h-4 ${isEnabled ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0">
                      <Label className="font-medium">{type.label}</Label>
                      <p className="text-sm text-muted-foreground">{type.description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={settings[type.key]}
                    onCheckedChange={(checked) => handleToggleSingle(type.key, checked)}
                    disabled={!settings.allNotifications}
                    data-testid={`switch-${type.key}`}
                    className="self-end min-[360px]:self-auto"
                  />
                </div>
              );
            })}
          </div>

          <section
            className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-3 sm:p-4"
            aria-labelledby="owner-subscription-whatsapp-templates-title"
          >
            <div className="min-w-0">
              <h3
                id="owner-subscription-whatsapp-templates-title"
                className="text-base font-semibold"
              >
                قوالب رسائل اشتراكات الملاك
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                عدّل رسائل التفعيل وقرب الانتهاء والانتهاء التي تُرسل لمالك العقار.
              </p>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4">
              {ownerSubscriptionTemplateDefinitions.map((definition) => {
                const template =
                  settings.ownerSubscriptionWhatsAppTemplates[definition.key];
                const templateValid =
                  ownerSubscriptionWhatsAppTemplatesSchema.shape[definition.key]
                    .safeParse(template).success;

                return (
                  <div
                    key={definition.key}
                    className="min-w-0 space-y-3 rounded-lg border bg-background p-3 sm:p-4"
                  >
                    <div className="min-w-0">
                      <Label
                        htmlFor={`owner-subscription-template-${definition.key}`}
                        className="font-semibold"
                      >
                        {definition.label}
                      </Label>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {definition.description}
                      </p>
                    </div>

                    <div className="flex min-w-0 flex-wrap gap-2" dir="ltr">
                      {OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_PLACEHOLDERS[
                        definition.key
                      ].map((placeholder) => (
                        <code
                          key={placeholder}
                          className="max-w-full break-all rounded bg-muted px-2 py-1 text-xs"
                        >
                          {`{{${placeholder}}}`}
                        </code>
                      ))}
                    </div>

                    <Textarea
                      id={`owner-subscription-template-${definition.key}`}
                      data-testid={`textarea-owner-subscription-${definition.key}`}
                      value={template}
                      onChange={(event) =>
                        setSettings((previous) => ({
                          ...previous,
                          ownerSubscriptionWhatsAppTemplates: {
                            ...previous.ownerSubscriptionWhatsAppTemplates,
                            [definition.key]: event.target.value,
                          },
                        }))
                      }
                      className="min-h-40 w-full max-w-full resize-y whitespace-pre-wrap break-words text-start [overflow-wrap:anywhere]"
                      dir="rtl"
                      aria-invalid={!templateValid}
                    />

                    {!templateValid ? (
                      <p className="text-sm text-destructive" role="alert">
                        تأكد من إبقاء جميع المتغيرات المطلوبة مرة واحدة وكتابة القالب بصيغة صحيحة.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex justify-end border-t pt-4">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !ownerTemplatesValid}
              className="w-full gap-2 sm:w-auto"
              data-testid="button-save-settings"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              حفظ الإعدادات
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 📅 Smart Schedule Config Card */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            جدولة إشعارات انتهاء الاشتراك (Smart Schedule)
          </CardTitle>
          <CardDescription>
            تحكم في توقيت وتكرار إرسال رسائل التذكير للعملاء منتهي الإشتراك لتجنب Spam
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-stretch gap-3 rounded-lg border bg-muted/50 p-4 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {settings.smartSchedule?.enabled ? (
                <Clock className="w-6 h-6 text-blue-600" />
              ) : (
                <Clock className="w-6 h-6 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <Label className="text-base font-semibold">تفعيل الجدولة الذكية</Label>
                <p className="text-sm text-muted-foreground">
                  إرسال الرسائل مرتين أسبوعياً فقط ( الأحد صباحاً والأربعاء مساءً )
                </p>
              </div>
            </div>
            <Switch
              checked={settings.smartSchedule?.enabled ?? true}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  smartSchedule: { ...prev.smartSchedule!, enabled: checked },
                }))
              }
              className="self-end min-[360px]:self-auto"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>عدد العملاء لكل دفعة</Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={settings.smartSchedule?.batchSize ?? 10}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    smartSchedule: { ...prev.smartSchedule!, batchSize: Number(e.target.value) },
                  }))
                }
                className="w-full"
              />
              <p className="text-sm text-muted-foreground">
                عدد الإشعارات المرسلة في كل ساعة (مثلاً 10)
              </p>
            </div>

            <div className="space-y-2">
              <Label>الفاصل بين الدفعات (دقيقة)</Label>
              <Input
                type="number"
                min={10}
                max={180}
                value={settings.smartSchedule?.slotIntervalMinutes ?? 60}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    smartSchedule: { ...prev.smartSchedule!, slotIntervalMinutes: Number(e.target.value) },
                  }))
                }
                className="w-full"
              />
              <p className="text-sm text-muted-foreground">
                المدة بين كل دفعة والتالية (مثلاً 60 دقيقة)
              </p>
            </div>

            <div className="space-y-2">
              <Label>الحد الأقصى يومياً</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={settings.smartSchedule?.dailyMaxRecipients ?? 50}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    smartSchedule: { ...prev.smartSchedule!, dailyMaxRecipients: Number(e.target.value) },
                  }))
                }
                className="w-full"
              />
              <p className="text-sm text-muted-foreground">
                لا تُرسل أكثر من هذا العدد في اليوم
              </p>
            </div>

            <div className="space-y-2">
              <Label>يوم الإرسال الأول (مثلاً الأحد)</Label>
              <Select
                value={(settings.smartSchedule?.sendDays?.[0] ?? "Sunday")}
                onValueChange={(val) =>
                  setSettings((prev) => {
                    if (!isSmartScheduleDay(val)) return prev;
                    const days = [...(prev.smartSchedule?.sendDays ?? [])];
                    days[0] = val;
                    return { ...prev, smartSchedule: { ...prev.smartSchedule!, sendDays: days } };
                  })
                }
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sunday">الأحد</SelectItem>
                  <SelectItem value="Monday">الإثنين</SelectItem>
                  <SelectItem value="Tuesday">الثلاثاء</SelectItem>
                  <SelectItem value="Wednesday">الأربعاء</SelectItem>
                  <SelectItem value="Thursday">الخميس</SelectItem>
                  <SelectItem value="Friday">الجمعة</SelectItem>
                  <SelectItem value="Saturday">السبت</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>وقت الإرسال أول يوم (HH:MM)</Label>
              <Input
                type="time"
                value={settings.smartSchedule?.sendTimes?.[(settings.smartSchedule?.sendDays?.[0] ?? "Sunday")] ?? "09:00"}
                onChange={(e) =>
                  setSettings((prev) => {
                    const day = prev.smartSchedule?.sendDays?.[0] ?? "Sunday";
                    return {
                      ...prev,
                      smartSchedule: {
                        ...prev.smartSchedule!,
                        sendTimes: { ...prev.smartSchedule!.sendTimes, [day]: e.target.value },
                      },
                    };
                  })
                }
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label>يوم الإرسال الثاني (مثلاً الأربعاء)</Label>
              <Select
                value={(settings.smartSchedule?.sendDays?.[1] ?? "Wednesday")}
                onValueChange={(val) =>
                  setSettings((prev) => {
                    if (!isSmartScheduleDay(val)) return prev;
                    const days = [...(prev.smartSchedule?.sendDays ?? [])];
                    days[1] = val;
                    return { ...prev, smartSchedule: { ...prev.smartSchedule!, sendDays: days } };
                  })
                }
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sunday">الأحد</SelectItem>
                  <SelectItem value="Monday">الإثنين</SelectItem>
                  <SelectItem value="Tuesday">الثلاثاء</SelectItem>
                  <SelectItem value="Wednesday">الأربعاء</SelectItem>
                  <SelectItem value="Thursday">الخميس</SelectItem>
                  <SelectItem value="Friday">الجمعة</SelectItem>
                  <SelectItem value="Saturday">السبت</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>وقت الإرسال ثاني يوم (HH:MM)</Label>
              <Input
                type="time"
                value={settings.smartSchedule?.sendTimes?.[(settings.smartSchedule?.sendDays?.[1] ?? "Wednesday")] ?? "21:00"}
                onChange={(e) =>
                  setSettings((prev) => {
                    const day = prev.smartSchedule?.sendDays?.[1] ?? "Wednesday";
                    return {
                      ...prev,
                      smartSchedule: {
                        ...prev.smartSchedule!,
                        sendTimes: { ...prev.smartSchedule!.sendTimes, [day]: e.target.value },
                      },
                    };
                  })
                }
                className="w-full"
              />
            </div>
          </div>

          <div className="flex justify-end border-t pt-4">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !ownerTemplatesValid}
              className="w-full gap-2 sm:w-auto"
              data-testid="button-save-schedule-settings"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              حفظ الإعدادات
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-600" />
            معلومات الواتساب
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
            <p className="text-sm text-muted-foreground">
              يتم إرسال الإشعارات عبر WhatsApp Business API إلى رقم المدير المسجل.
              تأكد من تكوين متغيرات البيئة التالية:
            </p>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground list-disc list-inside">
              <li>META_WHATSAPP_TOKEN</li>
              <li>META_PHONE_NUMBER_ID</li>
              <li>META_NOTIFY_NUMBER</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface PlatformFontResponse {
  fontId: string;
  font: { id: string; label: string; family: string; note: string };
  defaultFontId: string;
}

function PlatformFontSettings() {
  const { toast } = useToast();
  const {
    data: fontSettings,
    isLoading: fontLoading,
    isError: fontError,
    refetch: refetchFont,
  } = useQuery<PlatformFontResponse>({
    queryKey: ["/api/admin/settings/font"],
  });

  const savedFontId = normalizePlatformFontId(fontSettings?.fontId);
  const [selectedFontId, setSelectedFontId] =
    useState<PlatformFontId>(savedFontId);

  useEffect(() => {
    setSelectedFontId(savedFontId);
  }, [savedFontId]);

  const selectedFont = getPlatformFontOption(selectedFontId);
  const savedFont = getPlatformFontOption(savedFontId);
  const isDirty = selectedFontId !== savedFontId;

  const saveMutation = useMutation({
    mutationFn: async (fontId: PlatformFontId) =>
      apiRequest("PUT", "/api/admin/settings/font", { fontId }),
    onSuccess: (_response, fontId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/font"] });
      toast({
        title: "تم حفظ الخط",
        description: `تم تطبيق ${getPlatformFontOption(fontId).label} على صفحات العملاء.`,
      });
    },
    onError: () => {
      toast({
        title: "خطأ",
        description: "تعذّر حفظ إعداد الخط. حاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="min-w-0 overflow-hidden" data-testid="platform-font-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Type className="h-5 w-5 text-[#80621d]" />
          إعدادات الخطوط
        </CardTitle>
        <CardDescription>
          خط واحد مركزي يُطبّق على جميع صفحات العملاء، مع بقاء لوحة الأدمن على خط Cairo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {fontLoading ? (
          <div className="flex items-center justify-center rounded-xl border bg-muted/40 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : fontError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">
              تعذّر تحميل إعداد الخط.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void refetchFont()}
            >
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3">
              <span className="text-sm font-semibold">الخط الحالي للعملاء:</span>
              <span
                className="rounded-full border border-[#d8c9aa] bg-[#fffdfa] px-3 py-1 text-sm font-bold text-[#29372F]"
                style={{ fontFamily: getPlatformFontFamilyStack(savedFontId) }}
                data-testid="platform-font-current"
              >
                {savedFont.label}
              </span>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">اختر خط المنصة</p>
              <div
                className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
                role="radiogroup"
                aria-label="اختر خط المنصة"
              >
                {PLATFORM_FONTS.map((font) => {
                  const isSelected = font.id === selectedFontId;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedFontId(font.id)}
                      data-testid={`platform-font-option-${font.id}`}
                      className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-right transition ${
                        isSelected
                          ? "border-[#80621d] bg-[#faf5e8] shadow-sm"
                          : "border-[#e6ddc9] bg-white hover:border-[#cbb98d]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span
                          className="block truncate text-base font-bold text-[#293129]"
                          style={{ fontFamily: getPlatformFontFamilyStack(font.id) }}
                        >
                          {font.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#6f685b]">
                          {font.note}
                        </span>
                      </span>
                      <span
                        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border ${
                          isSelected
                            ? "border-[#80621d] bg-[#80621d] text-white"
                            : "border-[#d8c9aa] bg-white"
                        }`}
                        aria-hidden="true"
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">معاينة مباشرة</p>
                <p className="text-xs text-muted-foreground">
                  معاينة بالخط المحدد قبل الحفظ: {selectedFont.label}
                </p>
              </div>
              <div
                dir="rtl"
                data-testid="platform-font-preview"
                className="rounded-xl border border-[#d8c9aa] bg-[#faf7ef] p-4 sm:p-5"
                style={{ fontFamily: getPlatformFontFamilyStack(selectedFontId) }}
              >
                <p className="text-lg font-bold text-[#29372F] sm:text-xl">
                  روقـان | نُـزل ورفـاهية
                </p>
                <p className="mt-2 text-sm leading-7 text-[#4a3b2a]">
                  اشترك الآن، أدر عقارك، وتابع طلبات الحجز بسهولة من مكان واحد.
                </p>
                <p className="mt-2 text-sm font-semibold text-[#6f685b]">
                  الأسعار: 150 ر.س — 135 ر.س | الأرقام: 1234567890
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-6 text-muted-foreground">
                يُطبّق الخط على الصفحات العامة وصفحات المالك والنماذج والنوافذ والأزرار والجداول والرسائل،
                دون تغيير الأحجام أو الأوزان أو الألوان.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveMutation.mutate(DEFAULT_PLATFORM_FONT_ID)}
                  disabled={saveMutation.isPending || savedFontId === DEFAULT_PLATFORM_FONT_ID}
                  data-testid="platform-font-reset"
                >
                  <RotateCcw className="ml-2 h-4 w-4" />
                  استعادة الخط الافتراضي
                </Button>
                <Button
                  type="button"
                  onClick={() => saveMutation.mutate(selectedFontId)}
                  disabled={saveMutation.isPending || !isDirty}
                  className="bg-[#80621d] text-white hover:bg-[#6f5317]"
                  data-testid="platform-font-save"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="ml-2 h-4 w-4" />
                  )}
                  حفظ الخط
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsSection() {
  return <WhatsAppNotificationSettings />;
}
