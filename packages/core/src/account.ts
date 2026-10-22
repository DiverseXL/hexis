import type { HttpTransport } from './http.js';
import type { AccountSummary } from './types.js';

interface AccountResponse {
  account_id?: string;
  wallet_balance?: string;
  available_balance?: string;
  copy_reserved_balance?: string;
  unrealized_pnl?: string;
  margin_balance?: string;
  total_margin?: string;
  maintenance_margin?: string;
}

function num(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchAccount(
  transport: HttpTransport,
  signal?: AbortSignal,
): Promise<AccountSummary> {
  const { data } = await transport.request<AccountResponse>({
    method: 'GET',
    path: '/v2/account',
    auth: true,
    signal,
  });

  return {
    accountId: data.account_id ?? 'unknown',
    walletBalance: num(data.wallet_balance),
    availableBalance: num(data.available_balance),
    marginBalance: num(data.margin_balance),
    totalMargin: num(data.total_margin),
    maintenanceMargin: num(data.maintenance_margin),
    unrealizedPnl: num(data.unrealized_pnl),
    copyReservedBalance: num(data.copy_reserved_balance),
    raw: data,
  };
}
