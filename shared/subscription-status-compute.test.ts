import assert from "node:assert/strict";
import test from "node:test";

import {
  computeSubscriptionStatus,
  calculateRemainingDaysFromEndDate,
  normalizeSubscriptionStatus,
} from "./subscriptionType";

// Helpers to build Riyadh-calendar dates
function riyadhDateOffset(daysOffset: number): string {
  const now = new Date();
  const riyadhParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    riyadhParts.map((part) => [part.type, part.value]),
  );
  const base = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    12, // noon to avoid DST edge cases
  );
  return new Date(base + daysOffset * 24 * 60 * 60 * 1000).toISOString();
}

function futureDate(days: number): string {
  return riyadhDateOffset(days);
}

function pastDate(days: number): string {
  return riyadhDateOffset(-days);
}

test("computeSubscriptionStatus: نشط وتاريخ النهاية في المستقبل → ساري", () => {
  const result = computeSubscriptionStatus({
    status: "نشط",
    endDate: futureDate(30),
  });
  assert.equal(result, "ساري");
});

test("computeSubscriptionStatus: منتهي مخزنة وتاريخ النهاية في المستقبل دون إلغاء → ساري (حالة لندا)", () => {
  const result = computeSubscriptionStatus({
    status: "منتهي",
    endDate: futureDate(24),
    cancelledAt: null,
  });
  assert.equal(result, "ساري");
});

test("computeSubscriptionStatus: نشط وتاريخ النهاية في الماضي → منتهي", () => {
  const result = computeSubscriptionStatus({
    status: "نشط",
    endDate: pastDate(1),
  });
  assert.equal(result, "منتهي");
});

test("computeSubscriptionStatus: ملغى وتاريخ النهاية في المستقبل → منتهي", () => {
  const result = computeSubscriptionStatus({
    status: "منتهي",
    endDate: futureDate(30),
    cancelledAt: new Date().toISOString(),
    cancelReason: "admin",
  });
  assert.equal(result, "منتهي");
});

test("computeSubscriptionStatus: معلق (suspendedAt مع remainingDurationMs صالح) → موقوف مؤقتاً", () => {
  const result = computeSubscriptionStatus({
    status: "منتهي",
    endDate: pastDate(1),
    suspendedAt: new Date().toISOString(),
    remainingDurationMs: 5 * 24 * 60 * 60 * 1000,
  });
  assert.equal(result, "موقوف مؤقتاً");
});

test("computeSubscriptionStatus: suspendedAt بدون remainingDurationMs لا يُعتبر تعليقاً حالياً", () => {
  const result = computeSubscriptionStatus({
    status: "منتهي",
    endDate: futureDate(30),
    suspendedAt: new Date().toISOString(),
    remainingDurationMs: null,
  });
  assert.equal(result, "ساري");
});

test("computeSubscriptionStatus: أعيد تفعيل (startDate بعد cancelledAt) وتاريخ في المستقبل → ساري", () => {
  const now = new Date();
  const cancelledAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
  const startDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago (after cancellation)
  const result = computeSubscriptionStatus({
    status: "منتهي",
    endDate: futureDate(30),
    cancelledAt,
    startDate,
  });
  assert.equal(result, "ساري");
});

test("computeSubscriptionStatus: تم الإلغاء قبل البداية (startDate قبل cancelledAt) → منتهي", () => {
  const now = new Date();
  const startDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago
  const cancelledAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago (after start)
  const result = computeSubscriptionStatus({
    status: "منتهي",
    endDate: futureDate(30),
    cancelledAt,
    startDate,
  });
  assert.equal(result, "منتهي");
});

test("computeSubscriptionStatus: تاريخ نهاية فارغ → غير نشط", () => {
  const result = computeSubscriptionStatus({
    status: "منتهي",
    endDate: null,
  });
  assert.equal(result, "غير نشط");
});

test("computeSubscriptionStatus: حالة مخزنة غير معروفة → غير نشط", () => {
  const result = computeSubscriptionStatus({
    status: "حالة غير معروفة",
    endDate: null,
  });
  assert.equal(result, "غير نشط");
});

test("computeSubscriptionStatus: نشط مجاني بدون تاريخ نهاية → نشط مجاني", () => {
  const result = computeSubscriptionStatus({
    status: "نشط مجاني",
    endDate: null,
  });
  assert.equal(result, "نشط مجاني");
});

test("computeSubscriptionStatus: نشط مجاني مع تاريخ نهاية مستقبلي → نشط مجاني", () => {
  const result = computeSubscriptionStatus({
    status: "نشط مجاني",
    endDate: futureDate(30),
  });
  assert.equal(result, "نشط مجاني");
});

test("computeSubscriptionStatus: اليوم الأخير (0 أيام متبقية) → ينتهي قريباً", () => {
  const result = computeSubscriptionStatus({
    status: "نشط",
    endDate: futureDate(0),
  });
  assert.equal(result, "ينتهي قريباً");
});

test("computeSubscriptionStatus: 7 أيام متبقية → ينتهي قريباً", () => {
  const result = computeSubscriptionStatus({
    status: "نشط",
    endDate: futureDate(7),
  });
  assert.equal(result, "ينتهي قريباً");
});

test("computeSubscriptionStatus: 8 أيام متبقية → ساري", () => {
  const result = computeSubscriptionStatus({
    status: "نشط",
    endDate: futureDate(8),
  });
  assert.equal(result, "ساري");
});

test("calculateRemainingDaysFromEndDate: تاريخ في المستقبل → موجب", () => {
  const days = calculateRemainingDaysFromEndDate(futureDate(24));
  assert.equal(days, 24);
});

test("calculateRemainingDaysFromEndDate: تاريخ في الماضي → سالب", () => {
  const days = calculateRemainingDaysFromEndDate(pastDate(1));
  assert.equal(days, -1);
});

test("calculateRemainingDaysFromEndDate: null → -1", () => {
  const days = calculateRemainingDaysFromEndDate(null);
  assert.equal(days, -1);
});

test("calculateRemainingDaysFromEndDate: سلسلة غير صالحة → -1", () => {
  const days = calculateRemainingDaysFromEndDate("not-a-date");
  assert.equal(days, -1);
});

test("normalizeSubscriptionStatus: منتهي → منتهي", () => {
  assert.equal(normalizeSubscriptionStatus("منتهي"), "منتهي");
});

test("normalizeSubscriptionStatus: expired → منتهي", () => {
  assert.equal(normalizeSubscriptionStatus("expired"), "منتهي");
});

test("normalizeSubscriptionStatus: نشط → ساري", () => {
  assert.equal(normalizeSubscriptionStatus("نشط"), "ساري");
});

test("normalizeSubscriptionStatus: active → ساري", () => {
  assert.equal(normalizeSubscriptionStatus("active"), "ساري");
});

test("computeSubscriptionStatus: تشغيل متكرر لا يغير النتيجة (idempotency)", () => {
  const input = {
    status: "منتهي",
    endDate: futureDate(24),
    cancelledAt: null,
  };
  const first = computeSubscriptionStatus(input);
  const second = computeSubscriptionStatus(input);
  const third = computeSubscriptionStatus(input);
  assert.equal(first, "ساري");
  assert.equal(second, "ساري");
  assert.equal(third, "ساري");
});

test("computeSubscriptionStatus: جميع الحقول طبيعية لا تتغير بين مكالمات متتالية", () => {
  const input = {
    status: "منتهي",
    endDate: futureDate(24),
    cancelledAt: null,
    suspendAt: null,
  };
  const before = JSON.stringify(input);
  computeSubscriptionStatus(input);
  const after = JSON.stringify(input);
  assert.equal(before, after, "الدالة لا يجب أن تُعدل كمدخلاتها");
});