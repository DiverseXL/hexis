// 15-line walkthrough: discover -> preflight -> copy -> receipt.
import { HexisClient } from '@hexis/core';

const hexis = new HexisClient({ privateKey: process.env.HEXIS_PRIVATE_KEY });
const lead = process.argv[2] ?? (await hexis.discover({ limit: 1 }))[0]?.address;
if (!lead) throw new Error('No lead found. Pass an address: tsx examples/basic-copy.ts 0xLead...');

const verdict = await hexis.riskCheck(lead, { leverage: 8, sizePct: 5, isolated: true });
console.log(`${verdict.status} ${verdict.code}`, verdict.reasons);

if (verdict.status !== 'SAFE') process.exit(2);

const result = await hexis.copy(lead, { leverage: 8, sizePct: 5, isolated: true });
console.log(`copy ${result.receipt.outcome}: ${result.receiptPath}`);
