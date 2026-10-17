import assert from "node:assert/strict";
import test from "node:test";

import type { Property } from "../../shared/schema";
import { AdminApprovalError } from "../errors/AdminApprovalError";
import { countR2ImagesStrict } from "../utils/r2";
import type { PropertyDataCheckResult } from "../utils/verification";
import { AdminApprovalService } from "./AdminApprovalService";

const property = {
  propertyNumber: "12345",
  name: "Test property",
} as Property;

const completeValidation: PropertyDataCheckResult = {
  isComplete: true,
  missingFields: [],
  warnings: [],
  completionScore: 100,
};

test("requireCompleteProperty returns a structured 404 before checking images", async () => {
  let imageCountCalls = 0;
  let validationCalls = 0;
  const service = new AdminApprovalService({
    getProperty: async () => null,
    countImages: async () => {
      imageCountCalls += 1;
      return 3;
    },
    checkProperty: async () => {
      validationCalls += 1;
      return completeValidation;
    },
  });

  await assert.rejects(
    () => service.requireCompleteProperty("missing-property"),
    (error: unknown) => {
      assert.ok(error instanceof AdminApprovalError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "PROPERTY_NOT_FOUND");
      return true;
    },
  );
  assert.equal(imageCountCalls, 0);
  assert.equal(validationCalls, 0);
});

test("requireCompleteProperty preserves exact missing fields and warnings in a 422", async () => {
  const missingFields = ["property name", "images (0/3 minimum)"];
  const warnings = ["no price", "direction missing"];
  const validation: PropertyDataCheckResult = {
    isComplete: false,
    missingFields,
    warnings,
    completionScore: 20,
  };
  let receivedImageCount: number | undefined;
  const service = new AdminApprovalService({
    getProperty: async () => property,
    countImages: async () => 0,
    checkProperty: async (receivedProperty, imageCount) => {
      assert.equal(receivedProperty, property);
      receivedImageCount = imageCount;
      return validation;
    },
  });

  await assert.rejects(
    () => service.requireCompleteProperty(property.propertyNumber),
    (error: unknown) => {
      assert.ok(error instanceof AdminApprovalError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "PROPERTY_INCOMPLETE");
      assert.deepEqual(error.missingFields, missingFields);
      assert.deepEqual(error.warnings, warnings);
      return true;
    },
  );
  assert.equal(receivedImageCount, 0);
});

test("requireCompleteProperty returns the property, live image count, and validation when complete", async () => {
  const service = new AdminApprovalService({
    getProperty: async () => property,
    countImages: async () => 4,
    checkProperty: async (_property, imageCount) => {
      assert.equal(imageCount, 4);
      return completeValidation;
    },
  });

  const result = await service.requireCompleteProperty(property.propertyNumber);

  assert.equal(result.property, property);
  assert.equal(result.imageCount, 4);
  assert.equal(result.validation, completeValidation);
});

test("requireCompleteProperty maps missing R2 configuration and R2 outages to a structured 503", async () => {
  const unavailableCounters = [
    () =>
      countR2ImagesStrict(property.propertyNumber, {
        client: null,
        bucket: "configured-bucket",
      }),
    () =>
      countR2ImagesStrict(property.propertyNumber, {
        client: {
          send: async () => {
            throw new Error("network timeout");
          },
        },
        bucket: "configured-bucket",
      }),
  ];

  for (const countImages of unavailableCounters) {
    let validationCalls = 0;
    const service = new AdminApprovalService({
      getProperty: async () => property,
      countImages,
      checkProperty: async () => {
        validationCalls += 1;
        return completeValidation;
      },
    });

    await assert.rejects(
      () => service.requireCompleteProperty(property.propertyNumber),
      (error: unknown) => {
        assert.ok(error instanceof AdminApprovalError);
        assert.equal(error.status, 503);
        assert.equal(error.code, "IMAGE_STORAGE_UNAVAILABLE");
        assert.ok(!error.message.includes("network timeout"));
        return true;
      },
    );
    assert.equal(validationCalls, 0);
  }
});

test("linked-property validation reports every property with prefixed blockers", async () => {
  const properties = new Map<string, Property>([
    ["LINK-1", { ...property, propertyNumber: "LINK-1" } as Property],
    ["LINK-2", { ...property, propertyNumber: "LINK-2" } as Property],
  ]);
  const service = new AdminApprovalService({
    getProperty: async (propertyNumber) => properties.get(propertyNumber) ?? null,
    countImages: async (propertyNumber) => (propertyNumber === "LINK-1" ? 1 : 3),
    checkProperty: async (linkedProperty, imageCount) => ({
      isComplete: false,
      missingFields:
        linkedProperty.propertyNumber === "LINK-1"
          ? [`images (${imageCount}/3 minimum)`]
          : ["location"],
      warnings:
        linkedProperty.propertyNumber === "LINK-2" ? ["direction"] : [],
      completionScore: 50,
    }),
  });

  await assert.rejects(
    () => service.requireCompleteLinkedProperties(["LINK-1", "LINK-2"]),
    (error: unknown) => {
      assert.ok(error instanceof AdminApprovalError);
      assert.equal(error.code, "PROPERTY_INCOMPLETE");
      assert.match(error.message, /LINK-1/);
      assert.match(error.message, /LINK-2/);
      assert.deepEqual(error.missingFields, [
        "LINK-1: images (1/3 minimum)",
        "LINK-2: location",
      ]);
      assert.deepEqual(error.warnings, ["LINK-2: direction"]);
      return true;
    },
  );
});
