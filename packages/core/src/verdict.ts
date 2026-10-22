import type { RiskCheck, Verdict, VerdictCode, VerdictStatus } from './types.js';

export const EXIT_CODES: Record<VerdictStatus, number> = {
  SAFE: 0,
  HIGH_RISK: 2,
  BLOCKED: 3,
  ERROR: 1,
};

export function isBlocking(status: VerdictStatus): boolean {
  return status === 'BLOCKED' || status === 'HIGH_RISK';
}

export function verdictFromChecks(input: {
  checks: RiskCheck[];
  suggested?: Verdict['suggested'];
  lead?: Verdict['lead'];
  input: Verdict['input'];
}): Verdict {
  const failures = input.checks.filter((check) => check.status === 'fail');
  const warnings = input.checks.filter((check) => check.status === 'warn');
  const status: VerdictStatus = failures.length ? 'BLOCKED' : warnings.length ? 'HIGH_RISK' : 'SAFE';
  const code: VerdictCode =
    failures[0]?.code ?? warnings[0]?.code ?? (status === 'SAFE' ? 'OK' : 'DATA_INCOMPLETE');

  const verdict: Verdict = {
    status,
    code,
    reasons: input.checks.map((check) => check.message),
    checks: input.checks,
    input: input.input,
    checkedAt: new Date().toISOString(),
  };

  if (status === 'SAFE') delete verdict.suggested;
  if (input.suggested && Object.keys(input.suggested).length) verdict.suggested = input.suggested;
  if (input.lead) verdict.lead = input.lead;
  return verdict;
}

export function errorVerdict(
  code: VerdictCode,
  message: string,
  input: Verdict['input'] = { leverage: 0, sizePct: 0, isolated: true, market: 'unknown' },
): Verdict {
  return {
    status: 'ERROR',
    code,
    reasons: [message],
    checks: [{ id: 'error', status: 'fail', code, message }],
    input,
    checkedAt: new Date().toISOString(),
  };
}

export function exitCodeForVerdict(verdict: Verdict, forced = false): number {
  if (verdict.status === 'SAFE') return 0;
  if (verdict.status === 'HIGH_RISK') return forced ? 0 : 2;
  if (verdict.status === 'BLOCKED') return 3;
  return 1;
}
