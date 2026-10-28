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

test("publish targets the active environment with an explicit LIVE confirmation", () => {
  const source = read("./deploy-bar.tsx");
  // LIVE refuses before confirming unless the separate production opt-in is set.
  assert.match(source, /state\.productionDeployEnabled/);
  assert.match(source, /نشر حقيقي إلى بيئة الإنتاج/);
  assert.match(source, /rwqan\.sa/);
  // Success is only claimed after the post-deploy verification passed.
  assert.match(source, /release\?\.postDeploy\?\.ok === true/);
});

test("publish sends the server-tracked environment, never a client-chosen target", () => {
  const source = read("./deploy-bar.tsx");
  // The publish request carries the environment tracked by server state.
  assert.match(source, /environment:\s*state\.environment/);
  // Approval is explicit and comes from the confirmation flow.
  assert.match(source, /approve:\s*approval/);
  // The UI never composes a requestedTarget for the server to execute.
  assert.doesNotMatch(source, /requestedTarget/);
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
