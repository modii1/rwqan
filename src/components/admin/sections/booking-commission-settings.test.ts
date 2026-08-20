import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBookingCommissionSettingsDraft } from "./booking-commission-settings";

test("booking settings accept zero, upper bound, and Arabic digits", () => {
  assert.deepEqual(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "٠",
    freeOwnerDailyLimit: "12",
    freePropertyContactDailyLimit: "۱۰۰۰",
  }), {
    customerDailyLimit: 0,
    freeOwnerDailyLimit: 12,
    freePropertyContactDailyLimit: 1_000,
  });
});

test("booking settings reject decimals, negatives, and values above the bound", () => {
  assert.equal(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "1.5",
    freeOwnerDailyLimit: "3",
    freePropertyContactDailyLimit: "3",
  }), null);
  assert.equal(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "3",
    freeOwnerDailyLimit: "-1",
    freePropertyContactDailyLimit: "3",
  }), null);
  assert.equal(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "3",
    freeOwnerDailyLimit: "3",
    freePropertyContactDailyLimit: "1001",
  }), null);
});

test("admin reminder controls explain forward-only scheduling semantics", () => {
  const source = readFileSync(
    new URL("./booking-commission-settings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /تُطبّق خيارات اليوم الثالث والرابع على الحجوزات التي تُؤكد أو تُعاد دورة تحصيلها بعد الحفظ\./,
  );
  assert.match(source, /تبقى التذكيرات المجدولة سابقاً كما هي\./);
  assert.match(source, /mandatoryCommissionReminderDays/);
  assert.match(source, /allowedOptionalCommissionReminderDays/);
});
