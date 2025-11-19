import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Property } from "@shared/schema";
import { Upload, X, ExternalLink, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function OwnerImagesPage() {
  const [, setLocation] = useLocation();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Protect page - redirect to login if not authenticated
  useEffect(() => {
    fetch('/api/owner/session')
      .then(res => res.json())
      .then(data => {
        if (!data.isLoggedIn) {
          setLocation('/owner/login');
        }
      })
      .catch(() => setLocation('/owner/login'));
  }, [setLocation]);

  const { data: property, isLoading } = useQuery<Property>({
    queryKey: ['/api/owner/property'],
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach(file => formData.append('images', file));
      
      // Use fetch directly for FormData (apiRequest doesn't support it)
      const response = await fetch('/api/owner/images', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل رفع الصور');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/owner/property'] });
      setSelectedFiles([]);
      setPreviewUrls([]);
      toast({
        title: "تم رفع الصور بنجاح",
        description: "تم إضافة الصور إلى ملف العقار",
      });
    },
    onError: (error: any) => {
      toast({
        title: "فشل رفع الصور",
        description: error.message || "حدث خطأ أثناء رفع الصور",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    const currentCount = property?.imageUrls.length || 0;
    const newCount = imageFiles.length;
    const totalCount = currentCount + newCount;
    
    if (totalCount > 15) {
      toast({
        title: "تجاوز الحد الأقصى",
        description: `الحد الأقصى 15 صورة. لديك ${currentCount} صورة، يمكنك إضافة ${15 - currentCount} صورة فقط`,
        variant: "destructive",
      });
      return;
    }

    setSelectedFiles(imageFiles);
    
    // Create preview URLs
    const urls = imageFiles.map(file => URL.createObjectURL(file));
    setPreviewUrls(urls);
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    const newUrls = previewUrls.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(newUrls);
  };

  const handleUpload = () => {
    if (selectedFiles.length > 0) {
      uploadMutation.mutate(selectedFiles);
    }
  };

  // Delete image mutation
  const deleteMutation = useMutation({
    mutationFn: async (imageUrl: string) => {
      console.log('Attempting to delete image:', imageUrl);
      const response = await fetch('/api/owner/images/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
        credentials: 'include',
      });
      
      console.log('Delete response status:', response.status);
      
      if (!response.ok) {
        const error = await response.text();
        console.error('Delete error:', error);
        throw new Error(error || 'فشل حذف الصورة');
      }
      
      const result = await response.json();
      console.log('Delete successful:', result);
      return result;
    },
    onSuccess: (data) => {
      console.log('Delete mutation success, invalidating queries');
      queryClient.invalidateQueries({ queryKey: ['/api/owner/property'] });
      toast({
        title: "تم حذف الصورة",
        description: "تم حذف الصورة بنجاح",
      });
    },
    onError: (error: any) => {
      console.error('Delete mutation error:', error);
      toast({
        title: "فشل حذف الصورة",
        description: error.message || "حدث خطأ أثناء حذف الصورة",
        variant: "destructive",
      });
    },
  });

  const handleDeleteImage = async (e: React.MouseEvent, imageUrl: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('Delete button clicked for:', imageUrl);
    
    if (window.confirm('هل أنت متأكد من حذف هذه الصورة؟')) {
      console.log('User confirmed deletion');
      deleteMutation.mutate(imageUrl);
    } else {
      console.log('User cancelled deletion');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">جاري التحميل...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-[#4a3b2a] mb-2">إدارة الصور</h1>
          <p className="text-muted-foreground">رفع وإدارة صور العقار</p>
        </div>

        {/* Current Images */}
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">الصور الحالية ({property?.imageUrls.length || 0}/15)</h2>
          
          {property?.imageUrls && property.imageUrls.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {property.imageUrls.map((url, idx) => (
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
                      title="فتح الصورة"
                    >
                      <ExternalLink className="w-5 h-5" />
                    </a>
                    <button
                      onClick={(e) => handleDeleteImage(e, url)}
                      disabled={deleteMutation.isPending}
                      className="text-white bg-red-500 hover:bg-red-600 rounded-full p-2 disabled:opacity-50 cursor-pointer"
                      title="حذف الصورة"
                      data-testid={`button-delete-image-${idx}`}
                      type="button"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد صور مرفوعة حالياً
            </div>
          )}
        </Card>

        {/* Upload New Images */}
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">رفع صور جديدة</h2>
          
          <div className="space-y-4">
            {/* File Input */}
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-[#b88d2b]" />
              <p className="text-lg font-semibold mb-2">اختر الصور للرفع</p>
              <p className="text-sm text-muted-foreground mb-4">
                الحد الأقصى 15 صورة (PNG, JPG, JPEG)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                disabled={uploadMutation.isPending}
                data-testid="input-select-images"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-[#b88d2b] hover:bg-[#a07d25]"
                disabled={uploadMutation.isPending}
                data-testid="button-select-images"
              >
                اختر الصور
              </Button>
            </div>

            {/* Preview Selected Images */}
            {selectedFiles.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold">الصور المختارة ({selectedFiles.length})</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {previewUrls.map((url, idx) => (
                    <div key={idx} className="relative">
                      <img
                        src={url}
                        alt={`معاينة ${idx + 1}`}
                        className="w-full h-48 object-cover rounded-lg"
                      />
                      <button
                        onClick={() => removeFile(idx)}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                        data-testid={`button-remove-image-${idx}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {selectedFiles[idx].name}
                      </p>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending}
                  className="w-full bg-[#b88d2b] hover:bg-[#a07d25]"
                  data-testid="button-upload-images"
                >
                  {uploadMutation.isPending ? 'جاري الرفع...' : `رفع ${selectedFiles.length} صورة`}
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Instructions */}
        <Card className="p-6 bg-[#fffdf0] border-[#e0c97b]">
          <h3 className="font-bold mb-2 text-[#4a3b2a] flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            ملاحظات هامة:
          </h3>
          <ul className="list-disc list-inside space-y-1 text-sm text-[#5b4a1f]">
            <li>يمكنك رفع حتى 15 صور للعقار</li>
            <li>الصور المدعومة: JPG, PNG, JPEG</li>
            <li>يتم رفع الصور مباشرة إلى Google Drive</li>
            <li>سيتم عرض الصور في صفحة العقار تلقائياً</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
