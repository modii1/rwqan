import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Search, Calendar, Clock, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Filter, ChevronDown, ChevronUp
} from "lucide-react";
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
  status: "ساري" | "منتهي" | "قريب الانتهاء";
}

export default function AdminSubscriptionsSection() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<AdminSubscription | null>(null);
  const [cancelReason, setCancelReason] = useState("");

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

  const filteredSubscriptions = subscriptions
    .filter(sub => {
      const matchesSearch = 
        sub.propertyNumber.includes(searchQuery) ||
        sub.name.includes(searchQuery) ||
        sub.subscriptionType.includes(searchQuery);
      
      if (statusFilter === "all") return matchesSearch;
      if (statusFilter === "active") return matchesSearch && sub.status === "ساري";
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
    active: subscriptions.filter(s => s.status === "ساري").length,
    expiring: subscriptions.filter(s => s.status === "قريب الانتهاء").length,
    expired: subscriptions.filter(s => s.status === "منتهي").length,
  };

  const getStatusBadge = (status: string, remainingDays: number | null) => {
    const days = remainingDays ?? 0;
    
    if (status === "منتهي" || days <= 0) {
      return (
        <Badge className="bg-red-500 text-white flex items-center gap-1">
          <XCircle className="w-3 h-3" />
          منتهي
        </Badge>
      );
    }
    if (status === "قريب الانتهاء" || days <= 7) {
      return (
        <Badge className="bg-orange-500 text-white flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          ينتهي قريباً
        </Badge>
      );
    }
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
        <Button onClick={() => refetch()} variant="outline" className="gap-2">
          <RefreshCw className="w-4 h-4" />
          تحديث
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-[#434040]">{stats.total}</p>
          <p className="text-sm text-muted-foreground">إجمالي الاشتراكات</p>
        </Card>
        <Card className="p-4 text-center border-green-200 bg-green-50/50">
          <p className="text-3xl font-bold text-green-600">{stats.active}</p>
          <p className="text-sm text-muted-foreground">ساري</p>
        </Card>
        <Card className="p-4 text-center border-orange-200 bg-orange-50/50">
          <p className="text-3xl font-bold text-orange-600">{stats.expiring}</p>
          <p className="text-sm text-muted-foreground">ينتهي قريباً</p>
        </Card>
        <Card className="p-4 text-center border-red-200 bg-red-50/50">
          <p className="text-3xl font-bold text-red-600">{stats.expired}</p>
          <p className="text-sm text-muted-foreground">منتهي</p>
        </Card>
      </div>

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
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(sub.startDate)} - {formatDate(sub.endDate)}
                    </span>
                    <Badge className={sub.subscriptionType === "مميز" ? "bg-[#b88d2b] text-white" : "bg-gray-400 text-white"}>
                      {sub.subscriptionType}
                    </Badge>
                    {sub.price > 0 && (
                      <span className="text-[#b88d2b] font-semibold">{sub.price} ر.س</span>
                    )}
                  </div>
                </div>

                {/* Days Remaining */}
                <div className="text-center px-4">
                  <p className={`text-2xl font-bold ${
                    (sub.remainingDays ?? 0) <= 0 ? 'text-red-600' :
                    (sub.remainingDays ?? 0) <= 7 ? 'text-orange-600' : 'text-green-600'
                  }`} data-testid={`text-remaining-days-${sub.propertyNumber}`}>
                    {Math.max(0, sub.remainingDays ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">يوم متبقي</p>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center gap-3">
                  {getStatusBadge(sub.status, sub.remainingDays)}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50"
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
        <DialogContent>
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
    </div>
  );
}
