import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { Property } from "@shared/schema";
import { Upload, X, ExternalLink, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function OwnerImagesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─────────────────────────────
  // حماية الصفحة
  // ─────────────────────────────
  useEffect(() => {
    fetch("/api/owner/session")
      .then((res) => res.json())
      .then((data) => {
        if (!data.isLoggedIn) setLocation("/owner/login");
      })
      .catch(() => setLocation("/owner/login"));
  }, [setLocation]);

  // ─────────────────────────────
  // بيانات العقار
  // ─────────────────────────────
  const { data: property, isLoading } = useQuery<Property>({
    queryKey: ["/api/owner/property"],
  });

  // تأمين imageUrls بحيث تكون دائمًا Array
  const imageUrls: string[] = Array.isArray(property?.imageUrls)
    ? property!.imageUrls
    : [];

  const imagesCount = imageUrls.length;
  const maxImages = 15;

  // ─────────────────────────────
  // رفع الصور
  // ─────────────────────────────
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
        const err = await res.text();
        throw new Error(err || "فشل رفع الصور");
      }

      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم رفع الصور بنجاح" });
      setSelectedFiles([]);
      setPreviewUrls([]);
      queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
    },
    onError: (err: any) => {
      toast({
        title: "خطأ في رفع الصور",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith("image/")
    );

    const current = imagesCount;
    const incoming = files.length;

    if (current + incoming > maxImages) {
      toast({
        title: "تجاوز الحد",
        description: `لديك ${current} صورة، الحد الأقصى 15 صورة.`,
        variant: "destructive",
      });
      return;
    }

    setSelectedFiles(files);
    setPreviewUrls(files.map((f) => URL.createObjectURL(f)));
  };

  const removeFile = (idx: number) => {
    URL.revokeObjectURL(previewUrls[idx]);
    setPreviewUrls((p) => p.filter((_, i) => i !== idx));
    setSelectedFiles((f) => f.filter((_, i) => i !== idx));
  };

  const handleUpload = () => {
    if (selectedFiles.length > 0) uploadMutation.mutate(selectedFiles);
  };

  // ─────────────────────────────
  // حذف صورة
  // ─────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (imageUrl: string) => {
      const res = await fetch("/api/owner/images/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "فشل حذف الصورة");
      }

      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم حذف الصورة بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
    },
    onError: (err: any) => {
      toast({
        title: "خطأ في حذف الصورة",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteImage = (e: any, url: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (window.confirm("هل أنت متأكد من حذف الصورة؟")) {
      deleteMutation.mutate(url);
    }
  };

  // ─────────────────────────────
  // واجهة المستخدم
  // ─────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-lg">
        جاري التحميل...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* عنوان */}
        <div>
          <h1 className="text-3xl font-bold mb-2">إدارة الصور</h1>
          <p className="text-muted-foreground">رفع وإدارة صور العقار</p>
        </div>

        {/* الصور الحالية */}
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">
            الصور الحالية ({imagesCount}/{maxImages})
          </h2>

          {imagesCount === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد صور مرفوعة حالياً
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {imageUrls.map((url, idx) => (
                <div key={idx} className="relative group">
                  <img
                    src={url}
                    className="w-full h-48 object-cover rounded-lg"
                  />

                  <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-3">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-blue-600 text-white rounded-full"
                    >
                      <ExternalLink className="w-5 h-5" />
                    </a>

                    <button
                      onClick={(e) => handleDeleteImage(e, url)}
                      className="p-2 bg-red-600 text-white rounded-full"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* رفع صور جديدة */}
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">رفع صور جديدة</h2>

          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <Upload className="w-12 h-12 mx-auto mb-4" />

            <p className="font-semibold mb-2">اختر الصور للرفع</p>
            <p className="text-xs mb-4">حتى {maxImages} صورة</p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />

            <Button onClick={() => fileInputRef.current?.click()}>
              اختر الصور
            </Button>
          </div>

          {/* معاينة الصور */}
          {previewUrls.length > 0 && (
            <div className="mt-6 space-y-4">
              <h3 className="font-semibold">
                الصور المختارة ({previewUrls.length})
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {previewUrls.map((url, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={url}
                      className="w-full h-48 object-cover rounded-lg"
                    />

                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <Button
                onClick={handleUpload}
                disabled={uploadMutation.isPending}
                className="w-full"
              >
                {uploadMutation.isPending
                  ? "جاري الرفع..."
                  : `رفع ${previewUrls.length} صورة`}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
