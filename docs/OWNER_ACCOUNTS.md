# Owner accounts

The canonical owner-account flow is additive. The legacy property-number/PIN
login remains available while owners migrate by claiming their current
property.

## Authentication flow

- `POST /api/owner/account/login/challenge` with `{ phone }`
- `POST /api/owner/account/login/verify` with
  `{ challengeId, phone, code }`
- `POST /api/owner/account/claim/challenge` under a legacy owner session
- `POST /api/owner/account/claim/verify` with `{ challengeId, code }`
- `POST /api/owner/account/properties/challenge` with `{ propertyNumber }`
  under an owner-account session
- `POST /api/owner/account/properties/verify` with `{ challengeId, code }`

Challenge responses contain only `challengeId`, `maskedPhone`, and
`expiresInSeconds`. Successful verification returns `ok`, the active
`propertyNumber`, and safe property options. Raw phone numbers, account IDs,
OTP values, and HMAC subjects are never returned.

Each OTP challenge is bound to exactly one purpose, phone subject, account
context, and property context. Challenges expire after ten minutes, allow five
attempts, and are consumed once. Issuance is limited durably and in-process by
phone and IP. Unknown login phones receive a stored decoy challenge without an
outbound WhatsApp message so the challenge response does not enumerate
accounts or create notification spam.

## Firestore model

- `owner_accounts`: random opaque account IDs, stable phone HMAC, account
  status, and `authVersion`.
- `owner_account_phone_indexes`: one HMAC-keyed index mapping a phone subject
  to its account. No raw phone is persisted.
- `owner_property_memberships`: one document keyed by property number. This is
  the unique ownership boundary; active memberships authorize account access.
- `owner_account_otp_challenges`: purpose-bound, one-use OTP challenges.
- `owner_account_otp_issue_limits`: durable per-phone and per-IP issue limits.
- `owner_login_attempt_limits`: durable HMAC-keyed limits shared by legacy PIN
  login and legacy password-reset issuance/verification.

Firestore TTL must be deployed from `firestore.indexes.json` for the three
challenge/rate-limit collections.

## Sessions and migration

Owner-account sessions store only `ownerAccountId`, `authVersion`, and the
active `propertyNumber`. Session IDs rotate after login, claim, attach, and
property switching. Every protected owner request validates the account status,
auth version, and active membership. A revoked membership or incremented auth
version invalidates access immediately.

Legacy sessions contain only `propertyNumber` and retain the subscription-group
fallback. Account sessions use permanent memberships for property lists and
switching; PIN equality is never accepted as account ownership.

Claim and attach OTPs use the separately persisted `owners/{propertyNumber}`
phone, never the owner-editable public property contact number. A property that
does not yet have that trusted owner record fails closed and must be backfilled
or verified by an administrator before account migration. Legacy sessions
cannot change the public WhatsApp number; that edit becomes available after a
verified owner-account session is established. This prevents a leaked legacy
PIN from replacing the OTP destination and self-claiming the property.

Payments created by verified owner accounts store their originating account ID.
Payment history, retry, verification, linked-group changes, asynchronous
provider fulfillment, and pending/unlink mutations revalidate every affected
property membership. A later transfer or revocation therefore makes an older
checkout fail closed before it can mutate another owner's property.

The legacy reset flow remains compatible, but reset codes are generated with a
cryptographic RNG, stored as purpose-bound HMAC digests, expire after ten
minutes, allow at most five transactional attempts, and are atomically consumed
before a password write. Both reset routes require a same-origin request and
use the durable IP/property credential-attempt limiter.

Set a stable, random `OWNER_ACCOUNT_HMAC_SECRET` of at least 32 bytes before
owners begin claiming properties. It is intentionally separate from
`SESSION_SECRET` so routine session-key rotation does not invalidate the phone
index. A `SESSION_SECRET` fallback exists only to keep older deployments from
failing startup before this variable is installed.
