import assert from "node:assert/strict";
import test from "node:test";

import {
  canExtendSubscription,
  getSubscriptionStatusFromRecord,
  getSubscriptionDisplayLabel,
  getSubscriptionStatusText,
  isCancelledSubscription,
} from "./subscription-utils";

function dateDaysFromToday(days: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + days,
    12,
  ));
  return date.toISOString();
}

test("renewal visibility is limited to active subscriptions with 0..10 days", () => {
  assert.equal(canExtendSubscription(dateDaysFromToday(11), "active"), false);
  assert.equal(canExtendSubscription(dateDaysFromToday(10), "active"), true);
  assert.equal(canExtendSubscription(dateDaysFromToday(0), "active"), true);
  assert.equal(canExtendSubscription(dateDaysFromToday(-1), "active"), false);
  assert.equal(canExtendSubscription(null, "active"), false);
  assert.equal(canExtendSubscription(dateDaysFromToday(5), "suspended"), false);
});

test("explicit cancellation is not active even when endDate is today", () => {
  const record = {
    status: "منتهي",
    endDate: dateDaysFromToday(0),
    startDate: dateDaysFromToday(-30),
    cancelledAt: new Date().toISOString(),
  };
  assert.equal(isCancelledSubscription(record), true);
  assert.equal(getSubscriptionStatusFromRecord(record), "expired");
  assert.equal(
    getSubscriptionDisplayLabel(getSubscriptionStatusFromRecord(record)),
    "منتهي",
  );
});

test("expired non-premium subscription is detected from endDate", () => {
  const record = {
    status: "نشط",
    endDate: dateDaysFromToday(-1),
    startDate: dateDaysFromToday(-31),
  };
  assert.equal(getSubscriptionStatusFromRecord(record), "expired");
});

test("suspended subscription wins over a future endDate", () => {
  const record = {
    status: "موقوف مؤقتاً",
    endDate: dateDaysFromToday(30),
    startDate: dateDaysFromToday(-1),
    suspendedAt: new Date().toISOString(),
    remainingDurationMs: 5 * 24 * 60 * 60 * 1000,
  };
  assert.equal(getSubscriptionStatusFromRecord(record), "suspended");
});

test("pending payment is separate from the subscription status label", () => {
  const activeRecord = {
    status: "نشط",
    endDate: dateDaysFromToday(30),
    startDate: dateDaysFromToday(-1),
  };
  assert.equal(getSubscriptionStatusFromRecord(activeRecord), "active");
  assert.equal(getSubscriptionDisplayLabel("active"), "ساري");
  assert.equal(getSubscriptionDisplayLabel("pending"), "قيد المراجعة");
});

test("reactivation after cancellation is active again", () => {
  const now = Date.now();
  const record = {
    status: "نشط",
    endDate: dateDaysFromToday(30),
    startDate: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    cancelledAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
  };
  assert.equal(isCancelledSubscription(record), false);
  assert.equal(getSubscriptionStatusFromRecord(record), "active");
});

test("active subscription status text is anchored to the activation startDate", () => {
  const record = {
    status: "نشط",
    startDate: "2026-10-17T00:00:00.000Z",
    endDate: "2026-12-16T00:00:00.000Z",
  };
  const result = getSubscriptionStatusText(record);
  assert.equal(result.status, "active");
  assert.ok(result.text.includes("تم التفعيل منذ"));
  assert.equal(result.date, record.startDate);
});

test("expired subscription status text is anchored to the endDate and not the startDate", () => {
  const record = {
    status: "نشط",
    startDate: "2026-10-17T00:00:00.000Z",
    endDate: "2026-11-16T00:00:00.000Z",
  };
  const result = getSubscriptionStatusText(record);
  assert.equal(result.status, "expired");
  assert.ok(result.text.includes("انتهى الاشتراك منذ"));
  assert.equal(result.date, record.endDate);
});

test("cancelled subscription status text is anchored to the cancellation date", () => {
  const record = {
    status: "منتهي",
    startDate: "2026-10-17T00:00:00.000Z",
    endDate: "2026-11-16T00:00:00.000Z",
    cancelledAt: "2026-11-10T00:00:00.000Z",
  };
  const result = getSubscriptionStatusText(record);
  assert.ok(result.text.includes("تم إلغاء الاشتراك في"));
  assert.equal(result.date, record.cancelledAt);
});

test("not started subscription status text uses the future startDate", () => {
  const record = {
    status: "نشط",
    startDate: "2027-01-01T00:00:00.000Z",
    endDate: "2027-03-01T00:00:00.000Z",
  };
  const result = getSubscriptionStatusText(record);
  assert.ok(result.text.includes("يبدأ الاشتراك في"));
  assert.equal(result.date, record.startDate);
});
