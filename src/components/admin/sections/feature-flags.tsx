"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Flag, RotateCcw, Loader2, CheckCircle, XCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  isEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export default function FeatureFlagsSection() {
  const { toast } = useToast();

  const { data: flags = [], isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const res = await apiRequest("PUT", `/api/admin/feature-flags/${key}`, { isEnabled: enabled });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      toast({
        title: variables.enabled ? "تم التفعيل" : "تم الإلغاء",
        description: `تم ${variables.enabled ? "تفعيل" : "إلغاء"} الميزة بنجاح`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const initializeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/feature-flags/initialize");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      toast({ title: "تم", description: "تم تهيئة الميزات الافتراضية" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const handleToggle = (flag: FeatureFlag) => {
    updateMutation.mutate({ key: flag.key, enabled: !flag.isEnabled });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const enabledCount = flags.filter(f => f.isEnabled).length;
  const disabledCount = flags.filter(f => !f.isEnabled).length;

  return (
    <div className="space-y-6" dir="rtl" data-testid="feature-flags-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold">أعلام الميزات</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => initializeMutation.mutate()}
          disabled={initializeMutation.isPending}
          data-testid="button-init-feature-flags"
        >
          {initializeMutation.isPending ? (
            <Loader2 className="h-4 w-4 ml-1 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4 ml-1" />
          )}
          تهيئة الافتراضي
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي الميزات</p>
                <p className="text-2xl font-bold">{flags.length}</p>
              </div>
              <Flag className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">ميزات مفعلة</p>
                <p className="text-2xl font-bold text-green-600">{enabledCount}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">ميزات معطلة</p>
                <p className="text-2xl font-bold text-red-600">{disabledCount}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" />
            قائمة الميزات
          </CardTitle>
          <CardDescription>
            تحكم في تفعيل أو إلغاء الميزات في النظام
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد ميزات. اضغط على "تهيئة الافتراضي" لإضافة الميزات الافتراضية.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الميزة</TableHead>
                  <TableHead className="text-right">المفتاح</TableHead>
                  <TableHead className="text-right">الوصف</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">تفعيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((flag) => (
                  <TableRow key={flag.key} data-testid={`row-feature-flag-${flag.key}`}>
                    <TableCell>
                      <span className="font-medium">{flag.name}</span>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded" dir="ltr">
                        {flag.key}
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{flag.description}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={flag.isEnabled ? "default" : "secondary"}>
                        {flag.isEnabled ? "مفعل" : "معطل"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={flag.isEnabled}
                        onCheckedChange={() => handleToggle(flag)}
                        disabled={updateMutation.isPending}
                        data-testid={`switch-feature-${flag.key}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-blue-600" />
            معلومات الاستخدام
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-muted-foreground">
              أعلام الميزات تتيح لك التحكم في تفعيل أو إلغاء ميزات معينة في النظام دون الحاجة لإعادة تشغيل التطبيق.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground list-disc list-inside">
              <li>يمكنك تفعيل أو إلغاء أي ميزة في أي وقت</li>
              <li>التغييرات تطبق فوراً على جميع المستخدمين</li>
              <li>استخدم هذه الميزة لاختبار ميزات جديدة قبل إطلاقها</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
