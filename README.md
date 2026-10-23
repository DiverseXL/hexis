# Hexis

**Risk-checked Strike copy trading from one command.**

Hexis is a pnpm monorepo shipping `@hexis/core` (a pure-TypeScript,
signing-and-risk-aware Strike client) and `@hexis/cli` (a thin wrapper with
human-readable verdicts). Go from raw Ed25519 keys to a risk-checked
Hyperliquid-to-Strike copy in four commands, with every action receipted.

```
hexis init
hexis discover --platform hyperliquid --top 5
hexis risk-check 0xLead... --leverage 25   # BLOCKED, with reasons
hexis copy 0xLead... --size 5% --leverage 8
```

## The problem

Integrating Strike carries a developer-experience tax:

1. **Ed25519 signing** — canonical message, body hash, four headers, silent 401s.
2. **Copy discovery** — rank leads, then separately inspect leverage and margin.
3. **No risk preflight** — nothing answers "will this copy survive a 10% drawdown?"
4. **Opaque observability** — copy history must be source-filtered to be useful.
5. **No unified toolkit** — official skills are a starting point, not an SDK.

Hexis removes that tax. It is deliberately Strike-only, key-local, and auditable.

## Install

Requires Node 20+ and pnpm 9+.

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js --help
```

To use the published packages:

```bash
npx @hexis/cli discover --platform hyperliquid --top 5
# or
pnpm add @hexis/core
```

For local development, link the CLI:

```bash
pnpm --filter @hexis/cli link --global
hexis --version
```

## Quickstart

```bash
# 1. Generate a raw Ed25519 keypair (not SSH). Register the public key at
#    https://app.strikefinance.org/api-keys
hexis init

# 2. Export the private key for this shell (Hexis never logs it)
export HEXIS_PRIVATE_KEY=<private key>        # PowerShell: $env:HEXIS_PRIVATE_KEY="..."

# 3. Discover ranked Hyperliquid leads (public, no key needed)
hexis discover --platform hyperliquid --rank pnl_30d --top 5

# 4. Preflight at an unsafe leverage, then a safe one
hexis risk-check 0xLead... --leverage 25
hexis risk-check 0xLead... --leverage 8

# 5. Copy (refuses BLOCKED/HIGH_RISK without --force)
hexis copy 0xLead... --size 5% --leverage 8

# 6. Monitor
hexis positions --watch
hexis history --source copy
```

Every command supports `--json`. Mutating commands print the receipt path.

## Live output

Discovery:

```
$ hexis discover --platform hyperliquid --top 5 --limit 3

Leads (3, ranked by pnl_30d)

#  LEAD           PLATFORM     EQUITY        ROI 30D  PNL 30D       MAX DD  SCORE  STYLE
-  -------------  -----------  ------------  -------  ------------  ------  -----  ------------
1  0x5b5d...c060  hyperliquid  $227,767,883   +20.3%  $58,618,422   16.2%   54     algo
2  0xb83d...6e36  hyperliquid  $210,057,120   +18.2%  $51,823,966   27.0%   48     algo
3  0xfc66...ca06  hyperliquid  $124,631,354   +15.0%  $15,552,361   11.0%   56     market_maker
```

Preflight:

```
$ hexis risk-check 0x5b5d...c060 --leverage 8

  Lead:      0x5b5d...c060  (hyperliquid)
  30d PnL:   +20.3%     Equity: $227,767,883     Max DD 30d: 16.2%
  Copy size: 5%  Leverage: 8x  Isolated  Market: BTC-USD

  VERDICT:   SAFE
  Reason:    Leverage 8x <= cap 15x
             Estimated liquidation distance 11.4% >= min 5%
             Lead 30d max drawdown 16.2% <= cap 25%
             Account balance unavailable; margin check skipped
  Suggested: (none, inputs are within policy)
  Code:      OK
```

Blocked:

```
$ hexis risk-check 0x5b5d...c060 --leverage 25

  VERDICT:   BLOCKED
  Reason:    ! Requested leverage 25x exceeds cap 15x for BTC-USD
             ! Estimated liquidation distance 2.9% < minimum 5%
  Suggested: leverage 15
  Code:      LEVERAGE_EXCEEDS_POLICY
```

The exact live numbers move; the shape does not.

## The 40-second demo

1. Run `hexis risk-check 0xLead --leverage 8` → **SAFE**.
2. Open `hexis.manifest.json` and change the `BTC-USD` cap from `15` to `5`
   (one number; leave `default` and `ETH-USD` alone).
3. Run the same command → **BLOCKED** with `LEVERAGE_EXCEEDS_POLICY`.
4. Run `hexis copy 0xLead --size 5% --leverage 8` → refused, exit code 3,
   receipt still written.
5. Run with `--force` → proceeds, receipt records the override.
6. Restore the manifest.

That is the risk engine proving it is policy-driven, not decorative.

## Configuration

Precedence: **CLI flag > env var > `./hexis.manifest.json` > `~/.hexis/manifest.json` > hardcoded**.

```json
{
  "version": 1,
  "defaults": { "isolated": true, "leverage": 8, "sizePct": 5, "requireRiskCheck": true },
  "caps": {
    "maxLeverage": { "default": 10, "BTC-USD": 15, "ETH-USD": 15 },
    "minLiquidationDistancePct": 5,
    "maxLeadDrawdown30dPct": 25
  },
  "deny": { "leads": [], "markets": [] }
}
```

Environment overrides: `HEXIS_LEVERAGE`, `HEXIS_SIZE_PCT`, `HEXIS_ISOLATED`,
`HEXIS_MAX_LEVERAGE`, `HEXIS_MIN_LIQ_DISTANCE_PCT`,
`HEXIS_MAX_LEAD_DRAWDOWN_PCT`, `HEXIS_MANIFEST`, `HEXIS_BASE_URL`,
`HEXIS_RECEIPT_DIR`, `HEXIS_PRIVATE_KEY`.

Testnet: pass `--base-url https://api-v2-testnet.strikefinance.org`.

## Verdicts and exit codes

| Status | Meaning | Exit |
| --- | --- | --- |
| `SAFE` | All checks pass | 0 |
| `HIGH_RISK` | Proceeds only with `--force` | 2 (0 with `--force`) |
| `BLOCKED` | Hard stop; `copy` refuses without `--force` | 3 |
| `ERROR` | Network, auth, signing, or API failure | 1 |

Machine codes include `LEVERAGE_EXCEEDS_POLICY`, `LIQUIDATION_TOO_CLOSE`,
`LEAD_DRAWDOWN_EXCEEDS_POLICY`, `MARKET_DENIED`, `LEAD_DENIED`,
`LEAD_NOT_FOUND`, `INSUFFICIENT_MARGIN`, `DATA_INCOMPLETE`, `AUTH_FAILED`,
`NETWORK_ERROR`, `API_ERROR`, `SIGNING_FAILED`. See [docs/RISK.md](docs/RISK.md).

## Agent surface

Every command has `--json`, and `hexis.mcp.json` exports the MCP tool manifest
(also available as `MCP_MANIFEST` from `@hexis/core`). The intended loop:

```json
{ "status": "BLOCKED", "code": "LEVERAGE_EXCEEDS_POLICY", "suggested": { "leverage": 8 } }
```

The agent reads `suggested`, re-checks, then copies. It never guesses signing,
nonces, or leverage. See [docs/AGENT.md](docs/AGENT.md).

## Security

The Strike API wallet cannot withdraw funds (Strike API docs, Getting
Started). Private keys never leave the
machine; only signatures are transmitted. Hexis never persists keys by default.
Every mutation writes a signed, hashed receipt to `.hexis/receipts/`. Read the
full [withdrawal guarantee and key-handling rules](docs/SECURITY.md).

## Repository layout

```
packages/core/   @hexis/core - signing, discovery, risk, copy, receipts
packages/cli/    @hexis/cli  - commander wrapper + verdict renderer
examples/        basic-copy.ts, risk-policy.ts, agent-skill.ts
docs/            SECURITY.md, RISK.md, AGENT.md
hexis.manifest.json
hexis.mcp.json
```

## Scope

Hexis is not a trading terminal, strategy engine, multi-exchange layer,
custody solution, or replacement for the Strike app. It does not claim
backtested performance. It is a deliberately narrow DX layer over the Strike
endpoints that matter for copy trading.

## Known limitations

Honest edges, in the order you are likely to hit them:

- **Signed calls are not yet live-tested.** `copy`, `positions`, and
  authenticated `risk-check` margin checks are verified by unit tests
  (mocked HTTP, RFC 8032 vectors, tamper-checked receipts) and audited
  against Strike's published docs, but no signed request has yet been sent
  from this repo to the live API with a registered wallet. Update this
  section after that test.
- **Liquidation distance is an approximation.** The preflight estimate is
  `100/leverage` minus a fixed 1.1% maintenance/fee buffer. It does not model
  entry price, funding, or per-market maintenance-margin tiers, and it is not
  a liquidation guarantee.
- **`history` without `--source` labels every fill `manual`.** The API only
  returns fills matching a given source filter, so an unfiltered fetch cannot
  distinguish copy fills after the fact; use `--source copy` to see them.
- **Strike discovery can include degenerate leads.** Zero-equity accounts can
  surface with absurd ROI figures. The risk engine blocks them via the
  drawdown and margin checks, but discovery output is not sanitized.

## License

MIT
