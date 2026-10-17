import {
  CUSTOMER_FAVORITES_MAX,
  customerProfileUpdateSchema,
  customerPropertyNumberSchema,
  type CustomerAccount,
  type CustomerContactHistoryRow,
  type CustomerProfileDto,
  type CustomerProfileUpdate,
} from "../../shared/customer";
import type { Property, Request as ContactRequest } from "../../shared/schema";
import { normalizeSaudiMobilePhone } from "../../shared/phone";
import { hasActivePropertyHold } from "../../shared/propertyAvailability";
import { isSubscriptionStatusSuspended } from "../../shared/subscriptionType";
import { firebaseService } from "../firebaseService";
import { createCustomerSubject } from "../utils/customerSubject";
import { bookingCommissionStore } from "./BookingCommissionStore";
import {
  hasExplicitCustomerBookingResponse,
  toCustomerBookingPublicRow,
} from "./BookingCommissionService";
import type { BookingFollowUpDocument } from "./BookingCommissionTypes";
import { maskContactPhone } from "./ContactIdentityService";

export type CustomerAccountErrorCode =
  | "CUSTOMER_FAVORITES_LIMIT"
  | "PROPERTY_NOT_AVAILABLE"
  | "PROPERTY_NOT_FOUND";

export class CustomerAccountError extends Error {
  constructor(
    readonly code: CustomerAccountErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CustomerAccountError";
  }
}

export interface CustomerAccountStore {
  getCustomerAccount(id: string): Promise<CustomerAccount | null>;
  ensureCustomerAccount(
    account: CustomerAccount,
    touchLastLogin: boolean,
  ): Promise<CustomerAccount>;
  updateCustomerAccountProfile(
    id: string,
    updates: CustomerProfileUpdate & { updatedAt: string },
  ): Promise<CustomerAccount>;
  setCustomerFavorite(
    id: string,
    propertyNumber: string,
    selected: boolean,
    updatedAt: string,
  ): Promise<CustomerAccount>;
  getCustomerRequests(
    customerSubject: string,
  ): Promise<ContactRequest[]>;
  listCustomerBookingFollowUps(
    customerSubject: string,
  ): Promise<BookingFollowUpDocument[]>;
  getPropertyByNumber(
    propertyNumber: string,
  ): Promise<Pick<
    Property,
    | "propertyNumber"
    | "verificationStatus"
    | "commissionHold"
    | "adminAvailabilityHold"
    | "commissionHoldOverride"
  > | null>;
  getPropertySubscriptionStatus(propertyNumber: string): Promise<string | null>;
}

type CustomerAccountServiceOptions = {
  now?: () => Date;
};

function contactAt(value: unknown): string {
  const raw = String(value || "").trim();
  const numeric = Number(raw);
  const date = raw && Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : raw;
}

function contactOnlyRow(request: ContactRequest): CustomerContactHistoryRow {
  return {
    id: request.id,
    requestCode: request.requestCode,
    propertyNumber: request.propertyNumber,
    propertyName: null,
    listedPriceOptionsHalalas: [],
    contactAt: contactAt(request.timestamp),
    bookingStatus: "contact_only",
    questionnaire: null,
    answeredAt: null,
  };
}

function profileDto(account: CustomerAccount): CustomerProfileDto {
  return {
    fullName: account.fullName,
    email: account.email,
    maskedPhone: maskContactPhone(account.phone),
    favoritePropertyNumbers: [...account.favoritePropertyNumbers],
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastLoginAt: account.lastLoginAt,
  };
}

export class CustomerAccountService {
  private readonly now: () => Date;

  constructor(
    private readonly store: CustomerAccountStore,
    options: CustomerAccountServiceOptions = {},
  ) {
    this.now = options.now || (() => new Date());
  }

  subjectForPhone(value: unknown): { phone: string; customerSubject: string } {
    const phone = normalizeSaudiMobilePhone(value);
    if (!phone) throw new RangeError("Invalid customer phone");
    return { phone, customerSubject: createCustomerSubject(phone) };
  }

  async ensureForVerifiedPhone(
    value: unknown,
    options: { touchLastLogin?: boolean } = {},
  ): Promise<CustomerAccount> {
    const { phone, customerSubject } = this.subjectForPhone(value);
    const timestamp = this.currentTimestamp();
    return this.store.ensureCustomerAccount({
      id: customerSubject,
      schemaVersion: 1,
      phone,
      fullName: "",
      email: null,
      favoritePropertyNumbers: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginAt: timestamp,
    }, options.touchLastLogin === true);
  }

  async getProfile(value: unknown): Promise<CustomerProfileDto> {
    return profileDto(await this.ensureForVerifiedPhone(value));
  }

  async updateProfile(
    value: unknown,
    input: unknown,
  ): Promise<CustomerProfileDto> {
    const updates = customerProfileUpdateSchema.parse(input);
    const account = await this.ensureForVerifiedPhone(value);
    const updated = await this.store.updateCustomerAccountProfile(account.id, {
      ...updates,
      updatedAt: this.currentTimestamp(),
    });
    return profileDto(updated);
  }

  async getFavoritePropertyNumbers(value: unknown): Promise<string[]> {
    const account = await this.ensureForVerifiedPhone(value);
    return [...account.favoritePropertyNumbers];
  }

  async setFavorite(
    value: unknown,
    rawPropertyNumber: unknown,
    selected: boolean,
  ): Promise<string[]> {
    const propertyNumber = customerPropertyNumberSchema.parse(rawPropertyNumber);
    const account = await this.ensureForVerifiedPhone(value);

    if (selected && !account.favoritePropertyNumbers.includes(propertyNumber)) {
      if (account.favoritePropertyNumbers.length >= CUSTOMER_FAVORITES_MAX) {
        throw new CustomerAccountError(
          "CUSTOMER_FAVORITES_LIMIT",
          409,
          "تم الوصول إلى الحد الأقصى للمفضلة",
        );
      }
      const property = await this.store.getPropertyByNumber(propertyNumber);
      if (!property) {
        throw new CustomerAccountError(
          "PROPERTY_NOT_FOUND",
          404,
          "العقار غير موجود",
        );
      }
      const propertyIsHeld = hasActivePropertyHold(property);
      if (
        (property.verificationStatus && property.verificationStatus !== "approved") ||
        propertyIsHeld
      ) {
        throw new CustomerAccountError(
          "PROPERTY_NOT_AVAILABLE",
          propertyIsHeld ? 423 : 403,
          "هذا العقار غير متاح حالياً",
        );
      }
      const subscriptionStatus = await this.store.getPropertySubscriptionStatus(
        propertyNumber,
      );
      if (isSubscriptionStatusSuspended(subscriptionStatus)) {
        throw new CustomerAccountError(
          "PROPERTY_NOT_AVAILABLE",
          423,
          "هذا العقار غير متاح حالياً",
        );
      }
    }

    const updated = await this.store.setCustomerFavorite(
      account.id,
      propertyNumber,
      selected,
      this.currentTimestamp(),
    );
    return [...updated.favoritePropertyNumbers];
  }

  async getHistory(value: unknown): Promise<CustomerContactHistoryRow[]> {
    const account = await this.ensureForVerifiedPhone(value);
    const [requests, bookings] = await Promise.all([
      this.store.getCustomerRequests(account.id),
      this.store.listCustomerBookingFollowUps(account.id),
    ]);

    const bookingByRequestId = new Map(
      bookings.map((booking) => [booking.contactRequestId, booking]),
    );
    const usedBookingIds = new Set<string>();
    const history: CustomerContactHistoryRow[] = requests.map((request) => {
      const booking = bookingByRequestId.get(request.id);
      if (!booking) return contactOnlyRow(request);
      usedBookingIds.add(booking.id);
      return toCustomerBookingPublicRow(booking);
    });

    for (const booking of bookings) {
      if (
        !usedBookingIds.has(booking.id) &&
        hasExplicitCustomerBookingResponse(booking)
      ) {
        history.push(toCustomerBookingPublicRow(booking));
      }
    }

    return history.sort((left, right) => {
      const rightTime = Date.parse(right.contactAt);
      const leftTime = Date.parse(left.contactAt);
      return (Number.isFinite(rightTime) ? rightTime : 0)
        - (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }

  private currentTimestamp(): string {
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError("Customer account clock returned an invalid time");
    }
    return date.toISOString();
  }
}

const defaultCustomerAccountStore: CustomerAccountStore = {
  getCustomerAccount: (id) => firebaseService.getCustomerAccount(id),
  ensureCustomerAccount: (account, touchLastLogin) =>
    firebaseService.ensureCustomerAccount(account, touchLastLogin),
  updateCustomerAccountProfile: (id, updates) =>
    firebaseService.updateCustomerAccountProfile(id, updates),
  setCustomerFavorite: (id, propertyNumber, selected, updatedAt) =>
    firebaseService.setCustomerFavorite(id, propertyNumber, selected, updatedAt),
  getCustomerRequests: (customerSubject) =>
    firebaseService.getCustomerRequests(customerSubject),
  listCustomerBookingFollowUps: (customerSubject) =>
    bookingCommissionStore.listBookingsForCustomer(customerSubject),
  getPropertyByNumber: (propertyNumber) =>
    firebaseService.getPropertyByNumber(propertyNumber),
  getPropertySubscriptionStatus: async (propertyNumber) =>
    (await firebaseService.getSubscriptionByPropertyNumber(propertyNumber))?.status || null,
};

export const customerAccountService = new CustomerAccountService(
  defaultCustomerAccountStore,
);
