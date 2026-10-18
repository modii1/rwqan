/**
 * 📅 Smart Non-Spam Scheduler for Expired Subscriptions
 * 
 * Core Design Principles:
 * 1. Sends only 2 times per week (Sunday morning + Wednesday evening) to feel human.
 * 2. Staggers messages across time slots to avoid bulk sending patterns.
 * 3. Randomizes the order of recipients each week.
 * 4. Configurable via Firebase settings for admin dashboard control.
 */

import { storage } from "./storage";
import {
  notifySubscriptionExpired,
  notifyOwnerSubscriptionExpired,
} from "./integrations/whatsapp";
import { firebaseService } from "./firebaseService";
import { runAutoMatch } from "./autoMatchService";
import { isSubscriptionStatusSuspended } from "../shared/subscriptionType";
import { shouldStartScheduledBackgroundWork } from "./config/schedulerStartup";
import {
  type DistributedJobLease,
  DistributedScheduledJobLeaseLostError,
  runDistributedScheduledJob,
} from "./services/DistributedScheduledJob";


// ─── Configuration (mirrors Firebase settings shape) ─────────────────────────
interface SmartScheduleConfig {
  enabled: boolean;
  sendDays: string[];          // e.g. ["Sunday", "Wednesday"]
  sendTimes: { [day: string]: string }; // e.g. { Sunday: "09:00", Wednesday: "21:00" }
  batchSize: number;
  slotIntervalMinutes: number;
  dailyMaxRecipients: number;
}

const DEFAULT_CONFIG: SmartScheduleConfig = {
  enabled: true,
  sendDays: ["Sunday", "Wednesday"],
  sendTimes: {
    Sunday: "09:00",
    Wednesday: "21:00",
  },
  batchSize: 10,
  slotIntervalMinutes: 60,
  dailyMaxRecipients: 50,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRiyadhNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
}

function getDayNameEn(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Riyadh" });
}

function parseHHMM(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { hours: h, minutes: m };
}

function getNextTargetDate(config: SmartScheduleConfig): Date | null {
  if (!config.sendDays.length) return null;
  const now = getRiyadhNow();

  for (let i = 0; i < 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);

    const dayName = getDayNameEn(candidate);
    if (!config.sendDays.includes(dayName)) continue;

    const timeStr = config.sendTimes[dayName];
    if (!timeStr) continue;

    const { hours, minutes } = parseHHMM(timeStr);
    candidate.setHours(hours, minutes, 0, 0);

    // If today and time already passed, skip today
    if (i === 0 && candidate.getTime() <= now.getTime()) {
      continue;
    }
    return candidate;
  }
  return null;
}

function assertScheduledLeaseActive(lease?: DistributedJobLease): void {
  lease?.throwIfLeaseLost();
}

function delay(ms: number, lease?: DistributedJobLease): Promise<void> {
  assertScheduledLeaseActive(lease);
  if (!lease) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      lease.signal.removeEventListener("abort", onAbort);
      try {
        lease.throwIfLeaseLost();
      } catch (error) {
        reject(error);
        return;
      }
      reject(new DistributedScheduledJobLeaseLostError());
    };
    const timeout = setTimeout(() => {
      lease.signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    lease.signal.addEventListener("abort", onAbort, { once: true });
    if (lease.signal.aborted) onAbort();
  });
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Core: Rate-Limited Notification Engine ──────────────────────────────────

interface ExpiredSubscriptionEntry {
  propertyNumber: string;
  propertyName: string;
  ownerPhone: string;
  daysSinceExpiry: number;
}

/**
 * Sends notifications in staggered, randomised batches.
 * This is the heart of the "non-spam" feel.
 */
async function sendStaggeredNotifications(
  entries: ExpiredSubscriptionEntry[],
  config: SmartScheduleConfig,
  lease?: DistributedJobLease,
): Promise<number> {
  assertScheduledLeaseActive(lease);
  let sentToday = 0;
  const sentAlready = await getTodaysSentNotifications(lease);
  assertScheduledLeaseActive(lease);

  const shuffled = shuffleArray(entries);
  const batches: ExpiredSubscriptionEntry[][] = [];

  for (let i = 0; i < shuffled.length; i += config.batchSize) {
    batches.push(shuffled.slice(i, i + config.batchSize));
  }

  for (let b = 0; b < batches.length; b++) {
    assertScheduledLeaseActive(lease);
    const batch = batches[b];
    console.log(`✈️ [SmartScheduler] Sending batch ${b + 1}/${batches.length} (${batch.length} items)`);

    for (const entry of batch) {
      assertScheduledLeaseActive(lease);
      if (sentToday >= config.dailyMaxRecipients) {
        console.log(`   ⛔ [SmartScheduler] Daily max (${config.dailyMaxRecipients}) reached. Stopping.`);
        return sentToday;
      }
      if (sentAlready.has(entry.propertyNumber)) {
        continue;
      }

      try {
        assertScheduledLeaseActive(lease);
        await notifySubscriptionExpired({
          propertyNumber: entry.propertyNumber,
          propertyName: entry.propertyName,
          ownerPhone: entry.ownerPhone,
        });
        assertScheduledLeaseActive(lease);

          if (entry.ownerPhone) {
            assertScheduledLeaseActive(lease);
            await notifyOwnerSubscriptionExpired({
              ownerPhone: entry.ownerPhone,
              propertyNumber: entry.propertyNumber,
              propertyName: entry.propertyName,
            });
            assertScheduledLeaseActive(lease);
          }

        sentToday++;
        sentAlready.add(entry.propertyNumber);
      } catch (err) {
        assertScheduledLeaseActive(lease);
        console.error(`❌ [SmartScheduler] Failed for ${entry.propertyNumber}:`, err);
      }
    }

    // Only wait if there is another batch coming
    if (b < batches.length - 1) {
      const jitter = Math.floor(Math.random() * 15_000); // 0-15s extra randomness between batches
      const waitTime = config.slotIntervalMinutes * 60_000 + jitter;
      console.log(`   ⏳ [SmartScheduler] Waiting ${Math.round(waitTime / 1000)}s before next batch...`);
      await delay(waitTime, lease);
      assertScheduledLeaseActive(lease);
    }
  }

  return sentToday;
}

// ─── Firebase Settings Integration ─────────────────────────────────────────────

async function getSmartScheduleConfig(
  lease?: DistributedJobLease,
): Promise<SmartScheduleConfig> {
  try {
    assertScheduledLeaseActive(lease);
    const ns = await firebaseService.getNotificationSettings();
    assertScheduledLeaseActive(lease);
    if (ns.smartSchedule) {
      return { ...DEFAULT_CONFIG, ...ns.smartSchedule } as SmartScheduleConfig;
    }
  } catch (err) {
    assertScheduledLeaseActive(lease);
    console.warn("[SmartScheduler] Could not load smartSchedule from Firebase:", err);
  }
  return DEFAULT_CONFIG;
}

export async function updateSmartScheduleConfig(config: Partial<SmartScheduleConfig>) {
  const current = await getSmartScheduleConfig();
  const updated = { ...current, ...config };
  const ns = await firebaseService.getNotificationSettings();
  ns.smartSchedule = updated;
  ns.updatedAt = new Date().toISOString();
  await firebaseService.saveNotificationSettings(ns);
  console.log("🛠️ [SmartScheduler] Notification config updated:", updated);
}

// ─── Main: Collect Expired & Dispatch ─────────────────────────────────────────

/**
 * Scans subscriptions and dispatches notifications for the ones that are expired.
 * This is the entry-point called by the scheduler loop.
 */
export async function dispatchExpiredSubscriptionReminders(
  lease?: DistributedJobLease,
) {
  try {
    assertScheduledLeaseActive(lease);
    const config = await getSmartScheduleConfig(lease);
    assertScheduledLeaseActive(lease);
    if (!config.enabled) {
      console.log("⛔ [SmartScheduler] Notifications disabled.");
      return;
    }

    const subscriptions = await storage.getSubscriptions();
    assertScheduledLeaseActive(lease);
    const properties = await storage.getProperties();
    assertScheduledLeaseActive(lease);
    const today = getRiyadhNow();
    today.setHours(0, 0, 0, 0);

    const expiredEntries: ExpiredSubscriptionEntry[] = [];

    for (const sub of subscriptions) {
      assertScheduledLeaseActive(lease);
      if (isSubscriptionStatusSuspended(sub.status)) continue;
      if (!sub.endDate || !sub.propertyNumber) continue;
      const endDate = new Date(sub.endDate);
      endDate.setHours(0, 0, 0, 0);
      const diffTime = endDate.getTime() - today.getTime();
      const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (remainingDays < 0) {
        const daysSince = Math.abs(remainingDays);
        const property = properties.find((p) => p.propertyNumber === sub.propertyNumber);
        if (!property || (property as any)?.muteExpiryNotification) continue;

        expiredEntries.push({
          propertyNumber: sub.propertyNumber,
          propertyName: property.name || "",
          ownerPhone: property.whatsappNumber || "",
          daysSinceExpiry: daysSince,
        });
      }
    }

    if (expiredEntries.length === 0) {
      console.log("📭 [SmartScheduler] No expired subscriptions to notify today.");
      return;
    }

    console.log(`📬 [SmartScheduler] Found ${expiredEntries.length} expired subscriptions. Dispatching...`);
    await sendStaggeredNotifications(expiredEntries, config, lease);
    assertScheduledLeaseActive(lease);
    console.log("✅ [SmartScheduler] Dispatch cycle complete.");
  } catch (error) {
    assertScheduledLeaseActive(lease);
    console.error("❌ [SmartScheduler] Error dispatching reminders:", error);
    throw error;
  }
}

async function dispatchScheduledExpiredSubscriptionReminders(target: Date) {
  return runDistributedScheduledJob({
    jobName: "smart-expired-subscription-reminders",
    windowKey: target.toISOString(),
    now: getRiyadhNow(),
    leaseMs: 18 * 60 * 60 * 1_000,
    task: (lease) => dispatchExpiredSubscriptionReminders(lease),
  });
}

// ─── Existing Legacy Helpers (kept for compatibility) ────────────────────────

async function getTodaysSentNotifications(
  lease?: DistributedJobLease,
): Promise<Set<string>> {
  const sentToday = new Set<string>();
  try {
    assertScheduledLeaseActive(lease);
    const logs = await firebaseService.getWhatsAppLogs();
    assertScheduledLeaseActive(lease);
    const todayStr = new Date().toISOString().split("T")[0];
    for (const log of logs) {
      const propertyNumber = log.propertyNumber || "";
      const notificationType = log.type || "";
      const createdAt = log.createdAt || "";
      if (notificationType.includes("انتهاء") && createdAt.includes(todayStr)) {
        sentToday.add(propertyNumber);
      }
    }
  } catch (error) {
    assertScheduledLeaseActive(lease);
    console.error("❌ [SmartScheduler] Error reading logs:", error);
  }
  return sentToday;
}

// ─── Runner: The Smart Scheduler Loop (replaces old startScheduler) ──────────

let _nextTarget: Date | null = null;

async function tick() {
  try {
    const config = await getSmartScheduleConfig();
    if (!config.enabled) {
      console.log("⛔ [SmartScheduler] Notifications globally disabled.");
      scheduleNextTick();
      return;
    }

    const now = getRiyadhNow();
    const nextTarget = getNextTargetDate(config);

    if (!nextTarget) {
      console.warn("[SmartScheduler] Could not determine next target date.");
      scheduleNextTick();
      return;
    }

    _nextTarget = nextTarget;
    const diffMs = nextTarget.getTime() - now.getTime();

    // If we are within 30 minutes of the target dispatch time → run
    if (diffMs <= 30 * 60 * 1000 && diffMs > -30 * 60_000) {
      console.log(`🚀 [SmartScheduler] Triggering dispatch for ${nextTarget.toLocaleString()}`);
      await dispatchScheduledExpiredSubscriptionReminders(nextTarget);
    }

    scheduleNextTick();
  } catch (err) {
    console.error("❌ [SmartScheduler] Tick error:", err);
    scheduleNextTick();
  }
}

function scheduleNextTick() {
  const now = getRiyadhNow();
  const config = _nextTarget ? { ...DEFAULT_CONFIG } : DEFAULT_CONFIG;

  // Decide tick frequency based on proximity to next event
  const nextTarget = _nextTarget ?? getNextTargetDate(config);
  let intervalMs = 60 * 60 * 1000; // default 1 hour

  if (nextTarget) {
    const hoursAway = (nextTarget.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursAway <= 24 && hoursAway > 0) {
      intervalMs = 15 * 60 * 1000; // 15 min when within 24h
    }
  }

  console.log(`   ⏳ [SmartScheduler] Next check in ${Math.round(intervalMs / 1000 / 60)} min`);

  setTimeout(() => {
    tick().catch((err) => {
      console.error("❌ [SmartScheduler] Uncaught tick error:", err);
      scheduleNextTick();
    });
  }, intervalMs);
}

export function startSmartScheduler() {
  if (!shouldStartScheduledBackgroundWork()) return;

  console.log("🧠 [SmartScheduler] Initializing non-spam expired subscription scheduler...");

  // Check if we missed a dispatch today (e.g. server restarted after scheduled time)
  checkMissedDispatch().catch((err) =>
    console.error("❌ [SmartScheduler] Missed dispatch check failed:", err)
  );

  tick(); // Fire one tick immediately
}

/**
 * If today is a send day and the target time has passed but no notifications were sent,
 * run the dispatch now as a catch-up.
 */
async function checkMissedDispatch() {
  const config = await getSmartScheduleConfig();
  if (!config.enabled) return;

  const now = getRiyadhNow();
  const today = getDayNameEn(now);

  if (!config.sendDays.includes(today)) return;

  const timeStr = config.sendTimes[today];
  if (!timeStr) return;

  const { hours, minutes } = parseHHMM(timeStr);
  const targetToday = new Date(now);
  targetToday.setHours(hours, minutes, 0, 0);

  // Only catch up if target time already passed today (within last 12 hours)
  const msSinceTarget = now.getTime() - targetToday.getTime();
  if (msSinceTarget < 0 || msSinceTarget > 12 * 60 * 60 * 1000) return;

  // Check if anything was already sent today
  const alreadySent = await getTodaysSentNotifications();
  if (alreadySent.size > 0) return;

  console.log("🔄 [SmartScheduler] Missed dispatch detected for today, running catch-up...");
  await dispatchScheduledExpiredSubscriptionReminders(targetToday);
}

// ─── Legacy Remainder (kept for imports that still rely on old functions) ─────

export function updateRemainingDaysInSheet() {
  console.warn("[SmartScheduler] updateRemainingDaysInSheet is deprecated. Use startSmartScheduler.");
}

export async function expireOldPendingPayments() {
  console.warn("[SmartScheduler] expireOldPendingPayments is deprecated.");
  return 0;
}

export async function downgradeExpiredSubscriptions() {
  console.warn("[SmartScheduler] downgradeExpiredSubscriptions is deprecated.");
  return 0;
}
