import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("the deploy bar is mounted exactly once by the global app shell", () => {
  const layout = read("../app/layout-content.tsx");
  const mounts = layout.match(/<DeployBar\s*\/>/g) ?? [];
  assert.equal(mounts.length, 1, "DeployBar must be rendered once for the whole app");
  assert.match(layout, /import \{ DeployBar \} from "@\/components\/deploy-bar"/);
});

test("the deploy bar only probes the admin API in a development build", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /process\.env\.NEXT_PUBLIC_BASE_URL/);
  assert.match(source, /enabled:\s*isDevOrTest/);
  // Fail-closed: no state (e.g. 401/403/404 from production gate) renders nothing.
  assert.match(source, /if \(!visible \|\| !state\) return null/);
});

test("the deploy bar shows exactly three options: publish, switch environment, restore", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /data-testid="deploy-bar-publish"/);
  assert.match(source, /data-testid="deploy-bar-environment"/);
  assert.match(source, /data-testid="deploy-bar-restore"/);
  assert.match(source, /تبديل البيئة/);
  assert.match(source, /نشر/);
  assert.match(source, /استعادة/);
  // No leftover technical surface.
  assert.doesNotMatch(source, /RWQAN DEPLOY/);
  assert.doesNotMatch(source, /بيئة النشر:/);
  assert.doesNotMatch(source, /بيئة البيانات:/);
  assert.doesNotMatch(source, /data-testid="deploy-bar-versions"/);
  assert.match(source, /data-testid="deploy-bar-checks"/);
  assert.doesNotMatch(source, /data-testid="deploy-bar-git"/);
  assert.doesNotMatch(source, /الرجوع: غير جاهز/);
  assert.match(source, /window\.confirm/);
});

test("the deploy bar talks only to the admin-guarded deploy API and never claims simulation", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /"\/api\/admin\/deploy\/state"/);
  assert.match(source, /\/api\/admin\/deploy\/releases/);
  assert.doesNotMatch(source, /محاكاة/);
  assert.doesNotMatch(source, /sk_live_|sk_test_|BEGIN (RSA |)PRIVATE KEY/);
  assert.doesNotMatch(source, /firebase deploy|git push/);
  // The production host is named only in the explicit LIVE confirmation,
  // never as a client-chosen deploy target.
  assert.match(source, /https:\/\/rwqan\.sa/);
});

test("the bar exposes ONE permanent two-option LIVE|TEST switch (never a single changing button)", () => {
  const source = read("./deploy-bar.tsx");
  assert.doesNotMatch(source, /البيئة: TEST/);
  assert.doesNotMatch(source, /البيئة: LIVE/);
  // One grouped control whose BOTH options are always rendered side by side.
  assert.match(source, /data-testid="deploy-bar-environment"/);
  assert.doesNotMatch(source, /data-testid="deploy-bar-data-environment"/);
  assert.match(source, /\(\["LOCAL", "TEST", "LIVE"\] as const\)\.map/);
  assert.match(source, /deploy-bar-environment-\$\{option\.toLowerCase\(\)\}/);
  // The active option is marked for assistive tech and visually highlighted.
  assert.match(source, /aria-pressed=\{active\}/);
  assert.match(source, /bg-red-600 text-white/);
  assert.match(source, /bg-amber-600 text-white/);
  // Selecting the CURRENT option is a no-op; selecting the OTHER runs the switch.
  assert.match(source, /dataEnvironment\.environment === target\) return/);
  assert.match(source, /environmentMutation\.mutate\(target\)/);
  // LIVE is gated by the server-side production availability (fail closed).
  assert.match(source, /dataEnvironment\.liveAvailable/);
  // The LIVE failure surfaces a brief, NON-TECHNICAL message only: the server's
  // credential/variable reason must never reach the user.
  assert.match(source, /تعذّر تفعيل LIVE/);
  assert.doesNotMatch(source, /parsed\.reason/);
  assert.doesNotMatch(source, /liveUnavailableReason/);
});

test("the LIVE switch is refused with an explanation when production images are unconfigured", () => {
  const source = read("./deploy-bar.tsx");
  // The guard uses ONLY the non-secret availability flag, never the technical reason.
  assert.match(source, /dataEnvironment\.liveImagesAvailable/);
  assert.match(source, /صور الإنتاج غير مُهيَّأة/);
  assert.doesNotMatch(source, /liveImagesUnavailableReason/);
  // The refusal runs BEFORE the confirmation that leads to the switch.
  const guard = source.indexOf("liveImagesAvailable");
  const confirm = source.indexOf("تبديل بيئة البيانات إلى LIVE");
  assert.ok(guard > 0 && confirm > 0 && guard < confirm);
});

test("the environment switch wires data AND the real deploy target together", () => {
  const source = read("./deploy-bar.tsx");
  // One selection must move BOTH stores so publish/restore never drift.
  assert.match(source, /"\/api\/admin\/live\/environment"/);
  assert.match(source, /"\/api\/admin\/deploy\/environment"/);
  // The switch refreshes the WHOLE app so the visible data reflects it.
  assert.match(source, /queryClient\.invalidateQueries\(\)/);
  // Both option labels are literal, and nothing technical leaks into the bar.
  assert.match(source, /"LOCAL", "TEST", "LIVE"/);
  assert.doesNotMatch(source, /state\.stableBaseline\.site/);
});

test("the mismatch guard runs BEFORE any confirmation, separated per environment", () => {
  const source = read("./deploy-bar.tsx");
  // One shared entry for BOTH buttons: a request for the environment the
  // server is not tracking is refused with plain-Arabic guidance BEFORE any
  // window.confirm — it is never sent to the server.
  assert.match(source, /state\.environment !== targetEnv/);
  const mismatch = source.indexOf("state.environment !== targetEnv");
  const confirm = source.indexOf("window.confirm");
  assert.ok(mismatch > 0 && confirm > 0 && mismatch < confirm);
  // Each environment targets its own tracked env; the live publish still
  // requires the separate server-side production opt-in (fail closed).
  assert.match(source, /state\.productionDeployEnabled/);
  assert.match(source, /هل تريد تحديث الموقع الرسمي بآخر نسخة موجودة على فرعه؟/);
  assert.match(source, /rwqan\.sa/);
  // Success is only claimed after the post-deploy verification passed.
  assert.match(source, /release\?\.postDeploy\?\.ok === true/);
});

test("publish carries the requested environment and explicit approval from the confirm flow", () => {
  const source = read("./deploy-bar.tsx");
  // The publish request carries the environment chosen by the clicked button
  // (validated against server-tracked state first) — never a client target.
  assert.match(source, /environment:\s*input\.environment/);
  // Approval is explicit and comes from the confirmation flow.
  assert.match(source, /approve:\s*input\.approval/);
  // The UI never composes a requestedTarget for the server to execute.
  assert.doesNotMatch(source, /requestedTarget/);
});

test("TEST and LIVE publish buttons are independent, with a real status chip", () => {
  const source = read("./deploy-bar.tsx");
  // Two separate buttons, one per environment, with plain Arabic labels.
  assert.match(source, /data-testid="deploy-bar-publish-test"/);
  assert.match(source, /data-testid="deploy-bar-publish-live"/);
  assert.match(source, /نشر نسخة التجربة/);
  assert.match(source, /نشر الموقع الرسمي/);
  // Each environment points at ITS OWN GitHub workflow — never crossed.
  assert.match(source, /actions\/workflows\/deploy-test\.yml/);
  assert.match(source, /actions\/workflows\/deploy-live\.yml/);
  // REAL deployment status is read from the read-only server status endpoint
  // (which mirrors GitHub Actions), polled periodically.
  assert.match(source, /\/api\/admin\/deploy\/status\?environment=/);
  assert.match(source, /refetchInterval:\s*20_000/);
  assert.match(source, /data-testid="deploy-bar-publish-status"/);
  // Plain Arabic labels of the REAL run state.
  assert.match(source, /جارٍ التحديث الآن/);
  assert.match(source, /اكتمل آخر تحديث/);
  assert.match(source, /فشل آخر تحديث/);
  // An accepted GitHub request is NEVER shown as a completed deploy.
  assert.doesNotMatch(source, /تم النشر بنجاح/);
});

test("publish error handler uses the real server error, not a blanket connection message", () => {
  const source = read("./deploy-bar.tsx");
  // onError receives the error and resolves a user-facing Arabic message.
  assert.match(source, /onError:\s*\(error: unknown\)\s*=>/);
  assert.match(source, /deployErrorMessage\(error\)/);
  // deployErrorMessage is defined and handles status + body + network fallback.
  assert.match(source, /function deployErrorMessage\(error: unknown\): string/);
  assert.match(source, /body\.error/);
  assert.match(source, /case 401:/);
  assert.match(source, /case 409:/);
  assert.match(source, /case 502:/);
  assert.match(source, /تعذّر الاتصال بالخادم/);
  // The blanket "تحقّق من الاتصال" message is NOT the only handler anymore.
  assert.doesNotMatch(
    source,
    /onError:\s*\(\)\s*=>\s*\{\s*toast\(\s*\{\s*title:\s*"تعذّر النشر"/s,
  );
});

test("TEST publish confirmation and result messages use plain Arabic (no technical jargon)", () => {
  const source = read("./deploy-bar.tsx");
  // The confirmation prompt is written for a non-technical site owner.
  assert.match(source, /هل تريد تحديث بيئة التجربة/);
  assert.match(source, /رابط بيئة التجربة/);
  assert.match(source, /يبدأ التحديث من GitHub تلقائيًا/);
  assert.match(source, /الموافقة هنا طلب بدء التحديث فقط/);
  // No technical terms in the confirm/result surface.
  assert.doesNotMatch(source, /workflow_dispatch/);
  // The GitHub Actions follow-up link is always offered.
  assert.match(source, /modii1\/rwqan\/actions\/workflows\/deploy-test\.yml/);
});

test("the old direct-Firebase failure message is never shown; friendly admin wording instead", () => {
  const source = read("./deploy-bar.tsx");
  // The stale-server Firebase CLI failure text must never be DISPLAYED: the
  // components contains none of the two banned phrases verbatim (they are
  // assembled in detection as regex fragments), and every failure path shows
  // friendly admin Arabic instead.
  assert.doesNotMatch(source, /فشل إنشاء rollout/);
  assert.doesNotMatch(source, /رمز الخروج/);
  assert.match(source, /friendlyDeployFailure/);
  assert.match(source, /لم يبدأ التحديث: نسخة الموقع على الخادم قديمة/);
  assert.match(source, /إعداد الربط مع GitHub غير مكتمل/);
  assert.match(source, /النسخة المرفوعة إلى GitHub ليست هي نفس النسخة المعتمَدة/);
  assert.match(source, /التفاصيل التقنية في سجل النشر/);
  // The friendly mapping runs BEFORE any raw server error is displayed.
  assert.match(
    source,
    /friendlyDeployFailure\(status, body\);\s*if \(friendly\) return friendly;\s*if \(typeof body\.error/,
  );
});

test("the restore list surfaces the real stable release only", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /state\.stableReleases\.map/);
  assert.doesNotMatch(source, /state\.releases\.map/);
  assert.match(source, /isFullGitSha\(release\.gitCommit\)/);
  // Restoring is a real hosting restore, not a local folder materialization.
  assert.doesNotMatch(source, /targetPath/);
  assert.match(source, /التحقق: \$\{restore\.verified/);
});

test("global CSS offsets the layout only while the deploy bar is active", () => {
  const css = read("../app/globals.css");
  assert.match(css, /html\.rwqan-deploy-active/);
  assert.match(css, /--rwqan-deploy-bar-height/);
  assert.match(css, /html\.rwqan-deploy-active body\s*\{[\s\S]*padding-top/);
});
