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
                throw new Error(err.error || "فشل رفع الصور");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
            queryClient.invalidateQueries({ queryKey: ["owner-r2-images"] });
            setSelectedFiles([]);
            setPreviews([]);
            toast({ title: "تم رفع الصور بنجاح", description: "تم إضافة الصور إلى ملف العقار" });
        },
        onError: (err: Error) => {
            toast({ title: "فشل رفع الصور", description: err.message, variant: "destructive" });
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
            if (!res.ok) throw new Error("فشل حذف الصورة");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
            queryClient.invalidateQueries({ queryKey: ["owner-r2-images"] });
            toast({ title: "تم حذف الصورة", description: "تم حذف الصورة بنجاح" });
        },
        onError: (err: Error) => {
            toast({ title: "فشل حذف الصورة", description: err.message, variant: "destructive" });
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
            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-[#4a3b2a] mb-2">إدارة الصور</h1>
                    <p className="text-muted-foreground">رفع وإدارة صور العقار</p>
                </div>

                {/* Current Images */}
                <Card className="p-6">
                    <h2 className="text-xl font-bold mb-4">
                        الصور الحالية ({allImages.length}/15)
                    </h2>
                    {allImages.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {allImages.map((url: string, idx: number) => (
                                <div key={idx} className="relative group">
                                    <img
                                        src={url}
                                        alt={`صورة ${idx + 1}`}
                                        className="w-full h-48 object-cover rounded-lg"
                                    />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-white bg-blue-500 hover:bg-blue-600 rounded-full p-2"
                                        >
                                            <ExternalLink className="w-5 h-5" />
                                        </a>
                                        <button
                                            onClick={() => handleDelete(url)}
                                            disabled={deleteMutation.isPending}
                                            className="text-white bg-red-500 hover:bg-red-600 rounded-full p-2 disabled:opacity-50"
                                            type="button"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-muted-foreground">لا توجد صور مرفوعة حالياً</div>
                    )}
                </Card>

                {/* Upload */}
                <Card className="p-6">
                    <h2 className="text-xl font-bold mb-4">رفع صور جديدة</h2>
                    <div className="space-y-4">
                        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                            <Upload className="w-12 h-12 mx-auto mb-4 text-[#b88d2b]" />
                            <p className="text-lg font-semibold mb-2">اختر الصور للرفع</p>
                            <p className="text-sm text-muted-foreground mb-4">الحد الأقصى 15 صورة (PNG, JPG, JPEG)</p>
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
                                className="bg-[#b88d2b] hover:bg-[#a07d25]"
                                disabled={uploadMutation.isPending}
                            >
                                اختر الصور
                            </Button>
                        </div>

                        {selectedFiles.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="font-semibold">الصور المختارة ({selectedFiles.length})</h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {previews.map((src, idx) => (
                                        <div key={idx} className="relative">
                                            <img src={src} alt={`معاينة ${idx + 1}`} className="w-full h-48 object-cover rounded-lg" />
                                            <button
                                                onClick={() => removePreview(idx)}
                                                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                                                type="button"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                            <p className="text-xs text-muted-foreground mt-1 truncate">{selectedFiles[idx]?.name}</p>
                                        </div>
                                    ))}
                                </div>
                                <Button
                                    onClick={() => uploadMutation.mutate(selectedFiles)}
                                    disabled={uploadMutation.isPending}
                                    className="w-full bg-[#b88d2b] hover:bg-[#a07d25]"
                                >
                                    {uploadMutation.isPending ? "جاري الرفع..." : `رفع ${selectedFiles.length} صورة`}
                                </Button>
                            </div>
                        )}
                    </div>
                </Card>

                {/* Notes */}
                <Card className="p-6 bg-[#fffdf0] border-[#e0c97b]">
                    <h3 className="font-bold mb-2 text-[#4a3b2a]">ملاحظات هامة:</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-[#5b4a1f]">
                        <li>يمكنك رفع حتى 15 صور للعقار</li>
                        <li>الصور المدعومة: JPG, PNG, JPEG</li>
                        <li>سيتم عرض الصور في صفحة العقار تلقائياً</li>
                    </ul>
                </Card>
            </div>
        </div>
    );
}
