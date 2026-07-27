import assert from "node:assert/strict";
import test from "node:test";

import type { Property } from "@shared/schema";
import { getVerificationStatus } from "./verification-status";

const now = new Date("2026-07-26T12:00:00.000Z");
const completeProperty: Property = {
  propertyNumber: "12345",
  name: "Ready property",
  city: "بريدة",
  location: "https://maps.example/property",
  type: "قسم",
  facilities: ["pool"],
  whatsappNumber: "0512345678",
  direction: "شمال",
  prices: {
    weekday: "500",
    weekend: "600",
    overnight: "700",
    holidays: "800",
  },
  subscriptionType: "عادي",
  imageUrls: [],
  updatedAt: "2026-07-20T12:00:00.000Z",
};

test("admin cards separate hard approval blockers from warnings", () => {
  const result = getVerificationStatus(
    {
      ...completeProperty,
      facilities: [],
      direction: "" as Property["direction"],
      prices: { weekday: "", weekend: "", overnight: "", holidays: "" },
      whatsappNumber: "invalid",
    },
    2,
    now,
  );

  assert.deepEqual(result.blockers, [
    "المرافق غير محددة",
    "عدد الصور غير كافٍ (2/3 كحد أدنى)",
  ]);
  assert.deepEqual(result.warnings, [
    "رقم واتساب المالك مفقود أو غير صالح",
    "الاتجاه غير محدد",
    "لم يتم إدخال أي أسعار للعقار",
  ]);
  assert.equal(result.label, "غير مكتمل");
});

test("unknown image storage state is not mislabeled as zero images", () => {
  const result = getVerificationStatus(completeProperty, null, now);

  assert.equal(result.level, "ok");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.issues.some((issue) => issue.includes("الصور")), false);
});

test("ordinary subscriptions are flagged immediately after the 40-day ceiling", () => {
  const fortyOneDaysAgo = new Date(now);
  fortyOneDaysAgo.setUTCDate(fortyOneDaysAgo.getUTCDate() - 41);
  const thirtyNineDaysAgo = new Date(now);
  thirtyNineDaysAgo.setUTCDate(thirtyNineDaysAgo.getUTCDate() - 39);

  const old = getVerificationStatus(
    {
      ...completeProperty,
      subscriptionType: "عادي",
      subscriptionDate: fortyOneDaysAgo.toISOString(),
    },
    3,
    now,
  );
  const valid = getVerificationStatus(
    {
      ...completeProperty,
      subscriptionType: "عادي",
      subscriptionDate: thirtyNineDaysAgo.toISOString(),
    },
    3,
    now,
  );

  assert.ok(old.warnings.includes("اشتراك عادي قديم (أكثر من 40 يوماً)"));
  assert.equal(old.level, "danger");
  assert.equal(valid.warnings.some((warning) => warning.includes("40")), false);
});
