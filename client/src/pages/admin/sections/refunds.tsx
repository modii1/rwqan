import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Th, Td } from "../components/Table";
import { PriceDisplay } from "@/components/price-display";

type Refund = {
  id: string;
  paymentId: string;
  propertyNumber: string;
  refundAmount: number;
  reason: string;
  status: string;
  createdAt: string;
  processedAt?: string;
};

export default function RefundsSection() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Refund>>({
    paymentId: "",
    refundAmount: 0,
    reason: "",
  });

  const { data: refunds, isLoading } = useQuery<Refund[]>({
    queryKey: ["/api/admin/refunds"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Refund>) => {
      const res = await apiRequest("POST", "/api/admin/refunds", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/refunds"] });
      toast({ title: "تم إنشاء الاسترجاع بنجاح" });
      setIsOpen(false);
      setFormData({ paymentId: "", refundAmount: 0, reason: "" });
    },
    onError: (error: any) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<Refund>) => {
      const res = await apiRequest("PUT", `/api/admin/refunds/${editingId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/refunds"] });
      toast({ title: "تم تحديث الاسترجاع بنجاح" });
      setEditingId(null);
      setFormData({ paymentId: "", refundAmount: 0, reason: "" });
    },
    onError: (error: any) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/refunds/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/refunds"] });
      toast({ title: "تم حذف الاسترجاع بنجاح" });
    },
    onError: (error: any) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!formData.paymentId || !formData.refundAmount) {
      toast({ title: "خطأ", description: "ملء جميع الحقول المطلوبة", variant: "destructive" });
      return;
    }

    if (editingId) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const startNew = () => {
    setEditingId(null);
    setFormData({ paymentId: "", refundAmount: 0, reason: "" });
    setIsOpen(true);
  };

  const startEdit = (refund: Refund) => {
    setEditingId(refund.id);
    setFormData(refund);
    setIsOpen(true);
  };

  const totalRefunded = (refunds || []).reduce((sum, r) => sum + r.refundAmount, 0);
  const pendingCount = (refunds || []).filter(r => r.status === "معلق").length;
  const completedCount = (refunds || []).filter(r => r.status === "مكتمل").length;

  return (
    <section className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة الاسترجاعات</h2>
          <p className="text-xs text-muted-foreground">إدارة استرجاعات الرسوم والدفعات</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={startNew}>
              <Plus className="w-4 h-4 ml-1" /> استرجاع جديد
            </Button>
          </DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>{editingId ? "تعديل الاسترجاع" : "إضافة استرجاع جديد"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">معرف الدفعة</label>
                <Input
                  value={formData.paymentId || ""}
                  onChange={(e) => setFormData({ ...formData, paymentId: e.target.value })}
                  placeholder="رقم الدفعة"
                  disabled={!!editingId}
                />
              </div>
              <div>
                <label className="text-sm font-medium">مبلغ الاسترجاع</label>
                <Input
                  type="number"
                  value={formData.refundAmount || ""}
                  onChange={(e) => setFormData({ ...formData, refundAmount: parseFloat(e.target.value) })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-sm font-medium">السبب</label>
                <Input
                  value={formData.reason || ""}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="سبب الاسترجاع"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingId ? "تحديث" : "إضافة"}
                </Button>
                <Button variant="outline" onClick={() => setIsOpen(false)}>إلغاء</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* الإحصائيات */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <p className="text-xs text-muted-foreground">إجمالي الاسترجاعات</p>
          <PriceDisplay amount={totalRefunded} size="lg" textColor="text-primary" />
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-muted-foreground">قيد المراجعة</p>
          <p className="font-bold text-lg text-orange-600">{pendingCount}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-muted-foreground">مكتملة</p>
          <p className="font-bold text-lg text-green-600">{completedCount}</p>
        </Card>
      </div>

      {/* الجدول */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري التحميل...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>معرف الدفعة</Th>
                <Th>العقار</Th>
                <Th>المبلغ</Th>
                <Th>السبب</Th>
                <Th>الحالة</Th>
                <Th>التاريخ</Th>
                <Th>التحكم</Th>
              </tr>
            </thead>
            <tbody>
              {(refunds || []).map((refund) => (
                <tr key={refund.id} className="border-t hover:bg-muted/40">
                  <Td>{refund.paymentId}</Td>
                  <Td>#{refund.propertyNumber}</Td>
                  <Td><PriceDisplay amount={refund.refundAmount} size="sm" /></Td>
                  <Td>{refund.reason}</Td>
                  <Td>
                    <span className={refund.status === "مكتمل" ? "text-green-600" : "text-orange-600"}>
                      {refund.status}
                    </span>
                  </Td>
                  <Td>{new Date(refund.createdAt).toLocaleDateString("en-US")}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(refund)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(refund.id)}>
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isLoading && (!refunds || refunds.length === 0) && (
          <p className="p-4 text-sm text-muted-foreground">لا توجد استرجاعات</p>
        )}
      </Card>
    </section>
  );
}
