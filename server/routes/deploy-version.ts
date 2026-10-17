import { Router, type Request, type Response } from "express";
import {
  DEV_FIREBASE_PROJECT_ID,
  getFirebaseProjectId,
} from "../config/runtimeEnvironment";
import {
  resolveDeployVersionInfo,
  type DeployVersionInfo,
} from "../services/DeployVersionService";

/**
 * PUBLIC, read-only version endpoint used by the DEV post-deploy health probe
 * (DeployHealthService.DEPLOY_VERSION_PATH === "/api/deploy-version").
 *
 * Design constraints:
 *  - Served only when the active Firebase project is the isolated DEV project
 *    (`rwqan-sa-dev`). On any other project (including production `rwqan-757`)
 *    it returns 404, so the production origin never exposes its commit.
 *  - Reads the commit from server-side sources only (env / local Git); it never
 *    reads a client-provided value. When the identity cannot be established the
 *    commit is `null` and the probe fails closed.
 *  - No session/CSRF is required because it is intended for server-to-server
 *    probing, but the payload contains no secrets.
 */
export interface DeployVersionRouterDeps {
  /** Resolve the running version identity. */
  resolveInfo: () => Promise<DeployVersionInfo>;
  /** The Firebase project the process is actually bound to (null if unknown). */
  projectId: () => string | null;
  /** Clock for the `generatedAt` field. */
  now: () => Date;
}

export function createDeployVersionRouter(
  deps: Partial<DeployVersionRouterDeps> = {},
) {
  const resolveInfo = deps.resolveInfo ?? (() => resolveDeployVersionInfo());
  const projectId = deps.projectId ?? (() => getFirebaseProjectId());
  const now = deps.now ?? (() => new Date());

  const router = Router();

  router.get("/api/deploy-version", async (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store, private");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.set("X-Content-Type-Options", "nosniff");

    if (projectId() !== DEV_FIREBASE_PROJECT_ID) {
      return res.status(404).json({ error: "not_found" });
    }

    try {
      const info = await resolveInfo();
      return res.status(200).json({
        ...info,
        generatedAt: now().toISOString(),
      });
    } catch {
      return res.status(503).json({ error: "unavailable" });
    }
  });

  return router;
}

export default createDeployVersionRouter();
