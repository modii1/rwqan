"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Upload, Trash2, ExternalLink, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
    OwnerLoadingState,
    OwnerMobileNavigation,
    OwnerPageHeader,
    OwnerPageMain,
    OwnerSectionHeading,
    ownerPanelClass,
} from "@/components/owner/owner-page";

export default function OwnerImagesPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Check auth
    useEffect(() => {
        fetch("/api/owner/session", { credentials: "include" })
            .then((r) => r.json())
            .then((data) => {
                if (!data.isLoggedIn) router.push("/owner/login");
            })
            .catch(() => router.push("/owner/login"));
    }, [router]);

    // Fetch property
    const { data: property, isLoading } = useQuery<any>({
        queryKey: ["/api/owner/property"],
    });

    // Fetch R2 images as fallback/source of truth
    const { data: r2Images } = useQuery<string[]>({
        queryKey: ["owner-r2-images"],
        queryFn: async () => {
            try {
                const res = await fetch("/api/owner/r2-images", { credentials: "include" });
                if (res.ok) {
                    const data = await res.json();
                    return data.images || [];
                }
            } catch { /* ignore */ }
            return [];
        },
        enabled: !!property,
    });

    // Merge images: property.imageUrls + R2 images (deduplicated)
    const allImages = (() => {
        const propertyUrls = property?.imageUrls || [];
        const r2Urls = r2Images || [];
        const merged = [...propertyUrls];
        for (const url of r2Urls) {
            if (!merged.includes(url)) {
                merged.push(url);
            }
        }
        return merged;
    })();

    // Upload mutation
    const uploadMutation = useMutation({
        mutationFn: async (files: File[]) => {
            const formData = new FormData();
            files.forEach((f) => formData.append("images", f));
            const res = await fetch("/api/owner/images", {
                method: "POST",
                body: formData,
                credentials: "include",
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "تعذر رفع الصور. تأكد من أن حجم الصورة لا يتجاوز 2 ميجابايت");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
            queryClient.invalidateQueries({ queryKey: ["owner-r2-images"] });
            setSelectedFiles([]);
            setPreviews([]);
            toast({ title: "تم رفع الصور بنجاح", description: "تم إضافة الصور إلى ملف العقار" });
            window.location.reload();
        },
        onError: (err: Error) => {
            toast({ title: "لم يتم رفع الصور", description: err.message || "حدث خطأ أثناء رفع الصور. يرجى التحقق من حجم الصورة (أقصى حد 2 ميجابايت) والمحاولة مرة أخرى", variant: "destructive" });
        },
    });

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (imageUrl: string) => {
            const res = await fetch("/api/owner/images/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageUrl }),
                credentials: "include",
            });
            if (!res.ok) throw new Error("تعذر حذف الصورة. يرجى المحاولة مرة أخرى");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
            queryClient.invalidateQueries({ queryKey: ["owner-r2-images"] });
            toast({ title: "تم حذف الصورة", description: "تم حذف الصورة بنجاح" });
            window.location.reload();
        },
        onError: (err: Error) => {
            toast({ title: "لم يتم حذف الصورة", description: err.message || "حدث خطأ أثناء حذف الصورة. يرجى المحاولة مرة أخرى", variant: "destructive" });
        },
    });

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
        const currentCount = allImages.length;
        if (currentCount + files.length > 15) {
            toast({
                title: "تجاوز الحد الأقصى",
                description: `الحد الأقصى 15 صورة. لديك ${currentCount} صورة، يمكنك إضافة ${15 - currentCount} صورة فقط`,
                variant: "destructive",
            });
            return;
        }
        const oversized = files.filter((f) => f.size > 2 * 1024 * 1024);
        if (oversized.length > 0) {
            toast({
                title: "حجم الصورة كبير جداً",
                description: `${oversized.length} صورة تتجاوز الحد الأقصى 2 ميجابايت. يرجى تصغير حجم الصور ثم المحاولة مرة أخرى`,
                variant: "destructive",
            });
            return;
        }
        setSelectedFiles(files);
        setPreviews(files.map((f) => URL.createObjectURL(f)));
    };

    const removePreview = (idx: number) => {
        setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
        URL.revokeObjectURL(previews[idx]);
        setPreviews((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleDelete = (imageUrl: string) => {
        if (window.confirm("هل أنت متأكد من حذف هذه الصورة؟")) {
            deleteMutation.mutate(imageUrl);
        }
    };

    if (isLoading) {
        return <OwnerLoadingState text="جاري تحميل صور العقار..." />;
    }

    return (
        <div className="min-h-screen bg-[#f5f6f3] text-[#242822]">
            <OwnerPageHeader
                title="صور العقار"
                description={property?.propertyNumber ? `عقار رقم ${property.propertyNumber}` : "رفع الصور وترتيب معرض العقار"}
                backHref="/owner/dashboard"
            />

            <OwnerPageMain maxWidth="5xl" className="space-y-4 sm:space-y-6">
                <Card className={`${ownerPanelClass} p-4 sm:p-6`}>
                    <OwnerSectionHeading
                        title="إضافة صور"
                        description="JPG أو PNG، بحد أقصى 2 ميجابايت للصورة"
                        icon={<Upload className="h-4 w-4" />}
                    />

                    <div className="mb-4">
                        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#74684f]">
                            <span>المساحة المستخدمة</span>
                            <span dir="ltr">{allImages.length} / 15</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#eee6d5]">
                            <div
                                className="h-full rounded-full bg-[#9a7623] transition-[width]"
                                style={{ width: `${Math.min(100, (allImages.length / 15) * 100)}%` }}
                            />
                        </div>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                        disabled={uploadMutation.isPending || allImages.length >= 15}
                    />

                    {selectedFiles.length === 0 ? (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadMutation.isPending || allImages.length >= 15}
                            className="flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[#cdbd9d] bg-[#fffdf8] px-4 text-center transition-colors hover:bg-[#faf4e7] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#f3eddf] text-[#8a681d]">
                                <ImageIcon className="h-5 w-5" />
                            </span>
                            <span className="text-sm font-bold">
                                {allImages.length >= 15 ? "وصلت إلى الحد الأقصى" : "اختر صوراً من جهازك"}
                            </span>
                        </button>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {previews.map((src, idx) => (
                                    <div key={src} className="relative overflow-hidden rounded-lg border border-[#e2d6bd] bg-[#fffdf8]">
                                        <img src={src} alt={`معاينة ${idx + 1}`} className="aspect-[4/3] w-full object-cover" />
                                        <button
                                            onClick={() => removePreview(idx)}
                                            className="absolute left-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white/95 text-red-600 shadow-sm"
                                            type="button"
                                            aria-label={`إزالة ${selectedFiles[idx]?.name || `الصورة ${idx + 1}`}`}
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                        <p className="truncate px-2 py-2 text-xs text-[#6f6249]">{selectedFiles[idx]?.name}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                                <Button
                                    onClick={() => uploadMutation.mutate(selectedFiles)}
                                    disabled={uploadMutation.isPending}
                                    className="h-11 bg-[#2f2a1f] font-bold text-white"
                                >
                                    <Upload className="ml-2 h-4 w-4" />
                                    {uploadMutation.isPending ? "جاري الرفع..." : `رفع ${selectedFiles.length} صورة`}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-11 border-[#d8c9a8] bg-white text-[#6f5520]"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    تغيير الاختيار
                                </Button>
                            </div>
                        </div>
                    )}
                </Card>

                <Card className={`${ownerPanelClass} p-4 sm:p-6`}>
                    <OwnerSectionHeading
                        title="المعرض الحالي"
                        description={allImages.length ? `${allImages.length} صورة تظهر في صفحة العقار` : "لم تتم إضافة صور بعد"}
                        icon={<ImageIcon className="h-4 w-4" />}
                    />

                    {allImages.length > 0 ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {allImages.map((url: string, idx: number) => (
                                <article key={url} className="overflow-hidden rounded-lg border border-[#e2d6bd] bg-[#fffdf8]">
                                    <img src={url} alt={`صورة العقار ${idx + 1}`} className="aspect-[4/3] w-full object-cover" />
                                    <div className="flex items-center gap-1 border-t border-[#eee4cf] p-2">
                                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#8b7140]">صورة {idx + 1}</span>
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#6f5520] hover:bg-[#f3eddf]"
                                            aria-label={`فتح الصورة ${idx + 1}`}
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                        <button
                                            onClick={() => handleDelete(url)}
                                            disabled={deleteMutation.isPending}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                                            type="button"
                                            aria-label={`حذف الصورة ${idx + 1}`}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-32 flex-col items-center justify-center rounded-lg bg-[#fffdf8] px-4 text-center text-[#74684f]">
                            <ImageIcon className="mb-2 h-7 w-7 opacity-50" />
                            <p className="text-sm">أضف أول صورة للعقار من القسم أعلاه</p>
                        </div>
                    )}
                </Card>
            </OwnerPageMain>
            <OwnerMobileNavigation />
        </div>
    );
}
