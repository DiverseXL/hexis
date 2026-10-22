import { fetchAccount } from './account.js';
import { fetchLead } from './discover.js';
import { leverageCap } from './defaults.js';
import type { HttpTransport } from './http.js';
import type { AccountSummary, Lead, Manifest, RiskCheck, RiskOptions, Verdict } from './types.js';
import { verdictFromChecks } from './verdict.js';

/**
 * Maintenance margin plus liquidation-fee buffer used for the preflight
 * liquidation estimate: distance ~= 1/leverage - 1.1%. At 8x this yields the
 * 11.4% shown in the product spec; at 25x it yields 2.9%.
 */
export const LIQUIDATION_BUFFER_PCT = 1.1;

export function estimateLiquidationDistancePct(leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return Math.max(0, (1 / leverage) * 100 - LIQUIDATION_BUFFER_PCT);
}

export function suggestSafeLeverage(minDistancePct: number): number {
  const denominator = minDistancePct / 100 + LIQUIDATION_BUFFER_PCT / 100;
  if (denominator <= 0) return 1;
  return Math.max(1, Math.min(125, Math.floor(1 / denominator)));
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export interface RiskEvaluationInput {
  lead: Lead;
  manifest: Manifest;
  options: RiskOptions;
  account?: AccountSummary;
}

export function evaluateRisk({ lead, manifest, options, account }: RiskEvaluationInput): Verdict {
  const leverage = options.leverage ?? manifest.defaults.leverage;
  const sizePct = options.sizePct ?? manifest.defaults.sizePct;
  const isolated = options.isolated ?? manifest.defaults.isolated;
  const market =
    options.market ?? lead.topAssets.find((asset) => asset.symbol)?.symbol ?? 'default';
  const checks: RiskCheck[] = [];
  const suggested: NonNullable<Verdict['suggested']> = {};

  checks.push({
    id: 'lead-found',
    status: 'pass',
    message: `Lead ${lead.displayName ? `${lead.displayName} (${lead.address})` : lead.address} found on ${lead.platform}`,
  });

  const deniedLead = manifest.deny.leads.some(
    (entry) => norm(entry) === norm(lead.address) || (lead.displayName && norm(entry) === norm(lead.displayName)),
  );
  if (deniedLead) {
    checks.push({
      id: 'lead-denied',
      status: 'fail',
      code: 'LEAD_DENIED',
      message: `Lead ${lead.address} is on the manifest deny list`,
    });
  }

  const deniedMarkets = new Set(manifest.deny.markets.map(norm));
  const hitMarkets = lead.topAssets
    .map((asset) => asset.symbol)
    .filter((symbol) => symbol && deniedMarkets.has(norm(symbol)));
  if (market !== 'default' && deniedMarkets.has(norm(market))) hitMarkets.push(market);
  if (hitMarkets.length) {
    checks.push({
      id: 'market-denied',
      status: 'fail',
      code: 'MARKET_DENIED',
      message: `Lead trades denied market(s): ${[...new Set(hitMarkets)].join(', ')}`,
    });
    suggested.excludedSymbols = [...new Set([...manifest.deny.markets, ...hitMarkets])];
  }

  const cap = leverageCap(manifest, market);
  if (leverage > cap) {
    checks.push({
      id: 'leverage-cap',
      status: 'fail',
      code: 'LEVERAGE_EXCEEDS_POLICY',
      message: `Requested leverage ${leverage}x exceeds cap ${cap}x for ${market}`,
    });
    suggested.leverage = cap;
  } else {
    checks.push({
      id: 'leverage-cap',
      status: 'pass',
      message: `Leverage ${leverage}x <= cap ${cap}x`,
    });
  }

  const distance = estimateLiquidationDistancePct(leverage);
  const minDistance = manifest.caps.minLiquidationDistancePct;
  if (distance < minDistance) {
    checks.push({
      id: 'liquidation-distance',
      status: 'fail',
      code: 'LIQUIDATION_TOO_CLOSE',
      message: `Estimated liquidation distance ${distance.toFixed(1)}% < minimum ${minDistance}%`,
    });
    const safe = suggestSafeLeverage(minDistance);
    suggested.leverage = suggested.leverage ? Math.min(suggested.leverage, safe) : safe;
  } else {
    checks.push({
      id: 'liquidation-distance',
      status: 'pass',
      message: `Estimated liquidation distance ${distance.toFixed(1)}% >= min ${minDistance}%`,
    });
  }

  const drawdown = lead.maxDrawdown30dPct;
  const maxDrawdown = manifest.caps.maxLeadDrawdown30dPct;
  if (drawdown === null) {
    checks.push({
      id: 'lead-drawdown',
      status: 'warn',
      code: 'DATA_INCOMPLETE',
      message: 'Lead 30d equity curve unavailable; drawdown check skipped',
    });
  } else if (drawdown > maxDrawdown) {
    checks.push({
      id: 'lead-drawdown',
      status: 'fail',
      code: 'LEAD_DRAWDOWN_EXCEEDS_POLICY',
      message: `Lead 30d max drawdown ${drawdown.toFixed(1)}% > cap ${maxDrawdown}%`,
    });
    if (maxDrawdown > 0 && drawdown > 0) {
      const scaled = Math.floor(sizePct * (maxDrawdown / drawdown));
      suggested.sizePct = Math.max(1, scaled);
    }
  } else {
    checks.push({
      id: 'lead-drawdown',
      status: 'pass',
      message: `Lead 30d max drawdown ${drawdown.toFixed(1)}% <= cap ${maxDrawdown}%`,
    });
  }

  if (!Number.isFinite(sizePct) || sizePct <= 0 || sizePct > 100) {
    checks.push({
      id: 'size-pct',
      status: 'fail',
      code: 'INSUFFICIENT_MARGIN',
      message: `Copy size must be between 0 and 100 percent (got ${sizePct})`,
    });
  }

  if (account) {
    const equity = account.marginBalance || account.walletBalance;
    const margin = (equity * sizePct) / 100;
    if (margin > account.availableBalance + 0.000001) {
      checks.push({
        id: 'margin',
        status: 'fail',
        code: 'INSUFFICIENT_MARGIN',
        message: `Copy margin $${margin.toFixed(2)} exceeds available balance $${account.availableBalance.toFixed(2)}`,
      });
      if (equity > 0) {
        suggested.sizePct = Math.max(1, Math.floor((account.availableBalance / equity) * 100));
      }
    } else if (margin * leverage < 10) {
      checks.push({
        id: 'margin',
        status: 'fail',
        code: 'INSUFFICIENT_MARGIN',
        message: `Copy notional $${(margin * leverage).toFixed(2)} is below the $10 market minimum`,
      });
    } else {
      checks.push({
        id: 'margin',
        status: 'pass',
        message: `Copy margin $${margin.toFixed(2)} of $${account.availableBalance.toFixed(2)} available`,
      });
    }
  } else {
    checks.push({
      id: 'margin',
      status: 'skip',
      message: 'Account balance unavailable; margin check skipped',
    });
  }

  checks.push({
    id: 'margin-mode',
    status: 'pass',
    message: `Margin mode ${isolated ? 'isolated' : 'cross'}`,
  });

  return verdictFromChecks({
    checks,
    suggested,
    lead: {
      address: lead.address,
      platform: lead.platform,
      displayName: lead.displayName,
      equity: lead.equity,
      pnl30dPct: lead.roi['30d'] !== undefined ? lead.roi['30d'] * 100 : undefined,
      maxDrawdown30dPct: lead.maxDrawdown30dPct,
    },
    input: { leverage, sizePct, isolated, market },
  });
}

export async function checkLeadRisk(
  transport: HttpTransport,
  manifest: Manifest,
  leadOrAddress: string,
  options: RiskOptions = {},
): Promise<{ lead: Lead | null; verdict: Verdict }> {
  const lead = await fetchLead(transport, leadOrAddress, options.signal);

  if (!lead) {
    const verdict = verdictFromChecks({
      checks: [
        {
          id: 'lead-found',
          status: 'fail',
          code: 'LEAD_NOT_FOUND',
          message: `Lead ${leadOrAddress} was not found on Strike or Hyperliquid discovery`,
        },
      ],
      input: {
        leverage: options.leverage ?? manifest.defaults.leverage,
        sizePct: options.sizePct ?? manifest.defaults.sizePct,
        isolated: options.isolated ?? manifest.defaults.isolated,
        market: options.market ?? 'unknown',
      },
    });
    return { lead: null, verdict };
  }

  let account: AccountSummary | undefined;
  if (transport.authenticated && !options.skipAccount) {
    account = await fetchAccount(transport, options.signal);
  }

  return { lead, verdict: evaluateRisk({ lead, manifest, options, account }) };
}
