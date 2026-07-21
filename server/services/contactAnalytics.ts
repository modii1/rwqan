import type { ContactEvent, Request as PropertyRequest } from "../../shared/schema";

type PropertySummary = {
  propertyNumber: string;
  name?: string | null;
  city?: string | null;
};

type NormalizedContactEvent = {
  id: string;
  propertyNumber: string;
  timestamp: string;
  timestampMs: number;
  clientPhone?: string;
  visitorKey: string;
  actorType: ContactEvent["actorType"] | "legacy";
  deviceType: ContactEvent["deviceType"];
  outcome: ContactEvent["outcome"];
  requestCode?: string;
};

function parseTimestamp(value?: string | null): number {
  const trimmed = String(value || "").trim();
  if (!trimmed) return Number.NaN;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return Date.parse(trimmed);
}
function toRiyadhDayKey(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeContactEvents(
  contactEvents: ContactEvent[],
  requests: PropertyRequest[],
): NormalizedContactEvent[] {
  const recordedRequestCodes = new Set(
    contactEvents
      .filter((event) => event.outcome === "accepted" && event.requestCode)
      .map((event) => event.requestCode as string),
  );

  const currentEvents = contactEvents.map((event) => ({
    ...event,
    timestampMs: parseTimestamp(event.timestamp),
  }));

  const legacyEvents: NormalizedContactEvent[] = requests
    .filter((request) => !recordedRequestCodes.has(request.requestCode))
    .map((request) => ({
      id: request.id,
      propertyNumber: request.propertyNumber,
      timestamp: request.timestamp,
      timestampMs: parseTimestamp(request.timestamp),
      clientPhone: request.clientPhone,
      visitorKey: `legacy:${request.ipAddress || request.id}`,
      actorType: "legacy",
      deviceType: request.deviceType || "desktop",
      outcome: "accepted",
      requestCode: request.requestCode,
    }));

  return [...currentEvents, ...legacyEvents]
    .filter((event) => Number.isFinite(event.timestampMs) && Boolean(event.propertyNumber))
    .sort((a, b) => b.timestampMs - a.timestampMs);
}

export function buildContactAnalytics({
  contactEvents,
  requests,
  properties,
  days,
  now = Date.now(),
}: {
  contactEvents: ContactEvent[];
  requests: PropertyRequest[];
  properties: PropertySummary[];
  days: number | null;
  now?: number;
}) {
  const allEvents = normalizeContactEvents(contactEvents, requests);
  const cutoff = days === null ? Number.NEGATIVE_INFINITY : now - days * 24 * 60 * 60 * 1000;
  const events = allEvents.filter((event) => event.timestampMs >= cutoff && event.timestampMs <= now);
  const acceptedEvents = events.filter((event) => event.outcome === "accepted");
  const propertyLookup = new Map(properties.map((property) => [property.propertyNumber, property]));

  const outcomes = {
    accepted: 0,
    cooldown: 0,
    authRequired: 0,
    error: 0,
  };
  const devices = { mobile: 0, desktop: 0, tablet: 0 };

  for (const event of events) {
    if (event.outcome === "auth_required") outcomes.authRequired += 1;
    else outcomes[event.outcome] += 1;
    devices[event.deviceType] += 1;
  }

  const propertyStats = new Map<string, {
    attempts: number;
    accepted: number;
    visitors: Set<string>;
    lastContactAt: string;
    lastContactMs: number;
  }>();

  for (const event of events) {
    const current = propertyStats.get(event.propertyNumber) || {
      attempts: 0,
      accepted: 0,
      visitors: new Set<string>(),
      lastContactAt: event.timestamp,
      lastContactMs: event.timestampMs,
    };
    current.attempts += 1;
    if (event.outcome === "accepted") current.accepted += 1;
    current.visitors.add(event.visitorKey);
    if (event.timestampMs > current.lastContactMs) {
      current.lastContactAt = event.timestamp;
      current.lastContactMs = event.timestampMs;
    }
    propertyStats.set(event.propertyNumber, current);
  }

  const topProperties = Array.from(propertyStats.entries())
    .map(([propertyNumber, stats]) => {
      const property = propertyLookup.get(propertyNumber);
      return {
        propertyNumber,
        propertyName: property?.name || `عقار ${propertyNumber}`,
        city: property?.city || "غير محدد",
        attempts: stats.attempts,
        accepted: stats.accepted,
        uniqueUsers: stats.visitors.size,
        lastContactAt: stats.lastContactAt,
      };
    })
    .sort((a, b) => b.accepted - a.accepted || b.attempts - a.attempts)
    .slice(0, 50);

  const trendDays = days === null ? 30 : Math.min(days, 90);
  const dailyMap = new Map<string, { date: string; attempts: number; accepted: number }>();
  for (let offset = trendDays - 1; offset >= 0; offset -= 1) {
    const date = now - offset * 24 * 60 * 60 * 1000;
    const key = toRiyadhDayKey(date);
    dailyMap.set(key, { date: key, attempts: 0, accepted: 0 });
  }
  for (const event of events) {
    const key = toRiyadhDayKey(event.timestampMs);
    const day = dailyMap.get(key);
    if (!day) continue;
    day.attempts += 1;
    if (event.outcome === "accepted") day.accepted += 1;
  }

  const recentEvents = events.slice(0, 50).map((event) => {
    const property = propertyLookup.get(event.propertyNumber);
    return {
      id: event.id,
      propertyNumber: event.propertyNumber,
      propertyName: property?.name || `عقار ${event.propertyNumber}`,
      timestamp: event.timestamp,
      clientPhone: event.clientPhone || null,
      deviceType: event.deviceType,
      outcome: event.outcome,
      requestCode: event.requestCode || null,
      actorType: event.actorType,
    };
  });

  const uniqueUsers = new Set(events.map((event) => event.visitorKey)).size;
  const uniqueAcceptedUsers = new Set(acceptedEvents.map((event) => event.visitorKey)).size;

  return {
    rangeDays: days,
    generatedAt: new Date(now).toISOString(),
    summary: {
      totalAttempts: events.length,
      acceptedAttempts: acceptedEvents.length,
      uniqueUsers,
      uniqueAcceptedUsers,
      contactedProperties: new Set(acceptedEvents.map((event) => event.propertyNumber)).size,
      blockedAttempts: outcomes.cooldown + outcomes.authRequired,
      successRate: events.length ? Math.round((acceptedEvents.length / events.length) * 100) : 0,
    },
    outcomes,
    devices,
    daily: Array.from(dailyMap.values()),
    topProperties,
    recentEvents,
  };
}
