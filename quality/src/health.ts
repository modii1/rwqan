import { QualityRunResult } from "./model";

export type HealthStatus = "GREEN" | "ORANGE" | "RED";

export interface HealthContext {
  quality: QualityRunResult;
  securitySummary?: {
    critical?: number;
    high?: number;
    total?: number;
  };
}

export function computeHealth(context: HealthContext): HealthStatus {
  if (context.quality.summary.criticalFailures > 0) {
    return "RED";
  }
  if (context.securitySummary?.critical && context.securitySummary.critical > 0) {
    return "RED";
  }
  if (context.quality.summary.fail > 0) {
    return "ORANGE";
  }
  if (context.securitySummary?.high && context.securitySummary.high > 0) {
    return "ORANGE";
  }
  return "GREEN";
}
