"use client";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save, ArrowRight, Star, X, Search, Lock } from "lucide-react";
import { FACILITIES } from "@shared/schema";
import Link from "next/link";
import { validateTextInput, validateNumericInput, validateWhatsAppInput } from "@/lib/validation";

const CITIES = ["بريدة", "عنيزة", "الرس", "البكيرية", "المذنب", "البدائع", "الأسياح", "رياض الخبراء", "عيون الجواء"];
const DIRECTIONS = ["شمال", "جنوب", "شرق", "غرب"];
const TYPES = ["قسم", "قسمين"];

/** Parse facilities from any stored format to string[] */
function parseFacilities(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch { /* ignore */ }
        return raw.split(",").map(s => s.trim()).filter(Boolean);
    }
    return [];
}

export default function UpdatePropertyPage() {
    const router = useRouter();
    const { toast } = useToast();

    // Check auth
    useEffect(() => {
        fetch("/api/owner/session", { credentials: "include" })
            .then((r) => r.json())
            .then((data) => {
                if (!data.isLoggedIn) router.push("/owner/login");
            })
            .catch(() => router.push("/owner/login"));
    }, [router]);

    const { data: property, isLoading } = useQuery<any>({
        queryKey: ["/api/owner/property"],
    });

    // SEO data
    const { data: seoData } = useQuery<any>({
        queryKey: ["/api/owner/seo"],
        enabled: !!property,
    });

    const [form, setForm] = useState({
        name: "",
        location: "",
        city: "",
        direction: "",
        type: "",
        whatsappNumber: "",
        prices: {
            weekday: "",
            weekend: "",
            overnight: "",
            holidays: "",
        },
    });

    // Facilities state
    const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
    const [facilitySearch, setFacilitySearch] = useState("");

    // SEO state
    const [seoDescription, setSeoDescription] = useState("");

    // Password state
    const [passwordForm, setPasswordForm] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
    });

    // Populate form when property loads
    useEffect(() => {
        if (property) {
            setForm({
                name: property.name || "",
                location: property.location || "",
                city: property.city || "",
                direction: property.direction || "",
                type: property.type || "",
                whatsappNumber: property.whatsappNumber || "",
                prices: {
                    weekday: property.prices?.weekday || "",
                    weekend: property.prices?.weekend || "",
                    overnight: property.prices?.overnight || "",
                    holidays: property.prices?.holidays || "",
                },
            });
            setSelectedFacilities(parseFacilities(property.facilities));
        }
    }, [property]);

    // Populate SEO when data loads
    useEffect(() => {
        if (seoData) {
            setSeoDescription(seoData.seoDescription || "");
        }
    }, [seoData]);

    // Filtered facilities for search
    const filteredFacilities = useMemo(() => {
        if (!facilitySearch.trim()) return [...FACILITIES];
        const q = facilitySearch.toLowerCase();
        return FACILITIES.filter(f => f.toLowerCase().includes(q));
    }, [facilitySearch]);

    const toggleFacility = (facility: string) => {
        setSelectedFacilities(prev =>
            prev.includes(facility) ? prev.filter(f => f !== facility) : [...prev, facility]
        );
    };

    // Property update mutation
    const mutation = useMutation({
        mutationFn: async (data: typeof form & { facilities: string[] }) => {
            const res = await fetch("/api/owner/property", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
                credentials: "include",
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "فشل تحديث البيانات");
            }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.setQueryData(["/api/owner/property"], data);
            toast({ title: "تم تحديث البيانات بنجاح" });
            router.push("/owner/dashboard");
        },
        onError: (err: Error) => {
            toast({ title: "فشل التحديث", description: err.message, variant: "destructive" });
        },
    });

    // SEO update mutation
    const seoMutation = useMutation({
        mutationFn: async (desc: string) => {
            const res = await fetch("/api/owner/seo", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ seoDescription: desc }),
                credentials: "include",
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || err.message || "فشل في تحديث الوصف");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/owner/seo"] });
            toast({ title: "تم تحديث وصف SEO بنجاح" });
        },
        onError: (err: Error) => {
            toast({ title: "فشل التحديث", description: err.message, variant: "destructive" });
        },
    });

    // Password change mutation
    const passwordMutation = useMutation({
        mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
            const res = await fetch("/api/owner/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
                credentials: "include",
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || "فشل تغيير الرقم السري");
            }
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "تم تغيير الرقم السري بنجاح" });
            setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        },
        onError: (err: Error) => {
            toast({ title: "فشل تغيير الرقم السري", description: err.message, variant: "destructive" });
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        mutation.mutate({ ...form, facilities: selectedFacilities });
    };

    const handlePasswordChange = () => {
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            toast({ title: "الرقم السري الجديد غير متطابق", variant: "destructive" });
            return;
        }
        if (passwordForm.newPassword.length < 4) {
            toast({ title: "الرقم السري يجب أن يكون 4 أرقام على الأقل", variant: "destructive" });
            return;
        }
        passwordMutation.mutate({
            currentPassword: passwordForm.currentPassword,
            newPassword: passwordForm.newPassword,
        });
    };

    const isPremium = property?.subscriptionType === "مميز";

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background p-6 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="mt-4 text-muted-foreground">جاري التحميل...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background p-4 md:p-6">
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/owner/dashboard")}>
                        <ArrowRight className="w-5 h-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-[#4a3b2a]">تحديث بيانات العقار</h1>
                        <p className="text-muted-foreground">
                            {property?.propertyNumber ? `عقار رقم ${property.propertyNumber}` : "الاسم – المدينة – الأسعار – الوصف"}
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* ====== 1. Basic Info ====== */}
                    <Card className="p-6">
                        <h2 className="text-lg font-bold text-primary mb-4">المعلومات الأساسية</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold mb-2">اسم العقار</label>
                                <Input
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: validateTextInput(e.target.value) })}
                                    placeholder="اسم العقار"
                                    maxLength={25}
                                    data-testid="input-name"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">رقم واتساب</label>
                                <Input
                                    value={form.whatsappNumber}
                                    onChange={(e) => setForm({ ...form, whatsappNumber: validateWhatsAppInput(e.target.value).cleaned })}
                                    placeholder="966XXXXXXXXX"
                                    data-testid="input-whatsapp"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">الموقع / الحي</label>
                                <Input
                                    value={form.location}
                                    onChange={(e) => setForm({ ...form, location: validateTextInput(e.target.value) })}
                                    placeholder="اسم الحي"
                                    data-testid="input-location"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">المدينة</label>
                                <Select value={form.city} onValueChange={(v) => setForm({ ...form, city: v })}>
                                    <SelectTrigger><SelectValue placeholder="اختر المدينة" /></SelectTrigger>
                                    <SelectContent>
                                        {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">الاتجاه</label>
                                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                                    <SelectTrigger><SelectValue placeholder="اختر الاتجاه" /></SelectTrigger>
                                    <SelectContent>
                                        {DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">النوع</label>
                                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                                    <SelectTrigger><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                                    <SelectContent>
                                        {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </Card>

                    {/* ====== 2. Prices ====== */}
                    <Card className="p-6">
                        <h2 className="text-lg font-bold text-primary mb-4">الأسعار</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold mb-2">وسط الأسبوع</label>
                                <Input
                                    type="number"
                                    value={form.prices.weekday}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, weekday: validateNumericInput(e.target.value) } })}
                                    placeholder="500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">نهاية الأسبوع</label>
                                <Input
                                    type="number"
                                    value={form.prices.weekend}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, weekend: validateNumericInput(e.target.value) } })}
                                    placeholder="800"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">مبيت</label>
                                <Input
                                    type="number"
                                    value={form.prices.overnight}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, overnight: validateNumericInput(e.target.value) } })}
                                    placeholder="1200"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">إجازات</label>
                                <Input
                                    type="number"
                                    value={form.prices.holidays}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, holidays: validateNumericInput(e.target.value) } })}
                                    placeholder="1000"
                                />
                            </div>
                        </div>
                    </Card>

                    {/* ====== 3. Facilities ====== */}
                    <Card className="p-6">
                        <h2 className="text-lg font-bold text-primary mb-4">
                            المرافق المتوفرة ({selectedFacilities.length} مختار)
                        </h2>

                        {/* Selected facilities chips */}
                        {selectedFacilities.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-4">
                                {selectedFacilities.map(fac => (
                                    <span
                                        key={fac}
                                        className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium"
                                    >
                                        {fac}
                                        <button
                                            type="button"
                                            onClick={() => toggleFacility(fac)}
                                            className="hover:text-destructive"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Search */}
                        <div className="relative mb-3">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="ابحث عن مرفق..."
                                value={facilitySearch}
                                onChange={(e) => setFacilitySearch(e.target.value)}
                                className="pr-10"
                                data-testid="input-facility-search"
                            />
                        </div>

                        {/* Checkbox grid */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-56 overflow-y-auto p-3 bg-muted/30 rounded-lg">
                            {filteredFacilities.map(facility => (
                                <div key={facility} className="flex items-center gap-2">
                                    <Checkbox
                                        checked={selectedFacilities.includes(facility)}
                                        onCheckedChange={() => toggleFacility(facility)}
                                        id={`fac-${facility}`}
                                    />
                                    <label htmlFor={`fac-${facility}`} className="text-xs cursor-pointer select-none">
                                        {facility}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* ====== 4. SEO Description ====== */}
                    <Card className="p-6 border-amber-200 bg-gradient-to-br from-amber-50/50 to-background">
                        <div className="flex items-center gap-2 mb-4">
                            <Star className="w-5 h-5 text-amber-500" />
                            <h2 className="text-lg font-bold text-amber-700">وصف العقار (SEO)</h2>
                        </div>

                        {isPremium ? (
                            <>
                                <Textarea
                                    value={seoDescription}
                                    onChange={(e) => setSeoDescription(e.target.value)}
                                    placeholder="اكتب وصفاً مميزاً لعقارك يظهر في نتائج البحث..."
                                    className="min-h-[100px] mb-3"
                                    data-testid="input-seo-description"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                                    onClick={() => seoMutation.mutate(seoDescription)}
                                    disabled={seoMutation.isPending}
                                >
                                    {seoMutation.isPending ? "جاري الحفظ..." : "حفظ الوصف"}
                                </Button>
                            </>
                        ) : (
                            <div className="text-center py-4">
                                <p className="text-amber-700 mb-3 text-sm">
                                    ميزة وصف SEO متاحة فقط للمشتركين في{" "}
                                    <span className="font-bold">الباقة المميزة</span>
                                </p>
                                <Link href="/subscription">
                                    <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50">
                                        <Star className="w-4 h-4 ml-2" />
                                        ترقية الاشتراك
                                    </Button>
                                </Link>
                            </div>
                        )}
                    </Card>

                    {/* Save property button */}
                    <Button
                        type="submit"
                        className="w-full bg-[#b88d2b] hover:bg-[#a07d25] text-white font-bold py-6"
                        disabled={mutation.isPending}
                    >
                        <Save className="w-5 h-5 ml-2" />
                        {mutation.isPending ? "جاري الحفظ..." : "حفظ التغييرات"}
                    </Button>
                </form>

                {/* ====== 5. Password Change (outside form) ====== */}
                <Card className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Lock className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-bold text-primary">تغيير الرقم السري</h2>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold mb-2">الرقم السري الحالي</label>
                            <Input
                                type="password"
                                value={passwordForm.currentPassword}
                                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                                placeholder="أدخل الرقم السري الحالي"
                                data-testid="input-current-password"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2">الرقم السري الجديد</label>
                            <Input
                                type="password"
                                value={passwordForm.newPassword}
                                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                                placeholder="4 أرقام على الأقل"
                                data-testid="input-new-password"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2">تأكيد الرقم السري الجديد</label>
                            <Input
                                type="password"
                                value={passwordForm.confirmPassword}
                                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                                placeholder="أعد كتابة الرقم السري الجديد"
                                data-testid="input-confirm-password"
                            />
                        </div>
                        <Button
                            type="button"
                            onClick={handlePasswordChange}
                            disabled={
                                passwordMutation.isPending ||
                                !passwordForm.currentPassword ||
                                !passwordForm.newPassword ||
                                !passwordForm.confirmPassword
                            }
                            className="w-full"
                            variant="outline"
                        >
                            <Lock className="w-4 h-4 ml-2" />
                            {passwordMutation.isPending ? "جاري التغيير..." : "تغيير الرقم السري"}
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
