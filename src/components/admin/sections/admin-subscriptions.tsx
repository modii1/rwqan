"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Search, Calendar, Clock, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Filter, ChevronDown, ChevronUp, MessageSquare, Send,
  Bell, BellOff, Info, Link2, Pencil, PauseCircle, PlayCircle
} from "lucide-react";
import { normalizeArabicText } from "@/lib/arabicSearch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  calculateRemainingDays,
  getSubscriptionStatus,
  getStatusInfo,
} from "@/lib/subscription-utils";
import { getSubscriptionTypeLabel, isPremiumSubscriptionType } from "@shared/core/subscriptions/type";

// Override formatDate to always show English numbers
function formatDate(dateStr: any): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return String(dateStr);
  }
}

interface AdminSubscription {
  id: string;
  propertyNumber: string;
  name: string;
  subscriptionType: string;
  price: number;
  startDate: string;
  endDate: string;
  remainingDays: number | null;
  status: "ساري" | "منتهي" | "قريب الانتهاء" | "نشط مجاني" | "موقوف مؤقتاً";
  suspendedAt?: string | null;
  remainingDurationMs?: number | null;
  linkedProperty?: string | null;
  linkedProperties?: string[];
  propertyCount?: number;
  isLinkedChild?: boolean;
  linkedGroupName?: string | null;
}

const subscriptionStatusOptions = [
  "ساري",
  "منتهي",
  "نشط مجاني",
] as const;

function toDateInputValue(dateStr: any): string {
  if (!dateStr) return "";
  const raw = String(dateStr);
  const isoMatch = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toEditableSubscriptionStatus(status: AdminSubscription["status"]): string {
  return status === "قريب الانتهاء" ? "ساري" : status || "ساري";
}

export default function AdminSubscriptionsSection() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [lifecycleDialogOpen, setLifecycleDialogOpen] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<"suspend" | "resume">("suspend");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<AdminSubscription | null>(null);
  const [editForm, setEditForm] = useState({
    subscriptionType: "عادي",
    status: "ساري",
    startDate: "",
    endDate: "",
    price: "",
  });
  const [cancelReason, setCancelReason] = useState("");
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [notifyType, setNotifyType] = useState<"expired" | "expiring_soon" | "custom">("expired");
  const [customMessage, setCustomMessage] = useState("");
  const [bulkNotifyDialogOpen, setBulkNotifyDialogOpen] = useState(false);
  const [bulkNotifyType, setBulkNotifyType] = useState<"all" | "expired" | "expiring_soon">("all");

  const { data: subscriptions = [], isLoading, refetch } = useQuery<AdminSubscription[]>({
    queryKey: ["/api/admin/subscriptions"],
  });

  const openEditDialog = (sub: AdminSubscription) => {
    setSelectedSubscription(sub);
    setEditForm({
      subscriptionType: getSubscriptionTypeLabel(sub.subscriptionType),
      status: toEditableSubscriptionStatus(sub.status),
      startDate: toDateInputValue(sub.startDate),
      endDate: toDateInputValue(sub.endDate),
      price: sub.price ? String(sub.price) : "",
    });
    setEditDialogOpen(true);
  };

  const cancelMutation = useMutation({
    mutationFn: async ({ propertyNumber, reason }: { propertyNumber: string; reason: string }) => {
      const response = await apiRequest('POST', '/api/admin/subscription/cancel', {
        propertyNumber,
        reason,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      toast({
        title: "تم إلغاء الاشتراك",
        description: "تم إيقاف الاشتراك بنجاح",
      });
      setCancelDialogOpen(false);
      setSelectedSubscription(null);
      setCancelReason("");
    },
    onError: (error: any) => {
      toast({
        title: "خطأ",
        description: error.message || "فشل في إلغاء الاشتراك",
        variant: "destructive",
      });
    },
  });

  // تحديث الأيام المتبقية يدوياً
  const updateDaysMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/admin/update-remaining-days', {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      toast({
        title: "تم التحديث بنجاح",
        description: `تم تحديث ${data.updatedCount || 0} اشتراك`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "خطأ",
        description: error.message || "فشل في تحديث الأيام المتبقية",
        variant: "destructive",
      });
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: async ({ subscriptionId, action }: { subscriptionId: string; action: "suspend" | "resume" }) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/subscriptions/${encodeURIComponent(subscriptionId)}/${action}`,
        {},
      );
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      toast({
        title: lifecycleAction === "suspend" ? "تم إيقاف الاشتراك مؤقتاً" : "تم استئناف الاشتراك",
        description: data?.message || (lifecycleAction === "suspend"
          ? "تم حفظ المدة المتبقية حتى استئناف الاشتراك."
          : "تم احتساب تاريخ نهاية جديد من المدة المتبقية."),
      });
      setLifecycleDialogOpen(false);
      setSelectedSubscription(null);
    },
    onError: (error: any) => {
      toast({
        title: lifecycleAction === "suspend" ? "تعذر إيقاف الاشتراك" : "تعذر استئناف الاشتراك",
        description: error.message || "حدث خطأ أثناء تحديث حالة الاشتراك.",
        variant: "destructive",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ subscriptionId, updates }: { subscriptionId: string; updates: typeof editForm }) => {
      const response = await fetch(`/api/admin/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "فشل حفظ تعديل الاشتراك");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      toast({
        title: "تم حفظ التعديل",
        description: data?.message || "تم تحديث بيانات الاشتراك بنجاح",
      });
      setEditDialogOpen(false);
      setSelectedSubscription(null);
    },
    onError: (error: any) => {
      toast({
        title: "تعذر حفظ التعديل",
        description: error.message || "راجع بيانات الاشتراك ثم حاول مرة أخرى",
        variant: "destructive",
      });
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async ({ propertyNumber, notificationType, customMessage }: { propertyNumber: string; notificationType: string; customMessage?: string }) => {
      const response = await apiRequest('POST', '/api/admin/send-owner-notification', {
        propertyNumber,
        notificationType,
        customMessage,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "تم الإرسال بنجاح",
        description: "تم إرسال الإشعار للمالك عبر الواتساب",
      });
      setNotifyDialogOpen(false);
      setSelectedSubscription(null);
      setCustomMessage("");
    },
    onError: (error: any) => {
      toast({
        title: "خطأ",
        description: error.message || "فشل في إرسال الإشعار",
        variant: "destructive",
      });
    },
  });

  // إرسال إشعارات جماعية
  const bulkNotifyMutation = useMutation({
    mutationFn: async ({ notificationType }: { notificationType: string }) => {
      const response = await apiRequest('POST', '/api/admin/send-bulk-notifications', {
        notificationType,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "تم الإرسال بنجاح",
        description: `تم إرسال ${data.sentCount || 0} إشعار للملاك`,
      });
      setBulkNotifyDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "خطأ",
        description: error.message || "فشل في إرسال الإشعارات",
        variant: "destructive",
      });
    },
  });

  const filteredSubscriptions = subscriptions
    .filter(sub => {
      const normalizedQuery = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        sub.propertyNumber.includes(searchQuery) ||
        sub.name.toLowerCase().includes(normalizedQuery) ||
        (sub.subscriptionType || "").toLowerCase().includes(normalizedQuery) ||
        sub.status.toLowerCase().includes(normalizedQuery);
      
      if (statusFilter === "all") return matchesSearch;
      if (statusFilter === "active") return matchesSearch && sub.status === "ساري";
      if (statusFilter === "activeFree") return matchesSearch && sub.status === "نشط مجاني";
      if (statusFilter === "suspended") return matchesSearch && sub.status === "موقوف مؤقتاً";
      if (statusFilter === "expiring") return matchesSearch && sub.status === "قريب الانتهاء";
      if (statusFilter === "expired") return matchesSearch && sub.status === "منتهي";
      return matchesSearch;
    })
    .sort((a, b) => {
      const daysA = a.remainingDays ?? -999;
      const daysB = b.remainingDays ?? -999;
      return sortOrder === "asc" ? daysA - daysB : daysB - daysA;
    });

  const stats = {
    total: subscriptions.length,
    activePaid: subscriptions.filter(s => s.status === "ساري").length,
    activeFree: subscriptions.filter(s => s.status === "نشط مجاني").length,
    suspended: subscriptions.filter(s => s.status === "موقوف مؤقتاً").length,
    expiring: subscriptions.filter(s => s.status === "قريب الانتهاء").length,
    expired: subscriptions.filter(s => s.status === "منتهي").length,
  };

  const notificationSchedule = useMemo(() => {
    const now = new Date();
    const saudiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    
    const nextRun = new Date(saudiTime);
    nextRun.setHours(12, 0, 0, 0);
    if (saudiTime.getHours() >= 12) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const startOfYear = new Date(saudiTime.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((saudiTime.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const positionInCycle = ((dayOfYear - 1) % 6) + 1;
    const isSendingDay = positionInCycle <= 3;
    
    const schedule: { date: Date; isSending: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const futureDate = new Date(saudiTime);
      futureDate.setDate(futureDate.getDate() + i);
      const futureDayOfYear = Math.floor((futureDate.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const futurePosition = ((futureDayOfYear - 1) % 6) + 1;
      schedule.push({
        date: futureDate,
        isSending: futurePosition <= 3,
      });
    }
    
    return {
      nextRun,
      isSendingDay,
      positionInCycle,
      schedule,
    };
  }, []);

  const getStatusBadge = (status: string, remainingDays: number | null) => {
    // منتهي
    if (status === "منتهي") {
      return (
        <Badge className="bg-red-500 text-white flex items-center gap-1">
          <XCircle className="w-3 h-3" />
          منتهي
        </Badge>
      );
    }
    // ينتهي قريباً
    if (status === "قريب الانتهاء") {
      const days = remainingDays ?? 0;
      return (
        <Badge className="bg-orange-500 text-white flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {days === 0 ? "ينتهي اليوم" : "ينتهي قريباً"}
        </Badge>
      );
    }
    // نشط مجاني
    if (status === "نشط مجاني") {
      return (
        <Badge className="bg-blue-500 text-white flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          نشط مجاني
        </Badge>
      );
    }
    if (status === "موقوف مؤقتاً") {
      return (
        <Badge className="bg-slate-600 text-white flex items-center gap-1">
          <PauseCircle className="w-3 h-3" />
          موقوف مؤقتاً
        </Badge>
      );
    }
    // ساري (مدفوع)
    return (
      <Badge className="bg-green-500 text-white flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        ساري
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-muted-foreground">جاري تحميل الاشتراكات...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="px-1 sm:px-0">
          <h1 className="text-2xl font-bold tracking-normal text-[#434040]">إدارة الاشتراكات</h1>
          <p className="text-muted-foreground">عرض وإدارة جميع اشتراكات العقارات</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button 
            onClick={() => updateDaysMutation.mutate()} 
            variant="default"
            disabled={updateDaysMutation.isPending}
            className="gap-2"
            data-testid="button-update-days"
          >
            <Calendar className="w-4 h-4" />
            {updateDaysMutation.isPending ? "جاري التحديث..." : "تحديث الأيام"}
          </Button>
          <Button 
            onClick={() => setBulkNotifyDialogOpen(true)} 
            variant="default"
            className="gap-2 bg-green-600 hover:bg-green-700"
            data-testid="button-bulk-notify"
          >
            <Send className="w-4 h-4" />
            إرسال إشعارات
          </Button>
          <Button onClick={() => refetch()} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[#434040]">{stats.total}</p>
          <p className="text-xs text-muted-foreground">إجمالي</p>
        </Card>
        <Card className="p-3 text-center border-green-200 bg-green-50/50">
          <p className="text-2xl font-bold text-green-600">{stats.activePaid}</p>
          <p className="text-xs text-muted-foreground">ساري</p>
        </Card>
        <Card className="p-3 text-center border-blue-200 bg-blue-50/50">
          <p className="text-2xl font-bold text-blue-600">{stats.activeFree}</p>
          <p className="text-xs text-muted-foreground">نشط مجاني</p>
        </Card>
        <Card className="p-3 text-center border-slate-200 bg-slate-50/50">
          <p className="text-2xl font-bold text-slate-600">{stats.suspended}</p>
          <p className="text-xs text-muted-foreground">موقوف مؤقتاً</p>
        </Card>
        <Card className="p-3 text-center border-orange-200 bg-orange-50/50">
          <p className="text-2xl font-bold text-orange-600">{stats.expiring}</p>
          <p className="text-xs text-muted-foreground">ينتهي قريباً</p>
        </Card>
        <Card className="p-3 text-center border-gray-200 bg-gray-50/50">
          <p className="text-2xl font-bold text-gray-600">{stats.expired}</p>
          <p className="text-xs text-muted-foreground">منتهي</p>
        </Card>
      </div>

      {/* Notification Schedule Info */}
      <Card className="p-4 border-blue-200 bg-blue-50/30">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-full ${notificationSchedule.isSendingDay ? 'bg-green-100' : 'bg-orange-100'}`}>
            {notificationSchedule.isSendingDay ? (
              <Bell className="w-5 h-5 text-green-600" />
            ) : (
              <BellOff className="w-5 h-5 text-orange-600" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-[#434040]">جدولة الإشعارات التلقائية</h3>
              <Badge className={notificationSchedule.isSendingDay ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'}>
                {notificationSchedule.isSendingDay ? 'يوم إرسال' : 'يوم إيقاف'}
              </Badge>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">الإرسال التلقائي القادم:</p>
                <p className="font-medium text-[#434040]">
                  {notificationSchedule.nextRun.toLocaleDateString('en-US', { 
                    weekday: 'long',
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })} at 12:00 PM
                </p>
              </div>
              
              <div>
                <p className="text-muted-foreground mb-1">نظام الدورة:</p>
                <p className="font-medium text-[#434040]">3 days send + 3 days pause</p>
              </div>
            </div>
            
            <div className="mt-3">
              <p className="text-muted-foreground text-sm mb-2">الأيام القادمة:</p>
              <div className="flex flex-wrap gap-2">
                {notificationSchedule.schedule.map((day, index) => (
                  <div
                    key={index}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      day.isSending 
                        ? 'bg-green-100 text-green-700 border border-green-200' 
                        : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }`}
                  >
                    {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {index === 0 && ' (Today)'}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="w-3 h-3" />
              <span>الإشعارات التلقائية تعمل فقط عندما يكون السيرفر شغال. استخدم زر "إرسال إشعارات" للإرسال اليدوي.</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث برقم العقار أو الاسم..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
              data-testid="input-search-subscriptions"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-48" data-testid="select-status-filter">
              <Filter className="w-4 h-4 ml-2" />
              <SelectValue placeholder="فلترة حسب الحالة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع الحالات</SelectItem>
              <SelectItem value="active">ساري</SelectItem>
              <SelectItem value="activeFree">نشط مجاني</SelectItem>
              <SelectItem value="suspended">موقوف مؤقتاً</SelectItem>
              <SelectItem value="expiring">ينتهي قريباً</SelectItem>
              <SelectItem value="expired">منتهي</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            className="gap-2"
            data-testid="button-sort-days"
          >
            {sortOrder === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            الأيام المتبقية
          </Button>
        </div>
      </Card>

      {/* Subscriptions List */}
      <div className="space-y-3">
        {filteredSubscriptions.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">لا توجد اشتراكات مطابقة للبحث</p>
          </Card>
        ) : (
          filteredSubscriptions.map((sub) => (
            <Card key={sub.id} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Property Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-[#434040]">{sub.name}</span>
                    <span className="text-sm text-muted-foreground">({sub.propertyNumber})</span>
                    {sub.isLinkedChild && (
                      <Badge variant="outline" className="text-xs gap-1 border-blue-300 text-blue-700">
                        <Link2 className="w-3 h-3" />
                        مرتبط بـ {sub.linkedGroupName || sub.linkedProperty}
                      </Badge>
                    )}
                    {!sub.isLinkedChild && sub.linkedProperties && sub.linkedProperties.length > 0 && (
                      <Badge variant="outline" className="text-xs gap-1 border-emerald-300 text-emerald-700">
                        <Link2 className="w-3 h-3" />
                        رئيسي ({sub.propertyCount || sub.linkedProperties.length + 1} عقارات)
                      </Badge>
                    )}
                  </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {sub.status !== "نشط مجاني" && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(sub.startDate)} - {formatDate(sub.endDate)}
                      </span>
                    )}
                    {(() => {
                      const displayType = getSubscriptionTypeLabel(sub.subscriptionType);
                      const isPremium = isPremiumSubscriptionType(displayType);
                      return (
                        <Badge className={isPremium ? "bg-[#b88d2b] text-white" : "bg-gray-400 text-white"}>
                          {displayType}
                        </Badge>
                      );
                    })()}
                    {sub.status !== "نشط مجاني" && sub.price > 0 && (
                      <span className="text-[#b88d2b] font-semibold">{sub.price} ر.س</span>
                    )}
                  </div>
                </div>

                {/* Days Remaining */}
                <div className="text-center px-4">
                  {(() => {
                    const days = typeof sub.remainingDays === "number" ? sub.remainingDays : null;
                    const hasDays = days !== null;
                    const isSuspended = sub.status === "موقوف مؤقتاً";
                    const isExpired = !isSuspended && hasDays && days < 0;
                    const isSoon = hasDays && days <= 7;
                    const value = sub.status === "نشط مجاني"
                      ? "مجاني"
                      : !hasDays
                        ? "-"
                        : isExpired
                          ? "منتهي"
                          : days;

                    return (
                      <>
                        <p className={`text-2xl font-bold ${
                          sub.status === "نشط مجاني" ? 'text-blue-600' :
                          isSuspended ? 'text-slate-600' :
                          !hasDays ? 'text-gray-500' :
                          isExpired ? 'text-red-600' :
                          isSoon ? 'text-orange-600' : 'text-green-600'
                        }`} data-testid={`text-remaining-days-${sub.propertyNumber}`}>
                          {value}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sub.status === "نشط مجاني" ? "بدون تاريخ انتهاء" :
                           isSuspended ? "يوم محفوظ" :
                           !hasDays || isExpired ? "" :
                           days === 0 ? "اليوم الأخير" : "يوم متبقي"}
                        </p>
                      </>
                    );
                  })()}
                </div>

                {/* Status & Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(sub.status, sub.remainingDays)}
                  {sub.status === "موقوف مؤقتاً" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-green-700 border-green-200"
                      onClick={() => {
                        setSelectedSubscription(sub);
                        setLifecycleAction("resume");
                        setLifecycleDialogOpen(true);
                      }}
                      data-testid={`button-resume-subscription-${sub.propertyNumber}`}
                    >
                      <PlayCircle className="w-4 h-4" />
                      استئناف
                    </Button>
                  ) : sub.status !== "منتهي" && sub.status !== "نشط مجاني" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-slate-700 border-slate-300"
                      onClick={() => {
                        setSelectedSubscription(sub);
                        setLifecycleAction("suspend");
                        setLifecycleDialogOpen(true);
                      }}
                      data-testid={`button-suspend-subscription-${sub.propertyNumber}`}
                    >
                      <PauseCircle className="w-4 h-4" />
                      إيقاف مؤقت
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[#b88d2b] border-[#b88d2b]/30"
                    onClick={() => openEditDialog(sub)}
                    disabled={sub.status === "موقوف مؤقتاً"}
                    data-testid={`button-edit-subscription-${sub.propertyNumber}`}
                    title={sub.status === "موقوف مؤقتاً" ? "استأنف الاشتراك قبل تعديل بياناته" : "تعديل الاشتراك"}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-green-600 border-green-200"
                    onClick={() => {
                      setSelectedSubscription(sub);
                      setNotifyType(sub.status === "منتهي" ? "expired" : sub.status === "قريب الانتهاء" ? "expiring_soon" : "custom");
                      setNotifyDialogOpen(true);
                    }}
                    data-testid={`button-notify-${sub.propertyNumber}`}
                  >
                    <MessageSquare className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200"
                    onClick={() => {
                      setSelectedSubscription(sub);
                      setCancelDialogOpen(true);
                    }}
                    data-testid={`button-cancel-subscription-${sub.propertyNumber}`}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#b88d2b]">
              <Pencil className="w-5 h-5" />
              تعديل الاشتراك
            </DialogTitle>
            <DialogDescription className="text-right pt-2">
              تعديل بيانات اشتراك العقار "{selectedSubscription?.name}" ({selectedSubscription?.propertyNumber})
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {(selectedSubscription?.isLinkedChild || (selectedSubscription?.linkedProperties?.length || 0) > 0) && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                هذا اشتراك مشترك. سيتم تطبيق نفس النوع والحالة والتواريخ على العقار الأساسي وكل العقارات المرتبطة.
              </div>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              نوع الاشتراك يحدد عادي أو مميز فقط. حالة الاشتراك الحالية هي ساري أو منتهي أو نشط مجاني، أما قريب الانتهاء فيظهر تلقائياً حسب تاريخ النهاية ولا يغيّر حالة اعتماد العقار.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2">نوع الاشتراك</label>
                <Select
                  value={editForm.subscriptionType}
                  onValueChange={(value) => setEditForm((prev) => ({ ...prev, subscriptionType: value }))}
                >
                  <SelectTrigger data-testid="select-edit-subscription-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="عادي">عادي</SelectItem>
                    <SelectItem value="مميز">مميز</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">حالة الاشتراك</label>
                <Select
                  value={editForm.status}
                  onValueChange={(value) => setEditForm((prev) => ({ ...prev, status: value }))}
                >
                  <SelectTrigger data-testid="select-edit-subscription-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subscriptionStatusOptions.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">تاريخ البداية</label>
                <Input
                  type="date"
                  value={editForm.startDate}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, startDate: e.target.value }))}
                  data-testid="input-edit-subscription-start-date"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">تاريخ النهاية</label>
                <Input
                  type="date"
                  value={editForm.endDate}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, endDate: e.target.value }))}
                  data-testid="input-edit-subscription-end-date"
                />
                <p className="mt-1 text-xs text-muted-foreground">يمكن تركه فارغاً للاشتراك المجاني فقط.</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-semibold mb-2">السعر</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="السعر بالريال"
                  value={editForm.price}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, price: e.target.value }))}
                  data-testid="input-edit-subscription-price"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false);
                setSelectedSubscription(null);
              }}
            >
              إلغاء
            </Button>
            <Button
              className="bg-[#b88d2b] hover:bg-[#9f7923]"
              onClick={() => {
                if (selectedSubscription) {
                  editMutation.mutate({
                    subscriptionId: selectedSubscription.id || selectedSubscription.propertyNumber,
                    updates: editForm,
                  });
                }
              }}
              disabled={editMutation.isPending}
              data-testid="button-confirm-edit-subscription"
            >
              {editMutation.isPending ? "جاري الحفظ..." : "حفظ التعديل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend / resume dialog */}
      <Dialog open={lifecycleDialogOpen} onOpenChange={setLifecycleDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {lifecycleAction === "suspend" ? (
                <PauseCircle className="w-5 h-5 text-slate-600" />
              ) : (
                <PlayCircle className="w-5 h-5 text-green-700" />
              )}
              {lifecycleAction === "suspend" ? "إيقاف الاشتراك مؤقتاً" : "استئناف الاشتراك"}
            </DialogTitle>
            <DialogDescription className="text-right pt-2 leading-6">
              {lifecycleAction === "suspend" ? (
                <>
                  سيتم إيقاف اشتراك العقار "{selectedSubscription?.name}" وحفظ المدة المتبقية كما هي.
                  لن تُحتسب أيام التوقف ضمن مدة الاشتراك.
                </>
              ) : (
                <>
                  سيتم استئناف اشتراك العقار "{selectedSubscription?.name}" واحتساب تاريخ نهاية جديد
                  من المدة المحفوظة.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">المدة المتبقية</span>
              <span className="font-semibold">
                {typeof selectedSubscription?.remainingDays === "number"
                  ? `${Math.max(0, selectedSubscription.remainingDays)} يوم`
                  : "غير محددة"}
              </span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              variant="outline"
              onClick={() => {
                setLifecycleDialogOpen(false);
                setSelectedSubscription(null);
              }}
            >
              رجوع
            </Button>
            <Button
              className={lifecycleAction === "suspend"
                ? "bg-slate-700 hover:bg-slate-800"
                : "bg-green-700 hover:bg-green-800"}
              onClick={() => {
                if (selectedSubscription) {
                  lifecycleMutation.mutate({
                    subscriptionId: selectedSubscription.id || selectedSubscription.propertyNumber,
                    action: lifecycleAction,
                  });
                }
              }}
              disabled={lifecycleMutation.isPending}
              data-testid={`button-confirm-${lifecycleAction}-subscription`}
            >
              {lifecycleMutation.isPending
                ? "جاري التحديث..."
                : lifecycleAction === "suspend"
                  ? "تأكيد الإيقاف"
                  : "تأكيد الاستئناف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="w-5 h-5" />
              إلغاء الاشتراك
            </DialogTitle>
            <DialogDescription className="text-right pt-2">
              هل أنت متأكد من إلغاء اشتراك العقار "{selectedSubscription?.name}"؟
              <br />
              هذا الإجراء سيؤدي إلى إيقاف الاشتراك فوراً.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="block text-sm font-semibold mb-2">سبب الإلغاء (اختياري)</label>
            <Input
              placeholder="أدخل سبب الإلغاء..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              data-testid="input-cancel-reason"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCancelDialogOpen(false);
                setSelectedSubscription(null);
                setCancelReason("");
              }}
            >
              إلغاء
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (selectedSubscription) {
                  cancelMutation.mutate({
                    propertyNumber: selectedSubscription.propertyNumber,
                    reason: cancelReason,
                  });
                }
              }}
              disabled={cancelMutation.isPending}
              data-testid="button-confirm-cancel"
            >
              {cancelMutation.isPending ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notify Dialog */}
      <Dialog open={notifyDialogOpen} onOpenChange={setNotifyDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <MessageSquare className="w-5 h-5" />
              إرسال إشعار واتساب
            </DialogTitle>
            <DialogDescription className="text-right pt-2">
              إرسال إشعار للمالك "{selectedSubscription?.name}" ({selectedSubscription?.propertyNumber})
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">نوع الإشعار</label>
              <Select value={notifyType} onValueChange={(v) => setNotifyType(v as any)}>
                <SelectTrigger data-testid="select-notify-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expired">اشتراك منتهي</SelectItem>
                  <SelectItem value="expiring_soon">ينتهي قريباً (3 أيام)</SelectItem>
                  <SelectItem value="custom">رسالة مخصصة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {notifyType === "custom" && (
              <div>
                <label className="block text-sm font-semibold mb-2">الرسالة</label>
                <Textarea
                  placeholder="أدخل رسالتك المخصصة..."
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  className="min-h-24"
                  data-testid="input-custom-message"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setNotifyDialogOpen(false);
                setSelectedSubscription(null);
                setCustomMessage("");
              }}
            >
              إلغاء
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => {
                if (selectedSubscription) {
                  notifyMutation.mutate({
                    propertyNumber: selectedSubscription.propertyNumber,
                    notificationType: notifyType,
                    customMessage: notifyType === "custom" ? customMessage : undefined,
                  });
                }
              }}
              disabled={notifyMutation.isPending || (notifyType === "custom" && !customMessage.trim())}
              data-testid="button-confirm-notify"
            >
              {notifyMutation.isPending ? "جاري الإرسال..." : "إرسال الإشعار"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Notify Dialog */}
      <Dialog open={bulkNotifyDialogOpen} onOpenChange={setBulkNotifyDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Send className="w-5 h-5" />
              إرسال إشعارات جماعية
            </DialogTitle>
            <DialogDescription className="text-right pt-2">
              إرسال إشعارات لجميع الملاك حسب حالة الاشتراك
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">نوع الإشعارات</label>
              <Select value={bulkNotifyType} onValueChange={(v) => setBulkNotifyType(v as any)}>
                <SelectTrigger data-testid="select-bulk-notify-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل (منتهي + قريب الانتهاء)</SelectItem>
                  <SelectItem value="expired">المنتهية فقط</SelectItem>
                  <SelectItem value="expiring_soon">القريبة من الانتهاء (3 أيام)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <p className="font-semibold mb-1">تنبيه:</p>
              <p>سيتم إرسال رسائل واتساب لجميع الملاك المطابقين. هذا قد يستهلك رصيد الرسائل.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkNotifyDialogOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => {
                bulkNotifyMutation.mutate({ notificationType: bulkNotifyType });
              }}
              disabled={bulkNotifyMutation.isPending}
              data-testid="button-confirm-bulk-notify"
            >
              {bulkNotifyMutation.isPending ? "جاري الإرسال..." : "إرسال الإشعارات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
