import { randomUUID } from 'node:crypto';
import { fetchAccount } from './account.js';
import { ApiError, AuthError, HexisError } from './errors.js';
import type { HttpTransport } from './http.js';
import { createReceipt, writeReceipt } from './receipt.js';
import { checkLeadRisk } from './risk.js';
import { serializeBody, sha256Hex, signRequest } from './signing.js';
import type {
  CloseOptions,
  CopyOptions,
  CopyResult,
  Manifest,
  Receipt,
  ReceiptStep,
  Verdict,
} from './types.js';

interface SubscribeBody {
  lead_account_id: string;
  platform: 'strike' | 'hyperliquid';
  copy_mode: 'fixed_ratio';
  copy_amount: string;
  copy_existing_positions: boolean;
  leverage_source: 'account';
  margin_mode_source: 'account';
  excluded_symbols?: string[];
}

export interface ExecuteCopyInput {
  transport: HttpTransport;
  manifest: Manifest;
  leadId: string;
  options: CopyOptions;
  receiptDir: string;
  cwd?: string;
}

export interface CloseResult {
  receipt: Receipt;
  path: string;
}

function money(value: number): string {
  return value.toFixed(2);
}

function mandateFor(input: {
  leadId: string;
  sizePct: number;
  leverage: number;
  isolated: boolean;
  force?: boolean;
}): string {
  return `Copy ${input.leadId} at ${input.sizePct}% size, ${input.leverage}x leverage, ${
    input.isolated ? 'isolated' : 'cross'
  } margin${input.force ? ' (forced override)' : ''}`;
}

function plannedRequest(
  method: string,
  endpoint: string,
  body: unknown,
  privateKey?: string,
): { nonce: string; bodyHash: string; signedAt: string } {
  const bodyString = serializeBody(body);
  if (privateKey) {
    const signed = signRequest({ method, path: endpoint, bodyString, privateKey });
    return {
      nonce: signed.nonce,
      bodyHash: signed.bodyHash,
      signedAt: new Date(signed.timestamp * 1000).toISOString(),
    };
  }
  return { nonce: randomUUID(), bodyHash: sha256Hex(bodyString), signedAt: new Date().toISOString() };
}

async function applyMarketSettings(
  transport: HttpTransport,
  manifest: Manifest,
  leadSymbols: string[],
  options: CopyOptions,
  leverage: number,
  isolated: boolean,
  steps: ReceiptStep[],
  warnings: string[],
): Promise<void> {
  if (options.dryRun) return;

  for (const symbol of leadSymbols.slice(0, 3)) {
    if (manifest.deny.markets.map((m) => m.toUpperCase()).includes(symbol.toUpperCase())) {
      warnings.push(`Skipped denied market ${symbol}`);
      continue;
    }

    const marginMode = isolated ? 'isolated' : 'cross';
    try {
      const leverageResult = await transport.request<Record<string, unknown>>({
        method: 'POST',
        path: '/v2/leverage',
        body: { symbol, leverage },
        signal: options.signal,
      });
      steps.push({
        method: 'POST',
        endpoint: '/v2/leverage',
        nonce: leverageResult.signed?.nonce ?? '',
        bodyHash: leverageResult.signed?.bodyHash ?? '',
        signedAt: new Date((leverageResult.signed?.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
        result: leverageResult.data,
      });
    } catch (error) {
      const message = `Could not set ${leverage}x leverage on ${symbol}: ${(error as Error).message}`;
      if (!options.force) throw error;
      warnings.push(message);
    }

    try {
      const marginResult = await transport.request<Record<string, unknown>>({
        method: 'POST',
        path: '/v2/marginMode',
        body: { symbol, marginMode },
        signal: options.signal,
      });
      steps.push({
        method: 'POST',
        endpoint: '/v2/marginMode',
        nonce: marginResult.signed?.nonce ?? '',
        bodyHash: marginResult.signed?.bodyHash ?? '',
        signedAt: new Date((marginResult.signed?.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
        result: marginResult.data,
      });
    } catch (error) {
      const message = `Could not set ${marginMode} margin on ${symbol}: ${(error as Error).message}`;
      warnings.push(message);
    }
  }
}

/**
 * Preflight, then subscribe to a lead using fixed-ratio sizing. Refusals and
 * failures are receipted too, so the audit trail explains what did not happen.
 */
export async function executeCopy(input: ExecuteCopyInput): Promise<CopyResult> {
  const { transport, manifest, leadId, options, receiptDir } = input;
  const leverage = options.leverage ?? manifest.defaults.leverage;
  const sizePct = options.sizePct ?? manifest.defaults.sizePct;
  const isolated = options.isolated ?? manifest.defaults.isolated;
  const mandate = options.mandate ?? mandateFor({ leadId, sizePct, leverage, isolated, force: options.force });

  if (!transport.authenticated) {
    throw new AuthError('copy requires an API wallet key. Run hexis init and set HEXIS_PRIVATE_KEY.');
  }
  if (options.builderFeeBps !== undefined) {
    if (
      !Number.isInteger(options.builderFeeBps) ||
      options.builderFeeBps < 0 ||
      options.builderFeeBps > 100
    ) {
      throw new HexisError('builderFeeBps must be an integer between 0 and 100.', 'API_ERROR', 1);
    }
  }

  const { lead, verdict } = await checkLeadRisk(transport, manifest, leadId, {
    ...options,
    leverage,
    sizePct,
    isolated,
  });

  if (!lead) {
    const { nonce, bodyHash, signedAt } = plannedRequest(
      'POST',
      '/v2/copy/subscribe',
      {},
      transport.privateKey,
    );
    const receipt = createReceipt({
      action: 'copy',
      outcome: 'refused',
      mandate,
      method: 'POST',
      endpoint: '/v2/copy/subscribe',
      nonce,
      bodyHash,
      signedAt,
      request: {},
      result: { refused: true, reason: 'Lead not found' },
      verdict,
      publicKey: transport.publicKey,
    });
    const written = await writeReceipt(receiptDir, receipt, transport.privateKey);
    return { verdict, receipt: written.receipt, receiptPath: written.path };
  }

  const blocked = verdict.status === 'BLOCKED' || verdict.status === 'HIGH_RISK';

  if (blocked && !options.force) {
    const { nonce, bodyHash, signedAt } = plannedRequest(
      'POST',
      '/v2/copy/subscribe',
      { lead_account_id: lead.address },
      transport.privateKey,
    );
    const receipt = createReceipt({
      action: 'copy',
      outcome: 'refused',
      mandate,
      method: 'POST',
      endpoint: '/v2/copy/subscribe',
      nonce,
      bodyHash,
      signedAt,
      request: { lead_account_id: lead.address },
      result: { refused: true, reason: `Verdict ${verdict.status}; pass --force to override` },
      verdict,
      publicKey: transport.publicKey,
    });
    const written = await writeReceipt(receiptDir, receipt, transport.privateKey);
    return { verdict, receipt: written.receipt, receiptPath: written.path };
  }

  const account = await fetchAccount(transport, options.signal);
  const equity = account.marginBalance || account.walletBalance;
  const copyAmount = Math.round(((equity * sizePct) / 100) * 100) / 100;
  if (!Number.isFinite(copyAmount) || copyAmount <= 0) {
    throw new HexisError(
      `Copy amount resolves to $${copyAmount}. Fund the account or raise --size.`,
      'INSUFFICIENT_MARGIN',
      3,
    );
  }

  const excluded = [...manifest.deny.markets];
  for (const required of verdict.suggested?.excludedSymbols ?? []) {
    if (!excluded.includes(required)) excluded.push(required);
  }

  const body: SubscribeBody = {
    lead_account_id: lead.address,
    platform: lead.platform,
    copy_mode: 'fixed_ratio',
    copy_amount: money(copyAmount),
    copy_existing_positions: options.copyExistingPositions ?? false,
    leverage_source: 'account',
    margin_mode_source: 'account',
    ...(excluded.length ? { excluded_symbols: excluded } : {}),
  };

  const steps: ReceiptStep[] = [];
  const warnings: string[] = [];
  const symbols = lead.topAssets.map((asset) => asset.symbol).filter(Boolean);
  if (!symbols.length) {
    warnings.push('Lead has no listed top markets; account leverage and margin settings were left unchanged');
  }

  try {
    await applyMarketSettings(transport, manifest, symbols, options, leverage, isolated, steps, warnings);

    if (options.dryRun) {
      const planned = plannedRequest('POST', '/v2/copy/subscribe', body, transport.privateKey);
      const receipt = createReceipt({
        action: 'copy',
        outcome: 'simulated',
        mandate,
        method: 'POST',
        endpoint: '/v2/copy/subscribe',
        ...planned,
        request: { body, builderFeeBps: options.builderFeeBps },
        result: { simulated: true, copyAmount, lead: lead.address },
        verdict,
        publicKey: transport.publicKey,
        accountId: account.accountId,
        steps,
        warnings,
      });
      const written = await writeReceipt(receiptDir, receipt, transport.privateKey);
      return { verdict, receipt: written.receipt, receiptPath: written.path };
    }

    const subscribe = await transport.request<Record<string, unknown>>({
      method: 'POST',
      path: '/v2/copy/subscribe',
      body,
      signal: options.signal,
      headers:
        options.builderFeeBps !== undefined
          ? { 'X-Builder-Fee-Bps': String(options.builderFeeBps) }
          : undefined,
    });

    const receipt = createReceipt({
      action: 'copy',
      outcome: 'executed',
      mandate,
      method: 'POST',
      endpoint: '/v2/copy/subscribe',
      nonce: subscribe.signed?.nonce ?? '',
      bodyHash: subscribe.signed?.bodyHash ?? sha256Hex(serializeBody(body)),
      signedAt: new Date((subscribe.signed?.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
      request: { body, builderFeeBps: options.builderFeeBps },
      result: subscribe.data,
      verdict,
      publicKey: transport.publicKey,
      accountId: account.accountId,
      steps,
      warnings: warnings.length ? warnings : undefined,
    });
    const written = await writeReceipt(receiptDir, receipt, transport.privateKey);
    return { verdict, receipt: written.receipt, receiptPath: written.path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const planned = plannedRequest('POST', '/v2/copy/subscribe', body, transport.privateKey);
    const receipt = createReceipt({
      action: 'copy',
      outcome: 'failed',
      mandate,
      method: 'POST',
      endpoint: '/v2/copy/subscribe',
      ...planned,
      request: { body, builderFeeBps: options.builderFeeBps },
      result: { failed: true },
      verdict,
      publicKey: transport.publicKey,
      accountId: account.accountId,
      steps,
      warnings: warnings.length ? warnings : undefined,
      error: message,
    });
    try {
      await writeReceipt(receiptDir, receipt, transport.privateKey);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

export async function executeClose(input: {
  transport: HttpTransport;
  subscriptionId: string;
  options: CloseOptions;
  receiptDir: string;
}): Promise<CloseResult> {
  const { transport, subscriptionId, options, receiptDir } = input;
  if (!transport.authenticated) throw new AuthError('close requires an API wallet key.');
  if (!subscriptionId.trim()) throw new HexisError('subscriptionId is required.', 'API_ERROR', 1);

  const endpoint = `/v2/copy/subscribe/${encodeURIComponent(subscriptionId)}`;
  const mandate = options.mandate ?? `Stop copying subscription ${subscriptionId}`;
  const planned = plannedRequest('DELETE', endpoint, undefined, transport.privateKey);

  try {
    const response = await transport.request<unknown>({
      method: 'DELETE',
      path: endpoint,
      signal: options.signal,
    });
    const receipt = createReceipt({
      action: 'close',
      outcome: 'executed',
      mandate,
      method: 'DELETE',
      endpoint,
      nonce: response.signed?.nonce ?? planned.nonce,
      bodyHash: response.signed?.bodyHash ?? planned.bodyHash,
      signedAt: new Date((response.signed?.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
      request: { subscriptionId },
      result: { status: response.status },
      publicKey: transport.publicKey,
    });
    const written = await writeReceipt(receiptDir, receipt, transport.privateKey);
    return { receipt: written.receipt, path: written.path };
  } catch (error) {
    const receipt = createReceipt({
      action: 'close',
      outcome: 'failed',
      mandate,
      method: 'DELETE',
      endpoint,
      ...planned,
      request: { subscriptionId },
      result: { failed: true },
      publicKey: transport.publicKey,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await writeReceipt(receiptDir, receipt, transport.privateKey);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

export type { Verdict };
