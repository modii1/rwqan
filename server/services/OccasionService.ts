/**
 * OccasionService
 * Manages occasions (Eid, National Day, etc.) and their property assignments.
 */

import { db } from "../config/firebase";
import type { Occasion, InsertOccasion, OccasionProperty, InsertOccasionProperty } from "../../shared/schema";
import { getNowInRiyadh, toRiyadhISO } from "../utils/dateUtils";

class OccasionService {
  private get db() {
    if (!db) throw new Error("Firebase not initialized");
    return db;
  }

  // ─── Occasions CRUD ─────────────────────────────────────────────────────────

  async getAllOccasions(): Promise<Occasion[]> {
    const snapshot = await this.db.collection("occasions").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Occasion));
  }

  async getActiveOccasions(): Promise<Occasion[]> {
    const now = toRiyadhISO(getNowInRiyadh());
    const snapshot = await this.db.collection("occasions")
      .where("isActive", "==", true)
      .get();
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Occasion))
      .filter(o => o.endDate >= now);
  }

  async getOccasionById(id: string): Promise<Occasion | null> {
    const doc = await this.db.collection("occasions").doc(id).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as Occasion) : null;
  }

  async getOccasionBySlug(slug: string): Promise<Occasion | null> {
    const snapshot = await this.db.collection("occasions")
      .where("slug", "==", slug)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as Occasion;
  }

  async createOccasion(data: InsertOccasion): Promise<Occasion> {
    const now = toRiyadhISO(getNowInRiyadh());
    const docRef = this.db.collection("occasions").doc();
    const occasion: Occasion = {
      ...data,
      id: docRef.id,
      createdAt: now,
      updatedAt: now,
    };
    await docRef.set(occasion);
    return occasion;
  }

  async updateOccasion(id: string, updates: Partial<Occasion>): Promise<Occasion> {
    const now = toRiyadhISO(getNowInRiyadh());
    const ref = this.db.collection("occasions").doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new Error(`Occasion not found: ${id}`);
    
    const updated = { ...doc.data(), ...updates, updatedAt: now } as Occasion;
    await ref.update({ ...updates, updatedAt: now });
    return updated;
  }

  async deleteOccasion(id: string): Promise<void> {
    // Delete all associated occasion_properties
    const propsSnapshot = await this.db.collection("occasion_properties")
      .where("occasionId", "==", id)
      .get();
    const batch = this.db.batch();
    propsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(this.db.collection("occasions").doc(id));
    await batch.commit();
  }

  // ─── Occasion Properties CRUD ───────────────────────────────────────────────

  async getOccasionProperties(occasionId: string): Promise<OccasionProperty[]> {
    const snapshot = await this.db.collection("occasion_properties")
      .where("occasionId", "==", occasionId)
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OccasionProperty));
  }

  async getPropertyOccasions(propertyNumber: string): Promise<OccasionProperty[]> {
    const snapshot = await this.db.collection("occasion_properties")
      .where("propertyNumber", "==", propertyNumber)
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OccasionProperty));
  }

  async getOccasionProperty(occasionId: string, propertyNumber: string): Promise<OccasionProperty | null> {
    const snapshot = await this.db.collection("occasion_properties")
      .where("occasionId", "==", occasionId)
      .where("propertyNumber", "==", propertyNumber)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as OccasionProperty;
  }

  async addPropertyToOccasion(data: InsertOccasionProperty): Promise<OccasionProperty> {
    const now = toRiyadhISO(getNowInRiyadh());
    
    // Check if already exists
    const existing = await this.getOccasionProperty(data.occasionId, data.propertyNumber);
    if (existing) {
      // Update instead
      return this.updateOccasionProperty(existing.id, data);
    }

    const docRef = this.db.collection("occasion_properties").doc();
    const occasionProperty: OccasionProperty = {
      ...data,
      id: docRef.id,
      createdAt: now,
      updatedAt: now,
    };
    await docRef.set(occasionProperty);
    return occasionProperty;
  }

  async updateOccasionProperty(id: string, updates: Partial<OccasionProperty>): Promise<OccasionProperty> {
    const now = toRiyadhISO(getNowInRiyadh());
    const ref = this.db.collection("occasion_properties").doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new Error(`OccasionProperty not found: ${id}`);
    
    const updated = { ...doc.data(), ...updates, updatedAt: now } as OccasionProperty;
    await ref.update({ ...updates, updatedAt: now });
    return updated;
  }

  async removePropertyFromOccasion(occasionId: string, propertyNumber: string): Promise<void> {
    const snapshot = await this.db.collection("occasion_properties")
      .where("occasionId", "==", occasionId)
      .where("propertyNumber", "==", propertyNumber)
      .get();
    const batch = this.db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  async bulkAddProperties(occasionId: string, propertyNumbers: string[], addedBy: 'admin' | 'owner' = 'admin'): Promise<OccasionProperty[]> {
    const occasion = await this.getOccasionById(occasionId);
    if (!occasion) throw new Error(`Occasion not found: ${occasionId}`);

    const results: OccasionProperty[] = [];
    for (const propertyNumber of propertyNumbers) {
      // Default all days to available
      const availability: Record<string, boolean> = {};
      const prices: Record<string, string> = {};
      occasion.days.forEach(day => {
        availability[day.key] = true;
        prices[day.key] = "";
      });

      const op = await this.addPropertyToOccasion({
        occasionId,
        propertyNumber,
        availability,
        prices,
        addedBy,
        approvedByAdmin: addedBy === 'admin',
      });
      results.push(op);
    }
    return results;
  }

  // ─── Public Queries ─────────────────────────────────────────────────────────

  async getActiveOccasionWithProperties(): Promise<{ occasion: Occasion; properties: OccasionProperty[] } | null> {
    const occasions = await this.getActiveOccasions();
    if (occasions.length === 0) return null;

    // Return the first active occasion (could be enhanced to find the most relevant)
    const occasion = occasions[0];
    const properties = await this.getOccasionProperties(occasion.id);
    // Only return approved properties
    const approved = properties.filter(p => p.approvedByAdmin);
    return { occasion, properties: approved };
  }
}

export const occasionService = new OccasionService();
