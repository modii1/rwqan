import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download,
  RotateCcw,
  Trash2,
  Plus,
  Clock,
  CheckCircle,
  AlertCircle,
  HardDrive,
} from "lucide-react";
import type { Backup } from "@shared/schema";

export default function AdminBackup() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [backupType, setBackupType] = useState<string>("كامل");
  const [backupName, setBackupName] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "properties",
    "subscriptions",
    "packages",
  ]);

  // Fetch backups
  const { data: backups = [], isLoading } = useQuery({
    queryKey: ["/api/backups"],
    queryFn: async () => {
      const res = await fetch("/api/backups");
      if (!res.ok) throw new Error("Failed to fetch backups");
      return res.json() as Promise<Backup[]>;
    },
    refetchInterval: 5000,
  });

  // Create backup mutation
  const createBackupMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/backups", {
        backupType,
        backupName: backupName || `نسخة احتياطية ${new Date().toLocaleString("en-US", { timeZone: 'UTC' })}`,
        dataTypes: selectedTypes,
        description: `نسخة احتياطية ${backupType} للبيانات المهمة`,
      });
    },
    onSuccess: () => {
      toast({ title: "تم إنشاء النسخة الاحتياطية بنجاح" });
      setBackupName("");
      setIsOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في إنشاء النسخة الاحتياطية",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // Restore backup mutation
  const restoreMutation = useMutation({
    mutationFn: async (backupId: string) => {
      return apiRequest("POST", `/api/backups/${backupId}/restore`, {});
    },
    onSuccess: () => {
      toast({ title: "تمت استعادة النسخة الاحتياطية بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في استعادة النسخة",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // Delete backup mutation
  const deleteMutation = useMutation({
    mutationFn: async (backupId: string) => {
      return apiRequest("DELETE", `/api/backups/${backupId}`, {});
    },
    onSuccess: () => {
      toast({ title: "تم حذف النسخة الاحتياطية" });
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
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
  const handleDownload = (backupId: string, backupName: string) => {
    const link = document.createElement("a");
    link.href = `/api/backups/${backupId}/download`;
    link.download = `backup-${backupName}-${Date.now()}.json`;
    link.click();
    toast({ title: "تم تحميل النسخة الاحتياطية" });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "مكتمل":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "جاري":
        return <Clock className="w-4 h-4 text-blue-600 animate-spin" />;
      case "فشل":
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case "استعادة":
        return <RotateCcw className="w-4 h-4 text-purple-600" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      "مكتمل": "default",
      "جاري": "secondary",
      "فشل": "destructive",
      "استعادة": "outline",
    };
    return variants[status] || "default";
  };

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 text-right">نظام النسخ الاحتياطية</h1>
        <p className="text-gray-600 text-right">
          إدارة احترافية وآمنة للنسخ الاحتياطية للبيانات المهمة
        </p>
      </div>

      {/* Create Backup Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button size="lg" className="mb-6" data-testid="button-create-backup">
            <Plus className="w-4 h-4 mr-2" />
            إنشاء نسخة احتياطية جديدة
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إنشاء نسخة احتياطية</DialogTitle>
            <DialogDescription>
              قم بإنشاء نسخة احتياطية من البيانات المهمة
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="backup-name">اسم النسخة (اختياري)</Label>
              <Input
                id="backup-name"
                placeholder="مثال: نسخة نهاية الشهر"
                value={backupName}
                onChange={(e) => setBackupName(e.target.value)}
                data-testid="input-backup-name"
              />
            </div>

            <div>
              <Label htmlFor="backup-type">نوع النسخة</Label>
              <Select value={backupType} onValueChange={setBackupType}>
                <SelectTrigger id="backup-type" data-testid="select-backup-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="كامل">نسخة احتياطية كاملة</SelectItem>
                  <SelectItem value="جزئي">نسخة احتياطية جزئية</SelectItem>
                  <SelectItem value="يومي">نسخة يومية</SelectItem>
                  <SelectItem value="أسبوعي">نسخة أسبوعية</SelectItem>
                  <SelectItem value="شهري">نسخة شهرية</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>نوع البيانات المراد نسخها</Label>
              <div className="space-y-2 mt-2">
                {[
                  { id: "properties", label: "العقارات" },
                  { id: "subscriptions", label: "الاشتراكات" },
                  { id: "packages", label: "الباقات" },
                  { id: "payments", label: "المدفوعات" },
                  { id: "discounts", label: "أكواد الخصم" },
                  { id: "requests", label: "الطلبات" },
                ].map((type) => (
                  <div key={type.id} className="flex items-center gap-2">
                    <Checkbox
                      id={type.id}
                      checked={selectedTypes.includes(type.id)}
                      onCheckedChange={(checked) => {
                        setSelectedTypes(
                          checked
                            ? [...selectedTypes, type.id]
                            : selectedTypes.filter((t) => t !== type.id)
                        );
                      }}
                      data-testid={`checkbox-backup-${type.id}`}
                    />
                    <Label htmlFor={type.id} className="cursor-pointer">
                      {type.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={() => createBackupMutation.mutate()}
              disabled={createBackupMutation.isPending || selectedTypes.length === 0}
              className="w-full"
              data-testid="button-confirm-backup"
            >
              {createBackupMutation.isPending ? "جاري الإنشاء..." : "إنشاء النسخة"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Backups List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8">جاري التحميل...</div>
        ) : backups.length === 0 ? (
          <Card className="p-8 text-center">
            <HardDrive className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">لم يتم إنشاء أي نسخ احتياطية بعد</p>
          </Card>
        ) : (
          backups.map((backup) => (
            <Card
              key={backup.id}
              className="p-4 hover-elevate"
              data-testid={`card-backup-${backup.id}`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {getStatusIcon(backup.status)}
                    <h3 className="font-semibold text-right truncate">
                      {backup.backupName}
                    </h3>
                    <Badge variant={getStatusBadge(backup.status)}>
                      {backup.status}
                    </Badge>
                    <Badge variant="outline">{backup.backupType}</Badge>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>
                      التاريخ:{" "}
                      {new Date(backup.createdAt).toLocaleString("en-US", { timeZone: 'UTC' })}
                    </p>
                    <p>
                      الحجم: {backup.sizeInMB.toFixed(2)} MB | الملفات:{" "}
                      {backup.filesCount}
                    </p>
                    <p>
                      البيانات: {backup.dataTypes.join(", ")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDownload(backup.id, backup.backupName)}
                    title="تحميل"
                    data-testid={`button-download-${backup.id}`}
                  >
                    <Download className="w-4 h-4" />
                  </Button>

                  {backup.status === "مكتمل" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => restoreMutation.mutate(backup.id)}
                      disabled={restoreMutation.isPending}
                      title="استعادة"
                      data-testid={`button-restore-${backup.id}`}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}

                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(backup.id)}
                    disabled={deleteMutation.isPending}
                    title="حذف"
                    data-testid={`button-delete-${backup.id}`}
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
            <p className="text-gray-600 text-sm">الحجم الكلي</p>
            <p className="text-3xl font-bold mt-2">
              {backups.reduce((sum, b) => sum + b.sizeInMB, 0).toFixed(2)} MB
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
