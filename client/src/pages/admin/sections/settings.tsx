import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-6">
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
