"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, ExternalLink, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ownerPanelClass = "rounded-lg border border-[#e2d6bd] bg-white";

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
        return (
            <div className="min-h-screen bg-[#faf8f1] p-6 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block w-8 h-8 border-4 border-[#b88d2b] border-t-transparent rounded-lg animate-spin" />
                    <p className="mt-4 text-[#6f6249]">جاري التحميل...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#faf8f1] p-4 md:p-6">
            <div className="max-w-5xl mx-auto space-y-6">
                <div className="rounded-lg border border-[#e2d6bd] bg-[#fffdf8] p-5 md:p-6">
                    <p className="text-sm font-semibold text-[#8b7140]">صور العقار</p>
                    <h1 className="mt-1 text-3xl md:text-4xl font-bold text-[#2f2a1f]">إدارة الصور</h1>
                    <p className="mt-2 text-[#6f6249]">رفع وتنظيم الصور المعروضة في صفحة العقار</p>
                </div>

                {/* Current Images */}
                <Card className={`${ownerPanelClass} p-5 md:p-6`}>
                    <h2 className="text-xl font-bold mb-4 text-[#2f2a1f]">
                        الصور الحالية ({allImages.length}/15)
                    </h2>
                    {allImages.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {allImages.map((url: string, idx: number) => (
                                <div key={idx} className="overflow-hidden rounded-lg border border-[#e2d6bd] bg-[#fffdf8]">
                                    <img
                                        src={url}
                                        alt={`صورة ${idx + 1}`}
                                        className="w-full h-48 object-cover"
                                    />
                                    <div className="flex items-center justify-between gap-2 border-t border-[#eee4cf] p-2">
                                        <span className="text-xs font-semibold text-[#8b7140]">صورة {idx + 1}</span>
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d8c9a8] bg-white text-[#6f5520]"
                                            aria-label="فتح الصورة"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                        <button
                                            onClick={() => handleDelete(url)}
                                            disabled={deleteMutation.isPending}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#f1c8c8] bg-white text-red-600 disabled:opacity-50"
                                            type="button"
                                            aria-label="حذف الصورة"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-[#6f6249]">لا توجد صور مرفوعة حالياً</div>
                    )}
                </Card>

                {/* Upload */}
                <Card className={`${ownerPanelClass} p-5 md:p-6`}>
                    <h2 className="text-xl font-bold mb-4 text-[#2f2a1f]">رفع صور جديدة</h2>
                    <div className="space-y-4">
                        <div className="border border-dashed border-[#d8c9a8] rounded-lg bg-[#fffdf8] p-8 text-center">
                            <Upload className="w-12 h-12 mx-auto mb-4 text-[#b88d2b]" />
                            <p className="text-lg font-semibold mb-2 text-[#2f2a1f]">اختر صور العقار للرفع</p>
                            <p className="text-sm text-[#6f6249] mb-4">الحد الأقصى 15 صورة - بحجم لا يتجاوز 2 ميجابايت للصورة (PNG, JPG, JPEG)</p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept="image/*"
                                onChange={handleFileSelect}
                                className="hidden"
                                disabled={uploadMutation.isPending}
                            />
                            <Button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-[#2f2a1f] text-white"
                                disabled={uploadMutation.isPending}
                            >
                                اختر الصور
                            </Button>
                        </div>

                        {selectedFiles.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="font-semibold text-[#2f2a1f]">الصور المختارة ({selectedFiles.length})</h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {previews.map((src, idx) => (
                                        <div key={idx} className="overflow-hidden rounded-lg border border-[#e2d6bd] bg-[#fffdf8]">
                                            <img src={src} alt={`معاينة ${idx + 1}`} className="w-full h-48 object-cover" />
                                            <button
                                                onClick={() => removePreview(idx)}
                                                className="m-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#f1c8c8] bg-white text-red-600"
                                                type="button"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                            <p className="px-2 pb-2 text-xs text-[#6f6249] truncate">{selectedFiles[idx]?.name}</p>
                                        </div>
                                    ))}
                                </div>
                                <Button
                                    onClick={() => uploadMutation.mutate(selectedFiles)}
                                    disabled={uploadMutation.isPending}
                                    className="w-full bg-[#2f2a1f] text-white"
                                >
                                    {uploadMutation.isPending ? "جاري الرفع..." : `رفع ${selectedFiles.length} صورة`}
                                </Button>
                            </div>
                        )}
                    </div>
                </Card>

                {/* Notes */}
                <Card className="rounded-lg border border-[#e0c97b] bg-[#fffdf0] p-5 md:p-6">
                    <h3 className="font-bold mb-2 text-[#4a3b2a]">ملاحظات هامة:</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-[#5b4a1f]">
                        <li>يمكنك رفع حتى 15 صورة للعقار</li>
                        <li>الصيغ المدعومة: JPG - PNG - JPEG</li>
                        <li><strong>الحد الأقصى لحجم الصورة:</strong> 2 ميجابايت لكل صورة</li>
                        <li><strong>الحجم المناسب:</strong> يفضل أن تكون الصورة بدقة 1200×800 بكسل أو أكثر وبحجم لا يتجاوز 2 ميجابايت</li>
                        <li>سيتم عرض الصور في صفحة العقار تلقائياً</li>
                    </ul>
                </Card>
            </div>
        </div>
    );
}
