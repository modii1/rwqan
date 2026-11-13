# START HERE — Ruqan / Rwqan Project System

CURRENT VERSION: **0.5.0** (2026-11-05)
BRANCH / COMMIT: `test/unified-gateway-ui-only` @ `190b43577b3eee10b835579aa63d2c155fd7e660`
  (0.5.0 changes are in the working tree, not yet committed)
OFFICIAL REMOTE: `https://github.com/modii1/rwqan`
CURRENT STATE: DEV version — TEST publish deploys the last approved commit on
`test/unified-gateway-ui-only`; it never creates commits, pushes, or branches. Local
uncommitted changes are warned about and never published. GitHub dispatch reuses the
configured token or the existing `gh` session in development. LIVE/LOCAL unchanged. No
production release; no deployment executed for 0.5.0.

## 1. First Read This Order
1. `docs/PROJECT_MASTER_REFERENCE.md`
2. Last entry in `docs/VERSION_HISTORY.md`
3. `docs/SECURITY_STATUS.md`
4. `docs/RELEASE_NOTES.md`
5. `docs/SESSION_HANDOFF.md`
6. `docs/DECISIONS.md`

## 2. Know the Current Status
- Read the header block of `PROJECT_MASTER_REFERENCE.md` first.
- Current STATUS/ENVIRONMENT/VERSION are always recorded at the top.
- Current version: **0.5.0** (2026-11-05), branch `test/unified-gateway-ui-only`,
  base commit `190b43577b3eee10b835579aa63d2c155fd7e660` (0.5.0 changes are in the working tree).
- TEST publish deploys the last approved commit on the TEST branch. It never creates
  commits, pushes, or branches; local uncommitted changes are warned about and never
  published. Check-page UX and the secret-scan fix are retained; LIVE/LOCAL unchanged.

## 3. Project Boundary (CRITICAL)
- DEV/OpenCode workspace: `C:\Users\zerof\Desktop\rwqan-sa-opencode`
- Official remote: `https://github.com/modii1/rwqan` (remote `origin`)
- Backup: `C:\Users\zerof\Desktop\rwqan-sa-full-backup.git`
- Legacy local folder `C:\Users\zerof\Desktop\rwqan-sa` was removed earlier; do not
  recreate it. Recovery sources are the official remote and the backup.
- Never use Production credentials in DEV.
- Never use Production Firebase, R2, Paymob, WhatsApp, Google Drive, Gemini/OCR in DEV.
- DEV is a new, empty Firebase (`rwqan-sa-dev`, project number 467810513087, region me-central2).
- DEV R2 bucket: `rwqan-sa-dev`.

## 4. Rules While Working
1. Read the reference before editing.
2. Do not create Production migrations.
3. Do not change business logic without documenting it.
4. Never treat UNKNOWN as PASS.
5. Surgical edits only (NO Set-Content / Out-File / whole-file replacement).
6. Preserve Arabic text, formatting, business logic.
7. Do not expose secrets in code, docs, logs, reports.
8. Do not commit/push unless explicitly authorized by release rules.

## 5. Testing Discipline
Every real fix needs a test. Record exact results:
- PASS / FAIL / BLOCKED / NOT_RUN / UNKNOWN + reason.

## 6. Release / Production
- Never assume Production deployment.
- Every release has a version and documentation.
- Production release requires the documented `PRODUCTION RELEASE GATE = PASS`.
- CURRENT GATE STATE (2026-10-13): BLOCKED. Safe DEV verification is exhausted
  (tests/build/E2E/security re-run). Blockers: SEC-001 (requires production
  authorization), admin document-scope decision (Private R2), CA production AUTH
  migration, staging + ops backup/restore evidence. See SESSION_HANDOFF.md.

## 7. Policy
- This directory + `docs/` is the permanent memory of the project.
- The project must be able to explain its history, architecture, security, design,
  versions, tests, issues, Production state, and next safe action from inside the
  files alone.