// client/src/pages/admin/sections/whatsapp.tsx
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import {
  MessageCircle,
  Send,
  Inbox,
  History,
  BarChart3,
  Loader2,
  Smartphone,
} from "lucide-react";

export default function AdminWhatsAppSection() {
  const [message, setMessage] = useState("");
  const [loadingSend, setLoadingSend] = useState(false);

  const [stats, setStats] = useState<any>(null);
  const [logs, setLogs] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // =============================
  // تحميل البيانات
  // =============================
  const loadDashboard = async () => {
    try {
      setLoading(true);

      const [statsRes, logsRes, reqRes] = await Promise.all([
        fetch("/api/whatsapp/stats").then((r) => r.json()),
        fetch("/api/whatsapp/logs").then((r) => r.json()),
        fetch("/api/whatsapp/requests").then((r) => r.json()),
      ]);

      setStats(statsRes || {});
      setLogs(logsRes || []);
      setRequests(reqRes || []);
    } catch (err) {
      console.error("WhatsApp dashboard error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  // =============================
  // إرسال رسالة إلى المدير
  // =============================
  const handleSend = async () => {
    if (!message.trim()) return;

    setLoadingSend(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "manual",
          message,
        }),
      });

      await res.json();
      setMessage("");
      await loadDashboard();
    } catch (err) {
      console.error("Send error:", err);
    } finally {
      setLoadingSend(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-60" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6" dir="rtl">
      {/* ========================== */}
      {/*        إحصائيات النظام      */}
      {/* ========================== */}
      <Card className="p-4">
  <h2 className="font-bold text-xl mb-4 flex items-center gap-2">
    <BarChart3 className="w-5 h-5 text-blue-600" />
    إحصائيات نظام الواتساب
  </h2>

  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
    <Card className="p-3">
      <p className="text-sm text-muted-foreground">اليوم</p>
      <p className="font-bold text-lg">{stats?.today ?? 0}</p>
    </Card>

    <Card className="p-3">
      <p className="text-sm text-muted-foreground">هذا الأسبوع</p>
      <p className="font-bold text-lg">{stats?.week ?? 0}</p>
    </Card>

    <Card className="p-3">
      <p className="text-sm text-muted-foreground">هذا الشهر</p>
      <p className="font-bold text-lg">{stats?.month ?? 0}</p>
    </Card>

    <Card className="p-3">
      <p className="text-sm text-muted-foreground">إجمالي الرسائل</p>
      <p className="font-bold text-lg">{stats?.total ?? 0}</p>
    </Card>
  </div>
</Card>


      {/* ========================== */}
      {/*      إرسال رسالة للمدير    */}
      {/* ========================== */}
      <Card className="p-4 space-y-3">
        <h2 className="font-bold text-xl flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-green-600" />
          إرسال رسالة إلى واتساب المدير
        </h2>

        <Textarea
          className="min-h-[120px]"
          placeholder="اكتب الرسالة التي تريد أن تصل إلى المدير…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <Button onClick={handleSend} disabled={loadingSend || !message.trim()}>
          {loadingSend ? (
            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 ml-2" />
          )}
          إرسال الآن
        </Button>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {/* ========================== */}
        {/*     الطلبات الخاصة         */}
        {/* ========================== */}
        <Card className="p-4">
          <h2 className="font-bold text-xl mb-4 flex items-center gap-2">
            <Inbox className="w-5 h-5 text-purple-600" />
            الطلبات الخاصة Smart Requests
          </h2>

          <div className="space-y-3 max-h-80 overflow-auto pr-1">
            {requests.length === 0 && (
              <p className="text-sm text-muted-foreground">لا توجد طلبات حالياً.</p>
            )}

            {requests.map((r: any) => (
              <Card key={r.id || r.requestCode} className="p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold">عقار #{r.propertyNumber}</span>
                  <Badge variant="outline">
                    <Smartphone className="w-3 h-3 ml-1" />
                    {r.deviceType || "غير معروف"}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground mb-1">{r.timestamp}</p>

                {r.ipAddress && (
                  <p className="text-xs text-muted-foreground">IP: {r.ipAddress}</p>
                )}
              </Card>
            ))}
          </div>
        </Card>

        {/* ========================== */}
        {/*     سجل رسائل الواتساب     */}
        {/* ========================== */}
        <Card className="p-4">
          <h2 className="font-bold text-xl mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-orange-600" />
            سجل رسائل الواتساب
          </h2>

          <div className="space-y-3 max-h-80 overflow-auto pr-1">
            {logs.length === 0 && (
              <p className="text-sm text-muted-foreground">لا يوجد سجل رسائل بعد.</p>
            )}

            {logs.map((log: any) => (
              <Card key={log.id} className="p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-sm">{log.type}</span>

                  <Badge
                    variant={log.status === "success" ? "default" : "destructive"}
                  >
                    {log.status === "success" ? "تم الإرسال" : "فشل"}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground mb-1">
                  {log.createdAt}
                </p>

                <p className="text-sm whitespace-pre-line">{log.message}</p>

                {log.ownerPhone && (
                  <a
                    href={`https://wa.me/${log.ownerPhone}`}
                    className="text-blue-600 text-xs underline mt-1 inline-block"
                    target="_blank"
                  >
                    فتح واتساب المالك
                  </a>
                )}
              </Card>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
