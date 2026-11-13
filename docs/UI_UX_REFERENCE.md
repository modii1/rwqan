# UI/UX REFERENCE — Ruqan / Rwqan

CURRENT VERSION: 0.5.0 (2026-11-05)
BRANCH / COMMIT: `test/unified-gateway-ui-only` @ `190b43577b3eee10b835579aa63d2c155fd7e660`
  (0.5.0 changes are in the working tree, not yet committed)

## Design Principles
- Arabic-first, RTL.
- Mobile-first + responsive.
- Accessible, touch-friendly.

## To Document (as inspected/codebase evolves)
- Typography, colors, spacing
- Components: buttons, forms, cards, tables, navigation, dialogs
- Loading / empty / error / success / disabled / validation states
- Mobile navigation, desktop behavior
- Existing design language in app/ + Tailwind theme + Radix components

## Rule
Before creating new UI: search for existing component/pattern and reuse.
Do not introduce a new design system when the existing one suffices.
Significant UI changes must be recorded in VERSION_HISTORY.md.

## Current State (initial)
- Full UI/UX audit not yet performed. THIS SECTION IS A PLACEHOLDER pending audit.
- Marked UNKNOWN where not yet verified.
- Verified (2026-10-13): layout is RTL (`<html lang="ar" dir="rtl">` in
  src/app/layout.tsx); production build compiles all routes; headless-chromium E2E
  loaded `/` (title present) and `/properties` (title present) against the DEV server.

## Environment Bar (current, 0.5.0)
- The deploy bar's environment switch renders only TEST and LIVE. LOCAL is the fixed
  developer environment (`http://localhost:5001`) and is intentionally not offered as a
  switch (DEC-015 implemented; detection/operation unchanged).
- The generic cloud "نشر" button was removed. The explicit "نشر نسخة التجربة" and
  "نشر الموقع الرسمي" buttons remain, with the real GitHub Actions status and failure
  reason (no fake success).
- TEST publish deploys the last approved commit on the TEST branch. It does not create a
  commit, push, or branch. When the local worktree has uncommitted changes, the confirm
  dialog and the gate warn that they will not be published; the files are left untouched.
- A failed mandatory check shows the real server reason (for example which changed file
  tripped the secret scan) instead of the misleading blanket "no release recorded" text.
- The bar refreshes tree state/SHA after a publish request. LIVE/LOCAL keep the strict
  dirty-worktree block.
- LIVE is no longer blocked by a separate production opt-in: the publish button uses the
  approved path (`deploy-live.yml`) and the official domain `https://rwqan.sa` remains
  untouched. Build, target and permission checks still apply. LIVE never auto-commits.