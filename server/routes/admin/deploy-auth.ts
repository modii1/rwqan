/**
 * RWQAN DEPLOY — Firebase CLI OAuth routes.
 *
 * Two endpoints:
 *   GET /api/admin/deploy/auth/start   — requires admin session; returns Google OAuth URL
 *   GET /api/admin/deploy/auth/callback — OAuth callback (no session required; protected by state/nonce)
 *   GET /api/admin/deploy/auth/status   — requires admin session; returns auth status
 *
 * The callback route is intentionally OUTSIDE the /api/admin requireAdmin boundary
 * because Google's server-to-browser redirect does not carry the admin session.
 * CSRF protection is provided by the single-use, short-lived `state` + `nonce`
 * parameters validated in deployAuth.completeDeployAuthFlow().
 */

import { Router, type Request, type Response } from "express";
import { requireAdmin, requireSameOrigin } from "../middleware";
import {
  startDeployAuthFlow,
  completeDeployAuthFlow,
  getDeployAuthStatus,
  clearDeployAuth,
  getAndDeletePendingPublish,
  type DeployAuthStartResult,
  type DeployAuthCompleteResult,
  type PendingPublishIntent,
} from "../../services/deployAuth";

const router = Router();

/** Start OAuth flow — requires admin session + same origin. */
router.get(
  "/api/admin/deploy/auth/start",
  requireSameOrigin,
  requireAdmin,
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store, private");
    const sessionId = (req.sessionID ?? "") as string;
    const result: DeployAuthStartResult = startDeployAuthFlow(sessionId);
    if (result.status === "not_configured") {
      res.status(503).json({
        code: "DEPLOY_AUTH_NOT_CONFIGURED",
        error: result.reason,
      });
      return;
    }
    res.json({
      authUrl: result.authUrl,
      notice:
        "افتح الرابط في متصفحك لتسجيل الدخول إلى Google. بعد الانتهاء، ستعود إلى هذا التطبيق لاستكمال النشر.",
    });
  },
);

/** OAuth callback — Google redirects the browser here. Protected by state/nonce only. */
router.get("/api/admin/deploy/auth/callback", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store, private");
  const { code, state, error } = req.query as Record<string, string | undefined>;

  // Google may redirect with an error if the user cancelled.
  if (error) {
    res.status(400).json({
      code: "DEPLOY_AUTH_CANCELLED",
      error: "تم إلغاء المصادقة من قبل المستخدم أو تعذر إكمالها.",
    });
    return;
  }

  if (!code || !state) {
    res.status(400).json({
      code: "DEPLOY_AUTH_INVALID_REQUEST",
      error: "طلب مصادقة غير مكتمل (نقص رمز التفويض أو حالة الجلسة).",
    });
    return;
  }

  const result: DeployAuthCompleteResult = await completeDeployAuthFlow(code, state);
  if (result.status !== "ok") {
    res.status(400).json({
      code: `DEPLOY_AUTH_${result.status.toUpperCase()}`,
      error: result.reason,
    });
    return;
  }

  // Retrieve the pending publish intent for automatic resume (single-use).
  const pendingPublish = result.pendingPublish;

  // Success: inform the browser that auth completed.
  // If there is a pending publish intent, include it so the client can
  // automatically resume the original publish request once.
  res.json({
    status: "ok",
    sessionId: result.sessionId ?? null,
    adminId: result.adminId ?? null,
    notice: pendingPublish
      ? "تمت المصادقة بنجاح. سيُستأنف طلب النشر تلقائيًا."
      : "تمت المصادقة بنجاح. يمكنك العودة إلى التطبيق ومتابعة النشر.",
    pendingPublish: pendingPublish ?? null,
  });
});

/** Check auth status — requires admin session + same origin. */
router.get(
  "/api/admin/deploy/auth/status",
  requireSameOrigin,
  requireAdmin,
  async (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store, private");
    const sessionId = (_req.sessionID ?? "") as string;
    const status = await getDeployAuthStatus(sessionId);
    res.json({
      authenticated: status.authenticated,
      authUrl: status.authenticated ? undefined : undefined,
      reason: status.reason,
    });
  },
);

/** Revoke stored credentials — requires admin session + same origin. */
router.post(
  "/api/admin/deploy/auth/revoke",
  requireSameOrigin,
  requireAdmin,
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store, private");
    const sessionId = (req.sessionID ?? "") as string;
    await clearDeployAuth(sessionId);
    res.json({ ok: true });
  },
);

export default router;