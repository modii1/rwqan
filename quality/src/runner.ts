import { TestResult, TestStatus, TestSuiteResult, QualityRunResult, TestEvidence } from "./model";

export interface TestCaseDefinition {
  id: string;
  feature: string;
  flow: string;
  expected: string;
  status: TestStatus;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  evidence?: TestEvidence[];
  tags?: string[];
  run: () => Promise<{
    actual: string;
    status: TestStatus;
    evidence?: TestEvidence[];
    executionTimeMs?: number;
  }>;
}

export interface TestSuiteDefinition {
  name: string;
  notes?: string;
  cases: TestCaseDefinition[];
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runSuite(suite: TestSuiteDefinition): Promise<TestSuiteResult> {
  const startedAt = nowIso();
  const results: TestResult[] = [];

  for (const testCase of suite.cases) {
    const caseStartedAt = nowIso();
    let actual = "";
    let status: TestStatus = testCase.status;
    let evidence = testCase.evidence ? [...testCase.evidence] : [];
    let executionTimeMs: number | undefined;

    try {
      const exec = await testCase.run();
      actual = exec.actual;
      status = exec.status;
      if (exec.evidence) {
        evidence = [...evidence, ...exec.evidence];
      }
      executionTimeMs = exec.executionTimeMs;
    } catch (error) {
      actual = error instanceof Error ? error.message : String(error);
      status = "FAIL";
      evidence = [
        ...evidence,
        {
          title: "Exception during test execution",
          description: error instanceof Error ? error.message : String(error),
        },
      ];
    }

    const endedAt = nowIso();
    results.push({
      id: testCase.id,
      feature: testCase.feature,
      flow: testCase.flow,
      expected: testCase.expected,
      actual,
      status,
      severity: testCase.severity,
      evidence,
      tags: testCase.tags,
      executionTimeMs,
      startedAt: caseStartedAt,
      endedAt,
    });
  }

  const endedAt = nowIso();
  const summary = results.reduce(
    (acc, r) => {
      acc.total += 1;
      if (r.status === "PASS") acc.pass += 1;
      else if (r.status === "FAIL") acc.fail += 1;
      else if (r.status === "BLOCKED") acc.blocked += 1;
      else if (r.status === "NOT_RUN") acc.notRun += 1;
      return acc;
    },
    { total: 0, pass: 0, fail: 0, blocked: 0, notRun: 0 },
  );

  return {
    name: suite.name,
    summary,
    results,
    startedAt,
    endedAt,
    notes: suite.notes,
  };
}

export async function runAll(suites: TestSuiteDefinition[]): Promise<QualityRunResult> {
  const startedAt = nowIso();
  const suiteResults: TestSuiteResult[] = [];
  for (const suite of suites) {
    suiteResults.push(await runSuite(suite));
  }
  const endedAt = nowIso();

  const summary = suiteResults.reduce(
    (acc, s) => {
      acc.total += s.summary.total;
      acc.pass += s.summary.pass;
      acc.fail += s.summary.fail;
      acc.blocked += s.summary.blocked;
      acc.notRun += s.summary.notRun;
      acc.criticalFailures += s.results.filter((r) => r.severity === "CRITICAL" && r.status === "FAIL").length;
      return acc;
    },
    { total: 0, pass: 0, fail: 0, blocked: 0, notRun: 0, criticalFailures: 0 },
  );

  return {
    startedAt,
    endedAt,
    suites: suiteResults,
    summary,
  };
}
