import type { HttpTransport } from './http.js';
import type { Position } from './types.js';

interface RawPosition {
  id?: number;
  margin_mode?: 'cross' | 'isolated';
  leverage?: number;
  size?: string;
  entry_price?: string;
  symbol?: string;
  upnl?: string;
  liquidation_price?: string;
}

interface PositionsResponse {
  positions?: RawPosition[];
}

interface RawPrice {
  symbol?: string;
  price?: string;
}

interface CopyPosition {
  id?: string;
  subscription_id?: string;
  lead_account_id?: string;
  lead_nickname?: string;
  market?: string;
  side?: 'long' | 'short';
}

interface CopyPositionsResponse {
  positions?: CopyPosition[];
}

function num(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function priceMap(data: RawPrice[] | RawPrice | undefined): Map<string, number> {
  const map = new Map<string, number>();
  const list = Array.isArray(data) ? data : data ? [data] : [];
  for (const entry of list) {
    if (entry.symbol) map.set(entry.symbol, num(entry.price));
  }
  return map;
}

export async function fetchPositions(
  transport: HttpTransport,
  signal?: AbortSignal,
): Promise<Position[]> {
  const [positionsResult, pricesResult] = await Promise.all([
    transport.request<PositionsResponse>({ method: 'GET', path: '/v2/positions', signal }),
    transport
      .request<RawPrice[] | RawPrice>({
        method: 'GET',
        path: '/price/v2/ticker/price',
        auth: false,
        signal,
      })
      .catch(() => ({ data: [] as RawPrice[] })),
  ]);

  let copyBySymbol = new Map<string, CopyPosition>();
  if (transport.authenticated) {
    try {
      const copy = await transport.request<CopyPositionsResponse>({
        method: 'GET',
        path: '/v2/copy/positions',
        signal,
      });
      copyBySymbol = new Map(
        (copy.data.positions ?? [])
          .filter((position) => position.market && !position.id?.startsWith('own'))
          .map((position) => [position.market!, position]),
      );
    } catch {
      // Copy trading may be disabled on the environment; positions still work.
    }
  }

  const prices = priceMap(pricesResult.data);

  return (positionsResult.data.positions ?? [])
    .map((raw): Position => {
      const size = num(raw.size);
      const symbol = raw.symbol ?? 'UNKNOWN';
      const markPrice = prices.get(symbol) ?? null;
      const liquidationPrice = num(raw.liquidation_price) || null;
      const copy = copyBySymbol.get(symbol);
      const liquidationDistancePct =
        markPrice && liquidationPrice
          ? Math.abs(liquidationPrice - markPrice) / markPrice * 100
          : null;

      return {
        id: String(raw.id ?? symbol),
        symbol,
        side: size < 0 ? 'short' : 'long',
        size: Math.abs(size),
        entryPrice: num(raw.entry_price),
        markPrice,
        liquidationPrice,
        liquidationDistancePct,
        upnl: num(raw.upnl),
        leverage: raw.leverage ?? 0,
        marginMode: raw.margin_mode ?? 'cross',
        source: copy ? 'copy' : 'manual',
        leadAddress: copy?.lead_account_id,
        leadNickname: copy?.lead_nickname,
        subscriptionId: copy?.subscription_id,
        raw,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}
