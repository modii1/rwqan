"use client";
import { useEffect, useState, useRef, useCallback, type CSSProperties } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PriceDisplay } from "@/components/price-display";
import { OwnerPaymentSummary } from "@/components/owner/owner-payment-summary";
import { FeatureIcon } from "@/components/feature-icon";
import { normalizePackageFeatures } from "@shared/packageFeatures";
import { formatDiscount } from "@/lib/currency";
import { Progress } from "@/components/ui/progress";
import {
  Crown, CreditCard, Check, ChevronRight, ChevronLeft, Clock, Home,
  Star, Zap, Upload, AlertTriangle, RefreshCcw, CheckCircle2, Phone, ArrowLeft, Edit3, MessageCircle, ShieldCheck,
  Calendar, Timer, Banknote, Info, X, Loader2, Plus, Trash2, PauseCircle, Image as ImageIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ReceiptScanOverlay } from "@/components/receipt-scan-overlay";
import {
  applyReceiptScanProgress,
  classifyReceiptError,
  classifyReceiptResponse,
  initialReceiptScanStages,
  settleReceiptScanStages,
  type ReceiptScanOutcome,
  type ReceiptScanResultView,
  type ReceiptScanStageState,
} from "@/lib/receipt-scan";

import {
  calculateRemainingDays,
  calculateSubscriptionDuration,
  getSubscriptionStatusFromRecord,
  getSubscriptionDisplayLabel,
  isCancelledSubscription,
  formatDate as formatSubDate,
} from "@/lib/subscription-utils";
import {
  isPremiumSubscriptionType,
  isSubscriptionStatusSuspended,
} from "@shared/subscriptionType";
import {
  OwnerMobileNavigation,
  OwnerPageHeader,
  OwnerPageMain,
} from "@/components/owner/owner-page";
import {
  OwnerInput,
  OwnerStatCard,
  OwnerAlert,
  OwnerEmptyState,
  ownerPanelClass,
  ownerPrimaryButtonClass,
  ownerSecondaryButtonClass,
} from "@/components/owner/owner-ui";
import { runOwnerManualVerification } from "@/lib/owner-verification";
import { getOwnerPendingPaymentRefetchInterval } from "@/lib/workflow-query-refresh";
import { getOwnerLoginUrl } from "@/lib/owner-login-redirect";
import {
  calculateSubscriptionPrice,
  calculateSubscriptionPriceForPeriod,
  getPackageBillingOption,
  getIncludedPropertyCount,
  getMaximumPropertyCount,
  type BillingPeriod,
} from "@shared/subscriptionPricing";

type ReceiptUploadError = Error & { code?: string; status?: number };

const RECEIPT_UPLOAD_TIMEOUT_MS = 120_000;

function timeoutReceiptError(): ReceiptUploadError {
  const error = new Error("انتهت مهلة الاتصال") as ReceiptUploadError;
  error.code = "TIMEOUT";
  error.status = 408;
  return error;
}

/**
 * Upload a receipt and preserve the server's real error code/status so the
 * dialog can distinguish a duplicate from a genuine technical failure.
 */
async function postReceiptForm(url: string, formData: FormData): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    RECEIPT_UPLOAD_TIMEOUT_MS
  );
  try {
    const res = await fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error = new Error(
        body?.error || "فشل إرسال التحويل"
      ) as ReceiptUploadError;
      error.code =
        typeof body?.code === "string" ? body.code : undefined;
      error.status = res.status;
      throw error;
    }
    return await res.json();
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      console.error("[receipt-scan] upload timed out", {
        url,
        timeoutMs: RECEIPT_UPLOAD_TIMEOUT_MS,
      });
      throw timeoutReceiptError();
    }
    // Diagnostics for developers only; the user sees a classified, safe text.
    console.error("[receipt-scan] upload failed", {
      url,
      code: (error as ReceiptUploadError)?.code,
      status: (error as ReceiptUploadError)?.status,
      message: (error as Error)?.message,
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getPaymentTime(value: any): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
  if (typeof value._seconds === "number") return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1_000_000);
  return 0;
}

function sortPaymentsNewestFirst<T extends { createdAt?: any; completedAt?: any; id?: string }>(payments: T[]): T[] {
  return [...payments].sort((a, b) => {
    const byTime =
      getPaymentTime(b.createdAt || b.completedAt) -
      getPaymentTime(a.createdAt || a.completedAt);
    if (byTime !== 0) return byTime;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

export default function OwnerSubscriptionPage() {
  const router = useRouter();
  const { toast } = useToast();
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  // Each subscription step brings its content into view. The visual step bar
  // was removed, so the page scrolls to the relevant card instead.
  const didMountStepScroll = useRef(false);
  useEffect(() => {
    if (!didMountStepScroll.current) {
      didMountStepScroll.current = true;
      return;
    }
    const targetId =
      currentStep === 1
        ? "packages-section"
        : currentStep === 2
          ? "owner-subscription-step-2"
          : "owner-subscription-step-3";
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentStep]);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem("owner-billing-period") === "quarterly") {
        setBillingPeriod("quarterly");
      }
    } catch {
      // ignore storage restrictions
    }
  }, []);
  const changeBillingPeriod = (period: BillingPeriod) => {
    setBillingPeriod(period);
    try {
      window.sessionStorage.setItem("owner-billing-period", period);
    } catch {
      // ignore storage restrictions
    }
  };
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [action, setAction] = useState<"new" | "upgrade" | "extend">("upgrade");
  const [paymentMethod, setPaymentMethod] = useState<"online" | "bank" | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [bankTransferResult, setBankTransferResult] = useState<{
    autoActivated?: boolean;
    verificationFailed?: boolean;
    paymentRejected?: boolean;
    missingFields?: string[];
    pendingManualReview?: boolean;
    pendingAdminApproval?: boolean;
    message?: string;
    nextAction?: string;
    nextUrl?: string;
    actionLabel?: string;
  } | null>(null);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [aiScanResult, setAiScanResult] = useState<any>(null);
  const [receiptScan, setReceiptScan] = useState<{
    open: boolean;
    scanId: string | null;
    stages: ReceiptScanStageState[];
    outcome: ReceiptScanOutcome;
    title?: string;
    message?: string;
    reasons: string[];
  }>({
    open: false,
    scanId: null,
    stages: initialReceiptScanStages(),
    outcome: "scanning",
    reasons: [],
  });
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissedScanRef = useRef<string | null>(null);
  const activeScanIdRef = useRef<string | null>(null);

  const stopScanPolling = useCallback(() => {
    if (scanPollRef.current !== null) {
      clearInterval(scanPollRef.current);
      scanPollRef.current = null;
    }
  }, []);

  const beginReceiptScan = useCallback(
    (scanId: string) => {
      stopScanPolling();
      dismissedScanRef.current = null;
      activeScanIdRef.current = scanId;
      setReceiptScan({
        open: true,
        scanId,
        stages: initialReceiptScanStages().map((stage, index) =>
          index === 0 ? { ...stage, status: "active" as const } : stage
        ),
        outcome: "scanning",
        reasons: [],
      });
      scanPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/owner/receipt-scan/${encodeURIComponent(scanId)}`,
            { credentials: "include", cache: "no-store" }
          );
          if (!res.ok) return;
          if (activeScanIdRef.current !== scanId) return;
          const data = await res.json();
          setReceiptScan((prev) =>
            prev.scanId === scanId
              ? {
                  ...prev,
                  stages: applyReceiptScanProgress(prev.stages, data.progress),
                }
              : prev
          );
        } catch {
          // A failed progress read must never invent a completed stage. The
          // upload response remains the source of truth.
        }
      }, 900);
    },
    [stopScanPolling]
  );

  const finishReceiptScan = useCallback(
    async (
      scanId: string,
      payload: any,
      options: { forceReview?: boolean } = {}
    ) => {
      stopScanPolling();
      activeScanIdRef.current = null;
      // The dialog is driven by the server's real response, never by a fixed
      // generic message.
      const info: ReceiptScanResultView = classifyReceiptResponse(
        payload,
        options
      );
      let stages: ReceiptScanStageState[] | null = null;
      try {
        // One last real snapshot: the scan may finish between two polls.
        const res = await fetch(
          `/api/owner/receipt-scan/${encodeURIComponent(scanId)}`,
          { credentials: "include", cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          stages = applyReceiptScanProgress(
            initialReceiptScanStages(),
            data.progress
          );
        }
      } catch {
        // Keep the last server-confirmed state; never fabricate completion.
      }
      setReceiptScan((prev) => {
        if (prev.scanId !== scanId) return prev;
        return {
          ...prev,
          stages: settleReceiptScanStages(stages ?? prev.stages, info.outcome),
          outcome: info.outcome,
          title: info.title,
          message: info.message,
          reasons: info.reasons,
        };
      });
    },
    [stopScanPolling]
  );

  const failReceiptScan = useCallback(
    (error?: unknown) => {
      stopScanPolling();
      const scanId = activeScanIdRef.current;
      const info = classifyReceiptError(error);
      const visible =
        scanId !== null && dismissedScanRef.current !== scanId;
      activeScanIdRef.current = null;
      setReceiptScan((prev) => {
        if (prev.scanId !== scanId) return prev;
        return {
          ...prev,
          stages: settleReceiptScanStages(prev.stages, info.outcome),
          outcome: info.outcome,
          title: info.title,
          message: info.message,
          reasons: info.reasons,
        };
      });
      return { info, visible };
    },
    [stopScanPolling]
  );

  useEffect(() => () => stopScanPolling(), [stopScanPolling]);
  
  // Additional properties for multi-property packages
  const [additionalProperties, setAdditionalProperties] = useState<Array<{ number: string; verified: boolean; error: string; verifying: boolean; incomplete?: boolean; missingFields?: string[] }>>([]);
  const [verifyingProperty, setVerifyingProperty] = useState<number | null>(null);
  const [showIncompleteDataDialog, setShowIncompleteDataDialog] = useState(false);
  const [incompletePropertyData, setIncompletePropertyData] = useState<any>(null);
  const [showAdditionalPropertyError, setShowAdditionalPropertyError] = useState(false);
  const [expandedPackages, setExpandedPackages] = useState<Set<string>>(new Set());

  // Get current subscription for linked properties
  const { data: currentSubscription } = useQuery<any>({
    queryKey: ["/api/owner/current-subscription"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Get additional property requests pending approval
  const { data: additionalPropertyRequests, refetch: refetchAdditionalRequests } = useQuery<any>({
    queryKey: ["/api/owner/additional-property-requests"],
    queryFn: async () => {
      const res = await fetch("/api/owner/additional-property-requests", { credentials: "include" });
      if (!res.ok) return { requests: [] };
      const data = await res.json();
      return data;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Add-on purchase flow
  const [addOnStep, setAddOnStep] = useState<1 | 2>(1);
  const [selectedAddOn, setSelectedAddOn] = useState<any>(null);
  const [addOnPaymentMethod, setAddOnPaymentMethod] = useState<"online" | "bank" | null>(null);
  const [addOnReceiptFile, setAddOnReceiptFile] = useState<File | null>(null);
  const [addOnPaymentSuccess, setAddOnPaymentSuccess] = useState(false);
  const [addOnAiScanResult, setAddOnAiScanResult] = useState<any>(null);
  const [unlinkPropertyDialog, setUnlinkPropertyDialog] = useState<{ open: boolean; propertyNumber: string; propertyName: string }>({ open: false, propertyNumber: "", propertyName: "" });

  // Payment-history actions (moved from the dashboard): retry, upload receipt, verify.
  const [selectedPaymentForReceipt, setSelectedPaymentForReceipt] = useState<any>(null);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [paymentReceiptFeedback, setPaymentReceiptFeedback] = useState<{
    title: string;
    message: string;
    tone: "error" | "review";
  } | null>(null);
  const [isUploadingPaymentReceipt, setIsUploadingPaymentReceipt] = useState(false);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const paymentReceiptInputRef = useRef<HTMLInputElement>(null);

  interface AIScanResult {
    recommendation: string;
    confidence: number;
    summary: string;
    matchScore: number;
    authenticityScore: number;
  }

  // Fetch default bank account for bank transfer
  const { data: bankAccount } = useQuery<any>({
    queryKey: ["/api/bank-accounts/default"],
    enabled: paymentMethod === "bank" || addOnPaymentMethod === "bank",
  });

  // Auth check
  useEffect(() => {
    fetch("/api/owner/session", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.isLoggedIn) router.replace(getOwnerLoginUrl("/owner/subscription"));
      })
      .catch(() => router.replace(getOwnerLoginUrl("/owner/subscription")));
  }, [router]);

  // Fetch current property
  const { data: property } = useQuery<any>({
    queryKey: ["/api/owner/property"],
  });

  // Fetch current subscription
  const { data: subscription, isLoading: subLoading } = useQuery<any>({
    queryKey: ["/api/owner/current-subscription"],
  });

  // Fetch packages available to the owner audience
  const { data: rawPackages = [] } = useQuery<any[]>({
    queryKey: ["/api/owner/packages"],
  });

  // Deduplicate packages
  const packages = Array.from(new Map(rawPackages.map((pkg: any) => [pkg.id, pkg])).values());

  // Fetch add-on packages
  const { data: addOnPackages } = useQuery<any[]>({
    queryKey: ["/api/owner/addons"],
    queryFn: async () => {
      const res = await fetch("/api/owner/addons", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch owner's active add-ons
  const { data: propertyAddons } = useQuery<any[]>({
    queryKey: ["/api/owner/property-addons"],
    queryFn: async () => {
      const res = await fetch("/api/owner/property-addons", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });



  // Check pending payment - only after property is loaded
  const { data: pendingPayment } = useQuery<any>({
    queryKey: ["/api/owner/payment/check-pending"],
    enabled: !!property?.propertyNumber,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      getOwnerPendingPaymentRefetchInterval(
        query.state.data as { hasPending?: boolean } | undefined,
      ),
    refetchIntervalInBackground: false,
  });

  const { data: paymentsData = [] } = useQuery<any[]>({
    queryKey: ["/api/owner/payments"],
    enabled: !!property?.propertyNumber,
  });

  // Deep-link support: scroll to the requested subscription section
  // (e.g. /owner/subscription#payments-section from the dashboard).
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    let attempts = 0;
    const laterTimers: ReturnType<typeof setTimeout>[] = [];
    const timer = setInterval(() => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ block: "start" });
        clearInterval(timer);
        // Re-align after late layout shifts (fonts, package cards, images).
        laterTimers.push(
          setTimeout(() => el.scrollIntoView({ block: "start" }), 600),
        );
        laterTimers.push(
          setTimeout(() => el.scrollIntoView({ block: "start" }), 1300),
        );
      } else if (++attempts > 20) {
        clearInterval(timer);
      }
    }, 150);
    return () => {
      clearInterval(timer);
      laterTimers.forEach(clearTimeout);
    };
  }, []);

  // Payment-history actions (same endpoints as the dashboard).
  const retryPaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const response = await apiRequest("POST", "/api/owner/payment/retry", { paymentId });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data?.checkoutUrl) window.location.href = data.checkoutUrl;
    },
    onError: (error: any) => {
      toast({
        title: "خطأ",
        description: error?.message || "تعذر إعادة الدفع",
        variant: "destructive",
      });
    },
  });

  const verifyPaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const response = await fetch(
        `/api/payment/verify-status/${encodeURIComponent(paymentId)}`,
      );
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data?.verified) {
        toast({
          title: "تم التحقق بنجاح",
          description: data?.message || "تم تأكيد الدفع",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/owner/current-subscription"] });
      } else {
        toast({
          title: "لم يتم التأكيد",
          description: data?.message || "الدفعة لم تكتمل بعد",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "خطأ",
        description: error?.message || "تعذر التحقق من الدفع",
        variant: "destructive",
      });
    },
  });

  const handlePaymentReceiptUpload = async () => {
    if (!paymentReceiptFile || !selectedPaymentForReceipt) return;
    setIsUploadingPaymentReceipt(true);
    setPaymentReceiptFeedback(null);
    try {
      const formData = new FormData();
      formData.append("paymentId", selectedPaymentForReceipt.id);
      formData.append("receipt", paymentReceiptFile);
      const response = await fetch("/api/owner/payment/upload-receipt", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const info = classifyReceiptError({
          message: result?.error,
          code: result?.code,
          status: response.status,
        });
        setPaymentReceiptFeedback({ title: info.title, message: info.message, tone: "error" });
        toast({ title: info.title, description: info.message, variant: "destructive" });
        await queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
      setPaymentReceiptFeedback({
        title: "تم رفع الإيصال",
        message: "تم رفع الإيصال وسيتم مراجعته من الإدارة.",
        tone: "review",
      });
      toast({
        title: "تم رفع الإيصال",
        description: "سيتم مراجعته من الإدارة.",
      });
      setShowReceiptDialog(false);
      setSelectedPaymentForReceipt(null);
      setPaymentReceiptFile(null);
    } catch (error: any) {
      const info = classifyReceiptError(error);
      setPaymentReceiptFeedback({ title: info.title, message: info.message, tone: "error" });
      toast({ title: info.title, description: info.message, variant: "destructive" });
    } finally {
      setIsUploadingPaymentReceipt(false);
    }
  };

  // Owner self-service smart verification
  const [isRunningVerification, setIsRunningVerification] = useState(false);
  const hasCompletedSmartVerification =
    property?.verificationStatus === "approved" ||
    property?.verificationStatus === "verified" ||
    property?.smartVerificationPassed === true;
  const runVerification = async () => {
    if (isRunningVerification || hasCompletedSmartVerification) return;

    if (isSubscriptionStatusSuspended(subscription?.status)) {
      toast({
        title: "التحقق موقوف مؤقتاً",
        description:
          "أوقفت الإدارة الاشتراك مؤقتاً. لا يمكن تشغيل التحقق حتى تعيد الإدارة تفعيله.",
        variant: "destructive",
      });
      return;
    }

    setIsRunningVerification(true);
    try {
      const data = await runOwnerManualVerification();
      if (data.verified) {
        if (data.notificationRequired !== false) {
          toast({
            title: data.subscriptionActivated ? "تم التحقق وتفعيل الاشتراك" : "تم التحقق من البيانات",
            description: data.message,
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
        queryClient.invalidateQueries({ queryKey: ["/api/owner/current-subscription"] });
        queryClient.invalidateQueries({ queryKey: ["/api/owner/payment/check-pending"] });
      } else {
        toast({
          title: "البيانات غير مكتملة",
          description: data.missingFields?.join("، ") || data.message,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message || "فشل في التحقق", variant: "destructive" });
    } finally {
      setIsRunningVerification(false);
    }
  };

  const selectedPackage = packages.find((p: any) => p.id === selectedPackageId);
  const existingGroupPropertyNumbers: string[] = Array.from(new Set(
    (currentSubscription?.linkedGroup?.propertyNumbers || [property?.propertyNumber])
      .map((value: unknown) => String(value || "").trim())
      .filter(Boolean),
  ));
  const existingGroupProperties: Array<{
    propertyNumber: string;
    name?: string;
    isMain?: boolean;
  }> = currentSubscription?.linkedGroup?.properties || existingGroupPropertyNumbers.map(
    (propertyNumber) => ({ propertyNumber }),
  );
  const baseGroupPropertyCount = Math.max(1, existingGroupPropertyNumbers.length);
  const verifiedAdditionalCount = additionalProperties.filter((item) => item.verified).length;
  const plannedPropertyCount = baseGroupPropertyCount + verifiedAdditionalCount;
  const selectedPackageMaxProperties = selectedPackage
    ? getMaximumPropertyCount(selectedPackage)
    : 1;
  const selectedPackagePricing = selectedPackage
    ? calculateSubscriptionPriceForPeriod(
        selectedPackage,
        Math.min(plannedPropertyCount, selectedPackageMaxProperties),
        billingPeriod,
      )
    : null;
  const selectedBillingOption = selectedPackage
    ? getPackageBillingOption(selectedPackage, billingPeriod)
    : null;
  const selectedAdditionalTotal = selectedPackagePricing
    ? selectedPackagePricing.additionalPropertyCount *
      selectedPackagePricing.additionalPropertyPrice
    : 0;
  const selectedOriginalTotal = selectedBillingOption
    ? selectedBillingOption.originalPrice + selectedAdditionalTotal
    : selectedPackagePricing?.total || 0;
  const selectedPackageIncludedProperties = selectedPackage
    ? getIncludedPropertyCount(selectedPackage)
    : 1;
  const missingIncludedProperties = Math.max(
    0,
    selectedPackageIncludedProperties - plannedPropertyCount,
  );
  const includedNewPropertySlots = Math.max(
    0,
    selectedPackageIncludedProperties - baseGroupPropertyCount,
  );

  // Validate discount
  const validateDiscount = async () => {
    if (!discountCode) return;
    try {
      const response = await apiRequest("POST", "/api/discount/validate", { code: discountCode });
      const data = await response.json();
      setValidatedDiscount(data);
      toast({ title: "كود الخصم صالح", description: `سيتم خصم ${formatDiscount(data.value, data.type)}` });
    } catch (error: any) {
      toast({ title: "كود الخصم غير صالح", description: error.message, variant: "destructive" });
      setValidatedDiscount(null);
    }
  };

  // Add a new additional property
  const addAdditionalProperty = () => {
    const occupiedCount = baseGroupPropertyCount + additionalProperties.length;
    if (occupiedCount >= selectedPackageMaxProperties) {
      toast({ title: "الحد الأقصى", description: `هذه الباقة تدعم ${selectedPackageMaxProperties} عقار كحد أقصى`, variant: "destructive" });
      return;
    }
    setAdditionalProperties([...additionalProperties, { number: "", verified: false, error: "", verifying: false }]);
  };

  // Remove an additional property
  const removeAdditionalProperty = (index: number) => {
    setAdditionalProperties(additionalProperties.filter((_, i) => i !== index));
  };

  // Update additional property number
  const updateAdditionalPropertyNumber = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 5);
    const updated = [...additionalProperties];
    updated[index] = { ...updated[index], number: cleaned, verified: false, error: "" };
    setAdditionalProperties(updated);
  };

  // Verify an additional property
  const verifyAdditionalProperty = async (index: number) => {
    if (isSubscriptionStatusSuspended(subscription?.status)) {
      toast({
        title: "التحقق موقوف مؤقتاً",
        description:
          "لا يمكن التحقق من عقار إضافي أثناء إيقاف الاشتراك من الإدارة.",
        variant: "destructive",
      });
      return;
    }

    const prop = additionalProperties[index];
    if (!prop.number || prop.number.length !== 5) {
      const updated = [...additionalProperties];
      updated[index] = { ...updated[index], error: "رقم العقار يجب أن يكون 5 أرقام" };
      setAdditionalProperties(updated);
      return;
    }
    if (existingGroupPropertyNumbers.includes(prop.number)) {
      const updated = [...additionalProperties];
      updated[index] = {
        ...updated[index],
        error: "هذا العقار مشمول بالفعل في الاشتراك الحالي",
      };
      setAdditionalProperties(updated);
      return;
    }
    if (additionalProperties.some((item, itemIndex) =>
      itemIndex !== index && item.number === prop.number
    )) {
      const updated = [...additionalProperties];
      updated[index] = {
        ...updated[index],
        error: "تم إدخال هذا العقار مسبقاً",
      };
      setAdditionalProperties(updated);
      return;
    }
    
    setVerifyingProperty(index);
    const updated = [...additionalProperties];
    updated[index] = { ...updated[index], error: "", verifying: true };
    setAdditionalProperties(updated);
    
    try {
      const res = await fetch("/api/owner/verify-second-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondPropertyNumber: prop.number }),
        credentials: "include",
      });
      const data = await res.json();
      
      if (data.ok) {
        updated[index] = { ...updated[index], verified: true, verifying: false, incomplete: false };
        setAdditionalProperties(updated);
        setShowAdditionalPropertyError(false); // Clear error when property is verified
        toast({ title: "تم التحقق", description: `العقار: ${data.property?.name || prop.number}` });
      } else if (data.incomplete) {
        updated[index] = { ...updated[index], verified: false, verifying: false, incomplete: true, missingFields: data.missingFields };
        setAdditionalProperties(updated);
        setIncompletePropertyData(data);
        setShowIncompleteDataDialog(true);
      } else {
        updated[index] = { ...updated[index], error: data.error || "فشل في التحقق", verified: false, verifying: false, incomplete: false };
        setAdditionalProperties(updated);
      }
    } catch (error: any) {
      updated[index] = { ...updated[index], error: error.message || "فشل في التحقق", verified: false, verifying: false, incomplete: false };
      setAdditionalProperties(updated);
    } finally {
      setVerifyingProperty(null);
    }
  };

  // Calculate total price based on additional properties
  // Formula: pkg-price + (addedPropertyCount * propertyPrice)
  const calculateTotalPrice = () => {
    return selectedPackagePricing?.total || 0;
  };

  // Initiate card payment
  const cardPaymentMutation = useMutation({
    mutationFn: async (data: { packageId: string; action: string; billingPeriod: BillingPeriod; discountCode?: string }) => {
      const verifiedProperties = additionalProperties.filter(p => p.verified).map(p => p.number);
      const res = await fetch("/api/owner/payment/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          packageId: data.packageId,
          action: data.action,
          billingPeriod: data.billingPeriod,
          paymentMethod: "cards",
          discountCode: data.discountCode || "",
          additionalProperties: verifiedProperties.length > 0 ? verifiedProperties : undefined,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل بدء الدفع");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.redirectUrl) {
        const paymentWindow = window.open(data.redirectUrl, '_blank');
        if (!paymentWindow) {
          window.location.href = data.redirectUrl;
        }
      } else if (data.checkoutUrl) {
        const paymentWindow = window.open(data.checkoutUrl, '_blank');
        if (!paymentWindow) {
          window.location.href = data.checkoutUrl;
        }
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ في الدفع", description: err.message, variant: "destructive" });
    },
  });

  // Bank transfer payment
  const bankTransferMutation = useMutation({
    mutationFn: async (data: { packageId: string; action: string; billingPeriod: BillingPeriod; receipt: File; discountCode?: string }) => {
      setBankTransferResult(null);
      setPaymentSuccess(false);
      const formData = new FormData();
      formData.append("propertyNumber", property?.propertyNumber || "");
      formData.append("packageId", data.packageId);
      formData.append("action", data.action);
      formData.append("billingPeriod", data.billingPeriod);
      formData.append("receipt", data.receipt);
      if (data.discountCode) formData.append("discountCode", data.discountCode);
      const verifiedProperties = additionalProperties.filter(p => p.verified).map(p => p.number);
      if (verifiedProperties.length > 0) formData.append("additionalProperties", JSON.stringify(verifiedProperties));

      const scanId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      formData.append("scanId", scanId);
      beginReceiptScan(scanId);

      const payload = await postReceiptForm(
        "/api/owner/payment/bank-transfer",
        formData
      );
      return { ...payload, scanId };
    },
    onSuccess: (data) => {
      void finishReceiptScan(data.scanId, data, {
        forceReview: Boolean(
          data.pendingManualReview ||
            data.pendingAdminApproval ||
            data.verificationFailed ||
            data.paymentRejected
        ),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/current-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/payment/check-pending"] });
      if (data.aiScan) {
        setAiScanResult(data.aiScan);
      }
      setBankTransferResult({
        autoActivated: data.autoActivated,
        verificationFailed: data.verificationFailed,
        paymentRejected: data.paymentRejected,
        missingFields: data.missingFields,
        pendingManualReview: data.pendingManualReview,
        pendingAdminApproval: data.pendingAdminApproval,
        message: data.message,
        nextAction: data.nextAction,
        nextUrl: data.nextUrl,
        actionLabel: data.actionLabel,
      });
      setPaymentSuccess(true);
    },
    onError: (err: Error) => {
      const { info, visible } = failReceiptScan(err);
      if (!visible) {
        toast({
          title:
            info.outcome === "duplicate"
              ? "الإيصال مستخدم مسبقًا"
              : "تعذر إكمال التحقق",
          description: info.message,
          variant: "destructive",
        });
      }
    },
  });

  // Add-on payment
  const addonPaymentMutation = useMutation({
    mutationFn: async (addOnPackageId: string) => {
      const res = await fetch("/api/owner/addons/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          addOnPackageId,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل في الدفع");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  // Add-on online payment with discount support
  const addonOnlinePaymentMutation = useMutation({
    mutationFn: async (data: { addOnPackageId: string; discountCode?: string }) => {
      const res = await fetch("/api/owner/addons/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          addOnPackageId: data.addOnPackageId,
          discountCode: data.discountCode || "",
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل في الدفع");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  // Add-on bank transfer
  const addonBankTransferMutation = useMutation({
    mutationFn: async (data: { addOnPackageId: string; receipt: File }) => {
      const formData = new FormData();
      formData.append("propertyNumber", property?.propertyNumber || "");
      formData.append("addOnPackageId", data.addOnPackageId);
      formData.append("receipt", data.receipt);

      const scanId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      formData.append("scanId", scanId);
      beginReceiptScan(scanId);

      const payload = await postReceiptForm(
        "/api/owner/addons/bank-transfer",
        formData
      );
      return { ...payload, scanId };
    },
    onSuccess: (data) => {
      // Add-on receipts always remain for manual review by policy.
      void finishReceiptScan(data.scanId, data, { forceReview: true });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/property-addons"] });
      if (data.aiScan) {
        setAddOnAiScanResult(data.aiScan);
      }
      setAddOnPaymentSuccess(true);
    },
    onError: (err: Error) => {
      const { info, visible } = failReceiptScan(err);
      if (!visible) {
        toast({
          title:
            info.outcome === "duplicate"
              ? "الإيصال مستخدم مسبقًا"
              : "تعذر إكمال التحقق",
          description: info.message,
          variant: "destructive",
        });
      }
    },
  });

  // Unlink property mutation
  const unlinkPropertyMutation = useMutation({
    mutationFn: async (linkedPropertyNumber: string) => {
      const res = await fetch(`/api/owner/subscription/linked-properties/${linkedPropertyNumber}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "فشل في فصل العقار");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/current-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/additional-property-requests"] });
      toast({ title: "نجاح", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const ensureAdditionalPropertiesReady = () => {
    // Check if selected package requires additional property
    const isMultiPropertyPackage = selectedPackage && (
      (selectedPackage as any).maxProperties > 1 ||
      selectedPackage.propertyCount === 2 ||
      selectedPackage.id === 'pkg-month-2properties'
    );

    if (
      isMultiPropertyPackage &&
      action !== "extend" &&
      missingIncludedProperties > 0
    ) {
      setShowAdditionalPropertyError(true);
      toast({
        title: "خطأ في البيانات",
        description: `يجب إضافة ${missingIncludedProperties === 1 ? "عقار إضافي واحد" : `${missingIncludedProperties} عقارات إضافية`} لهذه الباقة`,
        variant: "destructive"
      });
      return false;
    }
    return true;
  };

  const goToOwnerPaymentStep = () => {
    if (!ensureAdditionalPropertiesReady()) return;
    setCurrentStep(3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackageId) return;

    if (!ensureAdditionalPropertiesReady()) return;

    if (paymentMethod === "online") {
      cardPaymentMutation.mutate({ packageId: selectedPackageId, action, billingPeriod, discountCode: validatedDiscount?.code });
    } else if (paymentMethod === "bank") {
      if (!receiptFile) {
        toast({ title: "مطلوب", description: "يرجى رفع إيصال التحويل", variant: "destructive" });
        return;
      }
      bankTransferMutation.mutate({ packageId: selectedPackageId, action, billingPeriod, receipt: receiptFile, discountCode: validatedDiscount?.code });
    }
  };

  // Handle add-on purchase submit
  const handleAddOnSubmit = async () => {
    if (!selectedAddOn) return;

    if (addOnPaymentMethod === "online") {
      addonOnlinePaymentMutation.mutate({ 
        addOnPackageId: selectedAddOn.id
      });
    } else if (addOnPaymentMethod === "bank") {
      if (!addOnReceiptFile) {
        toast({ title: "مطلوب", description: "يرجى رفع إيصال التحويل", variant: "destructive" });
        return;
      }
      addonBankTransferMutation.mutate({ 
        addOnPackageId: selectedAddOn.id,
        receipt: addOnReceiptFile
      });
    }
  };

  // حالة الاشتراك الموحدة — تحترم cancelledAt و suspendedAt وتاريخ النهاية
  const subscriptionStatusRecord = {
    status: subscription?.status,
    endDate: subscription?.endDate,
    startDate: subscription?.startDate,
    cancelledAt: subscription?.cancelledAt,
    suspendedAt: subscription?.suspendedAt,
    remainingDurationMs: subscription?.remainingDurationMs,
  };
  const computedSubscriptionStatus = getSubscriptionStatusFromRecord(subscriptionStatusRecord);
  const isSuspended = computedSubscriptionStatus === "suspended";
  const isCancelled = isCancelledSubscription(subscriptionStatusRecord);
  const isExpired = computedSubscriptionStatus === "expired";
  const isFreeSubscription = subscription?.status === "نشط مجاني";

  // Calculate remaining days using shared subscription-utils
  const frozenRemainingDuration = Number(subscription?.remainingDurationMs);
  const remainingDays = isSuspended && Number.isFinite(frozenRemainingDuration)
    ? Math.max(0, Math.ceil(frozenRemainingDuration / (24 * 60 * 60 * 1000)))
    : subscription?.endDate
      ? calculateRemainingDays(subscription.endDate, subscription?.startDate)
      : 0;

  const displayDays = isExpired ? 0 : Math.max(0, remainingDays);
  const hasActiveCurrentSubscription =
    !subscription?.isPlaceholder &&
    (computedSubscriptionStatus === "active" ||
      computedSubscriptionStatus === "expiring" ||
      isFreeSubscription);
  const isNearExpiry = hasActiveCurrentSubscription
    && !isSuspended
    && (computedSubscriptionStatus === "expiring" ||
      (remainingDays >= 0 && remainingDays <= 10));
  const canExtend = Boolean(
    hasActiveCurrentSubscription &&
    !isSuspended &&
    subscription?.endDate &&
    remainingDays >= 0 &&
    remainingDays <= 10,
  );

  // Subscription duration & status
  const subscriptionDuration = subscription?.startDate && subscription?.endDate
    ? calculateSubscriptionDuration(subscription.startDate, subscription.endDate)
    : 0;

  // حالة الاشتراك فقط — حالة الدفع المعلقة تُعرض منفصلة في شريط مستقل
  const subStatus: string =
    computedSubscriptionStatus === "suspended"
      ? "suspended"
      : computedSubscriptionStatus === "expired"
        ? "expired"
        : computedSubscriptionStatus === "expiring"
          ? "expiring"
          : computedSubscriptionStatus === "active"
            ? "active"
            : "inactive";
  // Card color mapping based on status
  const getCardColors = (status: string) => {
    const colors: Record<string, { border: string; bg: string; text: string }> = {
      active: { border: 'border-[#cfe5d6]', bg: 'bg-[#f6fbf7]', text: 'text-[#126b38]' },
      expiring: { border: 'border-[#e2d3a6]', bg: 'bg-[#fdf6e3]', text: 'text-[#80621d]' },
      expired: { border: 'border-[#f1c8c8]', bg: 'bg-[#fff5f5]', text: 'text-[#b42318]' },
      suspended: { border: 'border-[#e6ddc9]', bg: 'bg-[#fffdf8]', text: 'text-[#6f685b]' },
      cancelled: { border: 'border-[#d9cfb8]', bg: 'bg-[#fafaf7]', text: 'text-[#6f685b]' },
      pending: { border: 'border-[#e2d3a6]', bg: 'bg-[#fdf6e3]', text: 'text-[#80621d]' },
      inactive: { border: 'border-[#d9cfb8]', bg: 'bg-[#fafaf7]', text: 'text-[#6f685b]' },
      rejected: { border: 'border-[#f1c8c8]', bg: 'bg-[#fff5f5]', text: 'text-[#b42318]' },
    };
    return colors[status] || colors.expired;
  };
  const cardColors = getCardColors(subStatus);

  // Package name helper
  const getPackageName = (pkgId?: string) => {
    const names: Record<string, string> = {
      'pkg-monthly': 'اشتراك شهري',
      'pkg-month': 'الباقة الذهبية',
      'pkg-month1': 'الباقة الفضية',
      'pkg-special': 'عرض خاص شهرين',
      'pkg-special-2months': 'عرض خاص شهرين',
      'pkg-2months': 'عرض خاص شهرين',
      'pkg-camps': 'باقة المخيمات',
      'pkg-2properties': 'باقة النخبة - عقارين',
      'pkg-month-2properties': 'باقة النخبة - عقارين',
      'pkg-month-2prop': 'باقة النخبة - عقارين',
      'pkg-free': 'الباقة المجانية',
    };
    if (!pkgId) return 'غير محدد';
    return names[pkgId] || packages.find((p: any) => p.id === pkgId)?.name || pkgId;
  };

  // Current package price from subscription
  const currentPackageObj = packages.find((p: any) => p.id === subscription?.packageId);
  const currentPackagePrice = currentPackageObj
    ? calculateSubscriptionPrice(
        currentPackageObj,
        Math.min(
          baseGroupPropertyCount,
          getMaximumPropertyCount(currentPackageObj),
        ),
      ).total
    : 0;
  const latestOwnerPayment = sortPaymentsNewestFirst(paymentsData || [])[0];
  const shouldShowRejectedPaymentNotice =
    pendingPayment &&
    !pendingPayment.hasPending &&
    pendingPayment.payment?.status === "مرفوض" &&
    latestOwnerPayment?.status === "مرفوض";

  // حالة الاشتراك فقط — لا تتأثر بوجود دفعة معلقة
  const subscriptionStatusPalette: Record<string, { bgColor: string; textColor: string }> = {
    active: { bgColor: 'bg-[#f6fbf7]', textColor: 'text-[#126b38]' },
    expiring: { bgColor: 'bg-[#fdf6e3]', textColor: 'text-[#80621d]' },
    expired: { bgColor: 'bg-[#fff5f5]', textColor: 'text-[#b42318]' },
    suspended: { bgColor: 'bg-[#29372f]', textColor: 'text-white' },
    cancelled: { bgColor: 'bg-[#6f685b]', textColor: 'text-white' },
    pending: { bgColor: 'bg-[#fdf6e3]', textColor: 'text-[#80621d]' },
    rejected: { bgColor: 'bg-[#fff5f5]', textColor: 'text-[#b42318]' },
    inactive: { bgColor: 'bg-[#6f685b]', textColor: 'text-white' },
  };
  const subStatusDisplay = {
    label: getSubscriptionDisplayLabel(computedSubscriptionStatus, isFreeSubscription),
    ...(subscriptionStatusPalette[computedSubscriptionStatus] || subscriptionStatusPalette.inactive),
  };
  const subscriptionStartDate = subscription?.startDate ? new Date(subscription.startDate) : null;
  const subscriptionEndDate = subscription?.endDate ? new Date(subscription.endDate) : null;
  const hasValidSubscriptionDates =
    !!subscriptionStartDate &&
    !!subscriptionEndDate &&
    !Number.isNaN(subscriptionStartDate.getTime()) &&
    !Number.isNaN(subscriptionEndDate.getTime());
  const hasSubscriptionDateConflict =
    hasValidSubscriptionDates && subscriptionEndDate!.getTime() < subscriptionStartDate!.getTime();
  const displayedRemainingDays = hasSubscriptionDateConflict ? 0 : displayDays;
  const daysMetricValue = hasSubscriptionDateConflict ? "—" : displayedRemainingDays;
  const daysMetricLabel = hasSubscriptionDateConflict
    ? "غير قابل للحساب"
    : isSuspended
      ? "يوم محفوظ"
    : isExpired
      ? "منتهي"
      : displayedRemainingDays === 0
        ? "اليوم الأخير"
        : "يوم";
  const displayStatusLabel = subStatusDisplay.label;
  const statusBadgeClass = `${subStatusDisplay.bgColor} ${subStatusDisplay.textColor}`;
  const progressPercent =
    !hasValidSubscriptionDates || hasSubscriptionDateConflict || isExpired || subscriptionDuration <= 0
      ? 0
      : Math.max(5, Math.min(100, (remainingDays / Math.max(1, subscriptionDuration)) * 100));

  // ===== عرض موحّد لصفحة الاشتراك =====
  // الباقة المجانية تُعرض باسم «مجانية» وحالة «مجاني» — لا تُعرض «ساري» أبداً.
  const isFreePlan =
    isFreeSubscription ||
    subscription?.packageId === "pkg-free" ||
    (currentPackageObj ? Number(currentPackageObj.price) === 0 : false);
  const planName = isFreePlan ? "مجانية" : currentPackageObj?.name || getPackageName(subscription?.packageId);
  const planDurationDays = currentPackageObj?.duration || subscriptionDuration || null;
  const subscriptionStateText = isSuspended
    ? "موقوف"
    : isCancelled
      ? "ملغي"
      : isExpired
        ? "منتهي"
        : computedSubscriptionStatus === "pending"
          ? "قيد المراجعة"
          : isFreePlan
            ? "مجاني"
            : hasActiveCurrentSubscription
              ? "ساري"
              : "غير نشط";
  // شريط المدة: نسبة المدة المنقضية (0% في البداية) وليست المتبقية.
  const elapsedDays = Math.max(0, subscriptionDuration - displayedRemainingDays);
  const elapsedPercent =
    hasValidSubscriptionDates && !hasSubscriptionDateConflict && subscriptionDuration > 0
      ? Math.max(0, Math.min(100, (elapsedDays / subscriptionDuration) * 100))
      : 0;
  const remainingPercent = Math.max(0, Math.min(100, 100 - elapsedPercent));
  const propertyStatusDisplay = (() => {
    switch (property?.verificationStatus) {
      case "approved":
        return { label: "العقار معتمد", className: "border-[#cfe5d6] bg-[#f6fbf7] text-[#126b38]" };
      case "pending":
        return { label: "العقار قيد الاعتماد", className: "border-[#e2d3a6] bg-[#fdf6e3] text-[#80621d]" };
      case "rejected":
        return { label: "العقار مرفوض", className: "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]" };
      default:
        return { label: "حالة العقار غير محددة", className: "border-stone-200 bg-stone-50 text-stone-700" };
    }
  })();
  const approvedLinkedCount = additionalPropertyRequests?.approvedRequests?.length || 0;
  const visibleLinkedCount = approvedLinkedCount || (currentSubscription?.linkedProperty ? 1 : 0);
  const subscriptionVisualState = (() => {
    if (property?.verificationStatus === "rejected") {
      return {
        tone: "red",
        title: "العقار غير ظاهر حالياً",
        description: "تم رفض اعتماد بيانات العقار. راجع السبب وعدل البيانات قبل متابعة الاشتراك.",
        bannerClass: "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]",
        iconClass: "bg-[#b42318] text-white",
      };
    }
    if (property?.verificationStatus === "pending") {
      return {
        tone: "amber",
        title: "العقار بانتظار الاعتماد",
        description: "الاشتراك لا يعني ظهور العقار قبل اكتمال اعتماد بيانات العقار من الإدارة.",
        bannerClass: "border-[#e2d3a6] bg-[#fdf6e3] text-[#80621d]",
        iconClass: "bg-[#fdf6e3] text-white",
      };
    }
    if (hasSubscriptionDateConflict) {
      return {
        tone: "red",
        title: "تنبيه في تواريخ الاشتراك",
        description: "حالة الاشتراك وحالة العقار كما هي في النظام، لكن الأيام المتبقية لا يمكن حسابها لأن تاريخ البداية بعد تاريخ الانتهاء.",
        bannerClass: "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]",
        iconClass: "bg-[#b42318] text-white",
      };
    }
    if (isSuspended) {
      return {
        tone: "neutral",
        title: "الاشتراك موقوف مؤقتاً",
        description: `تم حفظ ${displayedRemainingDays} يوم. لن تُحتسب مدة التوقف، ويستطيع المسؤول استئناف الاشتراك من لوحة الإدارة.`,
        bannerClass: "border-[#e6ddc9] bg-[#fffdf8] text-[#293129]",
        iconClass: "bg-[#29372f] text-white",
      };
    }
    if (isCancelled) {
      return {
        tone: "red",
        title: "تم إلغاء الاشتراك",
        description: "تم إلغاء هذا الاشتراك. اختر باقة جديدة لاستعادة ظهور العقار في المنصة.",
        bannerClass: "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]",
        iconClass: "bg-[#b42318] text-white",
      };
    }
    if (isExpired) {
      return {
        tone: "red",
        title: "ظهور العقار متوقف",
        description: "الاشتراك منتهي. قم بالتجديد لإعادة ظهور العقار في المنصة.",
        bannerClass: "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]",
        iconClass: "bg-[#b42318] text-white",
      };
    }
    if (isNearExpiry) {
      return {
        tone: "amber",
        title: "الاشتراك ينتهي قريباً",
        description: "يمكنك التجديد الآن لأن المتبقي 10 أيام أو أقل. التجديد يضيف المدة بعد تاريخ الانتهاء الحالي.",
        bannerClass: "border-[#e2d3a6] bg-[#fdf6e3] text-[#80621d]",
        iconClass: "bg-[#fdf6e3] text-white",
      };
    }
    if (subStatus === "active") {
      return {
        tone: "green",
        title: "العقار ظاهر في المنصة",
        description: "الاشتراك نشط وبيانات العقار معتمدة حالياً.",
        bannerClass: "border-[#cfe5d6] bg-[#f6fbf7] text-[#126b38]",
        iconClass: "bg-[#128c47] text-white",
      };
    }
    return {
      tone: "neutral",
      title: "حالة الاشتراك غير نشطة",
      description: "اختر باقة مناسبة أو أكمل الإجراء المطلوب لتفعيل ظهور العقار.",
      bannerClass: "border-stone-200 bg-stone-50 text-stone-900",
      iconClass: "bg-stone-600 text-white",
    };
  })();

  // Filter packages - show upgradable ones
  const availablePackages = packages.filter((pkg: any) => {
    if (!pkg.isActive) return false;
    if (pkg.isVisible === false) return false;
    return true;
  });
  const packagesForPeriod = availablePackages.filter((pkg: any) => {
    const option = getPackageBillingOption(pkg, billingPeriod);
    return option.enabled && option.originalPrice > 0;
  });
  const recommendedPackage = packagesForPeriod.find(
    (pkg: any) => pkg.isRecommended === true,
  );
  // Visual order only: the saved admin order stays untouched. The recommended
  // plan is placed in the centre column of the first row (index 1) so it is the
  // middle card on desktop without rewriting any Firestore data.
  const displayPackagesForPeriod = (() => {
    if (!recommendedPackage || packagesForPeriod.length <= 1) {
      return packagesForPeriod;
    }
    const others = packagesForPeriod.filter(
      (pkg: any) => pkg.id !== recommendedPackage.id,
    );
    const ordered = [...others];
    ordered.splice(Math.min(1, ordered.length), 0, recommendedPackage);
    return ordered;
  })();
  const packagesGridClass =
    displayPackagesForPeriod.length === 1
      ? "mx-auto grid max-w-md grid-cols-1 gap-5"
      : displayPackagesForPeriod.length === 2
        ? "mx-auto grid max-w-3xl grid-cols-1 gap-5 md:grid-cols-2"
        : "grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3";
  const packageAccents = [
    { text: "#4ade80", border: "#2f6b4a", buttonBg: "#128c47", buttonText: "#ffffff" },
    { text: "#f0b429", border: "#c9a859", buttonBg: "#f0b429", buttonText: "#1f1a0f" },
    { text: "#d4a373", border: "#a67c52", buttonBg: "#a67c52", buttonText: "#ffffff" },
    { text: "#a3b18a", border: "#6b7a5a", buttonBg: "#6b7a5a", buttonText: "#ffffff" },
  ];

  // Never keep a package selected after switching to a period it does not
  // support (for example a monthly-only package while viewing 3 months).
  useEffect(() => {
    if (!selectedPackageId) return;
    const selected = packages.find((pkg: any) => pkg.id === selectedPackageId);
    if (!selected) return;
    if (!getPackageBillingOption(selected, billingPeriod).enabled) {
      setSelectedPackageId(null);
    }
  }, [billingPeriod, packages, selectedPackageId]);

  const currentPkgPrice = currentPackagePrice;

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "اعلان": return "bg-[#fdf6e3]";
      case "ابراز": return "bg-purple-500";
      case "تثبيت": return "bg-[#315f92]";
      case "توثيق": return "bg-[#128c47]";
      default: return "bg-[#6f685b]";
    }
  };

  // The receipt scan dialog is rendered in every branch of this page. It must
  // survive the success/loading screens so only the user can close it.
  const receiptScanOverlay = (
    <ReceiptScanOverlay
      open={receiptScan.open}
      stages={receiptScan.stages}
      outcome={receiptScan.outcome}
      title={receiptScan.title}
      message={receiptScan.message}
      reasons={receiptScan.reasons}
      onClose={() => {
        dismissedScanRef.current = receiptScan.scanId;
        stopScanPolling();
        setReceiptScan((prev) => ({ ...prev, open: false }));
      }}
    />
  );

  // Add-on Payment Success Screen
  if (addOnPaymentSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-lg w-full p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-[#fdf6e3] flex items-center justify-center">
              <Clock className="w-10 h-10 text-[#c9951d]" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#293129] mb-2">تم استلام طلبك بنجاح!</h1>
            <p className="text-[#6f685b]">طلب شراء إضافة قيد المراجعة</p>
          </div>
          <div className="bg-[#faf7ef] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[#6f685b] flex items-center gap-2">
                <Home className="w-4 h-4" />رقم العقار
              </span>
              <span className="font-bold text-lg">{property?.propertyNumber}</span>
            </div>
            {selectedAddOn && (
              <div className="flex items-center justify-between">
                <span className="text-[#6f685b]">الإضافة</span>
                <Badge className="bg-[#c9951d] text-white">{selectedAddOn.name}</Badge>
              </div>
            )}
          </div>
          <div className="bg-[#fdf6e3] border border-[#e2d3a6] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#80621d] mt-0.5 flex-shrink-0" />
              <div className="text-right">
                <p className="font-semibold text-[#80621d] mb-1">قيد المراجعة</p>
                <p className="text-sm text-[#80621d]">
                  تم استلام إيصال الدفع. سيتم تفعيل الإضافة بعد التحقق من التحويل البنكي خلال 24 ساعة.
                </p>
              </div>
            </div>
          </div>

          {/* AI Scan Results */}
          {addOnAiScanResult && (
            <div className={`p-4 rounded-lg border ${
              addOnAiScanResult.recommendation === 'تفعيل_تلقائي' 
                ? 'bg-[#f6fbf7] border-[#cfe5d6]' 
                : addOnAiScanResult.recommendation === 'رفض'
                ? 'bg-[#fff5f5] border-[#f1c8c8]'
                : 'bg-[#fdf6e3] border-[#e2d3a6]'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm">نتيجة الفحص الذكي</h4>
                <Badge variant="outline" className={
                  addOnAiScanResult.recommendation === 'تفعيل_تلقائي' 
                    ? 'border-[#cfe5d6] text-[#126b38]' 
                    : addOnAiScanResult.recommendation === 'رفض'
                    ? 'border-[#f1c8c8] text-[#b42318]'
                    : 'border-[#e2d3a6] text-[#80621d]'
                }>
                  {addOnAiScanResult.recommendation === 'تفعيل_تلقائي' && 'مطابق - جاهز للتفعيل'}
                  {addOnAiScanResult.recommendation === 'مراجعة_يدوية' && 'يحتاج مراجعة'}
                  {addOnAiScanResult.recommendation === 'رفض' && 'غير مطابق'}
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#6f685b]">نسبة الأصالة</span>
                    <span className="font-bold">{addOnAiScanResult.authenticityScore}%</span>
                  </div>
                  <Progress value={addOnAiScanResult.authenticityScore} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#6f685b]">نسبة التطابق</span>
                    <span className="font-bold">{addOnAiScanResult.matchScore}%</span>
                  </div>
                  <Progress value={addOnAiScanResult.matchScore} className="h-2" />
                </div>
              </div>

              {addOnAiScanResult.summary && (
                <p className="text-xs text-[#6f685b] bg-white/50 rounded p-2">
                  {addOnAiScanResult.summary}
                </p>
              )}

              <div className="text-xs text-[#6f685b] mt-2 pt-2 border-t border-current/20">
                مستوى الثقة: {addOnAiScanResult.confidence}%
              </div>
            </div>
          )}

          <div className="text-sm text-[#6f685b]">
            <p className="flex items-center justify-center gap-2">
              <Phone className="w-4 h-4" />للاستفسار: 0533220646
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => { setAddOnPaymentSuccess(false); setSelectedAddOn(null); setAddOnStep(1); setAddOnAiScanResult(null); }} className="w-full bg-[#293129] hover:bg-[#293129]">
              العودة لصفحة الاشتراك
            </Button>
          </div>
        </Card>
        {receiptScanOverlay}
      </div>
    );
  }

  if (subLoading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-[#6f685b] border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-[#6f685b]">جاري التحميل...</p>
        </div>
        {receiptScanOverlay}
      </div>
    );
  }

  // Success Screen
  // Helper: translate missing field keys to Arabic labels
  const getMissingFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      name: "اسم العقار",
      whatsappNumber: "رقم الواتساب",
      city: "المدينة",
      direction: "الاتجاه",
      type: "نوع العقار",
      'prices.weekday': "سعر وسط الأسبوع",
      'prices.weekend': "سعر نهاية الأسبوع",
      'prices.overnight': "سعر المبيت",
      'prices.holidays': "سعر الإجازات",
      facilities: "المرافق"
    };
    return labels[field] || field;
  };

  if (paymentSuccess) {
    const isAutoActivated = bankTransferResult?.autoActivated;
    const isVerificationFailed = bankTransferResult?.verificationFailed;
    const isPaymentRejected = bankTransferResult?.paymentRejected;
    const isPendingManualReview = bankTransferResult?.pendingManualReview;
    const isPendingAdminApproval = bankTransferResult?.pendingAdminApproval;
    const missingFields = bankTransferResult?.missingFields;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-lg w-full p-8 text-center space-y-6">
          {isVerificationFailed ? (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-[#fff5f5] flex items-center justify-center">
                  <AlertTriangle className="w-10 h-10 text-[#b42318]" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#b42318] mb-2">فشل التحقق من بيانات العقار</h1>
                <p className="text-[#6f685b]">
                  بيانات العقار غير مكتملة — يرجى إكمال الحقول التالية
                </p>
              </div>
              {missingFields && missingFields.length > 0 && (
                <div className="bg-[#fff5f5] border border-[#f1c8c8] rounded-lg p-4 text-right">
                  <p className="font-semibold text-[#b42318] mb-2">الحقول الناقصة:</p>
                  <div className="space-y-1">
                    {missingFields.map((field, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm text-[#b42318]">
                        <X className="w-3 h-3 flex-shrink-0" />
                        <span>{getMissingFieldLabel(field)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3">
                <Button onClick={() => router.push("/owner/update-property")} className="w-full bg-[#b42318] hover:bg-[#b42318]/90">
                  تعديل بيانات العقار
                </Button>
                <Button onClick={() => router.push("/owner/dashboard")} variant="outline" className="w-full">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          ) : isPaymentRejected ? (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-[#fff5f5] flex items-center justify-center">
                  <AlertTriangle className="w-10 h-10 text-[#b42318]" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#b42318] mb-2">تم رفض الدفع</h1>
                <p className="text-[#6f685b]">
                  {bankTransferResult?.message || "لم نتمكن من قبول إيصال التحويل."}
                </p>
              </div>
              {bankTransferResult?.nextAction && (
                <div className="bg-[#fff5f5] border border-[#f1c8c8] rounded-lg p-4 text-right text-sm text-[#b42318]">
                  {bankTransferResult.nextAction}
                </div>
              )}
              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => router.push(bankTransferResult?.nextUrl || "/owner/subscription")}
                  className="w-full bg-[#b42318] hover:bg-[#b42318]/90"
                >
                  {bankTransferResult?.actionLabel || "إعادة المحاولة"}
                </Button>
                <Button onClick={() => router.push("/owner/dashboard")} variant="outline" className="w-full">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          ) : isAutoActivated ? (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-[#f6fbf7] flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-[#126b38]" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#126b38] mb-2">تم تفعيل اشتراكك بنجاح!</h1>
                <p className="text-[#6f685b]">
                  تم التحقق من دفعك وبيانات عقارك وتفعيل اشتراكك تلقائياً
                </p>
              </div>
              <div className="bg-[#f6fbf7] border border-[#cfe5d6] rounded-lg p-4">
                <div className="flex items-center gap-2 text-[#126b38]">
                  <CheckCircle2 className="w-5 h-5" />
                  <p className="font-semibold">الاشتراك نشط الآن</p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <Button onClick={() => router.push("/owner/dashboard")} className="w-full bg-[#293129] hover:bg-[#293129]">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          ) : isPendingManualReview ? (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-[#fdf6e3] flex items-center justify-center">
                  <Clock className="w-10 h-10 text-[#80621d]" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#80621d] mb-2">الإيصال يحتاج مراجعة يدوية</h1>
                <p className="text-[#6f685b]">
                  {bankTransferResult?.message || "تعذر التحقق من الإيصال تلقائياً. سيتم مراجعته من قبل الإدارة خلال 24 ساعة."}
                </p>
              </div>
              <div className="bg-[#fdf6e3] border border-[#e2d3a6] rounded-lg p-4">
                <div className="flex items-center gap-2 text-[#80621d]">
                  <Clock className="w-5 h-5" />
                  <p className="font-semibold">بانتظار المراجعة</p>
                </div>
                {bankTransferResult?.nextAction && (
                  <p className="mt-2 text-sm text-[#80621d] text-right">
                    {bankTransferResult.nextAction}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {bankTransferResult?.nextUrl && (
                  <Button
                    onClick={() => router.push(bankTransferResult.nextUrl || "/owner/subscription")}
                    className="w-full bg-[#29372f] hover:bg-[#1f2b25]"
                  >
                    {bankTransferResult.actionLabel || "متابعة"}
                  </Button>
                )}
                <Button onClick={() => router.push("/owner/dashboard")} className="w-full bg-[#293129] hover:bg-[#293129]">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-[#fdf6e3] flex items-center justify-center">
                  <Clock className="w-10 h-10 text-[#c9951d]" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#293129] mb-2">تم استلام طلبك بنجاح!</h1>
                <p className="text-[#6f685b]">
                  {isPendingAdminApproval
                    ? (bankTransferResult?.message || "تم التحقق من الدفع والبيانات، وبقي اعتماد الإدارة")
                    : `${action === "upgrade" ? "طلب الترقية" : "طلب التمديد"} قيد المراجعة`}
                </p>
              </div>
              <div className="bg-[#faf7ef] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[#6f685b] flex items-center gap-2">
                    <Home className="w-4 h-4" />رقم العقار
                  </span>
                  <span className="font-bold text-lg">{property?.propertyNumber}</span>
                </div>
                {selectedPackage && (
                  <div className="flex items-center justify-between">
                    <span className="text-[#6f685b]">الباقة</span>
                    <Badge className="bg-[#c9951d] text-white">{selectedPackage.name}</Badge>
                  </div>
                )}
              </div>
              <div className="bg-[#fdf6e3] border border-[#e2d3a6] rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#80621d] mt-0.5 flex-shrink-0" />
                  <div className="text-right">
                    <p className="font-semibold text-[#80621d] mb-1">قيد المراجعة</p>
                    <p className="text-sm text-[#80621d]">
                      {isPendingAdminApproval
                        ? "لا يلزمك إجراء إضافي الآن. سيتم تفعيل الاشتراك بعد اعتماد الإدارة للعقار الجديد."
                        : "تم استلام إيصال الدفع. سيتم تفعيل الاشتراك بعد التحقق من التحويل البنكي خلال 24 ساعة."}
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Scan Results */}
              {aiScanResult && (
                <div className={`p-4 rounded-lg border ${
                  aiScanResult.recommendation === 'تفعيل_تلقائي' 
                    ? 'bg-[#f6fbf7] border-[#cfe5d6]' 
                    : aiScanResult.recommendation === 'رفض'
                    ? 'bg-[#fff5f5] border-[#f1c8c8]'
                    : 'bg-[#fdf6e3] border-[#e2d3a6]'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold text-sm">نتيجة الفحص الذكي</h4>
                    <Badge variant="outline" className={
                      aiScanResult.recommendation === 'تفعيل_تلقائي' 
                        ? 'border-[#cfe5d6] text-[#126b38]' 
                        : aiScanResult.recommendation === 'رفض'
                        ? 'border-[#f1c8c8] text-[#b42318]'
                        : 'border-[#e2d3a6] text-[#80621d]'
                    }>
                      {aiScanResult.recommendation === 'تفعيل_تلقائي' && 'مطابق - جاهز للتفعيل'}
                      {aiScanResult.recommendation === 'مراجعة_يدوية' && 'يحتاج مراجعة'}
                      {aiScanResult.recommendation === 'رفض' && 'غير مطابق'}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#6f685b]">نسبة الأصالة</span>
                        <span className="font-bold">{aiScanResult.authenticityScore}%</span>
                      </div>
                      <Progress value={aiScanResult.authenticityScore} className="h-2" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#6f685b]">نسبة التطابق</span>
                        <span className="font-bold">{aiScanResult.matchScore}%</span>
                      </div>
                      <Progress value={aiScanResult.matchScore} className="h-2" />
                    </div>
                  </div>

                  {aiScanResult.summary && (
                    <p className="text-xs text-[#6f685b] bg-white/50 rounded p-2">
                      {aiScanResult.summary}
                    </p>
                  )}

                  {Array.isArray(aiScanResult.blockers) && aiScanResult.blockers.length > 0 && (
                    <div className="mt-2 rounded bg-[#fff5f5] p-2 text-xs text-[#b42318]">
                      <div className="font-semibold mb-1">سبب المراجعة اليدوية:</div>
                      <ul className="list-disc pr-4 space-y-0.5">
                        {aiScanResult.blockers.map((item: string, index: number) => (
                          <li key={`owner-scan-blocker-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiScanResult.manualReviewReason && (!Array.isArray(aiScanResult.blockers) || aiScanResult.blockers.length === 0) && (
                    <p className="mt-2 rounded bg-[#fff5f5] p-2 text-xs text-[#b42318]">
                      {aiScanResult.manualReviewReason}
                    </p>
                  )}

                  <div className="text-xs text-[#6f685b] mt-2 pt-2 border-t border-current/20">
                    مستوى الثقة: {aiScanResult.confidence}%
                  </div>
                </div>
              )}

              <div className="text-sm text-[#6f685b]">
                <p className="flex items-center justify-center gap-2">
                  <Phone className="w-4 h-4" />للاستفسار: 0533220646
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button onClick={() => router.push("/owner/dashboard")} className="w-full bg-[#293129] hover:bg-[#293129]">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          )}
        </Card>
        {receiptScanOverlay}
      </div>
    );
  }

  // Incomplete Data Dialog

  return (
    <div
      className="min-h-screen bg-[#f5f6f3]"
      style={{ "--riyal-symbol-scale": "0.9" } as CSSProperties}
    >
      {/* Incomplete Data Dialog */}
      <Dialog open={showIncompleteDataDialog} onOpenChange={setShowIncompleteDataDialog}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#80621d]">
              <AlertTriangle className="w-5 h-5" />
              بيانات العقار الإضافي غير مكتملة
            </DialogTitle>
            <DialogDescription className="text-right">
              <p className="mb-3">العقار الإضافي ({incompletePropertyData?.property?.number}) لديه بيانات ناقصة. يجب إكمال بيانات هذا العقار أولاً.</p>
              <p className="font-semibold mb-2">الحقول الناقصة:</p>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {incompletePropertyData?.missingFields?.map((field: string, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-sm bg-[#fdf6e3] p-2 rounded">
                <X className="w-4 h-4 text-[#b42318] flex-shrink-0" />
                <span>{getMissingFieldLabel(field)}</span>
              </div>
            ))}
          </div>
          <div className="bg-[#faf7ef] p-3 rounded-lg mt-3">
            <p className="text-sm text-[#293129]">
              <strong>ملاحظة:</strong> يجب على مالك العقار الإضافي إكمال بياناته في صفحة "تحديث بيانات العقار" أولاً، ثم حاول الإضافة مرة أخرى.
            </p>
          </div>
          <div className="flex gap-3 pt-4 border-t">
            <Button 
              variant="outline" 
              onClick={() => setShowIncompleteDataDialog(false)}
              className="flex-1"
            >
              إغلاق
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <OwnerPageHeader
        title="الاشتراك والمدفوعات"
        description="إدارة باقتك وتجديد اشتراكك والإضافات والمدفوعات"
        backHref="/owner/dashboard"
      />

      <OwnerPageMain className="space-y-5 sm:space-y-6">
        <nav aria-label="أقسام الاشتراك" className="flex gap-2 overflow-x-auto pb-1">
          {[
            ["current-subscription-section", "الاشتراك الحالي"],
            ["packages-section", "الباقات"],
            ["addons-section", "الإضافات"],
            ["linked-properties-section", "العقارات المرتبطة"],
            ["payments-section", "المدفوعات"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="whitespace-nowrap rounded-xl border border-[#e6ddc9] bg-white px-3 py-2 text-xs font-semibold text-[#6f685b] transition-colors hover:border-[#cbb98d] hover:text-[#293129]"
            >
              {label}
            </a>
          ))}
        </nav>

        {/* ===== اشتراكك الحالي — المصدر الوحيد لمعلومات الاشتراك ===== */}
        <section
          id="current-subscription-section"
          data-testid="current-subscription-card"
          className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#29372f] bg-[#29372f] text-[#fffdf8] shadow-[0_18px_45px_rgba(41,55,47,0.16)]"
        >
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#d8bf76]">اشتراكك الحالي</p>
                <h2 className="mt-1 text-3xl font-bold leading-snug text-white">{planName}</h2>
                <p className="mt-1 text-sm text-[#cfd6d0]">
                  عقار رقم {property?.propertyNumber}
                  {property?.name ? ` — ${property.name}` : ""}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  isSuspended
                    ? "border-white/20 bg-white/10 text-white"
                    : isCancelled || isExpired
                      ? "border-[#f1c8c8]/40 bg-[#fff5f5]/10 text-[#f7c9c9]"
                      : isFreePlan
                        ? "border-[#cfe5d6]/40 bg-[#f6fbf7]/10 text-[#d7f0df]"
                        : "border-[#d8bf76]/40 bg-[#d8bf76]/15 text-[#f0ddaa]"
                }`}
              >
                {subscriptionStateText}
              </span>
            </div>

            <dl className="mt-5 grid gap-3">
              <div className="rounded-xl border border-white/12 bg-white/[0.07] p-3">
                <dt className="text-[11px] text-[#aab4ac]">رسوم الاشتراك</dt>
                <dd className="mt-1 text-lg font-bold text-white">
                  {isFreePlan ? "مجاناً" : <PriceDisplay amount={currentPackagePrice} size="sm" />}
                </dd>
              </div>
            </dl>

            <div className="mt-5 rounded-xl border border-white/12 bg-white/[0.06] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-[#aab4ac]">المدة المنقضية</span>
                <span className="font-bold text-[#f0ddaa]">
                  {hasSubscriptionDateConflict ? "غير متاح" : `${Math.round(elapsedPercent)}%`}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full rounded-full bg-[#d8bf76] transition-all"
                  style={{ width: `${hasSubscriptionDateConflict ? 0 : elapsedPercent}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#aab4ac]">
                <span>المتبقي {hasSubscriptionDateConflict ? "—" : `${Math.round(remainingPercent)}%`}</span>
                <span className="font-semibold text-[#f0ddaa]">
                  {hasSubscriptionDateConflict ? "تعارض في التواريخ" : `${displayedRemainingDays} يوم متبقٍ`}
                </span>
              </div>
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-white/[0.06] p-3">
                <dt className="text-[11px] text-[#aab4ac]">تاريخ البداية</dt>
                <dd className="mt-1 text-sm font-bold text-white">
                  {subscription?.startDate ? formatSubDate(subscription.startDate, false) : "غير محدد"}
                </dd>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-3">
                <dt className="text-[11px] text-[#aab4ac]">تاريخ الانتهاء</dt>
                <dd className="mt-1 text-sm font-bold text-white">
                  {subscription?.endDate ? formatSubDate(subscription.endDate, false) : "غير محدد"}
                </dd>
              </div>
            </dl>

            {isSuspended && (
              <p className="mt-4 rounded-xl border border-white/12 bg-white/[0.06] p-3 text-xs leading-6 text-[#cfd6d0]">
                الاشتراك موقوف مؤقتاً. المدة المتبقية محفوظة ولن تُحتسب حتى يستأنف المسؤول الاشتراك.
              </p>
            )}
            {hasSubscriptionDateConflict && (
              <p className="mt-4 rounded-xl border border-[#f1c8c8]/40 bg-[#fff5f5]/10 p-3 text-xs leading-6 text-[#f7c9c9]">
                تواريخ الاشتراك غير متسقة (تاريخ البداية بعد تاريخ الانتهاء). راجع الإدارة لتصحيح التواريخ.
              </p>
            )}
          </div>

          {!isSuspended && (
            <div className="grid gap-2 border-t border-white/10 p-3 sm:grid-cols-2 sm:p-4">
              <Button
                className="h-11 rounded-xl bg-[#d8bf76] text-sm font-bold text-[#29372f] transition-colors hover:bg-[#cbb05f]"
                onClick={() => {
                  setAction(hasActiveCurrentSubscription ? "upgrade" : "new");
                  document.getElementById("packages-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <Zap className="ml-2 h-4 w-4" />
                {hasActiveCurrentSubscription ? "تغيير الباقة" : "اختيار باقة"}
              </Button>
              {canExtend ? (
                <Button
                  className="h-11 rounded-xl border border-white/15 bg-white/10 text-sm font-bold text-white transition-colors hover:bg-white/15"
                  onClick={() => {
                    setAction("extend");
                    setSelectedPackageId(subscription?.packageId || null);
                    setCurrentStep(2);
                  }}
                >
                  <RefreshCcw className="ml-2 h-4 w-4" />
                  تمديد الاشتراك
                </Button>
              ) : (
                <p className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] text-[#aab4ac]">
                  التمديد متاح عند بقاء 10 أيام أو أقل
                </p>
              )}
            </div>
          )}
        </section>

        {/* ===== حالة اعتماد العقار — قسم مستقل تماماً عن الاشتراك ===== */}
        <Card className={`${ownerPanelClass} p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                {property?.verificationStatus === "approved" ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : property?.verificationStatus === "rejected" ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : (
                  <Clock className="h-5 w-5" />
                )}
              </span>
              <div>
                <h2 className="font-bold text-[#293129]">حالة اعتماد العقار</h2>
                <p className="mt-0.5 text-xs text-[#6f685b]">اعتماد العقار مستقل عن حالة الاشتراك</p>
              </div>
            </div>
            <Badge variant="outline" className={`rounded-lg px-3 py-1 text-xs font-bold ${propertyStatusDisplay.className}`}>
              {propertyStatusDisplay.label}
            </Badge>
          </div>

          <p className="mt-4 text-sm leading-6 text-[#6f685b]">
            {property?.verificationStatus === "approved"
              ? "بيانات العقار معتمدة ويمكن للعملاء رؤية العقار في المنصة."
              : property?.verificationStatus === "pending"
                ? "العقار بانتظار اعتماد الإدارة. قد يكون اشتراكك فعالاً، لكن ظهور العقار للعملاء يبدأ بعد الاعتماد."
                : property?.verificationStatus === "rejected"
                  ? "تم رفض اعتماد العقار. راجع بيانات العقار وحدّثها ثم أعد الإرسال."
                  : "لم تكتمل بيانات العقار بعد. أكمل البيانات ليتم اعتماده."}
          </p>

          {property?.verificationStatus !== "approved" && (
            <div className="mt-4">
              <Button
                variant="outline"
                className={ownerSecondaryButtonClass}
                onClick={() => router.push("/owner/update-property")}
              >
                <Edit3 className="ml-2 h-4 w-4" />
                {property?.verificationStatus === "rejected" ? "تعديل بيانات العقار" : "استكمال بيانات العقار"}
              </Button>
            </div>
          )}

          {isSuspended && (
            <div className="mt-4">
              <OwnerAlert tone="info" icon={<PauseCircle className="w-5 h-5" />} title="التحقق موقوف مؤقتاً">
                أوقفت الإدارة التحقق مؤقتاً. لن يمكن تشغيل التحقق حتى يُستأنف الاشتراك.
              </OwnerAlert>
            </div>
          )}

          {!isSuspended && !hasCompletedSmartVerification && property?.verificationStatus === "pending" && pendingPayment?.payment?.status === "نجح - قيد التحقق" && (
            <div className="mt-4">
              <Button
                type="button"
                onClick={runVerification}
                disabled={isRunningVerification}
                className={`w-full ${ownerPrimaryButtonClass}`}
              >
                {isRunningVerification ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري التحقق...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 ml-2" />
                    تحقق من بيانات العقار
                  </>
                )}
              </Button>
            </div>
          )}
        </Card>

        {/* ===== الباقات والترقية والتجديد ===== */}
        <Card id="packages-section" className={`${ownerPanelClass} scroll-mt-24 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                <Crown className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-bold text-[#293129]">الباقات والترقية والتجديد</h2>
                <p className="mt-0.5 text-xs text-[#6f685b]">اختر الباقة المناسبة لك</p>
              </div>
            </div>
            <Badge variant="outline" className="rounded-lg border-[#e6ddc9] bg-[#faf7ef] px-3 py-1 text-xs font-bold text-[#80621d]">
              باقتك الحالية: {planName}
            </Badge>
          </div>

        </Card>

        {/* مفتاح المدة والعنوان — خارج البطاقات وفي منتصف الشاشة */}
        {currentStep === 1 && (
          <div className="scroll-mt-24">
            <div className="flex w-full justify-center">
              <div
                className="inline-flex rounded-full border border-[#e6ddc9] bg-white p-1 shadow-sm"
                role="tablist"
                aria-label="مدة الاشتراك"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={billingPeriod === "monthly"}
                  onClick={() => changeBillingPeriod("monthly")}
                  className={`rounded-full px-5 py-2 text-sm font-bold transition-colors ${
                    billingPeriod === "monthly"
                      ? "bg-[#29372f] text-white shadow"
                      : "text-[#6f685b] hover:text-[#293129]"
                  }`}
                  data-testid="billing-period-monthly"
                >
                  شهري
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={billingPeriod === "quarterly"}
                  onClick={() => changeBillingPeriod("quarterly")}
                  className={`rounded-full px-5 py-2 text-sm font-bold transition-colors ${
                    billingPeriod === "quarterly"
                      ? "bg-[#29372f] text-white shadow"
                      : "text-[#6f685b] hover:text-[#293129]"
                  }`}
                  data-testid="billing-period-quarterly"
                >
                  كل 3 أشهر
                </button>
              </div>
            </div>
            <h2
              className="mt-4 text-center text-xl font-bold text-[#293129] sm:text-2xl"
              data-testid="packages-period-title"
            >
              {billingPeriod === "monthly"
                ? "أسعار الاشتراك الشهري"
                : "أسعار الاشتراك لثلاثة أشهر"}
            </h2>
          </div>
        )}

        {/* ===== نافذة تأكيد فصل العقار ===== */}
        <Dialog open={unlinkPropertyDialog.open} onOpenChange={(open) => setUnlinkPropertyDialog({ ...unlinkPropertyDialog, open })}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>فصل العقار المرتبط</DialogTitle>
              <DialogDescription>
                هل أنت متأكد من فصل العقار رقم {unlinkPropertyDialog.propertyNumber} ({unlinkPropertyDialog.propertyName})؟
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => setUnlinkPropertyDialog({ ...unlinkPropertyDialog, open: false })}>
                إلغاء
              </Button>
              <Button 
                variant="destructive"
                onClick={() => {
                  unlinkPropertyMutation.mutate(unlinkPropertyDialog.propertyNumber);
                  setUnlinkPropertyDialog({ ...unlinkPropertyDialog, open: false });
                }}
              >
                فصل العقار
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ===== اختيار الباقة وملخص الاشتراك ===== */}
        {currentStep === 1 && (
          <div className="mt-5 space-y-5">
            {packagesForPeriod.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#e6ddc9] bg-white p-6 text-center text-sm text-[#6f685b]">
                لا توجد باقات تدعم{" "}
                {billingPeriod === "monthly"
                  ? "الاشتراك الشهري"
                  : "الاشتراك لمدة ثلاثة أشهر"}{" "}
                حالياً.
              </div>
            )}

            <div className={packagesGridClass} data-testid="packages-grid">
              {displayPackagesForPeriod.map((pkg: any, packageIndex: number) => {
                const isCurrentPkg = subscription?.packageId === pkg.id;
                const packageMaxProperties = getMaximumPropertyCount(pkg);
                const packagePricing = calculateSubscriptionPriceForPeriod(
                  pkg,
                  Math.min(baseGroupPropertyCount, packageMaxProperties),
                  billingPeriod,
                );
                const billingOption = getPackageBillingOption(pkg, billingPeriod);
                const isRecommended = pkg.isRecommended === true;
                const includedCount = Math.max(1, packagePricing.includedPropertyCount);
                const isDowngrade =
                  billingPeriod === "monthly" &&
                  action === "upgrade" &&
                  packagePricing.total < currentPkgPrice;
                const isSelected = selectedPackageId === pkg.id;
                const isExpanded = expandedPackages.has(pkg.id);
                const allFeatures = normalizePackageFeatures(pkg.features);
                const featuresToShow = isExpanded ? allFeatures : allFeatures.slice(0, 5);
                const hasMoreFeatures = allFeatures.length > 5;
                const accent = isRecommended
                  ? packageAccents[1]
                  : packageAccents[packageIndex % packageAccents.length];
                const selectedShadow = isSelected
                  ? `0 0 0 2px ${accent.text}, 0 0 0 4px #fafaf7`
                  : undefined;

                return (
                  <div
                    key={pkg.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    className={`relative flex h-full flex-col rounded-2xl border-2 bg-gradient-to-b from-[#232d27] via-[#1f2822] to-[#1a211c] p-6 text-right text-white shadow-xl transition-all cursor-pointer ${isRecommended ? "lg:-translate-y-1" : ""}`}
                    style={{ borderColor: accent.border, boxShadow: selectedShadow }}
                    onClick={() => {
                      setSelectedPackageId(pkg.id);
                      setAction(hasActiveCurrentSubscription ? "upgrade" : "new");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedPackageId(pkg.id);
                        setAction(hasActiveCurrentSubscription ? "upgrade" : "new");
                      }
                    }}
                    data-testid={`package-card-${pkg.id}`}
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {isRecommended && (
                        <Badge className="gap-1 border-0 bg-[#c9951d] text-[#241d0c]">
                          <Star className="h-3 w-3" />
                          موصى بها
                        </Badge>
                      )}
                      {(pkg.featuredBadge || isPremiumSubscriptionType(pkg.type)) && (
                        <Badge className="border border-white/15 bg-white/10 text-white/80">
                          {pkg.featuredBadge || "مميز"}
                        </Badge>
                      )}
                      {isCurrentPkg && (
                        <Badge className="border-0 bg-[#c9951d] text-white">
                          الحالي
                        </Badge>
                      )}
                      {isSelected && (
                        <Badge className="border-0 bg-white text-[#1c241f]">
                          مختار
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isRecommended ? (
                        <Star className="h-5 w-5" style={{ color: accent.text }} />
                      ) : (
                        <ShieldCheck className="h-5 w-5" style={{ color: accent.text }} />
                      )}
                      <h3 className="text-lg font-bold text-white">{pkg.name}</h3>
                    </div>
                    {pkg.description && (
                      <p className="mt-1 text-xs leading-6 text-white/65">
                        {pkg.description}
                      </p>
                    )}

                    <div className="mt-4">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="[&_img]:invert [&_img]:brightness-0">
                          <PriceDisplay
                            amount={packagePricing.basePrice}
                            size="xl"
                            textColor="text-white"
                          />
                        </div>
                        <span className="mb-1 text-xs text-white/60">
                          {billingPeriod === "quarterly" ? "لثلاثة أشهر" : "شهرياً"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/60">
                        {billingPeriod === "quarterly" ? "3 أشهر" : "شهري"} ·{" "}
                        {billingOption.durationDays} يوم
                      </p>
                      {billingOption.discountPercent > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className="text-sm text-white/60">
                            <PriceDisplay
                              amount={billingOption.originalPrice}
                              size="sm"
                              textColor="text-white/60"
                              strike
                            />
                          </div>
                          <Badge
                            className="border-0 text-[#1f1a0f]"
                            style={{ backgroundColor: accent.text }}
                          >
                            خصم {billingOption.discountPercent}%
                          </Badge>
                        </div>
                      )}
                      {packageMaxProperties > 1 && (
                        <p className="mt-2 text-[11px] text-white/55">
                          تشمل {includedCount} عقارات · حتى {packageMaxProperties} عقارات
                        </p>
                      )}
                    </div>

                    {allFeatures.length > 0 && (
                      <ul className="mt-5 space-y-2.5">
                        {featuresToShow.map((feature, index) => (
                          <li key={`${pkg.id}-feature-${index}`} className="flex items-start gap-2">
                            <span className="mt-0.5 flex-none" style={{ color: accent.text }}>
                              <FeatureIcon
                                feature={feature.text}
                                icon={feature.icon}
                                className="h-4 w-4"
                              />
                            </span>
                            <span className="text-sm leading-6 text-white/85">{feature.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {hasMoreFeatures && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedPackages((previous) => {
                            const next = new Set(previous);
                            if (next.has(pkg.id)) {
                              next.delete(pkg.id);
                            } else {
                              next.add(pkg.id);
                            }
                            return next;
                          });
                        }}
                        className="mt-3 w-fit text-xs font-semibold text-white/70 hover:text-white hover:underline"
                      >
                        {isExpanded
                          ? "عرض أقل"
                          : `عرض المزيد (${allFeatures.length - 5}+)`}
                      </button>
                    )}
                    {isDowngrade && (
                      <p className="mt-3 text-xs text-white/60">
                        تخفيض الباقة - ستبدأ من اليوم
                      </p>
                    )}
                    <div className="mt-auto pt-5">
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedPackageId(pkg.id);
                          setAction(hasActiveCurrentSubscription ? "upgrade" : "new");
                          setCurrentStep(2);
                        }}
                        className="h-11 w-full rounded-full text-sm font-bold"
                        style={{ backgroundColor: accent.buttonBg, color: accent.buttonText }}
                        data-testid={`button-subscribe-${pkg.id}`}
                      >
                        اشترك الآن
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ملخص الاختيار وإجراء واحد للمتابعة */}
            <div className="rounded-2xl border border-[#e6ddc9] bg-white p-4 sm:p-5" data-testid="subscription-selection-summary">
              {selectedPackageId && selectedPackage ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-[#293129]">
                      الباقة المختارة: {selectedPackage.name}
                    </p>
                    <p className="text-xs text-[#6f685b]">
                      {billingPeriod === "quarterly" ? "3 أشهر" : "شهري"} ·{" "}
                      {selectedBillingOption?.durationDays ?? selectedPackage.duration} يوم
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#6f685b]">
                      {selectedBillingOption && selectedBillingOption.discountPercent > 0 && (
                        <>
                          <span>السعر الأصلي</span>
                          <PriceDisplay
                            amount={selectedOriginalTotal}
                            size="sm"
                            strike
                          />
                          <span>·</span>
                          <span>الخصم {selectedBillingOption.discountPercent}%</span>
                          <span>·</span>
                        </>
                      )}
                      <span className="font-bold text-[#293129]">السعر النهائي</span>
                      <PriceDisplay
                        amount={selectedPackagePricing?.total || 0}
                        size="sm"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={() => setCurrentStep(2)}
                    className={`h-11 rounded-xl px-6 ${ownerPrimaryButtonClass}`}
                    data-testid="button-continue-subscription"
                  >
                    متابعة الاشتراك
                  </Button>
                </div>
              ) : (
                <p className="text-center text-sm text-[#6f685b]">
                  اختر باقة بالنقر عليها للمتابعة.
                </p>
              )}
            </div>

            {!isExpired && remainingDays > 0 && action === "upgrade" && (
              <OwnerAlert
                tone="warning"
                icon={<AlertTriangle className="w-5 h-5" />}
                title="تنبيه عند تغيير الباقة"
              >
                تغيير الباقة يصفّر العداد الحالي ويبدأ باقة جديدة من اليوم؛ الأيام المتبقية السابقة لن تُرحّل.
              </OwnerAlert>
            )}

            <Card className={`${ownerPanelClass} p-5`}>
              <h3 className="text-sm font-bold text-[#293129]">قواعد الاشتراك والتجديد</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-[#f0eadc] bg-[#fffdf8] p-3">
                  <p className="text-xs font-bold text-[#293129]">الترقية</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#6f685b]">تبدأ من اليوم وتعيد عداد الاشتراك حسب الباقة الجديدة.</p>
                </div>
                <div className="rounded-xl border border-[#f0eadc] bg-[#fffdf8] p-3">
                  <p className="text-xs font-bold text-[#293129]">التجديد</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#6f685b]">متاح عند بقاء 10 أيام أو أقل، وتُضاف المدة بعد تاريخ الانتهاء الحالي.</p>
                </div>
                <div className="rounded-xl border border-[#f0eadc] bg-[#fffdf8] p-3">
                  <p className="text-xs font-bold text-[#293129]">الاشتراك المشترك</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#6f685b]">
                    {visibleLinkedCount > 0 ? `${visibleLinkedCount} عقار ضمن نفس الاشتراك.` : "لا توجد عقارات مرتبطة حالياً."}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Step 2: Subscription summary and additional properties */}
        {currentStep === 2 && selectedPackageId && (
          <Card
            id="owner-subscription-step-2"
            className="mx-auto w-full scroll-mt-24 p-8"
            style={{ order: 2 }}
          >
            <h2 className="text-xl font-bold text-[#293129] mb-6">
              الخطوة 2: ملخص الاشتراك والعقارات
            </h2>
            <div className="space-y-6">

              {/* Selected Package Summary */}
              {selectedPackage && (
                <OwnerPaymentSummary
                  data-testid="owner-subscription-summary"
                  packageName={selectedPackage.name}
                  durationLabel={`${billingPeriod === "quarterly" ? "3 أشهر" : "شهري"} · ${
                    selectedBillingOption?.durationDays ??
                    selectedPackage.duration
                  } يوم`}
                  originalPrice={selectedBillingOption?.originalPrice ?? 0}
                  discountPercent={selectedBillingOption?.discountPercent ?? 0}
                  discountAmount={selectedBillingOption?.discountAmount ?? 0}
                  additionalPropertiesCount={
                    selectedPackagePricing?.additionalPropertyCount ?? 0
                  }
                  additionalPropertiesTotal={selectedAdditionalTotal}
                  finalTotal={calculateTotalPrice()}
                />
              )}

              {/* Additional Properties Input for Multi-Property Packages */}
              {selectedPackage && selectedPackageMaxProperties > 1 && (
                <div className="p-4 bg-[#faf7ef]  border border-[#e6ddc9]  rounded-lg">
                  <h4 className="font-bold text-[#293129]  mb-3 flex items-center gap-2">
                    <Crown className="w-5 h-5" />
                    ربط عقارات إضافية
                  </h4>
                  
                  {/* Existing members are automatically renewed and never re-entered. */}
                  {existingGroupProperties.length > 0 && (
                    <div className="mb-4 p-3 bg-white  rounded-lg border border-[#e6ddc9] ">
                      <p className="mb-2 text-sm font-semibold text-[#293129] ">
                        العقارات المشمولة تلقائياً في التجديد
                      </p>
                      <div className="space-y-2">
                        {existingGroupProperties.map((groupProperty) => (
                          <div
                            key={groupProperty.propertyNumber}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <Home className="w-4 h-4 text-[#315f92]" />
                              <span className="font-bold text-[#315f92]">
                                {groupProperty.propertyNumber}
                              </span>
                              {groupProperty.name && groupProperty.name !== groupProperty.propertyNumber && (
                                <span className="text-[#6f685b]">{groupProperty.name}</span>
                              )}
                            </div>
                            {groupProperty.isMain && (
                              <Badge variant="outline" className="text-xs">رئيسي</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {action === "extend" || missingIncludedProperties === 0 ? (
                    <p className="text-sm mb-4 text-[#6f685b] ">
                      إضافة عقار جديد اختيارية، وسعر كل عقار إضافي{" "}
                      <PriceDisplay
                        amount={selectedPackagePricing?.additionalPropertyPrice || 0}
                        size="sm"
                        className="inline-flex align-middle"
                      />
                      .
                    </p>
                  ) : (
                    <p className={`text-sm mb-4 ${showAdditionalPropertyError ? 'text-[#b42318]  font-semibold' : 'text-[#80621d] '}`}>
                      ⚠️ يجب إضافة {missingIncludedProperties === 1 ? "عقار إضافي واحد" : `${missingIncludedProperties} عقارات إضافية`} لهذه الباقة
                    </p>
                  )}
                  
                  {/* Dynamic property list */}
                  {additionalProperties.map((prop, index) => (
                    <div key={index} className="flex gap-2 mb-3 items-start">
                      <div className="flex-1">
                        <div className="flex gap-2">
                          <Input
                            type="text"
                            placeholder={`رقم العقار الإضافي ${index + 1} (5 أرقام)`}
                            maxLength={5}
                            inputMode="numeric"
                            value={prop.number}
                            onChange={(e) => updateAdditionalPropertyNumber(index, e.target.value)}
                            className="flex-1"
                            disabled={prop.verified}
                          />
                          {!prop.verified ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => verifyAdditionalProperty(index)}
                              disabled={prop.number.length !== 5 || prop.verifying || verifyingProperty !== null}
                              className="border-[#e6ddc9] text-[#6f685b] hover:bg-[#faf7ef]"
                            >
                              {prop.verifying ? "..." : "تحقق"}
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1 text-[#126b38] px-2">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeAdditionalProperty(index)}
                            className="text-[#b42318] hover:text-[#b42318]"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {prop.error && (
                          <p className="text-sm text-[#b42318] mt-1">{prop.error}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Add more properties button */}
                  {baseGroupPropertyCount + additionalProperties.length < selectedPackageMaxProperties && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addAdditionalProperty}
                      className="border-[#e6ddc9] text-[#6f685b] hover:bg-[#faf7ef] w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      إضافة عقار آخر
                    </Button>
                  )}

                  {/* Price summary */}
                  {selectedPackagePricing && (
                    <div className="mt-4 p-3 bg-[#faf7ef]  rounded-lg">
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-[#293129] ">
                            الباقة الأساسية ({selectedPackagePricing.includedPropertyCount} عقارات)
                          </span>
                          <span className="font-bold">
                            <PriceDisplay amount={selectedPackagePricing.basePrice} size="sm" />
                          </span>
                        </div>
                        {additionalProperties.filter(p => p.verified).map((p, idx) => (
                          <div key={idx} className="flex justify-between items-center text-sm">
                            <span className="text-[#293129] ">عقار إضافي ({p.number})</span>
                            <span className="font-bold">
                              {idx < includedNewPropertySlots ? (
                                "مشمول"
                              ) : (
                                <PriceDisplay
                                  amount={selectedPackagePricing.additionalPropertyPrice}
                                  size="sm"
                                />
                              )}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center pt-2 border-t border-[#e6ddc9]">
                          <span className="font-bold text-[#293129] ">الإجمالي</span>
                          <span className="font-bold text-[#293129] ">
                            <PriceDisplay amount={calculateTotalPrice()} size="md" />
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCurrentStep(1)}
                  className="gap-2"
                  data-testid="owner-summary-back"
                >
                  <ChevronRight className="w-4 h-4" />
                  رجوع
                </Button>
                <Button
                  type="button"
                  onClick={goToOwnerPaymentStep}
                  className="flex-1 bg-[#293129] hover:bg-[#293129]"
                  data-testid="owner-summary-continue"
                >
                  متابعة للدفع
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Step 3: Payment Method */}
        {currentStep === 3 && selectedPackageId && (
          <Card
            id="owner-subscription-step-3"
            className="mx-auto w-full scroll-mt-24 p-8"
            style={{ order: 2 }}
          >
            <h2 className="text-xl font-bold text-[#293129] mb-6">
              الخطوة 3: طريقة الدفع
            </h2>
            <form onSubmit={handleSubmit} className="space-y-6">

              <OwnerPaymentSummary
                packageName={selectedPackage?.name ?? ""}
                durationLabel={`${billingPeriod === "quarterly" ? "3 أشهر" : "شهري"} · ${
                  selectedBillingOption?.durationDays ??
                  selectedPackage?.duration ??
                  0
                } يوم`}
                originalPrice={selectedBillingOption?.originalPrice ?? 0}
                discountPercent={selectedBillingOption?.discountPercent ?? 0}
                discountAmount={selectedBillingOption?.discountAmount ?? 0}
                additionalPropertiesCount={
                  selectedPackagePricing?.additionalPropertyCount ?? 0
                }
                additionalPropertiesTotal={selectedAdditionalTotal}
                finalTotal={calculateTotalPrice()}
              />

              {/* Payment Methods */}
              <div>
                <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
                <div className="space-y-3">
                  <div
                    onClick={() => setPaymentMethod("online")}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === "online" ? "border-[#6f685b] bg-[#293129]/5" : "border-[#e6ddc9] hover:border-[#6f685b]/50"}`}
                  >
                    <div className="font-semibold flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-[#293129]" />
                      الدفع الإلكتروني
                    </div>
                    <p className="text-sm text-[#6f685b]">بطاقة ائتمان أو Apple Pay — تفعيل فوري</p>
                  </div>
                  <div
                    onClick={() => setPaymentMethod("bank")}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === "bank" ? "border-[#6f685b] bg-[#293129]/5" : "border-[#e6ddc9] hover:border-[#6f685b]/50"}`}
                  >
                    <div className="font-semibold">تحويل بنكي</div>
                    <p className="text-sm text-[#6f685b]">مع تحميل إيصال التحويل — خلال 24 ساعة</p>
                  </div>
                </div>
              </div>

              {/* Discount Code */}
              <div className="p-4 bg-[#faf7ef] rounded-lg">
                <label className="block text-sm font-semibold mb-2">كود خصم (اختياري)</label>
                <div className="flex gap-2">
                  <Input placeholder="أدخل كود الخصم" value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} />
                  <Button type="button" variant="outline" onClick={validateDiscount} className="border-[#cfe5d6] text-[#126b38] hover:bg-[#f6fbf7]">تحقق</Button>
                </div>
                {validatedDiscount && (
                  <p className="text-sm text-[#126b38] mt-2">✓ سيتم خصم {formatDiscount(validatedDiscount.value, validatedDiscount.type)}</p>
                )}
              </div>

              {/* Bank Receipt */}
              {paymentMethod === "bank" && (
                <div className="p-4 bg-[#faf7ef] rounded-lg space-y-3">
                  <div className="p-5 bg-[#faf7ef] border-2 border-[#e6ddc9] rounded-xl space-y-3">
                    <div className="flex items-center gap-2 mb-3">
                      <CreditCard className="w-6 h-6 text-[#6f685b]" />
                      <p className="font-bold text-lg text-[#293129]">معلومات التحويل البنكي</p>
                    </div>
                    {bankAccount ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-[#6f685b]">البنك</span>
                          <span className="text-base font-bold text-[#293129]">{bankAccount.bankName}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-[#6f685b]">اسم المستفيد</span>
                          <span className="text-base font-bold text-[#293129]">{bankAccount.beneficiaryName}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-[#6f685b]">IBAN</span>
                          <span className="text-base font-bold text-[#293129] tracking-wide font-mono" dir="ltr">{bankAccount.iban}</span>
                        </div>
                        {bankAccount.accountNumber && (
                          <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                            <span className="text-sm font-semibold text-[#6f685b]">رقم الحساب</span>
                            <span className="text-base font-bold text-[#293129] font-mono" dir="ltr">{bankAccount.accountNumber}</span>
                          </div>
                        )}
                        {bankAccount.barcodeUrl && (
                          <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                            <p className="text-sm font-semibold text-[#6f685b] mb-2">باركود الحساب البنكي</p>
                            <img src={bankAccount.barcodeUrl} alt="باركود الحساب البنكي" className="max-w-[200px] mx-auto rounded-lg" />
                          </div>
                        )}
                        <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                          <p className="text-sm font-semibold text-[#6f685b] mb-2">QR Code للدفع</p>
                          <img 
                            src="/assets/bank-qr.png" 
                            alt="QR Code للدفع" 
                            className="max-w-[180px] mx-auto rounded-lg cursor-pointer hover:scale-105 transition-transform"
                            onClick={() => window.open('/assets/bank-qr.png', '_blank')}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-[#315f92] text-center py-4">جاري تحميل بيانات الحساب...</p>
                    )}
                    <div className="mt-3 p-3 bg-[#fdf6e3] border border-[#e2d3a6] rounded-lg space-y-2">
                      <p className="text-sm font-semibold text-[#80621d]">⚠ يرجى كتابة المعلومات التالية في ملاحظات التحويل:</p>
                      <ul className="text-sm text-[#80621d] space-y-1">
                        <li>• الرمز المرجعي: <span className="font-mono font-bold">RWQN-MRQDHB</span></li>
                        <li>• رقم العقار</li>
                      </ul>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
                    <input
                      ref={receiptInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <Button type="button" variant="outline" onClick={() => receiptInputRef.current?.click()} className="w-full gap-2 border-[#e6ddc9] text-[#6f685b] hover:bg-[#faf7ef]">
                      <Upload className="w-4 h-4" />
                      {receiptFile ? receiptFile.name : "اختر صورة الإيصال"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Submit */}
              <div className="flex flex-col-reverse gap-3 pt-6 border-t sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCurrentStep(2)}
                  className="gap-2"
                  data-testid="owner-payment-back"
                >
                  <ChevronRight className="w-4 h-4" />
                  السابق
                </Button>
                <Button
                  type="submit"
                  disabled={!paymentMethod || cardPaymentMutation.isPending || bankTransferMutation.isPending || (paymentMethod === "bank" && !receiptFile)}
                  className="flex-1 bg-[#293129] hover:bg-[#293129]"
                >
                  {cardPaymentMutation.isPending || bankTransferMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin ml-2" />
                      جاري المعالجة...
                    </>
                  ) : action === "upgrade" ? "متابعة للدفع" : "متابعة للدفع"
                  }
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* ===== Add-on Payment Flow (Step 1 & 2) ===== */}
        {selectedAddOn && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[#293129]">شراء إضافة - {selectedAddOn.name}</h2>
              <Button variant="ghost" size="icon" onClick={() => { setSelectedAddOn(null); setAddOnStep(1); }}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Add-on Summary */}
            <div className="p-4 bg-[#faf7ef] rounded-lg flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-[#6f685b]">الإضافة</p>
                <p className="font-bold">{selectedAddOn.name}</p>
                {selectedAddOn.category && (
                  <Badge className={`${getCategoryColor(selectedAddOn.category)} text-white text-xs mt-1`}>
                    {selectedAddOn.category}
                  </Badge>
                )}
              </div>
              <div className="text-left">
                <PriceDisplay amount={selectedAddOn.price} size="lg" />
                <p className="text-xs text-[#6f685b]">{selectedAddOn.duration} يوم</p>
              </div>
            </div>

            {/* Step 2: Payment Method */}
            <div>
              <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
              <div className="space-y-3">
                <div
                  onClick={() => { setAddOnPaymentMethod("online"); setAddOnStep(2); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${addOnStep === 2 && addOnPaymentMethod === "online" ? "border-[#6f685b] bg-[#293129]/5" : "border-[#e6ddc9] hover:border-[#6f685b]/50"}`}
                >
                  <div className="font-semibold flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-[#293129]" />
                    الدفع الإلكتروني
                  </div>
                  <p className="text-sm text-[#6f685b]">بطاقة ائتمان أو Apple Pay — تفعيل فوري</p>
                </div>
                <div
                  onClick={() => { setAddOnPaymentMethod("bank"); setAddOnStep(2); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${addOnStep === 2 && addOnPaymentMethod === "bank" ? "border-[#6f685b] bg-[#293129]/5" : "border-[#e6ddc9] hover:border-[#6f685b]/50"}`}
                >
                  <div className="font-semibold">تحويل بنكي</div>
                  <p className="text-sm text-[#6f685b]">مع تحميل إيصال التحويل — خلال 24 ساعة</p>
                </div>
              </div>
            </div>

            {/* Bank Transfer Details */}
            {addOnPaymentMethod === "bank" && (
              <div className="mt-4 p-4 bg-[#faf7ef] rounded-lg space-y-3">
                <div className="p-5 bg-[#faf7ef] border-2 border-[#e6ddc9] rounded-xl space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <CreditCard className="w-6 h-6 text-[#6f685b]" />
                    <p className="font-bold text-lg text-[#293129]">معلومات التحويل البنكي</p>
                  </div>
                  {bankAccount ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-[#6f685b]">البنك</span>
                        <span className="text-base font-bold text-[#293129]">{bankAccount.bankName}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-[#6f685b]">اسم المستفيد</span>
                        <span className="text-base font-bold text-[#293129]">{bankAccount.beneficiaryName}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-[#6f685b]">IBAN</span>
                        <span className="text-base font-bold text-[#293129] tracking-wide font-mono" dir="ltr">{bankAccount.iban}</span>
                      </div>
                      {bankAccount.accountNumber && (
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-[#6f685b]">رقم الحساب</span>
                          <span className="text-base font-bold text-[#293129] font-mono" dir="ltr">{bankAccount.accountNumber}</span>
                        </div>
                      )}
                      {bankAccount.barcodeUrl && (
                        <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                          <p className="text-sm font-semibold text-[#6f685b] mb-2">باركود الحساب البنكي</p>
                          <img src={bankAccount.barcodeUrl} alt="باركود الحساب البنكي" className="max-w-[200px] mx-auto rounded-lg" />
                        </div>
                      )}
                      <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                        <p className="text-sm font-semibold text-[#6f685b] mb-2">QR Code للدفع</p>
                        <img 
                          src="/assets/bank-qr.png" 
                          alt="QR Code للدفع" 
                          className="max-w-[180px] mx-auto rounded-lg cursor-pointer hover:scale-105 transition-transform"
                          onClick={() => window.open('/assets/bank-qr.png', '_blank')}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-[#315f92] text-center py-4">جاري تحميل بيانات الحساب...</p>
                  )}
                  <div className="mt-3 p-3 bg-[#fdf6e3] border border-[#e2d3a6] rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-[#80621d]">⚠ يرجى كتابة المعلومات التالية في ملاحظات التحويل:</p>
                    <ul className="text-sm text-[#80621d] space-y-1">
                      <li>• الرمز المرجعي: <span className="font-mono font-bold">RWQN-MRQDHB</span></li>
                      <li>• رقم العقار</li>
                    </ul>
                  </div>
                </div>
                
                {/* Receipt Upload */}
                <div>
                  <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setAddOnReceiptFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="add-on-receipt"
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => document.getElementById('add-on-receipt')?.click()}
                    className="w-full gap-2 border-[#e6ddc9] text-[#6f685b] hover:bg-[#faf7ef]"
                  >
                    <Upload className="w-4 h-4" />
                    {addOnReceiptFile ? addOnReceiptFile.name : "اختر صورة الإيصال"}
                  </Button>
                </div>
              </div>
            )}

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-6 border-t mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setSelectedAddOn(null); setAddOnStep(1); }}
                className="gap-2"
              >
                <ChevronRight className="w-4 h-4" />
                رجوع
              </Button>
              <Button
                type="button"
                disabled={!addOnPaymentMethod || addonOnlinePaymentMutation.isPending || addonBankTransferMutation.isPending || (addOnPaymentMethod === "bank" && !addOnReceiptFile)}
                onClick={handleAddOnSubmit}
                className="flex-1 bg-[#293129] hover:bg-[#293129]"
              >
                {(addonOnlinePaymentMutation.isPending || addonBankTransferMutation.isPending) ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                    جاري المعالجة...
                  </>
                ) : addOnPaymentMethod === "online" ? "دفع إلكتروني" : "تأكيد التحويل"}
              </Button>
            </div>
          </Card>
        )}

        {/* Add-ons Section */}
        {addOnPackages && addOnPackages.length > 0 && (
          <Card id="addons-section" className={`${ownerPanelClass} scroll-mt-24 p-5 sm:p-6`}>
            <h2 className="text-xl font-bold text-[#293129] mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-[#c9951d]" />
              الإضافات
            </h2>

            {/* Active Add-ons */}
            {propertyAddons && propertyAddons.filter((a: any) => a.status === "active").length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-[#6f685b] mb-2">إضافاتك النشطة</h3>
                <div className="space-y-2">
                  {propertyAddons.filter((a: any) => a.status === "active").map((addon: any) => {
                    const pkg = addOnPackages.find((p: any) => p.id === addon.addOnPackageId);
                    return (
                      <div key={addon.id} className="flex items-center justify-between p-3 rounded-lg border border-[#cfe5d6] bg-[#f6fbf7]">
                        <div className="flex items-center gap-2">
                          <Badge className={`${getCategoryColor(pkg?.category || "")} text-white text-xs`}>
                            {pkg?.category || "إضافة"}
                          </Badge>
                          <span className="font-semibold text-sm">{pkg?.name || addon.addOnPackageId}</span>
                        </div>
                        {addon.endDate && (
                          <span className="text-xs text-[#6f685b]">
                            حتى {new Date(addon.endDate).toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Available Add-ons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {addOnPackages.filter((p: any) => p.isActive).map((pkg: any) => {
                const alreadyActive = propertyAddons?.some(
                  (a: any) => a.addOnPackageId === pkg.id && a.status === "active"
                );
                return (
                  <div
                    key={pkg.id}
                    className={`p-4 rounded-lg border-2 transition-all ${alreadyActive
                      ? "border-[#cfe5d6] bg-[#f6fbf7]"
                      : "border-[#e6ddc9] hover:border-[#6f685b]/50"
                      }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Badge className={`${getCategoryColor(pkg.category)} text-white text-xs mb-1`}>
                          {pkg.category}
                        </Badge>
                        <h4 className="font-semibold">{pkg.name}</h4>
                        {pkg.description && (
                          <p className="text-xs text-[#6f685b]">{pkg.description}</p>
                        )}
                      </div>
                      <PriceDisplay amount={pkg.price} size="sm" />
                    </div>
                    {alreadyActive ? (
                      <Badge className="bg-[#293129] text-white text-xs">
                        <Check className="w-3 h-3 ml-1" />مفعّل
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full mt-2 rounded-xl bg-[#29372f] px-5 font-bold text-white transition-colors hover:bg-[#1f2b25] sm:w-auto"
                        disabled={addonPaymentMutation.isPending}
                        onClick={() => {
                          setSelectedAddOn(pkg);
                          setAddOnStep(1);
                          setAddOnPaymentMethod(null);
                          setAddOnReceiptFile(null);
                        }}
                      >
                        شراء الإضافة
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}


        {/* ===== الاشتراكات المشتركة والعقارات المرتبطة ===== */}
        <Card id="linked-properties-section" className={`${ownerPanelClass} scroll-mt-24 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                <Home className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-bold text-[#293129]">الاشتراكات المشتركة والعقارات المرتبطة</h2>
                <p className="mt-0.5 text-xs text-[#6f685b]">العقارات التي تشترك معك في نفس الاشتراك</p>
              </div>
            </div>
            <Badge variant="outline" className="rounded-lg border-[#e6ddc9] bg-[#faf7ef] px-3 py-1 text-xs font-bold text-[#80621d]">
              {visibleLinkedCount} عقار
            </Badge>
          </div>

          {currentSubscription?.linkedToMain && (
            <div className="mt-4 rounded-xl border border-[#e6ddc9] bg-[#faf7ef] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[#293129]">مرتبط بعقار رئيسي</p>
                  <p className="mt-1 text-xs text-[#6f685b]">
                    رقم العقار: <span className="font-bold">{currentSubscription.linkedToMain.propertyNumber}</span>
                    {currentSubscription.linkedToMain.name ? ` — ${currentSubscription.linkedToMain.name}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-lg border-[#e6ddc9] bg-white px-3 py-1 text-xs font-bold text-[#6f685b]">
                  {currentSubscription.linkedToMain.subscriptionStatus === "نشط" ? "نشط" : currentSubscription.linkedToMain.subscriptionStatus || "غير نشط"}
                </Badge>
              </div>
            </div>
          )}

          {additionalPropertyRequests?.approvedRequests?.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-bold text-[#6f685b]">العقارات المرتبطة</p>
              {additionalPropertyRequests.approvedRequests.map((req: any, idx: number) => (
                <div key={idx} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#cfe5d6] bg-[#f6fbf7] p-3">
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-[#126b38]" />
                    <div>
                      <p className="text-sm font-bold text-[#293129]">{req.propertyNumber}</p>
                      <p className="text-xs text-[#6f685b]">{req.name} - {req.city}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-lg border-[#cfe5d6] bg-white px-2 py-1 text-[11px] font-bold text-[#126b38]">تم الربط</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#b42318] hover:bg-[#fff5f5] hover:text-[#b42318]"
                      onClick={() => setUnlinkPropertyDialog({ open: true, propertyNumber: req.propertyNumber, propertyName: req.name })}
                      title="فصل العقار"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {additionalPropertyRequests?.pendingRequests?.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-bold text-[#6f685b]">عقارات قيد المراجعة</p>
              {additionalPropertyRequests.pendingRequests.map((req: any, idx: number) => (
                <div key={idx} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e2d3a6] bg-[#fdf6e3] p-3">
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-[#80621d]" />
                    <div>
                      <p className="text-sm font-bold text-[#293129]">{req.propertyNumber}</p>
                      <p className="text-xs text-[#6f685b]">{req.name} - {req.city}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-lg border-[#e2d3a6] bg-white px-2 py-1 text-[11px] font-bold text-[#80621d]">قيد الانتظار</Badge>
                </div>
              ))}
            </div>
          )}

          {!currentSubscription?.linkedToMain &&
            !(additionalPropertyRequests?.approvedRequests?.length > 0) &&
            !(additionalPropertyRequests?.pendingRequests?.length > 0) && (
              <div className="mt-4">
                <OwnerEmptyState
                  icon={<Home className="w-6 h-6" />}
                  title="لا توجد عقارات مرتبطة"
                  description="عند ربط عقارات إضافية بنفس الاشتراك ستظهر هنا."
                />
              </div>
            )}
        </Card>

        {/* ===== المدفوعات والتحويلات البنكية ===== */}
        <Card id="payments-section" className={`${ownerPanelClass} scroll-mt-24 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-bold text-[#293129]">المدفوعات والتحويلات البنكية</h2>
                <p className="mt-0.5 text-xs text-[#6f685b]">سجل عمليات الدفع على هذا العقار</p>
              </div>
            </div>
            <Badge variant="outline" className="rounded-lg border-[#e6ddc9] bg-[#faf7ef] px-3 py-1 text-xs font-bold text-[#80621d]">
              {paymentsData?.length || 0} عملية
            </Badge>
          </div>

          {pendingPayment?.hasPending && (
            <div className="mt-4">
              <OwnerAlert tone="warning" icon={<Clock className="w-5 h-5" />} title="دفعة قيد المراجعة">
                {pendingPayment.action === "upgrade"
                  ? "سيتم ترقية اشتراكك بعد مراجعة الإيصال."
                  : pendingPayment.action === "extend"
                    ? "سيتم تمديد اشتراكك بعد مراجعة الإيصال."
                    : "سيتم تفعيل اشتراكك بعد مراجعة الإيصال."}
              </OwnerAlert>
            </div>
          )}

          {shouldShowRejectedPaymentNotice && (
            <div className="mt-4">
              <OwnerAlert tone="danger" icon={<AlertTriangle className="w-5 h-5" />} title="تم رفض الدفعة السابقة">
                {pendingPayment.payment?.notes || "يرجى إعادة التحويل ورفع إيصال صحيح."}
              </OwnerAlert>
            </div>
          )}

          {!paymentsData || paymentsData.length === 0 ? (
            <div className="mt-4">
              <OwnerEmptyState
                icon={<CreditCard className="w-6 h-6" />}
                title="لا توجد مدفوعات حتى الآن"
                description="ستظهر هنا عمليات الاشتراك والإضافات بعد إتمامها."
              />
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {sortPaymentsNewestFirst(paymentsData).map((payment: any) => {
                const status = payment.status || "غير محدد";
                const amount = payment.finalAmount || payment.amount || 0;
                const method =
                  payment.paymentMethod === "bank_transfer"
                    ? "تحويل بنكي"
                    : payment.paymentMethod === "paymob"
                      ? "دفع إلكتروني"
                      : payment.paymentMethod || "غير محدد";
                const statusClass =
                  status === "مكتمل"
                    ? "border-[#cfe5d6] bg-[#f6fbf7] text-[#126b38]"
                    : status === "مرفوض" || status === "فشل"
                      ? "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]"
                      : status === "قيد المراجعة" || status === "معلق" || status === "نجح - قيد التحقق"
                        ? "border-[#e2d3a6] bg-[#fdf6e3] text-[#80621d]"
                        : "border-[#e6ddc9] bg-[#fffdf8] text-[#6f685b]";
                const isBank = method === "تحويل بنكي";
                const canUpload =
                  isBank && (status === "معلق" || status === "قيد المراجعة");
                const canRetry =
                  !isBank &&
                  (status === "معلق" || status === "فشل" || status === "قيد المراجعة");
                const canVerify = status === "نجح - قيد التحقق";
                const isExpanded = expandedPaymentId === payment.id;
                return (
                  <div key={payment.id} className="rounded-xl border border-[#f0eadc] bg-[#fffdf8] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-white text-[#9a7623]">
                          <CreditCard className="h-5 w-5" />
                        </span>
                        <div>
                          <div className="text-sm font-bold text-[#293129]">
                            <PriceDisplay amount={amount} size="sm" />
                          </div>
                          <p className="text-[11px] text-[#6f685b]">{method}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6f685b]">
                        <span>{formatSubDate(payment.createdAt || payment.completedAt, false)}</span>
                        <Badge variant="outline" className={`rounded-lg px-2 py-1 text-[11px] font-bold ${statusClass}`}>
                          {status}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={ownerSecondaryButtonClass}
                        onClick={() => setExpandedPaymentId(isExpanded ? null : payment.id)}
                      >
                        {isExpanded ? "إخفاء التفاصيل" : "تفاصيل الدفع"}
                      </Button>
                      {canUpload && (
                        <Button
                          type="button"
                          size="sm"
                          className={ownerPrimaryButtonClass}
                          onClick={() => {
                            setSelectedPaymentForReceipt(payment);
                            setPaymentReceiptFile(null);
                            setPaymentReceiptFeedback(null);
                            setShowReceiptDialog(true);
                          }}
                        >
                          <Upload className="ml-1.5 h-4 w-4" />
                          رفع الإيصال
                        </Button>
                      )}
                      {canRetry && (
                        <Button
                          type="button"
                          size="sm"
                          className={ownerPrimaryButtonClass}
                          disabled={retryPaymentMutation.isPending}
                          onClick={() => retryPaymentMutation.mutate(payment.id)}
                        >
                          إعادة الدفع
                        </Button>
                      )}
                      {canVerify && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={ownerSecondaryButtonClass}
                          disabled={verifyPaymentMutation.isPending}
                          onClick={() => verifyPaymentMutation.mutate(payment.id)}
                        >
                          تحقق من الدفع
                        </Button>
                      )}
                    </div>

                    {isExpanded && (
                      <dl className="mt-3 grid gap-2 rounded-xl bg-[#faf7ef] p-3 text-xs sm:grid-cols-2">
                        <div className="flex justify-between gap-2">
                          <dt className="text-[#6f685b]">رقم العملية</dt>
                          <dd className="font-mono text-[#293129]" dir="ltr">
                            {payment.id || "—"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-[#6f685b]">طريقة الدفع</dt>
                          <dd className="font-semibold text-[#293129]">{method}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-[#6f685b]">التاريخ</dt>
                          <dd className="font-semibold text-[#293129]">
                            {formatSubDate(payment.createdAt || payment.completedAt, false)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-[#6f685b]">الحالة</dt>
                          <dd className="font-semibold text-[#293129]">{status}</dd>
                        </div>
                        {payment.notes && (
                          <div className="sm:col-span-2">
                            <dt className="text-[#6f685b]">ملاحظات</dt>
                            <dd className="mt-1 leading-6 text-[#293129]">{payment.notes}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
          <DialogContent
            dir="rtl"
            className="max-h-[90vh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl border-[#e6ddc9] bg-[#fffdf8] p-5"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#293129]">
                <Upload className="w-5 h-5 text-[#9a7623]" />
                رفع إيصال التحويل البنكي
              </DialogTitle>
              <DialogDescription className="text-xs leading-5 text-[#6f685b]">
                ارفع صورة إيصال التحويل للدفعة المعلقة وسيتم مراجعته من الإدارة.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {selectedPaymentForReceipt && (
                <div className="space-y-2 rounded-xl border border-[#f0eadc] bg-white p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6f685b]">المبلغ</span>
                    <div className="font-bold">
                      <PriceDisplay
                        amount={
                          selectedPaymentForReceipt.finalAmount ||
                          selectedPaymentForReceipt.amount ||
                          0
                        }
                        size="sm"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6f685b]">رقم العملية</span>
                    <span className="font-mono text-xs" dir="ltr">
                      {selectedPaymentForReceipt.id}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#293129]">
                  صورة الإيصال الجديد
                </label>
                <input
                  ref={paymentReceiptInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    setPaymentReceiptFile(e.target.files?.[0] || null);
                    setPaymentReceiptFeedback(null);
                  }}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => paymentReceiptInputRef.current?.click()}
                  className={`h-11 w-full gap-2 ${ownerSecondaryButtonClass}`}
                >
                  <Upload className="w-4 h-4" />
                  {paymentReceiptFile ? paymentReceiptFile.name : "اختر صورة الإيصال"}
                </Button>
              </div>

              {paymentReceiptFeedback && (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    paymentReceiptFeedback.tone === "error"
                      ? "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]"
                      : "border-[#e2d3a6] bg-[#fdf6e3] text-[#80621d]"
                  }`}
                >
                  <p className="font-semibold">{paymentReceiptFeedback.title}</p>
                  <p className="mt-1 text-xs leading-5">{paymentReceiptFeedback.message}</p>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className={ownerSecondaryButtonClass}
                  onClick={() => setShowReceiptDialog(false)}
                >
                  إلغاء
                </Button>
                <Button
                  type="button"
                  onClick={handlePaymentReceiptUpload}
                  disabled={!paymentReceiptFile || isUploadingPaymentReceipt}
                  className={`h-11 flex-1 ${ownerPrimaryButtonClass}`}
                >
                  {isUploadingPaymentReceipt ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin ml-2" />
                      جاري الرفع...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 ml-2" />
                      رفع الإيصال
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </OwnerPageMain>
      <OwnerMobileNavigation />
      {receiptScanOverlay}
    </div>
  );
}
