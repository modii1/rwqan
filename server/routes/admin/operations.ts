import { Router } from "express";
import {
  AdminOperationMetadataValidationError,
  adminOperationMetadataStore,
  type AdminOperationMetadataStoreContract,
} from "../../services/AdminOperationMetadataStore";
import { requireAdmin, requireSameOrigin } from "../middleware";

function operationRouteError(error: unknown): {
  status: number;
  body: { code: string; error: string };
} {
  if (error instanceof AdminOperationMetadataValidationError) {
    return {
      status: 400,
      body: {
        code: error.code,
        error: error.message,
      },
    };
  }
  console.error("Admin operations metadata route failed:", error);
  return {
    status: 500,
    body: {
      code: "OPERATIONS_METADATA_FAILED",
      error: "تعذر تحديث بيانات العملية",
    },
  };
}

export function createAdminOperationsRouter(
  store: AdminOperationMetadataStoreContract = adminOperationMetadataStore,
) {
  const router = Router();

  router.use("/api/admin/operations", requireSameOrigin, requireAdmin);

  router.get("/api/admin/operations/metadata", async (_req, res) => {
    res.set("Cache-Control", "no-store, private");
    try {
      return res.json({ metadata: await store.list() });
    } catch (error) {
      const response = operationRouteError(error);
      return res.status(response.status).json(response.body);
    }
  });

  router.put("/api/admin/operations/:operationId", async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const hasAssignee = Object.prototype.hasOwnProperty.call(body, "assignee");
      const hasState = Object.prototype.hasOwnProperty.call(body, "state");
      const hasSnapshot = Object.prototype.hasOwnProperty.call(body, "snapshot");
      const metadata = await store.update(
        req.params.operationId,
        {
          ...(hasAssignee ? { assignee: body.assignee } : {}),
          ...(hasState ? { state: body.state } : {}),
          ...(hasSnapshot ? { snapshot: body.snapshot } : {}),
        },
      );
      return res.json({ metadata });
    } catch (error) {
      const response = operationRouteError(error);
      return res.status(response.status).json(response.body);
    }
  });

  router.post("/api/admin/operations/:operationId/notes", async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    try {
      const metadata = await store.addNote(
        req.params.operationId,
        req.body?.body,
        undefined,
        req.body?.snapshot,
      );
      return res.status(201).json({ metadata });
    } catch (error) {
      const response = operationRouteError(error);
      return res.status(response.status).json(response.body);
    }
  });

  return router;
}

export default createAdminOperationsRouter();
