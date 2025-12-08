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
import { Settings2, Save, RotateCcw, Calculator, Percent, DollarSign, Plus, Trash2, CreditCard } from "lucide-react";
import type { FeeConfig } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function FeeConfigsSection() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedConfigs, setEditedConfigs] = useState<Record<string, Partial<FeeConfig>>>({});
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newConfig, setNewConfig] = useState<Partial<FeeConfig>>({
    name: "",
    nameEn: "",
    percentage: 2.7,
    fixedFee: 1,
    vatRate: 15,
    isActive: true,
    isLocal: true,
  });
  
  const [testAmount, setTestAmount] = useState<number>(35);
  const [testMethod, setTestMethod] = useState<string>("card");
  const [testCardType, setTestCardType] = useState<string>("visa-local");

  const { data: configs = [], isLoading } = useQuery<FeeConfig[]>({
    queryKey: ["/api/admin/fee-configs"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<FeeConfig> }) => {
      const res = await apiRequest("PUT", `/api/admin/fee-configs/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-configs"] });
      toast({ title: "تم الحفظ", description: "تم تحديث إعدادات الرسوم بنجاح" });
      setEditingId(null);
      setEditedConfigs({});
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (config: Partial<FeeConfig>) => {
      const res = await apiRequest("POST", "/api/admin/fee-configs", config);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-configs"] });
      toast({ title: "تم الإضافة", description: "تم إضافة وسيلة دفع جديدة بنجاح" });
      setIsAddOpen(false);
      setNewConfig({
        name: "",
        nameEn: "",
        percentage: 2.7,
        fixedFee: 1,
        vatRate: 15,
        isActive: true,
        isLocal: true,
      });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/fee-configs/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-configs"] });
      toast({ title: "تم الحذف", description: "تم حذف وسيلة الدفع بنجاح" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const initializeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/fee-configs/initialize");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-configs"] });
      toast({ title: "تم", description: "تم تهيئة الرسوم الافتراضية" });
    },
  });

  const calculateFeesMutation = useMutation({
    mutationFn: async ({ amount, paymentMethod, cardType }: { amount: number; paymentMethod: string; cardType: string }) => {
      const res = await apiRequest("POST", "/api/admin/calculate-fees", {
        amount,
        paymentMethod,
        cardType,
        useConfigs: true,
      });
      return res.json();
    },
  });

  const handleEdit = (id: string) => {
    const config = configs.find(c => c.id === id);
    if (config) {
      setEditingId(id);
      setEditedConfigs({ [id]: { ...config } });
    }
  };

  const handleSave = (id: string) => {
    const updates = editedConfigs[id];
    if (updates) {
      updateMutation.mutate({ id, updates });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditedConfigs({});
  };

  const updateField = (id: string, field: keyof FeeConfig, value: any) => {
    setEditedConfigs(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleTestCalculate = () => {
    calculateFeesMutation.mutate({
      amount: testAmount,
      paymentMethod: testMethod,
      cardType: testCardType,
    });
  };

  const getPaymentMethodIcon = (nameEn: string) => {
    const name = nameEn.toLowerCase();
    if (name.includes("mada")) return "💳";
    if (name.includes("stc")) return "📱";
    if (name.includes("apple")) return "📱";
    return "💳";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-[#b88d2b] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="fee-configs-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-6 w-6 text-[#b88d2b]" />
          <h2 className="text-xl font-bold">إعدادات الرسوم</h2>
        </div>
        <div className="flex gap-2">
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-add-fee-config">
                <Plus className="h-4 w-4 ml-1" />
                إضافة وسيلة دفع
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>إضافة وسيلة دفع جديدة</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>الاسم (عربي)</Label>
                    <Input
                      value={newConfig.name || ""}
                      onChange={(e) => setNewConfig(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="مدى"
                      data-testid="input-new-name"
                    />
                  </div>
                  <div>
                    <Label>الاسم (إنجليزي)</Label>
                    <Input
                      value={newConfig.nameEn || ""}
                      onChange={(e) => setNewConfig(prev => ({ ...prev, nameEn: e.target.value }))}
                      placeholder="Mada"
                      data-testid="input-new-name-en"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>النسبة %</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={newConfig.percentage || 0}
                      onChange={(e) => setNewConfig(prev => ({ ...prev, percentage: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-new-percentage"
                    />
                  </div>
                  <div>
                    <Label>الرسوم الثابتة</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={newConfig.fixedFee || 1}
                      onChange={(e) => setNewConfig(prev => ({ ...prev, fixedFee: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-new-fixed-fee"
                    />
                  </div>
                  <div>
                    <Label>الضريبة %</Label>
                    <Input
                      type="number"
                      value={newConfig.vatRate || 15}
                      onChange={(e) => setNewConfig(prev => ({ ...prev, vatRate: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-new-vat"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={newConfig.isActive ?? true}
                      onCheckedChange={(checked) => setNewConfig(prev => ({ ...prev, isActive: checked }))}
                    />
                    <Label>مفعّل</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={newConfig.isLocal ?? true}
                      onCheckedChange={(checked) => setNewConfig(prev => ({ ...prev, isLocal: checked }))}
                    />
                    <Label>محلي</Label>
                  </div>
                </div>
                <Button 
                  className="w-full bg-[#b88d2b] hover:bg-[#9a7523]"
                  onClick={() => createMutation.mutate(newConfig)}
                  disabled={createMutation.isPending || !newConfig.name || !newConfig.nameEn}
                  data-testid="button-save-new-config"
                >
                  <Plus className="h-4 w-4 ml-1" />
                  إضافة
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          
          {configs.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => initializeMutation.mutate()}
              disabled={initializeMutation.isPending}
              data-testid="button-init-default-fees"
            >
              <RotateCcw className="h-4 w-4 ml-1" />
              تهيئة الافتراضي
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            رسوم وسائل الدفع (Paymob KSA)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="py-3 px-4 text-right font-medium">وسيلة الدفع</th>
                  <th className="py-3 px-4 text-center font-medium">النسبة %</th>
                  <th className="py-3 px-4 text-center font-medium">الرسوم الثابتة</th>
                  <th className="py-3 px-4 text-center font-medium">الضريبة %</th>
                  <th className="py-3 px-4 text-center font-medium">النوع</th>
                  <th className="py-3 px-4 text-center font-medium">الحالة</th>
                  <th className="py-3 px-4 text-center font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((config) => {
                  const isEditing = editingId === config.id;
                  const editData = editedConfigs[config.id] || config;
                  
                  return (
                    <tr key={config.id} className="border-b hover:bg-muted/30" data-testid={`row-fee-config-${config.id}`}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getPaymentMethodIcon(config.nameEn)}</span>
                          <div>
                            {isEditing ? (
                              <div className="flex gap-2">
                                <Input
                                  value={editData.name || ""}
                                  onChange={(e) => updateField(config.id, "name", e.target.value)}
                                  className="w-32 h-8"
                                  data-testid={`input-edit-name-${config.id}`}
                                />
                                <Input
                                  value={editData.nameEn || ""}
                                  onChange={(e) => updateField(config.id, "nameEn", e.target.value)}
                                  className="w-32 h-8"
                                  placeholder="English"
                                  data-testid={`input-edit-name-en-${config.id}`}
                                />
                              </div>
                            ) : (
                              <>
                                <div className="font-medium">{config.name}</div>
                                <div className="text-xs text-muted-foreground">{config.nameEn}</div>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.1"
                            value={editData.percentage ?? config.percentage}
                            onChange={(e) => updateField(config.id, "percentage", parseFloat(e.target.value) || 0)}
                            className="w-20 h-8 text-center mx-auto"
                            data-testid={`input-edit-percentage-${config.id}`}
                          />
                        ) : (
                          <Badge variant="outline">{config.percentage}%</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.5"
                            value={editData.fixedFee ?? config.fixedFee}
                            onChange={(e) => updateField(config.id, "fixedFee", parseFloat(e.target.value) || 0)}
                            className="w-20 h-8 text-center mx-auto"
                            data-testid={`input-edit-fixed-fee-${config.id}`}
                          />
                        ) : (
                          <span>{config.fixedFee} ر.س</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editData.vatRate ?? config.vatRate}
                            onChange={(e) => updateField(config.id, "vatRate", parseFloat(e.target.value) || 0)}
                            className="w-20 h-8 text-center mx-auto"
                            data-testid={`input-edit-vat-${config.id}`}
                          />
                        ) : (
                          <span>{config.vatRate}%</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isEditing ? (
                          <Switch
                            checked={editData.isLocal ?? config.isLocal}
                            onCheckedChange={(checked) => updateField(config.id, "isLocal", checked)}
                          />
                        ) : (
                          <Badge variant={config.isLocal ? "default" : "secondary"}>
                            {config.isLocal ? "محلي" : "دولي"}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isEditing ? (
                          <Switch
                            checked={editData.isActive ?? config.isActive}
                            onCheckedChange={(checked) => updateField(config.id, "isActive", checked)}
                          />
                        ) : (
                          <Badge variant={config.isActive ? "default" : "destructive"}>
                            {config.isActive ? "مفعّل" : "معطّل"}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleSave(config.id)}
                                disabled={updateMutation.isPending}
                                className="bg-[#b88d2b] hover:bg-[#9a7523]"
                                data-testid={`button-save-${config.id}`}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleCancel}
                                data-testid={`button-cancel-${config.id}`}
                              >
                                إلغاء
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(config.id)}
                                data-testid={`button-edit-${config.id}`}
                              >
                                تعديل
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm("هل تريد حذف هذه الإعدادات؟")) {
                                    deleteMutation.mutate(config.id);
                                  }
                                }}
                                className="text-red-500 hover:text-red-700"
                                data-testid={`button-delete-${config.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {configs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد إعدادات رسوم. اضغط على "تهيئة الافتراضي" لإضافة الرسوم الرسمية من Paymob.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            حاسبة الرسوم
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <Label>المبلغ (ر.س)</Label>
              <Input
                type="number"
                value={testAmount}
                onChange={(e) => setTestAmount(parseFloat(e.target.value) || 0)}
                placeholder="35"
                data-testid="input-test-amount"
              />
            </div>
            <div>
              <Label>طريقة الدفع</Label>
              <select
                value={testMethod}
                onChange={(e) => setTestMethod(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2"
                data-testid="select-test-method"
              >
                <option value="card">بطاقة ائتمان</option>
                <option value="apple">Apple Pay</option>
              </select>
            </div>
            <div>
              <Label>نوع البطاقة</Label>
              <select
                value={testCardType}
                onChange={(e) => setTestCardType(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2"
                data-testid="select-test-card-type"
              >
                <option value="mada">مدى</option>
                <option value="visa-local">Visa/Mastercard محلي</option>
                <option value="visa-international">Visa/Mastercard دولي</option>
                <option value="stc">STC Pay</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleTestCalculate}
                disabled={calculateFeesMutation.isPending}
                className="w-full bg-[#b88d2b] hover:bg-[#9a7523]"
                data-testid="button-calculate-fees"
              >
                <Calculator className="h-4 w-4 ml-2" />
                احسب
              </Button>
            </div>
          </div>

          {calculateFeesMutation.data && (
            <div className="mt-6 p-4 bg-muted/50 rounded-lg" data-testid="fees-result">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                نتيجة الحساب ({calculateFeesMutation.data.feeConfigName})
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-background rounded-lg">
                  <div className="text-sm text-muted-foreground">رسوم Paymob</div>
                  <div className="text-lg font-bold text-[#b88d2b]">
                    {calculateFeesMutation.data.feeAmount?.toFixed(2)} ر.س
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ({calculateFeesMutation.data.feePercentage}% + {calculateFeesMutation.data.fixedFee} ر.س)
                  </div>
                </div>
                <div className="text-center p-3 bg-background rounded-lg">
                  <div className="text-sm text-muted-foreground">الضريبة (VAT)</div>
                  <div className="text-lg font-bold text-blue-600">
                    {calculateFeesMutation.data.vatAmount?.toFixed(2)} ر.س
                  </div>
                  <div className="text-xs text-muted-foreground">15%</div>
                </div>
                <div className="text-center p-3 bg-background rounded-lg">
                  <div className="text-sm text-muted-foreground">إجمالي الخصم</div>
                  <div className="text-lg font-bold text-red-500">
                    {calculateFeesMutation.data.totalFees?.toFixed(2)} ر.س
                  </div>
                </div>
                <div className="text-center p-3 bg-background rounded-lg">
                  <div className="text-sm text-muted-foreground">صافي المبلغ</div>
                  <div className="text-lg font-bold text-green-600">
                    {calculateFeesMutation.data.netAmount?.toFixed(2)} ر.س
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            معلومات الرسوم الرسمية
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              الرسوم الافتراضية مبنية على هيكل رسوم Paymob KSA الرسمي:
            </p>
            <ul className="space-y-2 mr-4">
              <li className="flex items-center gap-2">
                <Badge variant="outline">💳 مدى</Badge>
                <span>1% + 1 ر.س + 15% ضريبة</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="outline">💳 Visa/MC محلي</Badge>
                <span>2.7% + 1 ر.س + 15% ضريبة</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="outline">💳 Visa/MC دولي</Badge>
                <span>3.7% + 1 ر.س + 15% ضريبة</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="outline">📱 STC Pay</Badge>
                <span>1% + 1 ر.س + 15% ضريبة</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="outline">🍎 Apple Pay</Badge>
                <span>2.7% + 1 ر.س + 15% ضريبة</span>
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              <strong>ملاحظة:</strong> يمكنك تعديل هذه النسب حسب اتفاقيتك مع Paymob.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
