import { redactFinding } from "./redact";
import { RUQAN_RULES } from "./rules/ruqanRules";
import type { ScanContext } from "./rules/context";
import type { Finding } from "./types";

/**
 * Runs all Ruqan-specific static rules against the scan context.
 * Every finding produced by a rule is passed through redaction before
 * it is handed to the report/baseline layer.
 */
export function runRuqanStaticChecks(ctx: ScanContext): Finding[] {
  const out: Finding[] = [];
  for (const rule of RUQAN_RULES) {
    try {
      const results = rule.run(ctx);
      for (const f of results) {
        out.push(redactFinding(f));
      }
    } catch (err) {
      ctx.console(
        `[rules:${rule.id}] rule failed, skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return out;
}