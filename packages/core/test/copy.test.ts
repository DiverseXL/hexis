import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HexisClient } from '../src/client.js';
import { HARDCODED_MANIFEST } from '../src/defaults.js';
import { verifyReceipt } from '../src/receipt.js';
import { generateKeyPair } from '../src/signing.js';
import type { Manifest, Receipt } from '../src/types.js';

const LEAD_ADDRESS = '0x1111111111111111111111111111111111111111';

const leadPayload = {
  address: LEAD_ADDRESS,
  platform: 'hyperliquid',
  display_name: 'Test Lead',
  account_value: '100000',
  pnl: { '30d': '4200' },
  roi: { '30d': '0.042' },
  volume: { '30d': '5000000' },
  top_assets: [{ asset: 'BTC', symbol: 'BTC-USD' }],
  equity_curve_30d: [
    [1, '100000'],
    [2, '108000'],
    [3, '98000'],
    [4, '104000'],
  ],
  enrichment_state: 'ready',
};

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === `/v2/copy/discover/${LEAD_ADDRESS}`) return json(leadPayload);
    if (url.pathname === '/v2/account') {
      return json({
        account_id: 'acc-1',
        wallet_balance: '10000',
        available_balance: '9000',
        margin_balance: '10000',
        total_margin: '0',
        maintenance_margin: '0',
        unrealized_pnl: '0',
        copy_reserved_balance: '0',
      });
    }
    if (url.pathname === '/v2/leverage') return json({ leverage: 8, symbol: 'BTC-USD' });
    if (url.pathname === '/v2/marginMode') return json({ marginMode: 'isolated', symbol: 'BTC-USD' });
    if (url.pathname === '/v2/copy/subscribe') {
      return json({ subscription_id: 'sub-1', status: 'active' }, 201);
    }
    return json({ error: `unexpected ${method} ${url.pathname}` }, 404);
  }) as typeof fetch;
}

function manifest(): Manifest {
  return structuredClone(HARDCODED_MANIFEST);
}

test('copy refuses a BLOCKED verdict without force and receipts the refusal', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'hexis-copy-refuse-'));
  const calls: Call[] = [];
  const { privateKey } = generateKeyPair();
  const client = new HexisClient({
    privateKey,
    fetch: mockFetch(calls),
    cwd,
    manifest: manifest(),
  });

  const result = await client.copy(LEAD_ADDRESS, { leverage: 25, sizePct: 5, isolated: true });
  assert.equal(result.verdict.status, 'BLOCKED');
  assert.equal(result.receipt.outcome, 'refused');
  assert.equal(calls.some((call) => call.path === '/v2/copy/subscribe'), false);

  const text = await readFile(result.receiptPath, 'utf8');
  const receipt = JSON.parse(text) as Receipt;
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.verdict?.code, 'LEVERAGE_EXCEEDS_POLICY');
  assert.equal(verifyReceipt(receipt), true);
});

test('copy with force applies settings, subscribes, and writes an executed receipt', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'hexis-copy-force-'));
  const calls: Call[] = [];
  const { privateKey } = generateKeyPair();
  const client = new HexisClient({
    privateKey,
    fetch: mockFetch(calls),
    cwd,
    manifest: manifest(),
  });

  const result = await client.copy(LEAD_ADDRESS, {
    leverage: 8,
    sizePct: 5,
    isolated: true,
    force: true,
  });

  assert.equal(result.verdict.status, 'SAFE');
  assert.equal(result.receipt.outcome, 'executed');
  assert.equal(result.receipt.result && (result.receipt.result as { status?: string }).status, 'active');

  const subscribe = calls.find((call) => call.path === '/v2/copy/subscribe');
  assert.ok(subscribe);
  const body = subscribe.body as Record<string, unknown>;
  assert.equal(body.copy_mode, 'fixed_ratio');
  assert.equal(body.copy_amount, '500.00');
  assert.equal(body.lead_account_id, LEAD_ADDRESS);
  // Docs: max_leverage only applies with leverage_source "lead"; the default
  // "account" source must not send it.
  assert.equal('max_leverage' in body, false);

  assert.ok(calls.some((call) => call.path === '/v2/leverage'));
  assert.ok(calls.some((call) => call.path === '/v2/marginMode'));

  const text = await readFile(result.receiptPath, 'utf8');
  const receipt = JSON.parse(text) as Receipt;
  assert.equal(receipt.nonce.length > 0, true);
  assert.equal(receipt.bodyHash.length, 64);
  assert.equal(verifyReceipt(receipt), true);
});

test('dry-run writes a simulated receipt without calling subscribe', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'hexis-copy-dry-'));
  const calls: Call[] = [];
  const { privateKey } = generateKeyPair();
  const client = new HexisClient({
    privateKey,
    fetch: mockFetch(calls),
    cwd,
    manifest: manifest(),
  });

  const result = await client.copy(LEAD_ADDRESS, {
    leverage: 8,
    sizePct: 5,
    isolated: true,
    dryRun: true,
  });

  assert.equal(result.receipt.outcome, 'simulated');
  assert.equal(calls.some((call) => call.path === '/v2/copy/subscribe'), false);
  assert.equal(calls.some((call) => call.path === '/v2/leverage'), false);
});
