"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Bell, BellOff, Save, Loader2, MessageCircle, Home, CreditCard, Receipt, Edit, DollarSign, Smartphone, ShieldCheck, Clock } from "lucide-react";
import type { NotificationSettings } from "@shared/schema";

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

export default function SettingsSection() {
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
    smartSchedule: {
      enabled: true,
      sendDays: ["Sunday", "Wednesday"],
      sendTimes: { Sunday: "09:00", Wednesday: "21:00" },
      batchSize: 10,
      slotIntervalMinutes: 60,
      dailyMaxRecipients: 50,
    },
  });

  const { data: savedSettings, isLoading } = useQuery<NotificationSettings>({
    queryKey: ["/api/admin/settings/notifications"],
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings);
    }
  }, [savedSettings]);

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
    // Prune complex objects for the API (it only expects what NotificationSettings expects)
    const { smartSchedule, ...baseSettings } = settings;
    saveMutation.mutate(settings);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <Card>
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
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-3">
              {settings.allNotifications ? (
                <Bell className="w-6 h-6 text-primary" />
              ) : (
                <BellOff className="w-6 h-6 text-muted-foreground" />
              )}
              <div>
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
            />
          </div>

          <div className="grid gap-4">
            {notificationTypes.map((type) => {
              const IconComponent = type.icon;
              const isEnabled = settings.allNotifications && settings[type.key];
              
              return (
                <div
                  key={type.key}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-opacity ${
                    !settings.allNotifications ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isEnabled ? "bg-primary/10" : "bg-muted"}`}>
                      <IconComponent className={`w-4 h-4 ${isEnabled ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <Label className="font-medium">{type.label}</Label>
                      <p className="text-sm text-muted-foreground">{type.description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={settings[type.key]}
                    onCheckedChange={(checked) => handleToggleSingle(type.key, checked)}
                    disabled={!settings.allNotifications}
                    data-testid={`switch-${type.key}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="gap-2"
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
      <Card>
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
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-3">
              {settings.smartSchedule?.enabled ? (
                <Clock className="w-6 h-6 text-blue-600" />
              ) : (
                <Clock className="w-6 h-6 text-muted-foreground" />
              )}
              <div>
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
        </CardContent>
      </Card>

      <Card>
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
