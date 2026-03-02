import { db } from "./firebase";
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
} from "@shared/schema";
import { getNowInRiyadh, toRiyadhISO, getStartOfMonthRiyadh, getEndOfMonthRiyadh, parseArabicDate } from "./dateUtils";

export class FirebaseService {
    private get db() {
        if (!db) throw new Error("Firebase not initialized");
        return db;
    }

    // ================== العقارات (Properties) ==================

    async getProperties(): Promise<Property[]> {
        const snapshot = await this.db.collection("properties").get();
        return snapshot.docs.map((doc) => doc.data() as Property);
    }

    async getPropertyByNumber(propertyNumber: string): Promise<Property | null> {
        const doc = await this.db.collection("properties").doc(propertyNumber).get();
        return doc.exists ? (doc.data() as Property) : null;
    }

    async createProperty(property: InsertProperty): Promise<Property> {
        const now = new Date().toISOString();
        const newProperty: Property = {
            verificationStatus: "approved", // Default for migration/legacy
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
        return snapshot.docs.map((doc) => doc.data() as Subscription);
    }

    async getSubscriptionByPropertyNumber(propertyNumber: string): Promise<Subscription | null> {
        const snapshot = await this.db
            .collection("subscriptions")
            .where("propertyNumber", "==", propertyNumber)
            .orderBy("endDate", "desc")
            .limit(1)
            .get();

        return snapshot.empty ? null : (snapshot.docs[0].data() as Subscription);
    }

    async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
        const id = `SUB-${subscription.propertyNumber}`;
        const newSubscription: Subscription = {
            id,
            ...subscription,
        } as Subscription;

        await this.db.collection("subscriptions").doc(id).set(newSubscription);

        // Update property status
        const isPremium = subscription.packageId?.includes("premium") ||
            subscription.packageId === "pkg-trusted" ||
            subscription.status === "نشط";

        await this.updateProperty(subscription.propertyNumber, {
            subscriptionType: isPremium ? "premium" : "normal",
            lastUpdate: toRiyadhISO(getNowInRiyadh()).split("T")[0],
            subscriptionDate: subscription.startDate.split("T")[0],
        });

        return newSubscription;
    }

    async addSubscriptionToSheet(propertyNumber: string, subscriptionData: any, property: any, receiptUrl?: string): Promise<void> {
        const id = `SUB-${propertyNumber}`;
        const endDate = new Date(subscriptionData.endDate);
        const now = new Date();

        let status = "نشط";
        if (endDate < now) {
            status = "منتهي";
        }

        const subscription: Subscription = {
            id,
            propertyNumber,
            packageId: subscriptionData.packageId || "pkg-free",
            startDate: subscriptionData.startDate,
            endDate: subscriptionData.endDate,
            status: status as any,
            paymentId: subscriptionData.paymentId,
        };

        await this.db.collection("subscriptions").doc(id).set(subscription);

        // Sync with property
        const isPremium = subscription.packageId?.includes("premium") ||
            subscription.packageId === "pkg-trusted";

        await this.updateProperty(propertyNumber, {
            subscriptionType: isPremium ? "premium" : "normal",
            lastUpdate: new Date().toISOString().split("T")[0],
            subscriptionDate: subscription.startDate.split("T")[0],
        });
    }

    // ================== الباقات (Packages) ==================

    async getPackages(): Promise<Package[]> {
        const snapshot = await this.db.collection("packages").where("isActive", "==", true).get();
        const packages = snapshot.docs.map((doc) => doc.data() as Package);

        // إزالة التكرار بناءً على الـ ID (لضمان عدم وجود أخطاء في واجهة المستخدم)
        return Array.from(new Map(packages.map(pkg => [pkg.id, pkg])).values());
    }

    async getPackageById(id: string): Promise<Package | null> {
        const doc = await this.db.collection("packages").doc(id).get();
        return doc.exists ? (doc.data() as Package) : null;
    }

    async createPackage(pkg: InsertPackage): Promise<Package> {
        const id = `pkg-${Date.now()}`;
        const newPackage: Package = {
            id,
            ...pkg,
            createdAt: new Date().toISOString(),
        } as Package;

        await this.db.collection("packages").doc(id).set(newPackage);
        return newPackage;
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

    async createPayment(payment: InsertPayment): Promise<Payment> {
        const id = payment.id || `PAY-${Date.now()}`;
        const newPayment: Payment = {
            ...payment,
            id,
            createdAt: toRiyadhISO(getNowInRiyadh()),
            discountAmount: payment.discountAmount || 0,
        } as Payment;

        await this.db.collection("payments").doc(id).set(newPayment);
        return newPayment;
    }

    async updatePayment(id: string, updates: Partial<Payment>): Promise<Payment> {
        const ref = this.db.collection("payments").doc(id);
        await ref.update(updates);
        const doc = await ref.get();
        return doc.data() as Payment;
    }

    // ================== الطلبات (Requests) ==================

    async createRequest(request: InsertRequest): Promise<Request> {
        const id = `REQ-${Date.now()}`;
        const newRequest: Request = {
            id,
            ...request,
            createdAt: new Date().toISOString(),
        } as Request;

        await this.db.collection("requests").doc(id).set(newRequest);
        return newRequest;
    }

    async getRequests(): Promise<Request[]> {
        const snapshot = await this.db.collection("requests").orderBy("timestamp", "desc").get();
        return snapshot.docs.map((doc) => doc.data() as Request);
    }

    // ================== أكواد الخصم ==================

    async getDiscountCodes(): Promise<DiscountCode[]> {
        const snapshot = await this.db.collection("discounts").where("isActive", "==", true).get();
        return snapshot.docs.map((doc) => doc.data() as DiscountCode);
    }

    async updateDiscountCode(code: string, updates: Partial<DiscountCode>): Promise<DiscountCode | null> {
        const ref = this.db.collection("discounts").doc(code);
        await ref.update(updates);
        const doc = await ref.get();
        return doc.exists ? (doc.data() as DiscountCode) : null;
    }

    // ================== المدونة (Blog Posts) ==================

    async getBlogPosts(onlyPublished: boolean = false): Promise<any[]> {
        let query = this.db.collection("blog_posts").orderBy("createdAt", "desc");
        if (onlyPublished) {
            query = (query as any).where("status", "==", "منشور");
        }
        const snapshot = await query.get();
        return snapshot.docs.map(doc => doc.data());
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
        const newPost = { id, ...post, createdAt: new Date().toISOString() };
        await this.db.collection("blog_posts").doc(id).set(newPost);
        return id;
    }

    async updateBlogPost(id: string, updates: any): Promise<boolean> {
        const ref = this.db.collection("blog_posts").doc(id);
        const doc = await ref.get();
        if (!doc.exists) return false;
        await ref.update({ ...updates, updatedAt: new Date().toISOString() });
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

    // ================== إعدادات الرسوم ==================

    async getFeeConfigs(): Promise<FeeConfig[]> {
        const snapshot = await this.db.collection("fee_configs").get();
        return snapshot.docs.map((doc) => doc.data() as FeeConfig);
    }

    async getFeeConfigById(id: string): Promise<FeeConfig | null> {
        const doc = await this.db.collection("fee_configs").doc(id).get();
        return doc.exists ? (doc.data() as FeeConfig) : null;
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

    // ================== أعلام الميزات (Feature Flags) ==================

    async getFeatureFlags(): Promise<FeatureFlag[]> {
        const snapshot = await this.db.collection("feature_flags").get();
        return snapshot.docs.map(doc => doc.data() as FeatureFlag);
    }

    async getFeatureFlag(key: string): Promise<boolean> {
        const snapshot = await this.db.collection("feature_flags").where("key", "==", key).limit(1).get();
        return snapshot.empty ? false : (snapshot.docs[0].data().isEnabled ?? false);
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
            p.status === "قيد المراجعة" || p.status === "معلق"
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

    // ================== Parity Dummy Methods ==================
    async initializeSheets(): Promise<void> {
        return;
    }
}

export const firebaseService = new FirebaseService();
