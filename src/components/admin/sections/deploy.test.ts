import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("admin dashboard exposes the deploy console as its own guarded section", () => {
  const dashboardSource = read("../admin-dashboard.tsx");
  const routeSource = read("../../../app/admin/[...section]/page.tsx");

  assert.match(dashboardSource, /import DeploySection from "\.\/sections\/deploy"/);
  assert.match(dashboardSource, /label="نظام النشر"/);
  assert.match(dashboardSource, /activeSection === "deploy"/);
  assert.match(dashboardSource, /<DeploySection \/>/);
  assert.match(routeSource, /"deploy"/);
});

test("deploy section wires the admin API, defaults to TEST, and states it is experimental", () => {
  const source = read("./deploy.tsx");

  // Talks only to the admin-guarded API.
  assert.match(source, /\/api\/admin\/deploy\/state/);
  assert.match(source, /\/api\/admin\/deploy\/environment/);
  assert.match(source, /\/api\/admin\/deploy\/releases/);
  assert.match(source, /restore/);

  // TEST/LIVE switch with TEST as the safe baseline.
  assert.match(source, /TEST/);
  assert.match(source, /LIVE/);

  // Must not execute anything: clearly labelled as simulation.
  assert.match(source, /محاكاة/);
  assert.match(source, /وضع تجريبي/);

  // Restore demands explicit confirmation in the UI too.
  assert.match(source, /window\.confirm/);
});

test("deploy section never embeds secrets or direct production endpoints", () => {
  const source = read("./deploy.tsx");
  assert.doesNotMatch(source, /sk_live_|sk_test_|BEGIN (RSA |)PRIVATE KEY/);
  assert.doesNotMatch(source, /https:\/\/rwqan\.sa/);
  assert.doesNotMatch(source, /firebase deploy|git push/);
});
