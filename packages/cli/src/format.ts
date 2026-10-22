import type { Fill, Lead, Position, Verdict } from '@hexis/core';

let colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;

export function setColor(enabled: boolean): void {
  colorEnabled = enabled;
}

function wrap(code: string): (value: string) => string {
  return (value: string) => (colorEnabled ? `\x1b[${code}m${value}\x1b[0m` : value);
}

export const bold = wrap('1');
export const dim = wrap('2');
export const green = wrap('32');
export const yellow = wrap('33');
export const red = wrap('31');
export const cyan = wrap('36');

export function statusColor(status: Verdict['status'], value: string): string {
  if (status === 'SAFE') return green(value);
  if (status === 'HIGH_RISK') return yellow(value);
  return red(value);
}

export function usd(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function signedUsd(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : '-'}${usd(Math.abs(value), 2)}`;
}

export function pct(value: number | undefined | null, decimals = 1): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

export function shortAddress(value: string): string {
  if (!value) return 'n/a';
  if (value.length <= 16) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function shortTime(ms: number): string {
  if (!ms) return 'n/a';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

export function table(headers: string[], rows: string[][], align: Array<'left' | 'right'> = []): string {
  const plainLength = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '').length;
  const widths = headers.map((header, index) =>
    Math.max(
      plainLength(header),
      ...rows.map((row) => plainLength(row[index] ?? '')),
    ),
  );
  const render = (row: string[]) =>
    row
      .map((cell, index) => {
        const padding = ' '.repeat(Math.max(0, widths[index]! - plainLength(cell)));
        return align[index] === 'right' ? `${padding}${cell}` : `${cell}${padding}`;
      })
      .join('  ')
      .trimEnd();
  return [render(headers), render(widths.map((width) => '-'.repeat(width))), ...rows.map(render)].join('\n');
}

export function renderVerdict(verdict: Verdict): string {
  const lead = verdict.lead;
  const input = verdict.input;
  const lines: string[] = [];

  if (lead) {
    const label = lead.displayName ? `${lead.displayName} (${shortAddress(lead.address)})` : shortAddress(lead.address);
    lines.push(`  Lead:      ${label}  (${lead.platform})`);
    lines.push(
      `  30d PnL:   ${pct(lead.pnl30dPct)}     Equity: ${usd(lead.equity)}     Max DD 30d: ${
        lead.maxDrawdown30dPct === null ? 'n/a' : `${lead.maxDrawdown30dPct.toFixed(1)}%`
      }`,
    );
  }

  lines.push(
    `  Copy size: ${input.sizePct}%  Leverage: ${input.leverage}x  ${
      input.isolated ? 'Isolated' : 'Cross'
    }  Market: ${input.market}`,
  );
  lines.push('');
  lines.push(`  ${bold('VERDICT:')}   ${statusColor(verdict.status, bold(verdict.status))}`);

  const visibleChecks = verdict.checks.filter(
    (check) => check.id !== 'lead-found' && check.id !== 'margin-mode',
  );
  visibleChecks.forEach((check, index) => {
    const prefix = index === 0 ? '  Reason:    ' : '             ';
    const marker = check.status === 'fail' || check.status === 'warn' ? '! ' : '';
    lines.push(`${prefix}${marker}${check.message}`);
  });

  if (verdict.suggested && Object.keys(verdict.suggested).length) {
    const parts: string[] = [];
    if (verdict.suggested.leverage !== undefined) parts.push(`leverage ${verdict.suggested.leverage}x`);
    if (verdict.suggested.sizePct !== undefined) parts.push(`size ${verdict.suggested.sizePct}%`);
    if (verdict.suggested.isolated !== undefined) parts.push(verdict.suggested.isolated ? 'isolated' : 'cross');
    if (verdict.suggested.excludedSymbols?.length) {
      parts.push(`exclude ${verdict.suggested.excludedSymbols.join(', ')}`);
    }
    lines.push(`  Suggested: ${parts.join(', ')}`);
  } else if (verdict.status === 'SAFE') {
    lines.push('  Suggested: (none, inputs are within policy)');
  }

  lines.push(`  Code:      ${verdict.code}`);
  return lines.join('\n');
}

export function renderLeads(leads: Lead[]): string {
  if (!leads.length) return dim('No leads found. Try --platform strike or a broader --search.');
  const rows = leads.map((lead, index) => [
    String(index + 1),
    lead.displayName ? `${lead.displayName} (${shortAddress(lead.address)})` : shortAddress(lead.address),
    lead.platform,
    usd(lead.equity),
    pct(lead.roi['30d'] !== undefined ? lead.roi['30d'] * 100 : undefined),
    usd(lead.pnl['30d'] ?? 0),
    lead.maxDrawdown30dPct === null ? 'n/a' : `${lead.maxDrawdown30dPct.toFixed(1)}%`,
    lead.copyScore !== undefined ? lead.copyScore.toFixed(0) : 'n/a',
    lead.style ?? 'unknown',
  ]);
  return table(
    ['#', 'LEAD', 'PLATFORM', 'EQUITY', 'ROI 30D', 'PNL 30D', 'MAX DD', 'SCORE', 'STYLE'],
    rows,
    ['right', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left'],
  );
}

function distanceCell(position: Position): string {
  if (position.liquidationDistancePct === null) return 'n/a';
  const text = `${position.liquidationDistancePct.toFixed(1)}%`;
  if (position.liquidationDistancePct < 5) return red(text);
  if (position.liquidationDistancePct < 10) return yellow(text);
  return text;
}

export function renderPositions(positions: Position[]): string {
  if (!positions.length) return dim('No open positions.');
  const rows = positions.map((position) => [
    position.symbol,
    position.side,
    position.size.toString(),
    position.entryPrice ? usd(position.entryPrice, 2) : 'n/a',
    position.markPrice ? usd(position.markPrice, 2) : 'n/a',
    position.liquidationPrice ? usd(position.liquidationPrice, 2) : 'n/a',
    distanceCell(position),
    signedUsd(position.upnl),
    `${position.leverage}x`,
    position.marginMode,
    position.source === 'copy' ? `copy:${shortAddress(position.leadAddress ?? '')}` : 'manual',
  ]);
  return table(
    ['SYMBOL', 'SIDE', 'SIZE', 'ENTRY', 'MARK', 'LIQUIDATION', 'DIST', 'UPNL', 'LEV', 'MODE', 'SOURCE'],
    rows,
    ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left'],
  );
}

export function renderFills(fills: Fill[]): string {
  if (!fills.length) return dim('No fills found.');
  const rows = fills.map((fill) => [
    shortTime(fill.timestamp),
    fill.symbol,
    fill.side,
    usd(fill.price, 2),
    fill.size.toString(),
    signedUsd(fill.realizedPnl),
    usd(fill.fee, 2),
    fill.source,
  ]);
  return table(
    ['TIME (UTC)', 'SYMBOL', 'SIDE', 'PRICE', 'SIZE', 'REALIZED PNL', 'FEE', 'SOURCE'],
    rows,
    ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'left'],
  );
}

export function renderReceipt(result: {
  receipt: { outcome: string; result?: unknown };
  receiptPath: string;
}): string {
  const resultRecord =
    result.receipt.result && typeof result.receipt.result === 'object'
      ? (result.receipt.result as Record<string, unknown>)
      : undefined;
  const subscription = resultRecord?.subscription_id;
  const lines = [`  Outcome:   ${result.receipt.outcome}`];
  if (subscription) lines.push(`  Copy ID:   ${String(subscription)}`);
  lines.push(`  Receipt:   ${result.receiptPath}`);
  return lines.join('\n');
}
