import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLeads, renderVerdict, table } from '../src/format.js';
import { setColor } from '../src/format.js';
import type { Lead, Verdict } from '@hexis/core';

setColor(false);

test('table pads and aligns columns', () => {
  const output = table(['A', 'B'], [['1', '20'], ['100', '3']], ['left', 'right']);
  const lines = output.split('\n');
  assert.equal(lines[0], 'A     B');
  assert.equal(lines[2], '1    20');
  assert.equal(lines[3], '100   3');
});

test('verdict renderer surfaces status, reasons, and suggestions', () => {
  const verdict: Verdict = {
    status: 'BLOCKED',
    code: 'LEVERAGE_EXCEEDS_POLICY',
    reasons: ['Lead 0xLead found', 'Requested leverage 25x exceeds cap 15x for BTC-USD'],
    checks: [
      { id: 'lead-found', status: 'pass', message: 'Lead 0xLead found' },
      {
        id: 'leverage-cap',
        status: 'fail',
        code: 'LEVERAGE_EXCEEDS_POLICY',
        message: 'Requested leverage 25x exceeds cap 15x for BTC-USD',
      },
    ],
    suggested: { leverage: 15 },
    checkedAt: '2026-10-21T00:00:00.000Z',
    input: { leverage: 25, sizePct: 5, isolated: true, market: 'BTC-USD' },
    lead: {
      address: '0x1111111111111111111111111111111111111111',
      platform: 'hyperliquid',
      equity: 100000,
      pnl30dPct: 12.3,
      maxDrawdown30dPct: 8,
    },
  };

  const text = renderVerdict(verdict);
  assert.match(text, /VERDICT:\s+BLOCKED/);
  assert.match(text, /Requested leverage 25x exceeds cap 15x/);
  assert.match(text, /Suggested: leverage 15x/);
  assert.match(text, /Code:\s+LEVERAGE_EXCEEDS_POLICY/);
  assert.equal(text.includes('Lead 0xLead found'), false);
});

test('lead table renders PnL as dollars, not percent', () => {
  const lead: Lead = {
    address: '0x1111111111111111111111111111111111111111',
    platform: 'hyperliquid',
    displayName: 'Whale',
    equity: 100000,
    pnl: { '30d': 5000 },
    roi: { '30d': 0.05 },
    volume: { '30d': 1000000 },
    topAssets: [],
    equityCurve30d: [],
    maxDrawdown30dPct: 10,
    style: 'swing',
  };
  const text = renderLeads([lead]);
  assert.match(text, /\$5,000/);
  assert.match(text, /\+5\.0%/);
});
