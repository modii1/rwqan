# UI/UX REFERENCE — Ruqan / Rwqan

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