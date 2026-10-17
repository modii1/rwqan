import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./suspended-subscriptions.tsx", import.meta.url),
  "utf8",
);

test("offers the add flow for manually pausing a free property", () => {
  assert.match(source, /const \[pauseDialogOpen, setPauseDialogOpen\] = useState\(false\)/);
  assert.match(source, /onClick=\{\(\) => setPauseDialogOpen\(true\)\}/);
  assert.match(source, /data-testid="button-open-pause-free-property"/);
  assert.match(source, /<Plus className="h-4 w-4" \/>/);
  assert.match(source, /open=\{pauseDialogOpen\}/);
  assert.match(source, /data-testid=\{`button-select-free-property-\$\{candidate\.propertyNumber\}`\}/);
  assert.match(source, /data-testid="button-confirm-pause-free-property"/);
});

test("keeps free-property holds on their own pause and resume API actions", () => {
  assert.match(source, /const queryClient = useQueryClient\(\)/);
  assert.doesNotMatch(source, /import \{ apiRequest, queryClient \} from "@\/lib\/queryClient"/);
  assert.match(source, /queryKey: \["\/api\/admin\/property-availability-holds"\]/);
  assert.match(
    source,
    /`\/api\/admin\/property-availability-holds\/\$\{encodeURIComponent\(candidate\.propertyNumber\)\}\/pause`/,
  );
  assert.match(
    source,
    /`\/api\/admin\/property-availability-holds\/\$\{encodeURIComponent\(hold\.propertyNumber\)\}\/resume`/,
  );
  assert.match(
    source,
    /expectedCommissionHoldVersion: hold\.commissionHoldVersion/,
  );
  assert.match(source, /data-testid=\{`button-resume-property-hold-\$\{hold\.propertyNumber\}`\}/);
  assert.match(source, /data-testid="button-confirm-resume-property-hold"/);
});

test("keeps property hold cards and dialogs within narrow mobile viewports", () => {
  assert.match(source, /<section className="min-w-0 space-y-5"/);
  assert.match(source, /className="grid min-w-0 gap-3 xl:grid-cols-2"/);
  assert.match(source, /className="min-w-0 overflow-hidden p-4 sm:p-5"/);
  assert.match(source, /className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"/);
  assert.match(source, /className="max-w-full whitespace-normal border border-slate-300/);
  assert.match(source, /className="flex w-full flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"/);
  assert.match(source, /className="w-full min-w-0 gap-2 bg-green-700 text-white hover:bg-green-800 sm:w-auto"/);
  assert.match(source, /className="flex w-full flex-col gap-2 min-\[360px\]:flex-row sm:w-auto sm:justify-end"/);
  assert.match(
    source,
    /className="max-h-\[85svh\] w-\[calc\(100vw-1\.5rem\)\] max-w-lg overflow-y-auto"/,
  );
  assert.match(source, /className="w-\[calc\(100vw-1\.5rem\)\] max-w-md"/);
});

test("a free-hold query delay or failure does not hide paid subscription controls", () => {
  assert.match(source, /if \(isLoading\) \{/);
  assert.doesNotMatch(source, /if \(isLoading \|\| holdsLoading\)/);
  assert.match(source, /\{holdsLoading && \(/);
  assert.match(source, /\{holdsError && \(/);
  assert.match(source, /data-testid=\{`button-resume-suspended-\$\{subscription\.propertyNumber\}`\}/);
});

test("new availability dates use Gregorian month names with Western digits", () => {
  assert.match(source, /ar-SA-u-ca-gregory-nu-latn/);
});

test("preserves the existing paid subscription resume route and copy", () => {
  assert.match(
    source,
    /`\/api\/admin\/subscriptions\/\$\{encodeURIComponent\(subscription\.id \|\| subscription\.propertyNumber\)\}\/resume`/,
  );
  assert.match(source, /data-testid=\{`button-resume-suspended-\$\{subscription\.propertyNumber\}`\}/);
  assert.match(source, /data-testid="button-confirm-resume-suspended"/);
  assert.match(source, /المدة المتبقية محفوظة ولا تنقص حتى استئناف الاشتراك\./);
  assert.match(source, />\s*استئناف الاشتراك\s*</);
});
