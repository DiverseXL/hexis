import { fetchAccount } from './account.js';
import { executeClose, executeCopy, type CloseResult } from './copy.js';
import { loadManifest, resolveReceiptDir } from './defaults.js';
import { discoverLeads } from './discover.js';
import { fetchFills } from './history.js';
import { HttpTransport } from './http.js';
import { fetchPositions } from './positions.js';
import { checkLeadRisk } from './risk.js';
import type {
  AccountSummary,
  CloseOptions,
  CopyOptions,
  CopyResult,
  DiscoverOptions,
  Fill,
  HexisClientOptions,
  HistoryOptions,
  Lead,
  Manifest,
  Position,
  PositionOptions,
  RiskOptions,
  Verdict,
} from './types.js';

/**
 * High-level Strike client. One method per painful flow; every mutation
 * returns a receipt written to .hexis/receipts/.
 */
export class HexisClient {
  readonly transport: HttpTransport;
  private readonly options: HexisClientOptions;
  private manifestPromise?: Promise<{ manifest: Manifest; sources: string[] }>;
  private readonly cwd: string;
  private readonly receiptDir: string;

  constructor(options: HexisClientOptions = {}) {
    this.options = options;
    this.cwd = options.cwd ?? process.cwd();
    this.receiptDir = resolveReceiptDir({ cwd: this.cwd, override: options.receiptDir });
    this.transport = new HttpTransport({
      baseUrl: options.baseUrl,
      privateKey: options.privateKey,
      publicKey: options.publicKey,
      fetch: options.fetch,
    });

    if (options.manifest) {
      this.manifestPromise = Promise.resolve({ manifest: options.manifest, sources: ['<inline>'] });
    }
  }

  get publicKey(): string | undefined {
    return this.transport.publicKey;
  }

  get authenticated(): boolean {
    return this.transport.authenticated;
  }

  get baseUrl(): string {
    return this.transport.baseUrl;
  }

  get receiptsDirectory(): string {
    return this.receiptDir;
  }

  async getManifest(): Promise<Manifest> {
    const loaded = await this.loadedManifest();
    return loaded.manifest;
  }

  async manifestSources(): Promise<string[]> {
    const loaded = await this.loadedManifest();
    return loaded.sources;
  }

  private loadedManifest(): Promise<{ manifest: Manifest; sources: string[] }> {
    if (!this.manifestPromise) {
      this.manifestPromise = loadManifest({
        cwd: this.cwd,
        explicitPath: this.options.manifestPath,
      });
    }
    return this.manifestPromise;
  }

  async discover(options: DiscoverOptions = {}, signal?: AbortSignal): Promise<Lead[]> {
    return discoverLeads(this.transport, { ...options, signal: options.signal ?? signal });
  }

  async riskCheck(
    leadOrAddress: string,
    options: RiskOptions = {},
    signal?: AbortSignal,
  ): Promise<Verdict> {
    const { manifest } = await this.loadedManifest();
    const result = await checkLeadRisk(this.transport, manifest, leadOrAddress, {
      ...options,
      signal: options.signal ?? signal,
    });
    return result.verdict;
  }

  async copy(lead: string, options: CopyOptions = {}, signal?: AbortSignal): Promise<CopyResult> {
    const { manifest } = await this.loadedManifest();
    return executeCopy({
      transport: this.transport,
      manifest,
      leadId: lead,
      options: { ...options, signal: options.signal ?? signal },
      receiptDir: this.receiptDir,
      cwd: this.cwd,
    });
  }

  async close(
    subscriptionId: string,
    options: CloseOptions = {},
    signal?: AbortSignal,
  ): Promise<CloseResult> {
    return executeClose({
      transport: this.transport,
      subscriptionId,
      options: { ...options, signal: options.signal ?? signal },
      receiptDir: this.receiptDir,
    });
  }

  async positions(options: PositionOptions = {}, signal?: AbortSignal): Promise<Position[]> {
    return fetchPositions(this.transport, options.signal ?? signal);
  }

  history(options: HistoryOptions = {}, signal?: AbortSignal): AsyncIterable<Fill> {
    return fetchFills(this.transport, { ...options, signal: options.signal ?? signal });
  }

  async account(signal?: AbortSignal): Promise<AccountSummary> {
    return fetchAccount(this.transport, signal);
  }
}
