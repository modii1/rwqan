"use client";

import { useEffect, useRef } from "react";
import {
  AlertCircle,
  Check,
  CopyX,
  FileText,
  FileWarning,
  Loader2,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  ReceiptScanOutcome,
  ReceiptScanStageState,
} from "../lib/receipt-scan";
import { activeReceiptScanStage } from "../lib/receipt-scan";

interface ReceiptScanOverlayProps {
  open: boolean;
  stages: ReceiptScanStageState[];
  outcome: ReceiptScanOutcome;
  title?: string;
  message?: string;
  reasons?: string[];
  onClose: () => void;
}

function stageTone(status: ReceiptScanStageState["status"]): string {
  switch (status) {
    case "done":
      return "border-[#d8bf76]/70 bg-[#fbf6e6] text-[#29372f]";
    case "active":
      return "border-[#d8bf76] bg-[#f7efd8] text-[#29372f] shadow-[0_0_0_3px_rgba(216,191,118,0.18)]";
    case "failed":
      return "border-[#e3c9b8] bg-[#fbf0ea] text-[#8a4b3a]";
    default:
      return "border-[#e9dfca] bg-[#fffdf8] text-[#6f685b]";
  }
}

function StageIcon({
  status,
  frozen = false,
}: {
  status: ReceiptScanStageState["status"];
  frozen?: boolean;
}) {
  if (status === "done") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#29372f] text-[#d8bf76]">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d8bf76] text-[#29372f]">
        <Loader2
          className={`h-3.5 w-3.5 ${frozen ? "" : "animate-spin"}`}
          strokeWidth={2.5}
        />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f3ded4] text-[#8a4b3a]">
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#e9dfca] bg-[#fffdf8]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#c9bfa8]" />
    </span>
  );
}

function CentralArt({ outcome }: { outcome: ReceiptScanOutcome }) {
  if (outcome === "success") {
    return (
      <div className="rwqan-scan-art rwqan-pop relative flex h-20 w-20 items-center justify-center rounded-full bg-[#f5ecd2] ring-1 ring-[#d8bf76]/60 sm:h-24 sm:w-24">
        <span className="absolute inset-0 rounded-full bg-[#d8bf76]/20" />
        <ShieldCheck
          className="relative h-9 w-9 text-[#8b6b25] sm:h-11 sm:w-11"
          strokeWidth={1.8}
        />
      </div>
    );
  }
  if (outcome === "review") {
    return (
      <div className="rwqan-scan-art rwqan-pop relative flex h-20 w-20 items-center justify-center rounded-full bg-[#f5ecd2] ring-1 ring-[#d8bf76]/60 sm:h-24 sm:w-24">
        <span className="absolute inset-0 rounded-full bg-[#d8bf76]/20" />
        <Search
          className="relative h-9 w-9 text-[#8b6b25] sm:h-11 sm:w-11"
          strokeWidth={1.8}
        />
      </div>
    );
  }
  if (outcome === "error") {
    return (
      <div className="rwqan-scan-art rwqan-pop relative flex h-20 w-20 items-center justify-center rounded-full bg-[#f8ece7] ring-1 ring-[#e3c9b8] sm:h-24 sm:w-24">
        <span className="absolute inset-0 rounded-full bg-[#f3ded4]/70" />
        <AlertCircle
          className="relative h-9 w-9 text-[#9b4a3a] sm:h-11 sm:w-11"
          strokeWidth={1.8}
        />
      </div>
    );
  }
  if (outcome === "not_receipt") {
    return (
      <div className="rwqan-scan-art rwqan-pop relative flex h-20 w-20 items-center justify-center rounded-full bg-[#f7efe4] ring-1 ring-[#e0c99a] sm:h-24 sm:w-24">
        <span className="absolute inset-0 rounded-full bg-[#efe3d2]/80" />
        <FileWarning
          className="relative h-9 w-9 text-[#8a4b3a] sm:h-11 sm:w-11"
          strokeWidth={1.8}
        />
      </div>
    );
  }
  if (outcome === "duplicate") {
    return (
      <div className="rwqan-scan-art rwqan-pop relative flex h-20 w-20 items-center justify-center rounded-full bg-[#f5ecd2] ring-1 ring-[#e0c99a] sm:h-24 sm:w-24">
        <span className="absolute inset-0 rounded-full bg-[#d8bf76]/20" />
        <CopyX
          className="relative h-9 w-9 text-[#8b6b25] sm:h-11 sm:w-11"
          strokeWidth={1.8}
        />
      </div>
    );
  }
  return (
    <div className="rwqan-scan-art relative flex h-20 w-20 items-center justify-center sm:h-24 sm:w-24">
      <span className="rwqan-ring absolute h-20 w-20 rounded-full border border-[#d8bf76]/50 sm:h-24 sm:w-24" />
      <span
        className="rwqan-ring absolute h-20 w-20 rounded-full border border-[#d8bf76]/35 sm:h-24 sm:w-24"
        style={{ animationDelay: "0.7s" }}
      />
      <span className="absolute flex h-16 w-16 items-center justify-center rounded-full bg-[#fffdf8] shadow-[0_18px_45px_-20px_rgba(0,0,0,0.55)] ring-1 ring-[#d8bf76]/60 sm:h-20 sm:w-20">
        <FileText
          className="h-8 w-8 text-[#29372f] sm:h-9 sm:w-9"
          strokeWidth={1.7}
        />
        <span className="rwqan-scan-line absolute left-4 right-4 top-1/2 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[#d8bf76] to-transparent" />
      </span>
    </div>
  );
}

function resultTone(outcome: Exclude<ReceiptScanOutcome, "scanning">) {
  switch (outcome) {
    case "success":
      return {
        card: "border-[#d8bf76] bg-[#fbf6e6]",
        label: "text-[#8b6b25]",
        title: "text-[#29372f]",
      };
    case "review":
      return {
        card: "border-[#d8bf76]/80 bg-[#faf4e2]",
        label: "text-[#8b6b25]",
        title: "text-[#29372f]",
      };
    case "duplicate":
      return {
        card: "border-[#e0c99a] bg-[#fbf4e4]",
        label: "text-[#8b6b25]",
        title: "text-[#29372f]",
      };
    case "not_receipt":
      return {
        card: "border-[#e3c9b8] bg-[#fbf3ec]",
        label: "text-[#9b4a3a]",
        title: "text-[#7f3f31]",
      };
    default:
      return {
        card: "border-[#e3c9b8] bg-[#fbf0ea]",
        label: "text-[#9b4a3a]",
        title: "text-[#7f3f31]",
      };
  }
}

export function ReceiptScanOverlay({
  open,
  stages,
  outcome,
  title,
  message,
  reasons = [],
  onClose,
}: ReceiptScanOverlayProps) {
  // Lock the page behind the dialog so only the dialog body scrolls.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || outcome === "scanning") return;
    // Bring the final result into view inside the same dialog.
    bodyRef.current?.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [open, outcome]);

  if (!open) return null;

  const current = activeReceiptScanStage(stages);
  const heading = "التحقق من الإيصال";
  const subtitle =
    outcome === "scanning"
      ? current?.label ?? "جارٍ استكمال التحقق..."
      : "اكتمل الفحص";
  const isScanning = outcome === "scanning";
  const tone = outcome === "scanning" ? null : resultTone(outcome);

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-[#1b241f]/60 p-3 backdrop-blur-[3px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <style>{`
        @keyframes rwqan-scan-line {
          0% { transform: translateY(-16px); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateY(18px); opacity: 0; }
        }
        @keyframes rwqan-ring {
          0% { transform: scale(0.78); opacity: 0.55; }
          70% { transform: scale(1.28); opacity: 0; }
          100% { transform: scale(1.28); opacity: 0; }
        }
        @keyframes rwqan-pop {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.06); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes rwqan-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes rwqan-progress {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .rwqan-scan-line { animation: rwqan-scan-line 1.9s ease-in-out infinite; }
        .rwqan-ring { animation: rwqan-ring 2.4s ease-out infinite; }
        .rwqan-pop { animation: rwqan-pop 0.5s ease-out both; }
        .rwqan-fade-up { animation: rwqan-fade-up 0.35s ease-out both; }
        .rwqan-progress-active {
          background-image: linear-gradient(90deg, #b8933a 0%, #f0dfae 50%, #b8933a 100%);
          background-size: 200% 100%;
          animation: rwqan-progress 1.8s linear infinite;
        }
        @media (max-height: 560px) {
          .rwqan-scan-art { display: none; }
          .rwqan-scan-header { padding-top: 0.75rem; padding-bottom: 0.5rem; }
          .rwqan-scan-title { margin-top: 0; font-size: 1rem; line-height: 1.5rem; }
          .rwqan-scan-subtitle { margin-top: 0.125rem; font-size: 0.75rem; line-height: 1rem; }
          .rwqan-scan-progress { margin-top: 0.75rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rwqan-scan-line, .rwqan-ring, .rwqan-pop, .rwqan-fade-up, .rwqan-progress-active {
            animation: none !important;
          }
        }
      `}</style>

      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-[26px] border border-[#d9cfb8] bg-[#fffdf8] shadow-[0_30px_80px_rgba(24,34,28,0.45)] sm:max-h-[min(46rem,calc(100dvh_-_3rem))] sm:rounded-[28px]">
        <div className="rwqan-scan-header relative shrink-0 overflow-hidden bg-[#29372f] px-4 pb-4 pt-5 text-[#fffdf8] sm:px-6 sm:pb-5 sm:pt-6">
          <div
            className="pointer-events-none absolute -left-20 top-10 h-72 w-56 rounded-t-full border border-[#ccb46f]/20"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -left-8 top-20 h-56 w-40 rounded-t-full border border-[#ccb46f]/12"
            aria-hidden="true"
          />

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="absolute left-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-[#e7e3d8] transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d8bf76]"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative flex flex-col items-center text-center">
            <CentralArt outcome={outcome} />
            <h2 className="rwqan-scan-title mt-3 text-lg font-bold text-[#fffdf8] sm:mt-4">
              {heading}
            </h2>
            <p
              className="rwqan-scan-subtitle mt-1 min-h-[20px] text-sm text-[#d8bf76]"
              aria-live="polite"
            >
              {subtitle}
            </p>
          </div>

          <div
            className="rwqan-scan-progress mt-5 flex gap-1.5"
            aria-hidden="true"
          >
            {stages.map((stage) => (
              <span
                key={stage.key}
                className={`relative h-1.5 flex-1 overflow-hidden rounded-full transition-colors duration-500 ${
                  stage.status === "done"
                    ? "bg-[#d8bf76]"
                    : stage.status === "failed"
                      ? "bg-[#c98b74]"
                      : stage.status === "active"
                        ? isScanning
                          ? "rwqan-progress-active"
                          : "bg-[#d8bf76]"
                        : "bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#fffdf8]"
        >
          <ul className="space-y-2 px-3 py-3 sm:space-y-2.5 sm:px-5 sm:py-4">
            {stages.map((stage) => (
              <li
                key={stage.key}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors duration-300 ${stageTone(
                  stage.status
                )}`}
              >
                <StageIcon
                  status={stage.status}
                  frozen={outcome !== "scanning"}
                />
                <span
                  className={`text-[13px] leading-5 ${
                    stage.status === "active" ? "font-semibold" : ""
                  }`}
                >
                  {stage.label}
                </span>
              </li>
            ))}
          </ul>

          {!isScanning && tone ? (
            <div className="rwqan-fade-up px-3 pb-4 sm:px-5 sm:pb-5">
              <div className={`rounded-2xl border p-4 ${tone.card}`}>
                <p
                  className={`text-[11px] font-bold tracking-wide ${tone.label}`}
                >
                  نتيجة الفحص
                </p>
                <p
                  className={`mt-1 text-base font-bold ${tone.title}`}
                  aria-live="polite"
                >
                  {title ?? "نتيجة الفحص"}
                </p>
                {message ? (
                  <p className="mt-1.5 text-[13px] leading-6 text-[#6f685b]">
                    {message}
                  </p>
                ) : null}
                {reasons.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 border-t border-[#e9dfca] pt-3">
                    {reasons.map((reason) => (
                      <li
                        key={reason}
                        className="flex items-start gap-2 text-[13px] leading-6 text-[#6f685b]"
                      >
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#b8933a]" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-[#e9dfca] bg-[#fffdf8] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-[#29372f] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#1f2b25] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d8bf76] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdf8]"
          >
            {outcome === "scanning" ? "إخفاء" : "حسنًا"}
          </button>
        </div>
      </div>
    </div>
  );
}
