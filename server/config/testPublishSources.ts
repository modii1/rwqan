/**
 * TEST publish source policy (OLD / NEW) — single source of truth.
 *
 * These values are deliberately NOT derived from the local working tree, the
 * local branch, or the deployed runtime. OLD always deploys the pinned
 * application SHA below; the branch tip may legitimately be NEWER because it
 * contains the `deploy-test.yml` workflow definition (a separate commit from
 * the application code).
 */

export type TestPublishSource = "OLD" | "NEW";

export const TEST_PUBLISH_OLD_BRANCH = "main" as const;
export const TEST_PUBLISH_NEW_BRANCH = "test/unified-gateway-ui-only" as const;

/** The approved OLD (main) APPLICATION commit that OLD→TEST must deploy. */
export const TEST_PUBLISH_APPROVED_OLD_SHA =
  "15c60767c49b812f6f35e8c29245651cbd4fe3dd" as const;

export function testPublishBranch(source: TestPublishSource): string {
  return source === "OLD" ? TEST_PUBLISH_OLD_BRANCH : TEST_PUBLISH_NEW_BRANCH;
}
