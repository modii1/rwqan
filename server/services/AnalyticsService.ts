/**
 * AnalyticsService
 * Request tracking, page-view aggregation, and analytics retrieval.
 */

import { firebaseService } from "../firebaseService";
import type { Request as PropertyRequest, InsertRequest } from "../../shared/schema";

export class AnalyticsService {
  // ─── Request Recording ──────────────────────────────────────────────────────

  async recordRequest(data: InsertRequest, requestCountFromIP?: number): Promise<PropertyRequest> {
    return firebaseService.createRequest(data, requestCountFromIP);
  }

  async getAllRequests(): Promise<PropertyRequest[]> {
    return firebaseService.getRequests();
  }

  // ─── Analytics Summary ──────────────────────────────────────────────────────

  async getAnalytics() {
    return firebaseService.getAnalytics();
  }

  /**
   * Returns per-property request counts, sorted by number of requests desc.
   */
  async getTopProperties(limit = 10) {
    const requests = await firebaseService.getRequests();

    const countMap = new Map<string, number>();
    for (const r of requests) {
      countMap.set(r.propertyNumber, (countMap.get(r.propertyNumber) ?? 0) + 1);
    }

    return Array.from(countMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([propertyNumber, count]) => ({ propertyNumber, count }));
  }

  /**
   * Returns device distribution as percentages.
   */
  async getDeviceDistribution() {
    const requests = await firebaseService.getRequests();
    const total = requests.length;
    if (total === 0) return { mobile: 0, desktop: 0, tablet: 0 };

    const counts = requests.reduce(
      (acc, r) => {
        const dt = r.deviceType ?? "desktop";
        (acc as any)[dt] = ((acc as any)[dt] ?? 0) + 1;
        return acc;
      },
      { mobile: 0, desktop: 0, tablet: 0 }
    );

    return {
      mobile: Math.round((counts.mobile / total) * 100),
      desktop: Math.round((counts.desktop / total) * 100),
      tablet: Math.round((counts.tablet / total) * 100),
    };
  }

  // ─── WhatsApp Logs ──────────────────────────────────────────────────────────

  async getWhatsAppLogs() {
    return firebaseService.getWhatsAppLogs();
  }

  async addWhatsAppLog(log: any): Promise<void> {
    return firebaseService.addWhatsAppLog(log);
  }

  // ─── Verification Logs ──────────────────────────────────────────────────────

  async getVerificationLogs() {
    return firebaseService.getVerificationLogs();
  }

  async addVerificationLog(log: any): Promise<void> {
    return firebaseService.addVerificationLog(log);
  }
}

export const analyticsService = new AnalyticsService();
