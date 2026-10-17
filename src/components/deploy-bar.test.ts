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
  assert.match(source, /process\.env\.NODE_ENV === "development"/);
  assert.match(source, /enabled:\s*isDevelopment/);
  // Fail-closed: no state (e.g. 401/403/404 from production gate) renders nothing.
  assert.match(source, /if \(!visible \|\| !state\) return null/);
});

test("the deploy bar shows RWQAN DEPLOY, the environment, and the three actions", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /RWQAN DEPLOY/);
  assert.match(source, /بيئة النشر: TEST/);
  assert.match(source, /بيئة النشر: LIVE/);
  assert.match(source, /data-testid="deploy-bar-publish"/);
  assert.match(source, /data-testid="deploy-bar-versions"/);
  assert.match(source, /data-testid="deploy-bar-restore"/);
  assert.match(source, /window\.confirm/);
});

test("the deploy bar talks only to the admin-guarded deploy API and is simulation-only", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /"\/api\/admin\/deploy\/state"/);
  assert.match(source, /\/api\/admin\/deploy\/releases/);
  assert.match(source, /محاكاة/);
  assert.doesNotMatch(source, /sk_live_|sk_test_|BEGIN (RSA |)PRIVATE KEY/);
  assert.doesNotMatch(source, /https:\/\/rwqan\.sa/);
  assert.doesNotMatch(source, /firebase deploy|git push/);
});

test("the bar separates the deploy status from the single data-environment control", () => {
  const source = read("./deploy-bar.tsx");
  // Deploy status is clearly labelled as the DEPLOY environment, not the data one.
  assert.match(source, /بيئة النشر: TEST/);
  assert.match(source, /بيئة النشر: LIVE/);
  assert.doesNotMatch(source, /البيئة: TEST/);
  assert.doesNotMatch(source, /البيئة: LIVE/);
  // The single clear data-environment control with its source.
  assert.match(source, /بيئة البيانات:/);
  assert.match(source, /data-testid="deploy-bar-data-test"/);
  assert.match(source, /data-testid="deploy-bar-data-live"/);
  assert.match(source, /data-testid="deploy-bar-data-environment"/);
  // The LIVE failure surfaces the server's real reason (parsed), not a raw string.
  assert.match(source, /تعذّر تفعيل LIVE/);
  assert.match(source, /parsed\.reason/);
  // TEST stays usable even when LIVE is unavailable (only the LIVE button is gated).
  assert.match(
    source,
    /data-testid="deploy-bar-data-test"\s*\n\s*className=\{`h-7 px-3[^`]*\}/,
  );
});

test("global CSS offsets the layout only while the deploy bar is active", () => {
  const css = read("../app/globals.css");
  assert.match(css, /html\.rwqan-deploy-active/);
  assert.match(css, /--rwqan-deploy-bar-height/);
  assert.match(css, /html\.rwqan-deploy-active body\s*\{[\s\S]*padding-top/);
});
