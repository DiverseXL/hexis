import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HexisClient } from '../src/client.js';

const key = process.env.HEXIS_PRIVATE_KEY;

// Live acceptance test with a registered API wallet: a signed GET must reach
// the real API and return the wallet's account.
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
