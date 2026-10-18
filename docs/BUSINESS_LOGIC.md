# BUSINESS LOGIC REFERENCE — Ruqan / Rwqan

## Core Rule
Do NOT alter business logic casually. Any change requires documented
BUSINESS LOGIC IMPACT and a version history entry referencing it.

## Known Business Domains (summary)
- Properties: management, public listing, images (public intentionally).
- Owners: PIN/password login, password change/reset via OTP.
- Subscriptions: package selection, activation, renewal, linked properties.
- Payments: Paymob integration (PROD-only), receipts upload, booking commissions.
- Discounts, Add-ons: package extras.
- Requests: owner smart requests, analytics.
- Check-ins/verification: verification logs, subscription verification.
- Booking Commission Receipts: private receipts, token-scoped collection flow.

## Semantics Preserved Intentionally
- Public property images are intentionally public (NOT a defect).
- Legacy VIP semantics (BL-006) are preserved — treated as legacy behavior, not a bug.
- API-002 DEV package list empty — DEV data/seed infrastructure gap, not fixed by logic.

## Verification (2026-10-13)
- Business-logic suite PASS 10/10 in-process (real shared modules). No business-logic
  source changed this session — only the BL-006 fixture was corrected to the real
  legacy VIP document shape (adds pricePerProperty normalization argument), leaving the
  base 50 SAR assertion identical (DEC-011).
- Subscriptions/pricing/dates/suspensions normalization asserted unchanged (BL-001..010;
  shared/*.test.ts in the 702-test suite).

## BL-003
- Test expectation corrected to match code contract (inactive packages allowed).
  Test-only correction, no business logic change.

## AUTH-001 Related Semantics
- Legacy plaintext still readable during transition (PROD).
- New writes always hashed.
- Migration-on-login only when flag enabled.
- Enforcement rejects legacy when AUTH_ENFORCE_HASHED_ONLY=true (DEV new model).

## Do Not Change Without Approval + Documented Impact
- Pricing/package amounts, subscription boundaries, renewal dates, commissions,
  discounts, refund/auth flows, booking semantics, public-image behavior.