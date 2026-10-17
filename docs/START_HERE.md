# START HERE — Ruqan / Rwqan Project System

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

## 3. Project Boundary (CRITICAL)
- DEV/OpenCode workspace: `C:\Users\zerof\Desktop\rwqan-sa-opencode`
- Production/Original/Live (DO NOT TOUCH during development): `C:\Users\zerof\Desktop\rwqan-sa`
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