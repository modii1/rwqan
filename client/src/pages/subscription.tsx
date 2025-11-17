import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check } from "lucide-react";

export default function SubscriptionPage() {
  const { toast } = useToast();
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ['/api/packages'],
  });

  const validateDiscount = async () => {
    if (!discountCode) return;

    try {
      const response = await apiRequest('/api/discount/validate', {
        method: 'POST',
        body: JSON.stringify({ code: discountCode }),
      });
      setValidatedDiscount(response);
      toast({
        title: "كود الخصم صالح ✓",
        description: `سيتم خصم ${response.type === 'نسبة' ? response.value + '%' : response.value + ' ريال'}`,
      });
    } catch (error: any) {
      toast({
        title: "كود الخصم غير صالح",
        description: error.message,
        variant: "destructive",
      });
      setValidatedDiscount(null);
    }
  };

  const handleSubscribe = async () => {
    if (!selectedPackage) return;

    setIsProcessing(true);
    try {
      const response = await apiRequest('/api/owner/payment/initiate', {
        method: 'POST',
        body: JSON.stringify({
          packageId: selectedPackage,
          discountCode: validatedDiscount?.code,
          paymentMethod: 'cards',
        }),
      });

      // Open Paymob iframe
      window.open(response.iframeUrl, '_blank');
      
      toast({
        title: "جاري معالجة الدفع",
        description: "يرجى إكمال عملية الدفع في النافذة الجديدة",
      });
    } catch (error: any) {
      toast({
        title: "خطأ في بدء عملية الدفع",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const calculateFinalPrice = (price: number) => {
    if (!validatedDiscount) return price;
    
    if (validatedDiscount.type === 'نسبة') {
      return price - (price * validatedDiscount.value / 100);
    } else {
      return Math.max(0, price - validatedDiscount.value);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-primary">إدارة الاشتراك</h1>
          <p className="text-sm text-muted-foreground">اختر الباقة المناسبة لعقارك</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Discount Code */}
        <Card className="p-6 mb-8">
          <h2 className="text-lg font-bold mb-4">كود الخصم (اختياري)</h2>
          <div className="flex gap-2">
            <Input
              placeholder="أدخل كود الخصم"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              data-testid="input-discount-code"
            />
            <Button onClick={validateDiscount} data-testid="button-validate-discount">
              تحقق
            </Button>
          </div>
          {validatedDiscount && (
            <Badge className="mt-2" variant="default">
              خصم نشط: {validatedDiscount.type === 'نسبة' ? validatedDiscount.value + '%' : validatedDiscount.value + ' ريال'}
            </Badge>
          )}
        </Card>

        {/* Packages */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {packages.map(pkg => {
            const isSelected = selectedPackage === pkg.id;
            const originalPrice = pkg.price;
            const finalPrice = calculateFinalPrice(originalPrice);
            const hasDiscount = originalPrice !== finalPrice;

            return (
              <Card
                key={pkg.id}
                className={`p-6 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-2 border-primary shadow-lg scale-105'
                    : 'hover:shadow-md hover:scale-102'
                }`}
                onClick={() => setSelectedPackage(pkg.id)}
                data-testid={`card-package-${pkg.id}`}
              >
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-primary mb-2">{pkg.name}</h3>
                  <Badge variant={pkg.type === 'موثوق' ? 'default' : 'secondary'}>
                    {pkg.type}
                  </Badge>
                </div>

                <div className="text-center mb-4">
                  <div className="text-3xl font-bold text-foreground">
                    {finalPrice} ريال
                  </div>
                  {hasDiscount && (
                    <div className="text-sm text-muted-foreground line-through">
                      {originalPrice} ريال
                    </div>
                  )}
                  <div className="text-sm text-muted-foreground mt-1">
                    المدة: {pkg.duration} يوم
                  </div>
                </div>

                {pkg.features.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {pkg.features.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isSelected && (
                  <div className="absolute top-2 left-2">
                    <Badge variant="default">✓ محدد</Badge>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* Subscribe Button */}
        {selectedPackage && (
          <div className="mt-8 text-center">
            <Button
              size="lg"
              className="gradient-golden min-w-64"
              onClick={handleSubscribe}
              disabled={isProcessing}
              data-testid="button-proceed-payment"
            >
              {isProcessing ? 'جاري المعالجة...' : 'متابعة إلى الدفع'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
