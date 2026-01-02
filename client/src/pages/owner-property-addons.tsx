import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PropertyAddOn, AddOnPackage } from "@shared/schema";
import { CheckCircle2, Clock, XCircle, Ban } from "lucide-react";

// ترجمة الحالة إلى العربية
const getStatusArabic = (status: string) => {
  switch (status) {
    case "active": return "نشط";
    case "pending": return "بانتظار الموافقة";
    case "expired": return "منتهي";
    case "cancelled": return "ملغي";
    default: return status;
  }
};

// ترجمة مصدر الدفع إلى العربية
const getSourceArabic = (source: string) => {
  switch (source) {
    case "paymob": return "دفع إلكتروني";
    case "bank_transfer": return "تحويل بنكي";
    case "admin": return "تفعيل يدوي";
    default: return source;
  }
};

// لون الحالة
const getStatusBadge = (status: string) => {
  switch (status) {
    case "active":
      return (
        <Badge className="bg-emerald-500 text-white">
          <CheckCircle2 className="w-3 h-3 ml-1" />
          {getStatusArabic(status)}
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-amber-500 text-white">
          <Clock className="w-3 h-3 ml-1" />
          {getStatusArabic(status)}
        </Badge>
      );
    case "expired":
      return (
        <Badge className="bg-gray-500 text-white">
          <XCircle className="w-3 h-3 ml-1" />
          {getStatusArabic(status)}
        </Badge>
      );
    case "cancelled":
      return (
        <Badge className="bg-red-500 text-white">
          <Ban className="w-3 h-3 ml-1" />
          {getStatusArabic(status)}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export default function OwnerPropertyAddons() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split('?')[1] || '');
  const paymentSuccess = searchParams.get('payment') === 'success';
  
  const { data = [] } = useQuery<PropertyAddOn[]>({
    queryKey: ["/api/owner/property-addons"],
  });

  const { data: addOnPackages = [] } = useQuery<AddOnPackage[]>({
    queryKey: ["/api/owner/addons"],
  });

  // الحصول على اسم الباقة بالعربي
  const getPackageName = (packageId: string) => {
    const pkg = addOnPackages.find(p => p.id === packageId);
    return pkg?.name || "إضافة";
  };

  return (
    <div className="p-6 space-y-3" dir="rtl">
      <h1 className="text-xl font-bold mb-4">إضافاتك</h1>
      
      {paymentSuccess && (
        <Card className="p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <div>
              <div className="font-semibold text-amber-800 dark:text-amber-200">قيد المراجعة</div>
              <div className="text-sm text-amber-700 dark:text-amber-300">
                تم استلام الدفع بنجاح! الإضافة قيد المراجعة من قبل الإدارة وسيتم تفعيلها قريباً.
              </div>
            </div>
          </div>
        </Card>
      )}
      {data.length === 0 ? (
        <p className="text-muted-foreground">لا توجد إضافات</p>
      ) : (
        data.map(a => (
          <Card key={a.id} className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-semibold">{getPackageName(a.addOnPackageId)}</span>
              {getStatusBadge(a.status)}
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <div>طريقة الدفع: {getSourceArabic(a.source)}</div>
              <div>بداية: {a.startDate ? new Date(a.startDate).toLocaleDateString('ar-SA') : "-"}</div>
              <div>نهاية: {a.endDate ? new Date(a.endDate).toLocaleDateString('ar-SA') : "دائمة"}</div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
