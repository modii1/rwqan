import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

import { activeFirestore as db } from "../config/dataEnvironment";

const COLLECTION = "owner_inquiry_visibility";

export type OwnerInquiryVisibilityRecord = {
  propertyNumber: string;
  inquiryId: string;
  contactRequestId: string;
  bookingId: string | null;
  hiddenAt: string;
};

function documentId(propertyNumber: string, inquiryId: string): string {
  return createHash("sha256")
    .update(`${propertyNumber}:${inquiryId}`)
    .digest("hex");
}

/**
 * Owner deletion is intentionally an owner-scoped hide operation. The source
 * request and booking remain intact for customer history, compliance and
 * operational audit purposes.
 */
export class OwnerInquiryVisibilityService {
  constructor(private readonly database: Firestore | null) {}

  private collection() {
    if (!this.database) throw new Error("Firestore is not configured");
    return this.database.collection(COLLECTION);
  }

  async listHiddenForProperty(
    propertyNumber: string,
  ): Promise<OwnerInquiryVisibilityRecord[]> {
    const snapshot = await this.collection()
      .where("propertyNumber", "==", propertyNumber)
      .get();
    return snapshot.docs
      .map((document) => document.data() as OwnerInquiryVisibilityRecord)
      .filter((record) =>
        record.propertyNumber === propertyNumber && Boolean(record.hiddenAt)
      );
  }

  async hide(options: {
    propertyNumber: string;
    inquiryId: string;
    contactRequestId: string;
    bookingId?: string | null;
    now?: Date;
  }): Promise<OwnerInquiryVisibilityRecord> {
    const value: OwnerInquiryVisibilityRecord = {
      propertyNumber: options.propertyNumber,
      inquiryId: options.inquiryId,
      contactRequestId: options.contactRequestId,
      bookingId: options.bookingId || null,
      hiddenAt: (options.now || new Date()).toISOString(),
    };
    await this.collection()
      .doc(documentId(options.propertyNumber, options.inquiryId))
      .set(value);
    return value;
  }
}

export const ownerInquiryVisibilityService =
  new OwnerInquiryVisibilityService(db);
