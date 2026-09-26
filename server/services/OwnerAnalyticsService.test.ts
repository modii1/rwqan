import assert from "node:assert/strict";
import test from "node:test";
import type { Property, Request as PropertyRequest } from "../../shared/schema";
import { calculateOwnerRequestAnalytics } from "./OwnerAnalyticsService";

function request(
  propertyNumber: string,
  timestamp: string,
  dayOfWeek: string,
  id: string,
): PropertyRequest {
  return {
    id,
    propertyNumber,
    requestCode: `REQ-${id}`,
    timestamp,
    ipAddress: "127.0.0.1",
    deviceType: "mobile",
    dayOfWeek,
    hourOfDay: 12,
  };
}

test("owner analytics use Riyadh calendar months and real request growth", () => {
  const result = calculateOwnerRequestAnalytics({
    propertyNumber: "P-1",
    now: new Date("2026-09-26T02:00:00.000Z"),
    properties: [{ propertyNumber: "P-1" }, { propertyNumber: "P-2" }] as Property[],
    requests: [
      request("P-1", "2026-09-01T12:00:00.000Z", "الثلاثاء", "1"),
      request("P-1", "2026-09-02T12:00:00.000Z", "الثلاثاء", "2"),
      request("P-1", "2026-09-03T12:00:00.000Z", "الخميس", "3"),
      request("P-1", "2026-08-03T12:00:00.000Z", "الإثنين", "4"),
      request("P-1", "2026-08-04T12:00:00.000Z", "الثلاثاء", "5"),
      request("P-2", "2026-09-05T12:00:00.000Z", "السبت", "6"),
      request("P-2", "2026-09-06T12:00:00.000Z", "الأحد", "7"),
      request("P-2", "2026-09-07T12:00:00.000Z", "الإثنين", "8"),
      request("P-2", "2026-09-08T12:00:00.000Z", "الثلاثاء", "9"),
    ],
  });

  assert.equal(result.monthlyRequests, 3);
  assert.equal(result.previousMonthRequests, 2);
  assert.equal(result.previousMonthGrowth, 50);
  assert.equal(result.dailyAverage, 0.1);
  assert.equal(result.highestDemandDay, "الثلاثاء");
  assert.equal(result.rank, 1);
  assert.equal(result.totalProperties, 2);
});

test("owner analytics include zero-request properties without inventing rank data", () => {
  const result = calculateOwnerRequestAnalytics({
    propertyNumber: "P-3",
    now: new Date("2026-01-15T12:00:00.000Z"),
    properties: [
      { propertyNumber: "P-1" },
      { propertyNumber: "P-2" },
      { propertyNumber: "P-3" },
    ] as Property[],
    requests: [
      request("P-1", "2025-12-10T12:00:00.000Z", "الأربعاء", "1"),
      request("P-2", "invalid", "الخميس", "2"),
    ],
  });

  assert.equal(result.totalRequests, 0);
  assert.equal(result.monthlyRequests, 0);
  assert.equal(result.previousMonthRequests, 0);
  assert.equal(result.previousMonthGrowth, 0);
  assert.equal(result.dailyAverage, 0);
  assert.equal(result.rank, 3);
  assert.equal(result.totalProperties, 3);
  assert.equal(result.highestDemandDay, "لا يوجد بيانات");
});

test("owner analytics handle January rollover and first-month growth", () => {
  const result = calculateOwnerRequestAnalytics({
    propertyNumber: "P-1",
    now: new Date("2026-01-15T12:00:00.000Z"),
    properties: [{ propertyNumber: "P-1" }] as Property[],
    requests: [
      request("P-1", "2026-01-03T12:00:00.000Z", "السبت", "1"),
      request("P-1", "2025-11-30T20:00:00.000Z", "الأحد", "2"),
    ],
  });

  assert.equal(result.monthlyRequests, 1);
  assert.equal(result.previousMonthRequests, 0);
  assert.equal(result.previousMonthGrowth, 100);
});
