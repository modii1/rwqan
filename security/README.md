# RUQAN Platform Health & Security Scanner (Phase 6D → 6E enriched)

Read-only, offline-capable security and platform-health scanner for the Ruqan
platform. It performs **static source analysis only** — it never writes to
production (Firebase/R2/Paymob/WhatsApp/Google Drive), never runs against live
services unless explicitly enabled for a DEV target, and never mutates code.

Phase 6E enrichment adds:
- **External tool adapters** for Gitleaks, Semgrep (JS/TS), CodeQL (SARIF),
  OSV-Scanner and Trivy, each normalised into the shared Finding model.
- **Correlation engine** (`correlation.ts`) — one finding per underlying issue.
  Findings from 2+ distinct sources at the same location are merged into a
  single finding carrying the combined `sources` list and a single
  `confidence`; same-source instances (e.g. two distinct unreferenced
  dependencies) are always kept separate.
- **Confidence model** (`confidence.ts`) — HIGH / MEDIUM / LOW from source
  fidelity, cross-source agreement and heuristics; never changed by the AI.
- **Version detection** for every installed tool, and graceful
  `NOT_INSTALLED` / `NOT_RUN` reporting (never an invented result).

## Quick start

From the repository root:

```bash
npm run security:scan                # happy-path scan (dev target, offline)
npm run security:scan:ci             # CI-safe: no network, non-zero exit on RED
```

Manual invocation:

```bash
npx tsx security/src/cli.ts --repo . --no-network
npx tsx security/src/cli.ts --no-network --ci     # exit 2 on RED, 1 on ORANGE
npx tsx security/src/cli.ts --target production   # passive-only (guarded)
npx tsx security/src/cli.ts --update-baseline     # persist this scan as baseline
npx tsx security/src/cli.ts --json                # machine-readable report
```

`--no-network` is a presence flag (an explicit `true`/`false` value is also
accepted) and does not swallow following flags.

## Safety rules

- `--target production` → passive analysis only. Active scanning, payment
  tests, mutation tests and upload/delete tests are **refused** by
  `assertSecurityScanTargetSafe()`.
- `--enable-active zap,payment,...` → **DEV only**, and together with
  `--active-target-url <dev-url>` (never a production-looking host).
- `NO_NETWORK=true` (env or flag) → all network-required tools (Semgrep rule
  registry, CodeQL query pack, ZAP) are skipped; OSV and Trivy run offline
  **only** when a local vulnerability DB is supplied (see below); active scans
  refused.
- Secret values are never printed or persisted: `redact.ts` masks known env
  keys, private keys and token-shaped values; tool parsers drop raw matches
  (Gitleaks runs with `--redact`).

## Architecture

| Path | Purpose |
|---|---|
| `security/src/types.ts` | Core model (Finding, BaselineEntry, Confidence, ScanConfig, …) |
| `security/src/severity.ts` | Severity ranking, RED-trigger categories, section mapping |
| `security/src/engine.ts` | Health state (GREEN/ORANGE/RED) per section + overall |
| `security/src/guards.ts` | Production / DEV / no-network guards |
| `security/src/redact.ts` | Deterministic secret redaction + hashing |
| `security/src/checks.ts` | Runs the Ruqan rule catalog |
| `security/src/confidence.ts` | Confidence + cross-tool severity mapping |
| `security/src/correlation.ts` | Dedupe / multi-source merge engine |
| `security/src/rules/context.ts` | File walking, git-tracked detection, helpers |
| `security/src/rules/ruqanRules.ts` | 32 data-driven static rules (SEC/AUTH/AUTHZ/…) |
| `security/src/tools.ts` | Adapters for gitleaks / semgrep / osv / trivy / codeql / zap |
| `security/src/baseline.ts` | Baseline load/save + NEW/EXISTING/REGRESSED/RESOLVED diff |
| `security/src/report.ts` | "RUQAN PLATFORM HEALTH" report renderer |
| `security/src/cli.ts` | CLI entry point |
| `security/tests/` | node:test suite (95 tests) |
| `security/baseline.json` | Baseline store (created/grown via `--update-baseline`) |

## Confidence

Each finding carries a single `confidence` (HIGH / MEDIUM / LOW):

- critical → HIGH (never downgraded).
- ≥ 2 distinct sources agree on the same issue → HIGH.
- a single dedicated deterministic detector (Gitleaks, CodeQL dataflow, ZAP
  active) → HIGH.
- a single generic registry/advisory result (Semgrep, OSV, Trivy) → MEDIUM.
- a single Ruqan heuristic rule (medium/low) → LOW; Ruqan evidence-backed
  rule → HIGH.

Severity is never auto-adjusted; tool severities are mapped to the model via
`mapToolSeverity` and correlation only takes the worst observed value.

## Health classification

- **RED** — critical finding, or high-severity in a breach-of-trust category
  (authorization, IDOR, admin/owner auth, customer isolation, secrets,
  production-resource-from-dev, payment/subscription/renewal, webhook
  validation, amount/discount validation).
- **ORANGE** — no RED trigger but at least one open medium+ finding (incl.
  unresolved high in a non-trigger category such as logging).
- **GREEN** — no open medium+ findings.

## Baseline semantics

`--update-baseline` persists the current findings. Subsequent scans classify
each fingerprint as **NEW / EXISTING / REGRESSED / RESOLVED** so old findings
are not reported as new and reappearance after a fix is flagged explicitly.
Correlation preserves the anchor fingerprint, so a finding stays EXISTING when
an external tool later confirms it. The baseline is never auto-updated in a way
that hides a problem.

## External tools

Nothing is required. Tools are detected on PATH at scan time (version captured
from the tool):

| Tool | Mode | Run offline? | Notes |
|---|---|---|---|
| Gitleaks | offline | **yes** | full repo/history scan, falls back to `--no-git` working-tree scan; `--redact` on all invocations |
| Semgrep | network registry | no | JS/TS with `p/security-audit`; ERROR/WARNING/INFO → high/medium/low |
| CodeQL | network + DB build | no | refuses database build (mutation) in read-only mode → `NOT_RUN`; parses a supplied SARIF report |
| OSV-Scanner | offline w/ local DB | **yes** | offline requires `OSV_LOCAL_DB` (path to local SQLite DB) else `NOT_RUN` |
| Trivy | offline w/ local DB | **yes** | offline requires `TRIVY_CACHE_DIR` (with vuln DB) else `NOT_RUN` |
| OWASP ZAP | active-only | no | never run automatically; requires target=development + explicit `--enable-active zap` + `--active-target-url`; refused against production |

Missing tools are reported as `NOT_INSTALLED` (never a finding, never a
failure, never an invented result). Malformed tool output is recorded as a
parse error and skipped.

## Known scanner limitation

`DEPS-001` matches import sites using absolute file separators
(`f.abs.includes("\\server")`). That works for the CLI, which always resolves
an absolute `repoPath`; hand-calling `createContext()` with a relative path on
Windows can narrow the search surface. This is a scanner-internal limitation,
not a security finding, and is documented for completeness.

## Tests

```bash
npx tsx --test security/tests/*.test.ts   # 95 tests, all offline
```