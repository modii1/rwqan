import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'];

export default function SuggestPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await apiRequest('/api/suggestions', {
        method: 'POST',
        body: JSON.stringify({ name, phone, city, suggestion }),
      });

      toast({
        title: "تم إرسال الاقتراح بنجاح ✓",
        description: "شكراً لك! سنراجع اقتراحك قريباً",
      });

      // Reset form
      setName("");
      setPhone("");
      setCity("");
      setSuggestion("");
    } catch (error: any) {
      toast({
        title: "خطأ في إرسال الاقتراح",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-primary">اقترح لنا</h1>
          <p className="text-sm text-muted-foreground">شاركنا أفكارك واقتراحاتك لتطوير المنصة</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <Card className="p-8">
          <div className="text-center mb-8">
            <div className="text-4xl mb-4">💡</div>
            <h2 className="text-xl font-bold text-primary mb-2">نسعد بسماع اقتراحاتك</h2>
            <p className="text-muted-foreground">ساهم في تحسين تجربة مودي الذكي</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">الاسم</label>
              <Input
                placeholder="اسمك الكريم"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="input-name"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">رقم الجوال</label>
              <Input
                type="tel"
                placeholder="05xxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                data-testid="input-phone"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">المدينة</label>
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger data-testid="select-city">
                  <SelectValue placeholder="اختر المدينة" />
                </SelectTrigger>
                <SelectContent>
                  {CITIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">الاقتراح</label>
              <Textarea
                placeholder="اكتب اقتراحك هنا..."
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                rows={6}
                required
                data-testid="textarea-suggestion"
              />
            </div>

            <Button
              type="submit"
              className="w-full gradient-golden"
              disabled={isSubmitting}
              data-testid="button-submit"
            >
              {isSubmitting ? 'جاري الإرسال...' : 'إرسال الاقتراح'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
