import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { AdminApprovalError } from "../../errors/AdminApprovalError";
import {
  firebaseService,
  LinkedPropertyMutationError,
} from "../../firebaseService";
import { analyticsService, subscriptionService } from "../../services";
import { adminApprovalService } from "../../services/AdminApprovalService";
import propertiesRouter from "./properties";

test("additional-property approval preflights every property and reports exact failures", async (t) => {
  const originals = {
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
    getSubscriptionByProperty: subscriptionService.getByProperty,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    updateProperty: firebaseService.updateProperty,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
    updateSubscription: firebaseService.updateSubscription,
    mutateLinkedPropertyGroupAtomically:
      firebaseService.mutateLinkedPropertyGroupAtomically,
    addVerificationLog: analyticsService.addVerificationLog,
  };

  const events: string[] = [];
  let writes = 0;

  const installSuccessfulPreflight = () => {
    (adminApprovalService as any).requireCompleteProperty = async (
      propertyNumber: string,
    ) => {
      events.push(`preflight:${propertyNumber}`);
      const property =
        propertyNumber === "PROP-ADD"
          ? {
              propertyNumber,
              name: "Additional property",
              pendingApprovalFrom: "PROP-MAIN",
            }
          : {
              propertyNumber,
              name: "Main property",
              subscriptionType: "عادي",
            };
      return {
        property,
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      };
    };
    (subscriptionService as any).getByProperty = async (
      propertyNumber: string,
    ) => {
      events.push(`subscription-read:${propertyNumber}`);
      return {
        id: "SUB-MAIN",
        propertyNumber,
        packageId: "pkg-normal",
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-07-31T00:00:00.000Z",
        status: "نشط",
        subscriptionType: "عادي",
        linkedProperties: [],
      };
    };
  };

  const installSuccessfulWrites = () => {
    (firebaseService as any).mutateLinkedPropertyGroupAtomically = async () => {
      writes += 1;
      events.push("atomic-group-mutation");
      return {
        mainPropertyNumber: "PROP-MAIN",
        linkedProperties: ["PROP-ADD"],
        addedProperties: ["PROP-ADD"],
        removedProperties: [],
        mainSubscription: {
          id: "SUB-MAIN",
          propertyNumber: "PROP-MAIN",
          packageId: "pkg-normal",
          startDate: "2026-07-01T00:00:00.000Z",
          endDate: "2026-07-31T00:00:00.000Z",
          status: "نشط",
        },
      };
    };
    (analyticsService as any).addVerificationLog = async () => {
      events.push("analytics-log");
    };
  };

  const reset = () => {
    events.length = 0;
    writes = 0;
    installSuccessfulPreflight();
    installSuccessfulWrites();
  };

  const app = express();
  app.use(express.json());
  app.use(propertiesRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/api/admin/properties/PROP-ADD/approve-additional`;
  const approve = () => fetch(endpoint, { method: "PUT" });

  try {
    await t.test("zero images and every missing field are returned before any write", async () => {
      reset();
      const missingFields = [
        "اسم العقار",
        "الموقع",
        "المرافق",
        "الصور (0/3 كحد أدنى)",
      ];
      (adminApprovalService as any).requireCompleteProperty = async () => {
        throw new AdminApprovalError({
          status: 422,
          code: "PROPERTY_INCOMPLETE",
          message: "لا يمكن قبول العقار قبل استكمال جميع البيانات المطلوبة.",
          missingFields,
          warnings: ["الأسعار غير مكتملة"],
        });
      };

      const response = await approve();
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), {
        success: false,
        code: "PROPERTY_INCOMPLETE",
        message: "لا يمكن قبول العقار قبل استكمال جميع البيانات المطلوبة.",
        error: "لا يمكن قبول العقار قبل استكمال جميع البيانات المطلوبة.",
        missingFields,
        warnings: ["الأسعار غير مكتملة"],
      });
      assert.equal(writes, 0);
    });

    await t.test("image storage unavailability is not reported as zero images", async () => {
      reset();
      (adminApprovalService as any).requireCompleteProperty = async () => {
        throw new AdminApprovalError({
          status: 503,
          code: "IMAGE_STORAGE_UNAVAILABLE",
          message: "تعذر التحقق من صور العقار حالياً.",
        });
      };

      const response = await approve();
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.equal(payload.code, "IMAGE_STORAGE_UNAVAILABLE");
      assert.equal(payload.message, "تعذر التحقق من صور العقار حالياً.");
      assert.equal(payload.missingFields, undefined);
      assert.equal(writes, 0);
    });

    await t.test("unexpected preflight failures use a safe internal-error message", async () => {
      reset();
      const internalDetail = "SECRET_ADDITIONAL_PROPERTY_DATABASE_PATH";
      (adminApprovalService as any).requireCompleteProperty = async () => {
        throw new Error(internalDetail);
      };

      const response = await approve();
      const responseText = await response.text();
      const payload = JSON.parse(responseText);
      assert.equal(response.status, 500);
      assert.equal(payload.code, "APPROVAL_FAILED");
      assert.equal(payload.message, "تعذر قبول العقار الإضافي حالياً. حاول مرة أخرى.");
      assert.equal(responseText.includes(internalDetail), false);
      assert.equal(writes, 0);
    });

    await t.test("both linked properties and the subscription are read before a successful write", async () => {
      reset();

      const response = await approve();
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(writes, 1);
      assert.deepEqual(events, [
        "preflight:PROP-ADD",
        "preflight:PROP-MAIN",
        "subscription-read:PROP-MAIN",
        "atomic-group-mutation",
        "analytics-log",
      ]);
    });

    await t.test("a blocked atomic mutation reports the exact reason without a partial result", async () => {
      reset();
      (firebaseService as any).mutateLinkedPropertyGroupAtomically = async () => {
        throw new LinkedPropertyMutationError(
          "لا يمكن تعديل العقارات المرتبطة أثناء وجود عملية دفع قيد التنفيذ",
          409,
          "PAYMENT_ACTION_IN_PROGRESS",
        );
      };

      const response = await approve();
      const payload = await response.json();
      assert.equal(response.status, 409);
      assert.equal(payload.code, "PAYMENT_ACTION_IN_PROGRESS");
      assert.equal(
        payload.message,
        "لا يمكن تعديل العقارات المرتبطة أثناء وجود عملية دفع قيد التنفيذ",
      );
      assert.equal(payload.partial, undefined);
      assert.equal(writes, 0);
    });
  } finally {
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
    subscriptionService.getByProperty = originals.getSubscriptionByProperty;
    firebaseService.updateVerificationStatus =
      originals.updateVerificationStatus;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.addSubscriptionToSheet = originals.addSubscriptionToSheet;
    firebaseService.updateSubscription = originals.updateSubscription;
    firebaseService.mutateLinkedPropertyGroupAtomically =
      originals.mutateLinkedPropertyGroupAtomically;
    analyticsService.addVerificationLog = originals.addVerificationLog;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
