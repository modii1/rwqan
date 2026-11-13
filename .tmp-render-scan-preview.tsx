import { mkdirSync, writeFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReceiptScanOverlay } from "./src/components/receipt-scan-overlay";
import {
  initialReceiptScanStages,
  type ReceiptScanStageState,
} from "./src/lib/receipt-scan";

const OUT = "C:/Users/zerof/AppData/Local/Temp/opencode/scan-overlay-shots";
mkdirSync(OUT, { recursive: true });

const allDone = (): ReceiptScanStageState[] =>
  initialReceiptScanStages().map((stage) => ({ ...stage, status: "done" }));

const scanningStages = (): ReceiptScanStageState[] =>
  initialReceiptScanStages().map((stage, index) => ({
    ...stage,
    status: index < 3 ? "done" : index === 3 ? "active" : "pending",
  }));

const reviewStages = (): ReceiptScanStageState[] =>
  allDone().map((stage, index) =>
    index === 2 || index === 3 ? { ...stage, status: "failed" } : stage,
  );

const errorStages = (): ReceiptScanStageState[] =>
  allDone().map((stage, index) =>
    index === 1 ? { ...stage, status: "failed" } : stage,
  );

const states = [
  {
    key: "scanning",
    outcome: "scanning" as const,
    stages: scanningStages(),
  },
  {
    key: "success",
    outcome: "success" as const,
    stages: allDone(),
    title: "تم التحقق بنجاح",
    message: "تم التحقق من بيانات الإيصال بنجاح.",
  },
  {
    key: "review",
    outcome: "review" as const,
    stages: reviewStages(),
    title: "الإيصال قيد المراجعة",
    message: "نحتاج إلى مراجعة الإيصال قبل إكمال الطلب.",
    reasons: [
      "مبلغ التحويل في الإيصال لا يطابق المبلغ المطلوب.",
      "لم نتمكن من مطابقة اسم المستفيد في الإيصال.",
    ],
  },
  {
    key: "error",
    outcome: "error" as const,
    stages: errorStages(),
    title: "تعذر إكمال التحقق",
    message: "انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.",
  },
  {
    key: "duplicate",
    outcome: "duplicate" as const,
    stages: scanningStages(),
    title: "الإيصال مستخدم مسبقًا",
    message: "هذا الإيصال سبق استخدامه في عملية دفع أخرى. يرجى رفع إيصال مختلف.",
  },
  {
    key: "not-receipt",
    outcome: "not_receipt" as const,
    stages: allDone(),
    title: "المستند ليس إيصال تحويل بنكي",
    message: "يرجى رفع إيصال تحويل بنكي صحيح.",
  },
];

for (const state of states) {
  const markup = renderToStaticMarkup(
    <ReceiptScanOverlay
      open
      stages={state.stages}
      outcome={state.outcome}
      title={(state as any).title}
      message={(state as any).message}
      reasons={(state as any).reasons ?? []}
      onClose={() => {}}
    />,
  );

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; background: #f2efe6; }
  .preview-bg {
    min-height: 100vh;
    background:
      radial-gradient(circle at 15% 10%, rgba(216,191,118,0.18), transparent 42%),
      radial-gradient(circle at 85% 90%, rgba(41,55,47,0.12), transparent 46%),
      #f2efe6;
  }
</style>
</head>
<body>
  <div class="preview-bg"></div>
  ${markup}
</body>
</html>`;

  writeFileSync(`${OUT}/${state.key}.html`, html, "utf8");
}

console.log(JSON.stringify({ out: OUT, states: states.map((s) => s.key) }));
