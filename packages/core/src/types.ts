/** Public types for @mccloned/hexis-core. */

export type Platform = 'hyperliquid' | 'strike';
export type DiscoverPlatform = Platform | 'all';
export type RankKey = 'pnl_30d' | 'equity' | 'volume_30d';
export type PnlWindow = '1d' | '7d' | '30d' | 'all';
export type FillSource = 'copy' | 'manual' | 'twap' | 'grid';

export interface AssetRef {
  asset: string;
  symbol: string;
}

export interface Lead {
  /** Hyperliquid 0x address or Strike account UUID. Pass this to riskCheck/copy. */
  address: string;
  platform: Platform;
  displayName?: string;
  blockchainAddress?: string;
  avatarUrl?: string;
  /** Current account equity in USD. */
  equity: number;
  pnl: Partial<Record<PnlWindow, number>>;
  roi: Partial<Record<PnlWindow, number>>;
  volume: Partial<Record<PnlWindow, number>>;
  topAssets: AssetRef[];
  equityCurve30d: Array<[number, number]>;
  /** Peak-to-trough decline over the 30-day equity curve, in percent. */
  maxDrawdown30dPct: number | null;
  copyScore?: number;
  style?: string;
  bias?: string;
  lastTradedAtMs?: number;
  raw?: unknown;
}

export interface Manifest {
  version: 1;
  defaults: {
    isolated: boolean;
    leverage: number;
    sizePct: number;
    requireRiskCheck: boolean;
  };
  caps: {
    /** Either a single cap, or a map of SYMBOL -> cap plus a `default`. */
    maxLeverage: number | Record<string, number>;
    minLiquidationDistancePct: number;
    maxLeadDrawdown30dPct: number;
  };
  deny: {
    leads: string[];
    markets: string[];
  };
}

export interface LoadedManifest {
  manifest: Manifest;
  /** Files and environment variables that contributed, highest precedence last. */
  sources: string[];
}

export type VerdictStatus = 'SAFE' | 'HIGH_RISK' | 'BLOCKED' | 'ERROR';

export type VerdictCode =
  | 'OK'
  | 'DATA_INCOMPLETE'
  | 'LEVERAGE_EXCEEDS_POLICY'
  | 'LIQUIDATION_TOO_CLOSE'
  | 'LEAD_DRAWDOWN_EXCEEDS_POLICY'
  | 'MARKET_DENIED'
  | 'LEAD_DENIED'
  | 'LEAD_NOT_FOUND'
  | 'INSUFFICIENT_MARGIN'
  | 'SIGNING_FAILED'
  | 'AUTH_FAILED'
  | 'NETWORK_ERROR'
  | 'API_ERROR';

export interface RiskCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  code?: VerdictCode;
}

export interface SuggestedParameters {
  leverage?: number;
  sizePct?: number;
  isolated?: boolean;
  excludedSymbols?: string[];
}

export interface Verdict {
  status: VerdictStatus;
  code: VerdictCode;
  reasons: string[];
  suggested?: SuggestedParameters;
  checks: RiskCheck[];
  lead?: {
    address: string;
    platform: Platform;
    displayName?: string;
    equity: number;
    pnl30dPct?: number;
    maxDrawdown30dPct: number | null;
  };
  input: {
    leverage: number;
    sizePct: number;
    isolated: boolean;
    market: string;
  };
  checkedAt: string;
}

export interface RiskOptions {
  leverage?: number;
  sizePct?: number;
  isolated?: boolean;
  market?: string;
  /** Skip the account-balance check. Useful for offline preflight. */
  skipAccount?: boolean;
  signal?: AbortSignal;
}

export interface CopyOptions extends RiskOptions {
  force?: boolean;
  dryRun?: boolean;
  builderFeeBps?: number;
  copyExistingPositions?: boolean;
  /** Optional human-readable intent stored in the receipt. */
  mandate?: string;
}

export type ReceiptOutcome = 'executed' | 'refused' | 'simulated' | 'failed';
export type ReceiptAction = 'copy' | 'close' | 'leverage' | 'margin-mode';

export interface ReceiptStep {
  method: string;
  endpoint: string;
  nonce: string;
  bodyHash: string;
  signedAt: string;
  result?: unknown;
  error?: string;
}

export interface Receipt {
  version: 1;
  id: string;
  action: ReceiptAction;
  outcome: ReceiptOutcome;
  mandate: string;
  method: string;
  endpoint: string;
  nonce: string;
  bodyHash: string;
  signedAt: string;
  createdAt: string;
  publicKey?: string;
  accountId?: string;
  request: unknown;
  result: unknown;
  verdict?: Verdict;
  steps?: ReceiptStep[];
  warnings?: string[];
  error?: string;
  receiptHash?: string;
  signature?: string;
}

export interface WrittenReceipt {
  receipt: Receipt;
  path: string;
}

export interface CopyResult {
  verdict: Verdict;
  receipt: Receipt;
  receiptPath: string;
}

export interface CloseOptions {
  force?: boolean;
  mandate?: string;
  signal?: AbortSignal;
}

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number | null;
  liquidationPrice: number | null;
  /** Distance from mark to liquidation, in percent. Null when unknown. */
  liquidationDistancePct: number | null;
  upnl: number;
  leverage: number;
  marginMode: 'cross' | 'isolated';
  source: 'copy' | 'manual';
  leadAddress?: string;
  leadNickname?: string;
  subscriptionId?: string;
  raw?: unknown;
}

export interface PositionOptions {
  watch?: boolean;
  signal?: AbortSignal;
}

export interface Fill {
  id: string;
  tradeId: number;
  orderId: number;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  realizedPnl: number;
  fee: number;
  feeType: string;
  leverage?: number;
  timestamp: number;
  source: 'copy' | 'manual' | 'twap' | 'grid';
  raw?: unknown;
}

export interface HistoryOptions {
  source?: FillSource;
  symbol?: string;
  /** Maximum number of fills to yield. Defaults to 100. */
  limit?: number;
  /** Page size, max 1000. */
  pageSize?: number;
  signal?: AbortSignal;
}

export interface AccountSummary {
  accountId: string;
  walletBalance: number;
  availableBalance: number;
  marginBalance: number;
  totalMargin: number;
  maintenanceMargin: number;
  unrealizedPnl: number;
  copyReservedBalance: number;
  raw?: unknown;
}

export interface DiscoverOptions {
  platform?: DiscoverPlatform;
  rank?: RankKey;
  top?: number;
  limit?: number;
  search?: string;
  signal?: AbortSignal;
}

export interface HexisClientOptions {
  /**
   * Raw Ed25519 hex private key (64 or 128 hex chars). SSH keys are rejected.
   * Public reads work without a key; mutating methods require one.
   */
  privateKey?: string;
  /** Optional public key; derived from privateKey when omitted. */
  publicKey?: string;
  /** Defaults to https://api.strikefinance.org */
  baseUrl?: string;
  /** Injectable fetch for tests and proxies. */
  fetch?: typeof fetch;
  /** Pre-loaded manifest. When omitted the loader runs on first use. */
  manifest?: Manifest;
  /** Directory used for ./hexis.manifest.json discovery and receipts. */
  cwd?: string;
  /** Overrides the receipt directory. Defaults to <cwd>/.hexis/receipts. */
  receiptDir?: string;
  /** Explicit manifest path (highest file precedence). */
  manifestPath?: string;
}
