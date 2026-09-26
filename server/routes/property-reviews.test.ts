import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

import propertyReviewRouter from "./property-reviews";
import { propertyReviewService } from "../services/PropertyReviewService";

async function withReviewServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = req.get("x-test-admin") === "yes"
      ? { isAdmin: true }
      : {};
    next();
  });
  app.use(propertyReviewRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
}

test("public review endpoint exposes only the safe review payload returned by the service", async () => {
  const original = propertyReviewService.listPublicForProperty;
  propertyReviewService.listPublicForProperty = async () => ({
    aggregate: {
      count: 1,
      averageOverall: 5,
      averageCleanliness: 4,
      averageAccuracy: 5,
      averageOwnerResponsiveness: 5,
    },
    reviews: [{
      id: "public-id",
      customerDisplayName: "عميل موثّق",
      verifiedCustomer: true,
      overallRating: 5,
      cleanlinessRating: 4,
      accuracyRating: 5,
      ownerResponsivenessRating: 5,
      text: "ممتاز",
      createdAt: "2026-09-26T12:00:00.000Z",
      updatedAt: "2026-09-26T12:00:00.000Z",
    }],
  });
  try {
    await withReviewServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/properties/P-1/reviews`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control") || "", /max-age=60/);
      const payload = await response.json();
      assert.equal(payload.reviews[0].customerDisplayName, "عميل موثّق");
      assert.equal("customerPhone" in payload.reviews[0], false);
      assert.equal("customerSubject" in payload.reviews[0], false);
    });
  } finally {
    propertyReviewService.listPublicForProperty = original;
  }
});

test("admin review moderation requires an admin session and same-origin request", async () => {
  const original = propertyReviewService.moderate;
  let calls = 0;
  propertyReviewService.moderate = async () => {
    calls += 1;
    return {
      id: "booking-1",
      schemaVersion: 1,
      bookingId: "booking-1",
      requestCode: "REQ-1",
      propertyNumber: "P-1",
      propertyName: "",
      customerDisplayName: "عميل موثّق",
      overallRating: 5,
      cleanlinessRating: 5,
      accuracyRating: 5,
      ownerResponsivenessRating: 5,
      text: null,
      moderationStatus: "approved",
      moderationNote: null,
      moderatedAt: "2026-09-26T12:00:00.000Z",
      moderatedBy: "admin",
      createdAt: "2026-09-26T12:00:00.000Z",
      updatedAt: "2026-09-26T12:00:00.000Z",
    };
  };
  try {
    await withReviewServer(async (baseUrl) => {
      const unauthorized = await fetch(
        `${baseUrl}/api/admin/property-reviews/booking-1/moderation`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        },
      );
      assert.equal(unauthorized.status, 401);

      const crossOrigin = await fetch(
        `${baseUrl}/api/admin/property-reviews/booking-1/moderation`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-test-admin": "yes",
            "sec-fetch-site": "cross-site",
          },
          body: JSON.stringify({ status: "approved" }),
        },
      );
      assert.equal(crossOrigin.status, 403);

      const approved = await fetch(
        `${baseUrl}/api/admin/property-reviews/booking-1/moderation`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-test-admin": "yes",
          },
          body: JSON.stringify({ status: "approved" }),
        },
      );
      assert.equal(approved.status, 200);
      assert.equal((await approved.json()).review.moderationStatus, "approved");
      assert.equal(calls, 1);
    });
  } finally {
    propertyReviewService.moderate = original;
  }
});

test("customer review endpoints do not run without a verified customer session", async () => {
  const original = propertyReviewService.saveForCustomer;
  let calls = 0;
  propertyReviewService.saveForCustomer = async (..._args: any[]) => {
    calls += 1;
    throw new Error("must not run");
  };
  try {
    await withReviewServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/customer/reviews/booking-1`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 401);
      assert.equal(calls, 0);
    });
  } finally {
    propertyReviewService.saveForCustomer = original;
  }
});
