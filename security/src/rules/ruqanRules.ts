import { sep } from "node:path";
import {
  findLines,
  getFile,
  hasFile,
  quote,
  type ScanContext,
} from "./context";
import { sectionOf } from "../severity";
import type { Category, DetectionSource, Finding, Severity } from "../types";

export interface Rule {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  evidence: string;
  remediation: string;
  productionImpact: "YES" | "NO" | "UNKNOWN";
  affectedFlow?: string;
  heuristic?: boolean;
  run: (ctx: ScanContext) => Finding[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function finding(
  rule: Rule,
  file: string,
  evidence: string,
  extra: Partial<Finding> = {},
): Finding {
  const line = extra.line;
  const fingerprint = `${rule.id}@${file}:${line ?? 0}`;
  return {
    id: rule.id,
    severity: rule.severity,
    category: rule.category,
    section: sectionOf(rule.category),
    title: rule.title,
    description: rule.description,
    evidence,
    file,
    line,
    detectionSource: (extra.detectionSource ?? "ruqan-static") as DetectionSource,
    affectedFlow: rule.affectedFlow,
    productionImpact: rule.productionImpact,
    devImpact: extra.devImpact,
    remediation: rule.remediation,
    status: "open",
    classification: "new",
    fingerprint,
    heuristic: rule.heuristic,
  };
}

export const RUQAN_RULES: Rule[] = [];

function register(rule: Rule): void {
  RUQAN_RULES.push(rule);
}

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

register({
  id: "SEC-001",
  severity: "critical",
  category: "secrets",
  title: "Production secrets tracked in git (.env)",
  description:
    "The file '.env' is tracked in the git repository (git ls-files lists it) and contains production secrets (Firebase service account private key, R2 secret access key, Paymob keys, SESSION_SECRET, Gemini key) still present in HEAD and earlier commits. Secrets in git history are exposed to anyone with repository access and are not revoked by deleting the working-tree file.",
  evidence: "git ls-files -> '.env' (tracked); git log -- .env shows commits ff2b332 / 3672a4e / 5ada849 (values never printed).",
  remediation:
    "Rotate every secret that ever lived in .env (Firebase SA, R2, Paymob, WhatsApp/Enjazatik, SESSION_SECRET, admin creds), purge .env from history or move to a fresh repository, and add gitleaks to CI.",
  productionImpact: "YES",
  affectedFlow: "All production integrations (Firebase, R2, Paymob, WhatsApp, Enjazatik, Gemini, admin auth)",
  run(ctx) {
    if (ctx.gitTracked.has(".env")) {
      return [finding(this, ".env", this.evidence)];
    }
    return [];
  },
});

register({
  id: "SEC-002",
  severity: "medium",
  category: "secrets",
  title: "Credential-shaped values committed in docs/WHATSAPP_REPORT_AR.md",
  description:
    "The tracked report docs/WHATSAPP_REPORT_AR.md contains token-shaped entries (META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID / ENJAZATIK_TOKEN). Even if labelled 'sample', committed credential-shaped values must be removed or redacted, and rotated if they were ever real.",
  evidence: "docs/WHATSAPP_REPORT_AR.md ~lines 29-33 (values not printed).",
  remediation:
    "Remove or replace the values in the document and rotate any of them copied from real credentials.",
  productionImpact: "UNKNOWN",
  affectedFlow: "WhatsApp notification & Enjazatik sending credentials",
  run(ctx) {
    const file = getFile(ctx, "docs/WHATSAPP_REPORT_AR.md");
    if (!file) return [];
    const hits = findLines(file, /(?:META_WHATSAPP_TOKEN|META_PHONE_NUMBER_ID|ENJAZATIK_TOKEN)\s*=/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, this.evidence, { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Authentication                                                     */
/* ------------------------------------------------------------------ */

register({
  id: "AUTH-001",
  severity: "high",
  category: "authentication",
  title: "Owner passwords and OTP reset codes stored in plaintext",
  description:
    "Firestore 'owners' documents persist owner.password in plaintext and owner.resetCode as a plaintext OTP. A Firestore/database compromise exposes all owner credentials; password comparison is also plain (non-constant-time).",
  evidence: "server/firebaseService.ts write paths ~5723-5776 use owners.password / owners.resetCode.",
  remediation:
    "Hash owner passwords with a strong password hash (argon2/scrypt/bcrypt); never persist OTP codes (store a hash + expiry/attempt state).",
  productionImpact: "YES",
  affectedFlow: "Owner authentication & password reset (Enjazatik OTP path)",
  run(ctx) {
    const file = getFile(ctx, "server/firebaseService.ts");
    if (!file) return [];
    const hits = findLines(
      file,
      /(?:password|resetCode):\s*(?:data\?\.(?:password|resetCode)|property\.pin|newPassword|code)\b/,
    );
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

register({
  id: "AUTH-002",
  severity: "medium",
  category: "authentication",
  title: "Owner PIN/password comparison is not constant-time",
  description:
    "Owner credential verification uses plain equality on strings (owner PIN login and change-password), unlike the admin path which uses timingSafeEqual. Timing side-channels can leak credential equivalence during probing.",
  evidence: "server/services/AuthService.ts (property.pin === pin ~line 56-61; '.' !== currentPassword ~line 226-233).",
  remediation:
    "Route owner credential checks through the existing _safeCredentialMatch (timingSafeEqual) helper used for admin credentials.",
  productionImpact: "NO",
  affectedFlow: "Owner login (PIN) and change-password",
  run(ctx) {
    const file = getFile(ctx, "server/services/AuthService.ts");
    if (!file) return [];
    const hits = findLines(file, /\.pin\s*===\s*pin|password\s*!==\s*currentPassword/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

register({
  id: "AUTH-003",
  severity: "medium",
  category: "authentication",
  title: "Password-reset OTP generated with Math.random()",
  description:
    "sendResetCode generates the 6-digit reset code with Math.floor(100_000 + Math.random()*900_000) — not a cryptographically-secure RNG (CWE-338). Rate limiting and a 10-minute TTL mitigate but do not remove code predictability within a brute-force window.",
  evidence: "server/services/AuthService.ts ~line 105.",
  remediation:
    "Use node:crypto.randomInt(0, 1_000_000) (already used by CustomerPhoneOtpService).",
  productionImpact: "UNKNOWN",
  affectedFlow: "Owner password reset (SMS/WhatsApp OTP)",
  run(ctx) {
    const file = getFile(ctx, "server/services/AuthService.ts");
    if (!file) return [];
    const hits = findLines(file, /Math\.floor\(100_000\s*\+\s*Math\.random/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

register({
  id: "AUTH-004",
  severity: "medium",
  category: "authentication",
  title: "Predictable hardcoded HMAC fallback secret for contact analytics",
  description:
    "When SESSION_SECRET is unset, contact-analytics and contact-identity token signing fall back to the hardcoded literal 'rwqan-contact-analytics', making tokens forgeable in any environment that runs without SESSION_SECRET.",
  evidence: "server/routes/tracking.ts (~71-105) and server/services/ContactIdentityService.ts (~49).",
  remediation:
    "Fail closed: require SESSION_SECRET for these flows instead of a constant fallback.",
  productionImpact: "YES",
  affectedFlow: "Contact tracking/identity tokens",
  run(ctx) {
    const out: Finding[] = [];
    for (const rel of ["server/routes/tracking.ts", "server/services/ContactIdentityService.ts"]) {
      const file = getFile(ctx, rel);
      if (!file) continue;
      const hits = findLines(file, /rwqan-contact-analytics/);
      if (hits.length > 0) out.push(finding(this, rel, "hardcoded HMAC fallback secret (value not printed)", { line: hits[0].line }));
    }
    return out;
  },
});

register({
  id: "AUTH-005",
  severity: "medium",
  category: "authentication",
  title: "No minimum-strength enforcement for admin credentials",
  description:
    "Production startup enforces SESSION_SECRET >= 32 bytes but does not enforce length/complexity on ADMIN_CODE or ADMIN_PASSWORD. Weak admin credentials (and a legacy default 'admin123' in server/_legacy dead code) weaken the admin boundary.",
  evidence: "server/config/runtimeEnvironment.ts (~line 53) checks SESSION_SECRET length only; server/_legacy/routes.ts ~1490-1491 fallback 'admin'/'admin123'.",
  remediation:
    "Enforce minimum length (>= 12) for ADMIN_CODE and ADMIN_PASSWORD in assertProductionSecurityEnvironment; remove legacy defaults.",
  productionImpact: "YES",
  affectedFlow: "Admin login",
  run(ctx) {
    const file = getFile(ctx, "server/config/runtimeEnvironment.ts");
    if (!file) return [];
    const hasSessionLength = /at least 32 bytes/.test(file.content);
    const hasAdminLength = /ADMIN_(?:CODE|PASSWORD)[\s\S]{0,80}(?:length|bytes|minimum)/i.test(file.content);
    if (hasSessionLength && !hasAdminLength) {
      return [finding(this, file.rel, "SESSION_SECRET length enforced; ADMIN_CODE/ADMIN_PASSWORD length not", { line: 53 })];
    }
    return [];
  },
});

/* ------------------------------------------------------------------ */
/* Authorization / IDOR                                               */
/* ------------------------------------------------------------------ */

register({
  id: "AUTHZ-001",
  severity: "high",
  category: "idor",
  title: "IDOR: authenticated owner can read any property's subscription and profile",
  description:
    "GET /api/owner/subscription/:propertyNumber (requireOwner) reads req.params.propertyNumber and returns subscription fields plus property name/city/verificationStatus for ANY property, without verifying session.propertyNumber === request parameter. A logged-in owner can enumerate other properties by 5-digit number.",
  evidence: "server/routes/owner.ts:3510-3547.",
  remediation:
    "Return 403 unless req.params.propertyNumber === (req.session).propertyNumber, or resolve the subscription only for the session property.",
  productionImpact: "YES",
  affectedFlow: "GET /api/owner/subscription/:propertyNumber (owner dashboards)",
  run(ctx) {
    const file = getFile(ctx, "server/routes/owner.ts");
    if (!file) return [];
    const idx = file.content.indexOf('router.get("/api/owner/subscription/:propertyNumber"');
    if (idx === -1) return [];
    const block = file.content.slice(idx, idx + 1600);
    const usesParam = /getSubscriptionByPropertyNumber\(propertyNumber\)/.test(block);
    const sessionScoped =
      /req\.session[\s\S]{0,160}propertyNumber[\s\S]{0,160}(?:===|!==|!=|includes|==)/.test(
        block,
      );
    if (usesParam && !sessionScoped) {
      const line = 1 + file.content.slice(0, idx).split("\n").length;
      return [
        finding(this, file.rel, 'router.get("/api/owner/subscription/:propertyNumber", requireOwner, ...)', { line }),
      ];
    }
    return [];
  },
});

register({
  id: "AUTHZ-002",
  severity: "medium",
  category: "authorization",
  title: "Potential IDOR: linked-property unlink accepts caller-supplied property number",
  description:
    "DELETE /api/owner/subscription/linked-properties/:propertyNumber reads the target from req.params.propertyNumber and passes it to unlinkLinkedPropertiesAtomically without any visible check that the requested property belongs to the session owner's linked set.",
  evidence: "server/routes/owner.ts:3100-3134 (unlinkLinkedPropertiesAtomically).",
  remediation:
    "Verify propertyNumber is a member of the session property's linked set inside the service before unlinking; add a regression test.",
  productionImpact: "YES",
  affectedFlow: "DELETE /api/owner/subscription/linked-properties/:propertyNumber",
  heuristic: true,
  run(ctx) {
    const file = getFile(ctx, "server/routes/owner.ts");
    if (!file) return [];
    const hits = findLines(file, /linked-properties\/:propertyNumber/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Admin boundary / unguarded endpoints                               */
/* ------------------------------------------------------------------ */

register({
  id: "ADMIN-001",
  severity: "medium",
  category: "admin_authorization",
  title: "Endpoints embedded in admin routers are exposed ABOVE the /api/admin boundary",
  description:
    "The central requireSameOrigin+requireAdmin boundary mounts at app.use('/api/admin', ...). Routes using full paths without an /api/admin prefix bypass it: GET /api/bank-accounts, GET /api/bank-accounts/default (active bank accounts incl. IBAN), GET /api/feature-flag/:key, GET /api/currency/rate, POST /api/currency/convert.",
  evidence: "server/routes/admin/settings.ts:274,285,387; server/routes/admin/finance.ts:394,426; boundary at server/routes/index.ts:107.",
  remediation:
    "Move these to /api/admin/* paths or add explicit requireSameOrigin guards; audit whether each must remain public (checkout needs bank IBAN) and filter response fields accordingly.",
  productionImpact: "YES",
  affectedFlow: "public bank accounts, feature flags, currency conversion endpoints",
  run(ctx) {
    const out: Finding[] = [];
    const settings = getFile(ctx, "server/routes/admin/settings.ts");
    if (settings) {
      const hits = findLines(settings, /router\.(get|post)\("\/api\/(?:bank-accounts|feature-flag)\/?"/);
      if (hits.length > 0) out.push(finding(this, settings.rel, quote(hits[0].text), { line: hits[0].line }));
    }
    const finance = getFile(ctx, "server/routes/admin/finance.ts");
    if (finance) {
      const hits = findLines(finance, /router\.(get|post)\("\/api\/currency\//);
      if (hits.length > 0) out.push(finding(this, finance.rel, quote(hits[0].text), { line: hits[0].line }));
    }
    return out;
  },
});

/* ------------------------------------------------------------------ */
/* SSRF                                                               */
/* ------------------------------------------------------------------ */

register({
  id: "SSRF-001",
  severity: "medium",
  category: "ssrf",
  title: "Server-side fetch URL interpolated from request body (currency conversion)",
  description:
    "POST /api/currency/convert interpolates from/to values from req.body directly into a server-side fetch URL. Host is fixed to api.frankfurter.dev (limited), but there is no validation and no auth; a future configurable host would elevate this to SSRF.",
  evidence: "server/routes/admin/finance.ts:426-435.",
  remediation:
    "Validate from/to against an allowlist of ISO currency codes; prefer the fixed-base GET /api/currency/rate.",
  productionImpact: "YES",
  affectedFlow: "POST /api/currency/convert",
  run(ctx) {
    const file = getFile(ctx, "server/routes/admin/finance.ts");
    if (!file) return [];
    const hits = findLines(file, /base=\$\{from\}/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

register({
  id: "SSRF-002",
  severity: "low",
  category: "ssrf",
  title: "Second-order SSRF surface: AI receipt scan fetches DB-stored receiptUrl",
  description:
    "scanReceiptWithAI fetches payment.receiptUrl (DB). Today values are server-constructed at write time (no live SSRF); if receiptUrl ever becomes user-writable this becomes SSRF.",
  evidence: "server/integrations/aiReceiptScanner.ts:127,231.",
  remediation:
    "Add a URL-origin guard (allow only the configured R2 host) before scanning; keep the field write-only server-side.",
  productionImpact: "NO",
  affectedFlow: "AI receipt scanning (payment.receiptUrl)",
  run(ctx) {
    const file = getFile(ctx, "server/integrations/aiReceiptScanner.ts");
    if (!file) return [];
    const hits = findLines(file, /fetch\(/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Payment & discount validation                                      */
/* ------------------------------------------------------------------ */

register({
  id: "PAY-001",
  severity: "medium",
  category: "amount_discount_validation",
  title: "Discount redemption limit not enforced at apply time",
  description:
    "DiscountService.apply() validates existence, isActive and expiry and caps the discount, but does not check usageCount/maxUses. recordUsage() only increments after the fact, so a reusable code can be redeemed repeatedly without a gate.",
  evidence: "server/services/DiscountService.ts apply() (~34-64).",
  remediation:
    "Check usage limit atomically before computing finalAmount and increment atomically on claim.",
  productionImpact: "YES",
  affectedFlow: "Checkout discount application",
  run(ctx) {
    const file = getFile(ctx, "server/services/DiscountService.ts");
    if (!file || !hasFile(ctx, "server/services/DiscountService.ts")) return [];
    if (/maxUses|usageLimit|\busageCount\s*[<>=]/.test(file.content)) return [];
    const hits = findLines(file, /function apply|Math\.max\(0, originalAmount/);
    return [finding(this, file.rel, "no usage-limit comparison in DiscountService", { line: hits[0]?.line })];
  },
});

register({
  id: "PAY-002",
  severity: "low",
  category: "payment_flow",
  title: "Hardcoded default Paymob integration ids",
  description:
    "paymob.ts defaults integration ids to 15650 (cards) and 15649 (Apple Pay); an instance that forgets to configure could route against the wrong integration set.",
  evidence: "server/integrations/paymob.ts:8-9.",
  remediation:
    "Require PAYMOB_INTEGRATION_ID_* from environment in production and default to a placeholder in DEV.",
  productionImpact: "YES",
  affectedFlow: "Paymob intent creation",
  run(ctx) {
    const file = getFile(ctx, "server/integrations/paymob.ts");
    if (!file) return [];
    const hits = findLines(file, /15650|15649/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, "hardcoded integration id defaults", { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Upload validation & file handling                                  */
/* ------------------------------------------------------------------ */

register({
  id: "FILES-001",
  severity: "high",
  category: "upload_validation",
  title: "Owner bank-transfer receipt upload: unbounded, unvalidated, trusts client mimetype",
  description:
    "POST /api/owner/payment/bank-transfer uses multer with NO size limit and NO fileFilter (unbounded in-memory buffering) and derives the storage extension/content-type from req.file.mimetype (client-controlled), storing arbitrary bytes under a public URL and sending it via WhatsApp.",
  evidence: "server/utils/helpers.ts:7-9; server/routes/owner.ts:1056,1164-1177.",
  remediation:
    "Reuse BookingCommissionReceiptService validation (size limit, magic-byte detection, extension from bytes, opaque key).",
  productionImpact: "YES",
  affectedFlow: "POST /api/owner/payment/bank-transfer (bank receipt upload)",
  run(ctx) {
    const out: Finding[] = [];
    const helpers = getFile(ctx, "server/utils/helpers.ts");
    if (helpers && !/fileFilter|limits:/.test(helpers.content)) {
      const hits = findLines(helpers, /multer\(\{\s*\}\)?/);
      if (hits.length > 0) out.push(finding(this, helpers.rel, "unbounded multer (no limits/fileFilter)", { line: hits[0].line }));
    }
    const owner = getFile(ctx, "server/routes/owner.ts");
    if (owner) {
      const mime = findLines(owner, /req\.file\.mimetype/);
      if (mime.length > 0) out.push(finding(this, owner.rel, quote(mime[0].text), { line: mime[0].line }));
    }
    return out;
  },
});

register({
  id: "FILES-002",
  severity: "high",
  category: "upload_validation",
  title: "Addon bank-transfer receipt upload: unbounded, unvalidated, trusts client mimetype",
  description:
    "POST /api/owner/addons/bank-transfer mirrors FILES-001: shared unbounded multer, extension/content-type selected from req.file.mimetype, stored publicly.",
  evidence: "server/routes/admin/addons.ts:592,617-629.",
  remediation: "Same as FILES-001: strict receipt validation (magic bytes, size, opaque key).",
  productionImpact: "YES",
  affectedFlow: "POST /api/owner/addons/bank-transfer",
  run(ctx) {
    const file = getFile(ctx, "server/routes/admin/addons.ts");
    if (!file) return [];
    const mime = findLines(file, /(?:req\.file|receipt(?:File)?)\.mimetype/);
    if (mime.length === 0) return [];
    return [finding(this, file.rel, quote(mime[0].text), { line: mime[0].line })];
  },
});

register({
  id: "FILES-003",
  severity: "medium",
  category: "upload_validation",
  title: "Owner property image upload: size-only, no MIME/magic validation, forced image/jpeg",
  description:
    "POST /api/owner/images caps at 2MB but performs no MIME or magic-byte validation; arbitrary bytes are stored as image/jpeg with ACL public-read under keys that are then served publicly.",
  evidence: "server/routes/owner.ts:1608,1639-1640.",
  remediation:
    "Detect real image bytes (magic), reject mismatches, and drop public-read ACL if a private serving path is preferred.",
  productionImpact: "YES",
  affectedFlow: "POST /api/owner/images",
  run(ctx) {
    const file = getFile(ctx, "server/routes/owner.ts");
    if (!file) return [];
    const hits = findLines(file, /ACL: "public-read"|ContentType: "image\/jpeg"/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

register({
  id: "FILES-004",
  severity: "medium",
  category: "upload_validation",
  title: "Admin R2 image upload interpolates caller-supplied propertyNumber into storage keys",
  description:
    "POST /api/admin/r2-images/:propertyNumber uses the URL path value directly in ListObjects prefix and PutObject key (admin-gated but caller-controlled, unvalidated), enabling key-space traversal into other prefixes.",
  evidence: "server/routes/admin/images.ts:104-140.",
  remediation: "Validate propertyNumber format (5 digits) and namespace keys under a strict validated prefix.",
  productionImpact: "YES",
  affectedFlow: "POST /api/admin/r2-images/:propertyNumber",
  run(ctx) {
    const file = getFile(ctx, "server/routes/admin/images.ts");
    if (!file) return [];
    const hits = findLines(file, /:propertyNumber/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* R2 / public-private separation                                     */
/* ------------------------------------------------------------------ */

register({
  id: "R2-001",
  severity: "high",
  category: "public_private_files",
  title: "Payment receipt images are publicly downloadable with guessable keys",
  description:
    "Bank-transfer receipt images are stored in public R2 (served as R2_PUBLIC_URL/key) under predictable keys like receipts/{propertyNumber}-{Date.now()}.jpg and URLs are embedded in WhatsApp messages. Anyone who guesses/enumerates the numeric prefix can download financial receipt evidence. No public/private object separation exists.",
  evidence: "server/routes/owner.ts:1167-1177; server/utils/r2.ts:29; whatsapp.ts link ~416.",
  remediation:
    "Split private prefixes, serve via a signed/GET-protected path, randomize keys with high entropy, and stop embedding public receipt URLs in messages.",
  productionImpact: "YES",
  affectedFlow: "Bank-transfer receipts (owner + addon + booking commission)",
  run(ctx) {
    const owner = getFile(ctx, "server/routes/owner.ts");
    if (!owner) return [];
    const hits = findLines(owner, /receipts\/\$\{propertyNumber\}|\$\{R2_PUBLIC_URL\}\/\$\{receiptKey\}/);
    if (hits.length === 0) return [];
    return [finding(this, owner.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

register({
  id: "R2-002",
  severity: "medium",
  category: "r2_access",
  title: "Hardcoded production R2 public host used as fallback everywhere",
  description:
    "R2_PUBLIC_URL falls back to a hardcoded production r2.dev host when unset; the same host is hardcoded in next.config.ts and a cleanup script. Non-production environments omitting R2_PUBLIC_URL could reference the production bucket public host.",
  evidence: "server/utils/r2.ts:6,29; next.config.ts:20; scripts/cleanup-r2-images.ts:16.",
  remediation:
    "Require R2_PUBLIC_URL explicitly outside production and keep assertR2DevIsolation as enforcement.",
  productionImpact: "YES",
  affectedFlow: "Image/receipt URL resolution",
  run(ctx) {
    const file = getFile(ctx, "server/utils/r2.ts");
    if (!file) return [];
    const hits = findLines(file, /pub-e2fc1c0a598f4f0e91e47af63219848e\.r2\.dev/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, "DEFAULT_R2_PUBLIC_URL hardcoded fallback (host not printed)", { line: hits[0].line })];
  },
});

register({
  id: "R2-003",
  severity: "medium",
  category: "public_private_files",
  title: "Public property-images endpoint lacks verificationStatus gate",
  description:
    "GET /api/public/property-images/:propertyNumber only checks an active property hold and lists R2 objects; unlike GET /api/properties/:id it does not gate on verificationStatus, so images of pending/rejected properties can be listed by guessing the property number.",
  evidence: "server/routes/public.ts:300-311 (contrast server/routes/properties.ts:135-137).",
  remediation: "Reuse the same approved-property gate as /api/properties/:id before listing images.",
  productionImpact: "YES",
  affectedFlow: "GET /api/public/property-images/:propertyNumber",
  run(ctx) {
    const file = getFile(ctx, "server/routes/public.ts");
    if (!file) return [];
    const hits = findLines(file, /property-images\/:propertyNumber/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Google Drive                                                       */
/* ------------------------------------------------------------------ */

register({
  id: "DRIVE-001",
  severity: "medium",
  category: "external_service_guards",
  title: "Google Drive integration uses full-drive scope and public 'anyone' read ACLs",
  description:
    "The Drive service authenticates with the full https://www.googleapis.com/auth/drive scope and grants role:'reader', type:'anyone' on created property folders/images, publishing them to anyone with the link. Scope should be drive.appfolder (or drive.file) and links should not be world-readable.",
  evidence: "server/integrations/googleDrive.ts:19 (scope), :37 and :60 (reader/anyone ACL).",
  remediation: "Use a minimal scope (drive.file) and grant reader to a managed audience or make folders app-only.",
  productionImpact: "YES",
  affectedFlow: "Google Drive property folder creation (admin flow)",
  run(ctx) {
    const file = getFile(ctx, "server/integrations/googleDrive.ts");
    if (!file) return [];
    const hits = findLines(file, /type:\s*['"]anyone['"]/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, "role reader / type anyone ACL", { line: hits[0].line })];
  },
});

register({
  id: "DRIVE-002",
  severity: "low",
  category: "external_service_guards",
  title: "Hardcoded Drive parent folder id and Drive query interpolation",
  description:
    "PARENT_FOLDER_ID is hardcoded in googleDrive.ts and propertyNumber is interpolated into a Drive files query — surfaces for path/query-injection and misrouting.",
  evidence: "server/integrations/googleDrive.ts:92 (~96 query).",
  remediation: "Load the parent id from environment, validate propertyNumber, and use a constant filter.",
  productionImpact: "UNKNOWN",
  affectedFlow: "Google Drive folder lookups",
  run(ctx) {
    const file = getFile(ctx, "server/integrations/googleDrive.ts");
    if (!file) return [];
    const hits = findLines(file, /PARENT_FOLDER_ID\s*=/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, "hardcoded PARENT_FOLDER_ID", { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Firebase / data                                                     */
/* ------------------------------------------------------------------ */

register({
  id: "FB-001",
  severity: "low",
  category: "firebase_isolation",
  title: ".firebaserc defaults CLI deployments to the PRODUCTION project",
  description:
    "The Firebase CLI default project is rwqan-757 (production). Any firebase deploy without an explicit --project flag targets production. DEV isolation relies on the runtime env guard (FIREBASE_DEV_PROJECT_ID=rwqan-sa-dev) which does not protect the CLI.",
  evidence: ".firebaserc lines 2-5 (default + rwqan aliases -> rwqan-757).",
  remediation:
    "Set distinct CLI aliases (e.g. default=dev) and require an explicit project selector in deployment scripts.",
  productionImpact: "YES",
  affectedFlow: "Firebase CLI deploys (rules/indexes/hosting)",
  run(ctx) {
    const file = getFile(ctx, ".firebaserc");
    if (!file) return [];
    return [finding(this, file.rel, "default project rwqan-757 (production)", { line: 3 })];
  },
});

register({
  id: "FB-002",
  severity: "low",
  category: "firestore_access",
  title: "Full-collection Firestore scans inflate reads (documented 63K reads/day)",
  description:
    "FIRESTORE_AUDIT_REPORT.md documents full-collection .get() scans (no limits/where) on admin analytics, /api/track-pageview, and the 15-minute scheduler. Cost/availability risk and an amplification vector.",
  evidence: "FIRESTORE_AUDIT_REPORT.md:23; server/routes/tracking.ts:155; server/scheduler.ts:289-336.",
  remediation:
    "Constrain queries (where/orderBy+limit), cache admin aggregates, and dedupe track-pageview server-side.",
  productionImpact: "NO",
  affectedFlow: "Public pageview tracking; admin alerts/analytics; scheduler",
  run(ctx) {
    const file = getFile(ctx, "FIRESTORE_AUDIT_REPORT.md");
    if (!file) return [];
    return [finding(this, file.rel, "documented 63K reads/day root-cause analysis", { line: 4 })];
  },
});

/* ------------------------------------------------------------------ */
/* Logging / error handling                                            */
/* ------------------------------------------------------------------ */

register({
  id: "LOG-001",
  severity: "medium",
  category: "logging",
  title: "WhatsApp token prefix and admin phone logged at startup",
  description:
    "The WhatsApp module logs a prefix of WHATSAPP_ACCESS_TOKEN and the admin notify number. Token material and phone numbers should not appear in logs (logs are often shipped to third parties).",
  evidence: "server/integrations/whatsapp.ts:135.",
  remediation: "Log only boolean presence for secrets and mask phone numbers.",
  productionImpact: "YES",
  affectedFlow: "WhatsApp/Meta integration startup",
  run(ctx) {
    const file = getFile(ctx, "server/integrations/whatsapp.ts");
    if (!file) return [];
    const hits = findLines(file, /substring\(0, 10\)/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, "token prefix logged (value not printed)", { line: hits[0].line })];
  },
});

register({
  id: "LOG-002",
  severity: "medium",
  category: "logging",
  title: "OCR path logs extracted IBAN and beneficiary name",
  description:
    "The OCR service logs the extracted IBAN and beneficiary/account fields from receipt scans to the console, leaking financial PII into server logs.",
  evidence: "server/integrations/ocrService.ts:261 (~247).",
  remediation: "Stop logging extracted financial identifiers; store only hashes if audit is needed.",
  productionImpact: "YES",
  affectedFlow: "Receipt OCR (booking commission)",
  run(ctx) {
    const file = getFile(ctx, "server/integrations/ocrService.ts");
    if (!file) return [];
    const hits = findLines(file, /extractedIban|IBAN المستخرج/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, "extracted IBAN logged", { line: hits[0].line })];
  },
});

register({
  id: "LOG-003",
  severity: "low",
  category: "logging",
  title: "Owner phone numbers logged in admin/owner flows",
  description:
    "Console logs include owner phone numbers (admin settings notification target; owner phone normalization).",
  evidence: "server/routes/admin/settings.ts:137 and server/routes/owner.ts:435.",
  remediation: "Mask phone numbers to the last 2 digits in logs.",
  productionImpact: "YES",
  affectedFlow: "Admin notifications; owner phone updates",
  run(ctx) {
    const out: Finding[] = [];
    for (const rel of ["server/routes/admin/settings.ts", "server/routes/owner.ts"]) {
      const file = getFile(ctx, rel);
      if (!file) continue;
      const hits = findLines(file, /Phone normalized to:|to\s*\$\{ownerPhone\}|\$\{ownerPhone\}/);
      if (hits.length > 0) out.push(finding(this, rel, quote(hits[0].text), { line: hits[0].line }));
    }
    return out;
  },
});

register({
  id: "ERR-001",
  severity: "low",
  category: "error_handling",
  title: "Server-side error message returned verbatim to admin client",
  description:
    "The admin property-create handler returns err.message in the response body (catch block), which can surface internal integration error text (e.g. Google Drive credential errors) to the caller.",
  evidence: "server/routes/admin/properties.ts catch ~407.",
  remediation:
    "Return a generic error to the client and log the detail server-side with a correlation id.",
  productionImpact: "NO",
  affectedFlow: "Admin property create",
  run(ctx) {
    const file = getFile(ctx, "server/routes/admin/properties.ts");
    if (!file) return [];
    const hits = findLines(file, /error:\s*err(?:\.message)?\s*\}\)/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, quote(hits[0].text), { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Hardcoded production fallbacks                                     */
/* ------------------------------------------------------------------ */

register({
  id: "EXT-001",
  severity: "medium",
  category: "hardcoded_fallbacks",
  title: "Hardcoded production WhatsApp fallback number shipped to client and server",
  description:
    "A production WhatsApp number is embedded as a client-side default (property details) and as the server production fallback. In DEV the server guard (Phase 6C) prevents the fallback, but the number still ships in client bundles and becomes a dependency if variables are misconfigured.",
  evidence: "server/integrations/whatsapp.ts:32; src/components/property-details-client.tsx:38.",
  remediation: "Serve the number from configuration/API (never ship in the client bundle) and keep the DEV guard.",
  productionImpact: "YES",
  affectedFlow: "WhatsApp admin notifications; property contact buttons",
  run(ctx) {
    const out: Finding[] = [];
    for (const rel of ["server/integrations/whatsapp.ts", "src/components/property-details-client.tsx"]) {
      const file = getFile(ctx, rel);
      if (!file) continue;
      const hits = findLines(file, /966533220646|9665\d{2,7}/);
      if (hits.length > 0) out.push(finding(this, rel, "hardcoded production WhatsApp number (value not printed)", { line: hits[0].line }));
    }
    return out;
  },
});

register({
  id: "EXT-002",
  severity: "low",
  category: "hardcoded_fallbacks",
  title: "Google Apps Script endpoint URL hardcoded in client metadata page",
  description:
    "The property metadata page embeds a Google Apps Script data URL as a fallback; hardcoded third-party endpoints in client code complicate availability and can change out from under production.",
  evidence: "src/app/property/[id]/page.tsx:61.",
  remediation: "Route metadata exclusively through the internal API and drop the Apps Script fallback.",
  productionImpact: "YES",
  affectedFlow: "Property metadata page",
  run(ctx) {
    const file = getFile(ctx, "src/app/property/[id]/page.tsx");
    if (!file) return [];
    const hits = findLines(file, /script\.google\.com\/macros/);
    if (hits.length === 0) return [];
    return [finding(this, file.rel, "hardcoded Apps Script URL", { line: hits[0].line })];
  },
});

/* ------------------------------------------------------------------ */
/* Dead dependencies                                                   */
/* ------------------------------------------------------------------ */

const DEAD_DEPENDENCY_CANDIDATES = [
  { pkg: "aws-sdk", hint: "aws-sdk" },
  { pkg: "@neondatabase/serverless", hint: "@neondatabase/serverless" },
  { pkg: "drizzle-orm", hint: "drizzle-orm" },
  { pkg: "@marsidev/react-turnstile", hint: "@marsidev/react-turnstile" },
  { pkg: "openai", hint: "openai" },
  { pkg: "passport", hint: "passport" },
  { pkg: "passport-local", hint: "passport-local" },
];

register({
  id: "DEPS-001",
  severity: "low",
  category: "dead_dependencies",
  title: "Dependency present in package.json but unreferenced in code",
  description:
    "A package listed in dependencies has no import/require usage anywhere under server/, src/ or shared/. Unreferenced dependencies enlarge the supply-chain surface and suggest dead code paths that should be removed.",
  evidence: "package.json dependency list vs import scan across server/, src/, shared/.",
  remediation: "Remove unused dependencies after confirming they are truly unreferenced (see evidence per package).",
  productionImpact: "NO",
  run(ctx) {
    const pkg = getFile(ctx, "package.json");
    if (!pkg) return [];
    const searchable = ctx.files.filter(
      (f) => f.abs.includes(`${sep}server`) || f.abs.includes(`${sep}src`) || f.abs.includes(`${sep}shared`),
    );
    const importPattern = (hint: string) =>
      new RegExp(`['"](?:${escapeRegExp(hint)})(?:['"]|\\/)`);
    const out: Finding[] = [];
    for (const cand of DEAD_DEPENDENCY_CANDIDATES) {
      const declared = findLines(pkg, new RegExp(`"${escapeRegExp(cand.pkg)}"\\s*:`));
      if (declared.length === 0) continue;
      const pattern = importPattern(cand.hint);
      const used = searchable.some((f) => pattern.test(f.content));
      if (!used) {
        out.push(finding(this, pkg.rel, `unreferenced dependency: ${cand.pkg}`, { line: declared[0].line }));
      }
    }
    return out;
  },
});