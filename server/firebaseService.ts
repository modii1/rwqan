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
} from "../shared/core/subscriptions/type";
import {
    isPurchasableSubscriptionPackage,
    isSubscriptionPackageDurationAllowed,
    normalizeSubscriptionPackageDuration,
} from "../shared/core/subscriptions/package-policy";

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
        const p = raw as Property;
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

        await ref.update(updatedData);
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

        // Sort in JS to avoid composite index requirement
        const docs = snapshot.docs.map((doc) =>
            ({ ...doc.data(), id: doc.data().id || doc.id } as Subscription)
        );
        docs.sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
            const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
            return dateB - dateA;
        });
        
        console.log(`[FIREBASE] Subscription found for ${propertyNumber}:`, docs[0]);
        return docs[0];
    }

    async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
        const id = `SUB-${subscription.propertyNumber}`;
        const normalizedSubscription = this.enforceSubscriptionDurationLimit(subscription);
        const newSubscription: Subscription = {
            id,
            ...normalizedSubscription,
        } as Subscription;

        await this.db.collection("subscriptions").doc(id).set(newSubscription);

        // Update property status
        const planType = subscription.subscriptionType || subscription.packageType ||
            (subscription.packageId?.includes("premium") || subscription.packageId === "pkg-trusted"
                ? "مميز"
                : "عادي");
        const hasValidEndDate = calculateRemainingDays(subscription.endDate) >= 0;
        const isPremium = hasValidEndDate &&
            isPremiumSubscriptionType(planType) &&
            isSubscriptionStatusActive(subscription.status);

        await this.updateProperty(subscription.propertyNumber, {
            subscriptionType: isPremium ? "مميز" : "عادي",
            lastUpdate: toRiyadhISO(getNowInRiyadh()).split("T")[0],
            subscriptionDate: subscription.startDate.split("T")[0],
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

        // Clear cancellation fields when reactivating
        const docRef = this.db.collection("subscriptions").doc(id);
        const existingDoc = await docRef.get();
        if (existingDoc.exists && (existingDoc.data()?.cancelledAt || existingDoc.data()?.cancelReason)) {
            // Use set with merge to overwrite and delete old cancellation fields
            await docRef.set({ ...subscription, cancelledAt: null, cancelReason: null });
        } else {
            await docRef.set(subscription);
        }

        // Sync with property - use the subscriptionType from the passed data
        const propertyUpdates: any = {
            subscriptionType:
                status !== "منتهي" && isPremiumSubscriptionType(subscriptionData.subscriptionType)
                    ? "مميز"
                    : "عادي",
            lastUpdate: new Date().toISOString().split("T")[0],
            subscriptionDate: subscription.startDate.split("T")[0],
        };

        // Also sync linkedProperty to the property document
        if (subscriptionData.linkedProperty) {
            propertyUpdates.linkedProperty = subscriptionData.linkedProperty;
        }

        await this.updateProperty(propertyNumber, propertyUpdates);
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
        const childSubDoc = await childSubRef.get();
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

        if (childSubDoc.exists) {
            await childSubRef.update(subUpdates);
        } else {
            await childSubRef.set({
                id: childSubId,
                propertyNumber: linkedPropNum,
                ...subUpdates,
                createdAt: new Date().toISOString(),
            });
        }

        // Mirror onto the property document — this is the part that was missing and caused
        // the "main active but linked inactive" bug.
        await this.updateProperty(linkedPropNum, {
            subscriptionType: propertySubscriptionType,
            verificationStatus: "approved",
            linkedProperty: mainPropertyNumber,
            pendingApprovalFrom: null as any,
            subscriptionDate: data.startDate.split("T")[0],
            lastUpdate: new Date().toISOString().split("T")[0],
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
        const doc = await ref.get();
        
        console.log(`[FIREBASE] activateSubscription - doc exists: ${doc.exists} for: ${propertyNumber}`);
        
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
        
        if (doc.exists) {
            await ref.update(normalizedUpdates);
            console.log(`✅ [FIREBASE] Subscription activated for property ${propertyNumber}`);
        } else {
            // Create new subscription if doesn't exist
            await ref.set({
                id,
                propertyNumber,
                ...normalizedUpdates,
                createdAt: new Date().toISOString(),
            });
            console.log(`✅ [FIREBASE] New subscription created and activated for property ${propertyNumber}`);
        }
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

    async claimPaymentFulfillment(id: string): Promise<
        | { status: "claimed"; token: string; previousState?: Payment["fulfillmentState"] }
        | { status: "fulfilled" }
        | { status: "processing" }
    > {
        const ref = this.db.collection("payments").doc(id);
        const now = Date.now();
        const token = `FULFILL-${now}-${Math.random().toString(36).slice(2, 10)}`;
        const staleAfterMs = 10 * 60 * 1000;

        return this.db.runTransaction(async (transaction) => {
            const doc = await transaction.get(ref);
            if (!doc.exists) throw new Error("Payment not found");
            const payment = doc.data() as Payment;
            if (payment.fulfilledAt || payment.fulfillmentState === "fulfilled") {
                return { status: "fulfilled" as const };
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
            if (payment.fulfilledAt || payment.fulfillmentState === "fulfilled") return;
            if (
                payment.fulfillmentState !== "processing" ||
                payment.fulfillmentClaimToken !== token
            ) {
                throw new Error("Payment fulfillment claim was lost");
            }
            transaction.update(ref, {
                fulfillmentState: "fulfilled",
                fulfilledAt: new Date().toISOString(),
                fulfilledSubscriptionId: subscriptionId,
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
            transaction.update(ref, { fulfillmentState: "failed" });
        });
    }

    async createPayment(payment: InsertPayment): Promise<Payment> {
        const id = payment.id || `PAY-${Date.now()}`;
        const newPayment: Payment = {
            ...payment,
            id,
            createdAt: toRiyadhISO(getNowInRiyadh()),
            discountAmount: payment.discountAmount || 0,
        } as Payment;

        console.log(`[DEBUG createPayment] Creating payment: id=${id}, propertyNumber="${payment.propertyNumber}", packageId="${payment.packageId}", status="${payment.status}"`);
        
        await this.db.collection("payments").doc(id).set(newPayment);
        
        console.log(`[DEBUG createPayment] ✅ Payment created successfully: ${id} for property: ${payment.propertyNumber}`);
        return newPayment;
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
    ): Promise<
        | { accepted: false; remainingMs: number }
        | { accepted: true; remainingMs: 0; request: Request; event: ContactEvent }
    > {
        const cooldownRef = this.db.collection("contact_cooldowns").doc(key);
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const requestId = `REQ-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const eventId = `CONTACT-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const requestRef = this.db.collection("requests").doc(requestId);
        const eventRef = this.db.collection("contact_events").doc(eventId);

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
                } as const;
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
            status: "cancelled" as any,
            updatedAt: new Date().toISOString(),
            ...(reason ? { cancellationReason: reason } as any : {}),
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
        await this.db.collection("subscriptions").doc(id).update({
            ...normalizedUpdates,
            updatedAt: new Date().toISOString()
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

        const propertyRefs = updates.map(({ propertyNumber }) =>
            this.db.collection("properties").doc(propertyNumber)
        );
        const propertyDocs = await this.db.getAll(...propertyRefs);
        const existingProperties = new Set(
            propertyDocs.filter((doc) => doc.exists).map((doc) => doc.id),
        );
        const batch = this.db.batch();
        const updatedAt = new Date().toISOString();
        const lastUpdate = updatedAt.split("T")[0];

        for (const update of updates) {
            const subscriptionRef = this.db
                .collection("subscriptions")
                .doc(update.subscriptionId);
            const normalizedSubscriptionUpdates = this.enforceSubscriptionDurationLimit(
                update.subscriptionUpdates,
            );
            batch.update(subscriptionRef, {
                ...normalizedSubscriptionUpdates,
                updatedAt,
            });

            if (existingProperties.has(update.propertyNumber)) {
                const propertyRef = this.db
                    .collection("properties")
                    .doc(update.propertyNumber);
                batch.update(propertyRef, {
                    subscriptionType: update.propertySubscriptionType,
                    lastUpdate,
                    updatedAt,
                });
            }
        }

        await batch.commit();
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
