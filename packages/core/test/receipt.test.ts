import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { canonicalJson, createReceipt, signReceipt, verifyReceipt, writeReceipt } from '../src/receipt.js';
import { generateKeyPair } from '../src/signing.js';
import type { Receipt } from '../src/types.js';

const receipt: Receipt = {
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  action: 'copy',
  outcome: 'executed',
  mandate: 'Copy lead at 5% size',
  method: 'POST',
  endpoint: '/v2/copy/subscribe',
  nonce: '550e8400-e29b-41d4-a716-446655440000',
  bodyHash: 'abc',
  signedAt: '2026-10-21T19:42:11.000Z',
  createdAt: '2026-10-21T19:42:11.000Z',
  request: { b: 1, a: 2 },
  result: { subscription_id: 'sub-1', status: 'active' },
};

test('canonical JSON sorts keys deterministically', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ z: undefined, a: [1, { d: 4, c: 3 }] }), '{"a":[1,{"c":3,"d":4}]}');
});

test('receipts are signed and tampering is detected', () => {
  const { privateKey, publicKey } = generateKeyPair();
  const signed = signReceipt(receipt, privateKey);
  assert.equal(signed.publicKey, publicKey);
  assert.match(signed.signature ?? '', /^[0-9a-f]{128}$/);
  assert.equal(verifyReceipt(signed), true);
  assert.equal(verifyReceipt({ ...signed, mandate: 'tampered' }), false);
});

test('writeReceipt creates a signed JSON file without key material', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hexis-receipts-'));
  const { privateKey } = generateKeyPair();
  const written = await writeReceipt(directory, createReceipt({ ...receipt }), privateKey);

  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const text = await readFile(written.path, 'utf8');
  const parsed = JSON.parse(text) as Receipt;

  assert.equal(verifyReceipt(parsed), true);
  assert.equal(parsed.mandate, receipt.mandate);
  assert.equal(text.includes(privateKey), false);
  assert.match(written.path, /\.hexis|hexis-receipts/);
});
