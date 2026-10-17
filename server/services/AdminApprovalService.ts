import type { Property } from "../../shared/schema";
import { firebaseService } from "../firebaseService";
import {
  AdminApprovalError,
  contextualizeAdminApprovalError,
} from "../errors/AdminApprovalError";
import {
  R2ImageStorageUnavailableError,
  countR2ImagesStrict,
} from "../utils/r2";
import {
  checkPropertyDataComplete,
  type PropertyDataCheckResult,
} from "../utils/verification";

export type AdminApprovalServiceDependencies = {
  getProperty: (propertyNumber: string) => Promise<Property | null>;
  countImages: (propertyNumber: string) => Promise<number>;
  checkProperty: (
    property: Property,
    imageCount: number,
  ) => Promise<PropertyDataCheckResult>;
};

const defaultDependencies: AdminApprovalServiceDependencies = {
  getProperty: (propertyNumber) =>
    firebaseService.getPropertyByNumber(propertyNumber),
  countImages: countR2ImagesStrict,
  checkProperty: checkPropertyDataComplete,
};

export class AdminApprovalService {
  constructor(
    private readonly dependencies: AdminApprovalServiceDependencies =
      defaultDependencies,
  ) {}

  async requireCompleteProperty(propertyNumber: string): Promise<{
    property: Property;
    imageCount: number;
    validation: PropertyDataCheckResult;
  }> {
    let property: Property | null;
    try {
      property = await this.dependencies.getProperty(propertyNumber);
    } catch (error) {
      throw contextualizeAdminApprovalError(error, {
        status: 503,
        code: "PROPERTY_LOOKUP_FAILED",
        message:
          "تعذر تحميل بيانات العقار حالياً. تحقق من الاتصال بقاعدة البيانات ثم حاول مرة أخرى.",
      });
    }
    if (!property) {
      throw new AdminApprovalError({
        status: 404,
        code: "PROPERTY_NOT_FOUND",
        message: "العقار المطلوب غير موجود.",
      });
    }

    let imageCount: number;
    try {
      imageCount = await this.dependencies.countImages(propertyNumber);
    } catch (error) {
      if (error instanceof R2ImageStorageUnavailableError) {
        throw new AdminApprovalError({
          status: 503,
          code: "IMAGE_STORAGE_UNAVAILABLE",
          message:
            "تعذر التحقق من صور العقار حالياً. تحقق من إعدادات تخزين الصور أو حاول مرة أخرى لاحقاً.",
        });
      }
      throw error;
    }

    let validation: PropertyDataCheckResult;
    try {
      validation = await this.dependencies.checkProperty(property, imageCount);
    } catch (error) {
      throw contextualizeAdminApprovalError(error, {
        status: 500,
        code: "PROPERTY_VALIDATION_FAILED",
        message:
          "تعذر فحص اكتمال بيانات العقار. راجع البيانات وحاول مرة أخرى.",
      });
    }
    if (!validation.isComplete) {
      throw new AdminApprovalError({
        status: 422,
        code: "PROPERTY_INCOMPLETE",
        message: `لا يمكن قبول العقار قبل استكمال البيانات المطلوبة: ${validation.missingFields.join("، ")}`,
        missingFields: validation.missingFields,
        warnings: validation.warnings,
      });
    }

    return { property, imageCount, validation };
  }

  /**
   * Validate every linked property and report all linked blockers together.
   * Prefixing each field with its property number keeps the dashboard reason
   * actionable when a payment covers several properties.
   */
  async requireCompleteLinkedProperties(
    propertyNumbers: string[],
  ): Promise<void> {
    const failures: Array<{
      propertyNumber: string;
      error: AdminApprovalError;
    }> = [];

    for (const propertyNumber of Array.from(new Set(propertyNumbers))) {
      try {
        await this.requireCompleteProperty(propertyNumber);
      } catch (error) {
        failures.push({
          propertyNumber,
          error:
            error instanceof AdminApprovalError
              ? error
              : contextualizeAdminApprovalError(error, {
                  status: 500,
                  code: "PROPERTY_VALIDATION_FAILED",
                  message:
                    "تعذر فحص اكتمال بيانات العقار المرتبط. راجع بياناته وحاول مرة أخرى.",
                }),
        });
      }
    }

    if (failures.length === 0) return;

    const firstFailure = failures[0].error;
    throw new AdminApprovalError({
      status: firstFailure.status,
      code: firstFailure.code,
      message: `لا يمكن قبول المجموعة قبل معالجة العقارات المرتبطة التالية: ${failures
        .map(
          ({ propertyNumber, error }) =>
            `${propertyNumber}: ${error.message}`,
        )
        .join(" | ")}`,
      missingFields: failures.flatMap(({ propertyNumber, error }) =>
        (error.missingFields ?? []).map(
          (field) => `${propertyNumber}: ${field}`,
        ),
      ),
      warnings: failures.flatMap(({ propertyNumber, error }) =>
        (error.warnings ?? []).map(
          (warning) => `${propertyNumber}: ${warning}`,
        ),
      ),
    });
  }
}

export const adminApprovalService = new AdminApprovalService();
