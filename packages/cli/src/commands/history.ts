import type { Fill, FillSource } from '@hexis/core';
import { Command } from 'commander';
import { createClient, integerOption, printJson, type CommonOptions } from '../context.js';
import { bold, dim, renderFills } from '../format.js';
import { applyColor, withCommonOptions } from '../options.js';

interface HistoryCliOptions extends CommonOptions {
  source?: string;
  symbol?: string;
  limit: string;
}

const SOURCES: FillSource[] = ['copy', 'manual', 'twap', 'grid'];

export function registerHistory(program: Command): void {
  withCommonOptions(
    program
      .command('history')
      .description('Show fills, optionally filtered to copy-triggered fills.')
      .option('--source <source>', 'copy | manual | twap | grid')
      .option('--symbol <symbol>', 'filter by market, e.g. BTC-USD')
      .option('--limit <n>', 'maximum fills to return', '50'),
  ).action(async (options: HistoryCliOptions) => {
    applyColor(options);
    if (options.source && !SOURCES.includes(options.source as FillSource)) {
      throw new Error(`--source must be one of ${SOURCES.join(', ')}`);
    }

    const client = await createClient(options);
    const limit = integerOption(options.limit, '--limit', 1, 1000);
    const fills: Fill[] = [];
    for await (const fill of client.history({
      source: options.source as FillSource | undefined,
      symbol: options.symbol,
      limit,
    })) {
      fills.push(fill);
    }

    if (options.json) {
      printJson({ count: fills.length, fills });
      return;
    }

    process.stdout.write(
      `${bold('Fills')} ${dim(`(${fills.length}${options.source ? `, source=${options.source}` : ''})`)}\n\n${renderFills(
        fills,
      )}\n`,
    );
  });
}
