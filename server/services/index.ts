/**
 * Services barrel export
 * Import from here instead of directly from service files.
 *
 * Usage:
 *   import { propertyService, paymentService } from "../services";
 */

export { propertyService } from "./PropertyService";
export { subscriptionService } from "./SubscriptionService";
export { paymentService } from "./PaymentService";
export { authService } from "./AuthService";
export { notificationService } from "./NotificationService";
export { discountService } from "./DiscountService";
export { analyticsService } from "./AnalyticsService";
export { addOnService } from "./AddOnService";
export { financeService } from "./FinanceService";
export { contentService } from "./ContentService";
export { occasionService } from "./OccasionService";

// Type re-exports for convenience
export type { DiscountApplicationResult } from "./DiscountService";
