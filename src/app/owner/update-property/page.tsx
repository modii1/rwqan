"use client";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BadgeDollarSign, Building2, ListChecks, Save, Star, X, Search, Lock } from "lucide-react";
import { FACILITIES } from "@shared/schema";
import Link from "next/link";
import { validateTextInput, validateNumericInput, validateWhatsAppInput } from "@/lib/validation";
import { isPremiumSubscriptionType } from "@shared/subscriptionType";
import {
    normalizePropertyFacilitySelection,
    togglePropertyFacilitySelection,
} from "@shared/propertyFacilityFilter";
import {
    OwnerLoadingState,
    OwnerMobileNavigation,
    OwnerPageHeader,
    OwnerPageMain,
    OwnerSectionHeading,
    ownerPanelClass,
} from "@/components/owner/owner-page";
import {
    OwnerInput,
    OwnerSelectContent,
    OwnerSelectTrigger,
    OwnerTextarea,
    ownerLabelClass,
    ownerPageClass,
    ownerPrimaryButtonClass,
    ownerSecondaryButtonClass,
    ownerSoftPanelClass,
} from "@/components/owner/owner-ui";
import { OwnerVerificationGate } from "@/components/owner/owner-verification-gate";

const CITIES = ["بريدة", "عنيزة", "الرس", "البكيرية", "المذنب", "البدائع", "الأسياح", "رياض الخبراء", "عيون الجواء"];
const DIRECTIONS = ["شمال", "جنوب", "شرق", "غرب"];
const TYPES = ["قسم", "قسمين"];
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
        capacity: "",
        availabilityNote: "",
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
                capacity: property.capacity ? String(property.capacity) : "",
                availabilityNote: property.availabilityNote || "",
                whatsappNumber: property.whatsappNumber || "",
                prices: {
                    weekday: property.prices?.weekday || "",
                    weekend: property.prices?.weekend || "",
                    overnight: property.prices?.overnight || "",
                    holidays: property.prices?.holidays || "",
                },
            });
            setSelectedFacilities(normalizePropertyFacilitySelection(property.facilities));
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
        setSelectedFacilities(prev => togglePropertyFacilitySelection(prev, facility));
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

            const verified =
                data?.verificationStatus === "approved" ||
                data?.verificationStatus === "verified" ||
                data?.smartVerificationPassed === true;

            if (!verified) {
                // Keep the owner on the completion screen; the verification gate
                // exposes an explicit «إعادة التحقق» action. This avoids firing a
                // duplicate verification request automatically after every save.
                toast({
                    title: "تم حفظ البيانات",
                    description: "اضغط «إعادة التحقق» لإكمال الوصول إلى البيانات والصور.",
                });
                queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
                return;
            }

            if (data.needsManualVerification) {
                toast({ 
                    title: "تم التحديث - يحتاج تحقق يدوي",
                    description: "تم تحديث العقار لكن التحقق الذكي فشل. يرجى تشغيل التحقق الذكي من لوحة التحكم",
                    variant: "default"
                });
            } else {
                toast({ title: "تم تحديث البيانات بنجاح" });
            }
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

    const isPremium = isPremiumSubscriptionType(property?.subscriptionType);

    if (isLoading) {
        return <OwnerLoadingState text="جاري تحميل بيانات العقار..." />;
    }

    return (
        <div className={ownerPageClass}>
            <OwnerPageHeader
                eyebrow="بيانات العقار"
                title="بيانات العقار"
                description={property?.propertyNumber ? `عقار رقم ${property.propertyNumber}` : "بيانات العرض والأسعار والمرافق"}
                backHref="/owner/dashboard"
            />

            <OwnerPageMain maxWidth="4xl" className="space-y-4 sm:space-y-6">
                <OwnerVerificationGate property={property} pageLabel="بيانات العقار">

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* ====== 1. Basic Info ====== */}
                    <Card className={`${ownerPanelClass} p-4 sm:p-6`}>
                        <OwnerSectionHeading
                            title="المعلومات الأساسية"
                            description="البيانات التي تعرّف العقار في نتائج البحث"
                            icon={<Building2 className="h-4 w-4" />}
                        />
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                                <label className={ownerLabelClass}>اسم العقار</label>
                                <OwnerInput
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: validateTextInput(e.target.value) })}
                                    placeholder="اسم العقار"
                                    maxLength={30}
                                    data-testid="input-name"
                                />
                                <span className="text-xs text-[#6f685b]">{form.name?.length || 0}/30 حرف</span>
                            </div>
                            <div>
                                <label className={ownerLabelClass}>رقم واتساب</label>
                                <OwnerInput
                                    value={form.whatsappNumber}
                                    onChange={(e) => setForm({ ...form, whatsappNumber: validateWhatsAppInput(e.target.value).cleaned })}
                                    placeholder="966XXXXXXXXX"
                                    data-testid="input-whatsapp"
                                />
                            </div>
                            <div>
                                <label className={ownerLabelClass}>الموقع / الحي</label>
                                <OwnerInput
                                    value={form.location}
                                    onChange={(e) => setForm({ ...form, location: validateTextInput(e.target.value) })}
                                    placeholder="اسم الحي"
                                    data-testid="input-location"
                                />
                            </div>
                            <div>
                                <label className={ownerLabelClass}>المدينة</label>
                                <Select 
                                    value={form.city || ""} 
                                    onValueChange={(v) => { 
                                        if (v) {
                                            setForm((prev: any) => ({ ...prev, city: v }));
                                        }
                                    }}
                                >
                                    <OwnerSelectTrigger><SelectValue placeholder="اختر المدينة" /></OwnerSelectTrigger>
                                    <OwnerSelectContent position="popper" sideOffset={4}>
                                        {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </OwnerSelectContent>
                                </Select>
                            </div>

                            <div>
                                <label className={ownerLabelClass}>الاتجاه</label>
                                <Select 
                                    value={form.direction || ""}
                                    onValueChange={(v) => { 
                                        if (v) {
                                            setForm((prev: any) => ({ ...prev, direction: v }));
                                        }
                                    }}
                                >
                                    <OwnerSelectTrigger><SelectValue placeholder="اختر الاتجاه" /></OwnerSelectTrigger>
                                    <OwnerSelectContent position="popper" sideOffset={4}>
                                        {DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                    </OwnerSelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className={ownerLabelClass}>النوع</label>
                                <Select 
                                    value={form.type || ""} 
                                    onValueChange={(v) => {
                                        if (v && TYPES.includes(v)) {
                                            setForm((prev: any) => ({ ...prev, type: v }));
                                        }
                                    }}
                                >
                                    <OwnerSelectTrigger><SelectValue placeholder="اختر النوع" /></OwnerSelectTrigger>
                                    <OwnerSelectContent>
                                        {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </OwnerSelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className={ownerLabelClass}>السعة القصوى</label>
                                <OwnerInput
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={form.capacity}
                                    onChange={(e) => setForm({
                                        ...form,
                                        capacity: validateNumericInput(e.target.value),
                                    })}
                                    placeholder="مثال: 20"
                                    inputMode="numeric"
                                    data-testid="input-capacity"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className={ownerLabelClass}>بيان التوفر</label>
                                <OwnerInput
                                    value={form.availabilityNote}
                                    onChange={(e) => setForm({
                                        ...form,
                                        availabilityNote: e.target.value.slice(0, 120),
                                    })}
                                    placeholder="مثال: التوفر يتغير حسب التاريخ"
                                    maxLength={120}
                                    data-testid="input-availability-note"
                                />
                            </div>
                        </div>
                    </Card>

                    {/* ====== 2. Prices ====== */}
                    <Card className={`${ownerPanelClass} p-4 sm:p-6`}>
                        <OwnerSectionHeading
                            title="الأسعار"
                            description="السعر بالريال السعودي لكل فترة"
                            icon={<BadgeDollarSign className="h-4 w-4" />}
                        />
                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                            <div>
                                <label className={ownerLabelClass}>وسط الأسبوع</label>
                                <OwnerInput
                                    type="number"
                                    value={form.prices.weekday}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, weekday: validateNumericInput(e.target.value) } })}
                                    placeholder="500"
                                />
                            </div>
                            <div>
                                <label className={ownerLabelClass}>نهاية الأسبوع</label>
                                <OwnerInput
                                    type="number"
                                    value={form.prices.weekend}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, weekend: validateNumericInput(e.target.value) } })}
                                    placeholder="800"
                                />
                            </div>
                            <div>
                                <label className={ownerLabelClass}>مبيت</label>
                                <OwnerInput
                                    type="number"
                                    value={form.prices.overnight}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, overnight: validateNumericInput(e.target.value) } })}
                                    placeholder="1200"
                                />
                            </div>
                            <div>
                                <label className={ownerLabelClass}>إجازات</label>
                                <OwnerInput
                                    type="number"
                                    value={form.prices.holidays}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, holidays: validateNumericInput(e.target.value) } })}
                                    placeholder="2600"
                                />
                            </div>
                        </div>
                    </Card>

                    {/* ====== 3. Facilities ====== */}
                    <Card className={`${ownerPanelClass} p-4 sm:p-6`}>
                        <OwnerSectionHeading
                            title="أبرز المرافق"
                            description={`${selectedFacilities.length} مرفق محدد`}
                            icon={<ListChecks className="h-4 w-4" />}
                        />

                        {/* Selected facilities chips */}
                        {selectedFacilities.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-4">
                                {selectedFacilities.map(fac => (
                                    <span
                                        key={fac}
                                        className="inline-flex items-center gap-1 rounded-xl border border-[#e6ddc9] bg-[#fffdf8] px-3 py-1 text-xs font-medium text-[#80621d]"
                                    >
                                        {fac}
                                        <button
                                            type="button"
                                            onClick={() => toggleFacility(fac)}
                                            className="text-[#b42318]"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Search */}
                        <div className="relative mb-3">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9c9382]" />
                            <OwnerInput
                                placeholder="ابحث عن مرفق..."
                                value={facilitySearch}
                                onChange={(e) => setFacilitySearch(e.target.value)}
                                className="pr-10"
                                data-testid="input-facility-search"
                            />
                        </div>

                        {/* Checkbox grid */}
                        <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-[#f0eadc] bg-[#fffdf8] p-2 min-[390px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                            {filteredFacilities.map(facility => (
                                <div key={facility} className="flex min-h-10 items-center gap-2 rounded-xl px-2 hover:bg-[#faf7ef]">
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
                    <Card className={`${ownerSoftPanelClass} border-[#efe3c6] p-4 sm:p-6`}>
                        <OwnerSectionHeading
                            title="وصف العقار"
                            description="وصف مختصر يساعد في إظهار العقار في نتائج البحث"
                            icon={<Star className="h-4 w-4" />}
                        />

                        {isPremium ? (
                            <>
                                <OwnerTextarea
                                    value={seoDescription}
                                    onChange={(e) => setSeoDescription(e.target.value)}
                                    placeholder="اكتب وصفاً مميزاً لعقارك يظهر في نتائج البحث..."
                                    className="mb-3 min-h-[100px]"
                                    data-testid="input-seo-description"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    className={ownerSecondaryButtonClass}
                                    onClick={() => seoMutation.mutate(seoDescription)}
                                    disabled={seoMutation.isPending}
                                >
                                    {seoMutation.isPending ? "جاري الحفظ..." : "حفظ الوصف"}
                                </Button>
                            </>
                        ) : (
                            <div className="text-center py-4">
                                <p className="mb-3 text-sm text-[#80621d]">
                                    ميزة وصف SEO متاحة فقط للمشتركين في{" "}
                                    <span className="font-bold">الباقة المميزة</span>
                                </p>
                                <Link href="/owner/subscription">
                                    <Button variant="outline" className={ownerSecondaryButtonClass}>
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
                        className={`h-12 w-full ${ownerPrimaryButtonClass}`}
                        disabled={mutation.isPending}
                    >
                        <Save className="w-5 h-5 ml-2" />
                        {mutation.isPending ? "جاري الحفظ..." : "حفظ التغييرات"}
                    </Button>
                </form>

                {/* ====== 5. Password Change (outside form) ====== */}
                <Card className={`${ownerPanelClass} p-4 sm:p-6`}>
                    <OwnerSectionHeading
                        title="الرقم السري"
                        description="استخدم رقماً سرياً مختلفاً عن رقم العقار"
                        icon={<Lock className="h-4 w-4" />}
                    />
                    <div className="grid gap-4 md:grid-cols-3">
                        <div>
                            <label className={ownerLabelClass}>الرقم السري الحالي</label>
                            <OwnerInput
                                type="password"
                                value={passwordForm.currentPassword}
                                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                                placeholder="أدخل الرقم السري الحالي"
                                data-testid="input-current-password"
                            />
                        </div>
                        <div>
                            <label className={ownerLabelClass}>الرقم السري الجديد</label>
                            <OwnerInput
                                type="password"
                                value={passwordForm.newPassword}
                                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                                placeholder="4 أرقام على الأقل"
                                data-testid="input-new-password"
                            />
                        </div>
                        <div>
                            <label className={ownerLabelClass}>تأكيد الرقم السري الجديد</label>
                            <OwnerInput
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
                            className={`h-11 w-full md:col-span-3 ${ownerSecondaryButtonClass}`}
                            variant="outline"
                        >
                            <Lock className="w-4 h-4 ml-2" />
                            {passwordMutation.isPending ? "جاري التغيير..." : "تغيير الرقم السري"}
                        </Button>
                    </div>
                </Card>
                </OwnerVerificationGate>
            </OwnerPageMain>
            <OwnerMobileNavigation />
        </div>
    );
}
