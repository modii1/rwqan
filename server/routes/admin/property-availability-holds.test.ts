import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import {
  AdminPropertyAvailabilityHoldError,
  firebaseService,
} from "../../firebaseService";
import { adminPropertyAvailabilityService } from "../../services/AdminPropertyAvailabilityService";
import { registerRoutes } from "../index";

test("admin property availability hold routes enforce the privileged boundary and dispatch validated actions", async (t) => {
  const originals = {
    initializeSheets: firebaseService.initializeSheets,
    getDashboard: adminPropertyAvailabilityService.getDashboard,
    pause: adminPropertyAvailabilityService.pause,
    resume: adminPropertyAvailabilityService.resume,
  };
  const dashboard = {
    holds: [{
      propertyNumber: "FREE-HELD",
      name: "Held free property",
      kind: "manual_and_commission" as const,
      suspendedAt: "2026-08-30T12:00:00.000Z",
      manualHold: true,
      commissionHold: true,
      commissionObligationCount: 2,
      commissionHoldVersion: "timestamp:2026-08-30T12:00:00.000Z",
    }],
    candidates: [{
      propertyNumber: "FREE-READY",
      name: "Ready free property",
    }],
  };
  const dashboardReads: string[] = [];
  const pauseCalls: string[] = [];
  const resumeCalls: Array<{
    propertyNumber: string;
    expectedCommissionHoldVersion: string | null;
  }> = [];

  (firebaseService as any).initializeSheets = async () => undefined;
  (adminPropertyAvailabilityService as any).getDashboard = async () => {
    dashboardReads.push("read");
    return dashboard;
  };
  (adminPropertyAvailabilityService as any).pause = async (
    propertyNumber: string,
  ) => {
    pauseCalls.push(propertyNumber);
    if (propertyNumber === "PAID-100") {
      throw new AdminPropertyAvailabilityHoldError(
        "Only free properties can be paused here",
        409,
        "PROPERTY_NOT_FREE",
      );
    }
    return { changed: propertyNumber !== "FREE-ALREADY" };
  };
  (adminPropertyAvailabilityService as any).resume = async (
    propertyNumber: string,
    expectedCommissionHoldVersion: string | null,
  ) => {
    resumeCalls.push({ propertyNumber, expectedCommissionHoldVersion });
    return {
      changed: true,
      manualHoldReleased: true,
      overriddenCommissionObligations: 2,
    };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = req.get("x-test-admin") === "1"
      ? { isAdmin: true }
      : {};
    next();
  });

  let server: Server | undefined;
  try {
    server = await registerRoutes(app);
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const collectionUrl = `${baseUrl}/api/admin/property-availability-holds`;
    const adminHeaders = {
      "sec-fetch-site": "same-origin",
      "x-test-admin": "1",
    };

    await t.test("rejects anonymous and cross-origin requests before service dispatch", async () => {
      const anonymous = await fetch(collectionUrl, {
        headers: { "sec-fetch-site": "same-origin" },
      });
      assert.equal(anonymous.status, 401);
      assert.deepEqual(await anonymous.json(), {
        error: "Admin Login Required",
      });

      const crossOrigin = await fetch(collectionUrl, {
        headers: {
          "sec-fetch-site": "cross-site",
          "x-test-admin": "1",
        },
      });
      assert.equal(crossOrigin.status, 403);
      assert.equal(
        (await crossOrigin.json()).code,
        "CROSS_ORIGIN_REQUEST",
      );
      assert.equal(dashboardReads.length, 0);
    });

    await t.test("returns the sanitized dashboard without caching", async () => {
      const response = await fetch(collectionUrl, { headers: adminHeaders });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.deepEqual(await response.json(), dashboard);
      assert.deepEqual(dashboardReads, ["read"]);

      const serialized = JSON.stringify(dashboard);
      for (const privateField of [
        "whatsappNumber",
        "obligationIds",
        "adminAvailabilityHold",
        "commissionHoldOverride",
      ]) {
        assert.equal(serialized.includes(privateField), false);
      }
    });

    await t.test("dispatches pause and preserves idempotent results", async () => {
      const pause = await fetch(
        `${collectionUrl}/${encodeURIComponent(" FREE-READY ")}/pause`,
        {
          method: "POST",
          headers: adminHeaders,
        },
      );
      assert.equal(pause.status, 200);
      assert.equal(pause.headers.get("cache-control"), "no-store, private");
      assert.deepEqual(await pause.json(), {
        success: true,
        changed: true,
        message: "تم إيقاف العقار المجاني من الظهور والتواصل.",
      });

      const replay = await fetch(
        `${collectionUrl}/FREE-ALREADY/pause`,
        { method: "POST", headers: adminHeaders },
      );
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), {
        success: true,
        changed: false,
        message: "العقار موقوف بالفعل.",
      });
      assert.deepEqual(pauseCalls, ["FREE-READY", "FREE-ALREADY"]);
    });

    await t.test("dispatches resume and returns its release summary", async () => {
      const response = await fetch(
        `${collectionUrl}/FREE-HELD/resume`,
        {
          method: "POST",
          headers: {
            ...adminHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedCommissionHoldVersion:
              "timestamp:2026-08-30T12:00:00.000Z",
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.deepEqual(await response.json(), {
        success: true,
        changed: true,
        manualHoldReleased: true,
        overriddenCommissionObligations: 2,
        message: "تم إلغاء الإيقاف وتفعيل إتاحة العقار.",
      });
      assert.deepEqual(resumeCalls, [{
        propertyNumber: "FREE-HELD",
        expectedCommissionHoldVersion:
          "timestamp:2026-08-30T12:00:00.000Z",
      }]);
    });

    await t.test("requires the reviewed commission hold version on resume", async () => {
      const response = await fetch(
        `${collectionUrl}/FREE-HELD/resume`,
        { method: "POST", headers: adminHeaders },
      );
      assert.equal(response.status, 400);
      assert.deepEqual(resumeCalls, [{
        propertyNumber: "FREE-HELD",
        expectedCommissionHoldVersion:
          "timestamp:2026-08-30T12:00:00.000Z",
      }]);
    });

    await t.test("rejects invalid property identifiers before service dispatch", async () => {
      const overlongPropertyNumber = "P".repeat(201);
      const response = await fetch(
        `${collectionUrl}/${overlongPropertyNumber}/pause`,
        { method: "POST", headers: adminHeaders },
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).success, false);
      assert.deepEqual(pauseCalls, ["FREE-READY", "FREE-ALREADY"]);
    });

    await t.test("rejects unsafe property identifiers before service dispatch", async () => {
      const pauseCallsBeforeValidation = [...pauseCalls];
      const resumeCallsBeforeValidation = [...resumeCalls];

      for (const unsafePropertyNumber of ["FREE.BAD", "FREE/BAD"]) {
        const encodedPropertyNumber = encodeURIComponent(unsafePropertyNumber);
        const pauseResponse = await fetch(
          `${collectionUrl}/${encodedPropertyNumber}/pause`,
          { method: "POST", headers: adminHeaders },
        );
        assert.equal(pauseResponse.status, 400, unsafePropertyNumber);

        const resumeResponse = await fetch(
          `${collectionUrl}/${encodedPropertyNumber}/resume`,
          {
            method: "POST",
            headers: {
              ...adminHeaders,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              expectedCommissionHoldVersion: null,
            }),
          },
        );
        assert.equal(resumeResponse.status, 400, unsafePropertyNumber);
      }

      assert.deepEqual(pauseCalls, pauseCallsBeforeValidation);
      assert.deepEqual(resumeCalls, resumeCallsBeforeValidation);
    });

    await t.test("preserves domain error status and code", async () => {
      const response = await fetch(
        `${collectionUrl}/PAID-100/pause`,
        { method: "POST", headers: adminHeaders },
      );
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        success: false,
        code: "PROPERTY_NOT_FREE",
        error: "Only free properties can be paused here",
      });
      assert.deepEqual(pauseCalls, [
        "FREE-READY",
        "FREE-ALREADY",
        "PAID-100",
      ]);
    });
  } finally {
    firebaseService.initializeSheets = originals.initializeSheets;
    adminPropertyAvailabilityService.getDashboard = originals.getDashboard;
    adminPropertyAvailabilityService.pause = originals.pause;
    adminPropertyAvailabilityService.resume = originals.resume;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  }
});
