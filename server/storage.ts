import type {
  Property,
  InsertProperty,
  Subscription,
  InsertSubscription,
  Package,
  InsertPackage,
  DiscountCode,
  InsertDiscountCode,
  Profit,
  InsertProfit,
  Request,
  InsertRequest,
  Suggestion,
  InsertSuggestion,
  Payment,
  InsertPayment,
  Analytics,
  Backup,
  InsertBackup,
  CodeBackup,
  InsertCodeBackup,
} from "@shared/schema";
import fs from "fs";
import path from "path";

export interface IStorage {
  // Properties (العقارات)
  getProperties(): Promise<Property[]>;
  getPropertyByNumber(propertyNumber: string): Promise<Property | null>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(propertyNumber: string, property: Partial<Property>): Promise<Property>;
  updateVerificationStatus(propertyNumber: string, status: "pending" | "approved" | "rejected" | "incomplete" | "verified"): Promise<Property>;
  updateMuteExpiryNotification(propertyNumber: string, muted: boolean): Promise<Property>;
  deleteProperty(propertyNumber: string): Promise<void>;

  // Blog Posts (المدونة)
  getBlogPosts(onlyPublished?: boolean): Promise<any[]>;
  getBlogPostBySlug(slug: string): Promise<any | null>;
  getBlogPostById(id: string): Promise<any | null>;
  createBlogPost(post: any): Promise<string>;
  updateBlogPost(id: string, updates: any): Promise<boolean>;
  deleteBlogPost(id: string): Promise<boolean>;

  // Property SEO
  getPropertySeo(propertyNumber: string): Promise<any | null>;
  updatePropertySeo(propertyNumber: string, seoData: any): Promise<any>;
  upsertPropertySeo(propertyNumber: string, seoData: any): Promise<any>;

  // Property Add-ons
  getPropertyAddOns(propertyNumber: string): Promise<any[]>;
  getAllPropertyAddOns(): Promise<any[]>;
  createPropertyAddOn(addon: any): Promise<any>;
  updatePropertyAddOn(id: string, updates: any): Promise<any | null>;

  // Verification Logs
  addVerificationLog(log: any): Promise<any>;
  getVerificationLogs(): Promise<any[]>;

  // Subscriptions (الاشتراكات)
  getSubscriptions(): Promise<Subscription[]>;
  getSubscriptionsByProperty(propertyNumber: string): Promise<Subscription[]>;
  getSubscriptionByPropertyNumber(propertyNumber: string): Promise<Subscription | null>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, subscription: Partial<Subscription>): Promise<Subscription>;
  updateSubscriptionRemainingDays(propertyNumber: string, remainingDays: number): Promise<void>;
  updateAllSubscriptionsRemainingDays(updates: Array<{ propertyNumber: string; remainingDays: number }>): Promise<number>;

  // Packages (الباقات)
  getPackages(): Promise<Package[]>;
  getPackageById(id: string): Promise<Package | null>;
  createPackage(pkg: InsertPackage): Promise<Package>;
  updatePackage(id: string, pkg: Partial<Package>): Promise<Package>;
  deletePackage(id: string): Promise<void>;

  // Discount Codes (أكواد الخصم)
  getDiscountCodes(): Promise<DiscountCode[]>;
  getDiscountCodeByCode(code: string): Promise<DiscountCode | null>;
  createDiscountCode(discountCode: InsertDiscountCode): Promise<DiscountCode>;
  updateDiscountCode(code: string, discountCode: Partial<DiscountCode>): Promise<DiscountCode>;
  deleteDiscountCode(code: string): Promise<void>;

  // Profits (الأرباح)
  getProfits(): Promise<Profit[]>;
  createProfit(profit: InsertProfit): Promise<Profit>;

  // Requests (الطلبات)
  getRequests(): Promise<Request[]>;
  createRequest(request: InsertRequest, requestCountFromIP?: number): Promise<Request>;

  // Suggestions (الاقتراحات)
  getSuggestions(): Promise<Suggestion[]>;
  createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion>;
  updateSuggestion(id: string, suggestion: Partial<Suggestion>): Promise<Suggestion>;

  // Payments (المدفوعات)
  getPayments(): Promise<Payment[]>;
  getPaymentById(id: string): Promise<Payment | null>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: string, payment: Partial<Payment>): Promise<Payment>;

  // Analytics (الإحصائيات)
  getAnalytics(): Promise<Analytics | null>;
  updateAnalytics(analytics: Analytics): Promise<void>;

  // Backups (النسخ الاحتياطية)
  getBackups(): Promise<Backup[]>;
  getBackupById(id: string): Promise<Backup | null>;
  createBackup(backup: InsertBackup): Promise<Backup>;
  updateBackup(id: string, backup: Partial<Backup>): Promise<Backup>;
  deleteBackup(id: string): Promise<void>;
  restoreBackup(id: string): Promise<void>;

  // Code Backups (نسخ احتياطية الأكواد)
  getCodeBackups(): Promise<CodeBackup[]>;
  getCodeBackupById(id: string): Promise<CodeBackup | null>;
  createCodeBackup(backup: InsertCodeBackup): Promise<CodeBackup>;
  deleteCodeBackup(id: string): Promise<void>;

  // Active Sessions (الجلسات النشطة)
  startSession(sessionId: string): Promise<void>;
  endSession(sessionId: string): Promise<void>;
  getActiveSessions(): Promise<number>;
}

import { googleSheetsService } from './googleSheets';
import { firebaseService } from './firebaseService';
import { db } from './firebase';
import { dbContext } from './dbConfig';

// Firebase Storage Implementation
export class FirebaseStorage implements IStorage {
  private async getCollection(name: string) {
    if (!db) throw new Error("Firebase not initialized. Check FIREBASE_SERVICE_ACCOUNT env var.");
    return db.collection(name);
  }

  // Properties
  async getProperties(): Promise<Property[]> {
    const col = await this.getCollection('properties');
    const snapshot = await col.get();
    return snapshot.docs.map(doc => doc.data() as Property);
  }

  async getPropertyByNumber(propertyNumber: string): Promise<Property | null> {
    const col = await this.getCollection('properties');
    const snapshot = await col.where('propertyNumber', '==', propertyNumber).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as Property;
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    const col = await this.getCollection('properties');
    const newProperty = { ...property, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await col.doc(property.propertyNumber).set(newProperty);
    return newProperty as Property;
  }

  async updateProperty(propertyNumber: string, property: Partial<Property>): Promise<Property> {
    return firebaseService.updateProperty(propertyNumber, property);
  }

  async updateVerificationStatus(propertyNumber: string, status: "pending" | "approved" | "rejected" | "incomplete" | "verified"): Promise<Property> {
    return firebaseService.updateVerificationStatus(propertyNumber, status);
  }

  async updateMuteExpiryNotification(propertyNumber: string, muted: boolean): Promise<Property> {
    return firebaseService.updateMuteExpiryNotification(propertyNumber, muted);
  }

  async deleteProperty(propertyNumber: string): Promise<void> {
    return firebaseService.deleteProperty(propertyNumber);
  }

  // Blog Posts
  async getBlogPosts(onlyPublished?: boolean): Promise<any[]> {
    return firebaseService.getBlogPosts(onlyPublished);
  }

  async getBlogPostBySlug(slug: string): Promise<any | null> {
    return firebaseService.getBlogPostBySlug(slug);
  }

  async getBlogPostById(id: string): Promise<any | null> {
    return firebaseService.getBlogPostById(id);
  }

  async createBlogPost(post: any): Promise<string> {
    return firebaseService.createBlogPost(post);
  }

  async updateBlogPost(id: string, updates: any): Promise<boolean> {
    return firebaseService.updateBlogPost(id, updates);
  }

  async deleteBlogPost(id: string): Promise<boolean> {
    return firebaseService.deleteBlogPost(id);
  }

  // SEO
  async getPropertySeo(propertyNumber: string): Promise<any | null> {
    return firebaseService.getPropertySeo(propertyNumber);
  }

  async updatePropertySeo(propertyNumber: string, seoData: any): Promise<any> {
    return firebaseService.updatePropertySeo(propertyNumber, seoData);
  }

  async upsertPropertySeo(propertyNumber: string, seoData: any): Promise<any> {
    return firebaseService.updatePropertySeo(propertyNumber, seoData);
  }

  // Add-ons
  async getPropertyAddOns(propertyNumber: string): Promise<any[]> {
    return firebaseService.getPropertyAddOns(propertyNumber);
  }

  async getAllPropertyAddOns(): Promise<any[]> {
    return firebaseService.getAllPropertyAddOns();
  }

  async createPropertyAddOn(addon: any): Promise<any> {
    return firebaseService.createPropertyAddOn(addon);
  }

  async updatePropertyAddOn(id: string, updates: any): Promise<any | null> {
    return firebaseService.updatePropertyAddOn(id, updates);
  }

  // Verification Logs
  async addVerificationLog(log: any): Promise<any> {
    return firebaseService.addVerificationLog(log);
  }

  async getVerificationLogs(): Promise<any[]> {
    return firebaseService.getVerificationLogs();
  }

  // Subscriptions
  async getSubscriptions(): Promise<Subscription[]> {
    const col = await this.getCollection('subscriptions');
    const snapshot = await col.get();
    return snapshot.docs.map(doc => doc.data() as Subscription);
  }

  async getSubscriptionsByProperty(propertyNumber: string): Promise<Subscription[]> {
    const col = await this.getCollection('subscriptions');
    const snapshot = await col.where('propertyNumber', '==', propertyNumber).get();
    return snapshot.docs.map(doc => doc.data() as Subscription);
  }

  async getSubscriptionByPropertyNumber(propertyNumber: string): Promise<Subscription | null> {
    const subs = await this.getSubscriptionsByProperty(propertyNumber);
    return subs.find(s => s.status === 'نشط' || s.status === 'ساري' || s.status === 'active') || subs[0] || null;
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const col = await this.getCollection('subscriptions');
    const id = `SUB-${Date.now()}`;
    const newSub = { id, ...subscription, createdAt: new Date().toISOString() };
    await col.doc(id).set(newSub);
    return newSub as Subscription;
  }

  async updateSubscription(id: string, subscription: Partial<Subscription>): Promise<Subscription> {
    const col = await this.getCollection('subscriptions');
    await col.doc(id).update(subscription);
    const snapshot = await col.doc(id).get();
    return snapshot.data() as Subscription;
  }

  async updateSubscriptionRemainingDays(propertyNumber: string, remainingDays: number): Promise<void> {
    // This logic might be different in Firebase depending on how automated tasks are handled
    // For now, we update the active subscription
    const sub = await this.getSubscriptionByPropertyNumber(propertyNumber);
    if (sub) {
      await this.updateSubscription(sub.id, { status: remainingDays <= 0 ? 'منتهي' : sub.status });
    }
  }

  async updateAllSubscriptionsRemainingDays(updates: Array<{ propertyNumber: string; remainingDays: number }>): Promise<number> {
    let count = 0;
    for (const update of updates) {
      await this.updateSubscriptionRemainingDays(update.propertyNumber, update.remainingDays);
      count++;
    }
    return count;
  }

  // Packages
  async getPackages(): Promise<Package[]> {
    const col = await this.getCollection('packages');
    const snapshot = await col.get();
    return snapshot.docs.map(doc => doc.data() as Package);
  }

  async getPackageById(id: string): Promise<Package | null> {
    const col = await this.getCollection('packages');
    const doc = await col.doc(id).get();
    return doc.exists ? doc.data() as Package : null;
  }

  async createPackage(pkg: InsertPackage): Promise<Package> {
    const col = await this.getCollection('packages');
    const id = `PKG-${Date.now()}`;
    const newPkg = { id, ...pkg, createdAt: new Date().toISOString() };
    await col.doc(id).set(newPkg);
    return newPkg as Package;
  }

  async updatePackage(id: string, pkg: Partial<Package>): Promise<Package> {
    const col = await this.getCollection('packages');
    await col.doc(id).update(pkg);
    const updated = await this.getPackageById(id);
    return updated!;
  }

  async deletePackage(id: string): Promise<void> {
    const col = await this.getCollection('packages');
    await col.doc(id).delete();
  }

  // Discount Codes
  async getDiscountCodes(): Promise<DiscountCode[]> {
    const col = await this.getCollection('discounts');
    const snapshot = await col.get();
    return snapshot.docs.map(doc => doc.data() as DiscountCode);
  }

  async getDiscountCodeByCode(code: string): Promise<DiscountCode | null> {
    const col = await this.getCollection('discounts');
    const doc = await col.doc(code).get();
    return doc.exists ? doc.data() as DiscountCode : null;
  }

  async createDiscountCode(discountCode: InsertDiscountCode): Promise<DiscountCode> {
    const col = await this.getCollection('discounts');
    const newCode = { ...discountCode, usageCount: 0, createdAt: new Date().toISOString() };
    await col.doc(discountCode.code).set(newCode);
    return newCode as DiscountCode;
  }

  async updateDiscountCode(code: string, discountCode: Partial<DiscountCode>): Promise<DiscountCode> {
    const col = await this.getCollection('discounts');
    await col.doc(code).update(discountCode);
    const updated = await this.getDiscountCodeByCode(code);
    return updated!;
  }

  async deleteDiscountCode(code: string): Promise<void> {
    const col = await this.getCollection('discounts');
    await col.doc(code).delete();
  }

  // Profits
  async getProfits(): Promise<Profit[]> {
    const col = await this.getCollection('profits');
    const snapshot = await col.get();
    return snapshot.docs.map(doc => doc.data() as Profit);
  }

  async createProfit(profit: InsertProfit): Promise<Profit> {
    const col = await this.getCollection('profits');
    const id = `PROFIT-${Date.now()}`;
    const newProfit = { id, ...profit, createdAt: new Date().toISOString() };
    await col.doc(id).set(newProfit);
    return newProfit as Profit;
  }

  // Requests
  async getRequests(): Promise<Request[]> {
    const col = await this.getCollection('requests');
    const snapshot = await col.orderBy('timestamp', 'desc').limit(1000).get();
    return snapshot.docs.map(doc => doc.data() as Request);
  }

  async createRequest(request: InsertRequest): Promise<Request> {
    const col = await this.getCollection('requests');
    const id = `REQ-${Date.now()}`;
    const newRequest = { id, ...request, createdAt: new Date().toISOString() };
    await col.doc(id).set(newRequest);
    return newRequest as Request;
  }

  // Suggestions
  async getSuggestions(): Promise<Suggestion[]> {
    const col = await this.getCollection('suggestions');
    const snapshot = await col.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data() as Suggestion);
  }

  async createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion> {
    const col = await this.getCollection('suggestions');
    const id = `SUG-${Date.now()}`;
    const newSug = { id, ...suggestion, status: 'جديد', createdAt: new Date().toISOString() };
    await col.doc(id).set(newSug);
    return newSug as Suggestion;
  }

  async updateSuggestion(id: string, suggestion: Partial<Suggestion>): Promise<Suggestion> {
    const col = await this.getCollection('suggestions');
    await col.doc(id).update(suggestion);
    const snapshot = await col.doc(id).get();
    return snapshot.data() as Suggestion;
  }

  // Payments
  async getPayments(): Promise<Payment[]> {
    const col = await this.getCollection('payments');
    const snapshot = await col.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data() as Payment);
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const col = await this.getCollection('payments');
    const doc = await col.doc(id).get();
    return doc.exists ? doc.data() as Payment : null;
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const col = await this.getCollection('payments');
    const id = payment.id || `PAY-${Date.now()}`;
    const newPay = { id, ...payment, createdAt: new Date().toISOString() };
    await col.doc(id).set(newPay);
    return newPay as Payment;
  }

  async updatePayment(id: string, payment: Partial<Payment>): Promise<Payment> {
    const col = await this.getCollection('payments');
    await col.doc(id).update(payment);
    const updated = await this.getPaymentById(id);
    return updated!;
  }

  // Analytics
  async getAnalytics(): Promise<Analytics | null> {
    const col = await this.getCollection('analytics');
    const doc = await col.doc('general').get();
    return doc.exists ? doc.data() as Analytics : null;
  }

  async updateAnalytics(analytics: Analytics): Promise<void> {
    const col = await this.getCollection('analytics');
    await col.doc('general').set(analytics);
  }

  // Active Sessions (Still In-Memory for speed, or move to Redis/Firestore if needed)
  private activeSessions: Set<string> = new Set();
  async startSession(sessionId: string): Promise<void> { this.activeSessions.add(sessionId); }
  async endSession(sessionId: string): Promise<void> { this.activeSessions.delete(sessionId); }
  async getActiveSessions(): Promise<number> { return this.activeSessions.size; }

  // Backups
  async getBackups(): Promise<Backup[]> {
    const col = await this.getCollection('backups');
    const snapshot = await col.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data() as Backup);
  }

  async getBackupById(id: string): Promise<Backup | null> {
    const col = await this.getCollection('backups');
    const doc = await col.doc(id).get();
    return doc.exists ? doc.data() as Backup : null;
  }

  async createBackup(backup: InsertBackup): Promise<Backup> {
    const col = await this.getCollection('backups');
    const id = `BACKUP-${Date.now()}`;
    const newBackup = { id, ...backup, createdAt: new Date().toISOString() };
    await col.doc(id).set(newBackup);
    return newBackup as Backup;
  }

  async updateBackup(id: string, backup: Partial<Backup>): Promise<Backup> {
    const col = await this.getCollection('backups');
    await col.doc(id).update(backup);
    const updated = await this.getBackupById(id);
    return updated!;
  }

  async deleteBackup(id: string): Promise<void> {
    const col = await this.getCollection('backups');
    await col.doc(id).delete();
  }

  async restoreBackup(id: string): Promise<void> {
    await this.updateBackup(id, { status: 'استعادة', restoredAt: new Date().toISOString() });
  }

  // Code Backups (Persistent Filesystem - Keep as is or move to Cloud Storage)
  private codeBackupDir = ".backup-history";
  private ensureBackupDir() { if (!fs.existsSync(this.codeBackupDir)) fs.mkdirSync(this.codeBackupDir, { recursive: true }); }
  private getBackupFilePath(id: string): string { return path.join(this.codeBackupDir, `${id}.json`); }

  async getCodeBackups(): Promise<CodeBackup[]> {
    this.ensureBackupDir();
    const files = fs.readdirSync(this.codeBackupDir).filter(f => f.endsWith(".json"));
    const backups: CodeBackup[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.codeBackupDir, file), "utf-8");
        backups.push(JSON.parse(content));
      } catch (e) { }
    }
    return backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getCodeBackupById(id: string): Promise<CodeBackup | null> {
    const filePath = this.getBackupFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  async createCodeBackup(backup: InsertCodeBackup): Promise<CodeBackup> {
    const id = `CODE-BACKUP-${Date.now()}`;
    const newBackup = { id, ...backup, createdAt: new Date().toISOString() };
    this.ensureBackupDir();
    fs.writeFileSync(this.getBackupFilePath(id), JSON.stringify(newBackup, null, 2));
    return newBackup;
  }

  async deleteCodeBackup(id: string): Promise<void> {
    const filePath = this.getBackupFilePath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// Google Sheets Storage Implementation
export class GoogleSheetsStorage implements IStorage {
  async getProperties(): Promise<Property[]> {
    return googleSheetsService.getProperties();
  }

  async getPropertyByNumber(propertyNumber: string): Promise<Property | null> {
    return googleSheetsService.getPropertyByNumber(propertyNumber);
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    return googleSheetsService.createProperty(property);
  }

  async updateProperty(propertyNumber: string, property: Partial<Property>): Promise<Property> {
    return googleSheetsService.updateProperty(propertyNumber, property);
  }

  async updateVerificationStatus(propertyNumber: string, status: "pending" | "approved" | "rejected" | "incomplete" | "verified"): Promise<Property> {
    return googleSheetsService.updateVerificationStatus(propertyNumber, status);
  }

  async updateMuteExpiryNotification(propertyNumber: string, muted: boolean): Promise<Property> {
    return googleSheetsService.updateMuteExpiryNotification(propertyNumber, muted);
  }

  async deleteProperty(propertyNumber: string): Promise<void> {
    return googleSheetsService.deleteProperty(propertyNumber);
  }

  // Blog Posts
  async getBlogPosts(onlyPublished?: boolean): Promise<any[]> {
    return googleSheetsService.getBlogPosts(onlyPublished);
  }

  async getBlogPostBySlug(slug: string): Promise<any | null> {
    return googleSheetsService.getBlogPostBySlug(slug);
  }

  async getBlogPostById(id: string): Promise<any | null> {
    return googleSheetsService.getBlogPostById(id);
  }

  async createBlogPost(post: any): Promise<string> {
    return googleSheetsService.createBlogPost(post);
  }

  async updateBlogPost(id: string, updates: any): Promise<boolean> {
    return googleSheetsService.updateBlogPost(id, updates);
  }

  async deleteBlogPost(id: string): Promise<boolean> {
    return googleSheetsService.deleteBlogPost(id);
  }

  // SEO
  async getPropertySeo(propertyNumber: string): Promise<any | null> {
    return googleSheetsService.getPropertySeo(propertyNumber);
  }

  async updatePropertySeo(propertyNumber: string, seoData: any): Promise<any> {
    return googleSheetsService.updatePropertySeo(propertyNumber, seoData);
  }

  async upsertPropertySeo(propertyNumber: string, seoData: any): Promise<any> {
    return googleSheetsService.upsertPropertySeo(propertyNumber, seoData);
  }

  // Add-ons
  async getPropertyAddOns(propertyNumber: string): Promise<any[]> {
    return googleSheetsService.getPropertyAddOns(propertyNumber);
  }

  async getAllPropertyAddOns(): Promise<any[]> {
    return googleSheetsService.getAllPropertyAddOns();
  }

  async createPropertyAddOn(addon: any): Promise<any> {
    return googleSheetsService.createPropertyAddOn(addon);
  }

  async updatePropertyAddOn(id: string, updates: any): Promise<any | null> {
    return googleSheetsService.updatePropertyAddOn(id, updates);
  }

  async getSubscriptions(): Promise<Subscription[]> {
    return googleSheetsService.getSubscriptions();
  }

  async getSubscriptionsByProperty(propertyNumber: string): Promise<Subscription[]> {
    const subscriptions = await googleSheetsService.getSubscriptions();
    return subscriptions.filter(s => s.propertyNumber === propertyNumber);
  }

  async getSubscriptionByPropertyNumber(propertyNumber: string): Promise<Subscription | null> {
    return googleSheetsService.getSubscriptionByPropertyNumber(propertyNumber);
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    return googleSheetsService.createSubscription(subscription);
  }

  async updateSubscription(id: string, subscription: Partial<Subscription>): Promise<Subscription> {
    return googleSheetsService.updateSubscription(id, subscription);
  }

  async updateSubscriptionRemainingDays(propertyNumber: string, remainingDays: number): Promise<void> {
    return googleSheetsService.updateSubscriptionRemainingDays(propertyNumber, remainingDays);
  }

  async updateAllSubscriptionsRemainingDays(updates: Array<{ propertyNumber: string; remainingDays: number }>): Promise<number> {
    return googleSheetsService.updateAllSubscriptionsRemainingDays(updates);
  }

  async getPackages(): Promise<Package[]> {
    return googleSheetsService.getPackages();
  }

  async getPackageById(id: string): Promise<Package | null> {
    return googleSheetsService.getPackageById(id);
  }

  async createPackage(pkg: InsertPackage): Promise<Package> {
    return googleSheetsService.createPackage(pkg);
  }

  async updatePackage(id: string, pkg: Partial<Package>): Promise<Package> {
    const packages = await googleSheetsService.getPackages();
    const rowIndex = packages.findIndex(p => p.id === id);
    if (rowIndex === -1) throw new Error('Package not found');

    const updated = { ...packages[rowIndex], ...pkg };
    // This needs to be implemented in googleSheetsService
    return updated as Package;
  }

  async deletePackage(id: string): Promise<void> {
    // This needs to be implemented in googleSheetsService
    throw new Error("Not fully implemented yet");
  }

  async getDiscountCodes(): Promise<DiscountCode[]> {
    return googleSheetsService.getDiscountCodes();
  }

  async getDiscountCodeByCode(code: string): Promise<DiscountCode | null> {
    const codes = await googleSheetsService.getDiscountCodes();
    return codes.find(c => c.code === code) || null;
  }

  async createDiscountCode(discountCode: InsertDiscountCode): Promise<DiscountCode> {
    return googleSheetsService.createDiscountCode(discountCode);
  }

  async updateDiscountCode(code: string, discountCode: Partial<DiscountCode>): Promise<DiscountCode> {
    const codes = await googleSheetsService.getDiscountCodes();
    const existing = codes.find(c => c.code === code);
    if (!existing) throw new Error('Discount code not found');

    return { ...existing, ...discountCode } as DiscountCode;
  }

  async deleteDiscountCode(code: string): Promise<void> {
    throw new Error("Not fully implemented yet");
  }

  async getProfits(): Promise<Profit[]> {
    // Will be implemented
    return [];
  }

  async createProfit(profit: InsertProfit): Promise<Profit> {
    // Will be implemented
    const id = `PROFIT-${Date.now()}`;
    return { id, ...profit, createdAt: new Date().toISOString() };
  }

  async getRequests(): Promise<Request[]> {
    return googleSheetsService.getRequests();
  }

  async createRequest(request: InsertRequest, requestCountFromIP?: number): Promise<Request> {
    return googleSheetsService.createRequest(request, requestCountFromIP);
  }

  async getSuggestions(): Promise<Suggestion[]> {
    return googleSheetsService.getSuggestions();
  }

  async createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion> {
    return googleSheetsService.createSuggestion(suggestion);
  }

  async updateSuggestion(id: string, suggestion: Partial<Suggestion>): Promise<Suggestion> {
    // Will be implemented
    throw new Error("Not fully implemented yet");
  }

  async getPayments(): Promise<Payment[]> {
    return googleSheetsService.getPayments();
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    return googleSheetsService.getPaymentById(id);
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    return googleSheetsService.createPayment(payment);
  }

  async updatePayment(id: string, payment: Partial<Payment>): Promise<Payment> {
    return googleSheetsService.updatePayment(id, payment);
  }

  async getPropertyAnalytics(propertyNumber: string): Promise<any> {
    const requests = await this.getRequests();
    const propertyRequests = requests.filter((r: Request) => r.propertyNumber === propertyNumber);

    const now = new Date();
    const currentMonth = propertyRequests.filter((r: Request) => {
      const reqDate = new Date(r.timestamp);
      return reqDate.getMonth() === now.getMonth() && reqDate.getFullYear() === now.getFullYear();
    });

    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
    const previousMonth = propertyRequests.filter((r: Request) => {
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

    const requestsByDay: Record<string, number> = {};
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    currentMonth.forEach((r: Request) => {
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

  async getAnalytics(): Promise<Analytics | null> {
    return null;
  }

  async updateAnalytics(analytics: Analytics): Promise<void> {
  }

  // ===== Active Sessions Implementation (In-Memory) =====
  private activeSessions: Set<string> = new Set();

  // ===== Verification Logs (Google Sheets) =====
  async addVerificationLog(log: {
    propertyNumber: string;
    action: "approved" | "rejected";
    reason?: string;
    admin?: string;
  }) {
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
      await googleSheetsService.addVerificationLogToSheet(entry);
      console.log("✅ تم حفظ سجل التحقق:", entry);
    } catch (err) {
      console.error("❌ فشل حفظ سجل التحقق:", err);
    }

    return entry;
  }

  async getVerificationLogs() {
    try {
      return await googleSheetsService.getVerificationLogsFromSheet();
    } catch (err) {
      console.error("❌ فشل جلب سجلات التحقق:", err);
      return [];
    }
  }


  async startSession(sessionId: string): Promise<void> {
    this.activeSessions.add(sessionId);
  }

  async endSession(sessionId: string): Promise<void> {
    this.activeSessions.delete(sessionId);
  }

  async getActiveSessions(): Promise<number> {
    return this.activeSessions.size;
  }

  // ===== Backup Implementation (In-Memory) =====
  private backups: Map<string, Backup> = new Map();

  async getBackups(): Promise<Backup[]> {
    return Array.from(this.backups.values()).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getBackupById(id: string): Promise<Backup | null> {
    return this.backups.get(id) || null;
  }

  async createBackup(backup: InsertBackup): Promise<Backup> {
    const id = `BACKUP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newBackup: Backup = {
      id,
      ...backup,
      createdAt: new Date().toISOString(),
    };
    this.backups.set(id, newBackup);
    return newBackup;
  }

  async updateBackup(id: string, backup: Partial<Backup>): Promise<Backup> {
    const existing = this.backups.get(id);
    if (!existing) throw new Error('Backup not found');

    const updated = { ...existing, ...backup };
    this.backups.set(id, updated);
    return updated;
  }

  async deleteBackup(id: string): Promise<void> {
    this.backups.delete(id);
  }

  async restoreBackup(id: string): Promise<void> {
    const backup = this.backups.get(id);
    if (!backup) throw new Error('Backup not found');

    // Mark as restored
    backup.status = 'استعادة';
    backup.restoredAt = new Date().toISOString();
    this.backups.set(id, backup);
  }

  // ===== Code Backup Implementation (Persistent Filesystem) =====
  private codeBackupDir = ".backup-history";

  private ensureBackupDir() {
    if (!fs.existsSync(this.codeBackupDir)) {
      fs.mkdirSync(this.codeBackupDir, { recursive: true });
    }
  }

  private getBackupFilePath(id: string): string {
    return path.join(this.codeBackupDir, `${id}.json`);
  }

  async getCodeBackups(): Promise<CodeBackup[]> {
    try {
      this.ensureBackupDir();
      const files = fs.readdirSync(this.codeBackupDir).filter((f: string) => f.endsWith(".json"));

      const backups: CodeBackup[] = [];
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.codeBackupDir, file), "utf-8");
          const backup = JSON.parse(content);
          backups.push(backup);
        } catch (e) { }
      }

      return backups.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (e) {
      return [];
    }
  }

  async getCodeBackupById(id: string): Promise<CodeBackup | null> {
    try {
      const filePath = this.getBackupFilePath(id);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch (e) {
      return null;
    }
  }

  async createCodeBackup(backup: InsertCodeBackup): Promise<CodeBackup> {
    try {
      const id = `CODE-BACKUP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newBackup: CodeBackup = {
        id,
        ...backup,
        createdAt: new Date().toISOString(),
      };

      this.ensureBackupDir();
      const filePath = this.getBackupFilePath(id);
      fs.writeFileSync(filePath, JSON.stringify(newBackup, null, 2), "utf-8");

      return newBackup;
    } catch (e) {
      throw new Error(`Failed to create code backup: ${e}`);
    }
  }

  async deleteCodeBackup(id: string): Promise<void> {
    try {
      const filePath = this.getBackupFilePath(id);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      throw new Error(`Failed to delete code backup: ${e}`);
    }
  }
}

const firebaseStorage = new FirebaseStorage();
const googleSheetsStorage = new GoogleSheetsStorage();

// Export the storage instance based on per-request context
export const storage = new Proxy(firebaseStorage as IStorage, {
  get(target, prop, receiver) {
    const context = dbContext.getStore();
    const service = context?.dbService;

    // Select storage implementation based on the active service
    const activeStorage = (service === firebaseService) ? firebaseStorage : googleSheetsStorage;

    const value = Reflect.get(activeStorage, prop, receiver);
    if (typeof value === "function") {
      return value.bind(activeStorage);
    }
    return value;
  }
});
