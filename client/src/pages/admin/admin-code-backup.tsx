import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Download,
  RotateCcw,
  Trash2,
  Plus,
  Code2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import type { CodeBackup } from "@shared/schema";

export default function AdminCodeBackup() {
  const { toast } = useToast();

  // Fetch code backups
  const { data: backups = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/code-backup/list"],
    queryFn: async () => {
      const res = await fetch("/api/code-backup/list");
      if (!res.ok) throw new Error("Failed to fetch backups");
      return res.json() as Promise<CodeBackup[]>;
    },
    refetchInterval: 5000,
  });

  // Create code backup mutation
  const createBackupMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/code-backup/create", {});
    },
    onSuccess: () => {
      toast({ title: "تم إنشاء النسخة الاحتياطية من الأكواد بنجاح" });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في إنشاء النسخة",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // Restore code backup mutation
  const restoreMutation = useMutation({
    mutationFn: async (backupId: string) => {
      return apiRequest("POST", `/api/code-backup/${backupId}/restore`, {});
    },
    onSuccess: (data: any) => {
      toast({
        title: "تمت استعادة الأكواس بنجاح",
        description: `تم استعادة ${data.restoredCount} ملف من أصل ${data.totalCount}`,
      });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في استعادة الأكواس",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // Delete code backup mutation
  const deleteMutation = useMutation({
    mutationFn: async (backupId: string) => {
      return apiRequest("DELETE", `/api/code-backup/${backupId}`, {});
    },
    onSuccess: () => {
      toast({ title: "تم حذف النسخة الاحتياطية" });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في حذف النسخة",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // Download backup
  const handleDownload = (backupId: string) => {
    const link = document.createElement("a");
    link.href = `/api/code-backup/${backupId}/download`;
    link.download = `code-backup-${Date.now()}.json`;
    link.click();
    toast({ title: "تم تحميل النسخة الاحتياطية" });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-right flex items-center gap-2">
            <Code2 className="w-8 h-8" />
            نسخ احتياطية الأكواس
          </h1>
          <p className="text-gray-600 text-right">
            نسخ احتياطية آمنة من جميع ملفات البرنامج - استعادة فورية عند الحاجة
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => createBackupMutation.mutate()}
          disabled={createBackupMutation.isPending}
          data-testid="button-create-code-backup"
          className="whitespace-nowrap"
        >
          <Plus className="w-4 h-4 mr-2" />
          {createBackupMutation.isPending ? "جاري الإنشاء..." : "نسخة احتياطية جديدة"}
        </Button>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
        <div className="flex gap-3">
          <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-blue-900 dark:text-blue-100">معلومة مهمة</p>
            <p className="text-sm text-blue-800 dark:text-blue-300 mt-1">
              في حالة حدوث مشكلة في الأكواد أو حدوث خلل، يمكنك استعادة جميع الملفات من النسخة الاحتياطية بنقرة زر واحدة.
            </p>
          </div>
        </div>
      </div>

      {/* Backups List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8">جاري التحميل...</div>
        ) : backups.length === 0 ? (
          <Card className="p-8 text-center">
            <Code2 className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">لم يتم إنشاء أي نسخ احتياطية من الأكواس بعد</p>
            <p className="text-sm text-gray-500 mt-2">اضغط على "نسخة احتياطية جديدة" لإنشاء أول نسخة</p>
          </Card>
        ) : (
          backups.map((backup) => (
            <Card
              key={backup.id}
              className="p-4 hover-elevate"
              data-testid={`card-code-backup-${backup.id}`}
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <h3 className="font-semibold text-right break-words flex-1">
                      {backup.backupName}
                    </h3>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>
                      التاريخ:{" "}
                      {new Date(backup.createdAt).toLocaleString("en-US", { timeZone: 'UTC' })}
                    </p>
                    <p>
                      الملفات: {backup.fileCount} | الحجم: {backup.totalSize.toFixed(2)} MB
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="outline">client</Badge>
                      <Badge variant="outline">server</Badge>
                      <Badge variant="outline">shared</Badge>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 md:ml-4 flex-shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDownload(backup.id)}
                    title="تحميل"
                    data-testid={`button-download-code-${backup.id}`}
                  >
                    <Download className="w-4 h-4" />
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="استعادة"
                        data-testid={`button-restore-code-${backup.id}`}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent dir="rtl">
                      <AlertDialogHeader>
                        <AlertDialogTitle>استعادة الأكواس</AlertDialogTitle>
                        <AlertDialogDescription>
                          هل أنت متأكد من رغبتك في استعادة جميع الملفات من هذه النسخة الاحتياطية؟
                          سيتم الكتابة فوق الملفات الحالية.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded p-3 my-4">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                          ⚠️ هذه عملية حساسة. تأكد من أنك تريد استعادة هذه النسخة قبل المتابعة.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <AlertDialogCancel>إلغاء</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => restoreMutation.mutate(backup.id)}
                          disabled={restoreMutation.isPending}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {restoreMutation.isPending ? "جاري الاستعادة..." : "نعم، استعيد الأكواس"}
                        </AlertDialogAction>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>

                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(backup.id)}
                    disabled={deleteMutation.isPending}
                    title="حذف"
                    data-testid={`button-delete-code-${backup.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Statistics */}
      {backups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <Card className="p-4">
            <p className="text-gray-600 text-sm">إجمالي النسخ</p>
            <p className="text-3xl font-bold mt-2">{backups.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-gray-600 text-sm">إجمالي الملفات</p>
            <p className="text-3xl font-bold mt-2">
              {backups.reduce((sum, b) => sum + b.fileCount, 0)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-gray-600 text-sm">آخر نسخة</p>
            <p className="text-sm mt-2">
              {new Date(backups[0]?.createdAt).toLocaleString("en-US", { timeZone: 'UTC' })}
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
