import assert from "node:assert/strict"
import test from "node:test"
import {
  copyToClipboard,
  buildToastCopyText,
} from "@/components/ui/toaster"

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
)

function setClipboard(
  writeText: ((text: string) => Promise<void>) | null,
) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    enumerable: true,
    value: { ...(globalThis.navigator ?? {}), clipboard: writeText ? { writeText } : undefined },
    writable: true,
  })
}

test("buildToastCopyText joins title and description with ' - '", () => {
  assert.equal(
    buildToastCopyText("نُشر فعليًا", "التحقق بعد النشر: ناجح"),
    "نُشر فعليًا - التحقق بعد النشر: ناجح",
  )
  assert.equal(buildToastCopyText("عنوان فقط", undefined), "عنوان فقط")
  assert.equal(buildToastCopyText(undefined, "وصف فقط"), "وصف فقط")
  assert.equal(buildToastCopyText(undefined, undefined), "")
  assert.equal(buildToastCopyText("", ""), "")
})

test("copyToClipboard returns true when clipboard write succeeds", async () => {
  setClipboard(async () => {
    //noop
  })
  const ok = await copyToClipboard("نص للنسخ")
  assert.equal(ok, true)
})

test("copyToClipboard returns false when clipboard write throws", async () => {
  setClipboard(async () => {
    throw new Error("ClipboardWriteError")
  })
  const ok = await copyToClipboard("نص للنسخ")
  assert.equal(ok, false)
})

test("copyToClipboard returns false when clipboard API is unavailable", async () => {
  setClipboard(null)
  const ok = await copyToClipboard("نص للنسخ")
  assert.equal(ok, false)
})

test.after(() => {
  // استعادة حال clipbard الأصلية إن وُجدت
  if (originalClipboardDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalClipboardDescriptor)
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      enumerable: true,
      value: { ...(globalThis.navigator ?? {}), clipboard: undefined },
      writable: true,
    })
  }
})
