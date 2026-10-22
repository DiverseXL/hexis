import { exitCodeForVerdict } from '@hexis/core';
import { Command } from 'commander';
import {
  createClient,
  integerOption,
  isolatedOption,
  leverageOption,
  printJson,
  sizeOption,
  type CommonOptions,
} from '../context.js';
import { bold, dim, renderReceipt, renderVerdict } from '../format.js';
import { applyColor, withCommonOptions } from '../options.js';

interface CopyCliOptions extends CommonOptions {
  size?: string;
  leverage?: string;
  isolated?: boolean;
  cross?: boolean;
  market?: string;
  force?: boolean;
  dryRun?: boolean;
  builderFeeBps?: string;
  copyExisting?: boolean;
}

export function registerCopy(program: Command): void {
  withCommonOptions(
    program
      .command('copy')
      .description('Risk-check, then start a fixed-ratio Strike copy. Refuses unsafe verdicts.')
      .argument('<lead>', 'Hyperliquid 0x address or Strike account id')
      .option('--size <pct>', 'copy size percent of account equity, e.g. 5 or 5%')
      .option('--leverage <n>', 'leverage applied to the lead top markets')
      .option('--isolated', 'use isolated margin (manifest default)')
      .option('--cross', 'use cross margin')
      .option('--market <symbol>', 'market used for the leverage cap check')
      .option('--force', 'proceed despite BLOCKED or HIGH_RISK (receipt records the override)')
      .option('--dry-run', 'preflight and write a simulated receipt without sending orders')
      .option('--builder-fee-bps <n>', 'X-Builder-Fee-Bps header, 0-100')
      .option('--copy-existing', 'mirror the lead existing positions once')
  ).action(async (lead: string, options: CopyCliOptions) => {
    applyColor(options);
    const client = await createClient(options);

    const result = await client.copy(lead, {
      sizePct: options.size ? sizeOption(options.size) : undefined,
      leverage: options.leverage ? leverageOption(options.leverage) : undefined,
      isolated: isolatedOption(options),
      market: options.market,
      force: options.force,
      dryRun: options.dryRun,
      copyExistingPositions: options.copyExisting,
      builderFeeBps: options.builderFeeBps
        ? integerOption(options.builderFeeBps, '--builder-fee-bps', 0, 100)
        : undefined,
    });

    if (options.json) {
      printJson({
        verdict: result.verdict,
        outcome: result.receipt.outcome,
        receiptPath: result.receiptPath,
        receipt: result.receipt,
      });
    } else {
      process.stdout.write(`\n${renderVerdict(result.verdict)}\n\n`);
      process.stdout.write(`${bold('Action')}\n${renderReceipt(result)}\n`);
      if (result.receipt.outcome === 'refused') {
        process.stdout.write(
          dim('\nCopy refused. Pass --force only after reviewing the reasons above.\n'),
        );
      } else if (result.receipt.outcome === 'simulated') {
        process.stdout.write(dim('\nDry run complete. No order was sent.\n'));
      } else {
        process.stdout.write(dim('\nCopy is live. Monitor with: hexis positions --watch\n'));
      }
    }

    if (result.receipt.outcome === 'refused') {
      process.exitCode = exitCodeForVerdict(result.verdict, options.force);
    }
  });
}
