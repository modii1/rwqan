"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Building2, Plus, Trash2, Edit2, Save, X, Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BankAccount {
  id: string;
  bankName: string;
  beneficiaryName: string;
  iban: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt?: string;
}

export default function BankAccountsSection() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<BankAccount>>({});
  const [newAccount, setNewAccount] = useState<Partial<BankAccount>>({
    bankName: "",
    beneficiaryName: "",
    iban: "",
    isActive: true,
    isDefault: false,
  });

  const { data: accounts = [], isLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/admin/bank-accounts"],
  });

  const createMutation = useMutation({
    mutationFn: async (account: Partial<BankAccount>) => {
      const res = await apiRequest("POST", "/api/admin/bank-accounts", account);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bank-accounts"] });
      toast({ title: "تم الإضافة", description: "تم إضافة الحساب البنكي بنجاح" });
      setIsAddOpen(false);
      setNewAccount({
        bankName: "",
        beneficiaryName: "",
        iban: "",
        isActive: true,
        isDefault: false,
      });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<BankAccount> }) => {
      const res = await apiRequest("PUT", `/api/admin/bank-accounts/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bank-accounts"] });
      toast({ title: "تم التحديث", description: "تم تحديث الحساب البنكي بنجاح" });
      setEditingId(null);
      setEditData({});
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/bank-accounts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bank-accounts"] });
      toast({ title: "تم الحذف", description: "تم حذف الحساب البنكي بنجاح" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const handleEdit = (account: BankAccount) => {
    setEditingId(account.id);
    setEditData({ ...account });
  };

  const handleSave = () => {
    if (editingId && editData) {
      updateMutation.mutate({ id: editingId, updates: editData });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditData({});
  };

  const handleToggleActive = (account: BankAccount) => {
    updateMutation.mutate({
      id: account.id,
      updates: { isActive: !account.isActive },
    });
  };

  const handleSetDefault = (account: BankAccount) => {
    updateMutation.mutate({
      id: account.id,
      updates: { isDefault: true },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl" data-testid="bank-accounts-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold">الحسابات البنكية</h2>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button variant="default" size="sm" data-testid="button-add-bank-account">
              <Plus className="h-4 w-4 ml-1" />
              إضافة حساب
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]" dir="rtl">
            <DialogHeader>
              <DialogTitle>إضافة حساب بنكي جديد</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <Label>اسم البنك</Label>
                <Input
                  value={newAccount.bankName || ""}
                  onChange={(e) => setNewAccount(prev => ({ ...prev, bankName: e.target.value }))}
                  placeholder="مثال: البنك الأهلي السعودي"
                  data-testid="input-new-bank-name"
                />
              </div>
              <div>
                <Label>اسم المستفيد</Label>
                <Input
                  value={newAccount.beneficiaryName || ""}
                  onChange={(e) => setNewAccount(prev => ({ ...prev, beneficiaryName: e.target.value }))}
                  placeholder="مثال: مؤسسة روقان"
                  data-testid="input-new-beneficiary"
                />
              </div>
              <div>
                <Label>رقم الآيبان (IBAN)</Label>
                <Input
                  value={newAccount.iban || ""}
                  onChange={(e) => setNewAccount(prev => ({ ...prev, iban: e.target.value.toUpperCase() }))}
                  placeholder="SA0000000000000000000000"
                  className="font-mono text-left"
                  dir="ltr"
                  data-testid="input-new-iban"
                />
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={newAccount.isActive ?? true}
                    onCheckedChange={(checked) => setNewAccount(prev => ({ ...prev, isActive: checked }))}
                    data-testid="switch-new-active"
                  />
                  <Label>نشط</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={newAccount.isDefault ?? false}
                    onCheckedChange={(checked) => setNewAccount(prev => ({ ...prev, isDefault: checked }))}
                    data-testid="switch-new-default"
                  />
                  <Label>افتراضي</Label>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => createMutation.mutate(newAccount)}
                disabled={createMutation.isPending || !newAccount.bankName || !newAccount.beneficiaryName || !newAccount.iban}
                data-testid="button-save-new-account"
              >
                <Plus className="h-4 w-4 ml-1" />
                إضافة الحساب
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            قائمة الحسابات البنكية
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد حسابات بنكية. اضغط على "إضافة حساب" لإضافة حساب جديد.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">اسم البنك</TableHead>
                  <TableHead className="text-right">اسم المستفيد</TableHead>
                  <TableHead className="text-right">رقم الآيبان</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">افتراضي</TableHead>
                  <TableHead className="text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const isEditing = editingId === account.id;

                  return (
                    <TableRow key={account.id} data-testid={`row-bank-account-${account.id}`}>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editData.bankName || ""}
                            onChange={(e) => setEditData(prev => ({ ...prev, bankName: e.target.value }))}
                            className="w-40"
                            data-testid={`input-edit-bank-name-${account.id}`}
                          />
                        ) : (
                          <span className="font-medium">{account.bankName}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editData.beneficiaryName || ""}
                            onChange={(e) => setEditData(prev => ({ ...prev, beneficiaryName: e.target.value }))}
                            className="w-40"
                            data-testid={`input-edit-beneficiary-${account.id}`}
                          />
                        ) : (
                          account.beneficiaryName
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editData.iban || ""}
                            onChange={(e) => setEditData(prev => ({ ...prev, iban: e.target.value.toUpperCase() }))}
                            className="w-56 font-mono text-left"
                            dir="ltr"
                            data-testid={`input-edit-iban-${account.id}`}
                          />
                        ) : (
                          <code className="text-xs bg-muted px-2 py-1 rounded" dir="ltr">
                            {account.iban}
                          </code>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={isEditing ? (editData.isActive ?? account.isActive) : account.isActive}
                          onCheckedChange={(checked) => {
                            if (isEditing) {
                              setEditData(prev => ({ ...prev, isActive: checked }));
                            } else {
                              handleToggleActive(account);
                            }
                          }}
                          data-testid={`switch-active-${account.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        {account.isDefault ? (
                          <Badge variant="default" className="gap-1">
                            <Star className="h-3 w-3" />
                            افتراضي
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSetDefault(account)}
                            disabled={updateMutation.isPending}
                            data-testid={`button-set-default-${account.id}`}
                          >
                            تعيين كافتراضي
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                size="icon"
                                variant="default"
                                onClick={handleSave}
                                disabled={updateMutation.isPending}
                                data-testid={`button-save-${account.id}`}
                              >
                                <Save className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={handleCancel}
                                data-testid={`button-cancel-${account.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={() => handleEdit(account)}
                                data-testid={`button-edit-${account.id}`}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm("هل أنت متأكد من حذف هذا الحساب البنكي؟")) {
                                    deleteMutation.mutate(account.id);
                                  }
                                }}
                                className="text-red-500 hover:text-red-700"
                                data-testid={`button-delete-${account.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
