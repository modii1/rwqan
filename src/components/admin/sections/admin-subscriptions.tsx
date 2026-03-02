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
  Bell, BellOff, Info
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
  formatDate,
} from "@/lib/subscription-utils";

interface AdminSubscription {
  id: string;
  propertyNumber: string;
  name: string;
  subscriptionType: string;
  price: number;
  startDate: string;
  endDate: string;
  remainingDays: number | null;
  status: "ساري" | "منتهي" | "قريب الانتهاء" | "نشط مجاني";
}

export default function AdminSubscriptionsSection() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<AdminSubscription | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [notifyType, setNotifyType] = useState<"expired" | "expiring_soon" | "custom">("expired");
  const [customMessage, setCustomMessage] = useState("");
  const [bulkNotifyDialogOpen, setBulkNotifyDialogOpen] = useState(false);
  const [bulkNotifyType, setBulkNotifyType] = useState<"all" | "expired" | "expiring_soon">("all");

  const { data: subscriptions = [], isLoading, refetch } = useQuery<AdminSubscription[]>({
    queryKey: ["/api/admin/subscriptions"],
  });

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
      const normalizedQuery = normalizeArabicText(searchQuery);
      const matchesSearch = !searchQuery || 
        normalizeArabicText(sub.propertyNumber).includes(normalizedQuery) ||
        normalizeArabicText(sub.name).includes(normalizedQuery) ||
        normalizeArabicText(sub.subscriptionType).includes(normalizedQuery) ||
        normalizeArabicText(sub.status).includes(normalizedQuery);
      
      if (statusFilter === "all") return matchesSearch;
      if (statusFilter === "active") return matchesSearch && sub.status === "ساري";
      if (statusFilter === "activeFree") return matchesSearch && sub.status === "نشط مجاني";
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
        <div>
          <h1 className="text-2xl font-bold text-[#434040]">إدارة الاشتراكات</h1>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Property Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-[#434040]">{sub.name}</span>
                    <span className="text-sm text-muted-foreground">({sub.propertyNumber})</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {sub.status !== "نشط مجاني" && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(sub.startDate)} - {formatDate(sub.endDate)}
                      </span>
                    )}
                    <Badge className={sub.subscriptionType === "مميز" ? "bg-[#b88d2b] text-white" : "bg-gray-400 text-white"}>
                      {sub.subscriptionType}
                    </Badge>
                    {sub.status !== "نشط مجاني" && sub.price > 0 && (
                      <span className="text-[#b88d2b] font-semibold">{sub.price} ر.س</span>
                    )}
                  </div>
                </div>

                {/* Days Remaining */}
                <div className="text-center px-4">
                  <p className={`text-2xl font-bold ${
                    (sub.remainingDays ?? -1) < 0 ? 'text-red-600' :
                    (sub.remainingDays ?? 0) <= 7 ? 'text-orange-600' : 'text-green-600'
                  }`} data-testid={`text-remaining-days-${sub.propertyNumber}`}>
                    {(sub.remainingDays ?? -1) < 0 ? "منتهي" : sub.remainingDays}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(sub.remainingDays ?? -1) < 0 ? "" : 
                     sub.remainingDays === 0 ? "اليوم الأخير" : "يوم متبقي"}
                  </p>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center gap-3">
                  {getStatusBadge(sub.status, sub.remainingDays)}
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
