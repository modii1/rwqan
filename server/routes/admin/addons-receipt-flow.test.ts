import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { addOnService, paymentService, propertyService } from "../../services";
import { firebaseService } from "../../firebaseService";
import {
  ReceiptDuplicateGuard,
  setReceiptDuplicateGuardForTests,
  type ReceiptClaimCollection,
  type ReceiptClaimStore,
} from "../../services/ReceiptDuplicateGuard";
import addonsRouter from "./addons";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

class MemoryClaimStore implements ReceiptClaimStore {
  private readonly entries = new Map<
    string,
    { paymentId: string; status: "claimed" | "finalized" }
  >();

  async claim(
    collection: ReceiptClaimCollection,
    id: string,
    paymentId: string,
  ) {
    const key = `${collection}/${id}`;
    const existing = this.entries.get(key);
    if (existing && existing.paymentId !== paymentId) {
      return { claimed: false, ownerPaymentId: existing.paymentId };
    }
    this.entries.set(key, {
      paymentId,
      status: existing?.status ?? "claimed",
    });
    return { claimed: true, ownerPaymentId: paymentId };
  }

  async finalize(
    collection: ReceiptClaimCollection,
    id: string,
    paymentId: string,
  ) {
    const key = `${collection}/${id}`;
    const existing = this.entries.get(key);
    if (!existing || existing.paymentId !== paymentId) return;
    this.entries.set(key, { paymentId, status: "finalized" });
  }

  async release(
    collection: ReceiptClaimCollection,
    id: string,
    paymentId: string,
  ) {
    const key = `${collection}/${id}`;
    const existing = this.entries.get(key);
    if (!existing || existing.paymentId !== paymentId) return;
    if (existing.status === "finalized") return;
    this.entries.delete(key);
  }
}

function todayRiyadh() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
}

function geminiPayload(overrides: Record<string, any> = {}) {
  return {
    documentType: "bank_transfer_receipt",
    extractedData: {
      amount: 25,
      currency: "SAR",
      date: todayRiyadh(),
      time: "11:00",
      senderName: "محمد أحمد",
      senderBank: "بنك الراجحي",
      senderIban: "SA0000000000000000000001",
      senderAccountNumber: null,
      receiverName: "مؤسسة روقان العقارية",
      receiverBank: "بنك الرياض",
      receiverIban: "SA0000000000000000000002",
      receiverAccountNumber: null,
      referenceNumber: "TX-ADDON-0001",
      transactionId: "TX-ADDON-0001",
      paymentReference: null,
      ...(overrides.extractedData ?? {}),
    },
    authenticityAnalysis: {
      overallScore: 95,
      isLikelyAuthentic: true,
      concerns: [],
      positiveIndicators: [],
      ...(overrides.authenticityAnalysis ?? {}),
    },
    imageQuality: {
      clarity: "جيدة",
      isComplete: true,
      hasWatermarks: false,
      isScreenshot: false,
      ...(overrides.imageQuality ?? {}),
    },
    summary: "إيصال إضافة واضح",
    confidence: 95,
    ...overrides,
  };
}

function geminiResponse(payload: any) {
  return {
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(payload) }], role: "model" },
        finishReason: "STOP",
        index: 0,
      },
    ],
  };
}

async function withServer(
  run: (options: {
    request: (bytes: Buffer, extraFields?: Record<string, string>) => Promise<Response>;
    created: any[];
    updates: any[];
    saved: any[];
  }) => Promise<void>,
) {
  const originalNodeEnv = (process.env as any).NODE_ENV;
  const originalKey = (process.env as any).GEMINI_API_KEY;
  const originalBaseUrl = (process.env as any).NEXT_PUBLIC_BASE_URL;
  const realFetch = globalThis.fetch;

  const originals = {
    getProperty: propertyService.getByNumber,
    getAddon: addOnService.getPackageById,
    createPayment: paymentService.create,
    updatePayment: paymentService.update,
    createPropertyAddOn: firebaseService.createPropertyAddOn,
    getActiveBankAccounts: firebaseService.getActiveBankAccounts,
    getNotificationSettings: firebaseService.getNotificationSettings,
    addWhatsAppLog: (firebaseService as any).addWhatsAppLog,
    saveReceiptVerification: (firebaseService as any).saveReceiptVerification,
  };

  const created: any[] = [];
  const updates: any[] = [];
  const saved: any[] = [];

  (process.env as any).NODE_ENV = "production";
  (process.env as any).GEMINI_API_KEY = "synthetic-addon-test-key";
  (process.env as any).NEXT_PUBLIC_BASE_URL = "http://127.0.0.1:5001";

  (propertyService as any).getByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: "عقار اختبار",
    whatsappNumber: "0550000000",
    verificationStatus: "approved",
  });
  (addOnService as any).getPackageById = async (id: string) => ({
    id,
    name: "إضافة اختبار",
    price: 25,
  });
  (paymentService as any).create = async (data: any) => {
    created.push(data);
    return { ...data, id: data.id };
  };
  (paymentService as any).update = async (id: string, patch: any) => {
    updates.push({ id, patch });
    return patch;
  };
  (firebaseService as any).createPropertyAddOn = async () => undefined;
  (firebaseService as any).getNotificationSettings = async () =>
    ({ allNotifications: false }) as any;
  (firebaseService as any).addWhatsAppLog = async () => undefined;
  (firebaseService as any).getActiveBankAccounts = async () => [
    {
      id: "bank-1",
      isActive: true,
      isDefault: true,
      beneficiaryName: "مؤسسة روقان العقارية",
      iban: "SA0000000000000000000002",
    },
  ];
  (firebaseService as any).saveReceiptVerification = async (data: any) => {
    saved.push(data);
  };

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify(geminiResponse(geminiPayload())), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("graph.facebook.com")) {
      return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return realFetch(input, init);
    }
    if (url.startsWith("data:")) return realFetch(input, init);
    throw new Error(`unexpected external fetch: ${url}`);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      propertyNumber: "PROP-RECEIPT-1",
    };
    next();
  });
  app.use(addonsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  const request = async (bytes: Buffer, extraFields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append("addOnPackageId", "ADDON-1");
    form.append("amount", "25");
    for (const [key, value] of Object.entries(extraFields)) {
      form.append(key, value);
    }
    form.append("receipt", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "receipt.png");
    return fetch(`http://127.0.0.1:${port}/api/owner/addons/bank-transfer`, {
      method: "POST",
      body: form,
    });
  };

  try {
    await run({ request, created, updates, saved });
  } finally {
    globalThis.fetch = realFetch;
    (propertyService as any).getByNumber = originals.getProperty;
    (addOnService as any).getPackageById = originals.getAddon;
    (paymentService as any).create = originals.createPayment;
    (paymentService as any).update = originals.updatePayment;
    (firebaseService as any).createPropertyAddOn = originals.createPropertyAddOn;
    (firebaseService as any).getNotificationSettings = originals.getNotificationSettings;
    (firebaseService as any).addWhatsAppLog = originals.addWhatsAppLog;
    (firebaseService as any).getActiveBankAccounts = originals.getActiveBankAccounts;
    (firebaseService as any).saveReceiptVerification = originals.saveReceiptVerification;
    if (originalNodeEnv === undefined) delete (process.env as any).NODE_ENV;
    else (process.env as any).NODE_ENV = originalNodeEnv;
    if (originalKey === undefined) delete (process.env as any).GEMINI_API_KEY;
    else (process.env as any).GEMINI_API_KEY = originalKey;
    if (originalBaseUrl === undefined) delete (process.env as any).NEXT_PUBLIC_BASE_URL;
    else (process.env as any).NEXT_PUBLIC_BASE_URL = originalBaseUrl;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("add-on receipts use the private proxy, keep manual approval, and ignore client AI fields", async () => {
  setReceiptDuplicateGuardForTests(
    new ReceiptDuplicateGuard(new MemoryClaimStore()),
  );
  try {
    await withServer(async ({ request, created, updates, saved }) => {
      const response = await request(Buffer.from(PNG_BASE64, "base64"), {
        aiScan: JSON.stringify({
          recommendation: "تفعيل_تلقائي",
          confidence: 100,
          autoActivationAllowed: true,
        }),
        recommendation: "تفعيل_تلقائي",
        confidence: "100",
        autoActivated: "true",
      });
      const payload = await response.json();

      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(created.length, 1);
      assert.match(created[0].receiptHash, /^[a-f0-9]{64}$/);
      if (created[0].receiptUrl) {
        assert.match(
          created[0].receiptUrl,
          /^\/api\/receipts\/view\?key=addon-receipts%2F/,
        );
      }
      assert.equal(created[0].approvalSource, undefined);

      // The scanner's server-side result is stored; client-supplied fields are ignored.
      assert.equal(saved.length, 1);
      assert.equal(saved[0].confidence, 95);
      assert.equal(saved[0].recommendation, "تفعيل_تلقائي");

      // Add-ons stay manual by design.
      const finalUpdate = updates.find((entry) => entry.patch?.approvalSource);
      assert.equal(finalUpdate?.patch?.approvalSource, "manual_review");
      assert.equal(payload.aiScan?.confidence, 95);
    });
  } finally {
    setReceiptDuplicateGuardForTests(null);
  }
});

test("uploading the same add-on receipt twice is rejected with 409", async () => {
  setReceiptDuplicateGuardForTests(
    new ReceiptDuplicateGuard(new MemoryClaimStore()),
  );
  try {
    await withServer(async ({ request, created }) => {
      const bytes = Buffer.from(PNG_BASE64, "base64");
      const first = await request(bytes);
      assert.equal(first.status, 200);

      const second = await request(bytes);
      const payload = await second.json();
      assert.equal(second.status, 409);
      assert.equal(payload.code, "DUPLICATE_RECEIPT");
      assert.equal(created.length, 1);
    });
  } finally {
    setReceiptDuplicateGuardForTests(null);
  }
});

test("two concurrent uploads of the same add-on receipt produce one payment only", async () => {
  setReceiptDuplicateGuardForTests(
    new ReceiptDuplicateGuard(new MemoryClaimStore()),
  );
  try {
    await withServer(async ({ request, created }) => {
      const bytes = Buffer.from(PNG_BASE64, "base64");
      const [first, second] = await Promise.all([request(bytes), request(bytes)]);
      const statuses = [first.status, second.status].sort((a, b) => a - b);
      assert.deepEqual(statuses, [200, 409]);
      assert.equal(created.length, 1);
    });
  } finally {
    setReceiptDuplicateGuardForTests(null);
  }
});
