import assert from "node:assert/strict";
import test from "node:test";

import { bookingFreeWorkflowLimitsSchema } from "../../shared/booking";
import { feeConfigSchema, notificationSettingsSchema } from "../../shared/schema";
import {
  CODE_ONLY_RUNTIME_COLLECTIONS,
  PROD_COLLECTION_NAMES,
  PROD_SCHEMA,
  SEEDED_COLLECTIONS,
  getSchemaEntry,
} from "./prodSchemaCatalog";

function sampleData(collection: string, id: string): Record<string, unknown> {
  const entry = getSchemaEntry(collection);
  const doc = entry?.sampleDocs?.find((candidate) => candidate.id === id);
  assert.ok(doc, `missing sample ${collection}/${id}`);
  const { testData: _t, schemaParitySeed: _s, ...data } = doc.data;
  return data;
}

const MARKER_FIELDS = new Set(["testData", "schemaParitySeed"]);
const REAL_PHONE = /(^|[^0-9])(?:\+?9665\d{8}|05\d{8})([^0-9]|$)/;
const REAL_IBAN = /SA\d{2}[A-Z0-9]{20}/;

function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringValues(item, out));
  else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectStringValues(item, out),
    );
  }
  return out;
}

test("the catalog mirrors the verified production collection set", () => {
  // 54 collections were observed with a read-only probe against rwqan-757.
  assert.equal(PROD_SCHEMA.length, 54);
  assert.equal(PROD_COLLECTION_NAMES.length, 54);
  assert.equal(new Set(PROD_COLLECTION_NAMES).size, 54, "collection names must be unique");
});

const DOCUMENTED_DRIFT = [
  "requests", "ocr_results", "suggestions", "expenses", "property_addons",
] as const;

test("verified production-vs-code drift is documented, not silently patched", () => {
  for (const collection of DOCUMENTED_DRIFT) {
    const entry = getSchemaEntry(collection);
    assert.ok(entry, `${collection} missing from catalog`);
    assert.ok(
      (entry.note ?? "").length > 0,
      `${collection} has verified field drift but no note explaining it`,
    );
  }
});

test("lazily-created runtime collections stay outside the verified PROD set", () => {
  assert.ok(CODE_ONLY_RUNTIME_COLLECTIONS.length > 0);
  for (const entry of CODE_ONLY_RUNTIME_COLLECTIONS) {
    assert.ok(entry.fields.length > 0, `${entry.collection} must declare fields`);
    assert.ok(!PROD_COLLECTION_NAMES.includes(entry.collection), `${entry.collection} must not appear in PROD_SCHEMA`);
    assert.ok(entry.note.length > 0, `${entry.collection} must document why it is absent from PROD`);
  }
  // Never pre-seeded: they hold security/limit state.
  for (const entry of CODE_ONLY_RUNTIME_COLLECTIONS) {
    assert.ok(!SEEDED_COLLECTIONS.includes(entry.collection));
  }
});

test("every collection records canonical field names without duplicates", () => {
  for (const entry of PROD_SCHEMA) {
    assert.ok(entry.fields.length > 0, `${entry.collection} must declare at least one field`);
    assert.equal(
      new Set(entry.fields).size,
      entry.fields.length,
      `${entry.collection} declares duplicate field names`,
    );
  }
});

test("only seeded collections carry sample documents", () => {
  for (const entry of PROD_SCHEMA) {
    const hasSamples = (entry.sampleDocs?.length ?? 0) > 0;
    if (entry.parity === "seeded") {
      assert.ok(hasSamples, `seeded collection ${entry.collection} must provide sampleDocs`);
    } else {
      assert.equal(hasSamples, false, `${entry.parity} collection ${entry.collection} must not provide sampleDocs`);
    }
  }
  assert.ok(SEEDED_COLLECTIONS.length > 0);
});

test("seeded document ids are single path segments", () => {
  for (const entry of PROD_SCHEMA) {
    for (const doc of entry.sampleDocs ?? []) {
      assert.ok(doc.id.length > 0, `${entry.collection} has an empty document id`);
      assert.ok(!doc.id.includes("/"), `${entry.collection} id "${doc.id}" must not contain "/"`);
    }
  }
});

test("seeded documents never invent fields absent from production", () => {
  for (const entry of PROD_SCHEMA) {
    const declared = new Set(entry.fields);
    for (const doc of entry.sampleDocs ?? []) {
      for (const key of Object.keys(doc.data)) {
        assert.ok(
          declared.has(key) || MARKER_FIELDS.has(key),
          `${entry.collection}/${doc.id} writes unknown field "${key}"`,
        );
      }
    }
  }
});

test("seeded settings documents satisfy the real server schemas", () => {
  notificationSettingsSchema.parse(sampleData("settings", "notification_settings"));
  const limits = sampleData("settings", "booking_free_workflow_limits");
  bookingFreeWorkflowLimitsSchema.parse({
    customerDailyLimit: limits.customerDailyLimit,
    freeOwnerDailyLimit: limits.freeOwnerDailyLimit,
    freePropertyContactDailyLimit: limits.freePropertyContactDailyLimit,
  });
  assert.equal(limits.schemaVersion, 1);
});

test("seeded fee_configs documents satisfy the real server schema", () => {
  for (const doc of getSchemaEntry("fee_configs")?.sampleDocs ?? []) {
    const { testData: _t, schemaParitySeed: _s, ...data } = doc.data;
    feeConfigSchema.parse(data);
  }
});

test("seeded sample values contain no real phone numbers or IBANs", () => {
  for (const entry of PROD_SCHEMA) {
    for (const doc of entry.sampleDocs ?? []) {
      for (const value of collectStringValues(doc.data)) {
        assert.ok(!REAL_PHONE.test(value), `${entry.collection}/${doc.id} looks like a real phone: ${value}`);
        assert.ok(!REAL_IBAN.test(value), `${entry.collection}/${doc.id} looks like a real IBAN: ${value}`);
      }
    }
  }
});
