# Booking follow-up and commission rollout

## Product behavior

- Booking follow-up, owner notifications, commission collection, and commission holds apply only to properties without an active premium subscription. A workflow must originate while the property is free; a premium-origin workflow is never created and cannot become eligible after a later downgrade.
- If a free property becomes actively premium, the workflow is durably closed: queued messages are cancelled, any unpaid booking commission is waived, and only that booking's property-hold obligation is released. Historical payment attempts and signed provider callbacks remain available for financial audit.
- An accepted anonymous contact request schedules one customer WhatsApp follow-up after the configured delay. The default is 24 hours, and admins may set an integer from 1 to 120 hours.
- Changing the customer follow-up delay applies only to newly accepted contacts for free properties. Existing scheduled messages keep their original delivery time.
- The customer message uses an internal `/b/<10-character-code>` alias. Previously issued 22-character aliases remain valid. Opening the alias, follow-up page, bookings profile, or admin dashboard never creates or resends the automatic job; an admin resend is a separate audited action.
- An unanswered workflow expires seven days after the original contact. A verified customer profile session remains separate from that response deadline.
- An unanswered follow-up can be answered for seven days from the accepted contact. The signed customer session remains usable for 90 days to view an already answered profile, but expired unanswered links and queued messages are cancelled.
- The follow-up first asks whether a booking happened. A “No” answer closes the workflow. A “Yes” answer opens exactly three facts:
  1. Booking timing: midweek, weekend, or other.
  2. Booking date: an exact day or a month-only value.
  3. Price paid in SAR.
- The confirmed facts are sent to the property owner. When commission enforcement is enabled, the same message includes the exact 10% commission and a signed Paymob payment link.
- Booking dates remain stored as canonical Gregorian values. The customer can switch the questionnaire and profile display between Gregorian and Umm al-Qura Hijri without changing the stored date.
- Commission payment supports the existing electronic Paymob methods or a bank transfer with a JPEG, PNG, WebP, or PDF receipt. A pending bank review parks payment reminders and enforcement; approval settles the obligation, while rejection preserves the evidence and resumes collection safely.
- Rejecting an owner dispute schedules the dedicated configurable rejection template once. Accepting a dispute cancels collection and releases only that booking's hold obligation.
- For accepted anonymous contacts evaluated while the feature is available, Contact Analytics records whether the follow-up was scheduled or failed during setup. Setup failures store only a bounded reason code and alert admin after the contact transaction succeeds.
- Before confirmation, every owner-message send, and any property hold, the current property record must still exist and its canonical WhatsApp owner phone must match the owner identity captured at contact time. A mismatch is never retargeted automatically: collection stops, no new debt is created at confirmation, and an admin-visible review event is recorded without storing either phone in the event.
- The five-day payment window starts only after the WhatsApp provider accepts that owner message for sending. Day 5 is mandatory; admins may enable or disable the optional day-3 and day-4 reminders for newly confirmed or restarted collection workflows.
- If the commission remains unpaid, the WhatsApp provider must accept the day-5 reminder and the pause warning before the booked property receives a commission hold. The hold hides and blocks contact with only that property; it does not alter subscription dates or linked properties.
- A verified Paymob settlement releases the exact commission obligation. If no other obligations hold the property, it becomes visible and contactable again.
- If the property's current canonical owner phone no longer matches the contact-time owner identity, confirmation stays observe-only or an existing debt enters admin review. Facts, billing notices, and holds fail closed rather than being retargeted automatically.
- While a property has an active commission hold, owner and general admin property edits cannot change its canonical WhatsApp owner phone. Resolve the obligation and release the hold through the booking-commission controls before transferring the property; equivalent formatting of the same canonical phone remains allowed.
- Admin booking totals are calculated over the complete booking and notification collections. Each booking exposes a sanitized notification history and complete payment-attempt history without recipient phones, quota keys, checkout URLs, or lease tokens.

## Limits

- Customer booking follow-ups: 3 per normalized customer phone per Riyadh day by default.
- Confirmed-booking fact messages for free-property owners: 3 per normalized owner phone per Riyadh day by default, across all of that phone’s free properties.
- Billing messages (the initial payment notice, enabled day-3/day-4 reminders, mandatory day 5, pause, and release) are transactional and exempt from promotional quotas. They are persisted, idempotently keyed, and audited in the notification outbox.
- Admins can configure all three limits in the booking-commission dashboard. Environment values remain fallbacks through `CUSTOMER_BOOKING_FOLLOWUP_DAILY_LIMIT`, `FREE_OWNER_BOOKING_NOTIFICATION_DAILY_LIMIT`, and `FREE_PROPERTY_DAILY_CONTACT_LIMIT`.
- The same admin settings screen can edit the customer follow-up delay and the eight free-workflow WhatsApp templates. Required placeholders are validated; the five-day payment window and mandatory day-5 warning cannot be changed.

## Before deployment

1. Enable the `booking_notification_quotas.expiresAtTtl` TTL override in `firestore.indexes.json` for quota cleanup. The staging worker uses single-field time scans and does not require the three composite booking indexes; reassess the indexed query strategy before high-volume production rollout.
2. Configure `PUBLIC_BASE_URL` with the production HTTPS origin.
3. Configure `BOOKING_WORKER_SECRET` as a separate random secret of at least 32 bytes. Do not reuse it in URLs or client code.
4. Confirm `SESSION_SECRET` is at least 32 bytes because it signs purpose-bound customer and owner links.
5. Configure an authenticated Cloud Scheduler request every five minutes:
   - Method: `POST`
   - Path: `/api/internal/booking-worker`
   - Header: `Authorization: Bearer <BOOKING_WORKER_SECRET>`
6. Confirm the Enjazatik WhatsApp sender and Paymob production credentials/callback are healthy.
7. Configure R2 receipt storage and verify at least one active bank account has a bank name, beneficiary name, and valid Saudi IBAN. Selecting a default account clears the prior default; inactive accounts are never offered for a new receipt.
8. Keep both new feature flags disabled at deploy time:
   - `FEATURE_BOOKING_FOLLOWUP`
   - `FEATURE_BOOKING_COMMISSION_ENFORCEMENT`

The in-process five-minute worker is a safety net. Cloud Scheduler is the authoritative trigger because Cloud Run may scale to zero or run multiple instances.

## Staged activation

### Phase 1 — observe booking follow-ups

Enable `FEATURE_BOOKING_FOLLOWUP` and leave commission enforcement disabled for 3–7 days.

Validate:

- accepted contact → follow-up scheduled → WhatsApp sent;
- Yes/No and the strict three-fact questionnaire;
- month-only and exact-day dates;
- customer profile isolation and masked phone;
- free-owner and customer quota behavior;
- admin funnel, timelines, provider-send failures, and suppressed notifications.

Bookings confirmed during this phase remain observe-only: no commission debt, payment link, reminders, or property hold is created retroactively.

### Phase 2 — controlled commission cohort

Enable `FEATURE_BOOKING_COMMISSION_ENFORCEMENT` only after Phase 1 metrics are stable. Monitor the first live confirmations individually.

For each first-cohort booking, verify:

- 10% is calculated in integer halalas;
- the initial owner message is accepted by the WhatsApp provider and becomes the recorded start of the five-day window;
- Paymob checkout identity matches booking, attempt, order, amount, currency, and merchant reference;
- a valid signed callback marks the obligation paid exactly once;
- duplicate success, reversal, identity mismatch, or uncertain creation is escalated for manual financial review rather than enforced automatically.
- a canonical refund or void requires an admin choice: keep the obligation paid after finance review, or restart collection with a fresh owner notice and five-day window;
- a pre-settlement void, error, refund, or other non-payable provider result closes only that attempt and permits a new checkout.
- an issued Paymob checkout remains financially unresolved until Paymob reports a terminal result or finance reconciles it; do not waive its disputed commission merely because the owner abandoned the browser page.

### Phase 3 — complete five-day lifecycle

Keep the first unpaid controlled obligation through the full lifecycle and verify:

- each enabled optional day-3/day-4 reminder and the mandatory day-5 reminder;
- provider-send retries and admin-visible failures;
- provider acceptance of the pause warning before enforcement;
- property removal from list, search, occasions, sitemap, detail, images, and contact;
- verified payment releases only the settled obligation and restores the property when no other hold remains.

After this cohort passes, expand gradually while watching the admin dashboard.

## Monitoring and manual review

Monitor these values daily during rollout:

- contacts, awaiting responses, declined and confirmed bookings;
- reported booking value, commission due, commission paid, overdue, and paused counts;
- pending, failed, and quota-suppressed WhatsApp jobs;
- disputes and their admin resolution;
- owner-identity changes, premium-tier eligibility closures, and expired response links;
- Paymob creation uncertainty, reconciliation deferrals, duplicate payments, refunds, voids, and other reversals.

The current WhatsApp integration records API acceptance/failure, not handset-level delivery or read receipts; it has no inbound delivery-status webhook. Admin wording and operational decisions must use that distinction.

The initial owner commission notice has three bounded delivery attempts. If all fail, the property is not paused and the obligation requires operator follow-up before collection can continue.

Never clear `commissionHold` directly. General admin property-edit endpoints discard direct `commissionHold` and `commissionHold.*` fields. Resolve an obligation through a verified payment or an admin dispute decision. Duplicate payments and reversals require a provider-side financial review before any refund or collection decision.

## Rollback

- Disable `FEATURE_BOOKING_COMMISSION_ENFORCEMENT` to stop commission notices, reminders, new holds, and automated enforcement while preserving existing financial records.
- Disable `FEATURE_BOOKING_FOLLOWUP` to stop new workflows and follow-up/fact notifications.
- Disabling flags does not erase confirmed bookings, paid records, pending obligations, or existing holds. Existing holds must be released by verified settlement or an accepted admin dispute.
- The enforcement flag is a kill switch, not a deadline-freezing mechanism. Before re-enabling it after a prolonged outage, review pending obligations and their due times in the admin dashboard.

## Separate payment incident

The historical paid-but-unfulfilled payment for property 13383 is not part of this rollout and must not be repaired by the booking-commission worker. It remains a separate subscription entitlement/refund decision.
