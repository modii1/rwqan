"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cleanPhoneNumber, validatePhoneNumber } from "@/lib/validation";
import { Lightbulb, Phone, MapPin, User, MessageSquare, Send, CheckCircle2, Sparkles } from "lucide-react";

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب', 'البدائع', 'الأسياح', 'عيون الجواء', 'رياض الخبراء'];

export default function SuggestPage() {
    const { toast } = useToast();
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [city, setCity] = useState("");
    const [suggestion, setSuggestion] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (name.trim().length < 3) {
            toast({
                title: "خطأ في البيانات",
                description: "الاسم يجب أن يكون 3 أحرف على الأقل",
                variant: "destructive",
            });
            return;
        }

        const phoneValidation = validatePhoneNumber(phone);
        if (!phoneValidation.valid) {
            toast({
                title: "خطأ في رقم الجوال",
                description: phoneValidation.error || "رقم الجوال غير صحيح",
                variant: "destructive",
            });
            return;
        }

        if (!city) {
            toast({
                title: "خطأ في البيانات",
                description: "يرجى اختيار المدينة",
                variant: "destructive",
            });
            return;
        }

        if (suggestion.trim().length < 10) {
            toast({
                title: "خطأ في البيانات",
                description: "الاقتراح يجب أن يكون 10 أحرف على الأقل",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            await apiRequest('POST', '/api/suggestions', {
                name: name.trim(),
                phone: phoneValidation.cleaned,
                city,
                suggestion: suggestion.trim()
            });

            setSubmitted(true);
            toast({
                title: "تم إرسال الاقتراح بنجاح ✓",
                description: "شكراً لك! سنراجع اقتراحك قريباً",
            });

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
            {/* Enhanced Header with Gradient */}
            <header className="bg-gradient-to-b from-primary/10 to-background">
                <div className="max-w-7xl mx-auto px-4 py-12 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6 shadow-golden">
                        <Lightbulb className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
                        اقترح لنا
                    </h1>
                    <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
                        شاركنا أفكارك واقتراحاتك لتطوير المنصة وسنعمل على تنفيذها
                    </p>
                    <div className="divider-gold max-w-xs mx-auto mt-6"></div>
                </div>
            </header>

            <div className="max-w-2xl mx-auto px-4 py-8">
                <Card className="p-8 glass-premium border-primary/20">
                    {submitted ? (
                        <div className="text-center py-12">
                            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-50 mb-6 shadow-golden">
                                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-foreground mb-2">شكراً لك!</h2>
                            <p className="text-muted-foreground mb-6">تم إرسال اقتراحك بنجاح. سنراجعه قريباً.</p>
                            <Button 
                                onClick={() => setSubmitted(false)}
                                variant="outline"
                                className="rounded-xl border-primary/30 hover:bg-primary/5"
                            >
                                إرسال اقتراح آخر
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* Feature Highlights */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                                <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
                                    <Sparkles className="w-5 h-5 text-primary" />
                                    <div className="text-sm">
                                        <p className="font-semibold text-foreground">المدينة</p>
                                        <p className="text-muted-foreground text-xs">اختر مدينتك</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
                                    <MessageSquare className="w-5 h-5 text-primary" />
                                    <div className="text-sm">
                                        <p className="font-semibold text-foreground">الاقتراح</p>
                                        <p className="text-muted-foreground text-xs">اكتب اقتراحك</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
                                    <Send className="w-5 h-5 text-primary" />
                                    <div className="text-sm">
                                        <p className="font-semibold text-foreground">إرسال</p>
                                        <p className="text-muted-foreground text-xs">سنراجع اقتراحك قريباً</p>
                                    </div>
                                </div>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="flex items-center gap-2 text-sm font-bold mb-2 text-foreground">
                                            <User className="w-4 h-4 text-primary" />
                                            الاسم
                                        </label>
                                        <Input
                                            placeholder="اسمك الكريم"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            required
                                            data-testid="input-name"
                                            className="rounded-xl border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-300"
                                        />
                                    </div>

                                    <div>
                                        <label className="flex items-center gap-2 text-sm font-bold mb-2 text-foreground">
                                            <Phone className="w-4 h-4 text-primary" />
                                            رقم الجوال
                                        </label>
                                        <Input
                                            type="tel"
                                            placeholder="5XXXXXXXX"
                                            value={phone}
                                            onChange={(e) => {
                                                const cleaned = cleanPhoneNumber(e.target.value);
                                                setPhone(cleaned);
                                            }}
                                            required
                                            inputMode="numeric"
                                            maxLength={10}
                                            data-testid="input-phone"
                                            className="rounded-xl border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-300"
                                        />
                                        {phone && phone.length > 0 && phone.length < 10 && (
                                            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                                                رقم الجوال يجب أن يكون 9 أرقام (5XXXXXXXX)
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="flex items-center gap-2 text-sm font-bold mb-2 text-foreground">
                                        <MapPin className="w-4 h-4 text-primary" />
                                        المدينة
                                    </label>
                                    <Select value={city} onValueChange={setCity}>
                                        <SelectTrigger data-testid="select-city" className="rounded-xl border-border/50 focus:ring-2 focus:ring-primary/10 h-10">
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
                                    <label className="flex items-center gap-2 text-sm font-bold mb-2 text-foreground">
                                        <MessageSquare className="w-4 h-4 text-primary" />
                                        الاقتراح
                                    </label>
                                    <Textarea
                                        placeholder="اكتب اقتراحك هنا..."
                                        value={suggestion}
                                        onChange={(e) => setSuggestion(e.target.value)}
                                        rows={6}
                                        required
                                        data-testid="textarea-suggestion"
                                        className="rounded-xl border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-300 resize-none"
                                    />
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full rounded-xl h-12 text-base font-bold gradient-golden hover:shadow-golden transition-all duration-300"
                                    disabled={isSubmitting}
                                    data-testid="button-submit"
                                >
                                    {isSubmitting ? (
                                        <span className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            جاري الإرسال...
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-2">
                                            <Send className="w-4 h-4" />
                                            إرسال الاقتراح
                                        </span>
                                    )}
                                </Button>
                            </form>
                        </>
                    )}
                </Card>
            </div>
        </div>
    );
}
