import type { DiscoverPlatform, RankKey } from '@mccloned/hexis-core';
import { Command } from 'commander';
import { createClient, integerOption, printJson, type CommonOptions } from '../context.js';
import { bold, dim, renderLeads } from '../format.js';
import { applyColor, withCommonOptions } from '../options.js';

interface DiscoverCliOptions extends CommonOptions {
  platform: string;
  rank: string;
  top?: string;
  limit: string;
  search?: string;
}

const PLATFORMS: DiscoverPlatform[] = ['hyperliquid', 'strike', 'all'];
const RANKS: RankKey[] = ['pnl_30d', 'equity', 'volume_30d'];

export function registerDiscover(program: Command): void {
  withCommonOptions(
    program
      .command('discover')
      .description('Rank Hyperliquid and Strike lead traders (public, no key required).')
      .option('--platform <platform>', 'hyperliquid | strike | all', 'hyperliquid')
      .option('--rank <rank>', 'pnl_30d | equity | volume_30d', 'pnl_30d')
      .option('--top <n>', 'only traders ranked in the top N')
      .option('--limit <n>', 'number of leads to return', '5')
      .option('--search <term>', '0x prefix, Strike nickname, or account id'),
  ).action(async (options: DiscoverCliOptions) => {
    applyColor(options);
    if (!PLATFORMS.includes(options.platform as DiscoverPlatform)) {
      throw new Error(`--platform must be one of ${PLATFORMS.join(', ')}`);
    }
    if (!RANKS.includes(options.rank as RankKey)) {
      throw new Error(`--rank must be one of ${RANKS.join(', ')}`);
    }

    const client = await createClient(options);
    const leads = await client.discover({
      platform: options.platform as DiscoverPlatform,
      rank: options.rank as RankKey,
      top: options.top ? integerOption(options.top, '--top', 1, 10000) : undefined,
      limit: integerOption(options.limit, '--limit', 1, 200),
      search: options.search,
    });

    if (options.json) {
      printJson({ count: leads.length, leads });
      return;
    }

    process.stdout.write(
      `${bold('Leads')} ${dim(`(${leads.length}, ranked by ${options.rank})`)}\n\n${renderLeads(leads)}\n\n`,
    );
    process.stdout.write(
      dim('Next: hexis risk-check <lead> --leverage 8   |   hexis copy <lead> --size 5% --leverage 8\n'),
    );
  });
}
