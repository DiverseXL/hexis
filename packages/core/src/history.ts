import type { HttpTransport } from './http.js';
import type { Fill, FillSource, HistoryOptions } from './types.js';

interface RawFill {
  id?: number;
  trade_id?: number;
  order_id?: number;
  symbol?: string;
  side?: 'buy' | 'sell';
  price?: string;
  size?: string;
  realized_pnl?: string;
  fee?: string;
  fee_type?: string;
  leverage?: number;
  timestamp?: number;
}

interface FillResponse {
  fills?: RawFill[];
  count?: number;
}

function num(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Yield fills newest-first, following the `fromId` cursor. A `manual` source
 * omits the API's source filter; the API only returns the filter, so fills
 * fetched without one are labelled manual.
 */
export async function* fetchFills(
  transport: HttpTransport,
  options: HistoryOptions = {},
): AsyncIterable<Fill> {
  const limit = Math.max(1, options.limit ?? 100);
  const pageSize = Math.min(Math.max(options.pageSize ?? Math.min(limit, 500), 1), 1000);
  const source: FillSource = options.source ?? 'manual';
  let yielded = 0;
  let fromId: number | undefined;

  while (yielded < limit) {
    const { data } = await transport.request<FillResponse>({
      method: 'GET',
      path: '/v2/history/fill',
      query: {
        symbol: options.symbol,
        limit: pageSize,
        source: source === 'manual' ? undefined : source,
        fromId,
      },
      signal: options.signal,
    });

    const raw = data.fills ?? [];
    if (!raw.length) break;

    for (const fill of raw) {
      if (yielded >= limit) break;
      yielded += 1;
      yield {
        id: String(fill.id ?? fill.trade_id ?? `${fill.timestamp}-${fill.symbol}`),
        tradeId: fill.trade_id ?? 0,
        orderId: fill.order_id ?? 0,
        symbol: fill.symbol ?? 'UNKNOWN',
        side: fill.side ?? 'buy',
        price: num(fill.price),
        size: num(fill.size),
        realizedPnl: num(fill.realized_pnl),
        fee: num(fill.fee),
        feeType: fill.fee_type ?? 'none',
        leverage: fill.leverage,
        timestamp: fill.timestamp ?? 0,
        source,
        raw: fill,
      };
    }

    const lastId = raw[raw.length - 1]?.id;
    if (raw.length < pageSize || lastId === undefined) break;
    fromId = lastId;
  }
}
