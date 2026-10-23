# Agent integration

Hexis is built so an LLM can trade through it without hallucinating Strike API
details. The agent surface is deliberately small:

1. Every CLI command accepts `--json` and emits one JSON document.
2. Every decision returns a structured verdict with a machine `code` and
   `suggested` parameters.
3. Mutations return a receipt path; refusals also return a receipt.
4. The MCP tool manifest ships at `hexis.mcp.json` and as `MCP_MANIFEST` from
   `@mccloned/hexis-core`.

## Tool manifest

```json
{
  "name": "hexis",
  "tools": [
    { "name": "hexis_discover" },
    { "name": "hexis_risk_check" },
    { "name": "hexis_copy" },
    { "name": "hexis_positions" },
    { "name": "hexis_history" },
    { "name": "hexis_stop_copy" }
  ]
}
```

Input schemas live in `hexis.mcp.json`. Register that file with your MCP host or
map the tools to the CLI commands below.

## Command map

| Tool | CLI | JSON result |
| --- | --- | --- |
| `hexis_discover` | `hexis discover --json` | `{ count, leads }` |
| `hexis_risk_check` | `hexis risk-check <lead> --json` | `Verdict` |
| `hexis_copy` | `hexis copy <lead> --json` | `{ verdict, outcome, receiptPath, receipt }` |
| `hexis_positions` | `hexis positions --json` | `{ count, positions }` |
| `hexis_history` | `hexis history --source copy --json` | `{ count, fills }` |
| `hexis_stop_copy` | *(core `client.close`)* | receipt |

## Canonical loop

```text
1. discover(platform="hyperliquid", top=5)
2. pick a lead
3. risk_check(lead, leverage=8, sizePct=5)
4. if status == "SAFE": copy(...)
   if status == "HIGH_RISK" or "BLOCKED": read reasons + suggested, retry with suggestions
   if status == "ERROR": stop and report the error
5. positions() after the copy
```

Example JSON from a blocked preflight:

```json
{
  "status": "BLOCKED",
  "code": "LEVERAGE_EXCEEDS_POLICY",
  "reasons": [
    "Requested leverage 25x exceeds cap 15x for BTC-USD",
    "Estimated liquidation distance 2.9% < minimum 5%"
  ],
  "suggested": { "leverage": 15 },
  "input": { "leverage": 25, "sizePct": 5, "isolated": true, "market": "BTC-USD" }
}
```

Retry with `suggested.leverage` (or lower). Do not infer leverage from the
lead's history. Do not send raw Strike requests.

## Exit codes

| Code | Meaning | Agent action |
| --- | --- | --- |
| 0 | SAFE or successful mutation | Continue |
| 1 | ERROR (network, auth, signing, API) | Stop; surface the message |
| 2 | HIGH_RISK | Re-check with suggestions; require human approval to force |
| 3 | BLOCKED | Stop. Do not force without a human in the loop |

In `--json` mode, errors are structured too:

```json
{ "status": "ERROR", "code": "AUTH_FAILED", "message": "copy requires an API wallet key." }
```

## Guardrails

- **Never set `--force` autonomously.** It bypasses the product's reason to
  exist. If a human explicitly authorizes an override, put the approval in the
  mandate.
- **Always risk-check immediately before copy.** Manifest files and lead
  metrics change.
- **Prefer `--dry-run` on first use.** It writes a `simulated` receipt without
  sending an order.
- **Verify receipts.** `verifyReceipt()` checks the Ed25519 signature and hash.
- **Respect deny lists.** They are policy, not suggestions.
- **Never log `HEXIS_PRIVATE_KEY`.** The CLI never does; agent wrappers must not
  either.
- **Use testnet** (`--base-url https://api-v2-testnet.strikefinance.org`) until
  the flow is proven.

## TypeScript surface

```ts
import { HexisClient } from '@mccloned/hexis-core';

const hexis = new HexisClient({ privateKey: process.env.HEXIS_PRIVATE_KEY });
const verdict = await hexis.riskCheck(lead, { leverage: 8, sizePct: 5 });

if (verdict.status === 'SAFE') {
  const result = await hexis.copy(lead, { leverage: 8, sizePct: 5 });
  console.log(result.receipt.outcome, result.receiptPath);
}
```

Every method accepts an optional `AbortSignal`; pass `{ signal }` in options or
as the final argument.

## Why this is safe for agents

The agent cannot hallucinate a signature, nonce, body hash, or leverage cap:
those are generated or validated inside `@mccloned/hexis-core`. The only decisions left
are which lead and whether the verdict permits action.
