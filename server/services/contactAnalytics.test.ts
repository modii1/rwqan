import assert from "node:assert/strict";
import test from "node:test";
import type { ContactEvent, Request as PropertyRequest } from "../../shared/schema";
import { buildContactAnalytics } from "./contactAnalytics";

const now = Date.parse("2026-07-10T12:00:00.000Z");

test("contact analytics combines legacy requests without double counting accepted events", () => {
  const contactEvents: ContactEvent[] = [
    {
      id: "event-1",
      propertyNumber: "14006",
      timestamp: "2026-07-10T10:00:00.000Z",
      visitorKey: "owner:1",
      actorType: "owner",
      deviceType: "mobile",
      outcome: "accepted",
      requestCode: "REQ-1",
    },
    {
      id: "event-2",
      propertyNumber: "14006",
      timestamp: "2026-07-10T10:05:00.000Z",
      visitorKey: "owner:1",
      actorType: "owner",
      deviceType: "mobile",
      outcome: "cooldown",
    },
  ];
  const requests: PropertyRequest[] = [
    {
      id: "request-1",
      propertyNumber: "14006",
      requestCode: "REQ-1",
      timestamp: "2026-07-10T10:00:00.000Z",
      ipAddress: "10.0.0.1",
      deviceType: "mobile",
      dayOfWeek: "الخميس",
      hourOfDay: 13,
    },
    {
      id: "request-legacy",
      propertyNumber: "15000",
      requestCode: "REQ-OLD",
      timestamp: "2026-07-09T08:00:00.000Z",
      ipAddress: "10.0.0.2",
      deviceType: "desktop",
      dayOfWeek: "الأربعاء",
      hourOfDay: 11,
    },
  ];

  const result = buildContactAnalytics({
    contactEvents,
    requests,
    properties: [
      { propertyNumber: "14006", name: "درة الجوهرة", city: "بريدة" },
      { propertyNumber: "15000", name: "منتجع الاختبار", city: "الرياض" },
    ],
    days: 7,
    now,
  });

  assert.equal(result.summary.totalAttempts, 3);
  assert.equal(result.summary.acceptedAttempts, 2);
  assert.equal(result.summary.uniqueUsers, 2);
  assert.equal(result.outcomes.cooldown, 1);
  assert.equal(result.topProperties[0].propertyNumber, "14006");
  assert.equal(result.topProperties[0].attempts, 2);
});
test("contact analytics applies the selected date range and never returns visitor keys", () => {
  const result = buildContactAnalytics({
    contactEvents: [],
    requests: [
      {
        id: "recent",
        propertyNumber: "14006",
        requestCode: "RECENT",
        timestamp: String(now - 2 * 24 * 60 * 60 * 1000),
        ipAddress: "10.0.0.3",
        deviceType: "tablet",
        dayOfWeek: "الثلاثاء",
        hourOfDay: 10,
      },
      {
        id: "old",
        propertyNumber: "14006",
        requestCode: "OLD",
        timestamp: String(now - 20 * 24 * 60 * 60 * 1000),
        ipAddress: "10.0.0.4",
        deviceType: "desktop",
        dayOfWeek: "الأحد",
        hourOfDay: 10,
      },
    ],
    properties: [{ propertyNumber: "14006", name: "درة الجوهرة" }],
    days: 7,
    now,
  });

  assert.equal(result.summary.totalAttempts, 1);
  assert.equal(result.devices.tablet, 1);
  assert.equal(result.daily.length, 7);
  assert.equal("visitorKey" in result.recentEvents[0], false);
  assert.equal(JSON.stringify(result).includes("10.0.0.3"), false);
});
