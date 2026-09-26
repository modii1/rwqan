import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./admin-subscriptions.tsx", import.meta.url),
  "utf8",
);

test("consumes operations inbox property deep links in the subscription search", () => {
  assert.match(source, /const searchParams = useSearchParams\(\)/);
  assert.match(
    source,
    /getAdminOperationTarget\(searchParams, "property"\)/,
  );
  assert.match(
    source,
    /const \[searchQuery, setSearchQuery\] = useState\(targetedPropertyNumber\)/,
  );
  assert.match(
    source,
    /if \(targetedPropertyNumber\) setSearchQuery\(targetedPropertyNumber\)/,
  );
  assert.match(source, /data-testid="input-search-subscriptions"/);
});
