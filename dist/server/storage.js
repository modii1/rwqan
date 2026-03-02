"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storage = exports.GoogleSheetsStorage = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const googleSheets_1 = require("./googleSheets");
// Google Sheets Storage Implementation
class GoogleSheetsStorage {
    constructor() {
        // ===== Active Sessions Implementation (In-Memory) =====
        this.activeSessions = new Set();
        // ===== Backup Implementation (In-Memory) =====
        this.backups = new Map();
        // ===== Code Backup Implementation (Persistent Filesystem) =====
        this.codeBackupDir = ".backup-history";
    }
    async getProperties() {
        return googleSheets_1.googleSheetsService.getProperties();
    }
    async getPropertyByNumber(propertyNumber) {
        return googleSheets_1.googleSheetsService.getPropertyByNumber(propertyNumber);
    }
    async createProperty(property) {
        return googleSheets_1.googleSheetsService.createProperty(property);
    }
    async updateProperty(propertyNumber, property) {
        return googleSheets_1.googleSheetsService.updateProperty(propertyNumber, property);
    }
    async deleteProperty(propertyNumber) {
        return googleSheets_1.googleSheetsService.deleteProperty(propertyNumber);
    }
    async getSubscriptions() {
        return googleSheets_1.googleSheetsService.getSubscriptions();
    }
    async getSubscriptionsByProperty(propertyNumber) {
        const subscriptions = await googleSheets_1.googleSheetsService.getSubscriptions();
        return subscriptions.filter(s => s.propertyNumber === propertyNumber);
    }
    async getSubscriptionByPropertyNumber(propertyNumber) {
        return googleSheets_1.googleSheetsService.getSubscriptionByPropertyNumber(propertyNumber);
    }
    async createSubscription(subscription) {
        return googleSheets_1.googleSheetsService.createSubscription(subscription);
    }
    async updateSubscription(id, subscription) {
        return googleSheets_1.googleSheetsService.updateSubscription(id, subscription);
    }
    async updateSubscriptionRemainingDays(propertyNumber, remainingDays) {
        return googleSheets_1.googleSheetsService.updateSubscriptionRemainingDays(propertyNumber, remainingDays);
    }
    async updateAllSubscriptionsRemainingDays(updates) {
        return googleSheets_1.googleSheetsService.updateAllSubscriptionsRemainingDays(updates);
    }
    async getPackages() {
        return googleSheets_1.googleSheetsService.getPackages();
    }
    async getPackageById(id) {
        return googleSheets_1.googleSheetsService.getPackageById(id);
    }
    async createPackage(pkg) {
        return googleSheets_1.googleSheetsService.createPackage(pkg);
    }
    async updatePackage(id, pkg) {
        const packages = await googleSheets_1.googleSheetsService.getPackages();
        const rowIndex = packages.findIndex(p => p.id === id);
        if (rowIndex === -1)
            throw new Error('Package not found');
        const updated = { ...packages[rowIndex], ...pkg };
        // This needs to be implemented in googleSheetsService
        return updated;
    }
    async deletePackage(id) {
        // This needs to be implemented in googleSheetsService
        throw new Error("Not fully implemented yet");
    }
    async getDiscountCodes() {
        return googleSheets_1.googleSheetsService.getDiscountCodes();
    }
    async getDiscountCodeByCode(code) {
        const codes = await googleSheets_1.googleSheetsService.getDiscountCodes();
        return codes.find(c => c.code === code) || null;
    }
    async createDiscountCode(discountCode) {
        return googleSheets_1.googleSheetsService.createDiscountCode(discountCode);
    }
    async updateDiscountCode(code, discountCode) {
        const codes = await googleSheets_1.googleSheetsService.getDiscountCodes();
        const existing = codes.find(c => c.code === code);
        if (!existing)
            throw new Error('Discount code not found');
        return { ...existing, ...discountCode };
    }
    async deleteDiscountCode(code) {
        throw new Error("Not fully implemented yet");
    }
    async getProfits() {
        // Will be implemented
        return [];
    }
    async createProfit(profit) {
        // Will be implemented
        const id = `PROFIT-${Date.now()}`;
        return { id, ...profit, createdAt: new Date().toISOString() };
    }
    async getRequests() {
        return googleSheets_1.googleSheetsService.getRequests();
    }
    async createRequest(request, requestCountFromIP) {
        return googleSheets_1.googleSheetsService.createRequest(request, requestCountFromIP);
    }
    async getSuggestions() {
        return googleSheets_1.googleSheetsService.getSuggestions();
    }
    async createSuggestion(suggestion) {
        return googleSheets_1.googleSheetsService.createSuggestion(suggestion);
    }
    async updateSuggestion(id, suggestion) {
        // Will be implemented
        throw new Error("Not fully implemented yet");
    }
    async getPayments() {
        return googleSheets_1.googleSheetsService.getPayments();
    }
    async getPaymentById(id) {
        return googleSheets_1.googleSheetsService.getPaymentById(id);
    }
    async createPayment(payment) {
        return googleSheets_1.googleSheetsService.createPayment(payment);
    }
    async updatePayment(id, payment) {
        return googleSheets_1.googleSheetsService.updatePayment(id, payment);
    }
    async getPropertyAnalytics(propertyNumber) {
        const requests = await exports.storage.getRequests();
        const propertyRequests = requests.filter((r) => r.propertyNumber === propertyNumber);
        const now = new Date();
        const currentMonth = propertyRequests.filter((r) => {
            const reqDate = new Date(r.timestamp);
            return reqDate.getMonth() === now.getMonth() && reqDate.getFullYear() === now.getFullYear();
        });
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
        const previousMonth = propertyRequests.filter((r) => {
            const reqDate = new Date(r.timestamp);
            return reqDate.getMonth() === lastMonth.getMonth() && reqDate.getFullYear() === lastMonth.getFullYear();
        });
        const monthlyRequests = currentMonth.length;
        const previousMonthRequests = previousMonth.length;
        const growth = previousMonthRequests > 0
            ? Math.round(((monthlyRequests - previousMonthRequests) / previousMonthRequests) * 100)
            : monthlyRequests > 0 ? 100 : 0;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const avgDaily = Math.round(monthlyRequests / daysInMonth);
        const requestsByDay = {};
        const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        currentMonth.forEach((r) => {
            const day = days[new Date(r.timestamp).getDay()];
            requestsByDay[day] = (requestsByDay[day] || 0) + 1;
        });
        const highestDay = Object.entries(requestsByDay).sort((a, b) => b[1] - a[1])[0]?.[0] || 'الجمعة';
        return {
            propertyNumber,
            monthlyWhatsappRequests: monthlyRequests,
            previousMonthGrowth: growth,
            averageDailyRequests: avgDaily,
            highestDemandDay: highestDay,
            engagementRate: monthlyRequests > 50 ? 'عالي' : monthlyRequests > 20 ? 'متوسط' : 'منخفض',
            peakRequestPeriod: 'المساء',
            visibilityStatus: monthlyRequests > 30 ? 'ممتاز' : monthlyRequests > 15 ? 'جيد' : 'عادي',
            previousMonthRequests,
        };
    }
    async getAnalytics() {
        return null;
    }
    async updateAnalytics(analytics) {
    }
    // ===== Verification Logs (Google Sheets) =====
    async addVerificationLog(log) {
        const utcNow = new Date();
        const riyadhTime = new Date(utcNow.getTime() + (3 * 60 * 60 * 1000));
        const entry = {
            date: riyadhTime.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }),
            propertyNumber: log.propertyNumber,
            action: log.action === "approved" ? "قبول" : "رفض",
            reason: log.reason || "",
            admin: log.admin || "Admin",
        };
        try {
            await googleSheets_1.googleSheetsService.addVerificationLogToSheet(entry);
            console.log("✅ تم حفظ سجل التحقق:", entry);
        }
        catch (err) {
            console.error("❌ فشل حفظ سجل التحقق:", err);
        }
        return entry;
    }
    async getVerificationLogs() {
        try {
            return await googleSheets_1.googleSheetsService.getVerificationLogsFromSheet();
        }
        catch (err) {
            console.error("❌ فشل جلب سجلات التحقق:", err);
            return [];
        }
    }
    async startSession(sessionId) {
        this.activeSessions.add(sessionId);
    }
    async endSession(sessionId) {
        this.activeSessions.delete(sessionId);
    }
    async getActiveSessions() {
        return this.activeSessions.size;
    }
    async getBackups() {
        return Array.from(this.backups.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    async getBackupById(id) {
        return this.backups.get(id) || null;
    }
    async createBackup(backup) {
        const id = `BACKUP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newBackup = {
            id,
            ...backup,
            createdAt: new Date().toISOString(),
        };
        this.backups.set(id, newBackup);
        return newBackup;
    }
    async updateBackup(id, backup) {
        const existing = this.backups.get(id);
        if (!existing)
            throw new Error('Backup not found');
        const updated = { ...existing, ...backup };
        this.backups.set(id, updated);
        return updated;
    }
    async deleteBackup(id) {
        this.backups.delete(id);
    }
    async restoreBackup(id) {
        const backup = this.backups.get(id);
        if (!backup)
            throw new Error('Backup not found');
        // Mark as restored
        backup.status = 'استعادة';
        backup.restoredAt = new Date().toISOString();
        this.backups.set(id, backup);
    }
    ensureBackupDir() {
        if (!fs_1.default.existsSync(this.codeBackupDir)) {
            fs_1.default.mkdirSync(this.codeBackupDir, { recursive: true });
        }
    }
    getBackupFilePath(id) {
        return path_1.default.join(this.codeBackupDir, `${id}.json`);
    }
    async getCodeBackups() {
        try {
            this.ensureBackupDir();
            const files = fs_1.default.readdirSync(this.codeBackupDir).filter((f) => f.endsWith(".json"));
            const backups = [];
            for (const file of files) {
                try {
                    const content = fs_1.default.readFileSync(path_1.default.join(this.codeBackupDir, file), "utf-8");
                    const backup = JSON.parse(content);
                    backups.push(backup);
                }
                catch (e) { }
            }
            return backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
        catch (e) {
            return [];
        }
    }
    async getCodeBackupById(id) {
        try {
            const filePath = this.getBackupFilePath(id);
            if (!fs_1.default.existsSync(filePath)) {
                return null;
            }
            const content = fs_1.default.readFileSync(filePath, "utf-8");
            return JSON.parse(content);
        }
        catch (e) {
            return null;
        }
    }
    async createCodeBackup(backup) {
        try {
            const id = `CODE-BACKUP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const newBackup = {
                id,
                ...backup,
                createdAt: new Date().toISOString(),
            };
            this.ensureBackupDir();
            const filePath = this.getBackupFilePath(id);
            fs_1.default.writeFileSync(filePath, JSON.stringify(newBackup, null, 2), "utf-8");
            return newBackup;
        }
        catch (e) {
            throw new Error(`Failed to create code backup: ${e}`);
        }
    }
    async deleteCodeBackup(id) {
        try {
            const filePath = this.getBackupFilePath(id);
            if (fs_1.default.existsSync(filePath)) {
                fs_1.default.unlinkSync(filePath);
            }
        }
        catch (e) {
            throw new Error(`Failed to delete code backup: ${e}`);
        }
    }
}
exports.GoogleSheetsStorage = GoogleSheetsStorage;
exports.storage = new GoogleSheetsStorage();
