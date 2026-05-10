"use client";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  FileText,
  Calendar,
  ExternalLink,
  Image as ImageIcon,
  Save,
  X,
} from "lucide-react";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  author: string;
  status: string;
  publishedAt: string;
  createdAt: string;
}

function generateSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\u0621-\u064A\u0660-\u0669a-z0-9-]/g, "")
    .substring(0, 50);
}

export default function AdminBlogSection() {
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    excerpt: "",
    content: "",
    coverImage: "",
    metaTitle: "",
    metaDescription: "",
    keywords: "",
    author: "روقان",
    status: "مسودة",
  });

  const { data: posts, isLoading } = useQuery<BlogPost[]>({
    queryKey: ["/api/admin/blog"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/admin/blog", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog"] });
      toast({ title: "تم إنشاء المقال بنجاح" });
      closeForm();
    },
    onError: () => {
      toast({ title: "فشل في إنشاء المقال", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PUT", `/api/admin/blog/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog"] });
      toast({ title: "تم تحديث المقال بنجاح" });
      closeForm();
    },
    onError: () => {
      toast({ title: "فشل في تحديث المقال", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/blog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog"] });
      toast({ title: "تم حذف المقال بنجاح" });
    },
    onError: () => {
      toast({ title: "فشل في حذف المقال", variant: "destructive" });
    },
  });

  const openNewForm = () => {
    setEditingPost(null);
    setFormData({
      title: "",
      slug: "",
      excerpt: "",
      content: "",
      coverImage: "",
      metaTitle: "",
      metaDescription: "",
      keywords: "",
      author: "روقان",
      status: "مسودة",
    });
    setIsFormOpen(true);
  };

  const openEditForm = (post: BlogPost) => {
    setEditingPost(post);
    setFormData({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || "",
      content: post.content,
      coverImage: post.coverImage || "",
      metaTitle: post.metaTitle || "",
      metaDescription: post.metaDescription || "",
      keywords: post.keywords?.join(", ") || "",
      author: post.author || "روقان",
      status: post.status || "مسودة",
    });
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingPost(null);
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) {
      toast({ title: "يرجى إدخال عنوان المقال", variant: "destructive" });
      return;
    }

    const slug = formData.slug || generateSlug(formData.title);
    const data = {
      ...formData,
      slug,
      keywords: formData.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    };

    if (editingPost) {
      updateMutation.mutate({ id: editingPost.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = (post: BlogPost) => {
    if (confirm(`هل أنت متأكد من حذف المقال "${post.title}"؟`)) {
      deleteMutation.mutate(post.id);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString("ar-SA");
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">إدارة المدونة</h2>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">إدارة المدونة</h2>
        <Button onClick={openNewForm} data-testid="button-new-post">
          <Plus className="w-4 h-4 ml-2" />
          مقال جديد
        </Button>
      </div>

      {!posts || posts.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">لا توجد مقالات حالياً</p>
          <Button onClick={openNewForm} className="mt-4">
            إنشاء أول مقال
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <Card key={post.id} className="p-4">
              <div className="flex items-start gap-4">
                {post.coverImage ? (
                  <div className="relative group">
                    <img
                      src={post.coverImage}
                      alt={post.title}
                      className="w-24 h-24 object-cover rounded-lg"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors" />
                  </div>
                ) : (
                  <div className="w-24 h-24 bg-muted rounded-lg flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground truncate">
                      {post.title}
                    </h3>
                    <Badge
                      variant={post.status === "منشور" ? "default" : "secondary"}
                    >
                      {post.status}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                    {post.excerpt || "بدون مقتطف"}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(post.createdAt)}
                    </span>
                    <span>/blog/{post.slug}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {post.status === "منشور" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => window.open(`/blog/${post.slug}`, "_blank")}
                      data-testid={`button-view-${post.id}`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditForm(post)}
                    data-testid={`button-edit-${post.id}`}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(post)}
                    data-testid={`button-delete-${post.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPost ? "تعديل المقال" : "مقال جديد"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>العنوان *</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="عنوان المقال"
                  data-testid="input-title"
                />
              </div>

              <div>
                <Label>الرابط الدائم (Slug)</Label>
                <Input
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  placeholder="سيتم توليده تلقائياً"
                  dir="ltr"
                  data-testid="input-slug"
                />
              </div>

              <div>
                <Label>الحالة</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData({ ...formData, status: v })}
                >
                  <SelectTrigger data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="مسودة">مسودة</SelectItem>
                    <SelectItem value="منشور">منشور</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2">
                <Label>المقتطف</Label>
                <Textarea
                  value={formData.excerpt}
                  onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
                  placeholder="وصف قصير للمقال (يظهر في القائمة)"
                  rows={2}
                  data-testid="input-excerpt"
                />
              </div>

              <div className="col-span-2">
                <Label>المحتوى *</Label>
                <Textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="محتوى المقال (يدعم HTML)"
                  rows={8}
                  data-testid="input-content"
                />
              </div>

              <div className="col-span-2">
                <Label>رابط صورة الغلاف</Label>
                <Input
                  value={formData.coverImage}
                  onChange={(e) => setFormData({ ...formData, coverImage: e.target.value })}
                  placeholder="https://..."
                  dir="ltr"
                  data-testid="input-cover"
                />
              </div>

              <div>
                <Label>عنوان SEO</Label>
                <Input
                  value={formData.metaTitle}
                  onChange={(e) => setFormData({ ...formData, metaTitle: e.target.value })}
                  placeholder="العنوان في محركات البحث"
                  data-testid="input-meta-title"
                />
              </div>

              <div>
                <Label>الكاتب</Label>
                <Input
                  value={formData.author}
                  onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                  placeholder="اسم الكاتب"
                  data-testid="input-author"
                />
              </div>

              <div className="col-span-2">
                <Label>وصف SEO</Label>
                <Textarea
                  value={formData.metaDescription}
                  onChange={(e) => setFormData({ ...formData, metaDescription: e.target.value })}
                  placeholder="الوصف في محركات البحث (150-160 حرف)"
                  rows={2}
                  data-testid="input-meta-desc"
                />
              </div>

              <div className="col-span-2">
                <Label>الكلمات المفتاحية</Label>
                <Input
                  value={formData.keywords}
                  onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                  placeholder="كلمة1, كلمة2, كلمة3"
                  data-testid="input-keywords"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  افصل بين الكلمات بفاصلة
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={closeForm}>
                <X className="w-4 h-4 ml-2" />
                إلغاء
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-post"
              >
                <Save className="w-4 h-4 ml-2" />
                {editingPost ? "تحديث" : "إنشاء"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
