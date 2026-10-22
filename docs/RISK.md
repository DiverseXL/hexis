# Risk model

Hexis is a preflight engine, not a portfolio risk system. It answers one
question: **given the current manifest and account, should this copy start?**

## Verdict statuses

| Status | Meaning | CLI exit | Copy behavior |
| --- | --- | --- | --- |
| `SAFE` | Every check passes | 0 | Proceeds |
| `HIGH_RISK` | A check could not be completed or a warning fired | 2 | Refuses without `--force` |
| `BLOCKED` | A hard policy check failed | 3 | Refuses without `--force` |
| `ERROR` | Network, auth, signing, or API failure | 1 | Nothing is sent |

`riskCheck` never throws for a missing or malformed lead. It returns `BLOCKED`
with `LEAD_NOT_FOUND`. Network and auth failures still throw, because the
engine cannot make a claim without data.

## Machine codes

| Code | Trigger |
| --- | --- |
| `OK` | Safe |
| `DATA_INCOMPLETE` | 30-day equity curve unavailable; drawdown skipped |
| `LEVERAGE_EXCEEDS_POLICY` | Requested leverage above the market cap |
| `LIQUIDATION_TOO_CLOSE` | Estimated liquidation distance below the minimum |
| `LEAD_DRAWDOWN_EXCEEDS_POLICY` | Lead 30-day max drawdown above the cap |
| `MARKET_DENIED` | Lead trades a market on the deny list |
| `LEAD_DENIED` | Lead address or nickname on the deny list |
| `LEAD_NOT_FOUND` | Discovery returned no match |
| `INSUFFICIENT_MARGIN` | Copy margin exceeds available balance, or notional is below $10 |
| `AUTH_FAILED` | Missing, invalid, or unregistered API wallet |
| `SIGNING_FAILED` | Bad key format or signing failure |
| `NETWORK_ERROR` | DNS, timeout, abort, or transport failure |
| `API_ERROR` | Other non-2xx Strike response |

## Checks

### 1. Leverage cap

`caps.maxLeverage` is either a number or a map with a `default` plus per-market
overrides. The requested market defaults to the lead's first listed top asset.

```
cap = caps.maxLeverage[market] ?? caps.maxLeverage.default
leverage > cap  ->  LEVERAGE_EXCEEDS_POLICY
```

### 2. Liquidation distance (estimate)

Before a position exists, Hexis estimates the adverse move that would
liquidate an isolated position:

```
distancePct = 100 / leverage - 1.1
```

`1.1` is a maintenance-margin plus liquidation-fee buffer. It reproduces the
product spec's examples: 8x gives 11.4%, 25x gives 2.9%. If the estimated
distance is below `caps.minLiquidationDistancePct`, the verdict is `BLOCKED`.

Suggested safe leverage:

```
floor(1 / (minDistancePct/100 + 0.011))
```

At a 5% minimum this is 16x. The suggestion is clamped to the leverage cap.

This is an estimate. Actual liquidation prices depend on maintenance tiers,
fees, funding, and cross-margin balances. Once a position exists, `hexis
positions` uses Strike's actual `liquidation_price` and the live mark price.

### 3. Lead drawdown

Hexis computes the peak-to-trough decline of the lead's 30-day equity curve
from the discovery response. If it exceeds `caps.maxLeadDrawdown30dPct`, the
copy is blocked and a smaller `sizePct` is suggested:

```
suggestedSize = floor(sizePct * maxDrawdownCap / actualDrawdown)
```

A missing curve is a warning (`HIGH_RISK`), not a pass.

### 4. Deny lists

`deny.leads` matches addresses or Strike nicknames, case-insensitively.
`deny.markets` matches any of the lead's top-asset symbols. A denied market
also contributes to suggested `excludedSymbols`, which is sent to Strike so the
subscription never opens it.

### 5. Margin

When an API wallet key is present, Hexis reads `/v2/account` and checks:

- copy margin (`equity * sizePct/100`) against `available_balance`;
- copy notional at the requested leverage against the $10 market minimum.

Without a key the check is skipped. That is why `hexis risk-check` can run
publicly, and why a `SAFE` public verdict is not a funding guarantee.

## Configuration knobs

```json
{
  "caps": {
    "maxLeverage": { "default": 10, "BTC-USD": 15, "ETH-USD": 15 },
    "minLiquidationDistancePct": 5,
    "maxLeadDrawdown30dPct": 25
  },
  "deny": { "leads": ["0xBad..."], "markets": ["DOGE-USD"] }
}
```

Editing `maxLeverage` from 10 to 5 and re-running `risk-check` is the demo:
8x flips from `SAFE` to `BLOCKED` with no code change.

## Force semantics

`--force` overrides `BLOCKED` and `HIGH_RISK`. It is intentionally loud:

- the receipt records the verdict and an "(forced override)" mandate;
- the CLI still prints every failed reason;
- leverage and margin changes that fail are downgraded to receipt warnings.

Do not let an agent set `--force` autonomously. It exists for a human who has
read the reasons.

## Execution notes

- Sizing is `copy_amount = account_equity * sizePct / 100`, sent as a
  `fixed_ratio` subscription. Five percent means five percent of your account,
  not five percent of the lead's.
- Before subscribing, Hexis sets leverage and margin mode for up to three of
  the lead's listed top markets using `POST /v2/leverage` and
  `POST /v2/marginMode`. Those calls affect your account's settings for those
  markets, not just the copy.
- If a margin-mode change fails (for example because a position is already
  open), the copy continues and the receipt records a warning. If a leverage
  change fails, the copy aborts unless `--force` is set.
- Hexis uses an existing account subscription, not Strike's managed copy
  sub-account flow. Managed sub-accounts are a natural next step; they are out
  of scope for the MVP.
- `defaults.requireRiskCheck` is part of the locked manifest schema but is
  advisory: Hexis always runs preflight. There is no setting that silently
  disables the risk engine.
- `--builder-fee-bps` sends `X-Builder-Fee-Bps` on the subscribe request and
  records it in the receipt. Strike caps builder fees at 100 BPS.

## What Hexis does not model

- Funding costs, fee tiers, and borrow costs.
- Correlated exposure across multiple copy subscriptions.
- Cross-margin portfolio liquidation.
- Slippage on copied market orders.
- Lead behavior changes or copy-score decay.

Document these rather than pretending the preflight is a guarantee.
