import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("the deploy bar upload button is icon-only with a tooltip and no visible label", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /data-testid="deploy-bar-upload-test"/);
  assert.match(source, /aria-label="رفع إلى GitHub"/);
  assert.match(source, /data-testid="deploy-bar-upload-panel"/);
  // The button renders the Upload (arrow-up) icon only — no visible text.
  assert.match(source, /<Upload className="h-3\.5 w-3\.5" \/>/);
  assert.match(source, /<TooltipContent side="bottom" className="text-xs">\s*رفع إلى GitHub\s*<\/TooltipContent>/);
});

test("the upload handler never delegates to the publish flow", () => {
  const source = read("./deploy-bar.tsx");
  // The dedicated upload handler must NOT reference the publish entry point.
  assert.doesNotMatch(source, /const handleUploadBranch = \(\) => \{[\s\S]{0,600}?startPublish/);
  assert.match(source, /const handleUploadBranch = \(\) => \{[\s\S]{0,900}?uploadMutation/);
});

test("the upload mutation calls only the dedicated upload endpoint with the selected environment", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /apiRequest\(\s*"POST",\s*"\/api\/admin\/deploy\/upload"/);
  assert.match(source, /environment:\s*state\.environment/);
});

test("the upload stepper exposes the fixed stage list and result surfaces", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /data-testid="deploy-bar-upload-stages"/);
  // Stage rows are rendered per resolved stage with a dynamic testid suffix.
  assert.match(source, /data-testid=\{`deploy-bar-upload-stage-\$\{entry\.stage\}\`}/);
  for (const stage of [
    "connection",
    "branch",
    "changes",
    "github_connection",
    "push",
    "verify",
  ]) {
    assert.match(source, new RegExp(`key: "${stage}"`));
  }
  assert.match(source, /data-testid="deploy-bar-upload-result"/);
  assert.match(source, /data-testid="deploy-bar-upload-result-title"/);
  assert.match(source, /data-testid="deploy-bar-upload-result-detail"/);
  assert.match(source, /data-testid="deploy-bar-upload-result-sha"/);
  assert.match(source, /data-testid="deploy-bar-upload-panel-close"/);
  assert.match(source, /data-testid="deploy-bar-upload-done"/);
});

test("the upload button is disabled while an upload is pending (no repeat clicks)", () => {
  const source = read("./deploy-bar.tsx");
  assert.match(source, /disabled=\{uploadMutation\.isPending\}/);
});
