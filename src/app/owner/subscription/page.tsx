"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PriceDisplay } from "@/components/price-display";
import { formatDiscount } from "@/lib/currency";
import { Progress } from "@/components/ui/progress";
import {
  Crown, CreditCard, Check, ChevronRight, Clock, Home,
  Star, Zap, Upload, AlertTriangle, RefreshCcw, CheckCircle2, Phone, ArrowLeft,
  Calendar, Timer, Banknote, Info, X, Loader2, Plus, Trash2, PauseCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import {
  calculateRemainingDays,
  calculateSubscriptionDuration,
  getSubscriptionStatus,
  getStatusInfo,
  formatDate as formatSubDate,
  canExtendSubscription,
} from "@/lib/subscription-utils";
import { getSubscriptionTypeLabel, isPremiumSubscriptionType, isSubscriptionStatusActive } from "@shared/subscriptionType";
import {
  OwnerMobileNavigation,
  OwnerPageHeader,
  OwnerPageMain,
} from "@/components/owner/owner-page";
import { runOwnerManualVerification } from "@/lib/owner-verification";
import { getOwnerPendingPaymentRefetchInterval } from "@/lib/workflow-query-refresh";

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

  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
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

  // Get linked property subscription data
  const { data: linkedPropertySubscription } = useQuery<any>({
    queryKey: ["linked-property-subscription", currentSubscription?.linkedProperty],
    queryFn: async () => {
      if (!currentSubscription?.linkedProperty) return null;
      const res = await fetch(`/api/owner/subscription/${currentSubscription.linkedProperty}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!currentSubscription?.linkedProperty,
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
        if (!data.isLoggedIn) router.push("/owner/login");
      })
      .catch(() => router.push("/owner/login"));
  }, [router]);

  // Fetch current property
  const { data: property } = useQuery<any>({
    queryKey: ["/api/owner/property"],
  });

  // Fetch current subscription
  const { data: subscription, isLoading: subLoading } = useQuery<any>({
    queryKey: ["/api/owner/current-subscription"],
  });

  // Fetch available packages
  const { data: rawPackages = [] } = useQuery<any[]>({
    queryKey: ["/api/packages"],
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

  // Owner self-service smart verification
  const [isRunningVerification, setIsRunningVerification] = useState(false);
  const hasCompletedSmartVerification =
    property?.verificationStatus === "approved" ||
    property?.verificationStatus === "verified" ||
    property?.smartVerificationPassed === true;
  const runVerification = async () => {
    if (isRunningVerification || hasCompletedSmartVerification) return;

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
    const maxProps = (selectedPackage as any)?.maxProperties || 2;
    if (additionalProperties.length >= maxProps - 1) {
      toast({ title: "الحد الأقصى", description: `الحد الأقصى للعقارات الإضافية هو ${maxProps - 1}`, variant: "destructive" });
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
    const prop = additionalProperties[index];
    if (!prop.number || prop.number.length !== 5) {
      const updated = [...additionalProperties];
      updated[index] = { ...updated[index], error: "رقم العقار يجب أن يكون 5 أرقام" };
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
    const verifiedCount = additionalProperties.filter(p => p.verified).length;
    if (!selectedPackage) return 0;
    const pkgPrice = (selectedPackage as any).price || 25;
    const propertyPrice = pkgPrice || 25;
    // First property = pkgPrice, each additional adds propertyPrice
    return pkgPrice + (verifiedCount * propertyPrice);
  };

  // Initiate card payment
  const cardPaymentMutation = useMutation({
    mutationFn: async (data: { packageId: string; action: string; discountCode?: string }) => {
      const verifiedProperties = additionalProperties.filter(p => p.verified).map(p => p.number);
      const res = await fetch("/api/owner/payment/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          packageId: data.packageId,
          action: data.action,
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
    mutationFn: async (data: { packageId: string; action: string; receipt: File; discountCode?: string }) => {
      setBankTransferResult(null);
      setPaymentSuccess(false);
      const formData = new FormData();
      formData.append("propertyNumber", property?.propertyNumber || "");
      formData.append("packageId", data.packageId);
      formData.append("action", data.action);
      formData.append("receipt", data.receipt);
      if (data.discountCode) formData.append("discountCode", data.discountCode);
      const verifiedProperties = additionalProperties.filter(p => p.verified).map(p => p.number);
      if (verifiedProperties.length > 0) formData.append("additionalProperties", JSON.stringify(verifiedProperties));

      const res = await fetch("/api/owner/payment/bank-transfer", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل إرسال التحويل");
      }
      return res.json();
    },
    onSuccess: (data) => {
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
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
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

      const res = await fetch("/api/owner/addons/bank-transfer", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل في إرسال التحويل");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/property-addons"] });
      if (data.aiScan) {
        setAddOnAiScanResult(data.aiScan);
      }
      setAddOnPaymentSuccess(true);
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackageId) return;

    // Check if selected package requires additional property
    const isMultiPropertyPackage = selectedPackage && (
      (selectedPackage as any).maxProperties > 1 || 
      selectedPackage.propertyCount === 2 || 
      selectedPackage.id === 'pkg-month-2properties'
    );
    
    const verifiedAdditionalCount = additionalProperties.filter(p => p.verified).length;
    
    if (isMultiPropertyPackage && verifiedAdditionalCount === 0) {
      setShowAdditionalPropertyError(true);
      toast({ 
        title: "خطأ في البيانات", 
        description: "يجب إضافة عقار إضافي واحد على الأقل للباقات المتعددة", 
        variant: "destructive" 
      });
      return;
    }

    if (paymentMethod === "online") {
      cardPaymentMutation.mutate({ packageId: selectedPackageId, action, discountCode: validatedDiscount?.code });
    } else if (paymentMethod === "bank") {
      if (!receiptFile) {
        toast({ title: "مطلوب", description: "يرجى رفع إيصال التحويل", variant: "destructive" });
        return;
      }
      bankTransferMutation.mutate({ packageId: selectedPackageId, action, receipt: receiptFile, discountCode: validatedDiscount?.code });
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

  // Calculate remaining days using shared subscription-utils
  const isSuspended = subscription?.status === "موقوف مؤقتاً";
  const frozenRemainingDuration = Number(subscription?.remainingDurationMs);
  const remainingDays = isSuspended && Number.isFinite(frozenRemainingDuration)
    ? Math.max(0, Math.ceil(frozenRemainingDuration / (24 * 60 * 60 * 1000)))
    : subscription?.endDate
      ? calculateRemainingDays(subscription.endDate, subscription?.startDate)
      : 0;
  
  const displayDays = Math.max(0, remainingDays);
  const isExpired = !isSuspended && remainingDays < 0;
  const hasActiveCurrentSubscription =
    !subscription?.isPlaceholder &&
    isSubscriptionStatusActive(subscription?.status, isExpired);
  const isNearExpiry = hasActiveCurrentSubscription
    && !isSuspended
    && remainingDays >= 0
    && remainingDays <= 10;
  const canExtend = Boolean(
    hasActiveCurrentSubscription &&
    !isSuspended &&
    subscription?.endDate &&
    canExtendSubscription(subscription.endDate, subscription?.status),
  );

  // Subscription duration & status
  const subscriptionDuration = subscription?.startDate && subscription?.endDate
    ? calculateSubscriptionDuration(subscription.startDate, subscription.endDate)
    : 0;
  
  // Determine subscription status based on pending payment from check-pending API
  // AND property verification status
  let subStatus: string;
  
  // A suspended subscription keeps its own lifecycle state regardless of property review.
  if (isSuspended) {
    subStatus = 'suspended';
  }
  // First check: if property is rejected → show rejected
  else if (property?.verificationStatus === 'rejected') {
    console.log("[DEBUG] Property is rejected, showing rejected status");
    subStatus = 'rejected';
  }
  // Second check: if property is pending → show pending
  else if (property?.verificationStatus === 'pending') {
    console.log("[DEBUG] Property is pending, showing pending status");
    subStatus = 'pending';
  }
  // Third check: if there's a pending payment → pending (قيد المراجعة)
  else if (pendingPayment?.hasPending) {
    console.log("[DEBUG] Has pending payment, showing pending status");
    subStatus = 'pending';
  } 
  // Fourth check: if subscription exists and is active → show based on subscription
  else if (subscription?.endDate) {
    // Use the utility function for normal status
    subStatus = getSubscriptionStatus(subscription.endDate, subscription?.status);
    console.log("[DEBUG] Using subscription status:", subStatus);
  } else {
    // No subscription → inactive (غير نشط)
    console.log("[DEBUG] No subscription, showing inactive");
    subStatus = 'inactive';
  }
  const statusInfo = getStatusInfo(subStatus as any);

  // Card color mapping based on status
  const getCardColors = (status: string) => {
    const colors: Record<string, { border: string; bg: string; text: string }> = {
      active: { border: 'border-green-500', bg: 'bg-green-50', text: 'text-green-700' },
      expiring: { border: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-700' },
      expired: { border: 'border-red-400', bg: 'bg-red-50', text: 'text-red-700' },
      suspended: { border: 'border-slate-400', bg: 'bg-slate-50', text: 'text-slate-700' },
      cancelled: { border: 'border-gray-400', bg: 'bg-gray-50', text: 'text-gray-700' },
      pending: { border: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-700' },
      inactive: { border: 'border-gray-400', bg: 'bg-gray-50', text: 'text-gray-700' },
      rejected: { border: 'border-red-600', bg: 'bg-red-50', text: 'text-red-700' },
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
  const latestOwnerPayment = sortPaymentsNewestFirst(paymentsData || [])[0];
  const shouldShowRejectedPaymentNotice =
    pendingPayment &&
    !pendingPayment.hasPending &&
    pendingPayment.payment?.status === "مرفوض" &&
    latestOwnerPayment?.status === "مرفوض";

  // Get subscription status with custom Arabic labels for display
  const getSubscriptionDisplayStatus = () => {
    const status = subscription?.status;
    const isFree = status === 'نشط مجاني';
    
    if (subStatus === 'expired') {
      return { label: 'منتهي', bgColor: 'bg-red-500', textColor: 'text-white' };
    }
    if (subStatus === 'suspended') {
      return { label: 'موقوف مؤقتاً', bgColor: 'bg-slate-600', textColor: 'text-white' };
    }
    if (subStatus === 'expiring') {
      return { label: 'ينتهي قريباً', bgColor: 'bg-amber-500', textColor: 'text-white' };
    }
    if (isFree) {
      return { label: 'نشط مجاني', bgColor: 'bg-blue-500', textColor: 'text-white' };
    }
    if (subStatus === 'active') {
      return { label: 'مفعل', bgColor: 'bg-green-500', textColor: 'text-white' };
    }
    return { label: 'غير نشط', bgColor: 'bg-gray-400', textColor: 'text-white' };
  };
  const subStatusDisplay = getSubscriptionDisplayStatus();
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
  const propertyStatusDisplay = (() => {
    switch (property?.verificationStatus) {
      case "approved":
        return { label: "العقار معتمد", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
      case "pending":
        return { label: "العقار قيد الاعتماد", className: "border-amber-200 bg-amber-50 text-amber-700" };
      case "rejected":
        return { label: "العقار مرفوض", className: "border-red-200 bg-red-50 text-red-700" };
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
        bannerClass: "border-red-200 bg-red-50 text-red-900",
        iconClass: "bg-red-600 text-white",
      };
    }
    if (property?.verificationStatus === "pending") {
      return {
        tone: "amber",
        title: "العقار بانتظار الاعتماد",
        description: "الاشتراك لا يعني ظهور العقار قبل اكتمال اعتماد بيانات العقار من الإدارة.",
        bannerClass: "border-amber-200 bg-amber-50 text-amber-900",
        iconClass: "bg-amber-500 text-white",
      };
    }
    if (hasSubscriptionDateConflict) {
      return {
        tone: "red",
        title: "تنبيه في تواريخ الاشتراك",
        description: "حالة الاشتراك وحالة العقار كما هي في النظام، لكن الأيام المتبقية لا يمكن حسابها لأن تاريخ البداية بعد تاريخ الانتهاء.",
        bannerClass: "border-red-200 bg-red-50 text-red-900",
        iconClass: "bg-red-600 text-white",
      };
    }
    if (isSuspended) {
      return {
        tone: "neutral",
        title: "الاشتراك موقوف مؤقتاً",
        description: `تم حفظ ${displayedRemainingDays} يوم. لن تُحتسب مدة التوقف، ويستطيع المسؤول استئناف الاشتراك من لوحة الإدارة.`,
        bannerClass: "border-slate-200 bg-slate-50 text-slate-900",
        iconClass: "bg-slate-600 text-white",
      };
    }
    if (isExpired) {
      return {
        tone: "red",
        title: "ظهور العقار متوقف",
        description: "الاشتراك منتهي. قم بالتجديد لإعادة ظهور العقار في المنصة.",
        bannerClass: "border-red-200 bg-red-50 text-red-900",
        iconClass: "bg-red-600 text-white",
      };
    }
    if (isNearExpiry) {
      return {
        tone: "amber",
        title: "الاشتراك ينتهي قريباً",
        description: "يمكنك التجديد الآن لأن المتبقي 10 أيام أو أقل. التجديد يضيف المدة بعد تاريخ الانتهاء الحالي.",
        bannerClass: "border-amber-200 bg-amber-50 text-amber-900",
        iconClass: "bg-amber-500 text-white",
      };
    }
    if (subStatus === "active") {
      return {
        tone: "green",
        title: "العقار ظاهر في المنصة",
        description: "الاشتراك نشط وبيانات العقار معتمدة حالياً.",
        bannerClass: "border-emerald-200 bg-emerald-50 text-emerald-900",
        iconClass: "bg-emerald-600 text-white",
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
    if (pkg.price === 0) return false;
    return true;
  });

  const currentPkgPrice = currentPackageObj?.price || 0;

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "اعلان": return "bg-amber-500";
      case "ابراز": return "bg-purple-500";
      case "تثبيت": return "bg-blue-500";
      case "توثيق": return "bg-emerald-500";
      default: return "bg-slate-500";
    }
  };

  // Add-on Payment Success Screen
  if (addOnPaymentSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-lg w-full p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-10 h-10 text-[#c9951d]" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#434040] mb-2">تم استلام طلبك بنجاح!</h1>
            <p className="text-muted-foreground">طلب شراء إضافة قيد المراجعة</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Home className="w-4 h-4" />رقم العقار
              </span>
              <span className="font-bold text-lg">{property?.propertyNumber}</span>
            </div>
            {selectedAddOn && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الإضافة</span>
                <Badge className="bg-[#c9951d] text-white">{selectedAddOn.name}</Badge>
              </div>
            )}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-right">
                <p className="font-semibold text-amber-800 mb-1">قيد المراجعة</p>
                <p className="text-sm text-amber-700">
                  تم استلام إيصال الدفع. سيتم تفعيل الإضافة بعد التحقق من التحويل البنكي خلال 24 ساعة.
                </p>
              </div>
            </div>
          </div>

          {/* AI Scan Results */}
          {addOnAiScanResult && (
            <div className={`p-4 rounded-lg border ${
              addOnAiScanResult.recommendation === 'تفعيل_تلقائي' 
                ? 'bg-emerald-50 border-emerald-300' 
                : addOnAiScanResult.recommendation === 'رفض'
                ? 'bg-red-50 border-red-300'
                : 'bg-amber-50 border-amber-300'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm">نتيجة الفحص الذكي</h4>
                <Badge variant="outline" className={
                  addOnAiScanResult.recommendation === 'تفعيل_تلقائي' 
                    ? 'border-emerald-500 text-emerald-600' 
                    : addOnAiScanResult.recommendation === 'رفض'
                    ? 'border-red-500 text-red-600'
                    : 'border-amber-500 text-amber-600'
                }>
                  {addOnAiScanResult.recommendation === 'تفعيل_تلقائي' && 'مطابق - جاهز للتفعيل'}
                  {addOnAiScanResult.recommendation === 'مراجعة_يدوية' && 'يحتاج مراجعة'}
                  {addOnAiScanResult.recommendation === 'رفض' && 'غير مطابق'}
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">نسبة الأصالة</span>
                    <span className="font-bold">{addOnAiScanResult.authenticityScore}%</span>
                  </div>
                  <Progress value={addOnAiScanResult.authenticityScore} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">نسبة التطابق</span>
                    <span className="font-bold">{addOnAiScanResult.matchScore}%</span>
                  </div>
                  <Progress value={addOnAiScanResult.matchScore} className="h-2" />
                </div>
              </div>

              {addOnAiScanResult.summary && (
                <p className="text-xs text-muted-foreground bg-white/50 rounded p-2">
                  {addOnAiScanResult.summary}
                </p>
              )}

              <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-current/20">
                مستوى الثقة: {addOnAiScanResult.confidence}%
              </div>
            </div>
          )}

          <div className="text-sm text-muted-foreground">
            <p className="flex items-center justify-center gap-2">
              <Phone className="w-4 h-4" />للاستفسار: 0533220646
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => { setAddOnPaymentSuccess(false); setSelectedAddOn(null); setAddOnStep(1); setAddOnAiScanResult(null); }} className="w-full bg-[#434040] hover:bg-[#333]">
              العودة لصفحة الاشتراك
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (subLoading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-[#434040] border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-muted-foreground">جاري التحميل...</p>
        </div>
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
                <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-10 h-10 text-red-500" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-red-700 mb-2">فشل التحقق من بيانات العقار</h1>
                <p className="text-muted-foreground">
                  بيانات العقار غير مكتملة — يرجى إكمال الحقول التالية
                </p>
              </div>
              {missingFields && missingFields.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-right">
                  <p className="font-semibold text-red-800 mb-2">الحقول الناقصة:</p>
                  <div className="space-y-1">
                    {missingFields.map((field, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm text-red-700">
                        <X className="w-3 h-3 flex-shrink-0" />
                        <span>{getMissingFieldLabel(field)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3">
                <Button onClick={() => router.push("/owner/update-property")} className="w-full bg-red-600 hover:bg-red-700">
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
                <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-10 h-10 text-red-500" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-red-700 mb-2">تم رفض الدفع</h1>
                <p className="text-muted-foreground">
                  {bankTransferResult?.message || "لم نتمكن من قبول إيصال التحويل."}
                </p>
              </div>
              {bankTransferResult?.nextAction && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-right text-sm text-red-700">
                  {bankTransferResult.nextAction}
                </div>
              )}
              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => router.push(bankTransferResult?.nextUrl || "/owner/subscription")}
                  className="w-full bg-red-600 hover:bg-red-700"
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
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-emerald-700 mb-2">تم تفعيل اشتراكك بنجاح!</h1>
                <p className="text-muted-foreground">
                  تم التحقق من دفعك وبيانات عقارك وتفعيل اشتراكك تلقائياً
                </p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="w-5 h-5" />
                  <p className="font-semibold">الاشتراك نشط الآن</p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <Button onClick={() => router.push("/owner/dashboard")} className="w-full bg-[#434040] hover:bg-[#333]">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          ) : isPendingManualReview ? (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center">
                  <Clock className="w-10 h-10 text-orange-500" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-orange-700 mb-2">الإيصال يحتاج مراجعة يدوية</h1>
                <p className="text-muted-foreground">
                  {bankTransferResult?.message || "تعذر التحقق من الإيصال تلقائياً. سيتم مراجعته من قبل الإدارة خلال 24 ساعة."}
                </p>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-orange-700">
                  <Clock className="w-5 h-5" />
                  <p className="font-semibold">بانتظار المراجعة</p>
                </div>
                {bankTransferResult?.nextAction && (
                  <p className="mt-2 text-sm text-orange-700 text-right">
                    {bankTransferResult.nextAction}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {bankTransferResult?.nextUrl && (
                  <Button
                    onClick={() => router.push(bankTransferResult.nextUrl || "/owner/subscription")}
                    className="w-full bg-orange-600 hover:bg-orange-700"
                  >
                    {bankTransferResult.actionLabel || "متابعة"}
                  </Button>
                )}
                <Button onClick={() => router.push("/owner/dashboard")} className="w-full bg-[#434040] hover:bg-[#333]">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
                  <Clock className="w-10 h-10 text-[#c9951d]" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#434040] mb-2">تم استلام طلبك بنجاح!</h1>
                <p className="text-muted-foreground">
                  {isPendingAdminApproval
                    ? (bankTransferResult?.message || "تم التحقق من الدفع والبيانات، وبقي اعتماد الإدارة")
                    : `${action === "upgrade" ? "طلب الترقية" : "طلب التمديد"} قيد المراجعة`}
                </p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Home className="w-4 h-4" />رقم العقار
                  </span>
                  <span className="font-bold text-lg">{property?.propertyNumber}</span>
                </div>
                {selectedPackage && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">الباقة</span>
                    <Badge className="bg-[#c9951d] text-white">{selectedPackage.name}</Badge>
                  </div>
                )}
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-right">
                    <p className="font-semibold text-amber-800 mb-1">قيد المراجعة</p>
                    <p className="text-sm text-amber-700">
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
                    ? 'bg-emerald-50 border-emerald-300' 
                    : aiScanResult.recommendation === 'رفض'
                    ? 'bg-red-50 border-red-300'
                    : 'bg-amber-50 border-amber-300'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold text-sm">نتيجة الفحص الذكي</h4>
                    <Badge variant="outline" className={
                      aiScanResult.recommendation === 'تفعيل_تلقائي' 
                        ? 'border-emerald-500 text-emerald-600' 
                        : aiScanResult.recommendation === 'رفض'
                        ? 'border-red-500 text-red-600'
                        : 'border-amber-500 text-amber-600'
                    }>
                      {aiScanResult.recommendation === 'تفعيل_تلقائي' && 'مطابق - جاهز للتفعيل'}
                      {aiScanResult.recommendation === 'مراجعة_يدوية' && 'يحتاج مراجعة'}
                      {aiScanResult.recommendation === 'رفض' && 'غير مطابق'}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">نسبة الأصالة</span>
                        <span className="font-bold">{aiScanResult.authenticityScore}%</span>
                      </div>
                      <Progress value={aiScanResult.authenticityScore} className="h-2" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">نسبة التطابق</span>
                        <span className="font-bold">{aiScanResult.matchScore}%</span>
                      </div>
                      <Progress value={aiScanResult.matchScore} className="h-2" />
                    </div>
                  </div>

                  {aiScanResult.summary && (
                    <p className="text-xs text-muted-foreground bg-white/50 rounded p-2">
                      {aiScanResult.summary}
                    </p>
                  )}

                  <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-current/20">
                    مستوى الثقة: {aiScanResult.confidence}%
                  </div>
                </div>
              )}

              <div className="text-sm text-muted-foreground">
                <p className="flex items-center justify-center gap-2">
                  <Phone className="w-4 h-4" />للاستفسار: 0533220646
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button onClick={() => router.push("/owner/dashboard")} className="w-full bg-[#434040] hover:bg-[#333]">
                  العودة للوحة التحكم
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  // Incomplete Data Dialog

  return (
    <div className="min-h-screen bg-[#f5f6f3]">
      {/* Incomplete Data Dialog */}
      <Dialog open={showIncompleteDataDialog} onOpenChange={setShowIncompleteDataDialog}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
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
              <div key={idx} className="flex items-center gap-2 text-sm bg-amber-50 p-2 rounded">
                <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span>{getMissingFieldLabel(field)}</span>
              </div>
            ))}
          </div>
          <div className="bg-blue-50 p-3 rounded-lg mt-3">
            <p className="text-sm text-blue-800">
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
        title="إدارة الاشتراك"
        description="الباقة والمدفوعات وحالة الظهور"
        backHref="/owner/dashboard"
        accessory={isSuspended ? (
          <Badge className="gap-1 rounded-md bg-slate-600 text-white">
            <PauseCircle className="h-3 w-3" />
            موقوف
          </Badge>
        ) : undefined}
      />

      <OwnerPageMain className="flex flex-col gap-5 sm:gap-6 [&>*]:order-3">
        <Card className="overflow-hidden rounded-lg border border-[#ded3bc] bg-[#fffdf8]" style={{ order: 1 }}>
          <div className={`border-b p-5 md:p-6 ${subscriptionVisualState.bannerClass}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${subscriptionVisualState.iconClass}`}>
                  {isSuspended ? (
                    <PauseCircle className="h-5 w-5" />
                  ) : subscriptionVisualState.tone === "green" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : subscriptionVisualState.tone === "amber" ? (
                    <Clock className="h-5 w-5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <p className="text-lg font-bold">{subscriptionVisualState.title}</p>
                  <p className="mt-1 max-w-2xl text-sm leading-6 opacity-85">
                    {subscriptionVisualState.description}
                  </p>
                  {hasSubscriptionDateConflict && (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 h-9 rounded-lg border-red-200 bg-white/70 text-red-800 hover:bg-white"
                      onClick={() => window.open("https://wa.me/966533220646", "_blank")}
                    >
                      تواصل مع الإدارة
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs md:min-w-56">
                <div className="rounded-lg border border-current/15 bg-white/55 p-3">
                  <p className="font-semibold opacity-70">حالة الاشتراك</p>
                  <p className="mt-1 font-bold">{displayStatusLabel}</p>
                </div>
                <div className="rounded-lg border border-current/15 bg-white/55 p-3">
                  <p className="font-semibold opacity-70">حالة العقار</p>
                  <p className="mt-1 font-bold">{propertyStatusDisplay.label.replace("العقار ", "")}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="p-5 md:p-8 space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#a77d22]">الباقة الحالية</p>
                  <div className="space-y-1">
                    <h2 className="text-3xl md:text-4xl font-bold leading-tight text-[#2f2d2b]">
                      {getPackageName(subscription?.packageId)}
                    </h2>
                    <p className="text-sm text-[#776f63]">
                      عقار رقم {property?.propertyNumber || "غير محدد"}
                      {property?.name ? ` - ${property.name}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className={`${statusBadgeClass} rounded-md px-3 py-1 text-xs font-bold`}>
                    {displayStatusLabel}
                  </Badge>
                  <Badge variant="outline" className={`${propertyStatusDisplay.className} rounded-md px-3 py-1 text-xs font-bold`}>
                    {propertyStatusDisplay.label}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-[#e5dcc7] bg-white p-5">
                  <p className="text-xs font-semibold text-[#776f63]">الأيام المتبقية</p>
                  <div className="mt-3 flex items-end gap-2">
                    <span className={`text-5xl font-black leading-none ${hasSubscriptionDateConflict || isExpired ? "text-red-600" : isNearExpiry ? "text-[#b7791f]" : "text-[#2f2d2b]"}`}>
                      {daysMetricValue}
                    </span>
                    <span className="pb-1 text-sm font-semibold text-[#776f63]">
                      {daysMetricLabel}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border border-[#e5dcc7] bg-white p-5">
                  <div className="flex items-center gap-2 text-[#776f63]">
                    <Banknote className="h-4 w-4" />
                    <p className="text-xs font-semibold">رسوم الاشتراك</p>
                  </div>
                  <div className="mt-3">
                    <PriceDisplay amount={currentPackageObj?.price || 0} size="lg" />
                  </div>
                </div>

                <div className="rounded-lg border border-[#e5dcc7] bg-white p-5">
                  <div className="flex items-center gap-2 text-[#776f63]">
                    <Timer className="h-4 w-4" />
                    <p className="text-xs font-semibold">مدة الاشتراك</p>
                  </div>
                  <p className="mt-4 text-2xl font-bold text-[#2f2d2b]">
                    {currentPackageObj?.duration || subscriptionDuration || 30} يوم
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-[#e5dcc7] bg-white p-5 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#2f2d2b]">التقدم الزمني للاشتراك</p>
                    <p className="text-xs text-[#776f63]">
                      {hasSubscriptionDateConflict
                        ? "لا يمكن حساب التقدم بسبب تعارض تاريخ البداية والانتهاء"
                        : isExpired
                          ? "انتهت مدة الاشتراك"
                          : isNearExpiry
                            ? "اشتراكك قريب من الانتهاء"
                            : `متبقي ${displayedRemainingDays} يوم`}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#a77d22]">
                    {hasSubscriptionDateConflict ? "غير متسق" : `${Math.round(progressPercent)}%`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#eee6d5]">
                  <div
                    className={`h-2 rounded-full ${hasSubscriptionDateConflict || isExpired ? "bg-red-600" : isNearExpiry ? "bg-[#c9951d]" : "bg-[#2f2d2b]"}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-[#f8f4eb] p-4">
                    <div className="flex items-center gap-2 text-[#776f63]">
                      <Calendar className="h-4 w-4" />
                      <p className="text-xs font-semibold">تاريخ البداية</p>
                    </div>
                    <p className="mt-2 text-sm font-bold text-[#2f2d2b]">
                      {subscription?.startDate ? formatSubDate(subscription.startDate) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#f8f4eb] p-4">
                    <div className="flex items-center gap-2 text-[#776f63]">
                      <Calendar className="h-4 w-4" />
                      <p className="text-xs font-semibold">تاريخ الانتهاء</p>
                    </div>
                    <p className="mt-2 text-sm font-bold text-[#2f2d2b]">
                      {subscription?.endDate ? formatSubDate(subscription.endDate) : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {isSuspended ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  <PauseCircle className="ml-1 inline h-4 w-4" />
                  المدة المتبقية محفوظة بالكامل، ولن تتغير حتى يستأنف المسؤول الاشتراك.
                </div>
              ) : !hasSubscriptionDateConflict && !canExtend && !isExpired ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 flex-shrink-0" />
                    <span>يمكن التمديد عند بقاء 10 أيام أو أقل. الترقية متاحة الآن وتبدأ من تاريخ اليوم.</span>
                  </div>
                </div>
              ) : !hasSubscriptionDateConflict && isNearExpiry ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertTriangle className="ml-1 inline h-4 w-4" />
                  اشتراكك ينتهي قريباً. يمكنك التمديد لإضافة المدة الجديدة بعد تاريخ الانتهاء الحالي.
                </div>
              ) : !hasSubscriptionDateConflict && isExpired ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <AlertTriangle className="ml-1 inline h-4 w-4" />
                  اشتراكك منتهي. قم بالتجديد لإعادة ظهور عقارك في المنصة.
                </div>
              ) : null}

              {!isSuspended && (
              <div className="flex flex-col gap-3 border-t border-[#e5dcc7] pt-5 sm:flex-row">
                <Button
                  className="h-11 flex-1 rounded-lg bg-[#2f2d2b] text-white hover:bg-[#2f2d2b] gap-2"
                  onClick={() => {
                    setAction(hasActiveCurrentSubscription ? "upgrade" : "new");
                    setShowUpgradeDialog(true);
                  }}
                >
                  <Zap className="h-4 w-4" />
                  {hasActiveCurrentSubscription ? "تغيير الباقة" : "اختيار باقة وتفعيل الاشتراك"}
                </Button>
                {canExtend && (
                  <Button
                    variant="outline"
                    className="h-11 flex-1 rounded-lg border-[#c9951d] bg-[#fffdf8] text-[#7b5a13] hover:bg-[#fffdf8] sm:flex-none"
                    onClick={() => {
                      setAction("extend");
                      setSelectedPackageId(subscription?.packageId || null);
                      setCurrentStep(2);
                      setShowUpgradeDialog(false);
                    }}
                  >
                    <RefreshCcw className="ml-2 h-4 w-4" />
                    تمديد الاشتراك
                  </Button>
                )}
              </div>
              )}
            </section>

            <aside className="border-t border-[#ded3bc] bg-[#f4efe3] p-5 md:p-6 lg:border-r lg:border-t-0">
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#a77d22]">قواعد واضحة</p>
                  <h3 className="mt-2 text-xl font-bold text-[#2f2d2b]">الترقية والتجديد</h3>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-[#ded3bc] bg-[#fffdf8] p-4">
                    <div className="flex items-start gap-3">
                      <RefreshCcw className="mt-0.5 h-4 w-4 text-[#a77d22]" />
                      <div>
                        <p className="text-sm font-bold text-[#2f2d2b]">التجديد</p>
                        <p className="text-xs leading-6 text-[#776f63]">متاح عند بقاء 10 أيام أو أقل، وتتم إضافة المدة الجديدة بعد تاريخ الانتهاء الحالي.</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#ded3bc] bg-[#fffdf8] p-4">
                    <div className="flex items-start gap-3">
                      <Zap className="mt-0.5 h-4 w-4 text-[#a77d22]" />
                      <div>
                        <p className="text-sm font-bold text-[#2f2d2b]">الترقية</p>
                        <p className="text-xs leading-6 text-[#776f63]">تبدأ من اليوم وتعيد عداد الاشتراك حسب الباقة الجديدة.</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#ded3bc] bg-[#fffdf8] p-4">
                    <div className="flex items-start gap-3">
                      <Home className="mt-0.5 h-4 w-4 text-[#a77d22]" />
                      <div>
                        <p className="text-sm font-bold text-[#2f2d2b]">الاشتراك المشترك</p>
                        <p className="text-xs leading-6 text-[#776f63]">
                          {visibleLinkedCount > 0
                            ? `${visibleLinkedCount} عقار ضمن نفس الاشتراك وتواريخه.`
                            : "لا توجد عقارات ضمن اشتراك مشترك حالياً."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </Card>

        {/* ===== بطاقة الباقة الحالية ===== */}
        <Card className={`hidden p-6 border-2 ${cardColors.border} ${cardColors.bg}`}>
          <div className="flex items-center justify-between mb-5">
            <h2 className={`text-xl font-bold flex items-center gap-2 ${cardColors.text}`}>
              <Crown className="w-5 h-5 text-[#c9951d]" />
              الباقة الحالية
            </h2>
            <div className="flex items-center gap-2">
              <Badge className={`${subStatusDisplay.bgColor} ${subStatusDisplay.textColor} px-3 py-1`}>
                {subStatusDisplay.label}
              </Badge>
            </div>
          </div>

          {/* اسم الباقة */}
          <div className="text-center mb-5 pb-4 border-b">
            <p className={`text-2xl font-bold ${cardColors.text}`}>{getPackageName(subscription?.packageId)}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 text-sm">
            {/* الأيام المتبقية - كبير */}
            <div className="col-span-2 md:col-span-1 text-center p-4 rounded-xl bg-muted/40">
              <p className="text-muted-foreground text-xs mb-1">الأيام المتبقية</p>
              <p className={`text-5xl font-black ${isExpired ? "text-red-500" : isNearExpiry ? "text-amber-500" : "text-[#434040]"}`}>
                {isExpired ? "0" : displayDays}
              </p>
              <p className="text-muted-foreground text-sm mt-1">{isExpired ? "منتهي" : "يوم"}</p>
            </div>

            {/* تفاصيل الاشتراك */}
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <Banknote className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">رسوم الاشتراك</p>
                  <PriceDisplay amount={currentPackageObj?.price || 0} size="lg" />
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Timer className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">مدة الاشتراك</p>
                  <p className="font-bold text-muted-foreground">{currentPackageObj?.duration || subscriptionDuration || 30} يوم</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">تاريخ البداية</p>
                  <p className="font-bold text-muted-foreground text-xs">{subscription?.startDate ? formatSubDate(subscription.startDate) : "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">تاريخ الانتهاء</p>
                  <p className="font-bold text-muted-foreground text-xs">{subscription?.endDate ? formatSubDate(subscription.endDate) : "—"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {!isExpired && subscription?.startDate && subscription?.endDate && (
            <div className="mt-4">
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${isNearExpiry ? "bg-amber-500" : "bg-[#434040]"}`}
                  style={{
                    width: `${Math.max(5, Math.min(100, (remainingDays / Math.max(1, subscriptionDuration)) * 100))}%`
                  }}
                />
              </div>
            </div>
          )}

          {/* ملاحظة التمديد */}
          {!canExtend && !isExpired && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex items-center gap-2">
              <Info className="w-4 h-4 flex-shrink-0" />
              يمكن التمديد عند بقاء 10 أيام أو أقل
            </div>
          )}

          {isNearExpiry && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 inline ml-1" />
              اشتراكك ينتهي قريباً! قم بالتمديد للحفاظ على ظهور عقارك.
            </div>
          )}

          {isExpired && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 inline ml-1" />
              اشتراكك منتهي. قم بالتجديد لإعادة ظهور عقارك في المنصة.
            </div>
          )}

          {/* أزرار الترقية والتمديد */}
          <div className="flex gap-3 mt-5 pt-4 border-t">
            <Button
              className="flex-1 bg-violet-600 hover:bg-violet-700 gap-2 border-2 border-violet-600 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
              onClick={() => {
                setAction(hasActiveCurrentSubscription ? "upgrade" : "new");
                setShowUpgradeDialog(true);
              }}
            >
              <Zap className="w-4 h-4" />
              {hasActiveCurrentSubscription ? "تغيير الباقة" : "اختيار باقة وتفعيل الاشتراك"}
            </Button>
            {canExtend && (
              <Button
                variant="outline"
                className="flex-1 md:flex-none min-w-0 gap-2 border-2 border-blue-400 shadow-sm hover:shadow-md hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 transition-all duration-200 cursor-pointer bg-white text-blue-700"
                onClick={() => {
                  setAction("extend");
                  setSelectedPackageId(subscription?.packageId || null);
                  setCurrentStep(2);
                  setShowUpgradeDialog(false);
                }}
              >
                <RefreshCcw className="w-4 h-4" />
                تمديد الاشتراك
              </Button>
            )}
          </div>
        </Card>

        {/* Pending Payment Notice */}
        {pendingPayment?.hasPending && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <div className="flex items-center gap-2 text-amber-700">
              <Clock className="w-5 h-5" />
              <div>
                <p className="font-semibold">
                  {pendingPayment.action === 'upgrade' && 'لديك طلب ترقية قيد المراجعة'}
                  {pendingPayment.action === 'extend' && 'لديك طلب تمديد قيد المراجعة'}
                  {pendingPayment.action === 'new' && 'لديك دفعة قيد المراجعة'}
                  {!pendingPayment.action && 'لديك دفعة قيد المراجعة'}
                </p>
                <p className="text-sm">
                  {pendingPayment.action === 'upgrade' && 'سيتم ترقية اشتراكك بعد مراجعة الإيصال'}
                  {pendingPayment.action === 'extend' && 'سيتم تمديد اشتراكك بعد مراجعة الإيصال'}
                  {(!pendingPayment.action || pendingPayment.action === 'new') && 'سيتم تفعيل اشتراكك بعد مراجعة الإيصال'}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Rejected Payment Notice */}
        {shouldShowRejectedPaymentNotice && (
          <Card className="p-4 border-red-300 bg-red-50">
            <div className="flex items-center gap-2 text-red-700 mb-3">
              <AlertTriangle className="w-5 h-5" />
              <div>
                <p className="font-semibold">تم رفض الدفعة السابقة</p>
                <p className="text-sm">
                  {pendingPayment.payment?.notes || "يرجى إعادة التحويل ورفع إيصال صحيح"}
                </p>
              </div>
            </div>
            <Button
              onClick={() => router.push("/owner/update-property")}
              variant="outline"
              className="w-full border-red-300 text-red-700 hover:bg-red-100"
            >
              تعديل بيانات العقار
            </Button>
          </Card>
        )}

        {/* Owner Self-Service Verification (new property with successful payment awaiting admin) */}
        {!hasCompletedSmartVerification && property?.verificationStatus === 'pending' && pendingPayment?.payment?.status === "نجح - قيد التحقق" && (
          <Card className="p-4 border-blue-300 bg-blue-50">
            <div className="flex items-center gap-2 text-blue-700 mb-3">
              <CheckCircle2 className="w-5 h-5" />
              <div>
                <p className="font-semibold">تم استلام الدفع بنجاح</p>
                <p className="text-sm">يمكنك التحقق من اكتمال بيانات العقار، وسيتم التفعيل بعد اعتماد الإدارة إذا كان العقار جديداً</p>
              </div>
            </div>
            <Button
              type="button"
              onClick={runVerification}
              disabled={isRunningVerification}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
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
          </Card>
        )}

        {/* Pending Additional Property Requests (Under Review) */}
        {additionalPropertyRequests?.pendingRequests?.length > 0 && (
          <Card className="p-4 border-blue-300 bg-blue-50">
            <div className="flex items-center gap-2 text-blue-700 mb-3">
              <Clock className="w-5 h-5" />
              <p className="font-semibold">عقارات قيد المراجعة</p>
            </div>
            <div className="space-y-2">
              {additionalPropertyRequests.pendingRequests.map((req: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between bg-white p-3 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-blue-600" />
                    <div>
                      <p className="font-bold text-sm">{req.propertyNumber}</p>
                      <p className="text-xs text-muted-foreground">{req.name} - {req.city}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    قيد الانتظار
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-blue-600 mt-3">
              سيتم تفعيل هذه العقارات بعد موافقة الإدارة
            </p>
          </Card>
        )}

        {/* If this property is linked to a main property */}
        {currentSubscription?.linkedToMain && (
          <Card className="p-4 border-blue-300 bg-blue-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-700">
                <Home className="w-5 h-5" />
                <div>
                  <p className="font-semibold">مرتبط بعقار رئيسي</p>
                  <p className="text-sm">
                    رقم العقار: <span className="font-bold">{currentSubscription.linkedToMain.propertyNumber}</span>
                    {currentSubscription.linkedToMain.name && (
                      <> - <span>{currentSubscription.linkedToMain.name}</span></>
                    )}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300">
                {currentSubscription.linkedToMain.subscriptionStatus === 'نشط' ? 'نشط' : 
                 currentSubscription.linkedToMain.subscriptionStatus || 'غير نشط'}
              </Badge>
            </div>
          </Card>
        )}

        {/* Approved Linked Properties */}
        {additionalPropertyRequests?.approvedRequests?.length > 0 && (
          <Card className="p-4 border-green-300 bg-green-50">
            <div className="flex items-center gap-2 text-green-700 mb-3">
              <CheckCircle2 className="w-5 h-5" />
              <p className="font-semibold">العقارات المرتبطة</p>
            </div>
            <div className="space-y-2">
              {additionalPropertyRequests.approvedRequests.map((req: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between bg-white p-3 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-green-600" />
                    <div>
                      <p className="font-bold text-sm">{req.propertyNumber}</p>
                      <p className="text-xs text-muted-foreground">{req.name} - {req.city}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs bg-green-100 text-green-700 border-green-300">
                      تم الربط
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => {
                        setUnlinkPropertyDialog({ open: true, propertyNumber: req.propertyNumber, propertyName: req.name });
                      }}
                      title="فصل العقار"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
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

        {/* ===== نافذة اختيار الباقة للترقية ===== */}
        {showUpgradeDialog && currentStep === 1 && (
          <Card className="p-6" style={{ order: 2 }}>
          <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[#434040]">
                {action === "new" ? "اختر باقة لتفعيل الاشتراك" : "اختر الباقة الجديدة"}
              </h2>
              <Button variant="ghost" size="icon" onClick={() => setShowUpgradeDialog(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* تنبيه مهم - عند الترقية */}
            {!isExpired && remainingDays > 0 && action === "upgrade" && (
              <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-amber-800 mb-2">تنبيه مهم</p>
                    <p className="text-sm text-amber-700 mb-3">
                      لديك اشتراك متبقي فيه <span className="font-bold">{remainingDays}</span> يوم. تغيير الباقة سيؤدي إلى:
                    </p>
                    <ul className="space-y-1.5 text-sm text-amber-700">
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        تصفير العداد الحالي
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        بدء باقة جديدة من اليوم
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        الأيام المتبقية السابقة لن تُرحّل (ينطبق على الترقية والتخفيض)
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* الباقات المتاحة */}
            <h3 className="font-semibold text-muted-foreground text-sm mb-3">الباقات المتاحة</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {availablePackages.map((pkg: any) => {
                const isCurrentPkg = subscription?.packageId === pkg.id;
                const isDowngrade = action === "upgrade" && pkg.price < currentPkgPrice;
                const isSelected = selectedPackageId === pkg.id;
                const isMultiProperty = pkg.id?.includes("2propert") || pkg.id?.includes("2prop");
                const isExpanded = expandedPackages.has(pkg.id);
                const featuresToShow = isExpanded ? pkg.features : (pkg.features || []).slice(0, 4);
                const hasMoreFeatures = (pkg.features?.length || 0) > 4;

                return (
                  <div
                    key={pkg.id}
                    className={`p-5 rounded-xl border-2 transition-all cursor-pointer ${isSelected
                      ? "ring-2 ring-[#434040] bg-[#434040]/5 border-[#434040]"
                      : isCurrentPkg
                        ? "border-[#c9951d]/40 bg-[#c9951d]/5"
                        : "border-border hover:border-[#434040]/50"
                      }`}
                    onClick={() => setSelectedPackageId(pkg.id)}
                  >
                    {/* اسم الباقة والحالة */}
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-bold text-[#434040]">{pkg.name}</h3>
                      <div className="flex flex-col items-end gap-1">
                        {isSelected && <Badge className="bg-[#434040] text-white text-[10px]">مختار</Badge>}
                        {isCurrentPkg && <Badge className="bg-[#c9951d] border-0 text-[10px] text-white">الحالي</Badge>}
                      </div>
                    </div>

                    {/* المدة */}
                    <p className="text-xs text-muted-foreground mb-3">{pkg.duration} يوم</p>

                    {/* السعر */}
                    <div className="flex items-end gap-1 mb-2">
                      <PriceDisplay amount={pkg.price} size="lg" />
                      {isMultiProperty && (
                        <span className="text-xs text-muted-foreground mb-1">/ عقار</span>
                      )}
                    </div>

                    {/* معلومات الباقة المتعددة */}
                    {isMultiProperty && (
                      <div className="text-xs space-y-1 mb-2">
                        <div className="text-muted-foreground">الإجمالي: <span className="font-bold text-[#434040]"><PriceDisplay amount={pkg.price * 2} size="sm" /></span> للعقارين</div>
                        <p className="text-muted-foreground">2 عقارات</p>
                      </div>
                    )}

                    {/* المميزات */}
                    {isPremiumSubscriptionType(pkg.type) && (
                      <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9] mb-2">مميز</Badge>
                    )}
                    {pkg.features && pkg.features.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {featuresToShow.map((f: string, i: number) => (
                          <div key={i} className="text-xs flex items-start gap-2">
                            <span className="text-[#434040] font-bold mt-0.5">✓</span>
                            <span>{f}</span>
                          </div>
                        ))}
                        {hasMoreFeatures && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedPackages(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(pkg.id)) {
                                  newSet.delete(pkg.id);
                                } else {
                                  newSet.add(pkg.id);
                                }
                                return newSet;
                              });
                            }}
                            className="text-xs text-[#c9951d] font-semibold hover:underline mt-1"
                          >
                            {isExpanded ? 'عرض أقل' : `عرض المزيد (${pkg.features.length - 4}+)`}
                          </button>
                        )}
                      </div>
                    )}
                    {isDowngrade && (
                      <p className="text-xs text-blue-500 mt-2">تخفيض الباقة - ستبدأ من اليوم</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* أزرار المتابعة والإلغاء */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setShowUpgradeDialog(false);
                  setSelectedPackageId(null);
                }}
                className="border-red-300 text-red-600 hover:bg-red-50"
              >
                إلغاء
              </Button>
              <Button
                onClick={() => {
                  if (selectedPackageId) setCurrentStep(2);
                }}
                disabled={!selectedPackageId}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                متابعة للدفع
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Payment Method */}
        {currentStep === 2 && selectedPackageId && (
          <Card className="p-8" style={{ order: 2 }}>
            <h2 className="text-xl font-bold text-[#434040] mb-6">
              {action === "new" ? "تفعيل الاشتراك" : action === "upgrade" ? "ترقية الاشتراك" : "تمديد الاشتراك"} — طريقة الدفع
            </h2>
            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Selected Package Summary */}
              {selectedPackage && (
                <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">الباقة المختارة</p>
                    <p className="font-bold">{selectedPackage.name}</p>
                  </div>
                  <div className="text-left">
                    <PriceDisplay amount={selectedPackage.price} size="lg" />
                    <p className="text-xs text-muted-foreground">{selectedPackage.duration} يوم</p>
                  </div>
                </div>
              )}

              {/* Additional Properties Input for Multi-Property Packages */}
              {selectedPackage && ((selectedPackage as any).maxProperties > 1 || selectedPackage.propertyCount === 2 || selectedPackage.id === 'pkg-month-2properties') && (
                <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <h4 className="font-bold text-blue-800 dark:text-blue-200 mb-3 flex items-center gap-2">
                    <Crown className="w-5 h-5" />
                    ربط عقارات إضافية
                  </h4>
                  
                  {/* Show current linked property */}
                  {currentSubscription?.linkedProperty && (
                    <div className="mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Home className="w-4 h-4 text-blue-600" />
                          <span className="font-medium">العقار المربوط:</span>
                          <span className="font-bold text-blue-600">{currentSubscription.linkedProperty}</span>
                        </div>
                        {linkedPropertySubscription?.found && (
                          <div className="flex items-center gap-2 text-sm">
                            <Badge variant={linkedPropertySubscription.subscription.status === 'نشط' ? 'default' : 'secondary'}>
                              {linkedPropertySubscription.subscription.status === 'نشط' ? 'نشط' : 
                               linkedPropertySubscription.subscription.status === 'ساري' ? 'ساري' : 
                               linkedPropertySubscription.subscription.status || '-'}
                            </Badge>
                            <span className="text-muted-foreground">
                              {getSubscriptionTypeLabel(linkedPropertySubscription.subscription.subscriptionType)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <p className={`text-sm mb-4 ${showAdditionalPropertyError ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-amber-700 dark:text-amber-300'}`}>
                    ⚠️ يجب إضافة عقار إضافي واحد على الأقل لهذه الباقة
                  </p>
                  
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
                              className="border-blue-400 text-blue-700 hover:bg-blue-50"
                            >
                              {prop.verifying ? "..." : "تحقق"}
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1 text-green-600 px-2">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeAdditionalProperty(index)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {prop.error && (
                          <p className="text-sm text-red-600 mt-1">{prop.error}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Add more properties button */}
                  {additionalProperties.filter(p => p.verified).length < ((selectedPackage as any).maxProperties || 2) - 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addAdditionalProperty}
                      className="border-blue-400 text-blue-700 hover:bg-blue-50 w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      إضافة عقار آخر
                    </Button>
                  )}

                  {/* Price summary */}
                  {additionalProperties.filter(p => p.verified).length > 0 && (
                    <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-blue-800 dark:text-blue-200">العقار الرئيسي</span>
                          <span className="font-bold">{(selectedPackage as any)?.price || 25} ريال</span>
                        </div>
                        {additionalProperties.filter(p => p.verified).map((p, idx) => (
                          <div key={idx} className="flex justify-between items-center text-sm">
                            <span className="text-blue-800 dark:text-blue-200">عقار إضافي ({p.number})</span>
                            <span className="font-bold">{(selectedPackage as any)?.price || 25} ريال</span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center pt-2 border-t border-blue-300">
                          <span className="font-bold text-blue-900 dark:text-blue-100">الإجمالي</span>
                          <span className="font-bold text-blue-900 dark:text-blue-100">{calculateTotalPrice()} ريال</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Payment Methods */}
              <div>
                <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
                <div className="space-y-3">
                  <div
                    onClick={() => setPaymentMethod("online")}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === "online" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                  >
                    <div className="font-semibold flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-[#434040]" />
                      الدفع الإلكتروني
                    </div>
                    <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay — تفعيل فوري</p>
                  </div>
                  <div
                    onClick={() => setPaymentMethod("bank")}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === "bank" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                  >
                    <div className="font-semibold">تحويل بنكي</div>
                    <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل — خلال 24 ساعة</p>
                  </div>
                </div>
              </div>

              {/* Discount Code */}
              <div className="p-4 bg-muted/30 rounded-lg">
                <label className="block text-sm font-semibold mb-2">كود خصم (اختياري)</label>
                <div className="flex gap-2">
                  <Input placeholder="أدخل كود الخصم" value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} />
                  <Button type="button" variant="outline" onClick={validateDiscount} className="border-green-400 text-green-700 hover:bg-green-50">تحقق</Button>
                </div>
                {validatedDiscount && (
                  <p className="text-sm text-green-600 mt-2">✓ سيتم خصم {formatDiscount(validatedDiscount.value, validatedDiscount.type)}</p>
                )}
              </div>

              {/* Bank Receipt */}
              {paymentMethod === "bank" && (
                <div className="p-4 bg-muted/30 rounded-lg space-y-3">
                  <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl space-y-3">
                    <div className="flex items-center gap-2 mb-3">
                      <CreditCard className="w-6 h-6 text-blue-700" />
                      <p className="font-bold text-lg text-blue-800">معلومات التحويل البنكي</p>
                    </div>
                    {bankAccount ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">البنك</span>
                          <span className="text-base font-bold text-blue-900">{bankAccount.bankName}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">اسم المستفيد</span>
                          <span className="text-base font-bold text-blue-900">{bankAccount.beneficiaryName}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">IBAN</span>
                          <span className="text-base font-bold text-blue-900 tracking-wide font-mono" dir="ltr">{bankAccount.iban}</span>
                        </div>
                        {bankAccount.accountNumber && (
                          <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                            <span className="text-sm font-semibold text-blue-700">رقم الحساب</span>
                            <span className="text-base font-bold text-blue-900 font-mono" dir="ltr">{bankAccount.accountNumber}</span>
                          </div>
                        )}
                        {bankAccount.barcodeUrl && (
                          <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                            <p className="text-sm font-semibold text-blue-700 mb-2">باركود الحساب البنكي</p>
                            <img src={bankAccount.barcodeUrl} alt="باركود الحساب البنكي" className="max-w-[200px] mx-auto rounded-lg" />
                          </div>
                        )}
                        <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                          <p className="text-sm font-semibold text-blue-700 mb-2">QR Code للدفع</p>
                          <img 
                            src="/assets/bank-qr.png" 
                            alt="QR Code للدفع" 
                            className="max-w-[180px] mx-auto rounded-lg cursor-pointer hover:scale-105 transition-transform"
                            onClick={() => window.open('/assets/bank-qr.png', '_blank')}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-blue-600 text-center py-4">جاري تحميل بيانات الحساب...</p>
                    )}
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                      <p className="text-sm font-semibold text-amber-800">⚠ يرجى كتابة المعلومات التالية في ملاحظات التحويل:</p>
                      <ul className="text-sm text-amber-700 space-y-1">
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
                    <Button type="button" variant="outline" onClick={() => receiptInputRef.current?.click()} className="w-full gap-2 border-blue-400 text-blue-700 hover:bg-blue-50">
                      <Upload className="w-4 h-4" />
                      {receiptFile ? receiptFile.name : "اختر صورة الإيصال"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Submit */}
              <div className="flex gap-3 pt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCurrentStep(1);
                    if (action === "upgrade") setShowUpgradeDialog(true);
                  }}
                  className="gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  رجوع
                </Button>
                <Button
                  type="submit"
                  disabled={!paymentMethod || cardPaymentMutation.isPending || bankTransferMutation.isPending || (paymentMethod === "bank" && !receiptFile)}
                  className="flex-1 bg-[#434040] hover:bg-[#333]"
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
              <h2 className="text-xl font-bold text-[#434040]">شراء إضافة - {selectedAddOn.name}</h2>
              <Button variant="ghost" size="icon" onClick={() => { setSelectedAddOn(null); setAddOnStep(1); }}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Add-on Summary */}
            <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-muted-foreground">الإضافة</p>
                <p className="font-bold">{selectedAddOn.name}</p>
                {selectedAddOn.category && (
                  <Badge className={`${getCategoryColor(selectedAddOn.category)} text-white text-xs mt-1`}>
                    {selectedAddOn.category}
                  </Badge>
                )}
              </div>
              <div className="text-left">
                <PriceDisplay amount={selectedAddOn.price} size="lg" />
                <p className="text-xs text-muted-foreground">{selectedAddOn.duration} يوم</p>
              </div>
            </div>

            {/* Step 2: Payment Method */}
            <div>
              <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
              <div className="space-y-3">
                <div
                  onClick={() => { setAddOnPaymentMethod("online"); setAddOnStep(2); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${addOnStep === 2 && addOnPaymentMethod === "online" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                >
                  <div className="font-semibold flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-[#434040]" />
                    الدفع الإلكتروني
                  </div>
                  <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay — تفعيل فوري</p>
                </div>
                <div
                  onClick={() => { setAddOnPaymentMethod("bank"); setAddOnStep(2); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${addOnStep === 2 && addOnPaymentMethod === "bank" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                >
                  <div className="font-semibold">تحويل بنكي</div>
                  <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل — خلال 24 ساعة</p>
                </div>
              </div>
            </div>

            {/* Bank Transfer Details */}
            {addOnPaymentMethod === "bank" && (
              <div className="mt-4 p-4 bg-muted/30 rounded-lg space-y-3">
                <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <CreditCard className="w-6 h-6 text-blue-700" />
                    <p className="font-bold text-lg text-blue-800">معلومات التحويل البنكي</p>
                  </div>
                  {bankAccount ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-blue-700">البنك</span>
                        <span className="text-base font-bold text-blue-900">{bankAccount.bankName}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-blue-700">اسم المستفيد</span>
                        <span className="text-base font-bold text-blue-900">{bankAccount.beneficiaryName}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-blue-700">IBAN</span>
                        <span className="text-base font-bold text-blue-900 tracking-wide font-mono" dir="ltr">{bankAccount.iban}</span>
                      </div>
                      {bankAccount.accountNumber && (
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">رقم الحساب</span>
                          <span className="text-base font-bold text-blue-900 font-mono" dir="ltr">{bankAccount.accountNumber}</span>
                        </div>
                      )}
                      {bankAccount.barcodeUrl && (
                        <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                          <p className="text-sm font-semibold text-blue-700 mb-2">باركود الحساب البنكي</p>
                          <img src={bankAccount.barcodeUrl} alt="باركود الحساب البنكي" className="max-w-[200px] mx-auto rounded-lg" />
                        </div>
                      )}
                      <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                        <p className="text-sm font-semibold text-blue-700 mb-2">QR Code للدفع</p>
                        <img 
                          src="/assets/bank-qr.png" 
                          alt="QR Code للدفع" 
                          className="max-w-[180px] mx-auto rounded-lg cursor-pointer hover:scale-105 transition-transform"
                          onClick={() => window.open('/assets/bank-qr.png', '_blank')}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-blue-600 text-center py-4">جاري تحميل بيانات الحساب...</p>
                  )}
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-amber-800">⚠ يرجى كتابة المعلومات التالية في ملاحظات التحويل:</p>
                    <ul className="text-sm text-amber-700 space-y-1">
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
                    className="w-full gap-2 border-blue-400 text-blue-700 hover:bg-blue-50"
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
                className="flex-1 bg-[#434040] hover:bg-[#333]"
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
          <Card className="p-6">
            <h2 className="text-xl font-bold text-[#434040] mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-[#c9951d]" />
              الإضافات
            </h2>

            {/* Active Add-ons */}
            {propertyAddons && propertyAddons.filter((a: any) => a.status === "active").length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">إضافاتك النشطة</h3>
                <div className="space-y-2">
                  {propertyAddons.filter((a: any) => a.status === "active").map((addon: any) => {
                    const pkg = addOnPackages.find((p: any) => p.id === addon.addOnPackageId);
                    return (
                      <div key={addon.id} className="flex items-center justify-between p-3 rounded-lg border border-emerald-300 bg-emerald-50/50">
                        <div className="flex items-center gap-2">
                          <Badge className={`${getCategoryColor(pkg?.category || "")} text-white text-xs`}>
                            {pkg?.category || "إضافة"}
                          </Badge>
                          <span className="font-semibold text-sm">{pkg?.name || addon.addOnPackageId}</span>
                        </div>
                        {addon.endDate && (
                          <span className="text-xs text-muted-foreground">
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
                      ? "border-emerald-300 bg-emerald-50/30"
                      : "border-border hover:border-[#434040]/50"
                      }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Badge className={`${getCategoryColor(pkg.category)} text-white text-xs mb-1`}>
                          {pkg.category}
                        </Badge>
                        <h4 className="font-semibold">{pkg.name}</h4>
                        {pkg.description && (
                          <p className="text-xs text-muted-foreground">{pkg.description}</p>
                        )}
                      </div>
                      <PriceDisplay amount={pkg.price} size="sm" />
                    </div>
                    {alreadyActive ? (
                      <Badge className="bg-[#434040] text-white text-xs">
                        <Check className="w-3 h-3 ml-1" />مفعّل
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full mt-2 bg-orange-500 hover:bg-orange-600 border-2 border-orange-500 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
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


      </OwnerPageMain>
      <OwnerMobileNavigation />
    </div>
  );
}
