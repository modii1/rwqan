import type { Property, Request as PropertyRequest } from "../../shared/schema";

type CalendarParts = {
  year: number;
  month: number;
  day: number;
};

export type OwnerRequestAnalytics = {
  totalRequests: number;
  monthlyRequests: number;
  previousMonthRequests: number;
  previousMonthGrowth: number;
  dailyAverage: number;
  highestDemandDay: string;
  rank: number;
  totalProperties: number;
};

const riyadhCalendar = new Intl.DateTimeFormat("en-US-u-nu-latn", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function getRiyadhCalendarParts(value: Date | string): CalendarParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = Object.fromEntries(
    riyadhCalendar
      .formatToParts(date)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, Number(part.value)]),
  );

  if (!parts.year || !parts.month || !parts.day) return null;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };
}

function previousCalendarMonth(current: CalendarParts): Pick<CalendarParts, "year" | "month"> {
  if (current.month === 1) {
    return { year: current.year - 1, month: 12 };
  }
  return { year: current.year, month: current.month - 1 };
}

function calculateGrowth(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

export function calculateOwnerRequestAnalytics(input: {
  propertyNumber: string;
  requests: PropertyRequest[];
  properties: Pick<Property, "propertyNumber">[];
  now?: Date;
}): OwnerRequestAnalytics {
  const currentCalendar = getRiyadhCalendarParts(input.now || new Date());
  if (!currentCalendar) {
    throw new RangeError("Invalid analytics reference date");
  }
  const previousMonth = previousCalendarMonth(currentCalendar);
  const propertyRequests = input.requests.filter(
    (request) => request.propertyNumber === input.propertyNumber,
  );

  const currentMonthRequests: PropertyRequest[] = [];
  let previousMonthRequests = 0;
  for (const request of propertyRequests) {
    const requestCalendar = getRiyadhCalendarParts(request.timestamp);
    if (!requestCalendar) continue;
    if (
      requestCalendar.year === currentCalendar.year &&
      requestCalendar.month === currentCalendar.month
    ) {
      currentMonthRequests.push(request);
    } else if (
      requestCalendar.year === previousMonth.year &&
      requestCalendar.month === previousMonth.month
    ) {
      previousMonthRequests += 1;
    }
  }

  const demandByDay = new Map<string, number>();
  for (const request of currentMonthRequests) {
    const day = String(request.dayOfWeek || "").trim();
    if (!day) continue;
    demandByDay.set(day, (demandByDay.get(day) || 0) + 1);
  }
  const highestDemandDay = [...demandByDay.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ar"))[0]?.[0]
    || "لا يوجد بيانات";

  const knownPropertyNumbers = new Set(
    input.properties
      .map((property) => String(property.propertyNumber || "").trim())
      .filter(Boolean),
  );
  knownPropertyNumbers.add(input.propertyNumber);
  for (const request of input.requests) {
    const propertyNumber = String(request.propertyNumber || "").trim();
    if (propertyNumber) knownPropertyNumbers.add(propertyNumber);
  }

  const requestCountByProperty = new Map<string, number>();
  for (const request of input.requests) {
    if (!knownPropertyNumbers.has(request.propertyNumber)) continue;
    requestCountByProperty.set(
      request.propertyNumber,
      (requestCountByProperty.get(request.propertyNumber) || 0) + 1,
    );
  }
  const ownerRequestCount = requestCountByProperty.get(input.propertyNumber) || 0;
  const rank = 1 + [...knownPropertyNumbers].filter(
    (propertyNumber) => (requestCountByProperty.get(propertyNumber) || 0) > ownerRequestCount,
  ).length;

  return {
    totalRequests: propertyRequests.length,
    monthlyRequests: currentMonthRequests.length,
    previousMonthRequests,
    previousMonthGrowth: calculateGrowth(
      currentMonthRequests.length,
      previousMonthRequests,
    ),
    dailyAverage: Number(
      (currentMonthRequests.length / Math.max(1, currentCalendar.day)).toFixed(1),
    ),
    highestDemandDay,
    rank,
    totalProperties: knownPropertyNumbers.size,
  };
}
