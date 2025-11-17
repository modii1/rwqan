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
} from "@shared/schema";

export interface IStorage {
  // Properties (العقارات)
  getProperties(): Promise<Property[]>;
  getPropertyByNumber(propertyNumber: string): Promise<Property | null>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(propertyNumber: string, property: Partial<Property>): Promise<Property>;
  deleteProperty(propertyNumber: string): Promise<void>;

  // Subscriptions (الاشتراكات)
  getSubscriptions(): Promise<Subscription[]>;
  getSubscriptionsByProperty(propertyNumber: string): Promise<Subscription[]>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, subscription: Partial<Subscription>): Promise<Subscription>;
  
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
  createRequest(request: InsertRequest): Promise<Request>;

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
}

import { googleSheetsService } from './googleSheets';

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

  async deleteProperty(propertyNumber: string): Promise<void> {
    return googleSheetsService.deleteProperty(propertyNumber);
  }

  async getSubscriptions(): Promise<Subscription[]> {
    return googleSheetsService.getSubscriptions();
  }

  async getSubscriptionsByProperty(propertyNumber: string): Promise<Subscription[]> {
    const subscriptions = await googleSheetsService.getSubscriptions();
    return subscriptions.filter(s => s.propertyNumber === propertyNumber);
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    return googleSheetsService.createSubscription(subscription);
  }

  async updateSubscription(id: string, subscription: Partial<Subscription>): Promise<Subscription> {
    return googleSheetsService.updateSubscription(id, subscription);
  }

  async getPackages(): Promise<Package[]> {
    return googleSheetsService.getPackages();
  }

  async getPackageById(id: string): Promise<Package | null> {
    const packages = await googleSheetsService.getPackages();
    return packages.find(p => p.id === id) || null;
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
    // Will be implemented
    return [];
  }

  async createRequest(request: InsertRequest): Promise<Request> {
    return googleSheetsService.createRequest(request);
  }

  async getSuggestions(): Promise<Suggestion[]> {
    // Will be implemented
    return [];
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

  async getAnalytics(): Promise<Analytics | null> {
    // Will be implemented
    return null;
  }

  async updateAnalytics(analytics: Analytics): Promise<void> {
    // Will be implemented
  }
}

export const storage = new GoogleSheetsStorage();
