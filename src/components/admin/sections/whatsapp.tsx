"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  History,
  Inbox,
  Loader2,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Send,
  Settings2,
  Smartphone,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import BookingCommissionSettingsCard from "./booking-commission-settings";
import { WhatsAppNotificationSettings } from "./settings";

interface WhatsAppStats {
  today: number;
  week: number;
  month: number;
  total: number;
}

interface WhatsAppLog {
  id: string;
  type?: string;
  status?: string;
  createdAt?: string;
  message?: string;
  ownerPhone?: string;
}

interface SmartRequest {
  id?: string;
  requestCode?: string;
  propertyNumber?: string;
  deviceType?: string;
  timestamp?: string;
  ipAddress?: string;
}

interface BookingNotificationJob {
  status?: string | null;
  providerError?: string | null;
}

interface BookingWorkflowDashboardPayload {
  bookings?: Array<{
    notificationJobs?: BookingNotificationJob[] | null;
  }>;
}

interface BookingWorkflowNotificationStats {
  sent: number;
  pending: number;
  failed: number;
  suppressed: number;
  deferred: number;
}

interface ManualSendResponse {
  success?: boolean;
  status?: string;
  message?: string;
}

function summarizeBookingWorkflowNotifications(
  payload: BookingWorkflowDashboardPayload,
): BookingWorkflowNotificationStats {
  return (payload.bookings || [])
    .flatMap((booking) => booking.notificationJobs || [])
    .reduce<BookingWorkflowNotificationStats>(
      (summary, job) => {
        const status = String(job.status || "")
          .trim()
          .toLowerCase();
        const providerError = String(job.providerError || "")
          .trim()
          .toLowerCase();

      if (providerError === "daily_notification_quota_deferred") {
        summary.deferred += 1;
      } else if (status === "sent") summary.sent += 1;
      else if (status === "failed") summary.failed += 1;
      else if (status === "suppressed_quota") summary.suppressed += 1;
      else if (status !== "cancelled") summary.pending += 1;
      return summary;
      },
      { sent: 0, pending: 0, failed: 0, suppressed: 0, deferred: 0 },
    );
}

async function fetchWhatsAppDashboardValue<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`WhatsApp dashboard request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function AdminWhatsAppSection() {
  const [message, setMessage] = useState("");
  const [loadingSend, setLoadingSend] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendNotice, setSendNotice] = useState("");
  const [stats, setStats] = useState<WhatsAppStats | null>(null);
  const [logs, setLogs] = useState<WhatsAppLog[]>([]);
  const [requests, setRequests] = useState<SmartRequest[]>([]);
  const [bookingNotificationStats, setBookingNotificationStats] =
    useState<BookingWorkflowNotificationStats>({
      sent: 0,
      pending: 0,
      failed: 0,
      suppressed: 0,
      deferred: 0,
    });
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setDashboardError("");
      const [statsResult, logsResult, requestsResult, bookingWorkflowResult] =
        await Promise.all([
          fetchWhatsAppDashboardValue<WhatsAppStats>("/api/whatsapp/stats"),
          fetchWhatsAppDashboardValue<WhatsAppLog[]>("/api/whatsapp/logs"),
          fetchWhatsAppDashboardValue<SmartRequest[]>("/api/whatsapp/requests"),
          fetchWhatsAppDashboardValue<BookingWorkflowDashboardPayload>(
            "/api/admin/booking-commissions",
          ),
        ]);
      setStats(statsResult || null);
      setLogs(Array.isArray(logsResult) ? logsResult : []);
      setRequests(Array.isArray(requestsResult) ? requestsResult : []);
      setBookingNotificationStats(
        summarizeBookingWorkflowNotifications(bookingWorkflowResult || {}),
      );
    } catch (error) {
      console.error("WhatsApp dashboard error:", error);
      setDashboardError("تعذر تحميل بيانات نظام الواتساب. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleSend = async () => {
    if (!message.trim()) return;

    setLoadingSend(true);
    setSendError("");
    setSendNotice("");
    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: "manual",
          message,
        }),
      });
      const result = (await response
        .json()
        .catch(() => ({}))) as ManualSendResponse;
      if (!response.ok || result.success === false) {
        throw new Error(result.message || "فشل في إرسال الرسالة");
      }
      setMessage("");
      setSendNotice("تم إرسال الرسالة بنجاح.");
      await loadDashboard();
    } catch (error) {
      console.error("Send error:", error);
      setSendError(
        error instanceof Error ? error.message : "فشل في إرسال الرسالة",
      );
    } finally {
      setLoadingSend(false);
    }
  };

  return (
    <section
      className="min-w-0 max-w-full space-y-5"
      dir="rtl"
      data-testid="admin-whatsapp-hub"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-emerald-700">
            <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold">
              إدارة الرسائل والإرسال
            </span>
          </div>
          <h1 className="text-xl font-bold text-[#34332f] sm:text-2xl">
            نظام الواتساب
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            إدارة المتابعة والقوالب والحدود وإشعارات الإدارة من مكان واحد.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadDashboard()}
          disabled={loading}
          className="w-full gap-2 sm:w-auto"
          data-testid="button-refresh-whatsapp-dashboard"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          تحديث البيانات
        </Button>
      </div>

      <Tabs defaultValue="workflow" className="min-w-0 max-w-full">
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:flex sm:w-max sm:min-w-full sm:justify-start">
            <TabsTrigger
              value="workflow"
              className="min-h-10 min-w-0 gap-2 whitespace-normal px-2 sm:flex-1 sm:px-3"
              data-testid="tab-whatsapp-workflow"
            >
              <Settings2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              متابعة الحجوزات
            </TabsTrigger>
            <TabsTrigger
              value="admin-notifications"
              className="min-h-10 min-w-0 gap-2 whitespace-normal px-2 sm:flex-1 sm:px-3"
              data-testid="tab-whatsapp-admin-notifications"
            >
              <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
              إشعارات الإدارة
            </TabsTrigger>
            <TabsTrigger
              value="subscription-owner-sends"
              className="min-h-10 min-w-0 gap-2 whitespace-normal px-2 sm:flex-1 sm:px-3"
              data-testid="tab-whatsapp-subscription-owner-sends"
            >
              <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
              رسائل ملاك الاشتراكات
            </TabsTrigger>
            <TabsTrigger
              value="activity"
              className="min-h-10 min-w-0 gap-2 whitespace-normal px-2 sm:flex-1 sm:px-3"
              data-testid="tab-whatsapp-activity"
            >
              <History className="h-4 w-4 shrink-0" aria-hidden="true" />
              السجل والإرسال
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="workflow" className="min-w-0 pt-2">
          <BookingCommissionSettingsCard />
        </TabsContent>

        <TabsContent value="admin-notifications" className="min-w-0 pt-2">
          <WhatsAppNotificationSettings />
        </TabsContent>

        <TabsContent value="subscription-owner-sends" className="min-w-0 pt-2">
          <SubscriptionOwnerSends />
        </TabsContent>

        <TabsContent value="activity" className="min-w-0 space-y-4 pt-2">
          {loading ? (
            <Card
              className="flex min-h-48 items-center justify-center p-4"
              role="status"
              aria-label="جاري تحميل بيانات نظام الواتساب"
            >
              <Loader2 className="h-6 w-6 animate-spin" />
            </Card>
          ) : dashboardError ? (
            <Card className="p-4 text-center sm:p-6">
              <p className="text-sm font-semibold text-destructive">
                {dashboardError}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadDashboard()}
                className="mt-4 w-full sm:w-auto"
              >
                إعادة المحاولة
              </Button>
            </Card>
          ) : (
            <>
              <Card className="min-w-0 overflow-hidden p-3 sm:p-4">
                <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-lg font-bold sm:text-xl">
                      <ClipboardCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                      إشعارات الحجوزات والعمولات
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      ملخص رسائل متابعة العقارات المجانية وحالات معالجتها.
                    </p>
                  </div>
                  <Button
                    asChild
                    type="button"
                    variant="outline"
                    className="w-full gap-2 sm:w-auto"
                  >
                    <Link href="/admin/booking-commissions">
                      فتح السجل التفصيلي
                    </Link>
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 text-center min-[360px]:grid-cols-2 lg:grid-cols-5">
                  <StatCard
                    label="تم الإرسال"
                    value={bookingNotificationStats.sent}
                  />
                  <StatCard
                    label="قيد الانتظار"
                    value={bookingNotificationStats.pending}
                  />
                  <StatCard
                    label="فشل الإرسال"
                    value={bookingNotificationStats.failed}
                  />
                  <StatCard
                    label="توقفت بالحدود"
                    value={bookingNotificationStats.suppressed}
                  />
                  <StatCard
                    label="مؤجلة تلقائياً"
                    value={bookingNotificationStats.deferred}
                  />
                </div>
              </Card>

              <Card className="min-w-0 overflow-hidden p-3 sm:p-4">
                <h2 className="flex items-center gap-2 text-lg font-bold sm:text-xl">
                  <BarChart3 className="h-5 w-5 shrink-0 text-blue-600" />
                  إحصائيات إشعارات الإدارة عبر Meta
                </h2>

                <p className="mb-4 mt-1 text-xs leading-5 text-muted-foreground">
                  هذه الأرقام تخص الإشعارات العامة المرسلة إلى رقم المدير، ولا
                  تشمل إشعارات الحجوزات والعمولات أعلاه.
                </p>

                <div className="grid grid-cols-1 gap-3 text-center min-[360px]:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="اليوم" value={stats?.today ?? 0} />
                  <StatCard label="هذا الأسبوع" value={stats?.week ?? 0} />
                  <StatCard label="هذا الشهر" value={stats?.month ?? 0} />
                  <StatCard label="إجمالي الرسائل" value={stats?.total ?? 0} />
                </div>
              </Card>

              <Card className="min-w-0 space-y-3 overflow-hidden p-3 sm:p-4">
                <h2 className="flex items-center gap-2 text-lg font-bold sm:text-xl">
                  <MessageCircle className="h-5 w-5 shrink-0 text-green-600" />
                  إرسال رسالة إلى واتساب المدير
                </h2>

                <Textarea
                  className="min-h-[120px] max-w-full resize-y"
                  placeholder="اكتب الرسالة التي تريد أن تصل إلى المدير…"
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    setSendError("");
                    setSendNotice("");
                  }}
                  data-testid="input-whatsapp-message"
                />

                {sendNotice && (
                  <p
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"
                    role="status"
                  >
                    {sendNotice}
                  </p>
                )}
                {sendError && (
                  <p
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-destructive"
                    role="alert"
                  >
                    {sendError}
                  </p>
                )}

                <Button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={loadingSend || !message.trim()}
                  className="w-full sm:w-auto"
                  data-testid="button-send-whatsapp"
                >
                  {loadingSend ? (
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="ml-2 h-4 w-4" />
                  )}
                  إرسال الآن
                </Button>
              </Card>

              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                <Card className="min-w-0 overflow-hidden p-3 sm:p-4">
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-bold sm:text-xl">
                    <Inbox className="h-5 w-5 shrink-0 text-purple-600" />
                    الطلبات الخاصة Smart Requests
                  </h2>

                  <div className="max-h-80 min-w-0 space-y-3 overflow-y-auto pl-1">
                    {requests.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        لا توجد طلبات حالياً.
                      </p>
                    )}

                    {requests.map((request, index) => (
                      <Card
                        key={request.id || request.requestCode || index}
                        className="min-w-0 overflow-hidden p-3"
                      >
                        <div className="mb-1 flex min-w-0 flex-col gap-2 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                          <span className="min-w-0 break-words font-semibold">
                            عقار #{request.propertyNumber}
                          </span>
                          <Badge
                            variant="outline"
                            className="w-fit max-w-full shrink-0"
                          >
                            <Smartphone className="ml-1 h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {request.deviceType || "غير معروف"}
                            </span>
                          </Badge>
                        </div>

                        <p
                          className="mb-1 break-words text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {request.timestamp}
                        </p>

                        {request.ipAddress && (
                          <p
                            className="break-all text-xs text-muted-foreground"
                            dir="ltr"
                          >
                            IP: {request.ipAddress}
                          </p>
                        )}
                      </Card>
                    ))}
                  </div>
                </Card>

                <Card className="min-w-0 overflow-hidden p-3 sm:p-4">
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-bold sm:text-xl">
                    <History className="h-5 w-5 shrink-0 text-orange-600" />
                    سجل رسائل الواتساب
                  </h2>

                  <div className="max-h-80 min-w-0 space-y-3 overflow-y-auto pl-1">
                    {logs.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        لا يوجد سجل رسائل بعد.
                      </p>
                    )}

                    {logs.map((log, index) => (
                      <Card
                        key={log.id || index}
                        className="min-w-0 overflow-hidden p-3"
                      >
                        <div className="mb-1 flex min-w-0 flex-col gap-2 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                          <span className="min-w-0 break-words text-sm font-semibold">
                            {log.type}
                          </span>

                          <Badge
                            variant={
                              log.status === "success"
                                ? "default"
                                : "destructive"
                            }
                            className="w-fit shrink-0"
                          >
                            {log.status === "success" ? "تم الإرسال" : "فشل"}
                          </Badge>
                        </div>

                        <p
                          className="mb-1 break-words text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {log.createdAt}
                        </p>

                        <p
                          className="whitespace-pre-line break-words text-sm"
                          dir="auto"
                        >
                          {log.message}
                        </p>

                        {log.ownerPhone && (
                          <a
                            href={`https://wa.me/${log.ownerPhone}`}
                            className="mt-2 inline-block break-all text-xs text-blue-600 underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            فتح واتساب المالك
                          </a>
                        )}
                      </Card>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

type SingleOwnerNotificationType = "expired" | "expiring_soon" | "custom";
type BulkOwnerNotificationType = "all" | "expired" | "expiring_soon";
type OwnerSendConfirmation = "single" | "bulk" | null;

interface OwnerSendResponse {
  success?: boolean;
  message?: string;
  error?: string;
  sentCount?: number;
}

async function postOwnerNotification(
  url: string,
  body: Record<string, string>,
): Promise<OwnerSendResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as OwnerSendResponse;
  if (!response.ok || result.success === false) {
    throw new Error(result.error || result.message || "فشل في إرسال الإشعار");
  }
  return result;
}

function SubscriptionOwnerSends() {
  const [propertyNumber, setPropertyNumber] = useState("");
  const [notificationType, setNotificationType] =
    useState<SingleOwnerNotificationType>("expired");
  const [customMessage, setCustomMessage] = useState("");
  const [bulkNotificationType, setBulkNotificationType] =
    useState<BulkOwnerNotificationType>("all");
  const [confirmation, setConfirmation] =
    useState<OwnerSendConfirmation>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const clearResult = () => {
    setNotice("");
    setError("");
  };

  const confirmSend = async () => {
    const operation = confirmation;
    if (!operation) return;
    setSending(true);
    clearResult();
    try {
      if (operation === "single") {
        await postOwnerNotification("/api/admin/send-owner-notification", {
          propertyNumber: propertyNumber.trim(),
          notificationType,
          ...(notificationType === "custom"
            ? { customMessage: customMessage.trim() }
            : {}),
        });
        setNotice("تم إرسال الإشعار للمالك عبر الواتساب");
        setCustomMessage("");
      } else {
        const result = await postOwnerNotification(
          "/api/admin/send-bulk-notifications",
          { notificationType: bulkNotificationType },
        );
        setNotice(`تم إرسال ${result.sentCount || 0} إشعار للملاك`);
      }
      setConfirmation(null);
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "فشل في إرسال الإشعار",
      );
      setConfirmation(null);
    } finally {
      setSending(false);
    }
  };

  const singleReady = Boolean(
    propertyNumber.trim() &&
      (notificationType !== "custom" || customMessage.trim()),
  );

  return (
    <div
      className="grid min-w-0 max-w-full gap-4 lg:grid-cols-2"
      data-testid="subscription-owner-sends"
    >
      <Card className="min-w-0 overflow-hidden p-3 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold">إرسال إشعار واتساب</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              إرسال إشعار للمالك حسب رقم العقار
            </p>
          </div>
        </div>

        <div className="mt-5 min-w-0 space-y-4">
          <label className="block min-w-0">
            <span className="mb-2 block text-sm font-semibold">رقم العقار</span>
            <Input
              value={propertyNumber}
              onChange={(event) => {
                setPropertyNumber(event.target.value);
                clearResult();
              }}
              inputMode="numeric"
              dir="ltr"
              className="max-w-full"
              data-testid="input-owner-notification-property-number"
            />
          </label>

          <div className="min-w-0">
            <label className="mb-2 block text-sm font-semibold">نوع الإشعار</label>
            <Select
              value={notificationType}
              onValueChange={(value) => {
                setNotificationType(value as SingleOwnerNotificationType);
                clearResult();
              }}
            >
              <SelectTrigger
                className="w-full max-w-full"
                data-testid="select-owner-notification-type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expired">اشتراك منتهي</SelectItem>
                <SelectItem value="expiring_soon">ينتهي قريباً (3 أيام)</SelectItem>
                <SelectItem value="custom">رسالة مخصصة</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {notificationType === "custom" && (
            <label className="block min-w-0">
              <span className="mb-2 block text-sm font-semibold">الرسالة</span>
              <Textarea
                placeholder="أدخل رسالتك المخصصة..."
                value={customMessage}
                onChange={(event) => {
                  setCustomMessage(event.target.value);
                  clearResult();
                }}
                className="min-h-24 max-w-full resize-y"
                data-testid="input-owner-custom-message"
              />
            </label>
          )}

          <Button
            type="button"
            className="w-full bg-green-600 hover:bg-green-700 sm:w-auto"
            onClick={() => setConfirmation("single")}
            disabled={!singleReady || sending}
            data-testid="button-owner-notification-review"
          >
            إرسال الإشعار
          </Button>
        </div>
      </Card>

      <Card className="min-w-0 overflow-hidden p-3 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <Send className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold">إرسال إشعارات جماعية</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              إرسال إشعارات لجميع الملاك حسب حالة الاشتراك
            </p>
          </div>
        </div>

        <div className="mt-5 min-w-0 space-y-4">
          <div className="min-w-0">
            <label className="mb-2 block text-sm font-semibold">نوع الإشعارات</label>
            <Select
              value={bulkNotificationType}
              onValueChange={(value) => {
                setBulkNotificationType(value as BulkOwnerNotificationType);
                clearResult();
              }}
            >
              <SelectTrigger
                className="w-full max-w-full"
                data-testid="select-bulk-owner-notification-type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل (منتهي + قريب الانتهاء)</SelectItem>
                <SelectItem value="expired">المنتهية فقط</SelectItem>
                <SelectItem value="expiring_soon">القريبة من الانتهاء (3 أيام)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="mb-1 font-semibold">تنبيه:</p>
            <p>سيتم إرسال رسائل واتساب لجميع الملاك المطابقين. هذا قد يستهلك رصيد الرسائل.</p>
          </div>

          <Button
            type="button"
            className="w-full bg-green-600 hover:bg-green-700 sm:w-auto"
            onClick={() => setConfirmation("bulk")}
            disabled={sending}
            data-testid="button-bulk-owner-notification-review"
          >
            إرسال الإشعارات
          </Button>
        </div>
      </Card>

      {(notice || error) && (
        <div
          className={`min-w-0 rounded-lg border p-3 text-sm font-medium lg:col-span-2 ${
            error
              ? "border-red-200 bg-red-50 text-destructive"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </div>
      )}

      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !sending) setConfirmation(null);
        }}
      >
        <DialogContent
          dir="rtl"
          className="w-[calc(100vw-2rem)] max-w-md overflow-hidden"
          data-testid="dialog-confirm-owner-notification"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Send className="h-5 w-5 shrink-0" />
              {confirmation === "bulk"
                ? "إرسال إشعارات جماعية"
                : "إرسال إشعار واتساب"}
            </DialogTitle>
            <DialogDescription className="text-right leading-6">
              {confirmation === "bulk"
                ? "إرسال إشعارات لجميع الملاك حسب حالة الاشتراك"
                : `إرسال إشعار للمالك (${propertyNumber.trim()})`}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {confirmation === "bulk"
              ? "سيتم إرسال رسائل واتساب لجميع الملاك المطابقين. هذا قد يستهلك رصيد الرسائل."
              : "سيتم إرسال الرسالة فور تأكيد العملية."}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-start">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setConfirmation(null)}
              disabled={sending}
            >
              إلغاء
            </Button>
            <Button
              type="button"
              className="w-full bg-green-600 hover:bg-green-700 sm:w-auto"
              onClick={() => void confirmSend()}
              disabled={sending}
              data-testid="button-confirm-owner-notification"
            >
              {sending ? "جاري الإرسال..." : "تأكيد الإرسال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="min-w-0 p-3">
      <p className="break-words text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold" dir="ltr">
        {value}
      </p>
    </Card>
  );
}
