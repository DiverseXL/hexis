# @hexis/core

Pure-TypeScript, signing-and-risk-aware Strike client. No CLI dependencies.

```ts
import { HexisClient } from '@hexis/core';

const hexis = new HexisClient({ privateKey: process.env.HEXIS_PRIVATE_KEY });

const verdict = await hexis.riskCheck('0xLead...', { leverage: 8, sizePct: 5 });
if (verdict.status === 'SAFE') {
  const { receipt, receiptPath } = await hexis.copy('0xLead...', { leverage: 8, sizePct: 5 });
  console.log(receipt.outcome, receiptPath);
}
```

- Byte-exact Ed25519 signing, fresh UUID nonces, one serialization per body.
- Structured verdicts with machine codes and suggested parameters.
- Manifest-driven risk caps, deny lists, and defaults.
- Signed receipts for executed, refused, simulated, and failed mutations.
- Public discovery without a key; auth only for account-scoped calls.
- `MCP_MANIFEST` export for agent hosts.

See the repository README and `docs/` for the risk model and security posture.
