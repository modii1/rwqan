import { Router } from "express";
import { requireAdmin, requireSameOrigin } from "../middleware";
import {
  liveDataToolEnabled,
  readLiveDataConfig,
  liveWriteMode,
} from "../../config/liveDataEnvironment";
import {
  dataEnvironmentStore,
  type DataEnvironmentStore,
} from "../../services/LiveDataEnvironmentStore";
import { getActiveFirestoreProjectId } from "../../config/dataEnvironment";
import { syncR2Environment } from "../../utils/r2";
import { DEV_FIREBASE_PROJECT_ID } from "../../config/runtimeEnvironment";
import { firebaseService } from "../../firebaseService";
import { createLivePublicApiSource } from "../../services/LivePublicApiSource";
import {
  DATA_ENVIRONMENT_NOTICE,
  LIVE_DATA_DISABLED_BODY,
  LIVE_DATA_MAX_ITEMS,
  LIVE_DATA_UNAVAILABLE_BODY,
  type DataEnvironment,
  type LiveDataStatus,
} from "../../../shared/liveData";
import { LivePublicApiError } from "../../services/LivePublicApiSource";

/**
 * RWQAN — whole-application data-environment switch (DEV only).
 *
 * Guarded by the central `/api/admin` boundary plus this router's own
 * requireSameOrigin/requireAdmin/DEV gate. The active environment is server-side
 * state and defaults to TEST.
 *
 * Flipping to LIVE repoints the ENTIRE application (every page, API and service)
 * at the real production data sources via `config/dataEnvironment.ts` (Firestore)
 * and `utils/r2.ts` (images). Hard guarantees:
 *   - Switching to LIVE is refused (fail closed) unless a safe production
 *     configuration is present; production is never used in TEST, and the DEV
 *     project is never used as a silent substitute for production.
 *   - LIVE defaults to read-only; writes are rejected unless explicitly enabled.
 *   - Production credentials are never returned to the browser.
 */

export interface LiveDataRouterOptions {
  enabled?: () => boolean;
  environmentStore?: DataEnvironmentStore;
}

function isDataEnvironment(value: unknown): value is DataEnvironment {
  return value === "TEST" || value === "LIVE";
}

export function createAdminLiveDataRouter(options: LiveDataRouterOptions = {}) {
  const enabled = options.enabled ?? (() => liveDataToolEnabled());
  const store = options.environmentStore ?? dataEnvironmentStore;
  // Read-only production data via the PUBLIC rwqan.sa API (no Firestore key).
  const livePublicApi = createLivePublicApiSource({
    baseUrl: process.env.LIVE_PUBLIC_API_BASE_URL?.trim() || "https://rwqan.sa",
    timeoutMs: 15_000,
  });

  const router = Router();

  router.use("/api/admin/live", requireSameOrigin, requireAdmin);
  router.use("/api/admin/live", (_req, res, next) => {
    if (!enabled()) {
      res.status(404).json(LIVE_DATA_DISABLED_BODY);
      return;
    }
    next();
  });

  const buildStatus = (): LiveDataStatus => {
    const { config, reason } = readLiveDataConfig();
    const environment = store.get();
    const liveAvailable = config !== null;
    const liveProjectId = config?.firebase.projectId ?? null;
    const writeMode = liveWriteMode();
    const usingLive = environment === "LIVE" && liveAvailable;
    return {
      enabled: enabled(),
      environment,
      liveAvailable,
      liveUnavailableReason: liveAvailable ? "" : reason,
      liveProjectId,
      activeProjectId: getActiveFirestoreProjectId(store),
      writeMode,
      writeBlocked: usingLive && writeMode === "read-only",
      dataSources: usingLive
        ? {
            properties: `الإنتاج (${liveProjectId})`,
            subscriptions: `الإنتاج (${liveProjectId})`,
            images: config?.r2
              ? `مخزن صور الإنتاج · ${config.r2.bucketName}`
              : "غير مُهيَّأ",
          }
        : {
            properties: `التطوير المعزول · ${DEV_FIREBASE_PROJECT_ID}`,
            subscriptions: `التطوير المعزول · ${DEV_FIREBASE_PROJECT_ID}`,
            images: "مخزن صور التطوير المعزول",
          },
      environmentNotice: DATA_ENVIRONMENT_NOTICE[environment],
    };
  };

  router.get("/api/admin/live/status", (_req, res) => {
    res.set("Cache-Control", "no-store, private");
    res.json({ status: buildStatus() });
  });

  // Read-only production properties via the PUBLIC rwqan.sa API. Only meaningful
  // in LIVE mode; in TEST it returns the isolated DEV properties.
  router.get("/api/admin/live/properties", async (_req, res) => {
    res.set("Cache-Control", "no-store, private");
    const environment = store.get();
    try {
      const properties =
        environment === "LIVE"
          ? await livePublicApi.getProperties()
          : await firebaseService.getProperties();
      const items = properties.slice(0, LIVE_DATA_MAX_ITEMS);
      res.json({
        environment,
        source:
          environment === "LIVE"
            ? "الإنتاج ( rwqan.sa / واجهة عامة )"
            : "التطوير المعزول",
        total: properties.length,
        truncated: properties.length > LIVE_DATA_MAX_ITEMS,
        properties: items,
      });
    } catch (error) {
      if (error instanceof LivePublicApiError) {
        res.status(503).json({
          code: "LIVE_DATA_UNAVAILABLE",
          error: error.message,
        });
        return;
      }
      res.status(500).json({
        code: "LIVE_PROPERTIES_FAILED",
        error: "تعذّر تحميل العقارات.",
      });
    }
  });

  router.post("/api/admin/live/environment", (req, res) => {
    res.set("Cache-Control", "no-store, private");
    const environment = (req.body ?? {}).environment;
    if (!isDataEnvironment(environment)) {
      res.status(400).json({
        code: "INVALID_ENVIRONMENT",
        error: "قيمة البيئة غير صالحة (TEST أو LIVE).",
      });
      return;
    }

    if (environment === "LIVE") {
      const result = readLiveDataConfig();
      if (!result.config) {
        res.status(503).json({
          ...LIVE_DATA_UNAVAILABLE_BODY,
          reason: result.reason,
        });
        return;
      }
    }

    store.set(environment);
    syncR2Environment();
    console.log(
      `[RWQAN] تم تبديل بيئة البيانات إلى ${environment} · مشروع Firestore الفعلي: ${getActiveFirestoreProjectId() ?? "غير محدد"}`,
    );
    res.json({ status: buildStatus() });
  });

  return router;
}

export default createAdminLiveDataRouter();
