import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { firebaseService } from "../../firebaseService";
import {
  analyticsService,
  propertyService,
  paymentService,
  subscriptionService,
} from "../../services";
import adminAnalyticsRouter from "./analytics";

test("admin alerts stats use the unified subscription status", async () => {
  const originalGetAllSubscriptions = subscriptionService.getAll;
  const originalGetPayments = paymentService.getAll;
  const originalGetAllRequests = analyticsService.getAllRequests;
  const originalGetAllProperties = propertyService.getAll;
  const originalGetSuggestions = firebaseService.getSuggestions;

  (subscriptionService as any).getAll = async () => [
    {
      // حالة مخزنة «منتهي» بتاريخ نهاية مستقبلي بدون إلغاء → محسوبة الآن كـ «ساري».
      propertyNumber: "CON-1",
      status: "منتهي",
      endDate: "2030-01-01T00:00:00.000Z",
      startDate: "2026-11-09T00:00:00.000Z",
      cancelledAt: null,
      suspendedAt: null,
      subscriptionType: "premium",
    },
    {
      // اشتراك منتهي فعلياً (تاريخ نهاية ماضي).
      propertyNumber: "EXP-1",
      status: "منتهي",
      endDate: "2020-01-01T00:00:00.000Z",
      startDate: "2019-01-01T00:00:00.000Z",
      cancelledAt: null,
      suspendedAt: null,
      subscriptionType: "premium",
    },
  ];
  (paymentService as any).getAll = async () => [];
  (analyticsService as any).getAllRequests = async () => [];
  (propertyService as any).getAll = async () => [
    { propertyNumber: "CON-1", name: "Contradictory property", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" },
    { propertyNumber: "EXP-1", name: "Expired property", createdAt: "2019-11-01T00:00:00.000Z", updatedAt: "2019-11-02T00:00:00.000Z" },
  ];
  (firebaseService as any).getSuggestions = async () => [];

  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.session = { isAdmin: true };
    next();
  });
  app.use(adminAnalyticsRouter);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/alerts`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.stats.activeSubscriptions, 1);
    assert.equal(payload.stats.expiredSubscriptions, 1);
    assert.equal(payload.stats.trustedProperties, 1);
  } finally {
    subscriptionService.getAll = originalGetAllSubscriptions;
    paymentService.getAll = originalGetPayments;
    analyticsService.getAllRequests = originalGetAllRequests;
    propertyService.getAll = originalGetAllProperties;
    firebaseService.getSuggestions = originalGetSuggestions;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
