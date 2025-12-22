import { useParams, useLocation } from "wouter";
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, ExternalLink, X, Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminImagesPage() {
  const { propertyNumber } = useParams(); // ← رقم العقار من الرابط
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string[]>([]);

  // ============================
  // 1) جلب صور العقار
  // ============================
  const {
    data: r2Data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-r2-images", propertyNumber],
    queryFn: async () => {
      const res = await fetch(`/api/admin/r2-images/${propertyNumber}`);
      if (!res.ok) throw new Error("فشل في جلب الصور");
      return res.json();
    },
  });

  const images = r2Data?.images || [];

  // ============================
  // 2) اختيار صور
  // ============================
  const handleSelect = (e: any) => {
    const files = Array.from(e.target.files);
    setSelectedFiles(files);
    setPreview(files.map((f) => URL.createObjectURL(f)));
  };

  // ============================
  // 3) رفع صور
  // ============================
  const uploadMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      selectedFiles.forEach((f) => fd.append("images", f));

      const res = await fetch(`/api/admin/r2-images/${propertyNumber}`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) throw new Error("فشل في رفع الصور");

      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم رفع الصور ✓" });
      setSelectedFiles([]);
      setPreview([]);
      refetch();
    },
    onError: (err: any) => {
      toast({
        title: "خطأ",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ============================
  // 4) حذف صورة
  // ============================
  const deleteMutation = useMutation({
    mutationFn: async (index: number) => {
      const res = await fetch(
        `/api/admin/r2-images/${propertyNumber}/${index}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("فشل في الحذف");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم حذف الصورة ✓" });
      refetch();
    },
  });

  const handleDelete = (url: string) => {
    const file = url.split("/").pop(); // example: 3.jpg
    const index = Number(file?.replace(".jpg", ""));

    deleteMutation.mutate(index);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto" dir="rtl">
      <button
        onClick={() => setLocation("/admin")}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary/10 text-primary border border-primary/30 rounded-lg hover:bg-primary/20 transition"
        data-testid="button-back-admin"
      >
        <ArrowRight className="w-4 h-4" />
        رجوع للوحة التحكم
      </button>

      <h1 className="text-xl font-bold">📸 إدارة صور العقار رقم {propertyNumber}</h1>

      {/* صور R2 */}
      <Card className="p-4">
        <h2 className="font-bold mb-3">الصور الحالية</h2>

        {isLoading ? (
          <p className="text-center py-6">جاري التحميل...</p>
        ) : images.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">
            لا توجد صور لهذا العقار
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {images.map((url, i) => (
              <div key={i} className="relative group">
                <img src={url} className="w-full h-48 object-cover rounded-lg" />

                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 text-white rounded-lg transition">
                  <a href={url} target="_blank" className="p-2 bg-blue-600 rounded-full">
                    <ExternalLink />
                  </a>

                  <button
                    onClick={() => handleDelete(url)}
                    className="p-2 bg-red-600 rounded-full"
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* رفع صور جديدة */}
      <Card className="p-4">
        <h2 className="font-bold mb-3">رفع صور جديدة</h2>

        <div className="border-2 border-dashed p-8 rounded-lg text-center">
          <Upload className="w-10 h-10 text-primary mx-auto mb-3" />

          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleSelect}
          />

          <Button onClick={() => fileInput.current?.click()}>اختر الصور</Button>
        </div>

        {preview.length > 0 && (
          <>
            <h3 className="mt-4 font-semibold">الصور المحددة ({preview.length})</h3>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 my-3">
              {preview.map((url, i) => (
                <div key={i} className="relative">
                  <img src={url} className="w-full h-48 object-cover rounded-lg" />
                  <button
                    className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1"
                    onClick={() => {
                      URL.revokeObjectURL(url);
                      setSelectedFiles((files) => files.filter((_, x) => x !== i));
                      setPreview((prev) => prev.filter((_, x) => x !== i));
                    }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <Button
              className="w-full mt-3 bg-primary"
              disabled={uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
            >
              رفع {selectedFiles.length} صورة
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
