import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HexisClient } from '../src/client.js';
import { generateKeyPair } from '../src/signing.js';

const key = process.env.HEXIS_PRIVATE_KEY;
const live = process.env.HEXIS_LIVE === '1';

// Opt-in network test: a signed GET must reach a real endpoint and return 200.
// Note: signs with a throwaway key. Against the live API this only passes if
// that generated key is registered; an unregistered key gets 401. The second
// test below covers the registered-wallet path via HEXIS_PRIVATE_KEY.
test(
  'live: signed GET /v2/account returns 200',
  { skip: live ? false : 'set HEXIS_LIVE=1 to run the signed network test' },
  async () => {
    const client = new HexisClient({ privateKey: generateKeyPair().privateKey });
    const response = await client.transport.request<{ account_id?: string }>({
      method: 'GET',
      path: '/v2/account',
      auth: true,
    });
    assert.equal(response.status, 200);
    assert.equal(typeof response.data.account_id, 'string');
    assert.match(response.signed?.headers['X-API-Wallet-Signature'] ?? '', /^[0-9a-f]{128}$/);
  },
);

// Acceptance test for M2 with a registered API wallet.
test(
  'live: signed GET /v2/account returns an account',
  { skip: key ? false : 'set HEXIS_PRIVATE_KEY to run the live signing test' },
  async () => {
    const client = new HexisClient({ privateKey: key });
    const account = await client.account();
    assert.equal(typeof account.accountId, 'string');
    assert.ok(account.accountId.length > 0);
  },
);
