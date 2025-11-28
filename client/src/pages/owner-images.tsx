import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { ExternalLink, Trash2, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function OwnerImagesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  /* ==========================================================
     1) التحقق من الجلسة
  ============================================================*/
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ["/api/owner/session"],
  });

  useEffect(() => {
    if (!sessionLoading && !sessionData?.isLoggedIn) {
      setLocation("/owner/login");
    }
  }, [sessionLoading, sessionData, setLocation]);

  /* ==========================================================
     2) جلب صور R2 مباشرة
  ============================================================*/
  const { data: r2Data, isLoading: r2Loading } = useQuery({
    queryKey: ["/api/owner/r2-images"],
    queryFn: async () => {
      const res = await fetch("/api/owner/r2-images", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load images");
      return res.json();
    },
  });

  const r2Images = r2Data?.images || [];

  /* ==========================================================
     3) رفع الصور
  ============================================================*/
  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach((f) => formData.append("images", f));

      const res = await fetch("/api/owner/images", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/r2-images"] });
      setSelectedFiles([]);
      setPreviewUrls([]);
      toast({ title: "تم رفع الصور بنجاح" });
    },
    onError: (err: any) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    if (r2Images.length + files.length > 15) {
      toast({
        title: "تجاوز الحد",
        description: `الحد الأقصى 15 صورة`,
        variant: "destructive",
      });
      return;
    }

    setSelectedFiles(files);
    setPreviewUrls(files.map((f) => URL.createObjectURL(f)));
  };

  /* ==========================================================
     4) حذف صورة (المسار الصحيح DELETE /api/owner/images/:index)
  ============================================================*/
  const deleteMutation = useMutation({
    mutationFn: async (index: number) => {
      const res = await fetch(`/api/owner/images/${index}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/r2-images"] });
      toast({ title: "تم حذف الصورة بنجاح" });
    },
    onError: (err: any) => {
      toast({
        title: "خطأ",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // استخراج رقم الصورة ثم الحذف
  const handleDelete = (url: string) => {
    if (!confirm("هل تريد حذف هذه الصورة؟")) return;

    const fileName = url.split("/").pop(); // 3.jpg
    const index = Number(fileName?.replace(".jpg", ""));

    if (isNaN(index)) {
      toast({
        title: "خطأ",
        description: "تعذر تحديد رقم الصورة",
        variant: "destructive",
      });
      return;
    }

    deleteMutation.mutate(index);
  };

  /* ==========================================================
     واجهة الصفحة
  ============================================================*/
  if (sessionLoading || r2Loading)
    return <div className="p-6 text-center">جاري التحميل…</div>;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-[#4a3b2a]">إدارة الصور</h1>

        {/* ========== الصور الحالية ========== */}
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">
            الصور الحالية ({r2Images.length}/15)
          </h2>

          {r2Images.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {r2Images.map((url: string, i: number) => (
                <div key={i} className="relative group">
                  <img
                    src={url}
                    className="w-full h-48 object-cover rounded-lg"
                  />

                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 rounded-lg transition">
                    <a
                      href={url}
                      target="_blank"
                      className="p-2 bg-blue-500 text-white rounded-full"
                    >
                      <ExternalLink />
                    </a>

                    <button
                      className="p-2 bg-red-500 text-white rounded-full"
                      onClick={() => handleDelete(url)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-muted-foreground">
              لا توجد صور مرفوعة
            </div>
          )}
        </Card>

        {/* ========== رفع صور جديدة ========== */}
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">رفع صور جديدة</h2>

          <div className="border-2 border-dashed p-8 text-center rounded-lg">
            <Upload className="w-12 h-12 mx-auto mb-3 text-[#b88d2b]" />

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleSelectFiles}
            />

            <Button
              className="bg-[#b88d2b]"
              onClick={() => fileInputRef.current?.click()}
            >
              اختر الصور
            </Button>
          </div>

          {previewUrls.length > 0 && (
            <>
              <h3 className="mt-4 font-semibold">
                الصور المختارة ({previewUrls.length})
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                {previewUrls.map((url, i) => (
                  <div key={i} className="relative">
                    <img
                      src={url}
                      className="w-full h-48 object-cover rounded-lg"
                    />
                    <button
                      className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1"
                      onClick={() => {
                        URL.revokeObjectURL(url);
                        setPreviewUrls((p) => p.filter((_, x) => x !== i));
                        setSelectedFiles((p) => p.filter((_, x) => x !== i));
                      }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <Button
                className="w-full mt-4 bg-[#b88d2b]"
                onClick={() => uploadMutation.mutate(selectedFiles)}
              >
                رفع {selectedFiles.length} صورة
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
