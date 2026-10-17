import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { activeFirestore as db } from "../config/dataEnvironment";

const COLLECTION = "owner_inquiry_notes";

export type OwnerInquiryNote = {
  inquiryId: string;
  propertyNumber: string;
  note: string;
  updatedAt: string;
};

function documentId(propertyNumber: string, inquiryId: string): string {
  return createHash("sha256")
    .update(`${propertyNumber}:${inquiryId}`)
    .digest("hex");
}

export class OwnerInquiryNoteService {
  constructor(private readonly database: Firestore | null) {}

  private collection() {
    if (!this.database) throw new Error("Firestore is not configured");
    return this.database.collection(COLLECTION);
  }

  async listForProperty(propertyNumber: string): Promise<OwnerInquiryNote[]> {
    const snapshot = await this.collection()
      .where("propertyNumber", "==", propertyNumber)
      .get();
    return snapshot.docs
      .map((document) => document.data() as OwnerInquiryNote)
      .filter((note) => note.propertyNumber === propertyNumber);
  }

  async save(options: {
    propertyNumber: string;
    inquiryId: string;
    note: string;
    now?: Date;
  }): Promise<OwnerInquiryNote | null> {
    const ref = this.collection().doc(
      documentId(options.propertyNumber, options.inquiryId),
    );
    const note = options.note.trim();
    if (!note) {
      await ref.delete();
      return null;
    }
    const value: OwnerInquiryNote = {
      inquiryId: options.inquiryId,
      propertyNumber: options.propertyNumber,
      note,
      updatedAt: (options.now || new Date()).toISOString(),
    };
    await ref.set(value);
    return value;
  }
}

export const ownerInquiryNoteService = new OwnerInquiryNoteService(db);
