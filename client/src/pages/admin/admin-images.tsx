import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, ExternalLink, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const R2_BASE = ""; // اختياري فقط إذا أردت استخدامه مباشرة

export default function AdminImagesPage() {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [propertyNumber, setPropertyNumber] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string[]>([]);

  // ==========================================================
  // 1) جلب صور العقار
  // ==========================================================
  const {
    data: r2Data,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["admin-r2-images", propertyNumber],
    queryFn: async () => {
      if (!propertyNumber) return { images: [] };
      const res = await fetch(`/api/admin/r2-images/${propertyNumber}`);
      if (!res.ok) throw new Error("فشل في جلب الصور");
      return res.json();
    },
    enabled: false, // لا يبدأ إلا بعد البحث
  });

  const images = r2Data?.images || [];

  // ==========================================================
  // 2) اختيار صور جديدة
  // ==========================================================
  const handleSelect = (e: any) => {
    const files = Array.from(e.target.files);
    setSelectedFiles(files);
    setPreview(files.map((f) => URL.createObjectURL(f)));
  };

  // ==========================================================
  // 3) رفع صور جديدة
  // ==========================================================
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!propertyNumber) throw new Error("أدخل رقم العقار");

      const fd = new FormData();
      selectedFiles.forEach((f) => fd.append("images", f));

      const res = await fetch(`/api/admin/r2-images/${propertyNumber}`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) throw new Error("فشل في الرفع");

      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم رفع الصور" });
      setSelectedFiles([]);
      setPreview([]);
      refetch();
    },
    onError: (err: any) =>
      toast({
        title: "خطأ",
        description: err.message,
        variant: "destructive",
      }),
  });

  // ==========================================================
  // 4) حذف صورة
  // ==========================================================
  const deleteMutation = useMutation({
    mutationFn: async (index: number) => {
      const res = await fetch(
        `/api/admin/r2-images/${propertyNumber}/${index}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("فشل في حذف الصورة");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم حذف الصورة" });
      refetch();
    },
    onError: (err: any) =>
      toast({
        title: "خطأ",
        description: err.message,
        variant: "destructive",
      }),
  });

  const handleDelete = (url: string) => {
    if (!confirm("هل تريد حذف الصورة؟")) return;

    const file = url.split("/").pop(); // 3.jpg
    const index = Number(file?.replace(".jpg", ""));

    if (!index) {
      toast({
        title: "خطأ",
        description: "لم يتم تحديد رقم الصورة",
        variant: "destructive",
      });
      return;
    }

    deleteMutation.mutate(index);
  };

  // ==========================================================
  // واجهة المستخدم
  // ==========================================================
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto" dir="rtl">
      <h1 className="text-2xl font-bold">📸 إدارة صور العقارات — الأدمن</h1>

      {/* إدخال رقم العقار */}
      <Card className="p-4 flex items-center gap-3">
        <Input
          placeholder="أدخل رقم العقار مثال: 88115"
          className="w-40"
          value={propertyNumber}
          onChange={(e) => setPropertyNumber(e.target.value)}
        />

        <Button onClick={() => refetch()} disabled={!propertyNumber}>
          {isFetching ? <Loader2 className="animate-spin w-4 h-4" /> : "عرض الصور"}
        </Button>
      </Card>

      {/* صور R2 */}
      <Card className="p-4">
        <h2 className="font-bold mb-3">الصور الحالية</h2>

        {images.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">
            لا توجد صور لهذا العقار
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {images.map((url, i) => (
              <div key={i} className="relative group">
                <img src={url} className="w-full h-48 object-cover rounded-lg" />

                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 text-white rounded-lg transition">
                  <a
                    href={url}
                    target="_blank"
                    className="p-2 bg-blue-600 rounded-full"
                  >
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

          <Button onClick={() => fileInput.current?.click()}>
            اختر الصور
          </Button>
        </div>

        {/* معاينة الصور */}
        {preview.length > 0 && (
          <>
            <h3 className="mt-4 font-semibold">
              الصور المحددة ({preview.length})
            </h3>
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
              className="w-full bg-primary"
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
