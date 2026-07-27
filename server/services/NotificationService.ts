/**
 * NotificationService
 * Central facade for all WhatsApp notifications.
 * Routes never need to import whatsapp.ts directly.
 */

import {
  sendWhatsAppNotification,
  sendPropertyOwnerWhatsApp,
  notifyNewSubscription,
  notifySubscriptionRenewal,
  notifyReceiptUpload,
  notifyPropertyUpdate,
  notifyNewProperty,
  notifySubscriptionExpired,
  notifyNewPayment,
  notifySmartRequest,
  notifyPropertyVerification,
  notifyOwnerSubscriptionActivated,
  notifyOwnerSubscriptionExpiringSoon,
  notifyOwnerSubscriptionExpired,
} from "../integrations/whatsapp";

export class NotificationService {
  /** Generic admin notification */
  async sendAdmin(text: string): Promise<void> {
    await sendWhatsAppNotification(text);
  }

  /** Property-aware owner message; administrative suspension is enforced. */
  async sendToOwner(
    propertyNumber: string,
    phone: string,
    message: string,
  ): Promise<{ success: boolean; error?: string; suppressed?: boolean }> {
    return sendPropertyOwnerWhatsApp({
      ownerPhone: phone,
      propertyNumber,
      message,
    });
  }

  async newSubscription(data: Parameters<typeof notifyNewSubscription>[0]) {
    return notifyNewSubscription(data);
  }

  async subscriptionRenewal(data: Parameters<typeof notifySubscriptionRenewal>[0]) {
    return notifySubscriptionRenewal(data);
  }

  async receiptUploaded(data: Parameters<typeof notifyReceiptUpload>[0]) {
    return notifyReceiptUpload(data);
  }

  async propertyUpdated(data: Parameters<typeof notifyPropertyUpdate>[0]) {
    return notifyPropertyUpdate(data);
  }

  async newProperty(data: Parameters<typeof notifyNewProperty>[0]) {
    return notifyNewProperty(data);
  }

  async subscriptionExpired(data: Parameters<typeof notifySubscriptionExpired>[0]) {
    return notifySubscriptionExpired(data);
  }

  async newPayment(data: Parameters<typeof notifyNewPayment>[0]) {
    return notifyNewPayment(data);
  }

  async smartRequest(data: Parameters<typeof notifySmartRequest>[0]) {
    return notifySmartRequest(data);
  }

  async propertyVerification(data: Parameters<typeof notifyPropertyVerification>[0]) {
    return notifyPropertyVerification(data);
  }

  async ownerSubscriptionActivated(data: Parameters<typeof notifyOwnerSubscriptionActivated>[0]) {
    return notifyOwnerSubscriptionActivated(data);
  }

  async ownerSubscriptionExpiringSoon(data: Parameters<typeof notifyOwnerSubscriptionExpiringSoon>[0]) {
    return notifyOwnerSubscriptionExpiringSoon(data);
  }

  async ownerSubscriptionExpired(data: Parameters<typeof notifyOwnerSubscriptionExpired>[0]) {
    return notifyOwnerSubscriptionExpired(data);
  }
}

export const notificationService = new NotificationService();
