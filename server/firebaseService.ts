import { db } from "./config/firebase";
import type {
    Property,
    InsertProperty,
    Subscription,
    InsertSubscription,
    Package,
    InsertPackage,
    DiscountCode,
    InsertDiscountCode,
    Payment,
    InsertPayment,
    Suggestion,
    InsertSuggestion,
    Request,
    InsertRequest,
    ContactEvent,
    InsertContactEvent,
    ContactIdentitySession,
    Expense,
    InsertExpense,
    FeeConfig,
    InsertFeeConfig,
    PartnerProfit,
    InsertPartnerProfit,
    MultiPropertySubscription,
    InsertMultiPropertySubscription,
    NotificationSettings,
    AddOnPackage,
    InsertAddOnPackage,
    PropertyAddOn,
    InsertPropertyAddOn,
    AddOnHistory,
    InsertAddOnHistory,
    BankAccount,
    InsertBankAccount,
    FeatureFlag,
    InsertFeatureFlag,
    OcrResult,
    InsertOcrResult,
} from "../shared/schema";
import {
    MAX_SUBSCRIPTION_DAYS,
    calculateRemainingDays,
    capAtMaxDays,
    capSubscriptionDurationMs,
    getEndOfMonthRiyadh,
    getNowInRiyadh,
    getStartOfMonthRiyadh,
    parseArabicDate,
    toRiyadhISO,
} from "./utils/dateUtils";
import {
    isActivePremiumSubscription,
    isPremiumSubscriptionType,
    isSubscriptionStatusActive,
    isSubscriptionStatusSuspended,
} from "../shared/subscriptionType";
import { selectCurrentSubscriptionForProperty } from "./utils/subscriptionSelection";
import {
    isPurchasableSubscriptionPackage,
    isSubscriptionPackageDurationAllowed,
    normalizeSubscriptionPackageDuration,
} from "../shared/subscriptionPackagePolicy";
import { getExactPaymobPaymentMethod } from "./utils/paymobPaymentMethod";

type PaymentFulfillmentClaimResult =
    | { status: "claimed"; token: string; previousState?: Payment["fulfillmentState"] }
    | { status: "fulfilled" }
    | { status: "processing" }
    | { status: "action_conflict"; conflictingPaymentId?: string }
    | { status: "action_ineligible"; action: "new" | "extend" | "upgrade" };

type GuardedPaymentFulfillmentClaimResult =
    | PaymentFulfillmentClaimResult
    | { status: "invalid_status"; currentStatus: string };

type QueuePaymentFulfillmentClaimResult =
    | GuardedPaymentFulfillmentClaimResult
    | { status: "queued" };

type PaymentFulfillmentClaimOptions = {
    purpose?: "fulfill" | "queue" | "reject";
};

export type AdminPropertyAddOnDecisionMode =
    | "settled_paymob"
    | "bank_transfer"
    | "legacy_without_payment";

export type AdminPropertyAddOnDecisionResult =
    | { status: "applied" | "already_applied"; addon: PropertyAddOn }
    | {
        status: "rejected";
        reason:
            | "not_found"
            | "payment_not_found"
            | "link_conflict"
            | "not_pending"
            | "unsafe_provider_state"
            | "unsafe_bank_state"
            | "unsafe_legacy_state";
    };

export class PaymentActionConflictError extends Error {
    readonly status = 409;
    readonly code = "PAYMENT_ACTION_IN_PROGRESS";

    constructor() {
        super("توجد معالجة أخرى قيد التنفيذ لنفس الدفعة. انتظر قليلاً ثم حاول مرة أخرى.");
        this.name = "PaymentActionConflictError";
    }
}

export class PaymentActionEligibilityError extends Error {
    readonly status = 409;
    readonly code = "PAYMENT_ACTION_NO_LONGER_ELIGIBLE";

    constructor(action: "new" | "extend" | "upgrade") {
        const message = action === "new"
            ? "لم يعد بدء اشتراك جديد متاحاً لأن للعقار اشتراكاً نشطاً. اختر تغيير الباقة أو انتظر نافذة التمديد."
            : action === "extend"
                ? "لم يعد التمديد متاحاً بحالة الاشتراك الحالية. يمكن التمديد فقط عندما يتبقى 10 أيام أو أقل من اشتراك نشط."
                : "لم يعد تغيير الباقة متاحاً لأن الاشتراك الحالي غير نشط. اختر اشتراكاً جديداً بدلاً من ذلك.";
        super(message);
        this.name = "PaymentActionEligibilityError";
    }
}

export class PaymentRetryNotAllowedError extends Error {
    readonly status = 409;
    readonly code = "PAYMENT_RETRY_NOT_ALLOWED";

    constructor() {
        super("لا يمكن إنشاء عملية دفع بديلة لهذه الدفعة. توجد عملية سابقة أو أن نتيجتها تحتاج التحقق من مزود الدفع.");
        this.name = "PaymentRetryNotAllowedError";
    }
}

export class SuspendedSubscriptionWriteError extends Error {
    readonly status = 423;
    readonly code = "PROPERTY_SUSPENDED";

    constructor(propertyNumber: string) {
        super(
            `اشتراك العقار ${propertyNumber} موقوف مؤقتاً من الإدارة. يجب استئنافه قبل أي تفعيل أو مزامنة.`,
        );
        this.name = "SuspendedSubscriptionWriteError";
    }
}

export class LinkedPropertyMutationError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = "LinkedPropertyMutationError";
    }
}

type LinkedPropertyGroupMutationParams = {
    mainPropertyNumber: string;
    addPropertyNumbers?: string[];
    removePropertyNumbers?: string[];
    replacePropertyNumbers?: string[];
    approveAddedProperties?: boolean;
    cancelRemovedSubscriptions?: boolean;
};

type LinkedPropertyGroupMutationResult = {
    mainPropertyNumber: string;
    linkedProperties: string[];
    addedProperties: string[];
    removedProperties: string[];
    mainSubscription: Subscription;
};

type LinkedPropertyFieldSnapshot = {
    exists: boolean;
    value?: unknown;
};

type LinkedPropertyRestoreState = {
    mainPropertyNumber: string;
    capturedAt: string;
    subscriptionDocumentId: string;
    subscriptionExisted: boolean;
    subscription: Record<string, LinkedPropertyFieldSnapshot>;
    property: Record<string, LinkedPropertyFieldSnapshot>;
};

const LINKED_SUBSCRIPTION_MIRROR_FIELDS = [
    "packageId",
    "subscriptionType",
    "packageType",
    "startDate",
    "endDate",
    "status",
    "paymentId",
    "linkedProperty",
    "linkedProperties",
    "propertyCount",
    "cancelledAt",
    "cancelReason",
    "suspendedAt",
    "remainingDurationMs",
    "createdAt",
    "updatedAt",
] as const;

const LINKED_PROPERTY_MIRROR_FIELDS = [
    "subscriptionType",
    "subscriptionDate",
    "lastUpdate",
    "verificationStatus",
    "updatedAt",
] as const;

function captureLinkedPropertyFields(
    source: Record<string, unknown> | undefined,
    fields: readonly string[],
): Record<string, LinkedPropertyFieldSnapshot> {
    return Object.fromEntries(fields.map((field) => [
        field,
        Object.prototype.hasOwnProperty.call(source || {}, field)
            ? { exists: true, value: source?.[field] }
            : { exists: false },
    ]));
}

function restoreLinkedPropertyFields(
    current: Record<string, unknown>,
    snapshot: Record<string, LinkedPropertyFieldSnapshot>,
): Record<string, unknown> {
    const restored = { ...current };
    for (const [field, state] of Object.entries(snapshot || {})) {
        if (state?.exists) {
            restored[field] = state.value;
        } else {
            delete restored[field];
        }
    }
    return restored;
}

export class FirebaseService {
    private get db() {
        if (!db) throw new Error("Firebase not initialized");
        return db;
    }

    private getDateMillis(value: any): number {
        if (!value) return 0;
        if (typeof value === "number") return value;
        if (value instanceof Date) return value.getTime();
        if (typeof value === "string") {
            const parsed = new Date(value).getTime();
            return Number.isNaN(parsed) ? 0 : parsed;
        }
        if (typeof value.toMillis === "function") return value.toMillis();
        if (typeof value.seconds === "number") {
            return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
        }
        if (typeof value._seconds === "number") {
            return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1_000_000);
        }
        return 0;
    }

    private getCurrentSubscriptionDocument<
        T extends { id: string; data(): FirebaseFirestore.DocumentData | undefined },
    >(documents: T[], propertyNumber: string): T | undefined {
        const canonicalId = `SUB-${propertyNumber}`;
        return documents.find((document) => document.id === canonicalId) ||
            [...documents].sort((left, right) => {
                const leftData = left.data();
                const rightData = right.data();
                return this.getDateMillis(
                    rightData?.updatedAt || rightData?.endDate,
                ) - this.getDateMillis(
                    leftData?.updatedAt || leftData?.endDate,
                );
            })[0];
    }

    private assertCurrentSubscriptionNotSuspended<
        T extends { id: string; data(): FirebaseFirestore.DocumentData | undefined },
    >(documents: T[], propertyNumber: string): void {
        const current = this.getCurrentSubscriptionDocument(
            documents,
            propertyNumber,
        );
        if (current && isSubscriptionStatusSuspended(current.data()?.status)) {
            throw new SuspendedSubscriptionWriteError(propertyNumber);
        }
    }

    private isActionableSubscriptionPayment(
        payment: Pick<Payment, "action">,
    ): boolean {
        return payment.action !== "addon";
    }

    private getSubscriptionPaymentAction(
        payment: Pick<Payment, "action">,
    ): "new" | "extend" | "upgrade" {
        return payment.action === "extend" || payment.action === "upgrade"
            ? payment.action
            : "new";
    }

    private isPaymentEligibleForNewIntention(payment: Payment): boolean {
        const retryableStatuses = new Set([
            "فشل",
            "منتهي الصلاحية",
            "ملغي",
            "ملغي - انتهت المهلة",
            "failed",
            "expired",
            "cancelled",
            "canceled",
        ]);
        const status = String(payment.status || "").trim().toLowerCase();
        return (
            retryableStatuses.has(status) &&
            !payment.transactionId &&
            !payment.paymentReference &&
            (payment.intentionState === undefined || payment.intentionState === "failed")
        );
    }

    private isActionablePaymentAllowedForSubscription(
        action: "new" | "extend" | "upgrade",
        subscription?: Subscription | null,
    ): boolean {
        if (isSubscriptionStatusSuspended(subscription?.status)) return false;

        const remainingDays = calculateRemainingDays(subscription?.endDate || null);
        const isActive = Boolean(
            subscription?.endDate &&
            isSubscriptionStatusActive(subscription.status) &&
            remainingDays >= 0,
        );
        if (action === "new") return !isActive;
        if (!isActive) return false;
        return action !== "extend" || remainingDays <= 10;
    }

    private hasNonEmptyPropertyList(value: unknown): boolean {
        return this.parsePropertyNumberList(value).length > 0;
    }

    private parsePropertyNumberList(value: unknown): string[] {
        if (Array.isArray(value)) {
            return value
                .flatMap((item) => this.parsePropertyNumberList(item))
                .filter(Boolean);
        }
        if (typeof value !== "string") {
            return value ? [String(value).trim()].filter(Boolean) : [];
        }
        const trimmed = value.trim();
        if (!trimmed || trimmed === "[]") return [];
        try {
            return this.parsePropertyNumberList(JSON.parse(trimmed));
        } catch {
            return [trimmed];
        }
    }

    private selectLatestSubscription(documents: Array<{
        id: string;
        data(): FirebaseFirestore.DocumentData;
    }>): Subscription | null {
        const subscriptions = documents.map((document) => ({
            ...document.data(),
            id: document.data().id || document.id,
        } as Subscription));
        subscriptions.sort((left, right) =>
            this.getDateMillis(right.endDate) - this.getDateMillis(left.endDate),
        );
        return subscriptions[0] || null;
    }

    /**
     * Final persistence guard for every subscription-like write. Route and
     * service validation provide useful errors, while this guard protects
     * Firestore from legacy callers, webhook races, and direct service calls.
     */
    private enforceSubscriptionDurationLimit<T extends Record<string, any>>(
        value: T,
        referenceDate: Date = new Date(),
    ): T {
        const normalized = { ...value } as Record<string, any>;

        if (
            Object.prototype.hasOwnProperty.call(value, "endDate") &&
            value.endDate !== undefined &&
            value.endDate !== null &&
            String(value.endDate).trim() !== ""
        ) {
            const endDateMillis = this.getDateMillis(value.endDate);
            if (!Number.isFinite(endDateMillis) || endDateMillis <= 0) {
                throw new RangeError("Invalid subscription end date");
            }
            const parsedEndDate = new Date(endDateMillis);
            normalized.endDate = capAtMaxDays(
                parsedEndDate,
                MAX_SUBSCRIPTION_DAYS,
                referenceDate,
            ).toISOString();
        }

        if (
            Object.prototype.hasOwnProperty.call(value, "remainingDurationMs") &&
            value.remainingDurationMs !== undefined &&
            value.remainingDurationMs !== null
        ) {
            normalized.remainingDurationMs = capSubscriptionDurationMs(
                Number(value.remainingDurationMs),
            );
        }

        return normalized as T;
    }

    // ================== العقارات (Properties) ==================

    /**
     * Normalise a raw Firestore document into a Property with facilities as a
     * proper string[].  The admin form historically stored facilities as a
     * JSON-stringified array (e.g. '["مسبح","ملعب"]') or a comma-separated
     * string.  This helper ensures downstream code always gets string[].
     */
    private normaliseProperty(raw: FirebaseFirestore.DocumentData): Property {
        // Internal rollback metadata must never leak through property APIs.
        const { linkedPropertyRestoreState: _restoreState, ...publicProperty } = raw;
        const p = publicProperty as Property;
        if (p.facilities) {
            if (typeof p.facilities === 'string') {
                const trimmed = (p.facilities as string).trim();
                if (trimmed.startsWith('[')) {
                    try { p.facilities = JSON.parse(trimmed); } catch { p.facilities = []; }
                } else {
                    p.facilities = trimmed.split(',').map(s => s.trim()).filter(Boolean);
                }
            }
            if (!Array.isArray(p.facilities)) {
                p.facilities = [];
            }
        } else {
            p.facilities = [];
        }
        return p;
    }

    async getProperties(): Promise<Property[]> {
        const snapshot = await this.db.collection("properties").get();
        return snapshot.docs.map((doc) => this.normaliseProperty(doc.data()));
    }

    async getPropertyByNumber(propertyNumber: string): Promise<Property | null> {
        const doc = await this.db.collection("properties").doc(propertyNumber).get();
        return doc.exists ? this.normaliseProperty(doc.data()!) : null;
    }

    async createProperty(property: InsertProperty): Promise<Property> {
        const now = new Date().toISOString();
        const newProperty: Property = {
            verificationStatus: "pending", // Default for new properties - requires admin approval
            ...property,
            createdAt: now,
            updatedAt: now,
        } as Property;

        if (property.verificationStatus) {
            newProperty.verificationStatus = property.verificationStatus;
        }

        await this.db.collection("properties").doc(property.propertyNumber).set(newProperty);
        return newProperty;
    }

    async updateProperty(
        propertyNumber: string,
        updates: Partial<Property>,
    ): Promise<Property> {
        const ref = this.db.collection("properties").doc(propertyNumber);
        const now = new Date().toISOString();

        const updatedData = {
            ...updates,
            updatedAt: now,
        };

        const guardedVerificationWrite =
            updates.verificationStatus === "pending" ||
            updates.verificationStatus === "approved" ||
            updates.verificationStatus === "verified";

        if (guardedVerificationWrite) {
            await this.db.runTransaction(async (transaction) => {
                const subscriptionSnapshot = await transaction.get(
                    this.db
                        .collection("subscriptions")
                        .where("propertyNumber", "==", propertyNumber),
                );
                const propertySnapshot = await transaction.get(ref);
                this.assertCurrentSubscriptionNotSuspended(
                    subscriptionSnapshot.docs,
                    propertyNumber,
                );
                if (!propertySnapshot.exists) {
                    throw new Error(`Property not found: ${propertyNumber}`);
                }
                transaction.update(ref, updatedData);
            });
        } else {
            await ref.update(updatedData);
        }
        const doc = await ref.get();
        return doc.data() as Property;
    }

    async updateVerificationStatus(
        propertyNumber: string,
        newStatus: "pending" | "approved" | "rejected" | "incomplete" | "verified"
    ): Promise<Property> {
        return this.updateProperty(propertyNumber, { verificationStatus: newStatus });
    }

    async updateMuteExpiryNotification(
        propertyNumber: string,
        muted: boolean
    ): Promise<Property> {
        return this.updateProperty(propertyNumber, { muteExpiryNotification: muted });
    }

    async deleteProperty(propertyNumber: string): Promise<void> {
        await this.db.collection("properties").doc(propertyNumber).delete();
    }

    // ================== الاشتراكات (Subscriptions) ==================

    async getSubscriptions(): Promise<Subscription[]> {
        const snapshot = await this.db.collection("subscriptions").get();
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return { ...data, id: data.id || doc.id } as Subscription;
        });
    }

    async getSubscriptionByPropertyNumber(propertyNumber: string): Promise<Subscription | null> {
        console.log(`[FIREBASE] getSubscriptionByPropertyNumber called for: ${propertyNumber}`);
        const snapshot = await this.db
            .collection("subscriptions")
            .where("propertyNumber", "==", propertyNumber)
            .get();

        console.log(`[FIREBASE] getSubscriptionByPropertyNumber - found ${snapshot.size} docs for: ${propertyNumber}`);
        
        if (snapshot.empty) {
            console.log(`[FIREBASE] No subscription found for: ${propertyNumber}`);
            return null;
        }

        // Select in JS to avoid an index requirement and to handle duplicate
        // legacy documents consistently with lifecycle/admin reads.
        const docs = snapshot.docs.map((doc) =>
            ({ ...doc.data(), id: doc.data().id || doc.id } as Subscription)
        );
        const selected = selectCurrentSubscriptionForProperty(
            docs,
            propertyNumber,
        ) || null;

        console.log(`[FIREBASE] Subscription found for ${propertyNumber}:`, selected);
        return selected;
    }

    async getSubscriptionsLinkedToProperty(
        mainPropertyNumber: string,
    ): Promise<Subscription[]> {
        const snapshot = await this.db
            .collection("subscriptions")
            .where("linkedProperty", "==", mainPropertyNumber)
            .get();
        const propertyNumbers = new Set(
            snapshot.docs
                .map((document) => String(document.data()?.propertyNumber || "").trim())
                .filter(Boolean),
        );
        const subscriptions: Subscription[] = [];
        for (const propertyNumber of propertyNumbers) {
            const current = await this.getSubscriptionByPropertyNumber(propertyNumber);
            if (current?.linkedProperty === mainPropertyNumber) {
                subscriptions.push(current);
            }
        }
        return subscriptions;
    }

    async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
        const id = `SUB-${subscription.propertyNumber}`;
        const normalizedSubscription = this.enforceSubscriptionDurationLimit(subscription);
        const newSubscription: Subscription = {
            id,
            ...normalizedSubscription,
        } as Subscription;

        const subscriptionRef = this.db.collection("subscriptions").doc(id);
        const propertyRef = this.db
            .collection("properties")
            .doc(subscription.propertyNumber);
        const planType = subscription.subscriptionType || subscription.packageType ||
            (subscription.packageId?.includes("premium") || subscription.packageId === "pkg-trusted"
                ? "مميز"
                : "عادي");
        const hasValidEndDate = calculateRemainingDays(normalizedSubscription.endDate) >= 0;
        const isPremium = hasValidEndDate &&
            isPremiumSubscriptionType(planType) &&
            isSubscriptionStatusActive(normalizedSubscription.status);
        const propertyUpdates: Record<string, unknown> = {
            subscriptionType: isPremium ? "مميز" : "عادي",
            lastUpdate: toRiyadhISO(getNowInRiyadh()).split("T")[0],
            subscriptionDate: normalizedSubscription.startDate.split("T")[0],
            updatedAt: new Date().toISOString(),
        };

        await this.db.runTransaction(async (transaction) => {
            const existingSnapshot = await transaction.get(
                this.db
                    .collection("subscriptions")
                    .where("propertyNumber", "==", subscription.propertyNumber),
            );
            const parentSnapshot = subscription.linkedProperty
                ? await transaction.get(
                    this.db
                        .collection("subscriptions")
                        .where(
                            "propertyNumber",
                            "==",
                            subscription.linkedProperty,
                        ),
                )
                : null;
            const propertySnapshot = await transaction.get(propertyRef);
            this.assertCurrentSubscriptionNotSuspended(
                existingSnapshot.docs,
                subscription.propertyNumber,
            );
            if (parentSnapshot && subscription.linkedProperty) {
                this.assertCurrentSubscriptionNotSuspended(
                    parentSnapshot.docs,
                    subscription.linkedProperty,
                );
            }
            if (!propertySnapshot.exists) {
                throw new Error(`Property not found: ${subscription.propertyNumber}`);
            }
            if (subscription.linkedProperty) {
                const mainPropertyNumber = String(subscription.linkedProperty).trim();
                const existingDocument = existingSnapshot.docs.find(
                    (document) => document.id === id,
                );
                const existingSubscription = existingDocument?.data();
                const propertyData = propertySnapshot.data() || {};
                const existingRestoreState = propertyData
                    .linkedPropertyRestoreState as LinkedPropertyRestoreState | undefined;
                const alreadyLinkedToMain =
                    String(propertyData.linkedProperty || "").trim() === mainPropertyNumber ||
                    String(existingSubscription?.linkedProperty || "").trim() === mainPropertyNumber;
                if (existingRestoreState?.mainPropertyNumber === mainPropertyNumber) {
                    propertyUpdates.linkedPropertyRestoreState = existingRestoreState;
                } else if (!alreadyLinkedToMain) {
                    propertyUpdates.linkedPropertyRestoreState = {
                        mainPropertyNumber,
                        capturedAt: new Date().toISOString(),
                        subscriptionDocumentId: id,
                        subscriptionExisted: Boolean(existingDocument),
                        subscription: captureLinkedPropertyFields(
                            existingSubscription,
                            LINKED_SUBSCRIPTION_MIRROR_FIELDS,
                        ),
                        property: captureLinkedPropertyFields(
                            propertyData,
                            LINKED_PROPERTY_MIRROR_FIELDS,
                        ),
                    } satisfies LinkedPropertyRestoreState;
                }
            }
            transaction.set(subscriptionRef, newSubscription);
            transaction.update(propertyRef, propertyUpdates);
        });

        return newSubscription;
    }

    async addSubscriptionToSheet(propertyNumber: string, subscriptionData: any, property: any, receiptUrl?: string): Promise<void> {
        const id = `SUB-${propertyNumber}`;
        // فرض الحد الأقصى (40 يوماً من اليوم) عند تفعيل الاشتراك.
        // توجد حماية إضافية موحدة عند جميع حدود الكتابة.
        const cappedEndDate = capAtMaxDays(new Date(subscriptionData.endDate));
        const endDate = cappedEndDate;
        const now = new Date();

        let status = "نشط";
        if (endDate < now) {
            status = "منتهي";
        }

        const subscription: Subscription = {
            id,
            propertyNumber,
            packageId: subscriptionData.packageId || "pkg-free",
            subscriptionType: subscriptionData.subscriptionType || "عادي",
            startDate: subscriptionData.startDate,
            endDate: cappedEndDate.toISOString(),
            status: status as any,
            paymentId: subscriptionData.paymentId,
            linkedProperty: subscriptionData.linkedProperty || undefined,
            linkedProperties: subscriptionData.linkedProperties || undefined,
            propertyCount: subscriptionData.propertyCount || 1,
        };

        const docRef = this.db.collection("subscriptions").doc(id);
        const propertyRef = this.db.collection("properties").doc(propertyNumber);
        const propertyUpdates: any = {
            subscriptionType:
                status !== "منتهي" && isPremiumSubscriptionType(subscriptionData.subscriptionType)
                    ? "مميز"
                    : "عادي",
            pendingPaidSubscription: false,
            lastUpdate: new Date().toISOString().split("T")[0],
            subscriptionDate: subscription.startDate.split("T")[0],
            updatedAt: new Date().toISOString(),
        };

        if (subscriptionData.linkedProperty) {
            propertyUpdates.linkedProperty = subscriptionData.linkedProperty;
        }

        await this.db.runTransaction(async (transaction) => {
            const existingSnapshot = await transaction.get(
                this.db
                    .collection("subscriptions")
                    .where("propertyNumber", "==", propertyNumber),
            );
            const parentSnapshot = subscriptionData.linkedProperty
                ? await transaction.get(
                    this.db
                        .collection("subscriptions")
                        .where(
                            "propertyNumber",
                            "==",
                            subscriptionData.linkedProperty,
                        ),
                )
                : null;
            const propertySnapshot = await transaction.get(propertyRef);
            this.assertCurrentSubscriptionNotSuspended(
                existingSnapshot.docs,
                propertyNumber,
            );
            if (parentSnapshot && subscriptionData.linkedProperty) {
                this.assertCurrentSubscriptionNotSuspended(
                    parentSnapshot.docs,
                    subscriptionData.linkedProperty,
                );
            }
            if (!propertySnapshot.exists) {
                throw new Error(`Property not found: ${propertyNumber}`);
            }

            if (subscriptionData.linkedProperty) {
                const mainPropertyNumber = String(subscriptionData.linkedProperty).trim();
                const existingDocument = existingSnapshot.docs.find(
                    (document) => document.id === id,
                );
                const existingSubscription = existingDocument?.data();
                const propertyData = propertySnapshot.data() || {};
                const existingRestoreState = propertyData
                    .linkedPropertyRestoreState as LinkedPropertyRestoreState | undefined;
                const alreadyLinkedToMain =
                    String(propertyData.linkedProperty || "").trim() === mainPropertyNumber ||
                    String(existingSubscription?.linkedProperty || "").trim() === mainPropertyNumber;
                if (existingRestoreState?.mainPropertyNumber === mainPropertyNumber) {
                    propertyUpdates.linkedPropertyRestoreState = existingRestoreState;
                } else if (!alreadyLinkedToMain) {
                    propertyUpdates.linkedPropertyRestoreState = {
                        mainPropertyNumber,
                        capturedAt: new Date().toISOString(),
                        subscriptionDocumentId: id,
                        subscriptionExisted: Boolean(existingDocument),
                        subscription: captureLinkedPropertyFields(
                            existingSubscription,
                            LINKED_SUBSCRIPTION_MIRROR_FIELDS,
                        ),
                        property: captureLinkedPropertyFields(
                            propertyData,
                            LINKED_PROPERTY_MIRROR_FIELDS,
                        ),
                    } satisfies LinkedPropertyRestoreState;
                }
            }

            // Activation is intentionally a full replacement. Resume is the
            // only lifecycle operation allowed to carry suspension metadata.
            transaction.set(docRef, {
                ...subscription,
                cancelledAt: null,
                cancelReason: null,
                suspendedAt: null,
                remainingDurationMs: null,
            });
            transaction.update(propertyRef, propertyUpdates);
        });
    }

    async cancelSubscription(propertyNumber: string, reason?: string): Promise<void> {
        const id = `SUB-${propertyNumber}`;
        const ref = this.db.collection("subscriptions").doc(id);
        const doc = await ref.get();
        if (!doc.exists) {
            console.log(`⚠️ Subscription not found for property ${propertyNumber}`);
            return;
        }
        const subData = doc.data() as any;

        await ref.update({
            status: "منتهي",
            endDate: new Date().toISOString(),
            cancelledAt: new Date().toISOString(),
            cancelReason: reason ?? "admin",
        });
        console.log(`✅ Subscription cancelled for property ${propertyNumber} (reason: ${reason ?? "admin"})`);

        // Cascading cleanup: remove this property from linkedProperties of related subscriptions
        // and clear linkedProperty on children if this was a main property
        if (subData.linkedProperty) {
            // This property was linked TO another (main) property
            const mainSubId = `SUB-${subData.linkedProperty}`;
            const mainRef = this.db.collection("subscriptions").doc(mainSubId);
            const mainDoc = await mainRef.get();
            if (mainDoc.exists) {
                const mainData = mainDoc.data() as any;
                if (mainData.linkedProperties && Array.isArray(mainData.linkedProperties)) {
                    const updatedLinkedProps = mainData.linkedProperties.filter((lp: string) => lp !== propertyNumber);
                    await mainRef.update({
                        linkedProperties: updatedLinkedProps,
                        propertyCount: updatedLinkedProps.length + 1,
                    });
                }
                // Also clear from multi_property_subscriptions
                const multiQuery = await this.db.collection("multi_property_subscriptions")
                    .where("status", "==", "نشط")
                    .get();
                for (const multiDoc of multiQuery.docs) {
                    const msData = multiDoc.data();
                    const allProps = new Set<string>([msData.propertyNumber1]);
                    if (msData.propertyNumber2) allProps.add(msData.propertyNumber2);
                    if (msData.additionalProperties) msData.additionalProperties.forEach((ap: string) => allProps.add(ap));
                    if (allProps.has(propertyNumber)) {
                        if (propertyNumber === msData.propertyNumber1) {
                            // Main property being cancelled — delete whole group
                            await multiDoc.ref.delete();
                        } else {
                            // Remove from group
                            let newProp2 = msData.propertyNumber2;
                            let newAdd = [...(msData.additionalProperties || [])];
                            if (propertyNumber === msData.propertyNumber2) {
                                newProp2 = undefined;
                                newAdd = newAdd.filter((p: string) => p !== propertyNumber);
                            } else {
                                newAdd = newAdd.filter((p: string) => p !== propertyNumber);
                            }
                            const remainingSet = new Set<string>([msData.propertyNumber1]);
                            if (newProp2) remainingSet.add(newProp2);
                            newAdd.forEach((ap: string) => remainingSet.add(ap));
                            const remaining = Array.from(remainingSet);
                            const updateData: any = {
                                additionalProperties: newAdd,
                                linkedProperties: remaining,
                                propertyCount: remaining.length,
                            };
                            if (typeof newProp2 === 'undefined' && msData.propertyNumber2) {
                                updateData.propertyNumber2 = null;
                            }
                            await multiDoc.ref.update(updateData);
                        }
                    }
                }
            }
        }

        if (subData.linkedProperties && Array.isArray(subData.linkedProperties) && subData.linkedProperties.length > 0) {
            // This was a main property with children — cancel all linked children too
            for (const childProp of subData.linkedProperties) {
                if (childProp !== propertyNumber) {
                    await this.cancelSubscription(childProp, `تم إلغاء اشتراك العقار الرئيسي ${propertyNumber}: ${reason ?? ""}`);
                }
            }
        }

        // A cancelled subscription can never leave the property classified as premium.
        await this.updateProperty(propertyNumber, {
            linkedProperty: "",
            subscriptionType: "عادي",
        });
    }

    /**
     * Cancel only subscription state that still belongs to the expected
     * payment. The ownership comparison and the subscription/property writes
     * share one Firestore transaction, so a replacement payment cannot be
     * cancelled through a stale read. This method intentionally never
     * cascades; rejection callers invoke it separately for each linked child.
     */
    async cancelSubscriptionIfOwnedByPayment(
        propertyNumber: string,
        expectedPaymentId: string,
        reason?: string,
    ): Promise<boolean> {
        const visited = new Set<string>();

        const cancelOwned = async (
            currentPropertyNumber: string,
            cancellationReason?: string,
        ): Promise<boolean> => {
            if (visited.has(currentPropertyNumber)) return false;
            visited.add(currentPropertyNumber);

            const propertyRef = this.db
                .collection("properties")
                .doc(currentPropertyNumber);
            const cancelledAt = new Date().toISOString();

            const cancellation = await this.db.runTransaction(
                async (transaction) => {
                    const subscriptionSnapshot = await transaction.get(
                        this.db
                            .collection("subscriptions")
                            .where("propertyNumber", "==", currentPropertyNumber),
                    );
                    const subscriptionDocs = [...subscriptionSnapshot.docs].sort(
                        (left, right) =>
                            this.getDateMillis(right.data()?.endDate) -
                            this.getDateMillis(left.data()?.endDate),
                    );
                    const subscriptionDoc = subscriptionDocs[0];
                    if (!subscriptionDoc) {
                        return { cancelled: false as const };
                    }

                    const subscription = subscriptionDoc.data() as Subscription;
                    if (subscription.paymentId !== expectedPaymentId) {
                        return { cancelled: false as const };
                    }

                    const ownedSubscriptionDocs = subscriptionDocs.filter(
                        (candidate) =>
                            (candidate.data() as Subscription).paymentId ===
                            expectedPaymentId,
                    );

                    // Read the property before issuing any transaction writes.
                    const propertyDoc = await transaction.get(propertyRef);
                    for (const ownedSubscriptionDoc of ownedSubscriptionDocs) {
                        transaction.update(ownedSubscriptionDoc.ref, {
                            status: "منتهي",
                            endDate: cancelledAt,
                            cancelledAt,
                            cancelReason: cancellationReason ?? "admin",
                            linkedProperty: "",
                            linkedProperties: [],
                            propertyCount: 1,
                        });
                    }
                    if (propertyDoc.exists) {
                        transaction.update(propertyRef, {
                            linkedProperty: "",
                            subscriptionType: "عادي",
                            updatedAt: cancelledAt,
                        });
                    }

                    return {
                        cancelled: true as const,
                        subscription,
                    };
                },
            );

            if (!cancellation.cancelled) return false;
            const subscription = cancellation.subscription;

            // If this was a child, only alter a parent that is still owned by
            // the same payment. A newer parent payment must remain untouched.
            if (subscription.linkedProperty) {
                await this.db.runTransaction(async (transaction) => {
                    const parentSnapshot = await transaction.get(
                        this.db
                            .collection("subscriptions")
                            .where(
                                "propertyNumber",
                                "==",
                                subscription.linkedProperty,
                            ),
                    );
                    const parentDoc = [...parentSnapshot.docs].sort(
                        (left, right) =>
                            this.getDateMillis(right.data()?.endDate) -
                            this.getDateMillis(left.data()?.endDate),
                    )[0];
                    if (!parentDoc) return;
                    const parent = parentDoc.data() as Subscription;
                    if (parent.paymentId !== expectedPaymentId) return;

                    const linkedProperties = Array.isArray(parent.linkedProperties)
                        ? parent.linkedProperties.filter(
                            (linkedProperty) =>
                                linkedProperty !== currentPropertyNumber,
                        )
                        : [];
                    for (const candidate of parentSnapshot.docs) {
                        const candidateParent = candidate.data() as Subscription;
                        if (candidateParent.paymentId !== expectedPaymentId) continue;
                        const candidateLinkedProperties = Array.isArray(
                            candidateParent.linkedProperties,
                        )
                            ? candidateParent.linkedProperties.filter(
                                (linkedProperty) =>
                                    linkedProperty !== currentPropertyNumber,
                            )
                            : linkedProperties;
                        transaction.update(candidate.ref, {
                            linkedProperties: candidateLinkedProperties,
                            propertyCount: candidateLinkedProperties.length + 1,
                        });
                    }
                });
            }

            // Multi-property records are also guarded at their write boundary;
            // a record replaced by another payment must not be deleted/edited.
            const multiQuery = await this.db
                .collection("multi_property_subscriptions")
                .where("status", "==", "نشط")
                .get();
            for (const multiDoc of multiQuery.docs) {
                await this.db.runTransaction(async (transaction) => {
                    const freshDoc = await transaction.get(multiDoc.ref);
                    if (!freshDoc.exists) return;
                    const multiSubscription = freshDoc.data() as MultiPropertySubscription;
                    if (multiSubscription.paymentId !== expectedPaymentId) return;

                    const members = new Set<string>();
                    if (multiSubscription.propertyNumber1) {
                        members.add(multiSubscription.propertyNumber1);
                    }
                    if (multiSubscription.propertyNumber2) {
                        members.add(multiSubscription.propertyNumber2);
                    }
                    for (const linkedProperty of
                        multiSubscription.additionalProperties ?? []) {
                        members.add(linkedProperty);
                    }
                    if (!members.has(currentPropertyNumber)) return;

                    if (
                        currentPropertyNumber ===
                        multiSubscription.propertyNumber1
                    ) {
                        transaction.delete(multiDoc.ref);
                        return;
                    }

                    const additionalProperties = (
                        multiSubscription.additionalProperties ?? []
                    ).filter(
                        (linkedProperty) =>
                            linkedProperty !== currentPropertyNumber,
                    );
                    const propertyNumber2 =
                        multiSubscription.propertyNumber2 === currentPropertyNumber
                            ? null
                            : multiSubscription.propertyNumber2;
                    const remainingMembers = new Set<string>([
                        multiSubscription.propertyNumber1,
                    ]);
                    if (propertyNumber2) remainingMembers.add(propertyNumber2);
                    for (const linkedProperty of additionalProperties) {
                        remainingMembers.add(linkedProperty);
                    }
                    transaction.update(multiDoc.ref, {
                        propertyNumber2,
                        additionalProperties,
                        linkedProperties: Array.from(remainingMembers),
                        propertyCount: remainingMembers.size,
                    });
                });
            }

            console.log(
                `✅ Subscription cancelled for property ${currentPropertyNumber} only for payment ${expectedPaymentId}`,
            );
            return true;
        };

        return cancelOwned(propertyNumber, reason);
    }

    /**
     * Mutate a subscription group through one Firestore transaction. Every
     * membership writer (owner or admin) must use this boundary so concurrent
     * approvals cannot lose an update or exceed package capacity, and a group
     * cannot change while one of its properties has an actionable payment in
     * flight.
     */
    async mutateLinkedPropertyGroupAtomically(
        params: LinkedPropertyGroupMutationParams,
    ): Promise<LinkedPropertyGroupMutationResult> {
        const mainPropertyNumber = String(params.mainPropertyNumber || "").trim();
        const normalize = (values: unknown): string[] => Array.from(
            new Set(
                this.parsePropertyNumberList(values)
                    .map((value) => String(value).trim())
                    .filter(
                        (value) => value && value !== mainPropertyNumber,
                    ),
            ),
        ).sort((left, right) => left.localeCompare(right));
        const requestedAdds = normalize(params.addPropertyNumbers);
        const requestedRemovals = normalize(params.removePropertyNumbers);
        const requestedReplacement = params.replacePropertyNumbers === undefined
            ? null
            : normalize(params.replacePropertyNumbers);

        if (!mainPropertyNumber) {
            throw new LinkedPropertyMutationError(
                "رقم العقار الرئيسي مطلوب",
                400,
                "MAIN_PROPERTY_REQUIRED",
            );
        }
        if (
            requestedReplacement === null &&
            requestedAdds.length === 0 &&
            requestedRemovals.length === 0
        ) {
            throw new LinkedPropertyMutationError(
                "لم يتم تحديد أي تغيير على العقارات المرتبطة",
                400,
                "LINKED_PROPERTY_MUTATION_EMPTY",
            );
        }

        return this.db.runTransaction(async (transaction) => {
            const subscriptionCollection = this.db.collection("subscriptions");
            const mainSubscriptionSnapshot = await transaction.get(
                subscriptionCollection.where(
                    "propertyNumber",
                    "==",
                    mainPropertyNumber,
                ),
            );
            const mainSubscriptionDoc = [...mainSubscriptionSnapshot.docs].sort(
                (left, right) =>
                    this.getDateMillis(right.data()?.endDate) -
                    this.getDateMillis(left.data()?.endDate),
            )[0];
            if (!mainSubscriptionDoc) {
                throw new LinkedPropertyMutationError(
                    "العقار الرئيسي ليس لديه اشتراك",
                    404,
                    "MAIN_SUBSCRIPTION_NOT_FOUND",
                );
            }

            const mainSubscription = {
                ...mainSubscriptionDoc.data(),
                id:
                    mainSubscriptionDoc.data()?.id ||
                    mainSubscriptionDoc.id,
            } as Subscription;
            if (isSubscriptionStatusSuspended(mainSubscription.status)) {
                throw new LinkedPropertyMutationError(
                    "لا يمكن تعديل العقارات المرتبطة لأن اشتراك العقار الرئيسي موقوف مؤقتاً من الإدارة",
                    423,
                    "PROPERTY_SUSPENDED",
                );
            }
            const mainIsActive = Boolean(
                mainSubscription.endDate &&
                isSubscriptionStatusActive(mainSubscription.status) &&
                calculateRemainingDays(mainSubscription.endDate) >= 0,
            );
            if (!mainIsActive) {
                throw new LinkedPropertyMutationError(
                    "لا يمكن تعديل العقارات المرتبطة لأن اشتراك العقار الرئيسي غير ساري",
                    409,
                    "MAIN_SUBSCRIPTION_INACTIVE",
                );
            }
            const foreignMain = String(mainSubscription.linkedProperty || "").trim();
            if (foreignMain && foreignMain !== mainPropertyNumber) {
                throw new LinkedPropertyMutationError(
                    "العقار المحدد تابع لاشتراك رئيسي آخر",
                    409,
                    "MAIN_PROPERTY_IS_LINKED_CHILD",
                );
            }

            const linkedChildSnapshot = await transaction.get(
                subscriptionCollection.where(
                    "linkedProperty",
                    "==",
                    mainPropertyNumber,
                ),
            );
            const candidateCurrentMembers = new Set<string>(
                normalize(mainSubscription.linkedProperties),
            );
            for (const childDoc of linkedChildSnapshot.docs) {
                const propertyNumber = String(
                    childDoc.data()?.propertyNumber || "",
                ).trim();
                if (propertyNumber && propertyNumber !== mainPropertyNumber) {
                    candidateCurrentMembers.add(propertyNumber);
                }
            }

            const relevantPropertyNumbers = new Set<string>([
                ...candidateCurrentMembers,
                ...requestedAdds,
                ...requestedRemovals,
                ...(requestedReplacement || []),
            ]);
            const childSnapshots = new Map<
                string,
                FirebaseFirestore.QuerySnapshot
            >();
            const latestChildDocuments = new Map<
                string,
                FirebaseFirestore.QueryDocumentSnapshot
            >();
            const latestChildSubscriptions = new Map<string, Subscription>();
            for (const propertyNumber of Array.from(
                relevantPropertyNumbers,
            ).sort((left, right) => left.localeCompare(right))) {
                const snapshot = await transaction.get(
                    subscriptionCollection.where(
                        "propertyNumber",
                        "==",
                        propertyNumber,
                    ),
                );
                childSnapshots.set(propertyNumber, snapshot);
                const latestDocument = [...snapshot.docs].sort(
                    (left, right) =>
                        this.getDateMillis(right.data()?.endDate) -
                        this.getDateMillis(left.data()?.endDate),
                )[0];
                if (latestDocument) {
                    latestChildDocuments.set(propertyNumber, latestDocument);
                    latestChildSubscriptions.set(propertyNumber, {
                        ...latestDocument.data(),
                        id: latestDocument.data()?.id || latestDocument.id,
                    } as Subscription);
                }
            }

            // Only the latest, active linkage is a current implicit member.
            // Historical duplicate rows must not permanently expand a group.
            const currentMembers = new Set<string>(
                normalize(mainSubscription.linkedProperties),
            );
            for (const [propertyNumber, childSubscription] of
                latestChildSubscriptions) {
                if (
                    childSubscription.linkedProperty === mainPropertyNumber &&
                    childSubscription.endDate &&
                    isSubscriptionStatusActive(childSubscription.status) &&
                    calculateRemainingDays(childSubscription.endDate) >= 0
                ) {
                    currentMembers.add(propertyNumber);
                }
            }

            const desiredMembers = requestedReplacement === null
                ? new Set<string>(currentMembers)
                : new Set<string>(requestedReplacement);
            for (const propertyNumber of requestedAdds) {
                desiredMembers.add(propertyNumber);
            }
            for (const propertyNumber of requestedRemovals) {
                if (!currentMembers.has(propertyNumber)) {
                    throw new LinkedPropertyMutationError(
                        `العقار ${propertyNumber} غير مرتبط بالعقار الرئيسي`,
                        409,
                        "LINKED_PROPERTY_NOT_IN_GROUP",
                    );
                }
                desiredMembers.delete(propertyNumber);
            }
            const linkedProperties = Array.from(desiredMembers).sort(
                (left, right) => left.localeCompare(right),
            );
            const addedProperties = linkedProperties.filter(
                (propertyNumber) => !currentMembers.has(propertyNumber),
            );
            const removedProperties = Array.from(currentMembers)
                .filter((propertyNumber) => !desiredMembers.has(propertyNumber))
                .sort((left, right) => left.localeCompare(right));

            const packageRef = this.db
                .collection("packages")
                .doc(mainSubscription.packageId);
            const mainPropertyRef = this.db
                .collection("properties")
                .doc(mainPropertyNumber);
            const multiSnapshot = await transaction.get(
                this.db
                    .collection("multi_property_subscriptions")
                    .where("propertyNumber1", "==", mainPropertyNumber),
            );
            const packageDoc = await transaction.get(packageRef);
            const mainPropertyDoc = await transaction.get(mainPropertyRef);
            if (!packageDoc.exists) {
                throw new LinkedPropertyMutationError(
                    "تعذر العثور على باقة الاشتراك الرئيسي لتحديد سعة العقارات",
                    422,
                    "SUBSCRIPTION_PACKAGE_NOT_FOUND",
                );
            }
            if (!mainPropertyDoc.exists) {
                throw new LinkedPropertyMutationError(
                    "العقار الرئيسي غير موجود",
                    404,
                    "MAIN_PROPERTY_NOT_FOUND",
                );
            }
            const packageData = packageDoc.data() as Package;
            const maximumValue = Number(
                packageData.maxProperties ?? packageData.propertyCount ?? 1,
            );
            const maxProperties = Number.isFinite(maximumValue) && maximumValue > 0
                ? Math.floor(maximumValue)
                : 1;
            if (linkedProperties.length + 1 > maxProperties) {
                throw new LinkedPropertyMutationError(
                    `هذه الباقة تدعم ${maxProperties} عقار كحد أقصى`,
                    409,
                    "PACKAGE_PROPERTY_LIMIT_EXCEEDED",
                );
            }

            const propertyDocuments = new Map<
                string,
                FirebaseFirestore.DocumentSnapshot
            >();
            for (const propertyNumber of Array.from(
                new Set([...linkedProperties, ...removedProperties]),
            ).sort((left, right) => left.localeCompare(right))) {
                const propertyDoc = await transaction.get(
                    this.db.collection("properties").doc(propertyNumber),
                );
                if (!propertyDoc.exists && desiredMembers.has(propertyNumber)) {
                    throw new LinkedPropertyMutationError(
                        `العقار ${propertyNumber} غير موجود`,
                        404,
                        "LINKED_PROPERTY_NOT_FOUND",
                    );
                }
                if (propertyDoc.exists) {
                    propertyDocuments.set(propertyNumber, propertyDoc);
                }
            }

            for (const propertyNumber of linkedProperties) {
                const childSubscription = latestChildSubscriptions.get(
                    propertyNumber,
                );
                if (!childSubscription) continue;
                if (isSubscriptionStatusSuspended(childSubscription.status)) {
                    throw new LinkedPropertyMutationError(
                        `العقار ${propertyNumber} موقوف مؤقتاً من الإدارة ولا يمكن ربطه أو تفعيله`,
                        423,
                        "PROPERTY_SUSPENDED",
                    );
                }
                const linkedParent = String(
                    childSubscription.linkedProperty || "",
                ).trim();
                const childIsActive = Boolean(
                    childSubscription.endDate &&
                    isSubscriptionStatusActive(childSubscription.status) &&
                    calculateRemainingDays(childSubscription.endDate) >= 0,
                );
                const ownsAnotherGroup = normalize(
                    childSubscription.linkedProperties,
                ).some(
                    (member) =>
                        member !== mainPropertyNumber &&
                        member !== propertyNumber,
                );
                if (
                    (linkedParent && linkedParent !== mainPropertyNumber) ||
                    ownsAnotherGroup ||
                    (childIsActive && linkedParent !== mainPropertyNumber)
                ) {
                    throw new LinkedPropertyMutationError(
                        `العقار ${propertyNumber} مرتبط باشتراك آخر`,
                        409,
                        "LINKED_PROPERTY_ALREADY_ACTIVE",
                    );
                }
            }

            const now = new Date();
            const nowIso = now.toISOString();
            const normalizedEndDate = capAtMaxDays(
                new Date(mainSubscription.endDate),
                MAX_SUBSCRIPTION_DAYS,
                now,
            ).toISOString();
            const premiumPropertyType = isActivePremiumSubscription({
                subscriptionType:
                    mainSubscription.subscriptionType ||
                    mainSubscription.packageType,
                status: mainSubscription.status,
                isExpired: calculateRemainingDays(normalizedEndDate) < 0,
            })
                ? "مميز"
                : "عادي";

            transaction.update(mainSubscriptionDoc.ref, {
                linkedProperties,
                propertyCount: linkedProperties.length + 1,
                endDate: normalizedEndDate,
                updatedAt: nowIso,
            });

            for (const propertyNumber of linkedProperties) {
                const existingDocument = latestChildDocuments.get(propertyNumber);
                const childRef = existingDocument?.ref ||
                    subscriptionCollection.doc(`SUB-${propertyNumber}`);
                const isNewlyAdded = addedProperties.includes(propertyNumber);
                const propertyDocument = propertyDocuments.get(propertyNumber)!;
                const restoreState: LinkedPropertyRestoreState | undefined =
                    isNewlyAdded
                        ? {
                            mainPropertyNumber,
                            capturedAt: nowIso,
                            subscriptionDocumentId: childRef.id,
                            subscriptionExisted: Boolean(existingDocument),
                            subscription: captureLinkedPropertyFields(
                                existingDocument?.data(),
                                LINKED_SUBSCRIPTION_MIRROR_FIELDS,
                            ),
                            property: captureLinkedPropertyFields(
                                propertyDocument.data(),
                                LINKED_PROPERTY_MIRROR_FIELDS,
                            ),
                        }
                        : undefined;
                const childRecord = {
                    id: existingDocument?.data()?.id || `SUB-${propertyNumber}`,
                    propertyNumber,
                    packageId: mainSubscription.packageId,
                    subscriptionType:
                        mainSubscription.subscriptionType ||
                        mainSubscription.packageType ||
                        "عادي",
                    packageType:
                        mainSubscription.packageType ||
                        mainSubscription.subscriptionType ||
                        "عادي",
                    startDate: mainSubscription.startDate,
                    endDate: normalizedEndDate,
                    status: mainSubscription.status,
                    paymentId: mainSubscription.paymentId,
                    linkedProperty: mainPropertyNumber,
                    linkedProperties: [],
                    propertyCount: 1,
                    cancelledAt: null,
                    cancelReason: null,
                    updatedAt: nowIso,
                    ...(existingDocument ? {} : { createdAt: nowIso }),
                };
                transaction.set(childRef, childRecord, { merge: true });

                const propertyUpdates: Record<string, unknown> = {
                    linkedProperty: mainPropertyNumber,
                    subscriptionType: premiumPropertyType,
                    pendingApprovalFrom: "",
                    subscriptionDate: mainSubscription.startDate.split("T")[0],
                    lastUpdate: nowIso.split("T")[0],
                    updatedAt: nowIso,
                };
                if (params.approveAddedProperties) {
                    propertyUpdates.verificationStatus = "approved";
                }
                if (restoreState) {
                    propertyUpdates.linkedPropertyRestoreState = restoreState;
                }
                transaction.update(
                    propertyDocument.ref,
                    propertyUpdates,
                );
            }

            for (const propertyNumber of removedProperties) {
                const snapshot = childSnapshots.get(propertyNumber);
                const latestDocument = latestChildDocuments.get(propertyNumber);
                const latestBelongsToMain =
                    latestDocument?.data()?.linkedProperty === mainPropertyNumber;
                for (const childDocument of snapshot?.docs || []) {
                    if (childDocument.data()?.linkedProperty !== mainPropertyNumber) {
                        continue;
                    }
                    const childUpdates: Record<string, unknown> = {
                        linkedProperty: "",
                        linkedProperties: [],
                        propertyCount: 1,
                        updatedAt: nowIso,
                    };
                    if (
                        params.cancelRemovedSubscriptions &&
                        childDocument.id === latestDocument?.id
                    ) {
                        childUpdates.status = "منتهي";
                        childUpdates.endDate = nowIso;
                        childUpdates.cancelledAt = nowIso;
                        childUpdates.cancelReason = "تم فصل العقار من المجموعة";
                    }
                    transaction.update(childDocument.ref, childUpdates);
                }
                const removedPropertyDocument = propertyDocuments.get(
                    propertyNumber,
                );
                if (removedPropertyDocument) {
                    const propertyData = removedPropertyDocument.data() || {};
                    const mirroredParent = String(
                        propertyData.linkedProperty || "",
                    ).trim();
                    const pendingParent = String(
                        propertyData.pendingApprovalFrom || "",
                    ).trim();
                    transaction.update(removedPropertyDocument.ref, {
                        ...(!mirroredParent || mirroredParent === mainPropertyNumber
                            ? { linkedProperty: "" }
                            : {}),
                        ...(pendingParent === mainPropertyNumber
                            ? { pendingApprovalFrom: "" }
                            : {}),
                        ...(params.cancelRemovedSubscriptions &&
                        latestBelongsToMain
                            ? { subscriptionType: "عادي" }
                            : {}),
                        updatedAt: nowIso,
                    });
                }
            }

            const activeMultiDocument = [...multiSnapshot.docs]
                .filter((document) => {
                    const data = document.data() as MultiPropertySubscription;
                    return (
                        isSubscriptionStatusActive(data.status) &&
                        calculateRemainingDays(data.endDate) >= 0
                    );
                })
                .sort(
                    (left, right) =>
                        this.getDateMillis(right.data()?.endDate) -
                        this.getDateMillis(left.data()?.endDate),
                )[0];
            if (linkedProperties.length === 0) {
                if (activeMultiDocument) {
                    transaction.delete(activeMultiDocument.ref);
                }
            } else {
                const multiRef = activeMultiDocument?.ref ||
                    this.db
                        .collection("multi_property_subscriptions")
                        .doc(`MULTI-${encodeURIComponent(mainPropertyNumber)}`);
                transaction.set(
                    multiRef,
                    {
                        id:
                            activeMultiDocument?.data()?.id ||
                            `MULTI-${encodeURIComponent(mainPropertyNumber)}`,
                        packageId: mainSubscription.packageId,
                        propertyNumber1: mainPropertyNumber,
                        propertyNumber2: linkedProperties[0],
                        additionalProperties: linkedProperties.slice(1),
                        linkedProperties: [
                            mainPropertyNumber,
                            ...linkedProperties,
                        ],
                        propertyCount: linkedProperties.length + 1,
                        startDate: mainSubscription.startDate,
                        endDate: normalizedEndDate,
                        status: "نشط",
                        paymentId: mainSubscription.paymentId,
                        ...(activeMultiDocument ? {} : { createdAt: nowIso }),
                    },
                    { merge: true },
                );
            }

            return {
                mainPropertyNumber,
                linkedProperties,
                addedProperties,
                removedProperties,
                mainSubscription: {
                    ...mainSubscription,
                    endDate: normalizedEndDate,
                    linkedProperties,
                    propertyCount: linkedProperties.length + 1,
                },
            };
        });
    }

    /**
     * Detach linked properties without applying activation, package, suspension,
     * or payment eligibility rules. Unlinking removes membership only: the main
     * subscription keeps all of its lifecycle fields, while each child is
     * restored to the state captured immediately before it joined the group.
     */
    async unlinkLinkedPropertiesAtomically(params: {
        mainPropertyNumber: string;
        propertyNumbers: string[];
    }): Promise<{ mainPropertyNumber: string; linkedProperties: string[]; removedProperties: string[] }> {
        const mainPropertyNumber = String(params.mainPropertyNumber || "").trim();
        const propertyNumbers = Array.from(new Set(
            (params.propertyNumbers || [])
                .map((value) => String(value || "").trim())
                .filter((value) => value && value !== mainPropertyNumber),
        )).sort((left, right) => left.localeCompare(right));

        if (!mainPropertyNumber) {
            throw new LinkedPropertyMutationError(
                "رقم العقار الرئيسي مطلوب",
                400,
                "MAIN_PROPERTY_REQUIRED",
            );
        }
        if (propertyNumbers.length === 0) {
            throw new LinkedPropertyMutationError(
                "لم يتم تحديد عقار مرتبط لفصله",
                400,
                "LINKED_PROPERTY_MUTATION_EMPTY",
            );
        }

        return this.db.runTransaction(async (transaction) => {
            const subscriptionCollection = this.db.collection("subscriptions");
            const mainSubscriptionSnapshot = await transaction.get(
                subscriptionCollection.where("propertyNumber", "==", mainPropertyNumber),
            );
            const linkedChildSnapshot = await transaction.get(
                subscriptionCollection.where("linkedProperty", "==", mainPropertyNumber),
            );
            const multiSnapshot = await transaction.get(
                this.db
                    .collection("multi_property_subscriptions")
                    .where("propertyNumber1", "==", mainPropertyNumber),
            );

            const childSnapshots = new Map<string, FirebaseFirestore.QuerySnapshot>();
            const propertyDocuments = new Map<string, FirebaseFirestore.DocumentSnapshot>();
            for (const propertyNumber of propertyNumbers) {
                childSnapshots.set(
                    propertyNumber,
                    await transaction.get(
                        subscriptionCollection.where("propertyNumber", "==", propertyNumber),
                    ),
                );
                propertyDocuments.set(
                    propertyNumber,
                    await transaction.get(
                        this.db.collection("properties").doc(propertyNumber),
                    ),
                );
            }

            const mainSubscriptionDoc = [...mainSubscriptionSnapshot.docs].sort(
                (left, right) =>
                    this.getDateMillis(right.data()?.endDate) -
                    this.getDateMillis(left.data()?.endDate),
            )[0];
            const mainSubscription = mainSubscriptionDoc?.data() as Subscription | undefined;
            const currentMembers = new Set<string>(
                this.parsePropertyNumberList(mainSubscription?.linkedProperties)
                    .map((value) => String(value).trim())
                    .filter((value) => value && value !== mainPropertyNumber),
            );

            for (const document of linkedChildSnapshot.docs) {
                const propertyNumber = String(document.data()?.propertyNumber || "").trim();
                if (propertyNumber && propertyNumber !== mainPropertyNumber) {
                    currentMembers.add(propertyNumber);
                }
            }
            for (const document of multiSnapshot.docs) {
                const data = document.data() as MultiPropertySubscription;
                const members = new Set<string>([
                    data.propertyNumber1,
                    ...(data.propertyNumber2 ? [data.propertyNumber2] : []),
                    ...(data.additionalProperties || []),
                    ...this.parsePropertyNumberList(data.linkedProperties),
                ]);
                for (const propertyNumber of members) {
                    if (propertyNumber && propertyNumber !== mainPropertyNumber) {
                        currentMembers.add(propertyNumber);
                    }
                }
            }

            for (const propertyNumber of propertyNumbers) {
                if (!currentMembers.has(propertyNumber)) {
                    throw new LinkedPropertyMutationError(
                        `العقار ${propertyNumber} غير مرتبط بالعقار الرئيسي`,
                        409,
                        "LINKED_PROPERTY_NOT_IN_GROUP",
                    );
                }
            }

            const removedSet = new Set(propertyNumbers);
            const linkedProperties = Array.from(currentMembers)
                .filter((propertyNumber) => !removedSet.has(propertyNumber))
                .sort((left, right) => left.localeCompare(right));
            const nowIso = new Date().toISOString();

            if (mainSubscriptionDoc) {
                transaction.update(mainSubscriptionDoc.ref, {
                    linkedProperties,
                    propertyCount: linkedProperties.length + 1,
                });
            }

            for (const propertyNumber of propertyNumbers) {
                const snapshot = childSnapshots.get(propertyNumber)!;
                const orderedDocuments = [...snapshot.docs].sort(
                    (left, right) =>
                        this.getDateMillis(right.data()?.endDate) -
                        this.getDateMillis(left.data()?.endDate),
                );
                const latestDocument = orderedDocuments[0];
                const latestBelongsToMain =
                    String(latestDocument?.data()?.linkedProperty || "").trim() === mainPropertyNumber;
                const propertyDocument = propertyDocuments.get(propertyNumber);
                const propertyData = propertyDocument?.data() || {};
                const restoreState = propertyData
                    .linkedPropertyRestoreState as LinkedPropertyRestoreState | undefined;
                const hasRestoreState =
                    restoreState?.mainPropertyNumber === mainPropertyNumber;
                const restoreTarget = hasRestoreState
                    ? snapshot.docs.find(
                        (document) => document.id === restoreState.subscriptionDocumentId,
                    )
                    : undefined;
                const canRestoreTarget = Boolean(
                    restoreTarget &&
                    String(restoreTarget.data()?.linkedProperty || "").trim() === mainPropertyNumber,
                );

                for (const childDocument of snapshot.docs) {
                    if (String(childDocument.data()?.linkedProperty || "").trim() !== mainPropertyNumber) {
                        continue;
                    }
                    if (hasRestoreState && childDocument.id === restoreState.subscriptionDocumentId) {
                        if (!restoreState.subscriptionExisted) {
                            transaction.delete(childDocument.ref);
                        } else if (canRestoreTarget) {
                            const restoredSubscription = restoreLinkedPropertyFields(
                                childDocument.data() || {},
                                restoreState.subscription,
                            );
                            transaction.set(childDocument.ref, restoredSubscription);
                        }
                        continue;
                    }

                    const detachedSubscription: Record<string, unknown> = {
                        ...(childDocument.data() || {}),
                        linkedProperty: "",
                        linkedProperties: [],
                        propertyCount: 1,
                        updatedAt: nowIso,
                    };
                    if (!hasRestoreState || childDocument.id !== restoreState.subscriptionDocumentId) {
                        detachedSubscription.status = "منتهي";
                        detachedSubscription.endDate = nowIso;
                        detachedSubscription.cancelledAt = nowIso;
                        detachedSubscription.cancelReason = "تم فصل العقار من المجموعة";
                    }
                    transaction.set(childDocument.ref, detachedSubscription);
                }

                if (propertyDocument?.exists) {
                    let restoredProperty: Record<string, unknown> = { ...propertyData };
                    if (hasRestoreState && latestBelongsToMain) {
                        restoredProperty = restoreLinkedPropertyFields(
                            restoredProperty,
                            restoreState.property,
                        );
                    } else if (!hasRestoreState && latestBelongsToMain) {
                        restoredProperty.subscriptionType = "عادي";
                    }
                    delete restoredProperty.linkedPropertyRestoreState;
                    restoredProperty.linkedProperty = "";
                    restoredProperty.pendingApprovalFrom = "";
                    transaction.set(propertyDocument.ref, restoredProperty);
                }
            }

            for (const document of multiSnapshot.docs) {
                const data = document.data() as MultiPropertySubscription;
                const groupMembers = Array.from(new Set<string>([
                    ...(data.propertyNumber2 ? [data.propertyNumber2] : []),
                    ...(data.additionalProperties || []),
                    ...this.parsePropertyNumberList(data.linkedProperties),
                ]))
                    .filter(
                        (propertyNumber) =>
                            propertyNumber &&
                            propertyNumber !== mainPropertyNumber &&
                            !removedSet.has(propertyNumber),
                    )
                    .sort((left, right) => left.localeCompare(right));
                if (groupMembers.length === 0) {
                    transaction.delete(document.ref);
                } else {
                    transaction.update(document.ref, {
                        propertyNumber2: groupMembers[0],
                        additionalProperties: groupMembers.slice(1),
                        linkedProperties: [mainPropertyNumber, ...groupMembers],
                        propertyCount: groupMembers.length + 1,
                    });
                }
            }

            return {
                mainPropertyNumber,
                linkedProperties,
                removedProperties: propertyNumbers,
            };
        });
    }

    /**
     * Sync a single linked (child) property so its subscription doc AND property doc
     * always match the main property's state. This is the single source of truth for
     * keeping parent + child consistent — use it on every activation/renewal path.
     *
     * - Updates the child subscription doc (dates, type, status, paymentId)
     * - Mirrors subscriptionType + subscriptionDate onto the child property doc
     * - Forces verificationStatus = "approved" (linked props inherit the main's verified state)
     */
    async syncLinkedProperty(
        linkedPropNum: string,
        mainPropertyNumber: string,
        data: {
            subscriptionType: string;
            startDate: string;
            endDate: string;
            status?: string;
            paymentId?: string;
            packageId?: string;
        }
    ): Promise<void> {
        const childSubId = `SUB-${linkedPropNum}`;
        const childSubRef = this.db.collection("subscriptions").doc(childSubId);
        const childPropertyRef = this.db
            .collection("properties")
            .doc(linkedPropNum);
        const cappedEndDate = capAtMaxDays(new Date(data.endDate));
        const effectiveStatus = data.status || "نشط";
        const propertySubscriptionType = isActivePremiumSubscription({
            subscriptionType: data.subscriptionType,
            status: effectiveStatus,
            isExpired: calculateRemainingDays(cappedEndDate) < 0,
        }) ? "مميز" : "عادي";

        const subUpdates: any = {
            startDate: data.startDate,
            endDate: cappedEndDate.toISOString(),
            subscriptionType: data.subscriptionType,
            packageType: data.subscriptionType,
            status: effectiveStatus,
            linkedProperty: mainPropertyNumber,
            linkedProperties: null,
            propertyCount: 1,
            cancelledAt: null,
            cancelReason: null,
            updatedAt: new Date().toISOString(),
        };
        if (data.paymentId) subUpdates.paymentId = data.paymentId;
        if (data.packageId) subUpdates.packageId = data.packageId;

        await this.db.runTransaction(async (transaction) => {
            const childSubscriptionSnapshot = await transaction.get(
                this.db
                    .collection("subscriptions")
                    .where("propertyNumber", "==", linkedPropNum),
            );
            const mainSubscriptionSnapshot = await transaction.get(
                this.db
                    .collection("subscriptions")
                    .where("propertyNumber", "==", mainPropertyNumber),
            );
            const childPropertySnapshot = await transaction.get(childPropertyRef);
            this.assertCurrentSubscriptionNotSuspended(
                childSubscriptionSnapshot.docs,
                linkedPropNum,
            );
            this.assertCurrentSubscriptionNotSuspended(
                mainSubscriptionSnapshot.docs,
                mainPropertyNumber,
            );
            if (!childPropertySnapshot.exists) {
                throw new Error(`Property not found: ${linkedPropNum}`);
            }

            const childSubDoc = childSubscriptionSnapshot.docs.find(
                (document) => document.id === childSubId,
            );
            const childPropertyData = childPropertySnapshot.data() || {};
            const childSubscriptionData = childSubDoc?.data();
            const alreadyLinkedToMain =
                String(childPropertyData.linkedProperty || "").trim() === mainPropertyNumber ||
                String(childSubscriptionData?.linkedProperty || "").trim() === mainPropertyNumber;
            const existingRestoreState = childPropertyData
                .linkedPropertyRestoreState as LinkedPropertyRestoreState | undefined;
            const restoreState =
                existingRestoreState?.mainPropertyNumber === mainPropertyNumber
                    ? existingRestoreState
                    : (!alreadyLinkedToMain
                        ? {
                            mainPropertyNumber,
                            capturedAt: new Date().toISOString(),
                            subscriptionDocumentId: childSubId,
                            subscriptionExisted: Boolean(childSubDoc),
                            subscription: captureLinkedPropertyFields(
                                childSubscriptionData,
                                LINKED_SUBSCRIPTION_MIRROR_FIELDS,
                            ),
                            property: captureLinkedPropertyFields(
                                childPropertyData,
                                LINKED_PROPERTY_MIRROR_FIELDS,
                            ),
                        }
                        : undefined);
            if (childSubDoc) {
                transaction.update(childSubRef, subUpdates);
            } else {
                transaction.set(childSubRef, {
                    id: childSubId,
                    propertyNumber: linkedPropNum,
                    ...subUpdates,
                    createdAt: new Date().toISOString(),
                });
            }
            transaction.update(childPropertyRef, {
                subscriptionType: propertySubscriptionType,
                verificationStatus: "approved",
                linkedProperty: mainPropertyNumber,
                pendingApprovalFrom: null as any,
                subscriptionDate: data.startDate.split("T")[0],
                lastUpdate: new Date().toISOString().split("T")[0],
                updatedAt: new Date().toISOString(),
                ...(restoreState ? { linkedPropertyRestoreState: restoreState } : {}),
            });
        });
    }

    /**
     * Reconcile an entire linked group: force every linked property's subscription doc
     * AND property doc to match the main property's subscription (type, dates, status).
     * Returns a report of what was fixed. Safe to call repeatedly (idempotent).
     *
     * Pass `apply: false` for a read-only audit report.
     */
    async reconcileLinkedGroup(
        mainPropertyNumber: string,
        apply: boolean = true
    ): Promise<{
        mainPropertyNumber: string;
        linkedProperties: string[];
        inconsistencies: Array<{
            propertyNumber: string;
            field: string;
            expected: any;
            actual: any;
        }>;
        fixed: number;
    }> {
        const mainSub = await this.getSubscriptionByPropertyNumber(mainPropertyNumber);
        const inconsistencies: Array<{ propertyNumber: string; field: string; expected: any; actual: any }> = [];
        const rawLinkedProps = Array.isArray(mainSub?.linkedProperties) ? mainSub.linkedProperties : [];
        const linkedProps = Array.from(
            new Set(rawLinkedProps.map((lp: string) => String(lp).trim()).filter((lp: string) => lp && lp !== mainPropertyNumber))
        );

        if (!mainSub) {
            return { mainPropertyNumber, linkedProperties: linkedProps, inconsistencies, fixed: 0 };
        }

        const expectedType = mainSub.subscriptionType || "عادي";
        const expectedStart = mainSub.startDate;
        const expectedEnd = mainSub.endDate;
        const expectedStatus = mainSub.status || "نشط";
        const expectedPropertyType = isActivePremiumSubscription({
            subscriptionType: expectedType,
            status: expectedStatus,
            isExpired: calculateRemainingDays(expectedEnd) < 0,
        }) ? "مميز" : "عادي";

        let fixed = 0;

        if (rawLinkedProps.length !== linkedProps.length) {
            inconsistencies.push({
                propertyNumber: mainPropertyNumber,
                field: "linkedProperties",
                expected: linkedProps,
                actual: rawLinkedProps,
            });
            if (apply) {
                await this.updateSubscription(mainSub.id, { linkedProperties: linkedProps });
                fixed++;
            }
        }

        for (const childNum of linkedProps) {
            const childSub = await this.getSubscriptionByPropertyNumber(childNum);
            const childProp = await this.getPropertyByNumber(childNum);

            const childInconsistencies: Array<{ propertyNumber: string; field: string; expected: any; actual: any }> = [];

            if (!childSub) {
                childInconsistencies.push({ propertyNumber: childNum, field: "subscription", expected: "exists", actual: "missing" });
            } else {
                if ((childSub.subscriptionType || "عادي") !== expectedType) {
                    childInconsistencies.push({ propertyNumber: childNum, field: "subscriptionType", expected: expectedType, actual: childSub.subscriptionType });
                }
                if (childSub.endDate !== expectedEnd) {
                    childInconsistencies.push({ propertyNumber: childNum, field: "endDate", expected: expectedEnd, actual: childSub.endDate });
                }
                if (childSub.startDate !== expectedStart) {
                    childInconsistencies.push({ propertyNumber: childNum, field: "startDate", expected: expectedStart, actual: childSub.startDate });
                }
                if ((childSub.status || "") !== expectedStatus) {
                    childInconsistencies.push({ propertyNumber: childNum, field: "status", expected: expectedStatus, actual: childSub.status });
                }
                if (childSub.linkedProperty !== mainPropertyNumber) {
                    childInconsistencies.push({ propertyNumber: childNum, field: "linkedProperty", expected: mainPropertyNumber, actual: childSub.linkedProperty });
                }
            }

            if (childProp) {
                if ((childProp.subscriptionType || "عادي") !== expectedPropertyType) {
                    childInconsistencies.push({ propertyNumber: childNum, field: "property.subscriptionType", expected: expectedPropertyType, actual: childProp.subscriptionType });
                }
                if (childProp.verificationStatus !== "approved") {
                    childInconsistencies.push({ propertyNumber: childNum, field: "property.verificationStatus", expected: "approved", actual: childProp.verificationStatus });
                }
                if (childProp.linkedProperty !== mainPropertyNumber) {
                    childInconsistencies.push({ propertyNumber: childNum, field: "property.linkedProperty", expected: mainPropertyNumber, actual: childProp.linkedProperty });
                }
            }

            if (childInconsistencies.length > 0) {
                inconsistencies.push(...childInconsistencies);
                if (apply) {
                    await this.syncLinkedProperty(childNum, mainPropertyNumber, {
                        subscriptionType: expectedType,
                        startDate: expectedStart,
                        endDate: expectedEnd,
                        status: expectedStatus,
                        paymentId: mainSub.paymentId,
                        packageId: mainSub.packageId,
                    });
                    fixed++;
                }
            }
        }

        return { mainPropertyNumber, linkedProperties: linkedProps, inconsistencies, fixed };
    }

    async activateSubscription(
        propertyNumber: string,
        data: {
            status: string;
            subscriptionType: string;
            packageId: string;
            startDate?: string;
            endDate?: string;
            linkedProperty?: string;
            propertyCount?: number;
            linkedProperties?: string[];
        }
    ): Promise<void> {
        console.log(`[FIREBASE] activateSubscription called for: ${propertyNumber} with data:`, data);
        
        const id = `SUB-${propertyNumber}`;
        const ref = this.db.collection("subscriptions").doc(id);
        
        const updates: any = {
            status: data.status,
            subscriptionType: data.subscriptionType,
            packageId: data.packageId,
            // Clear cancellation fields on reactivation
            cancelledAt: null,
            cancelReason: null,
        };
        
        // Add linked property info if provided
        if (data.linkedProperty) {
            updates.linkedProperty = data.linkedProperty;
        }
        if (data.propertyCount) {
            updates.propertyCount = data.propertyCount;
        }
        if (data.linkedProperties && data.linkedProperties.length > 0) {
            updates.linkedProperties = data.linkedProperties;
        }
        
        // If no startDate provided, use now
        if (!data.startDate) {
            updates.startDate = new Date().toISOString();
        } else {
            updates.startDate = data.startDate;
        }
        
        // If no endDate provided, set to 30 days from now (for free subscription)
        if (!data.endDate) {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            updates.endDate = endDate.toISOString();
        } else {
            updates.endDate = data.endDate;
        }

        const normalizedUpdates = this.enforceSubscriptionDurationLimit(updates);
        
        console.log(`[FIREBASE] activateSubscription - updates to apply:`, normalizedUpdates);

        let canonicalDocumentExists = false;
        await this.db.runTransaction(async (transaction) => {
            const subscriptionSnapshot = await transaction.get(
                this.db
                    .collection("subscriptions")
                    .where("propertyNumber", "==", propertyNumber),
            );
            const currentDocument = this.getCurrentSubscriptionDocument(
                subscriptionSnapshot.docs,
                propertyNumber,
            );
            const parentPropertyNumber = String(
                data.linkedProperty || currentDocument?.data()?.linkedProperty || "",
            ).trim();
            const parentSnapshot = parentPropertyNumber
                ? await transaction.get(
                    this.db
                        .collection("subscriptions")
                        .where("propertyNumber", "==", parentPropertyNumber),
                )
                : null;
            const propertyRef = this.db.collection("properties").doc(propertyNumber);
            const propertySnapshot = data.linkedProperty
                ? await transaction.get(propertyRef)
                : null;

            this.assertCurrentSubscriptionNotSuspended(
                subscriptionSnapshot.docs,
                propertyNumber,
            );
            if (parentSnapshot && parentPropertyNumber) {
                this.assertCurrentSubscriptionNotSuspended(
                    parentSnapshot.docs,
                    parentPropertyNumber,
                );
            }

            canonicalDocumentExists = subscriptionSnapshot.docs.some(
                (document) => document.id === id,
            );
            if (data.linkedProperty && propertySnapshot?.exists) {
                const mainPropertyNumber = String(data.linkedProperty).trim();
                const canonicalDocument = subscriptionSnapshot.docs.find(
                    (document) => document.id === id,
                );
                const canonicalSubscription = canonicalDocument?.data();
                const propertyData = propertySnapshot.data() || {};
                const existingRestoreState = propertyData
                    .linkedPropertyRestoreState as LinkedPropertyRestoreState | undefined;
                const alreadyLinkedToMain =
                    String(propertyData.linkedProperty || "").trim() === mainPropertyNumber ||
                    String(canonicalSubscription?.linkedProperty || "").trim() === mainPropertyNumber;
                const propertyUpdates: Record<string, unknown> = {
                    linkedProperty: mainPropertyNumber,
                };
                if (existingRestoreState?.mainPropertyNumber === mainPropertyNumber) {
                    propertyUpdates.linkedPropertyRestoreState = existingRestoreState;
                } else if (!alreadyLinkedToMain) {
                    propertyUpdates.linkedPropertyRestoreState = {
                        mainPropertyNumber,
                        capturedAt: new Date().toISOString(),
                        subscriptionDocumentId: id,
                        subscriptionExisted: Boolean(canonicalDocument),
                        subscription: captureLinkedPropertyFields(
                            canonicalSubscription,
                            LINKED_SUBSCRIPTION_MIRROR_FIELDS,
                        ),
                        property: captureLinkedPropertyFields(
                            propertyData,
                            LINKED_PROPERTY_MIRROR_FIELDS,
                        ),
                    } satisfies LinkedPropertyRestoreState;
                }
                transaction.update(propertyRef, propertyUpdates);
            }
            if (canonicalDocumentExists) {
                transaction.update(ref, normalizedUpdates);
            } else {
                transaction.set(ref, {
                    id,
                    propertyNumber,
                    ...normalizedUpdates,
                    createdAt: new Date().toISOString(),
                });
            }
        });

        console.log(
            canonicalDocumentExists
                ? `✅ [FIREBASE] Subscription activated for property ${propertyNumber}`
                : `✅ [FIREBASE] New subscription created and activated for property ${propertyNumber}`,
        );
    }

    async getSubscriptionsByProperty(propertyNumber: string): Promise<Subscription[]> {
        const snapshot = await this.db.collection("subscriptions")
            .where("propertyNumber", "==", propertyNumber)
            .orderBy("startDate", "desc")
            .get();
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return { ...data, id: data.id || doc.id } as Subscription;
        });
    }

    async getMultiPropertySubscriptions(): Promise<MultiPropertySubscription[]> {
        const snapshot = await this.db.collection("multi_property_subscriptions")
            .orderBy("createdAt", "desc")
            .get();
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return { ...data, id: data.id || doc.id } as MultiPropertySubscription;
        });
    }

    async createMultiPropertySubscription(data: InsertMultiPropertySubscription): Promise<MultiPropertySubscription> {
        const id = `MULTI-${Date.now()}`;
        const normalizedData = this.enforceSubscriptionDurationLimit(data);
        const record: MultiPropertySubscription = {
            id,
            ...normalizedData,
            createdAt: toRiyadhISO(getNowInRiyadh()),
        } as MultiPropertySubscription;
        await this.db.collection("multi_property_subscriptions").doc(id).set(record);
        return record;
    }

    async updateMultiPropertySubscription(id: string, updates: Partial<MultiPropertySubscription>): Promise<void> {
        const normalizedUpdates = this.enforceSubscriptionDurationLimit(updates);
        await this.db.collection("multi_property_subscriptions").doc(id).update(normalizedUpdates);
    }

    async deleteMultiPropertySubscription(id: string): Promise<void> {
        await this.db.collection("multi_property_subscriptions").doc(id).delete();
    }

    /** Alias for addVerificationLog — kept for backward compatibility with existing route code */
    async addVerificationLogToSheet(log: any): Promise<void> {
        return this.addVerificationLog(log);
    }

    async updateAllSubscriptionsRemainingDays(
        updates: Array<{ propertyNumber: string; remainingDays: number }>
    ): Promise<number> {
        const batch = this.db.batch();
        let count = 0;
        for (const update of updates) {
            const snapshot = await this.db.collection("subscriptions")
                .where("propertyNumber", "==", update.propertyNumber)
                .where("status", "in", ["نشط", "نشط مجاني", "ساري"])
                .get();
            for (const doc of snapshot.docs) {
                batch.update(doc.ref, { remainingDays: update.remainingDays, updatedAt: new Date().toISOString() });
                count++;
            }
        }
        await batch.commit();
        return count;
    }

    // ================== الباقات (Packages) ==================

    private normalizeSubscriptionPackage<T extends Record<string, any>>(pkg: T): T | null {
        const duration = normalizeSubscriptionPackageDuration(
            pkg.duration ?? pkg.durationDays,
        );
        if (duration === null) return null;
        return { ...pkg, duration, durationDays: duration };
    }

    async getPackages(): Promise<Package[]> {
        const snapshot = await this.db.collection("packages").where("isActive", "==", true).get();
        const packages = snapshot.docs
            .map((doc) => {
                const data = { ...doc.data(), id: doc.data().id || doc.id } as Package;
                const normalized = this.normalizeSubscriptionPackage(data);
                if (!normalized || !isPurchasableSubscriptionPackage(normalized)) {
                    console.warn(`[SUBSCRIPTION_CAP] Ignoring unavailable package ${data.id}`);
                    return null;
                }
                return normalized as Package;
            })
            .filter((pkg): pkg is Package => pkg !== null);

        // إزالة التكرار بناءً على الـ ID (لضمان عدم وجود أخطاء في واجهة المستخدم)
        return Array.from(new Map(packages.map(pkg => [pkg.id, pkg])).values());
    }

    async getPackageById(id: string): Promise<Package | null> {
        const doc = await this.db.collection("packages").doc(id).get();
        if (!doc.exists) return null;
        const data = { ...doc.data(), id: doc.data()?.id || doc.id } as Package;
        const normalized = this.normalizeSubscriptionPackage(data);
        if (!normalized) {
            console.warn(`[SUBSCRIPTION_CAP] Invalid package duration for ${data.id}`);
            return null;
        }
        return normalized;
    }

    async getPurchasablePackageById(id: string): Promise<Package | null> {
        const pkg = await this.getPackageById(id);
        if (!pkg || !isPurchasableSubscriptionPackage(pkg)) {
            console.warn(`[SUBSCRIPTION_CAP] Blocked unavailable package ${id}`);
            return null;
        }
        return pkg;
    }

    async createPackage(pkg: InsertPackage): Promise<Package> {
        const normalizedPackage = this.normalizeSubscriptionPackage(pkg);
        if (!normalizedPackage) {
            throw new RangeError("Subscription package duration must be a positive whole number of days");
        }
        const isActive = pkg.isActive !== false;
        if (!isSubscriptionPackageDurationAllowed(normalizedPackage.duration, isActive)) {
            throw new RangeError(`Active subscription package duration cannot exceed ${MAX_SUBSCRIPTION_DAYS} days`);
        }
        const id = `pkg-${Date.now()}`;
        const newPackage: Package = {
            id,
            ...normalizedPackage,
            isActive,
            createdAt: new Date().toISOString(),
        } as Package;

        await this.db.collection("packages").doc(id).set(newPackage);
        return newPackage;
    }

    async getAllPackages(): Promise<Package[]> {
        const snapshot = await this.db.collection("packages").get();
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return { ...data, id: data.id || doc.id } as Package;
        });
    }

    async updatePackage(id: string, updates: Partial<Package>): Promise<Package | null> {
        const ref = this.db.collection("packages").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return null;
        const existing = { ...doc.data(), id: doc.data()?.id || doc.id } as Package;
        const requestedDuration = Object.prototype.hasOwnProperty.call(updates, "duration")
            ? updates.duration
            : Object.prototype.hasOwnProperty.call(updates, "durationDays")
                ? (updates as any).durationDays
                : existing.duration ?? (existing as any).durationDays;
        const duration = normalizeSubscriptionPackageDuration(requestedDuration);
        if (duration === null) {
            throw new RangeError("Subscription package duration must be a positive whole number of days");
        }
        const isActive = Object.prototype.hasOwnProperty.call(updates, "isActive")
            ? updates.isActive === true
            : existing.isActive !== false;
        if (!isSubscriptionPackageDurationAllowed(duration, isActive)) {
            throw new RangeError(`Active subscription package duration cannot exceed ${MAX_SUBSCRIPTION_DAYS} days`);
        }
        const normalizedUpdates: Partial<Package> & { durationDays: number } = {
            ...updates,
            duration,
            durationDays: duration,
            isActive,
        };
        await ref.update(normalizedUpdates);
        return { ...existing, ...normalizedUpdates } as Package;
    }

    async deletePackage(id: string): Promise<boolean> {
        const ref = this.db.collection("packages").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return false;
        await ref.delete();
        return true;
    }

    // ================== المدفوعات (Payments) ==================

    async getPayments(): Promise<Payment[]> {
        const snapshot = await this.db.collection("payments").orderBy("createdAt", "desc").get();
        return snapshot.docs.map((doc) => doc.data() as Payment);
    }

    async getPaymentById(id: string): Promise<Payment | null> {
        const doc = await this.db.collection("payments").doc(id).get();
        return doc.exists ? (doc.data() as Payment) : null;
    }

    /**
     * Repair the display status of a payment whose fulfillment marker or
     * subscription ownership proves that its main activation write landed.
     * This intentionally does not manufacture a fulfillment token/state for a
     * possibly partial linked-property retry; it only removes the stale
     * pending status atomically after checking the subscription.
     */
    async reconcileAppliedPaymentStatus(id: string): Promise<boolean> {
        const paymentRef = this.db.collection("payments").doc(id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) return false;
            const payment = paymentDoc.data() as Payment;
            const subscriptionSnapshot = await transaction.get(
                this.db
                    .collection("subscriptions")
                    .where("propertyNumber", "==", payment.propertyNumber),
            );
            const subscription = this.selectLatestSubscription(
                subscriptionSnapshot.docs,
            );
            const hasLinkedGroup =
                Boolean(payment.secondPropertyNumber) ||
                this.hasNonEmptyPropertyList(payment.additionalProperties) ||
                this.hasNonEmptyPropertyList(payment.linkedProperties) ||
                Boolean(subscription?.linkedProperty) ||
                this.hasNonEmptyPropertyList(subscription?.linkedProperties);
            const safeLegacySinglePropertyMatch =
                payment.fulfillmentState === undefined &&
                !payment.fulfilledAt &&
                subscription?.paymentId === payment.id &&
                !hasLinkedGroup;
            const isApplied =
                !!payment.fulfilledAt ||
                payment.fulfillmentState === "fulfilled" ||
                safeLegacySinglePropertyMatch;
            if (!isApplied) return false;

            if (payment.status !== "مكتمل") {
                transaction.update(paymentRef, {
                    status: "مكتمل",
                    completedAt:
                        payment.completedAt ||
                        payment.fulfilledAt ||
                        new Date().toISOString(),
                });
            }
            return true;
        });
    }

    async claimPaymentFulfillment(
        id: string,
    ): Promise<PaymentFulfillmentClaimResult>;
    async claimPaymentFulfillment(
        id: string,
        allowedStatuses: string[],
        options: { purpose: "queue" },
    ): Promise<QueuePaymentFulfillmentClaimResult>;
    async claimPaymentFulfillment(
        id: string,
        allowedStatuses: string[],
        options?: { purpose?: "fulfill" | "reject" },
    ): Promise<GuardedPaymentFulfillmentClaimResult>;
    async claimPaymentFulfillment(
        id: string,
        allowedStatuses?: string[],
        options: PaymentFulfillmentClaimOptions = {},
    ): Promise<QueuePaymentFulfillmentClaimResult> {
        const ref = this.db.collection("payments").doc(id);
        const now = Date.now();
        const token = `FULFILL-${now}-${Math.random().toString(36).slice(2, 10)}`;
        const staleAfterMs = 10 * 60 * 1000;

        return this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(ref);
            if (!doc.exists) throw new Error("Payment not found");
            const payment = doc.data() as Payment;
            if (payment.fulfilledAt || payment.fulfillmentState === "fulfilled") {
                if (payment.status !== "مكتمل") {
                    transaction.update(ref, {
                        status: "مكتمل",
                        completedAt:
                            payment.completedAt ||
                            payment.fulfilledAt ||
                            new Date(now).toISOString(),
                    });
                }
                return { status: "fulfilled" as const };
            }
            // Queuing a verified new property deliberately releases the
            // short-lived fulfillment claim while it waits for an admin. The
            // durable completion marker must therefore participate in the
            // next atomic claim, otherwise two concurrent provider callbacks
            // can both queue and notify the same paid property.
            if (
                options.purpose === "queue" &&
                payment.propertyApprovalQueuedAt &&
                payment.pendingPropertyApproval &&
                String(payment.status || "").trim() === "نجح - قيد التحقق"
            ) {
                return { status: "queued" as const };
            }
            if (
                allowedStatuses &&
                !allowedStatuses.includes(String(payment.status || ""))
            ) {
                return {
                    status: "invalid_status" as const,
                    currentStatus: String(payment.status || ""),
                };
            }
            const claimedAt = this.getDateMillis(payment.fulfillmentClaimedAt);
            if (
                payment.fulfillmentState === "processing" &&
                claimedAt > 0 &&
                now - claimedAt < staleAfterMs
            ) {
                return { status: "processing" as const };
            }

            transaction.update(ref, {
                fulfillmentState: "processing",
                fulfillmentClaimedAt: new Date(now).toISOString(),
                fulfillmentClaimToken: token,
            });
            return {
                status: "claimed" as const,
                token,
                previousState: payment.fulfillmentState,
            };
        });
    }

    async completePaymentFulfillment(
        id: string,
        token: string,
        subscriptionId: string,
    ): Promise<void> {
        const ref = this.db.collection("payments").doc(id);
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(ref);
            if (!doc.exists) throw new Error("Payment not found");
            const payment = doc.data() as Payment;
            if (payment.fulfilledAt || payment.fulfillmentState === "fulfilled") {
                if (payment.status !== "مكتمل") {
                    transaction.update(ref, {
                        status: "مكتمل",
                        completedAt:
                            payment.completedAt ||
                            payment.fulfilledAt ||
                            new Date().toISOString(),
                    });
                }
                return;
            }
            if (
                payment.fulfillmentState !== "processing" ||
                payment.fulfillmentClaimToken !== token
            ) {
                throw new Error("Payment fulfillment claim was lost");
            }

            const completedAt = new Date().toISOString();
            transaction.update(ref, {
                fulfillmentState: "fulfilled",
                fulfilledAt: completedAt,
                fulfilledSubscriptionId: subscriptionId,
                status: "مكتمل",
                completedAt,
                pendingPropertyApproval: false,
            });
        });
    }

    async releasePaymentFulfillment(id: string, token: string): Promise<void> {
        const ref = this.db.collection("payments").doc(id);
        await this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(ref);
            if (!doc.exists) return;
            const payment = doc.data() as Payment;
            if (
                payment.fulfillmentState !== "processing" ||
                payment.fulfillmentClaimToken !== token
            ) return;

            const rejected = new Set(["مرفوض", "rejected"]).has(
                String(payment.status || "").trim().toLowerCase(),
            );
            transaction.update(ref, {
                fulfillmentState: "failed",
                ...(rejected
                    ? {
                        pendingPropertyApproval: false,
                        propertyApprovalQueuedAt: "",
                    }
                    : {}),
            });
        });
    }

    async createPayment(payment: InsertPayment): Promise<Payment> {
        const id = payment.id || `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newPayment: Payment = {
            ...payment,
            id,
            createdAt: toRiyadhISO(getNowInRiyadh()),
            discountAmount: payment.discountAmount || 0,
        } as Payment;

        console.log(`[DEBUG createPayment] Creating payment: id=${id}, propertyNumber="${payment.propertyNumber}", packageId="${payment.packageId}", status="${payment.status}"`);

        const paymentRef = this.db.collection("payments").doc(id);
        await this.db.runTransaction(async (transaction) => {
            if (this.isActionableSubscriptionPayment(newPayment)) {
                const subscriptionSnapshot = await transaction.get(
                    this.db
                        .collection("subscriptions")
                        .where("propertyNumber", "==", newPayment.propertyNumber),
                );
                const subscription = this.selectLatestSubscription(
                    subscriptionSnapshot.docs,
                );
                if (isSubscriptionStatusSuspended(subscription?.status)) {
                    throw new SuspendedSubscriptionWriteError(
                        newPayment.propertyNumber,
                    );
                }
                if (!this.isActionablePaymentAllowedForSubscription(
                    this.getSubscriptionPaymentAction(newPayment),
                    subscription,
                )) {
                    throw new PaymentActionEligibilityError(
                        this.getSubscriptionPaymentAction(newPayment),
                    );
                }
            }
            transaction.set(paymentRef, newPayment);
        });
        
        console.log(`[DEBUG createPayment] ✅ Payment created successfully: ${id} for property: ${payment.propertyNumber}`);
        return newPayment;
    }

    /**
     * Finalize a payment whose provider intention failed before a usable
     * checkout URL existed. The historical method name remains for callers;
     * no property-level reservation is created or released.
     */
    async releasePaymentActionReservation(
        id: string,
        paymentUpdates?: Partial<Payment>,
    ): Promise<boolean> {
        const paymentRef = this.db.collection("payments").doc(id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) return false;
            if (paymentUpdates) {
                transaction.update(paymentRef, {
                    ...paymentUpdates,
                    retryReservationToken: "",
                });
            }
            return true;
        });
    }

    /**
     * Atomically accept a signed provider success before the webhook performs
     * any property or subscription mutation. The route's lookup is only a
     * convenience; this transaction is the authority for the current attempt,
     * amount, transaction, and terminal fulfillment state.
     */
    async acceptSuccessfulPaymentIntention(
        id: string,
        expected: {
            merchantAttemptKey: string;
            transactionId: string;
            paymobOrderId: string;
            amountCents: number;
            currency: string;
        },
        details: Partial<Payment>,
    ): Promise<
        | { status: "accepted"; payment: Payment }
        | { status: "already_accepted"; payment: Payment }
        | { status: "already_processed"; payment: Payment }
        | {
            status: "rejected";
            reason:
                | "not_found"
                | "stale_attempt"
                | "attempt_identity_conflict"
                | "provider_order_conflict"
                | "legacy_identity_conflict"
                | "amount_or_currency_mismatch"
                | "transaction_conflict"
                | "terminal_failure";
        }
    > {
        const paymentRef = this.db.collection("payments").doc(id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) {
                return { status: "rejected" as const, reason: "not_found" as const };
            }
            const payment = paymentDoc.data() as Payment;
            const expectedAttemptKey = String(
                expected?.merchantAttemptKey || "",
            ).trim();
            const expectedTransactionId = String(
                expected?.transactionId || "",
            ).trim();
            const expectedPaymobOrderId = String(
                expected?.paymobOrderId || "",
            ).trim();
            const expectedAmountCents = Number(expected?.amountCents);
            const expectedCurrency = String(expected?.currency || "")
                .trim()
                .toUpperCase();

            if (payment.merchantAttemptKey) {
                const currentPaymobOrderId = String(
                    payment.paymobOrderId || "",
                ).trim();
                let matchedPersistedPaymobOrder = false;
                if (expectedPaymobOrderId) {
                    const orderMatches = await transaction.get(
                        this.db
                            .collection("payments")
                            .where("paymobOrderId", "==", expectedPaymobOrderId),
                    );
                    if (orderMatches.docs.some((candidate) => candidate.id !== id)) {
                        return {
                            status: "rejected" as const,
                            reason: "provider_order_conflict" as const,
                        };
                    }
                    if (
                        currentPaymobOrderId &&
                        currentPaymobOrderId !== expectedPaymobOrderId
                    ) {
                        return {
                            status: "rejected" as const,
                            reason: "provider_order_conflict" as const,
                        };
                    }
                    matchedPersistedPaymobOrder =
                        currentPaymobOrderId === expectedPaymobOrderId;
                } else if (currentPaymobOrderId) {
                    return {
                        status: "rejected" as const,
                        reason: "provider_order_conflict" as const,
                    };
                }

                if (
                    expectedAttemptKey &&
                    payment.merchantAttemptKey !== expectedAttemptKey
                ) {
                    return {
                        status: "rejected" as const,
                        reason: "stale_attempt" as const,
                    };
                }
                if (!expectedAttemptKey && !matchedPersistedPaymobOrder) {
                    return {
                        status: "rejected" as const,
                        reason: "stale_attempt" as const,
                    };
                }
                // special_reference is the only local identifier retained by
                // some live Paymob intention callbacks. Recheck uniqueness in
                // the authoritative transaction so an accidental duplicate or
                // concurrent write can never select an arbitrary payment.
                if (expectedAttemptKey) {
                    const attemptMatches = await transaction.get(
                        this.db
                            .collection("payments")
                            .where("merchantAttemptKey", "==", expectedAttemptKey),
                    );
                    if (
                        attemptMatches.docs.length !== 1 ||
                        attemptMatches.docs[0].id !== id
                    ) {
                        return {
                            status: "rejected" as const,
                            reason: "attempt_identity_conflict" as const,
                        };
                    }
                }
            } else {
                // Legacy callbacks have no attempt key. Recheck their unique,
                // HMAC-covered Paymob order id inside the same transaction so
                // a concurrent duplicate cannot make a stale route lookup safe.
                if (expectedAttemptKey || !expectedPaymobOrderId) {
                    return {
                        status: "rejected" as const,
                        reason: "legacy_identity_conflict" as const,
                    };
                }
                const legacyMatches = await transaction.get(
                    this.db
                        .collection("payments")
                        .where("paymobOrderId", "==", expectedPaymobOrderId),
                );
                const exactLegacyMatches = legacyMatches.docs.filter(
                    (candidate) => {
                        const candidatePayment = candidate.data() as Payment;
                        return !candidatePayment.merchantAttemptKey;
                    },
                );
                if (
                    exactLegacyMatches.length !== 1 ||
                    exactLegacyMatches[0].id !== id
                ) {
                    return {
                        status: "rejected" as const,
                        reason: "legacy_identity_conflict" as const,
                    };
                }
            }

            const finalAmount = Number(payment.finalAmount);
            if (
                !Number.isSafeInteger(expectedAmountCents) ||
                !Number.isFinite(finalAmount) ||
                expectedAmountCents !== Math.round(finalAmount * 100) ||
                expectedCurrency !== "SAR"
            ) {
                return {
                    status: "rejected" as const,
                    reason: "amount_or_currency_mismatch" as const,
                };
            }

            const status = String(payment.status || "").trim().toLowerCase();
            const completedStatuses = new Set([
                "مكتمل",
                "completed",
            ]);
            // `processing` is a recoverable claim, not a terminal outcome.
            // An exact signed replay must be allowed to return accepted /
            // already_accepted so the caller can reclaim a stale fulfillment
            // and finish the idempotent property writes.
            if (
                payment.fulfilledAt ||
                payment.fulfillmentState === "fulfilled" ||
                completedStatuses.has(status)
            ) {
                return { status: "already_processed" as const, payment };
            }
            const currentTransactionId = String(payment.transactionId || "").trim();
            const currentIntentionId = String(payment.paymentReference || "").trim();
            if (
                !expectedTransactionId ||
                (
                    currentTransactionId &&
                    currentTransactionId !== currentIntentionId &&
                    currentTransactionId !== expectedTransactionId
                )
            ) {
                return {
                    status: "rejected" as const,
                    reason: "transaction_conflict" as const,
                };
            }
            if (
                payment.intentionState === "failed" ||
                new Set(["مرفوض", "rejected", "cancelled", "canceled"])
                    .has(status)
            ) {
                return {
                    status: "rejected" as const,
                    reason: "terminal_failure" as const,
                };
            }
            if (
                currentTransactionId === expectedTransactionId &&
                Boolean(payment.completedAt)
            ) {
                // The financial write committed but verification/activation may
                // have crashed afterwards. Callers can resume the idempotent
                // fulfillment path without accepting or notifying twice.
                return { status: "already_accepted" as const, payment };
            }

            const acceptedAt = new Date().toISOString();
            const acceptedUpdates: Partial<Payment> = {
                ...details,
                status: "نجح - قيد التحقق",
                completedAt: details.completedAt || acceptedAt,
                transactionId: expectedTransactionId,
                ...(expectedPaymobOrderId
                    ? { paymobOrderId: expectedPaymobOrderId }
                    : {}),
            };
            transaction.update(paymentRef, acceptedUpdates);
            return {
                status: "accepted" as const,
                payment: {
                    ...payment,
                    ...acceptedUpdates,
                } as Payment,
            };
        });
    }

    /**
     * Store a recoverable business-activation reason without allowing a slow
     * callback to roll a concurrently fulfilled payment back to pending.
     */
    async recordPaidPaymentActivationPending(
        id: string,
        expectedTransactionId: string,
        notes: string,
    ): Promise<boolean> {
        const paymentRef = this.db.collection("payments").doc(id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) return false;
            const payment = paymentDoc.data() as Payment;
            if (
                !expectedTransactionId ||
                String(payment.transactionId || "").trim() !==
                    String(expectedTransactionId).trim() ||
                !payment.completedAt ||
                payment.fulfilledAt ||
                payment.fulfillmentState === "fulfilled" ||
                String(payment.status || "").trim() === "مكتمل"
            ) {
                return false;
            }
            transaction.update(paymentRef, {
                status: "نجح - قيد التحقق",
                notes,
            });
            return true;
        });
    }

    /**
     * Atomically settle a signed add-on transaction callback. Provider
     * identity must already be bound locally before checkout is exposed; a
     * callback can never claim an unbound payment/order. Success is terminal,
     * while a failed transaction keeps the exact attempt reserved so a later
     * success from the same checkout can supersede it.
     */
    async settleAddOnPaymentCallback(
        id: string,
        expected: {
            merchantAttemptKey: string;
            transactionId: string;
            paymobOrderId: string;
            amountCents: number;
            currency: string;
            success: boolean;
        },
        successDetails: Partial<Payment> = {},
        options: {
            recordReconciliationHistory?: boolean;
            expectedIntentionId?: string;
        } = {},
    ): Promise<
        | { status: "accepted_success"; payment: Payment }
        | { status: "recorded_failure"; payment: Payment }
        | { status: "already_processed"; payment: Payment }
        | {
            status: "rejected";
            reason:
                | "not_found"
                | "not_addon"
                | "identity_conflict"
                | "amount_or_currency_mismatch"
                | "terminal_state";
        }
    > {
        const paymentRef = this.db.collection("payments").doc(id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) {
                return { status: "rejected" as const, reason: "not_found" as const };
            }
            const payment = paymentDoc.data() as Payment;
            if (payment.id && payment.id !== id) {
                return {
                    status: "rejected" as const,
                    reason: "identity_conflict" as const,
                };
            }
            if (payment.action !== "addon") {
                return { status: "rejected" as const, reason: "not_addon" as const };
            }

            const expectedAttemptKey = String(
                expected?.merchantAttemptKey || "",
            ).trim();
            const expectedTransactionId = String(
                expected?.transactionId || "",
            ).trim();
            const expectedPaymobOrderId = String(
                expected?.paymobOrderId || "",
            ).trim();
            const expectedAmountCents = Number(expected?.amountCents);
            const expectedCurrency = String(expected?.currency || "")
                .trim()
                .toUpperCase();
            const currentAttemptKey = String(
                payment.merchantAttemptKey || "",
            ).trim();
            const currentPaymobOrderId = String(
                payment.paymobOrderId || "",
            ).trim();
            const expectedIntentionId = String(
                options.expectedIntentionId || "",
            ).trim();
            const currentIntentionId = String(
                payment.paymentReference || "",
            ).trim();
            if (
                !expectedAttemptKey ||
                !expectedTransactionId ||
                !expectedPaymobOrderId ||
                !currentAttemptKey ||
                !currentPaymobOrderId ||
                currentAttemptKey !== expectedAttemptKey ||
                currentPaymobOrderId !== expectedPaymobOrderId ||
                (expectedIntentionId &&
                    currentIntentionId !== expectedIntentionId) ||
                payment.intentionState !== "created"
            ) {
                return {
                    status: "rejected" as const,
                    reason: "identity_conflict" as const,
                };
            }

            const attemptMatches = await transaction.get(
                this.db
                    .collection("payments")
                    .where("merchantAttemptKey", "==", expectedAttemptKey),
            );
            if (
                attemptMatches.docs.length !== 1 ||
                attemptMatches.docs[0].id !== id
            ) {
                return {
                    status: "rejected" as const,
                    reason: "identity_conflict" as const,
                };
            }

            const orderMatches = await transaction.get(
                this.db
                    .collection("payments")
                    .where("paymobOrderId", "==", expectedPaymobOrderId),
            );
            if (
                orderMatches.docs.length !== 1 ||
                orderMatches.docs[0].id !== id
            ) {
                return {
                    status: "rejected" as const,
                    reason: "identity_conflict" as const,
                };
            }

            const finalAmount = Number(payment.finalAmount);
            if (
                !Number.isSafeInteger(expectedAmountCents) ||
                !Number.isFinite(finalAmount) ||
                expectedAmountCents !== Math.round(finalAmount * 100) ||
                expectedCurrency !== "SAR"
            ) {
                return {
                    status: "rejected" as const,
                    reason: "amount_or_currency_mismatch" as const,
                };
            }

            const currentStatus = String(payment.status || "").trim().toLowerCase();
            const successfulStatuses = new Set([
                "مكتمل",
                "نجح",
                "نجح - قيد التحقق",
                "مدفوع",
                "paid",
                "success",
                "successful",
                "completed",
            ]);
            if (
                payment.completedAt ||
                payment.fulfilledAt ||
                payment.fulfillmentState === "processing" ||
                payment.fulfillmentState === "fulfilled" ||
                successfulStatuses.has(currentStatus)
            ) {
                return { status: "already_processed" as const, payment };
            }
            if (
                new Set([
                    "مرفوض",
                    "ملغي",
                    "rejected",
                    "cancelled",
                    "canceled",
                ]).has(currentStatus)
            ) {
                return {
                    status: "rejected" as const,
                    reason: "terminal_state" as const,
                };
            }

            const settledAt = new Date().toISOString();
            if (!expected.success) {
                const failureUpdates: Partial<Payment> = {
                    status: "فشل",
                    paymobOrderId: expectedPaymobOrderId,
                    lastFailedTransactionId: expectedTransactionId,
                    lastProviderFailureAt: settledAt,
                    intentionState:
                        payment.intentionState === "created"
                            ? "created"
                            : "unknown",
                };
                transaction.update(paymentRef, failureUpdates);
                return {
                    status: "recorded_failure" as const,
                    payment: { ...payment, ...failureUpdates } as Payment,
                };
            }

            const successUpdates: Partial<Payment> = {
                ...successDetails,
                status: "نجح - قيد التحقق",
                paymobOrderId: expectedPaymobOrderId,
                transactionId: expectedTransactionId,
                completedAt: successDetails.completedAt || settledAt,
            };

            let reconciliationHistoryRef:
                | ReturnType<ReturnType<typeof this.db.collection>["doc"]>
                | undefined;
            if (options.recordReconciliationHistory) {
                reconciliationHistoryRef = this.db
                    .collection("addon_history")
                    .doc(`AH-PAYMOB-RECON-${id}`);
                const existingHistory = await transaction.get(
                    reconciliationHistoryRef,
                );
                if (existingHistory.exists) {
                    const history = existingHistory.data() as AddOnHistory;
                    if (
                        history.propertyNumber !== payment.propertyNumber ||
                        history.addOnPackageId !== payment.packageId ||
                        history.action !== "pending" ||
                        history.createdBy !== "system"
                    ) {
                        return {
                            status: "rejected" as const,
                            reason: "identity_conflict" as const,
                        };
                    }
                }
            }

            transaction.update(paymentRef, successUpdates);
            if (reconciliationHistoryRef) {
                const totalFees = Number(successDetails.totalFees || 0);
                transaction.set(reconciliationHistoryRef, {
                    id: reconciliationHistoryRef.id,
                    propertyNumber: payment.propertyNumber,
                    addOnPackageId: payment.packageId,
                    action: "pending",
                    notes:
                        `تم استلام الدفع الإلكتروني بنجاح - المبلغ: ${payment.finalAmount} ر.س` +
                        ` - الرسوم: ${totalFees} ر.س - بانتظار مراجعة الإدارة`,
                    timestamp: settledAt,
                    createdBy: "system",
                    createdAt: settledAt,
                });
            }
            return {
                status: "accepted_success" as const,
                payment: { ...payment, ...successUpdates } as Payment,
            };
        });
    }

    /**
     * Record a failed transaction callback without abandoning its Paymob
     * intention. A checkout can emit a failed transaction and later a
     * successful transaction for the same intention, so provider identity is
     * retained for exact reconciliation without locking any property.
     */
    async finalizeFailedPaymentIntention(
        id: string,
        expected: {
            merchantAttemptKey: string;
            transactionId: string;
            paymobOrderId: string;
            amountCents: number;
            currency: string;
        },
    ): Promise<boolean> {
        const paymentRef = this.db.collection("payments").doc(id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) return false;
            const payment = paymentDoc.data() as Payment;
            const expectedAttemptKey = String(
                expected?.merchantAttemptKey || "",
            ).trim();
            const expectedTransactionId = String(
                expected?.transactionId || "",
            ).trim();
            const expectedPaymobOrderId = String(
                expected?.paymobOrderId || "",
            ).trim();
            const expectedAmountCents = Number(expected?.amountCents);
            const expectedCurrency = String(expected?.currency || "")
                .trim()
                .toUpperCase();
            if (!expectedTransactionId) return false;
            if (payment.merchantAttemptKey) {
                const currentPaymobOrderId = String(
                    payment.paymobOrderId || "",
                ).trim();
                let matchedPersistedPaymobOrder = false;
                if (expectedPaymobOrderId) {
                    const orderMatches = await transaction.get(
                        this.db
                            .collection("payments")
                            .where("paymobOrderId", "==", expectedPaymobOrderId),
                    );
                    if (orderMatches.docs.some((candidate) => candidate.id !== id)) {
                        return false;
                    }
                    if (
                        currentPaymobOrderId &&
                        currentPaymobOrderId !== expectedPaymobOrderId
                    ) {
                        return false;
                    }
                    matchedPersistedPaymobOrder =
                        currentPaymobOrderId === expectedPaymobOrderId;
                } else if (currentPaymobOrderId) {
                    return false;
                }

                if (expectedAttemptKey) {
                    if (payment.merchantAttemptKey !== expectedAttemptKey) {
                        return false;
                    }
                    const attemptMatches = await transaction.get(
                        this.db
                            .collection("payments")
                            .where("merchantAttemptKey", "==", expectedAttemptKey),
                    );
                    if (
                        attemptMatches.docs.length !== 1 ||
                        attemptMatches.docs[0].id !== id
                    ) {
                        return false;
                    }
                } else if (!matchedPersistedPaymobOrder) {
                    return false;
                }
            } else {
                if (expectedAttemptKey || !expectedPaymobOrderId) return false;
                const legacyMatches = await transaction.get(
                    this.db
                        .collection("payments")
                        .where("paymobOrderId", "==", expectedPaymobOrderId),
                );
                const exactLegacyMatches = legacyMatches.docs.filter(
                    (candidate) =>
                        !(candidate.data() as Payment).merchantAttemptKey,
                );
                if (
                    exactLegacyMatches.length !== 1 ||
                    exactLegacyMatches[0].id !== id
                ) return false;
            }

            const finalAmount = Number(payment.finalAmount);
            if (
                !Number.isSafeInteger(expectedAmountCents) ||
                !Number.isFinite(finalAmount) ||
                expectedAmountCents !== Math.round(finalAmount * 100) ||
                expectedCurrency !== "SAR"
            ) {
                return false;
            }

            const currentTransactionId = String(payment.transactionId || "").trim();
            const currentIntentionId = String(payment.paymentReference || "").trim();
            // Before settlement transactionId historically stored the Paymob
            // intention id. Once a transaction callback has been persisted, a
            // different transaction must never be allowed to finalize it.
            if (
                currentTransactionId &&
                currentTransactionId !== currentIntentionId &&
                currentTransactionId !== expectedTransactionId
            ) {
                return false;
            }

            const status = String(payment.status || "").trim().toLowerCase();
            const successfulStatuses = new Set([
                "مكتمل",
                "نجح",
                "نجح - قيد التحقق",
                "مدفوع",
                "paid",
                "success",
                "successful",
                "completed",
                "processing",
            ]);
            if (
                payment.completedAt ||
                payment.fulfilledAt ||
                payment.fulfillmentState === "processing" ||
                payment.fulfillmentState === "fulfilled" ||
                successfulStatuses.has(status)
            ) {
                return false;
            }
            transaction.update(paymentRef, {
                status: "فشل",
                ...(expectedPaymobOrderId
                    ? { paymobOrderId: expectedPaymobOrderId }
                    : {}),
                // "failed" is reserved for a definitively abandoned or
                // rejected intention. This callback settles one transaction,
                // not necessarily the whole checkout intention.
                intentionState:
                    payment.intentionState === "created"
                        ? "created"
                        : "unknown",
                lastFailedTransactionId: expectedTransactionId,
                lastProviderFailureAt: new Date().toISOString(),
            });
            return true;
        });
    }

    async reservePaymentActionForRetry(id: string): Promise<{
        token: string;
        subscription: Subscription | null;
        merchantAttemptKey: string;
    }> {
        const paymentRef = this.db.collection("payments").doc(id);
        const now = Date.now();
        const token = `RETRY-${now}-${Math.random().toString(36).slice(2, 10)}`;
        const merchantAttemptKey = `RWQN-RETRY-${now}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const staleAfterMs = 10 * 60 * 1000;

        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) throw new Error("Payment not found");
            const payment = paymentDoc.data() as Payment;
            if (!this.isActionableSubscriptionPayment(payment)) {
                throw new PaymentRetryNotAllowedError();
            }
            if (!this.isPaymentEligibleForNewIntention(payment)) {
                throw new PaymentRetryNotAllowedError();
            }
            if (
                payment.fulfilledAt ||
                payment.fulfillmentState === "fulfilled" ||
                payment.fulfillmentState === "processing" ||
                payment.fulfillmentState === "failed"
            ) {
                throw new PaymentActionConflictError();
            }

            const subscriptionSnapshot = await transaction.get(
                this.db
                    .collection("subscriptions")
                    .where("propertyNumber", "==", payment.propertyNumber),
            );
            const subscription = this.selectLatestSubscription(
                subscriptionSnapshot.docs,
            );
            if (isSubscriptionStatusSuspended(subscription?.status)) {
                throw new SuspendedSubscriptionWriteError(
                    payment.propertyNumber,
                );
            }
            if (!this.isActionablePaymentAllowedForSubscription(
                this.getSubscriptionPaymentAction(payment),
                subscription,
            )) {
                throw new PaymentActionEligibilityError(
                    this.getSubscriptionPaymentAction(payment),
                );
            }
            const retryReservedAt = this.getDateMillis(payment.retryReservationAt);
            if (
                payment.retryReservationToken &&
                retryReservedAt > 0 &&
                now - retryReservedAt < staleAfterMs
            ) {
                throw new PaymentActionConflictError();
            }

            transaction.update(paymentRef, {
                retryReservationToken: token,
                retryReservationAt: new Date(now).toISOString(),
                merchantAttemptKey,
                paymobOrderId: "",
                paymentReference: "",
                transactionId: "",
                paymentCheckoutUrl: "",
                providerReconciledAt: "",
                providerPaidAt: "",
                providerLastCheckedAt: "",
                providerReconciliationStartedAt: "",
                providerReconciliationClaimToken: "",
            });
            return { token, subscription, merchantAttemptKey };
        });
    }

    async completePaymentActionRetryReservation(
        id: string,
        token: string,
        updates: Partial<Payment>,
    ): Promise<void> {
        const paymentRef = this.db.collection("payments").doc(id);
        await this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) throw new Error("Payment not found");
            const payment = paymentDoc.data() as Payment;
            if (payment.retryReservationToken !== token) {
                throw new PaymentActionConflictError();
            }

            transaction.update(paymentRef, {
                ...updates,
                retryReservationToken: "",
            });
        });
    }

    async releasePaymentActionRetryReservation(
        id: string,
        token: string,
        paymentUpdates?: Partial<Payment>,
    ): Promise<boolean> {
        const paymentRef = this.db.collection("payments").doc(id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) return false;
            const payment = paymentDoc.data() as Payment;
            if (payment.retryReservationToken !== token) return false;
            transaction.update(paymentRef, {
                ...(paymentUpdates || {}),
                retryReservationToken: "",
            });
            return true;
        });
    }

    async updatePayment(id: string, updates: Partial<Payment>): Promise<Payment> {
        const ref = this.db.collection("payments").doc(id);
        await ref.update(updates);
        const doc = await ref.get();
        return doc.data() as Payment;
    }

    async getPaymentsByProperty(propertyNumber: string): Promise<Payment[]> {
        console.log(`[DEBUG getPaymentsByProperty] Querying for propertyNumber: "${propertyNumber}"`);
        const snapshot = await this.db.collection("payments")
            .where("propertyNumber", "==", propertyNumber)
            .get();
        const payments = snapshot.docs.map((doc) => {
            const data = doc.data() as Payment;
            console.log(`[DEBUG getPaymentsByProperty] Found payment: ${data.id}, propertyNumber: "${data.propertyNumber}", status: ${data.status}, packageId: ${data.packageId}`);
            return data;
        });
        console.log(`[DEBUG getPaymentsByProperty] Total payments found for "${propertyNumber}": ${payments.length}`);
        return payments.sort((a, b) => {
            const byTime =
                this.getDateMillis(b.createdAt || b.completedAt) -
                this.getDateMillis(a.createdAt || a.completedAt);
            if (byTime !== 0) return byTime;
            return String(b.id || "").localeCompare(String(a.id || ""));
        });
    }

    // ================== الطلبات (Requests) ==================

    async createRequest(request: InsertRequest, requestCountFromIP?: number): Promise<Request> {
        const id = `REQ-${Date.now()}`;
        const newRequest: Request = {
            id,
            ...request,
            ...(requestCountFromIP !== undefined ? { requestCountFromIP } : {}),
            timestamp: new Date().toISOString(), // Changed from createdAt to timestamp
        } as Request;

        await this.db.collection("requests").doc(id).set(newRequest);
        return newRequest;
    }

    async getRequests(): Promise<Request[]> {
        const snapshot = await this.db.collection("requests").orderBy("timestamp", "desc").get();
        return snapshot.docs.map((doc) => doc.data() as Request);
    }

    async deleteRequest(propertyNumber: string, requestId: string): Promise<void> {
        const snapshot = await this.db.collection("requests")
            .where("propertyNumber", "==", propertyNumber)
            .get();
        
        for (const doc of snapshot.docs) {
            const data = doc.data() as Request;
            if (data.id === requestId || data.requestCode === requestId) {
                await doc.ref.delete();
                return;
            }
        }
        throw new Error("الطلب غير موجود");
    }

    async createContactEvent(event: InsertContactEvent): Promise<ContactEvent> {
        const id = `CONTACT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newEvent: ContactEvent = {
            id,
            ...event,
            timestamp: new Date().toISOString(),
        };

        await this.db.collection("contact_events").doc(id).set(newEvent);
        return newEvent;
    }

    async createContactRequestWithCooldown(
        key: string,
        propertyNumber: string,
        cooldownMs: number,
        request: InsertRequest,
        requestCountFromIP: number,
        event: InsertContactEvent,
        ipAbuseLimit?: {
            key: string;
            windowMs: number;
            maxAcceptedRequests: number;
        },
        dailyPropertyLimit?: {
            key: string;
            windowStartedAt: number;
            windowEndsAt: number;
            maxAcceptedRequests: number;
        },
    ): Promise<
        | {
            accepted: false;
            remainingMs: number;
            reason: "cooldown" | "ip_limit" | "daily_property_limit";
        }
        | { accepted: true; remainingMs: 0; request: Request; event: ContactEvent }
    > {
        const cooldownRef = this.db.collection("contact_cooldowns").doc(key);
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const requestId = `REQ-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const eventId = `CONTACT-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const requestRef = this.db.collection("requests").doc(requestId);
        const eventRef = this.db.collection("contact_events").doc(eventId);
        const ipLimitRef = ipAbuseLimit
            ? this.db.collection("contact_ip_rate_limits").doc(ipAbuseLimit.key)
            : null;
        const dailyPropertyLimitRef = dailyPropertyLimit
            ? this.db.collection("contact_property_daily_limits").doc(dailyPropertyLimit.key)
            : null;

        return this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(cooldownRef);
            const lastAcceptedAt = doc.exists
                ? this.getDateMillis(doc.data()?.lastAcceptedAt)
                : 0;
            const elapsed = now - lastAcceptedAt;
            if (lastAcceptedAt > 0 && elapsed < cooldownMs) {
                return {
                    accepted: false,
                    remainingMs: cooldownMs - elapsed,
                    reason: "cooldown",
                } as const;
            }

            let ipWindowStartedAt = now;
            let ipAcceptedCount = 0;
            if (ipLimitRef && ipAbuseLimit) {
                const ipLimitDoc = await transaction.get(ipLimitRef);
                const ipLimitData = ipLimitDoc.data();
                const previousWindowStart = Number(ipLimitData?.windowStartedAt || 0);
                const inCurrentWindow = previousWindowStart > 0
                    && now - previousWindowStart < ipAbuseLimit.windowMs;
                ipWindowStartedAt = inCurrentWindow ? previousWindowStart : now;
                ipAcceptedCount = inCurrentWindow ? Number(ipLimitData?.acceptedCount || 0) : 0;

                if (ipAcceptedCount >= ipAbuseLimit.maxAcceptedRequests) {
                    return {
                        accepted: false,
                        remainingMs: Math.max(
                            1,
                            ipAbuseLimit.windowMs - (now - ipWindowStartedAt),
                        ),
                        reason: "ip_limit",
                    } as const;
                }
            }

            let dailyAcceptedCount = 0;
            if (dailyPropertyLimitRef && dailyPropertyLimit) {
                const dailyLimitDoc = await transaction.get(dailyPropertyLimitRef);
                const dailyLimitData = dailyLimitDoc.data();
                const storedWindowStart = Number(dailyLimitData?.windowStartedAt || 0);
                const sameWindow = storedWindowStart === dailyPropertyLimit.windowStartedAt;
                dailyAcceptedCount = sameWindow
                    ? Number(dailyLimitData?.acceptedCount || 0)
                    : 0;

                if (dailyAcceptedCount >= dailyPropertyLimit.maxAcceptedRequests) {
                    return {
                        accepted: false,
                        remainingMs: Math.max(1, dailyPropertyLimit.windowEndsAt - now),
                        reason: "daily_property_limit",
                    } as const;
                }
            }

            const newRequest: Request = {
                id: requestId,
                ...request,
                requestCountFromIP,
                timestamp,
            } as Request;
            const newEvent: ContactEvent = {
                id: eventId,
                ...event,
                timestamp,
            };

            transaction.set(cooldownRef, {
                propertyNumber,
                lastAcceptedAt: now,
                updatedAt: timestamp,
                // Can be enabled as a Firestore TTL field; no raw IP or phone is stored.
                expiresAt: new Date(now + cooldownMs * 2),
            });
            if (ipLimitRef && ipAbuseLimit) {
                transaction.set(ipLimitRef, {
                    windowStartedAt: ipWindowStartedAt,
                    acceptedCount: ipAcceptedCount + 1,
                    updatedAt: timestamp,
                    expiresAtTtl: new Date(ipWindowStartedAt + ipAbuseLimit.windowMs * 2),
                });
            }
            if (dailyPropertyLimitRef && dailyPropertyLimit) {
                transaction.set(dailyPropertyLimitRef, {
                    propertyNumber,
                    windowStartedAt: dailyPropertyLimit.windowStartedAt,
                    windowEndsAt: dailyPropertyLimit.windowEndsAt,
                    acceptedCount: dailyAcceptedCount + 1,
                    updatedAt: timestamp,
                    expiresAtTtl: new Date(dailyPropertyLimit.windowEndsAt + 24 * 60 * 60 * 1000),
                });
            }
            transaction.set(requestRef, newRequest);
            transaction.set(eventRef, newEvent);

            return {
                accepted: true,
                remainingMs: 0,
                request: newRequest,
                event: newEvent,
            } as const;
        });
    }

    async getContactEvents(): Promise<ContactEvent[]> {
        const snapshot = await this.db.collection("contact_events").orderBy("timestamp", "desc").get();
        return snapshot.docs.map((doc) => doc.data() as ContactEvent);
    }

    // ================== Remembered Contact Identity Sessions ==================

    async getContactIdentitySession(id: string): Promise<ContactIdentitySession | null> {
        const doc = await this.db.collection("contact_identity_sessions").doc(id).get();
        return doc.exists ? (doc.data() as ContactIdentitySession) : null;
    }

    async replaceContactIdentitySession(
        session: ContactIdentitySession,
        previousId?: string,
    ): Promise<void> {
        const collection = this.db.collection("contact_identity_sessions");
        const batch = this.db.batch();
        batch.set(collection.doc(session.id), session);
        if (previousId && previousId !== session.id) {
            batch.delete(collection.doc(previousId));
        }
        await batch.commit();
    }

    async consumeContactIdentityIssueLimit(
        id: string,
        now: number,
        windowMs: number,
        maxIssues: number,
    ): Promise<{ allowed: true; retryAfterMs: 0 } | { allowed: false; retryAfterMs: number }> {
        const ref = this.db.collection("contact_identity_issue_limits").doc(id);

        return this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(ref);
            const data = doc.data();
            const previousWindowStart = Number(data?.windowStartedAt || 0);
            const inCurrentWindow = previousWindowStart > 0 && now - previousWindowStart < windowMs;
            const windowStartedAt = inCurrentWindow ? previousWindowStart : now;
            const issueCount = inCurrentWindow ? Number(data?.issueCount || 0) : 0;

            if (issueCount >= maxIssues) {
                return {
                    allowed: false,
                    retryAfterMs: Math.max(1, windowMs - (now - windowStartedAt)),
                } as const;
            }

            transaction.set(ref, {
                windowStartedAt,
                issueCount: issueCount + 1,
                updatedAt: new Date(now).toISOString(),
                expiresAtTtl: new Date(windowStartedAt + windowMs * 2),
            });
            return { allowed: true, retryAfterMs: 0 } as const;
        });
    }

    async consumeContactRequestAttemptLimit(
        id: string,
        now: number,
        windowMs: number,
        maxAttempts: number,
    ): Promise<{ allowed: true; retryAfterMs: 0 } | { allowed: false; retryAfterMs: number }> {
        const ref = this.db.collection("contact_request_attempt_limits").doc(id);

        return this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(ref);
            const data = doc.data();
            const previousWindowStart = Number(data?.windowStartedAt || 0);
            const inCurrentWindow = previousWindowStart > 0 && now - previousWindowStart < windowMs;
            const windowStartedAt = inCurrentWindow ? previousWindowStart : now;
            const attemptCount = inCurrentWindow ? Number(data?.attemptCount || 0) : 0;

            if (attemptCount >= maxAttempts) {
                return {
                    allowed: false,
                    retryAfterMs: Math.max(1, windowMs - (now - windowStartedAt)),
                } as const;
            }

            transaction.set(ref, {
                windowStartedAt,
                attemptCount: attemptCount + 1,
                updatedAt: new Date(now).toISOString(),
                expiresAtTtl: new Date(windowStartedAt + windowMs * 2),
            });
            return { allowed: true, retryAfterMs: 0 } as const;
        });
    }

    async consumeAdminLoginAttemptLimit(
        id: string,
        now: number,
        windowMs: number,
        maxAttempts: number,
    ): Promise<{ allowed: true; retryAfterMs: 0 } | { allowed: false; retryAfterMs: number }> {
        const ref = this.db.collection("admin_login_attempt_limits").doc(id);

        return this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(ref);
            const data = doc.data();
            const previousWindowStart = Number(data?.windowStartedAt || 0);
            const inCurrentWindow = previousWindowStart > 0 && now - previousWindowStart < windowMs;
            const windowStartedAt = inCurrentWindow ? previousWindowStart : now;
            const attemptCount = inCurrentWindow ? Number(data?.attemptCount || 0) : 0;

            if (attemptCount >= maxAttempts) {
                return {
                    allowed: false,
                    retryAfterMs: Math.max(1, windowMs - (now - windowStartedAt)),
                } as const;
            }

            transaction.set(ref, {
                windowStartedAt,
                attemptCount: attemptCount + 1,
                updatedAt: new Date(now).toISOString(),
                expiresAtTtl: new Date(windowStartedAt + windowMs * 2),
            });
            return { allowed: true, retryAfterMs: 0 } as const;
        });
    }

    async deleteAdminLoginAttemptLimit(id: string): Promise<void> {
        await this.db.collection("admin_login_attempt_limits").doc(id).delete();
    }

    async deleteContactIdentitySession(id: string): Promise<void> {
        await this.db.collection("contact_identity_sessions").doc(id).delete();
    }

    async deleteExpiredEphemeralSecurityData(referenceDate: Date = new Date()): Promise<number> {
        const collectionNames = [
            "contact_identity_sessions",
            "contact_identity_issue_limits",
            "contact_request_attempt_limits",
            "contact_ip_rate_limits",
            "admin_login_attempt_limits",
        ];
        const batchSize = 400;
        let deleted = 0;

        for (const collectionName of collectionNames) {
            while (true) {
                const snapshot = await this.db.collection(collectionName)
                    .where("expiresAtTtl", "<=", referenceDate)
                    .limit(batchSize)
                    .get();
                if (snapshot.empty) break;

                const batch = this.db.batch();
                snapshot.docs.forEach((doc) => batch.delete(doc.ref));
                await batch.commit();
                deleted += snapshot.size;
                if (snapshot.size < batchSize) break;
            }
        }

        return deleted;
    }

    // ================== أكواد الخصم ==================

    async getDiscountCodes(): Promise<DiscountCode[]> {
        const snapshot = await this.db.collection("discounts").where("isActive", "==", true).get();
        return snapshot.docs.map((doc) => doc.data() as DiscountCode);
    }

    async getAllDiscountCodes(): Promise<DiscountCode[]> {
        const snapshot = await this.db.collection("discounts").get();
        return snapshot.docs.map((doc) => doc.data() as DiscountCode);
    }

    async updateDiscountCode(code: string, updates: Partial<DiscountCode>): Promise<DiscountCode | null> {
        const ref = this.db.collection("discounts").doc(code);
        await ref.update(updates);
        const doc = await ref.get();
        return doc.exists ? (doc.data() as DiscountCode) : null;
    }

    async getDiscountCodeByCode(code: string): Promise<DiscountCode | null> {
        const snapshot = await this.db.collection("discounts").where("code", "==", code).limit(1).get();
        if (!snapshot.empty) return snapshot.docs[0].data() as DiscountCode;
        // fallback: try by doc ID
        const doc = await this.db.collection("discounts").doc(code).get();
        return doc.exists ? (doc.data() as DiscountCode) : null;
    }

    async createDiscountCode(data: Partial<DiscountCode>): Promise<DiscountCode> {
        const code = (data.code || `DC-${Date.now()}`).toUpperCase();
        const discount = { id: code, ...data, code, createdAt: new Date().toISOString() } as DiscountCode;
        await this.db.collection("discounts").doc(code).set(discount);
        return discount;
    }

    async deleteDiscountCode(code: string): Promise<void> {
        await this.db.collection("discounts").doc(code).delete();
    }

    // ================== الاقتراحات (Suggestions) ==================

    async getSuggestions(): Promise<any[]> {
        const snapshot = await this.db.collection("suggestions").orderBy("createdAt", "desc").get();
        return snapshot.docs.map(doc => doc.data());
    }

    async createSuggestion(data: any): Promise<any> {
        const id = `SUG-${Date.now()}`;
        const suggestion = { id, ...data, createdAt: new Date().toISOString() };
        await this.db.collection("suggestions").doc(id).set(suggestion);
        return suggestion;
    }

    // ================== المدونة (Blog Posts) ==================

    async getBlogPosts(onlyPublished: boolean = false): Promise<any[]> {
        try {
            let snapshot;
            if (onlyPublished) {
                // Use only where() to avoid requiring a composite index
                snapshot = await this.db.collection("blog_posts").where("status", "==", "منشور").get();
            } else {
                snapshot = await this.db.collection("blog_posts").get();
            }
            const posts = snapshot.docs.map(doc => doc.data());
            // Sort in JS instead of Firestore to avoid composite index requirement
            return posts.sort((a: any, b: any) => {
                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return dateB - dateA;
            });
        } catch (err: any) {
            console.error("getBlogPosts error:", err?.message);
            return [];
        }
    }

    async getBlogPostBySlug(slug: string): Promise<any | null> {
        const snapshot = await this.db.collection("blog_posts").where("slug", "==", slug).limit(1).get();
        return snapshot.empty ? null : snapshot.docs[0].data();
    }

    async getBlogPostById(id: string): Promise<any | null> {
        const doc = await this.db.collection("blog_posts").doc(id).get();
        return doc.exists ? doc.data() : null;
    }

    async createBlogPost(post: any): Promise<string> {
        const id = `BLOG-${Date.now()}`;
        const newPost: any = { id, ...post, createdAt: new Date().toISOString() };
        if (newPost.status === "منشور" && !newPost.publishedAt) {
            newPost.publishedAt = new Date().toISOString();
        }
        await this.db.collection("blog_posts").doc(id).set(newPost);
        return id;
    }

    async updateBlogPost(id: string, updates: any): Promise<boolean> {
        const ref = this.db.collection("blog_posts").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return false;
        const data: any = { ...updates, updatedAt: new Date().toISOString() };
        if (data.status === "منشور" && !doc.data()?.publishedAt) {
            data.publishedAt = new Date().toISOString();
        }
        await ref.update(data);
        return true;
    }

    async deleteBlogPost(id: string): Promise<boolean> {
        const ref = this.db.collection("blog_posts").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return false;
        await ref.delete();
        return true;
    }

    // ================== SEO العقارات (Property SEO) ==================

    async getPropertySeo(propertyNumber: string): Promise<any | null> {
        const doc = await this.db.collection("property_seo").doc(propertyNumber).get();
        return doc.exists ? doc.data() : null;
    }

    async updatePropertySeo(propertyNumber: string, seoData: any): Promise<any> {
        const ref = this.db.collection("property_seo").doc(propertyNumber);
        const now = new Date().toISOString();
        const data = { ...seoData, propertyNumber, updatedAt: now };
        await ref.set(data, { merge: true });
        return data;
    }

    // ================== إضافات العقارات (Property Add-ons) ==================

    async getPropertyAddOns(propertyNumber: string): Promise<PropertyAddOn[]> {
        const snapshot = await this.db.collection("property_addons")
            .where("propertyNumber", "==", propertyNumber)
            .get();
        return snapshot.docs.map(doc => doc.data() as PropertyAddOn);
    }

    async getAllPropertyAddOns(): Promise<PropertyAddOn[]> {
        const snapshot = await this.db.collection("property_addons").get();
        return snapshot.docs.map(doc => doc.data() as PropertyAddOn);
    }

    async getPropertyAddOnById(id: string): Promise<PropertyAddOn | null> {
        const doc = await this.db.collection("property_addons").doc(id).get();
        return doc.exists ? (doc.data() as PropertyAddOn) : null;
    }

    /**
     * Apply an admin add-on decision as one compare-and-set operation. Modern
     * add-ons are linked only through their persisted paymentId; property and
     * package equality can validate that link, but can never discover it.
     */
    async applyAdminPropertyAddOnDecision(params: {
        addonId: string;
        paymentId?: string;
        decision: "approve" | "reject";
        mode: AdminPropertyAddOnDecisionMode;
        startDate?: string;
        endDate?: string;
    }): Promise<AdminPropertyAddOnDecisionResult> {
        const addonRef = this.db.collection("property_addons").doc(params.addonId);
        const paymentRef = params.paymentId
            ? this.db.collection("payments").doc(params.paymentId)
            : null;
        const now = new Date().toISOString();

        return this.db.runTransaction(async (transaction) => {
            const addonDoc = await transaction.get(addonRef);
            if (!addonDoc.exists) {
                return { status: "rejected" as const, reason: "not_found" as const };
            }
            const addon = addonDoc.data() as PropertyAddOn;
            const linkedPaymentId = String(addon.paymentId || "").trim();
            const requestedPaymentId = String(params.paymentId || "").trim();
            if (linkedPaymentId !== requestedPaymentId) {
                return {
                    status: "rejected" as const,
                    reason: "link_conflict" as const,
                };
            }

            let payment: Payment | null = null;
            if (paymentRef) {
                const paymentDoc = await transaction.get(paymentRef);
                if (!paymentDoc.exists) {
                    return {
                        status: "rejected" as const,
                        reason: "payment_not_found" as const,
                    };
                }
                payment = paymentDoc.data() as Payment;
                if (
                    payment.id !== requestedPaymentId ||
                    payment.action !== "addon" ||
                    payment.propertyNumber !== addon.propertyNumber ||
                    payment.packageId !== addon.addOnPackageId
                ) {
                    return {
                        status: "rejected" as const,
                        reason: "link_conflict" as const,
                    };
                }
            }

            const targetStatus = params.decision === "approve" ? "active" : "rejected";
            if (addon.status === targetStatus) {
                return { status: "already_applied" as const, addon };
            }
            if (addon.status !== "pending") {
                return {
                    status: "rejected" as const,
                    reason: "not_pending" as const,
                };
            }

            if (params.mode === "settled_paymob") {
                const intentionId = String(payment?.paymentReference || "").trim();
                const transactionId = String(payment?.transactionId || "").trim();
                const exactPaymentMethod = getExactPaymobPaymentMethod({
                    paymentMethod: payment?.paymentMethod,
                });
                const successfulStatuses = new Set<string>([
                    "نجح - قيد التحقق",
                    "مكتمل",
                    "completed",
                    "نجح",
                    "نجاح",
                ]);
                const hasCompleteSettlement = Boolean(
                    payment &&
                    payment.merchantAttemptKey &&
                    intentionId &&
                    payment.paymentCheckoutUrl &&
                    payment.paymobOrderId &&
                    payment.intentionState === "created" &&
                    transactionId &&
                    transactionId !== intentionId &&
                    payment.completedAt &&
                    exactPaymentMethod &&
                    successfulStatuses.has(String(payment.status || "").trim()),
                );
                if (params.decision !== "approve" || !hasCompleteSettlement) {
                    return {
                        status: "rejected" as const,
                        reason: "unsafe_provider_state" as const,
                    };
                }
            } else if (params.mode === "bank_transfer") {
                const bankMethods = new Set<string>([
                    "تحويل بنكي",
                    "bank_transfer",
                    "bank transfer",
                ]);
                const pendingStatuses = new Set<string>([
                    "قيد المراجعة",
                    "pending",
                ]);
                const hasProviderIdentity = Boolean(
                    payment?.merchantAttemptKey ||
                    payment?.paymentCheckoutUrl ||
                    payment?.paymobOrderId ||
                    payment?.intentionState,
                );
                const receiptUrl = String(
                    payment?.receiptUrl || addon.receiptUrl || "",
                ).trim();
                if (
                    !payment ||
                    (addon.source !== "bank" && addon.source !== "bank_transfer") ||
                    hasProviderIdentity ||
                    !bankMethods.has(String(payment.paymentMethod || "").trim()) ||
                    !receiptUrl ||
                    !pendingStatuses.has(String(payment.status || "").trim())
                ) {
                    return {
                        status: "rejected" as const,
                        reason: "unsafe_bank_state" as const,
                    };
                }
            } else {
                const defensibleAdminSource =
                    !payment &&
                    !linkedPaymentId &&
                    (
                        addon.source === "admin" ||
                        addon.source === "system" ||
                        (
                            (addon.source === "bank" ||
                                addon.source === "bank_transfer") &&
                            Boolean(String(addon.receiptUrl || "").trim())
                        )
                    );
                if (!defensibleAdminSource) {
                    return {
                        status: "rejected" as const,
                        reason: "unsafe_legacy_state" as const,
                    };
                }
            }

            const addonUpdates: Partial<PropertyAddOn> = params.decision === "approve"
                ? {
                    status: "active",
                    startDate: params.startDate || now,
                    ...(params.endDate ? { endDate: params.endDate } : {}),
                    updatedAt: now,
                }
                : { status: "rejected", updatedAt: now };
            const historyRef = this.db
                .collection("addon_history")
                .doc(
                    `AH-ADMIN-${params.decision === "approve" ? "APPROVE" : "REJECT"}-${params.addonId}`,
                );
            const historyDoc = await transaction.get(historyRef);

            transaction.update(addonRef, addonUpdates);
            if (paymentRef && payment) {
                transaction.update(paymentRef, {
                    status: params.decision === "approve"
                        ? "مكتمل"
                        : "ملغي",
                    completedAt: payment.completedAt || now,
                });
            }
            if (!historyDoc.exists) {
                transaction.set(historyRef, {
                    id: historyRef.id,
                    propertyNumber: addon.propertyNumber,
                    addOnPackageId: addon.addOnPackageId,
                    action: params.decision === "approve" ? "activated" : "rejected",
                    notes: params.decision === "approve"
                        ? "تم التفعيل بعد تحقق الإدارة من وسيلة الدفع المرتبطة"
                        : "تم رفض الطلب بعد تحقق الإدارة من وسيلة الدفع المرتبطة",
                    timestamp: now,
                    createdBy: "admin",
                });
            }

            return {
                status: "applied" as const,
                addon: { ...addon, ...addonUpdates } as PropertyAddOn,
            };
        });
    }

    /**
     * Cancel the pre-created pending add-on only when Paymob definitively
     * rejected intention creation and no provider checkout identity exists.
     */
    async cancelRejectedAddOnIntentionCreation(
        paymentId: string,
        addonId: string,
    ): Promise<boolean> {
        const paymentRef = this.db.collection("payments").doc(paymentId);
        const addonRef = this.db.collection("property_addons").doc(addonId);
        const now = new Date().toISOString();
        return this.db.runTransaction(async (transaction) => {
            const [paymentDoc, addonDoc] = await Promise.all([
                transaction.get(paymentRef),
                transaction.get(addonRef),
            ]);
            if (!paymentDoc.exists || !addonDoc.exists) return false;
            const payment = paymentDoc.data() as Payment;
            const addon = addonDoc.data() as PropertyAddOn;
            const safeInitialStatuses = new Set<string>([
                "قيد الدفع",
                "فشل",
            ]);
            if (
                payment.id !== paymentId ||
                payment.action !== "addon" ||
                addon.id !== addonId ||
                addon.paymentId !== paymentId ||
                addon.propertyNumber !== payment.propertyNumber ||
                addon.addOnPackageId !== payment.packageId ||
                addon.status !== "pending" ||
                !safeInitialStatuses.has(String(payment.status || "").trim()) ||
                !new Set(["creating", "failed"]).has(
                    String(payment.intentionState || "creating"),
                ) ||
                Boolean(
                    payment.paymentReference ||
                    payment.transactionId ||
                    payment.paymentCheckoutUrl ||
                    payment.paymobOrderId ||
                    payment.completedAt,
                )
            ) {
                return false;
            }

            const historyRef = this.db
                .collection("addon_history")
                .doc(`AH-PAYMOB-CREATE-FAILED-${addonId}`);
            const historyDoc = await transaction.get(historyRef);

            transaction.update(paymentRef, {
                status: "فشل",
                intentionState: "failed",
                providerCreationFailedAt: now,
            });
            transaction.update(addonRef, {
                status: "cancelled",
                cancellationReason: "paymob_intention_rejected",
                updatedAt: now,
            });
            if (!historyDoc.exists) {
                transaction.set(historyRef, {
                    id: historyRef.id,
                    propertyNumber: addon.propertyNumber,
                    addOnPackageId: addon.addOnPackageId,
                    action: "cancelled",
                    notes: "أُلغي الطلب لأن Paymob رفض إنشاء عملية الدفع قبل إصدار رابط الدفع",
                    timestamp: now,
                    createdBy: "system",
                });
            }
            return true;
        });
    }

    async createPropertyAddOn(addon: InsertPropertyAddOn): Promise<PropertyAddOn> {
        const id = addon.id || `ADDON-${Date.now()}`;
        const newAddon = {
            id,
            ...addon,
            status: addon.status || "pending",
            source: addon.source || "admin",
            createdAt: new Date().toISOString()
        } as PropertyAddOn;
        await this.db.collection("property_addons").doc(id).set(newAddon);
        return newAddon;
    }

    async updatePropertyAddOn(id: string, updates: Partial<PropertyAddOn>): Promise<PropertyAddOn | null> {
        const ref = this.db.collection("property_addons").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return null;

        const updatedData = { ...updates, updatedAt: new Date().toISOString() };
        await ref.update(updatedData);
        const updatedDoc = await ref.get();
        return updatedDoc.data() as PropertyAddOn;
    }

    async cancelPropertyAddOn(addonId: string, reason?: string): Promise<PropertyAddOn | null> {
        const ref = this.db.collection("property_addons").doc(addonId);
        const doc = await ref.get();
        if (!doc.exists) return null;
        const updates: Partial<PropertyAddOn> = {
            status: "cancelled",
            updatedAt: new Date().toISOString(),
            ...(reason ? { cancellationReason: reason } : {}),
        };
        await ref.update(updates);
        const updatedDoc = await ref.get();
        return updatedDoc.data() as PropertyAddOn;
    }

    // ================== باقات الإضافات (Add-on Packages) ==================

    async getAddOnPackages(): Promise<AddOnPackage[]> {
        const snapshot = await this.db.collection("addon_packages").get();
        return snapshot.docs.map(doc => doc.data() as AddOnPackage);
    }

    async getAddOnPackageById(id: string): Promise<AddOnPackage | null> {
        const doc = await this.db.collection("addon_packages").doc(id).get();
        return doc.exists ? (doc.data() as AddOnPackage) : null;
    }

    async createAddOnPackage(data: InsertAddOnPackage): Promise<AddOnPackage> {
        const id = `APKG-${Date.now()}`;
        const pkg: AddOnPackage = {
            id,
            ...data,
            createdAt: new Date().toISOString(),
        };
        await this.db.collection("addon_packages").doc(id).set(pkg);
        return pkg;
    }

    async updateAddOnPackage(id: string, updates: Partial<AddOnPackage>): Promise<AddOnPackage | null> {
        const ref = this.db.collection("addon_packages").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return null;
        await ref.update({ ...updates, updatedAt: new Date().toISOString() });
        const updatedDoc = await ref.get();
        return updatedDoc.data() as AddOnPackage;
    }

    // ================== إعدادات الرسوم ==================

    async getFeeConfigs(): Promise<FeeConfig[]> {
        const snapshot = await this.db.collection("fee_configs").get();
        return snapshot.docs.map((doc) => doc.data() as FeeConfig);
    }

    async getFeeConfigById(id: string): Promise<FeeConfig | null> {
        const doc = await this.db.collection("fee_configs").doc(id).get();
        return doc.exists ? (doc.data() as FeeConfig) : null;
    }

    async createFeeConfig(data: Partial<FeeConfig>): Promise<FeeConfig> {
        const id = `FEE-${Date.now()}`;
        const config = { id, ...data, createdAt: new Date().toISOString() } as FeeConfig;
        await this.db.collection("fee_configs").doc(id).set(config);
        return config;
    }

    async updateFeeConfig(id: string, updates: Partial<FeeConfig>): Promise<FeeConfig | null> {
        const ref = this.db.collection("fee_configs").doc(id);
        await ref.update(updates);
        const doc = await ref.get();
        return doc.exists ? (doc.data() as FeeConfig) : null;
    }

    async deleteFeeConfig(id: string): Promise<void> {
        await this.db.collection("fee_configs").doc(id).delete();
    }

    async initializeFeeConfigs(): Promise<void> { return; }

    async removeDuplicateFeeConfigs(): Promise<{ removed: number }> {
        const snapshot = await this.db.collection("fee_configs").get();
        const seen = new Map<string, string>();
        let removed = 0;
        for (const doc of snapshot.docs) {
            const key = doc.data().key || doc.id;
            if (seen.has(key)) {
                await doc.ref.delete();
                removed++;
            } else {
                seen.set(key, doc.id);
            }
        }
        return { removed };
    }

    calculatePaymentFees(amount: number, paymentMethod: string, cardType?: string): any {
        // Paymob fee defaults — override via getFeeConfigs() if needed
        const rate = paymentMethod === "card" ? 0.028 : 0.02;
        const feeAmount = Math.round(amount * rate * 100) / 100;
        const vatAmount = Math.round(feeAmount * 0.15 * 100) / 100;
        const totalFees = Math.round((feeAmount + vatAmount) * 100) / 100;
        return { feeAmount, vatAmount, totalFees, merchantFees: feeAmount, acqFees: 0, netAmount: amount - totalFees };
    }

    async calculatePaymentFeesFromConfigs(amount: number, paymentMethod: string, cardType?: string): Promise<any> {
        return this.calculatePaymentFees(amount, paymentMethod, cardType);
    }

    // ================== التكاليف ==================

    async getExpenses(): Promise<Expense[]> {
        const snapshot = await this.db.collection("expenses").get();
        return snapshot.docs.map((doc) => doc.data() as Expense);
    }

    async createExpense(expense: InsertExpense): Promise<Expense> {
        const id = `EXP-${Date.now()}`;
        const newExpense: Expense = {
            id,
            ...expense,
            createdAt: new Date().toISOString(),
        } as Expense;
        await this.db.collection("expenses").doc(id).set(newExpense);
        return newExpense;
    }

    async getExpenseById(id: string): Promise<Expense | null> {
        const doc = await this.db.collection("expenses").doc(id).get();
        return doc.exists ? (doc.data() as Expense) : null;
    }

    async updateExpense(id: string, updates: Partial<Expense>): Promise<Expense> {
        const ref = this.db.collection("expenses").doc(id);
        await ref.update(updates);
        const doc = await ref.get();
        return doc.data() as Expense;
    }

    async deleteExpense(id: string): Promise<void> {
        await this.db.collection("expenses").doc(id).delete();
    }

    async getTotalExpenses(startDate?: string, endDate?: string): Promise<number> {
        const expenses = await this.getExpenses();
        return expenses.reduce((sum, e) => {
            if (!e.isActive) return sum;
            const d = e.date || e.createdAt || "";
            if (startDate && d < startDate) return sum;
            if (endDate && d > endDate) return sum;
            return sum + (e.amount || 0);
        }, 0);
    }

    // ================== الحسابات البنكية (Bank Accounts) ==================

    async getBankAccounts(): Promise<BankAccount[]> {
        const snapshot = await this.db.collection("bank_accounts").get();
        return snapshot.docs.map(doc => doc.data() as BankAccount);
    }

    async getActiveBankAccounts(): Promise<BankAccount[]> {
        const snapshot = await this.db.collection("bank_accounts").where("isActive", "==", true).get();
        return snapshot.docs.map(doc => doc.data() as BankAccount);
    }

    async getDefaultBankAccount(): Promise<BankAccount | null> {
        const snapshot = await this.db.collection("bank_accounts").where("isDefault", "==", true).limit(1).get();
        if (!snapshot.empty) return snapshot.docs[0].data() as BankAccount;
        const all = await this.getActiveBankAccounts();
        return all[0] || null;
    }

    async addBankAccount(data: Partial<BankAccount>): Promise<BankAccount> {
        const id = `BA-${Date.now()}`;
        const account = { id, ...data, createdAt: new Date().toISOString() } as BankAccount;
        await this.db.collection("bank_accounts").doc(id).set(account);
        return account;
    }

    async updateBankAccount(id: string, updates: Partial<BankAccount>): Promise<BankAccount> {
        const ref = this.db.collection("bank_accounts").doc(id);
        await ref.update(updates);
        const doc = await ref.get();
        return doc.data() as BankAccount;
    }

    async deleteBankAccount(id: string): Promise<void> {
        await this.db.collection("bank_accounts").doc(id).delete();
    }

    // ================== أعلام الميزات (Feature Flags) ==================

    async getFeatureFlags(): Promise<FeatureFlag[]> {
        const snapshot = await this.db.collection("feature_flags").get();
        return snapshot.docs.map(doc => doc.data() as FeatureFlag);
    }

    async getFeatureFlag(key: string): Promise<boolean> {
        const snapshot = await this.db.collection("feature_flags").where("key", "==", key).limit(1).get();
        return snapshot.empty ? false : (snapshot.docs[0].data().isEnabled ?? false);
    }

    async updateFeatureFlag(key: string, isEnabled: boolean): Promise<void> {
        const snapshot = await this.db.collection("feature_flags").where("key", "==", key).limit(1).get();
        if (!snapshot.empty) {
            await snapshot.docs[0].ref.update({ isEnabled, updatedAt: new Date().toISOString() });
        } else {
            const id = `FLAG-${Date.now()}`;
            await this.db.collection("feature_flags").doc(id).set({
                id, key, isEnabled, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            });
        }
    }

    async initializeFeatureFlags(): Promise<void> {
        // No-op for Firebase - flags are created on first update
        return;
    }

    // ================== أرباح الشريك (Partner Profits) ==================

    async getPartnerProfits(): Promise<PartnerProfit[]> {
        const snapshot = await this.db.collection("partner_profits").orderBy("monthYear", "desc").get();
        return snapshot.docs.map(doc => doc.data() as PartnerProfit);
    }

    async createPartnerProfit(profit: InsertPartnerProfit): Promise<PartnerProfit> {
        const id = `PP-${Date.now()}`;
        const newProfit: PartnerProfit = {
            id,
            ...profit,
            createdAt: new Date().toISOString(),
        } as PartnerProfit;
        await this.db.collection("partner_profits").doc(id).set(newProfit);
        return newProfit;
    }

    async updatePartnerProfit(id: string, updates: Partial<PartnerProfit>): Promise<PartnerProfit | null> {
        const ref = this.db.collection("partner_profits").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return null;
        await ref.update({ ...updates, updatedAt: new Date().toISOString() });
        const updatedDoc = await ref.get();
        return updatedDoc.data() as PartnerProfit;
    }

    async calculateMonthlyProfits(): Promise<{
        monthYear: string;
        activeSubscriptions: number;
        totalRevenue: number;
        partnerShare: number;
        payments: any[];
    }> {
        const now = getNowInRiyadh();
        const monthYear = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}`;

        const payments = await this.getPayments();
        const startOfMonth = getStartOfMonthRiyadh(now);
        const endOfMonth = getEndOfMonthRiyadh(now);

        const monthlyPayments = payments.filter(p => {
            const paymentDate = new Date(p.createdAt || "");
            return paymentDate >= startOfMonth &&
                paymentDate <= endOfMonth &&
                p.status === "مكتمل";
        });

        const totalRevenue = monthlyPayments.reduce((sum, p) => sum + (p.finalAmount || 0), 0);
        const partnerShare = Math.round(totalRevenue * 0.5 * 100) / 100;

        return {
            monthYear,
            activeSubscriptions: monthlyPayments.length,
            totalRevenue,
            partnerShare,
            payments: monthlyPayments,
        };
    }

    // ================== التكاليف وإحصائيات الأرباح ==================

    calculateMonthlyExpenses(expenses: Expense[], monthStr: string): number {
        let total = 0;
        const [year, month] = monthStr.split('-').map(Number);
        const targetMonthStart = new Date(year, month - 1, 1);
        const targetMonthEnd = new Date(year, month, 0);

        for (const expense of expenses) {
            if (!expense.isActive) continue;

            switch (expense.expenseType) {
                case "مرة واحدة":
                    if (expense.date.startsWith(monthStr)) {
                        total += expense.amount;
                    }
                    break;
                case "شهرية":
                    const expenseDate = new Date(expense.date);
                    if (expenseDate <= targetMonthEnd) {
                        total += expense.amount;
                    }
                    break;
                case "موزعة":
                    if (expense.startDate && expense.endDate && expense.monthlyAmount) {
                        const startDate = new Date(expense.startDate);
                        const endDate = new Date(expense.endDate);
                        if (targetMonthStart >= startDate && targetMonthStart <= endDate) {
                            total += expense.monthlyAmount;
                        }
                    }
                    break;
            }
        }
        return Math.round(total * 100) / 100;
    }

    calculateAllTimeExpenses(expenses: Expense[]): number {
        return expenses.reduce((sum, e) => sum + e.amount, 0);
    }

    async getProfitsSummary(): Promise<any> {
        const payments = await this.getPayments();
        const feeConfigs = await this.getFeeConfigs();
        const expenses = await this.getExpenses();
        const now = getNowInRiyadh();
        const startOfMonth = getStartOfMonthRiyadh(now);

        const completedPayments = payments.filter(p => p.status === "مكتمل");
        const currentMonthPayments = completedPayments.filter(p => {
            const paymentDate = new Date(p.createdAt || "");
            return paymentDate >= startOfMonth;
        });

        const pendingPayments = payments.filter(p =>
            p.status === "قيد المراجعة" || p.status === "معلق" || p.status === "نجح - قيد التحقق"
        ).length;

        const calculateNetProfit = (paymentsList: any[]) => {
            let totalRevenue = 0;
            let totalNetAfterFees = 0;

            for (const p of paymentsList) {
                const amount = p.finalAmount || 0;
                totalRevenue += amount;

                if (p.totalFees !== undefined && p.totalFees > 0) {
                    totalNetAfterFees += (p.netAmount || (amount - p.totalFees));
                } else {
                    // Simplified fallback or precise logic as in GoogleSheets
                    totalNetAfterFees += amount; // Fallback
                }
            }
            return { totalRevenue, totalNetAfterFees };
        };

        const currentMonthCalc = calculateNetProfit(currentMonthPayments);
        const allTimeCalc = calculateNetProfit(completedPayments);

        const currentMonthStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
        const currentMonthTotalExpenses = this.calculateMonthlyExpenses(expenses, currentMonthStr);
        const allTimeTotalExpenses = this.calculateAllTimeExpenses(expenses);

        const currentMonthNetRevenue = currentMonthCalc.totalNetAfterFees || currentMonthCalc.totalRevenue;
        const currentMonthRealProfit = currentMonthNetRevenue - currentMonthTotalExpenses;
        const allTimeNetRevenue = allTimeCalc.totalNetAfterFees || allTimeCalc.totalRevenue;
        const allTimeRealProfit = allTimeNetRevenue - allTimeTotalExpenses;

        return {
            currentMonth: {
                monthYear: `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}`,
                totalRevenue: currentMonthCalc.totalRevenue,
                netRevenue: currentMonthNetRevenue,
                totalExpenses: currentMonthTotalExpenses,
                realProfit: currentMonthRealProfit,
                partnerShare: currentMonthRealProfit > 0 ? currentMonthRealProfit * 0.5 : 0,
                ourShare: currentMonthRealProfit > 0 ? currentMonthRealProfit * 0.5 : 0,
                paymentsCount: currentMonthPayments.length,
                isProfitable: currentMonthRealProfit > 0,
            },
            allTime: {
                totalRevenue: allTimeCalc.totalRevenue,
                netRevenue: allTimeNetRevenue,
                totalExpenses: allTimeTotalExpenses,
                realProfit: allTimeRealProfit,
                partnerShare: allTimeRealProfit > 0 ? allTimeRealProfit * 0.5 : 0,
                ourShare: allTimeRealProfit > 0 ? allTimeRealProfit * 0.5 : 0,
                paymentsCount: completedPayments.length,
                isProfitable: allTimeRealProfit > 0,
            },
            pendingPayments,
            recentPayments: payments.slice(0, 10),
            recentExpenses: expenses.slice(0, 5),
        };
    }

    // ================== Analytics & Logs ==================

    async getAnalytics(): Promise<any> {
        const doc = await this.db.collection("settings").doc("analytics").get();
        return doc.exists ? doc.data() : null;
    }

    async getWhatsAppLogs(): Promise<any[]> {
        const snapshot = await this.db.collection("whatsapp_logs").orderBy("createdAt", "desc").get();
        return snapshot.docs.map(doc => doc.data());
    }

    async addWhatsAppLog(log: any): Promise<void> {
        await this.db.collection("whatsapp_logs").doc(log.id).set(log);
    }

    async getVerificationLogs(): Promise<any[]> {
        const snapshot = await this.db.collection("verification_logs").orderBy("date", "desc").get();
        return snapshot.docs.map(doc => doc.data());
    }

    async addVerificationLog(log: any): Promise<void> {
        await this.db.collection("verification_logs").add(log);
    }

    // ================== Owner & Auth ==================

    async ensureOwnersSheetExists(): Promise<void> {
        // No-op for Firebase
        return;
    }

    async getOwnerByPropertyNumber(propertyNumber: string): Promise<any | null> {
        const doc = await this.db.collection("owners").doc(propertyNumber).get();
        if (!doc.exists) return null;
        const data = doc.data();
        return {
            ownerId: data?.ownerId || propertyNumber,
            phone: data?.phone || "",
            password: data?.password || "",
            resetCode: data?.resetCode || "",
            resetExpire: data?.resetExpire || "",
            lastReset: data?.lastReset || "",
        };
    }

    async getOwnerPhone(propertyNumber: string): Promise<string | null> {
        const owner = await this.getOwnerByPropertyNumber(propertyNumber);
        if (owner?.phone) return owner.phone;

        const property = await this.getPropertyByNumber(propertyNumber);
        return property?.whatsappNumber || null;
    }

    async syncOwnerFromProperties(propertyNumber: string): Promise<void> {
        const property = await this.getPropertyByNumber(propertyNumber);
        if (!property) return;

        const existingOwner = await this.getOwnerByPropertyNumber(propertyNumber);

        if (!existingOwner) {
            const newOwner = {
                ownerId: propertyNumber,
                phone: property.whatsappNumber || "",
                password: property.pin || "",
                resetCode: "",
                resetExpire: "",
                lastReset: "",
            };
            await this.db.collection("owners").doc(propertyNumber).set(newOwner);
            console.log(`✅ Synced owner to Firebase: ${propertyNumber}`);
        }
    }

    async updateOwnerResetCode(propertyNumber: string, code: string, expireTime: string, lastReset: string): Promise<void> {
        await this.db.collection("owners").doc(propertyNumber).update({
            resetCode: code,
            resetExpire: expireTime,
            lastReset: lastReset
        });
    }

    async updateOwnerPassword(propertyNumber: string, newPassword: string): Promise<void> {
        await this.db.collection("owners").doc(propertyNumber).update({
            password: newPassword,
            resetCode: "",
            resetExpire: ""
        });
        // Also update property PIN
        await this.updateProperty(propertyNumber, { pin: newPassword });
    }

    async clearOwnerResetCode(propertyNumber: string): Promise<void> {
        await this.db.collection("owners").doc(propertyNumber).update({
            resetCode: "",
            resetExpire: ""
        });
    }

    async canSendResetCode(propertyNumber: string): Promise<{ canSend: boolean; remainingDays?: number }> {
        const owner = await this.getOwnerByPropertyNumber(propertyNumber);
        if (!owner) return { canSend: false };

        if (!owner.lastReset) return { canSend: true };

        const lastResetDate = new Date(owner.lastReset);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - lastResetDate.getTime()) / (1000 * 60 * 60 * 24));
        const RESET_COOLDOWN_DAYS = 30; // Consistent with Sheets implementation

        if (daysDiff < RESET_COOLDOWN_DAYS) {
            return { canSend: false, remainingDays: RESET_COOLDOWN_DAYS - daysDiff };
        }

        return { canSend: true };
    }

    async validateResetCode(propertyNumber: string, code: string): Promise<{ valid: boolean; message?: string }> {
        const owner = await this.getOwnerByPropertyNumber(propertyNumber);
        if (!owner) return { valid: false, message: "رقم العقار غير موجود" };

        if (!owner.resetCode || owner.resetCode !== code) {
            return { valid: false, message: "رمز التحقق غير صحيح" };
        }

        if (owner.resetExpire) {
            const expireDate = new Date(owner.resetExpire);
            if (new Date() > expireDate) {
                await this.clearOwnerResetCode(propertyNumber);
                return { valid: false, message: "انتهت صلاحية رمز التحقق" };
            }
        }

        return { valid: true };
    }

    // ================== Notification Settings ==================

    async getNotificationSettings(): Promise<NotificationSettings> {
        try {
            const doc = await this.db.collection("settings").doc("notification_settings").get();
            if (doc.exists) {
                return doc.data() as NotificationSettings;
            }
        } catch (err) {
            console.error("Error loading notification settings from Firebase:", err);
        }

        return {
            allNotifications: true,
            newProperty: true,
            newSubscription: true,
            subscriptionRenewal: true,
            receiptUpload: true,
            propertyUpdate: true,
            newPayment: true,
            smartRequest: true,
            propertyVerification: true,
            subscriptionExpired: true,
        };
    }

    async saveNotificationSettings(settings: NotificationSettings): Promise<void> {
        const data = {
            ...settings,
            updatedAt: new Date().toISOString(),
        };
        await this.db.collection("settings").doc("notification_settings").set(data);
    }

    // ================== Expired Add-ons ==================

    async updateExpiredAddOns(): Promise<number> {
        const addons = await this.getAllPropertyAddOns();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let updatedCount = 0;

        for (const addon of addons) {
            if (addon.status !== "active" || !addon.endDate) continue;

            const endDate = new Date(addon.endDate);
            endDate.setHours(0, 0, 0, 0);

            if (endDate < today) {
                await this.updatePropertyAddOn(addon.id, { status: "expired" });
                await this.logAddOnHistory({
                    propertyNumber: addon.propertyNumber,
                    addOnPackageId: addon.addOnPackageId,
                    timestamp: toRiyadhISO(getNowInRiyadh()),
                    action: "expired",
                    notes: "انتهت الإضافة تلقائياً",
                    createdBy: "system",
                });
                updatedCount++;
                console.log(`⏰ [AddOns] تم تحديث حالة الإضافة ${addon.id} إلى منتهي`);
            }
        }

        return updatedCount;
    }

    async logAddOnHistory(entry: InsertAddOnHistory): Promise<void> {
        const id = `AH-${Date.now()}`;
        const log = {
            id,
            ...entry,
            createdAt: new Date().toISOString(),
        };
        await this.db.collection("addon_history").doc(id).set(log);
    }

    // ================== Payment Status ==================

    /**
     * Claim one exact Paymob attempt for a provider-state read. The claim is
     * written before the network call so multiple Cloud Run instances cannot
     * repeatedly query the same checkout in parallel. A signed callback does
     * not depend on this claim and can still settle the payment at any time.
     */
    async claimPaymentProviderReconciliation(
        candidate: Pick<
            Payment,
            | "id"
            | "action"
            | "status"
            | "paymentMethod"
            | "createdAt"
            | "merchantAttemptKey"
            | "intentionState"
            | "paymentReference"
            | "transactionId"
            | "paymobOrderId"
            | "paymentCheckoutUrl"
        >,
        options: {
            checkedAt: string;
            createdBeforeMs: number;
            createdAfterMs: number;
            minIntervalMs: number;
        },
    ): Promise<
        | { claimed: false }
        | { claimed: true; token: string; payment: Payment }
    > {
        const paymentRef = this.db.collection("payments").doc(candidate.id);
        const checkedAtMs = Date.parse(String(options.checkedAt || ""));
        const token = `PAYMOB-CHECK-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) return { claimed: false as const };
            const payment = paymentDoc.data() as Payment;
            const sameValue = (current: unknown, expected: unknown) =>
                String(current ?? "") === String(expected ?? "");

            if (
                !sameValue(payment.action, candidate.action) ||
                !sameValue(payment.status, candidate.status) ||
                !sameValue(payment.paymentMethod, candidate.paymentMethod) ||
                !sameValue(payment.createdAt, candidate.createdAt) ||
                !sameValue(payment.merchantAttemptKey, candidate.merchantAttemptKey) ||
                !sameValue(payment.intentionState, candidate.intentionState) ||
                !sameValue(payment.paymentReference, candidate.paymentReference) ||
                !sameValue(payment.transactionId, candidate.transactionId) ||
                !sameValue(payment.paymobOrderId, candidate.paymobOrderId) ||
                !sameValue(payment.paymentCheckoutUrl, candidate.paymentCheckoutUrl)
            ) {
                return { claimed: false as const };
            }

            const paymentDateMs = Date.parse(String(payment.createdAt || ""));
            if (
                !Number.isFinite(checkedAtMs) ||
                !Number.isFinite(options.createdBeforeMs) ||
                !Number.isFinite(options.createdAfterMs) ||
                !Number.isFinite(options.minIntervalMs) ||
                options.minIntervalMs <= 0 ||
                !Number.isFinite(paymentDateMs) ||
                paymentDateMs >= options.createdBeforeMs ||
                paymentDateMs < options.createdAfterMs ||
                !String(payment.merchantAttemptKey || "").trim() ||
                !String(payment.paymentReference || "").trim() ||
                !String(payment.paymentCheckoutUrl || "").trim()
            ) {
                return { claimed: false as const };
            }

            const recoverableStatuses = new Set([
                "قيد المراجعة",
                "فشل",
                "ملغي - انتهت المهلة",
                "نجح - قيد التحقق",
            ]);
            const paymentStatus = String(payment.status || "").trim();
            const fulfillmentClaimedAtMs = this.getDateMillis(
                payment.fulfillmentClaimedAt,
            );
            // The scheduler must not race an active fulfillment. Once its
            // ten-minute lease is stale, provider reconciliation may replay
            // the exact paid attempt and obtain a fresh fulfillment token.
            const staleProcessingClaim =
                payment.fulfillmentState === "processing" &&
                (
                    fulfillmentClaimedAtMs <= 0 ||
                    checkedAtMs - fulfillmentClaimedAtMs >= 10 * 60 * 1000
                );
            if (
                !(
                    recoverableStatuses.has(paymentStatus) ||
                    (payment.action === "addon" && paymentStatus === "قيد الدفع")
                ) ||
                payment.fulfilledAt ||
                (
                    payment.pendingPropertyApproval &&
                    payment.propertyApprovalQueuedAt
                ) ||
                (
                    payment.fulfillmentState === "processing" &&
                    !staleProcessingClaim
                ) ||
                payment.fulfillmentState === "fulfilled" ||
                (payment.action === "addon" && Boolean(payment.completedAt)) ||
                payment.status === "مكتمل" ||
                payment.status === "completed"
            ) {
                return { claimed: false as const };
            }

            const previousCheckMs = Date.parse(
                String(payment.providerLastCheckedAt || ""),
            );
            if (
                Number.isFinite(previousCheckMs) &&
                previousCheckMs > checkedAtMs - options.minIntervalMs
            ) {
                return { claimed: false as const };
            }

            const claimUpdates: Partial<Payment> = {
                providerLastCheckedAt: options.checkedAt,
                ...(!payment.providerReconciliationStartedAt
                    ? { providerReconciliationStartedAt: options.checkedAt }
                    : {}),
                providerReconciliationClaimToken: token,
            };
            transaction.update(paymentRef, claimUpdates);
            return {
                claimed: true as const,
                token,
                payment: { ...payment, ...claimUpdates } as Payment,
            };
        });
    }

    /**
     * Atomically expire the exact pending payment attempt observed by the
     * scheduler. A scheduler scan is necessarily stale by the time it reaches
     * Firestore, so every eligibility check is repeated inside the transaction
     * before the status is changed.
     *
     * Electronic payments with any unresolved Paymob identity intentionally
     * fail closed. The absence of a webhook is not proof that the card was not
     * charged; those attempts must be reconciled with Paymob instead.
     */
    async expirePendingPaymentIfEligible(
        candidate: Pick<
            Payment,
            | "id"
            | "status"
            | "paymentMethod"
            | "createdAt"
            | "merchantAttemptKey"
            | "intentionState"
            | "paymentReference"
            | "transactionId"
            | "paymobOrderId"
            | "paymentCheckoutUrl"
            | "providerReconciliationClaimToken"
        >,
        kind: "card" | "bank",
        createdBeforeMs: number,
        options: { providerUnpaidClaimToken?: string } = {},
    ): Promise<boolean> {
        const paymentRef = this.db.collection("payments").doc(candidate.id);
        return this.db.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            if (!paymentDoc.exists) return false;

            const payment = paymentDoc.data() as Payment;
            const sameValue = (current: unknown, expected: unknown) =>
                String(current ?? "") === String(expected ?? "");

            // The scheduler may only act on the exact attempt it scanned.
            if (
                !sameValue(payment.status, candidate.status) ||
                !sameValue(payment.paymentMethod, candidate.paymentMethod) ||
                !sameValue(payment.createdAt, candidate.createdAt) ||
                !sameValue(payment.merchantAttemptKey, candidate.merchantAttemptKey) ||
                !sameValue(payment.intentionState, candidate.intentionState) ||
                !sameValue(payment.paymentReference, candidate.paymentReference) ||
                !sameValue(payment.transactionId, candidate.transactionId) ||
                !sameValue(payment.paymobOrderId, candidate.paymobOrderId) ||
                !sameValue(payment.paymentCheckoutUrl, candidate.paymentCheckoutUrl) ||
                !sameValue(
                    payment.providerReconciliationClaimToken,
                    candidate.providerReconciliationClaimToken,
                )
            ) {
                return false;
            }

            const paymentDateMs = Date.parse(String(payment.createdAt || ""));
            if (
                !Number.isFinite(createdBeforeMs) ||
                !Number.isFinite(paymentDateMs) ||
                paymentDateMs >= createdBeforeMs
            ) {
                return false;
            }

            const successfulStatuses = new Set([
                "مكتمل",
                "نجح",
                "نجاح",
                "نجح - قيد التحقق",
                "مدفوع",
                "completed",
                "paid",
                "success",
                "successful",
            ]);
            const normalizedStatus = String(payment.status || "")
                .trim()
                .toLowerCase();
            if (
                successfulStatuses.has(normalizedStatus) ||
                Boolean(payment.completedAt) ||
                Boolean(payment.fulfilledAt) ||
                payment.fulfillmentState === "processing" ||
                payment.fulfillmentState === "fulfilled"
            ) {
                return false;
            }

            if (kind === "card") {
                const normalizedMethod = String(payment.paymentMethod || "")
                    .trim()
                    .toLowerCase();
                const cardMethods = new Set([
                    "بطاقة",
                    "apple pay",
                    "apple_pay",
                    "applepay",
                    "paymob",
                    "card",
                    "cards",
                ]);
                if (
                    payment.status !== "قيد المراجعة" ||
                    !cardMethods.has(normalizedMethod)
                ) {
                    return false;
                }

                const unresolvedIntentionStates = new Set([
                    "creating",
                    "created",
                    "unknown",
                ]);
                const hasUnresolvedProviderAttempt =
                    Boolean(String(payment.merchantAttemptKey || "").trim()) ||
                    unresolvedIntentionStates.has(
                        String(payment.intentionState || "").trim().toLowerCase(),
                    ) ||
                    Boolean(String(payment.paymentReference || "").trim()) ||
                    Boolean(String(payment.transactionId || "").trim()) ||
                    Boolean(String(payment.paymobOrderId || "").trim()) ||
                    Boolean(String(payment.paymentCheckoutUrl || "").trim());
                if (
                    hasUnresolvedProviderAttempt &&
                    (
                        !options.providerUnpaidClaimToken ||
                        options.providerUnpaidClaimToken !==
                            payment.providerReconciliationClaimToken
                    )
                ) return false;

                transaction.update(paymentRef, {
                    status: "ملغي - انتهت المهلة",
                });
                return true;
            }

            if (
                payment.status !== "قيد التحقق" ||
                String(payment.paymentMethod || "").trim() !== "تحويل بنكي"
            ) {
                return false;
            }

            transaction.update(paymentRef, { status: "منتهي الصلاحية" });
            return true;
        });
    }

    async updatePaymentStatus(paymentId: string, newStatus: string): Promise<void> {
        const ref = this.db.collection("payments").doc(paymentId);
        const doc = await ref.get();
        if (!doc.exists) {
            throw new Error(`لم يتم العثور على الدفع: ${paymentId}`);
        }
        await ref.update({ status: newStatus });
        console.log(`✅ Payment status updated → ${paymentId}: ${newStatus}`);
    }

    // ================== OCR Results ==================

    async saveOcrResult(data: InsertOcrResult): Promise<void> {
        const id = data.paymentId || `OCR-${Date.now()}`;
        await this.db.collection("ocr_results").doc(id).set({
            ...data,
            createdAt: toRiyadhISO(getNowInRiyadh()),
        });
        console.log(`✅ [Firebase] OCR result saved for payment: ${id}`);
    }

    async getOcrResultByPaymentId(paymentId: string): Promise<OcrResult | null> {
        const doc = await this.db.collection("ocr_results").doc(paymentId).get();
        return doc.exists ? (doc.data() as OcrResult) : null;
    }

    async getAllOcrResults(): Promise<OcrResult[]> {
        const snapshot = await this.db.collection("ocr_results").get();
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                ...data,
                paymentId: data.paymentId || doc.id,
            } as OcrResult;
        });
    }

    // ================== Parity Dummy Methods ==================
    async initializeSheets(): Promise<void> {
        return;
    }

    async updateAnalyticsRow(): Promise<void> {
        // No-op for Firebase — analytics are queried live from Firestore
        return;
    }

    async updatePaymentFees(transactionId: string, fees: Record<string, number>): Promise<void> {
        const ref = this.db.collection("payments").doc(transactionId);
        await ref.update({ ...fees, updatedAt: new Date().toISOString() });
    }

    async updateSubscriptionLinkedProperty(propertyNumber: string, linkedProperty: string): Promise<void> {
        const snapshot = await this.db.collection("subscriptions")
            .where("propertyNumber", "==", propertyNumber).limit(1).get();
        if (!snapshot.empty) {
            await snapshot.docs[0].ref.update({ linkedProperty, updatedAt: new Date().toISOString() });
        }
    }

    async updateSubscription(id: string, updates: Partial<Subscription>): Promise<void> {
        const normalizedUpdates = this.enforceSubscriptionDurationLimit(updates);
        const subscriptionRef = this.db.collection("subscriptions").doc(id);
        await this.db.runTransaction(async (transaction) => {
            const subscriptionSnapshot = await transaction.get(subscriptionRef);
            if (!subscriptionSnapshot.exists) {
                throw new Error(`Subscription not found: ${id}`);
            }
            const propertyNumber = String(
                subscriptionSnapshot.data()?.propertyNumber || "",
            ).trim();
            if (
                propertyNumber &&
                isSubscriptionStatusSuspended(subscriptionSnapshot.data()?.status)
            ) {
                throw new SuspendedSubscriptionWriteError(propertyNumber);
            }
            transaction.update(subscriptionRef, {
                ...normalizedUpdates,
                updatedAt: new Date().toISOString(),
            });
        });
    }

    /**
     * Expire a subscription only when its current Firestore state is still
     * cancelled or past its end date. The scheduler may be working from an old
     * list snapshot while a payment activation replaces the same document, so
     * the decision and both mirror writes must happen in one transaction.
     */
    async expireSubscriptionIfNeeded(id: string): Promise<boolean> {
        const subscriptionRef = this.db.collection("subscriptions").doc(id);

        return this.db.runTransaction(async (transaction) => {
            const subscriptionSnapshot = await transaction.get(subscriptionRef);
            if (!subscriptionSnapshot.exists) return false;

            const subscription = subscriptionSnapshot.data() as Subscription;
            if (isSubscriptionStatusSuspended(subscription.status)) return false;

            const cancelledAt = this.getDateMillis(
                (subscription as Subscription & { cancelledAt?: string | null }).cancelledAt,
            );
            const startDate = this.getDateMillis(subscription.startDate);
            const isStillCancelled = cancelledAt > 0 && startDate <= cancelledAt;
            const isStillDateExpired = calculateRemainingDays(subscription.endDate) < 0;

            if (!isStillCancelled && !isStillDateExpired) return false;

            const propertyNumber = String(subscription.propertyNumber || "").trim();
            const propertyRef = propertyNumber
                ? this.db.collection("properties").doc(propertyNumber)
                : null;
            const propertySnapshot = propertyRef
                ? await transaction.get(propertyRef)
                : null;
            const updatedAt = new Date().toISOString();

            transaction.update(subscriptionRef, {
                status: "منتهي",
                subscriptionType: "عادي",
                packageType: "عادي",
                updatedAt,
            });
            if (propertyRef && propertySnapshot?.exists) {
                transaction.update(propertyRef, {
                    subscriptionType: "عادي",
                    lastUpdate: updatedAt.split("T")[0],
                    updatedAt,
                });
            }

            return true;
        });
    }

    async updateSubscriptionLifecycleGroup(
        updates: Array<{
            subscriptionId: string;
            propertyNumber: string;
            subscriptionUpdates: Partial<Subscription>;
            propertySubscriptionType: "مميز" | "عادي";
        }>,
    ): Promise<void> {
        if (updates.length === 0) return;
        if (updates.length > 250) {
            throw new Error("Subscription lifecycle group exceeds the Firestore batch limit");
        }

        const requestedUpdates = new Map(
            updates.map((update) => [update.propertyNumber, update] as const),
        );
        const templateUpdate = updates[0];

        await this.db.runTransaction(async (transaction) => {
            const propertyNumbers = new Set(requestedUpdates.keys());
            const subscriptionSnapshots = new Map<
                string,
                FirebaseFirestore.QuerySnapshot
            >();
            const pendingPropertyNumbers = [...propertyNumbers];

            // Resolve current membership inside the transaction. If an activation
            // adds a child while suspension is starting, Firestore retries this
            // query and the newly linked child joins the same lifecycle write.
            while (pendingPropertyNumbers.length > 0) {
                const propertyNumber = pendingPropertyNumbers.shift()!;
                if (subscriptionSnapshots.has(propertyNumber)) continue;

                const snapshot = await transaction.get(
                    this.db
                        .collection("subscriptions")
                        .where("propertyNumber", "==", propertyNumber),
                );
                subscriptionSnapshots.set(propertyNumber, snapshot);

                const current = this.getCurrentSubscriptionDocument(
                    snapshot.docs,
                    propertyNumber,
                )?.data();
                const linkedNumbers = [
                    current?.linkedProperty,
                    ...(Array.isArray(current?.linkedProperties)
                        ? current.linkedProperties
                        : []),
                ];
                for (const linkedNumber of linkedNumbers) {
                    const normalized = String(linkedNumber || "").trim();
                    if (!normalized || propertyNumbers.has(normalized)) continue;
                    propertyNumbers.add(normalized);
                    pendingPropertyNumbers.push(normalized);
                }

                if (propertyNumbers.size > 250) {
                    throw new Error(
                        "Subscription lifecycle group exceeds the Firestore batch limit",
                    );
                }
            }

            const propertySnapshots = new Map<
                string,
                FirebaseFirestore.DocumentSnapshot
            >();
            for (const propertyNumber of propertyNumbers) {
                const propertyRef = this.db
                    .collection("properties")
                    .doc(propertyNumber);
                propertySnapshots.set(
                    propertyNumber,
                    await transaction.get(propertyRef),
                );
            }

            const subscriptionWriteCount = Array.from(
                subscriptionSnapshots.values(),
            ).reduce((count, snapshot) => count + snapshot.docs.length, 0);
            const propertyWriteCount = Array.from(
                propertySnapshots.values(),
            ).filter((snapshot) => snapshot.exists).length;
            if (subscriptionWriteCount + propertyWriteCount > 500) {
                throw new Error(
                    "Subscription lifecycle group exceeds the Firestore batch limit",
                );
            }

            const updatedAt = new Date().toISOString();
            const lastUpdate = updatedAt.split("T")[0];
            for (const propertyNumber of propertyNumbers) {
                const subscriptionSnapshot = subscriptionSnapshots.get(
                    propertyNumber,
                )!;
                if (
                    requestedUpdates.has(propertyNumber) &&
                    subscriptionSnapshot.empty
                ) {
                    throw new Error(
                        `Subscription not found for property ${propertyNumber}`,
                    );
                }

                const currentSubscription = this.getCurrentSubscriptionDocument(
                    subscriptionSnapshot.docs,
                    propertyNumber,
                )?.data();
                const requestedUpdate = requestedUpdates.get(propertyNumber);
                const propertySubscriptionType = requestedUpdate
                    ?.propertySubscriptionType ||
                    (isSubscriptionStatusSuspended(
                        templateUpdate.subscriptionUpdates.status,
                    )
                        ? "عادي"
                        : isPremiumSubscriptionType(
                            currentSubscription?.subscriptionType ||
                                currentSubscription?.packageType,
                        )
                            ? "مميز"
                            : "عادي");
                const normalizedSubscriptionUpdates =
                    this.enforceSubscriptionDurationLimit(
                        requestedUpdate?.subscriptionUpdates ||
                            templateUpdate.subscriptionUpdates,
                    );

                for (const subscriptionDocument of subscriptionSnapshot.docs) {
                    transaction.update(subscriptionDocument.ref, {
                        ...normalizedSubscriptionUpdates,
                        updatedAt,
                    });
                }

                const propertySnapshot = propertySnapshots.get(propertyNumber)!;
                if (propertySnapshot.exists) {
                    transaction.update(propertySnapshot.ref, {
                        subscriptionType: propertySubscriptionType,
                        lastUpdate,
                        updatedAt,
                    });
                }
            }
        });
    }

    // Async wrappers (no-arg) for FinanceService compatibility
    async calculateMonthlyExpensesAsync(): Promise<number> {
        const now = getNowInRiyadh();
        const monthStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
        const expenses = await this.getExpenses();
        return this.calculateMonthlyExpenses(expenses, monthStr);
    }

    async calculateAllTimeExpensesAsync(): Promise<number> {
        const expenses = await this.getExpenses();
        return this.calculateAllTimeExpenses(expenses);
    }
}

export const firebaseService = new FirebaseService();
