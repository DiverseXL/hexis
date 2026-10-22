import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HARDCODED_MANIFEST } from '../src/defaults.js';
import { evaluateRisk, estimateLiquidationDistancePct, suggestSafeLeverage } from '../src/risk.js';
import type { AccountSummary, Lead, Manifest } from '../src/types.js';

export const TEST_LEAD: Lead = {
  address: '0x1111111111111111111111111111111111111111',
  platform: 'hyperliquid',
  displayName: 'Test Lead',
  equity: 118_400,
  pnl: { '30d': 49_800 },
  roi: { '30d': 0.421 },
  volume: { '30d': 10_000_000 },
  topAssets: [{ asset: 'BTC', symbol: 'BTC-USD' }],
  equityCurve30d: [],
  maxDrawdown30dPct: 12,
  style: 'swing',
};

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  const base = structuredClone(HARDCODED_MANIFEST);
  return {
    ...base,
    ...overrides,
    defaults: { ...base.defaults, ...overrides.defaults },
    caps: { ...base.caps, ...overrides.caps },
    deny: { ...base.deny, ...overrides.deny },
  };
}

const ACCOUNT: AccountSummary = {
  accountId: 'acc-1',
  walletBalance: 10_000,
  availableBalance: 5_000,
  marginBalance: 10_000,
  totalMargin: 0,
  maintenanceMargin: 0,
  unrealizedPnl: 0,
  copyReservedBalance: 0,
};

test('8x on BTC-USD is SAFE', () => {
  const verdict = evaluateRisk({
    lead: TEST_LEAD,
    manifest: manifest(),
    options: { leverage: 8, sizePct: 5, isolated: true },
  });
  assert.equal(verdict.status, 'SAFE');
  assert.equal(verdict.code, 'OK');
  assert.equal(verdict.suggested, undefined);
  assert.ok(verdict.reasons.some((reason) => reason.includes('11.4%')));
});

test('25x is BLOCKED with machine code and suggestion', () => {
  const verdict = evaluateRisk({
    lead: TEST_LEAD,
    manifest: manifest(),
    options: { leverage: 25, sizePct: 5, isolated: true },
  });
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.code, 'LEVERAGE_EXCEEDS_POLICY');
  assert.equal(verdict.suggested?.leverage, 15);
  assert.ok(verdict.reasons.some((reason) => reason.includes('25x exceeds cap 15x')));
});

test('editing maxLeverage flips 8x from SAFE to BLOCKED', () => {
  const strict = manifest({ caps: { ...HARDCODED_MANIFEST.caps, maxLeverage: { default: 5, 'BTC-USD': 5 } } });
  const verdict = evaluateRisk({
    lead: TEST_LEAD,
    manifest: strict,
    options: { leverage: 8, sizePct: 5, isolated: true },
  });
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.code, 'LEVERAGE_EXCEEDS_POLICY');
});

test('liquidation distance blocks high leverage independently of the cap', () => {
  const loose = manifest({ caps: { ...HARDCODED_MANIFEST.caps, maxLeverage: 50 } });
  const verdict = evaluateRisk({
    lead: TEST_LEAD,
    manifest: loose,
    options: { leverage: 25, sizePct: 5, isolated: true },
  });
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.code, 'LIQUIDATION_TOO_CLOSE');
  assert.equal(verdict.suggested?.leverage, 16);
  assert.equal(estimateLiquidationDistancePct(8), 11.4);
  assert.equal(suggestSafeLeverage(5), 16);
});

test('lead drawdown above cap is BLOCKED', () => {
  const verdict = evaluateRisk({
    lead: { ...TEST_LEAD, maxDrawdown30dPct: 40 },
    manifest: manifest(),
    options: { leverage: 8, sizePct: 5, isolated: true },
  });
  assert.equal(verdict.code, 'LEAD_DRAWDOWN_EXCEEDS_POLICY');
  assert.equal(verdict.status, 'BLOCKED');
  assert.ok((verdict.suggested?.sizePct ?? 99) < 5);
});

test('denied markets and leads are BLOCKED', () => {
  const deniedMarket = evaluateRisk({
    lead: TEST_LEAD,
    manifest: manifest({ deny: { leads: [], markets: ['BTC-USD'] } }),
    options: { leverage: 8, sizePct: 5, isolated: true },
  });
  assert.equal(deniedMarket.code, 'MARKET_DENIED');

  const deniedLead = evaluateRisk({
    lead: TEST_LEAD,
    manifest: manifest({ deny: { leads: [TEST_LEAD.address], markets: [] } }),
    options: { leverage: 8, sizePct: 5, isolated: true },
  });
  assert.equal(deniedLead.code, 'LEAD_DENIED');
});

test('insufficient available margin is BLOCKED', () => {
  const verdict = evaluateRisk({
    lead: TEST_LEAD,
    manifest: manifest(),
    options: { leverage: 8, sizePct: 80, isolated: true },
    account: ACCOUNT,
  });
  assert.equal(verdict.code, 'INSUFFICIENT_MARGIN');
  assert.equal(verdict.status, 'BLOCKED');
});

test('authenticated margin check passes for a sane size', () => {
  const verdict = evaluateRisk({
    lead: TEST_LEAD,
    manifest: manifest(),
    options: { leverage: 8, sizePct: 5, isolated: true },
    account: ACCOUNT,
  });
  assert.equal(verdict.status, 'SAFE');
  assert.ok(verdict.reasons.some((reason) => reason.includes('Copy margin $500.00')));
});

test('missing equity curve is HIGH_RISK, not SAFE', () => {
  const verdict = evaluateRisk({
    lead: { ...TEST_LEAD, maxDrawdown30dPct: null },
    manifest: manifest(),
    options: { leverage: 8, sizePct: 5, isolated: true },
  });
  assert.equal(verdict.status, 'HIGH_RISK');
  assert.equal(verdict.code, 'DATA_INCOMPLETE');
});
