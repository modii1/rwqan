import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminActionError,
  getAdminActionErrorMessage,
  readAdminActionResponse,
} from "./admin-action-response";

test("admin actions preserve every structured property validation reason", async () => {
  const response = new Response(
    JSON.stringify({
      code: "PROPERTY_INCOMPLETE",
      error: "لا يمكن قبول العقار قبل استكمال البيانات",
      missingFields: ["الصور (0/3 كحد أدنى)", "المرافق", "الموقع"],
    }),
    { status: 422, headers: { "content-type": "application/json" } },
  );

  await assert.rejects(
    readAdminActionResponse(response, "فشل قبول العقار"),
    (error: unknown) => {
      assert.ok(error instanceof AdminActionError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "PROPERTY_INCOMPLETE");
      assert.deepEqual(error.missingFields, [
        "الصور (0/3 كحد أدنى)",
        "المرافق",
        "الموقع",
      ]);
      assert.match(error.message, /الصور \(0\/3 كحد أدنى\)/);
      assert.match(error.message, /المرافق/);
      assert.match(error.message, /الموقع/);
      return true;
    },
  );
});

test("additional-property approval keeps the server reason, missing fields, and warnings", async () => {
  const response = new Response(
    JSON.stringify({
      success: false,
      code: "PROPERTY_INCOMPLETE",
      message: "لا يمكن قبول العقار الإضافي قبل استكمال البيانات",
      missingFields: ["الصور (0/3 كحد أدنى)", "الموقع"],
      warnings: ["الأسعار غير مكتملة"],
    }),
    { status: 422, headers: { "content-type": "application/json" } },
  );

  await assert.rejects(
    readAdminActionResponse(
      response,
      "تعذر قبول العقار الإضافي حالياً. حاول مرة أخرى.",
    ),
    (error: unknown) => {
      assert.ok(error instanceof AdminActionError);
      assert.equal(error.code, "PROPERTY_INCOMPLETE");
      assert.match(error.message, /لا يمكن قبول العقار الإضافي/);
      assert.match(error.message, /الصور \(0\/3 كحد أدنى\)/);
      assert.match(error.message, /الموقع/);
      assert.deepEqual(error.missingFields, [
        "الصور (0/3 كحد أدنى)",
        "الموقع",
      ]);
      assert.deepEqual(error.warnings, ["الأسعار غير مكتملة"]);
      return true;
    },
  );
});

test("admin actions append only unique reasons not already present", async () => {
  const response = new Response(
    JSON.stringify({
      error: "البيانات ناقصة: الموقع",
      missingFields: ["الموقع", "المرافق", "المرافق"],
    }),
    { status: 422 },
  );

  await assert.rejects(
    readAdminActionResponse(response, "فشل قبول العقار"),
    (error: unknown) => {
      assert.ok(error instanceof AdminActionError);
      assert.equal(error.message, "البيانات ناقصة: الموقع: المرافق");
      assert.deepEqual(error.missingFields, ["الموقع", "المرافق"]);
      return true;
    },
  );
});

test("admin actions preserve partial completion and warnings", async () => {
  await assert.rejects(
    readAdminActionResponse(
      new Response(
        JSON.stringify({
          code: "APPROVAL_PARTIALLY_COMPLETED",
          message: "تم القبول لكن تعذر إنهاء حالة الدفع",
          partial: true,
          warnings: ["راجع حالة الدفع"],
        }),
        { status: 500 },
      ),
      "فشل قبول العقار",
    ),
    (error: unknown) => {
      assert.ok(error instanceof AdminActionError);
      assert.equal(error.partial, true);
      assert.deepEqual(error.warnings, ["راجع حالة الدفع"]);
      return true;
    },
  );
});

test("admin actions retain safe backend error and message payloads", async () => {
  await assert.rejects(
    readAdminActionResponse(
      new Response(JSON.stringify({ error: "الباقة غير موجودة" }), { status: 404 }),
      "فشل قبول التحويل",
    ),
    /الباقة غير موجودة/,
  );

  await assert.rejects(
    readAdminActionResponse(
      new Response(JSON.stringify({ message: "تعذر الاتصال بخدمة الصور" }), { status: 503 }),
      "فشل قبول العقار",
    ),
    /تعذر الاتصال بخدمة الصور/,
  );
});

test("admin actions use a controlled fallback for malformed failures", async () => {
  await assert.rejects(
    readAdminActionResponse(
      new Response("<html>proxy failure</html>", { status: 500 }),
      "تعذر إكمال العملية، حاول مرة أخرى",
    ),
    /تعذر إكمال العملية، حاول مرة أخرى/,
  );
  assert.equal(
    getAdminActionErrorMessage(null, "فشل قبول العقار"),
    "فشل قبول العقار",
  );
  assert.equal(
    getAdminActionErrorMessage(new TypeError("Failed to fetch"), "فشل قبول العقار"),
    "فشل قبول العقار",
  );
});

test("admin actions return successful JSON payloads", async () => {
  const result = await readAdminActionResponse<{ success: boolean }>(
    new Response(JSON.stringify({ success: true }), { status: 200 }),
    "فشل",
  );
  assert.deepEqual(result, { success: true });
});

test("admin actions reject unconfirmed or malformed 2xx responses", async () => {
  for (const body of [
    "",
    "<html>proxy fallback</html>",
    JSON.stringify({ ok: false }),
  ]) {
    await assert.rejects(
      readAdminActionResponse(
        new Response(body, { status: 200 }),
        "لم يؤكد الخادم نجاح العملية",
      ),
      (error: unknown) => {
        assert.ok(error instanceof AdminActionError);
        assert.equal(error.status, 502);
        assert.equal(error.code, "INVALID_SUCCESS_RESPONSE");
        assert.equal(error.message, "لم يؤكد الخادم نجاح العملية");
        return true;
      },
    );
  }
});

test("admin actions reject a confirmed success with an invalid domain outcome", async () => {
  await assert.rejects(
    () =>
      readAdminActionResponse(
        new Response(JSON.stringify({ ok: true, outcome: "unknown" }), {
          status: 200,
        }),
        "Invalid payment result",
        (payload) =>
          payload.outcome === "queued" || payload.outcome === "activated",
      ),
    (error: unknown) => {
      assert.ok(error instanceof AdminActionError);
      assert.equal(error.code, "INVALID_SUCCESS_RESPONSE");
      assert.equal(error.message, "Invalid payment result");
      return true;
    },
  );
});
