import type { HttpTransport } from './http.js';
import { ApiError } from './errors.js';
import type { DiscoverOptions, Lead, Platform } from './types.js';

interface DiscoveryWindows {
  '1d'?: string;
  '7d'?: string;
  '30d'?: string;
  all?: string;
}

interface DiscoveryTrader {
  address: string;
  platform?: Platform;
  display_name?: string;
  blockchain_address?: string;
  avatar_url?: string;
  account_value?: string;
  pnl?: DiscoveryWindows;
  roi?: DiscoveryWindows;
  volume?: DiscoveryWindows;
  top_assets?: Array<{ asset?: string; symbol?: string }>;
  equity_curve_30d?: Array<[number, number | string]>;
  copy_score?: string;
  style?: string;
  bias?: string;
  last_traded_at_ms?: number;
}

interface DiscoverResponse {
  items?: DiscoveryTrader[];
  total?: number;
  data_as_of_ms?: number;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function windows(value: DiscoveryWindows | undefined): Lead['pnl'] {
  const out: Lead['pnl'] = {};
  if (!value) return out;
  for (const key of ['1d', '7d', '30d', 'all'] as const) {
    const parsed = optionalNumber(value[key]);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

/** Peak-to-trough decline in percent over the supplied equity curve. */
export function maxDrawdownPct(curve: Array<[number, number | string]> | undefined): number | null {
  if (!curve || curve.length < 2) return null;
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const point of curve) {
    const value = toNumber(point[1]);
    if (value <= 0) continue;
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = ((peak - value) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }
  return Number.isFinite(maxDrawdown) ? Math.round(maxDrawdown * 100) / 100 : null;
}

export function mapDiscoveryTrader(trader: DiscoveryTrader): Lead {
  const platform: Platform =
    trader.platform ?? (trader.address.toLowerCase().startsWith('0x') ? 'hyperliquid' : 'strike');
  const curve = (trader.equity_curve_30d ?? []).map(
    (point) => [Number(point[0]), toNumber(point[1])] as [number, number],
  );

  return {
    address: trader.address,
    platform,
    displayName: trader.display_name,
    blockchainAddress: trader.blockchain_address,
    avatarUrl: trader.avatar_url,
    equity: toNumber(trader.account_value),
    pnl: windows(trader.pnl),
    roi: windows(trader.roi),
    volume: windows(trader.volume),
    topAssets: (trader.top_assets ?? [])
      .filter((asset) => Boolean(asset.asset))
      .map((asset) => ({ asset: asset.asset!, symbol: asset.symbol ?? '' })),
    equityCurve30d: curve,
    maxDrawdown30dPct: maxDrawdownPct(trader.equity_curve_30d),
    copyScore: optionalNumber(trader.copy_score),
    style: trader.style,
    bias: trader.bias,
    lastTradedAtMs: trader.last_traded_at_ms,
    raw: trader,
  };
}

export async function discoverLeads(
  transport: HttpTransport,
  options: DiscoverOptions = {},
): Promise<Lead[]> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 200);
  const top =
    options.top !== undefined ? Math.min(Math.max(options.top, 1), 10000) : undefined;
  const rank = options.rank ?? 'pnl_30d';

  const { data } = await transport.request<DiscoverResponse>({
    method: 'GET',
    path: '/v2/copy/discover',
    auth: false,
    query: {
      platform: options.platform ?? 'hyperliquid',
      rank_by: rank,
      sort: rank,
      order: 'desc',
      top,
      limit,
      search: options.search,
    },
    signal: options.signal,
  });

  return (data.items ?? []).map(mapDiscoveryTrader);
}

/** Fetch one lead, falling back to a discovery search for nicknames. */
export async function fetchLead(
  transport: HttpTransport,
  leadOrAddress: string,
  signal?: AbortSignal,
): Promise<Lead | null> {
  const id = leadOrAddress.trim();
  if (!id) return null;

  try {
    const { data } = await transport.request<DiscoveryTrader>({
      method: 'GET',
      path: `/v2/copy/discover/${encodeURIComponent(id)}`,
      auth: false,
      signal,
    });
    return mapDiscoveryTrader(data);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  try {
    const matches = await discoverLeads(transport, { search: id, limit: 1, signal });
    return matches[0] ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
