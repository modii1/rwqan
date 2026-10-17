export type TestStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

export type TestSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface TestEvidence {
  title: string;
  description?: string;
  details?: string;
  filePath?: string;
  lineNumber?: number;
  url?: string;
  command?: string;
}

export interface TestResult {
  id: string;
  feature: string;
  flow: string;
  expected: string;
  actual: string;
  status: TestStatus;
  severity: TestSeverity;
  evidence: TestEvidence[];
  tags?: string[];
  executionTimeMs?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface TestSuiteResult {
  name: string;
  summary: {
    total: number;
    pass: number;
    fail: number;
    blocked: number;
    notRun: number;
  };
  results: TestResult[];
  startedAt?: string;
  endedAt?: string;
  notes?: string;
}

export interface QualityRunResult {
  startedAt: string;
  endedAt: string;
  suites: TestSuiteResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    blocked: number;
    notRun: number;
    criticalFailures: number;
  };
}
