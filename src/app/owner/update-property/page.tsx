"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save, ArrowRight } from "lucide-react";

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
        }
    }, [property]);

    const mutation = useMutation({
        mutationFn: async (data: typeof form) => {
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
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
            toast({ title: "تم تحديث البيانات بنجاح" });
            router.push("/owner/dashboard");
        },
        onError: (err: Error) => {
            toast({ title: "فشل التحديث", description: err.message, variant: "destructive" });
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        mutation.mutate(form);
    };

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
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/owner/dashboard")}>
                        <ArrowRight className="w-5 h-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-[#4a3b2a]">تحديث بيانات العقار</h1>
                        <p className="text-muted-foreground">الاسم – المدينة – الأسعار – الوصف</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Basic Info */}
                    <Card className="p-6">
                        <h2 className="text-lg font-bold text-primary mb-4">المعلومات الأساسية</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold mb-2">اسم العقار</label>
                                <Input
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="اسم العقار"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">رقم واتساب</label>
                                <Input
                                    value={form.whatsappNumber}
                                    onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
                                    placeholder="966XXXXXXXXX"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">الموقع / الحي</label>
                                <Input
                                    value={form.location}
                                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                                    placeholder="اسم الحي"
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

                    {/* Prices */}
                    <Card className="p-6">
                        <h2 className="text-lg font-bold text-primary mb-4">الأسعار</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold mb-2">وسط الأسبوع</label>
                                <Input
                                    type="number"
                                    value={form.prices.weekday}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, weekday: e.target.value } })}
                                    placeholder="500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">نهاية الأسبوع</label>
                                <Input
                                    type="number"
                                    value={form.prices.weekend}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, weekend: e.target.value } })}
                                    placeholder="800"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">مبيت</label>
                                <Input
                                    type="number"
                                    value={form.prices.overnight}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, overnight: e.target.value } })}
                                    placeholder="1200"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">إجازات</label>
                                <Input
                                    type="number"
                                    value={form.prices.holidays}
                                    onChange={(e) => setForm({ ...form, prices: { ...form.prices, holidays: e.target.value } })}
                                    placeholder="1000"
                                />
                            </div>
                        </div>
                    </Card>

                    <Button
                        type="submit"
                        className="w-full bg-[#b88d2b] hover:bg-[#a07d25] text-white font-bold py-6"
                        disabled={mutation.isPending}
                    >
                        <Save className="w-5 h-5 ml-2" />
                        {mutation.isPending ? "جاري الحفظ..." : "حفظ التغييرات"}
                    </Button>
                </form>
            </div>
        </div>
    );
}
