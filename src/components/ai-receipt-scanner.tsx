"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Scan, CheckCircle2, AlertTriangle, XCircle, 
  Loader2, Shield, Eye, FileCheck, Banknote,
  Calendar, Hash, Building2, RefreshCw
} from "lucide-react";

interface AIScanResult {
  recommendation: 'تفعيل_تلقائي' | 'مراجعة_يدوية' | 'رفض';
  confidence: number;
  summary: string;
  matchScore: number;
  authenticityScore: number;
  extractedAmount?: number;
  extractedDate?: string;
  extractedReference?: string;
  extractedReceiverBank?: string;
  extractedReceiverIban?: string;
  imageQuality?: string;
  isLikelyAuthentic?: boolean;
  concerns?: string[];
  positiveIndicators?: string[];
}

interface AIReceiptScannerProps {
  paymentId: string;
  receiptUrl?: string;
  onScanComplete?: (result: AIScanResult) => void;
  initialResult?: AIScanResult | null;
  autoScan?: boolean;
}

export function AIReceiptScanner({ 
  paymentId, 
  receiptUrl, 
  onScanComplete,
  initialResult,
  autoScan = false 
}: AIReceiptScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<AIScanResult | null>(initialResult || null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!paymentId) return;
    
    setIsScanning(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/owner/payment/${paymentId}/rescan`, {
        method: 'POST',
        credentials: 'include',
      });
      
      const data = await response.json();
      
      if (data.success && data.scan) {
        setScanResult(data.scan);
        onScanComplete?.(data.scan);
      } else {
        setError(data.error || 'فشل في فحص الإيصال');
      }
    } catch (err: any) {
      setError(err.message || 'خطأ في الاتصال');
    } finally {
      setIsScanning(false);
    }
  };

  const getRecommendationStyle = (rec: string) => {
    switch (rec) {
      case 'تفعيل_تلقائي':
        return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-600', icon: CheckCircle2 };
      case 'مراجعة_يدوية':
        return { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-600', icon: AlertTriangle };
      case 'رفض':
        return { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-600', icon: XCircle };
      default:
        return { bg: 'bg-gray-500/10', border: 'border-gray-500/30', text: 'text-gray-600', icon: AlertTriangle };
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  if (!scanResult && !isScanning) {
    return (
      <Card className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-blue-500/10">
              <Scan className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">فحص الإيصال بالذكاء الاصطناعي</h4>
              <p className="text-xs text-muted-foreground">تحليل ذكي للتحقق من صحة الإيصال</p>
            </div>
          </div>
          <Button 
            onClick={handleScan} 
            disabled={isScanning}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="button-ai-scan"
          >
            <Eye className="w-4 h-4 ml-2" />
            فحص الإيصال
          </Button>
        </div>
        {error && (
          <p className="text-sm text-red-500 mt-2">{error}</p>
        )}
      </Card>
    );
  }

  if (isScanning) {
    return (
      <Card className="p-6 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 border-violet-200 dark:border-violet-800">
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-20 h-20">
            <div className="absolute inset-0 rounded-full border-4 border-violet-200 dark:border-violet-800"></div>
            <div className="absolute inset-0 rounded-full border-4 border-violet-500 border-t-transparent animate-spin"></div>
            <div className="absolute inset-3 rounded-full bg-violet-500/20 flex items-center justify-center">
              <Scan className="w-8 h-8 text-violet-600 animate-pulse" />
            </div>
          </div>
          <div>
            <h4 className="font-bold text-lg text-violet-700 dark:text-violet-300">جاري الفحص الذكي...</h4>
            <p className="text-sm text-muted-foreground mt-1">تحليل الإيصال بالذكاء الاصطناعي</p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>استخراج البيانات والتحقق من الأصالة...</span>
          </div>
        </div>
      </Card>
    );
  }

  if (scanResult) {
    const style = getRecommendationStyle(scanResult.recommendation);
    const Icon = style.icon;

    return (
      <Card className={`p-4 ${style.bg} border ${style.border}`}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${style.bg}`}>
                <Icon className={`w-6 h-6 ${style.text}`} />
              </div>
              <div>
                <h4 className="font-bold text-base">نتيجة الفحص الذكي</h4>
                <Badge variant="outline" className={`mt-1 ${style.text} ${style.border}`}>
                  {scanResult.recommendation === 'تفعيل_تلقائي' && 'مطابق - جاهز للتفعيل'}
                  {scanResult.recommendation === 'مراجعة_يدوية' && 'يحتاج مراجعة'}
                  {scanResult.recommendation === 'رفض' && 'غير مطابق'}
                </Badge>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleScan}
              disabled={isScanning}
              data-testid="button-rescan"
            >
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="w-3 h-3" />
                <span>نسبة الأصالة</span>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={scanResult.authenticityScore} className="h-2 flex-1" />
                <span className="text-sm font-bold">{scanResult.authenticityScore}%</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileCheck className="w-3 h-3" />
                <span>نسبة التطابق</span>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={scanResult.matchScore} className="h-2 flex-1" />
                <span className="text-sm font-bold">{scanResult.matchScore}%</span>
              </div>
            </div>
          </div>

          {(scanResult.extractedAmount || scanResult.extractedDate || scanResult.extractedReference || scanResult.extractedReceiverBank) && (
            <div className="bg-background/50 rounded-lg p-3 space-y-2">
              <h5 className="text-xs font-semibold text-muted-foreground mb-2">البيانات المستخرجة:</h5>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {scanResult.extractedAmount && (
                  <div className="flex items-center gap-2">
                    <Banknote className="w-3 h-3 text-emerald-500" />
                    <span className="text-muted-foreground">المبلغ:</span>
                    <span className="font-bold">{scanResult.extractedAmount} ر.س</span>
                  </div>
                )}
                {scanResult.extractedDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3 h-3 text-blue-500" />
                    <span className="text-muted-foreground">التاريخ:</span>
                    <span className="font-bold">{scanResult.extractedDate}</span>
                  </div>
                )}
                {scanResult.extractedReference && (
                  <div className="flex items-center gap-2">
                    <Hash className="w-3 h-3 text-purple-500" />
                    <span className="text-muted-foreground">المرجع:</span>
                    <span className="font-bold">{scanResult.extractedReference}</span>
                  </div>
                )}
                {scanResult.extractedReceiverBank && (
                  <div className="flex items-center gap-2">
                    <Building2 className="w-3 h-3 text-amber-500" />
                    <span className="text-muted-foreground">البنك:</span>
                    <span className="font-bold">{scanResult.extractedReceiverBank}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {scanResult.summary && (
            <p className="text-sm text-muted-foreground bg-background/50 rounded-lg p-3">
              {scanResult.summary}
            </p>
          )}

          {scanResult.concerns && scanResult.concerns.length > 0 && (
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
              <h5 className="text-xs font-semibold text-red-600 mb-1">ملاحظات:</h5>
              <ul className="text-xs text-red-600 space-y-1">
                {scanResult.concerns.map((c, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span>•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scanResult.positiveIndicators && scanResult.positiveIndicators.length > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3">
              <h5 className="text-xs font-semibold text-emerald-600 mb-1">مؤشرات إيجابية:</h5>
              <ul className="text-xs text-emerald-600 space-y-1">
                {scanResult.positiveIndicators.map((p, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
            <span>مستوى الثقة: {scanResult.confidence}%</span>
            {scanResult.imageQuality && <span>جودة الصورة: {scanResult.imageQuality}</span>}
          </div>
        </div>
      </Card>
    );
  }

  return null;
}
