"use client";
import * as React from "react"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  ToastAction,
} from "@/components/ui/toast"
import { Copy, AlertCircle } from "lucide-react"

/**
 * ينسخ نصًا إلى الحافظة باستخدام Clipboard API.
 * تُعاد true عند النجاح، false عند عدم توفر API أو حدوث خطأ.
 * لا يُطبع أي محتوى حساس.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * يبني النص القابل للنسخ من عنوان ووصف الإشعار.
 * يُ返回 نصًا فارغًا إذا لم يكن هناك شيء للعرض.
 */
export function buildToastCopyText(
  title: React.ReactNode | undefined,
  description: React.ReactNode | undefined,
): string {
  const parts: string[] = []
  if (title !== undefined && title !== null && title !== "") {
    parts.push(String(title))
  }
  if (description !== undefined && description !== null && description !== "") {
    parts.push(String(description))
  }
  return parts.join(" - ").trim()
}

export function Toaster() {
  const { toasts } = useToast()
  // يُتابع أي إشعار أُجري عليه نسخ حاليًا ونوع التغذية الراجعة ("copied" / "error")
  // لمدة قصيرة، ثم يعود للأيقونة العادية. لا تُنشَأ إشعارات جديدة (لا حلقة مكررة).
  const [feedback, setFeedback] = React.useState<{
    id: string
    type: "copied" | "error"
  } | null>(null)

  const handleCopy = async (
    toastId: string,
    title: React.ReactNode | undefined,
    description: React.ReactNode | undefined,
  ) => {
    const text = buildToastCopyText(title, description)
    try {
      const ok = await copyToClipboard(text)
      if (ok) {
        setFeedback({ id: toastId, type: "copied" })
        setTimeout(
          () =>
            setFeedback((f) => (f?.id === toastId ? null : f)),
          1500,
        )
      } else {
        setFeedback({ id: toastId, type: "error" })
        setTimeout(
          () =>
            setFeedback((f) => (f?.id === toastId ? null : f)),
          2500,
        )
      }
    } catch {
      setFeedback({ id: toastId, type: "error" })
      setTimeout(
        () =>
          setFeedback((f) => (f?.id === toastId ? null : f)),
        2500,
      )
    }
  }

  return (
    <ToastProvider duration={4000}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const isFeedback = feedback?.id === id
        const text = buildToastCopyText(title, description)
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            <ToastAction
              altText="نسخ نص الرسالة"
              aria-label="نسخ نص الرسالة"
              title="نسخ نص الرسالة"
              onClick={(e) => {
                e.stopPropagation()
                handleCopy(id, title, description)
              }}
            >
              {isFeedback ? (
                feedback?.type === "copied" ? (
                  <span className="text-xs font-medium text-foreground">
                    تم النسخ
                  </span>
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </ToastAction>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
