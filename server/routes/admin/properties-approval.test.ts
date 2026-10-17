import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { AdminApprovalError } from "../../errors/AdminApprovalError";
import { firebaseService } from "../../firebaseService";
import { clearSettingsCache } from "../../integrations/whatsapp";
import {
  analyticsService,
  paymentService,
  propertyService,
  subscriptionService,
} from "../../services";
import { adminApprovalService } from "../../services/AdminApprovalService";
import propertiesRouter from "./properties";
import {
  createPublicFreeCommissionConsent,
  createPublicRegistrationPlan,
} from "../../../shared/freeCommissionConsent";

test("property approval preflight prevents mutations and returns safe errors", async (t) => {
  const originals = {
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
    getByProperty: paymentService.getByProperty,
    updatePayment: paymentService.update,
    getSubscriptionByProperty: subscriptionService.getByProperty,
    getPackageById: subscriptionService.getPackageById,
    getPropertyByNumber: propertyService.getByNumber,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    updateProperty: firebaseService.updateProperty,
    getFirebaseSubscription: firebaseService.getSubscriptionByPropertyNumber,
    getMultiPropertySubscriptions:
      firebaseService.getMultiPropertySubscriptions,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    getNotificationSettings: firebaseService.getNotificationSettings,
    addVerificationLog: analyticsService.addVerificationLog,
  };
  let paymentReads = 0;
  let verificationWrites = 0;
  let propertyWrites = 0;
  let verificationLogs = 0;

  (paymentService as any).getByProperty = async () => {
    paymentReads += 1;
    return [];
  };
  (firebaseService as any).updateVerificationStatus = async () => {
    verificationWrites += 1;
    return {};
  };
  (analyticsService as any).addVerificationLog = async () => {
    verificationLogs += 1;
  };
  (firebaseService as any).updateProperty = async (
    propertyNumber: string,
    updates: Record<string, unknown>,
  ) => {
    propertyWrites += 1;
    return { propertyNumber, ...updates };
  };
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;

  const app = express();
  app.use(express.json());
  app.use(propertiesRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/api/admin/properties/PROP-1/approve`;
  const rejectionEndpoint = `http://127.0.0.1:${port}/api/admin/properties/PROP-1/reject`;

  const approve = () => fetch(endpoint, { method: "PUT" });
  const rejectProperty = () =>
    fetch(rejectionEndpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "قرار إداري بعد المراجعة" }),
    });
  const resetCounters = () => {
    paymentReads = 0;
    verificationWrites = 0;
    propertyWrites = 0;
    verificationLogs = 0;
  };

  try {
    await t.test("a suspended subscription is rejected before property validation or writes", async () => {
      resetCounters();
      let validationReads = 0;
      (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
        id: "SUB-PROP-1",
        propertyNumber: "PROP-1",
        status: "موقوف مؤقتاً",
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-08-01T00:00:00.000Z",
        suspendedAt: "2026-07-20T00:00:00.000Z",
        remainingDurationMs: 12 * 24 * 60 * 60 * 1000,
      });
      (adminApprovalService as any).requireCompleteProperty = async () => {
        validationReads += 1;
        throw new Error("validation must not run while suspended");
      };

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 423);
      assert.equal(payload.code, "PROPERTY_SUSPENDED");
      assert.equal(validationReads, 0);
      assert.equal(paymentReads, 0);
      assert.equal(verificationWrites, 0);
      assert.equal(propertyWrites, 0);

      (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
    });

    await t.test("incomplete property details are returned before any approval work", async () => {
      resetCounters();
      (adminApprovalService as any).requireCompleteProperty = async () => {
        throw new AdminApprovalError({
          status: 422,
          code: "PROPERTY_INCOMPLETE",
          message: "Complete the required property data before approval.",
          missingFields: ["location", "images"],
          warnings: ["prices"],
        });
      };

      const response = await approve();
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), {
        success: false,
        code: "PROPERTY_INCOMPLETE",
        message: "Complete the required property data before approval.",
        error: "Complete the required property data before approval.",
        missingFields: ["location", "images"],
        warnings: ["prices"],
      });
      assert.equal(paymentReads, 0);
      assert.equal(verificationWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("image-storage outages are distinguishable from incomplete data", async () => {
      resetCounters();
      (adminApprovalService as any).requireCompleteProperty = async () => {
        throw new AdminApprovalError({
          status: 503,
          code: "IMAGE_STORAGE_UNAVAILABLE",
          message: "Image verification is temporarily unavailable.",
        });
      };

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 503);
      assert.equal(payload.code, "IMAGE_STORAGE_UNAVAILABLE");
      assert.equal(payload.message, "Image verification is temporarily unavailable.");
      assert.equal(paymentReads, 0);
      assert.equal(verificationWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("unexpected preflight failures do not leak internal details", async () => {
      resetCounters();
      const internalDetail = "SECRET_R2_ENDPOINT_AND_CREDENTIAL";
      (adminApprovalService as any).requireCompleteProperty = async () => {
        throw new Error(internalDetail);
      };

      const response = await approve();
      const responseText = await response.text();
      const payload = JSON.parse(responseText);

      assert.equal(response.status, 500);
      assert.equal(payload.code, "APPROVAL_FAILED");
      assert.equal(payload.message, payload.error);
      assert.equal(responseText.includes(internalDetail), false);
      assert.equal(paymentReads, 0);
      assert.equal(verificationWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("a pending payment without a package cannot approve the property", async () => {
      resetCounters();
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: {
          propertyNumber: "PROP-1",
          name: "Ready property",
        },
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => {
        paymentReads += 1;
        return [
          {
            id: "payment-1",
            propertyNumber: "PROP-1",
            status: "نجح - قيد التحقق",
            createdAt: "2026-07-26T12:00:00.000Z",
          },
        ];
      };

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 422);
      assert.equal(payload.code, "PAYMENT_PACKAGE_MISSING");
      assert.equal(paymentReads, 1);
      assert.equal(verificationWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("a complete property without a pending payment is approved", async () => {
      resetCounters();
      const readyProperty = {
        propertyNumber: "PROP-1",
        name: "Ready property",
      };
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: readyProperty,
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => {
        paymentReads += 1;
        return [];
      };
      (subscriptionService as any).getByProperty = async () => null;
      (propertyService as any).getByNumber = async () => readyProperty;
      (firebaseService as any).getNotificationSettings = async () => ({
        allNotifications: false,
        propertyVerification: false,
      });
      clearSettingsCache();

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(paymentReads, 1);
      assert.equal(verificationWrites, 1);
      assert.equal(propertyWrites, 1);
      assert.equal(verificationLogs, 1);
    });

    await t.test("a tracked free registration without valid consent cannot be approved", async () => {
      resetCounters();
      const readyProperty = {
        propertyNumber: "PROP-1",
        name: "Tracked free property",
        registrationPlan: createPublicRegistrationPlan({
          packageId: "pkg-free",
          isFree: true,
          selectedAt: "2026-08-24T10:00:00.000Z",
        }),
      };
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: readyProperty,
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => {
        paymentReads += 1;
        return [];
      };

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 409);
      assert.equal(payload.code, "FREE_COMMISSION_CONSENT_REQUIRED");
      assert.equal(paymentReads, 1);
      assert.equal(verificationWrites, 0);
      assert.equal(propertyWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("a tracked free registration with matching consent can be approved", async () => {
      resetCounters();
      const selectedAt = "2026-08-24T10:00:00.000Z";
      const readyProperty = {
        propertyNumber: "PROP-1",
        name: "Consented free property",
        registrationPlan: createPublicRegistrationPlan({
          packageId: "pkg-free",
          isFree: true,
          selectedAt,
        }),
        freeCommissionConsent: createPublicFreeCommissionConsent({
          packageId: "pkg-free",
          acceptedAt: selectedAt,
        }),
      };
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: readyProperty,
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => {
        paymentReads += 1;
        return [];
      };
      (subscriptionService as any).getByProperty = async () => null;
      (propertyService as any).getByNumber = async () => readyProperty;
      (firebaseService as any).getNotificationSettings = async () => ({
        allNotifications: false,
        propertyVerification: false,
      });
      clearSettingsCache();

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(verificationWrites, 1);
      assert.equal(propertyWrites, 1);
      assert.equal(verificationLogs, 1);
    });

    await t.test("a tracked paid registration cannot silently become free without payment", async () => {
      resetCounters();
      const readyProperty = {
        propertyNumber: "PROP-1",
        name: "Tracked paid property",
        registrationPlan: createPublicRegistrationPlan({
          packageId: "pkg-paid",
          isFree: false,
          selectedAt: "2026-08-24T10:00:00.000Z",
        }),
      };
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: readyProperty,
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => {
        paymentReads += 1;
        return [];
      };
      (subscriptionService as any).getByProperty = async () => null;

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 409);
      assert.equal(payload.code, "PAID_REGISTRATION_PAYMENT_REQUIRED");
      assert.equal(paymentReads, 1);
      assert.equal(verificationWrites, 0);
      assert.equal(propertyWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("a tracked paid registration with an active premium subscription can be approved", async () => {
      resetCounters();
      const readyProperty = {
        propertyNumber: "PROP-1",
        name: "Paid property with active subscription",
        registrationPlan: createPublicRegistrationPlan({
          packageId: "pkg-paid",
          isFree: false,
          selectedAt: "2026-08-24T10:00:00.000Z",
        }),
      };
      const activePremiumSubscription = {
        id: "SUB-PROP-1",
        propertyNumber: "PROP-1",
        packageId: "pkg-paid",
        subscriptionType: "مميز",
        status: "ساري",
        startDate: new Date().toISOString(),
        endDate: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      };
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: readyProperty,
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => {
        paymentReads += 1;
        return [];
      };
      (subscriptionService as any).getByProperty = async () =>
        activePremiumSubscription;
      (propertyService as any).getByNumber = async () => readyProperty;
      (firebaseService as any).getNotificationSettings = async () => ({
        allNotifications: false,
        propertyVerification: false,
      });
      clearSettingsCache();

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(paymentReads, 1);
      assert.equal(verificationWrites, 1);
      assert.equal(propertyWrites, 1);
      assert.equal(verificationLogs, 1);
    });

    await t.test("activation failures return a safe contextual reason", async () => {
      resetCounters();
      const internalDetail = "SECRET_ACTIVATION_DATABASE_PATH";
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: { propertyNumber: "PROP-1", name: "Ready property" },
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => [{
        id: "payment-activation",
        propertyNumber: "PROP-1",
        packageId: "package-1",
        status: "نجح - قيد التحقق",
        createdAt: "2026-07-26T12:00:00.000Z",
        finalAmount: 100,
      }];
      (subscriptionService as any).getPackageById = async () => ({
        id: "package-1",
        duration: 30,
        price: 100,
        type: "مميز",
      });
      (subscriptionService as any).getByProperty = async () => null;
      (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
      (firebaseService as any).claimPaymentFulfillment = async () => {
        throw new Error(internalDetail);
      };

      const response = await approve();
      const responseText = await response.text();
      const payload = JSON.parse(responseText);

      assert.equal(response.status, 500);
      assert.equal(payload.code, "PAYMENT_ACTIVATION_FAILED");
      assert.equal(responseText.includes(internalDetail), false);
      assert.equal(verificationWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("a post-activation payment failure reports partial completion", async () => {
      resetCounters();
      const internalDetail = "SECRET_PAYMENT_FINALIZATION_PATH";
      const currentSubscription = {
        id: "SUB-PROP-1",
        propertyNumber: "PROP-1",
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-08-01T00:00:00.000Z",
        subscriptionType: "مميز",
        status: "نشط",
      };
      (adminApprovalService as any).requireCompleteProperty = async () => ({
        property: { propertyNumber: "PROP-1", name: "Ready property" },
        imageCount: 3,
        validation: { isComplete: true, missingFields: [], warnings: [] },
      });
      (paymentService as any).getByProperty = async () => [{
        id: "payment-finalization",
        propertyNumber: "PROP-1",
        packageId: "package-1",
        status: "نجح - قيد التحقق",
        createdAt: "2026-07-26T12:00:00.000Z",
        fulfilledAt: "2026-07-26T12:01:00.000Z",
        finalAmount: 100,
      }];
      (paymentService as any).update = async () => {
        throw new Error(internalDetail);
      };
      (subscriptionService as any).getPackageById = async () => ({
        id: "package-1",
        duration: 30,
        price: 100,
        type: "مميز",
      });
      (subscriptionService as any).getByProperty = async () => currentSubscription;
      (firebaseService as any).getSubscriptionByPropertyNumber = async () =>
        currentSubscription;

      const response = await approve();
      const responseText = await response.text();
      const payload = JSON.parse(responseText);

      assert.equal(response.status, 500);
      assert.equal(payload.code, "APPROVAL_PARTIALLY_COMPLETED");
      assert.equal(payload.partial, true);
      assert.equal(responseText.includes(internalDetail), false);
      assert.equal(verificationWrites, 1);
      assert.equal(verificationLogs, 0);
    });

    await t.test("property rejection reports a missing property before writing", async () => {
      resetCounters();
      (propertyService as any).getByNumber = async () => null;

      const response = await rejectProperty();
      const payload = await response.json();

      assert.equal(response.status, 404);
      assert.equal(payload.code, "PROPERTY_NOT_FOUND");
      assert.equal(verificationWrites, 0);
      assert.equal(verificationLogs, 0);
    });

    await t.test("an ambiguous rejection write is clearly marked partial", async () => {
      resetCounters();
      const internalDetail = "SECRET_REJECTION_WRITE_PATH";
      (propertyService as any).getByNumber = async () => ({
        propertyNumber: "PROP-1",
        name: "Ready property",
      });
      (firebaseService as any).updateVerificationStatus = async () => {
        verificationWrites += 1;
        throw new Error(internalDetail);
      };

      const response = await rejectProperty();
      const responseText = await response.text();
      const payload = JSON.parse(responseText);

      assert.equal(response.status, 500);
      assert.equal(payload.code, "PROPERTY_REJECTION_FAILED");
      assert.equal(payload.partial, true);
      assert.equal(responseText.includes(internalDetail), false);
      assert.equal(verificationWrites, 1);
      assert.equal(verificationLogs, 0);
    });

    await t.test("audit-log failure cannot turn a completed rejection into failure", async () => {
      resetCounters();
      (propertyService as any).getByNumber = async () => ({
        propertyNumber: "PROP-1",
        name: "Ready property",
      });
      (firebaseService as any).updateVerificationStatus = async () => {
        verificationWrites += 1;
        return { propertyNumber: "PROP-1", verificationStatus: "rejected" };
      };
      (analyticsService as any).addVerificationLog = async () => {
        verificationLogs += 1;
        throw new Error("audit unavailable");
      };
      (firebaseService as any).getNotificationSettings = async () => ({
        allNotifications: false,
        propertyVerification: false,
      });
      clearSettingsCache();

      const response = await rejectProperty();
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(verificationWrites, 1);
      assert.equal(verificationLogs, 1);
    });
  } finally {
    adminApprovalService.requireCompleteProperty = originals.requireCompleteProperty;
    paymentService.getByProperty = originals.getByProperty;
    paymentService.update = originals.updatePayment;
    subscriptionService.getByProperty = originals.getSubscriptionByProperty;
    subscriptionService.getPackageById = originals.getPackageById;
    propertyService.getByNumber = originals.getPropertyByNumber;
    firebaseService.updateVerificationStatus = originals.updateVerificationStatus;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getFirebaseSubscription;
    firebaseService.getMultiPropertySubscriptions =
      originals.getMultiPropertySubscriptions;
    firebaseService.claimPaymentFulfillment = originals.claimPaymentFulfillment;
    firebaseService.getNotificationSettings = originals.getNotificationSettings;
    analyticsService.addVerificationLog = originals.addVerificationLog;
    clearSettingsCache();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
