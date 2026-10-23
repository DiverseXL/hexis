import { exitCodeForVerdict } from '@mccloned/hexis-core';
import { Command } from 'commander';
import {
  createClient,
  isolatedOption,
  leverageOption,
  printJson,
  sizeOption,
  type CommonOptions,
} from '../context.js';
import { bold, dim, renderVerdict } from '../format.js';
import { applyColor, withCommonOptions } from '../options.js';

interface RiskCliOptions extends CommonOptions {
  leverage?: string;
  size?: string;
  isolated?: boolean;
  cross?: boolean;
  market?: string;
  force?: boolean;
}

export function registerRiskCheck(program: Command): void {
  withCommonOptions(
    program
      .command('risk-check')
      .description('Preflight a lead against manifest policy. Never throws for a bad lead.')
      .argument('<lead>', 'Hyperliquid 0x address or Strike account id')
      .option('--leverage <n>', 'leverage to test (default from manifest)')
      .option('--size <pct>', 'copy size percent, e.g. 5 or 5% (default from manifest)')
      .option('--isolated', 'test isolated margin (manifest default)')
      .option('--cross', 'test cross margin')
      .option('--market <symbol>', 'market used for the leverage cap (default: lead top asset)')
      .option('--force', 'exit 0 for HIGH_RISK as well as SAFE'),
  ).action(async (lead: string, options: RiskCliOptions) => {
    applyColor(options);
    const client = await createClient(options);

    const verdict = await client.riskCheck(lead, {
      leverage: options.leverage ? leverageOption(options.leverage) : undefined,
      sizePct: options.size ? sizeOption(options.size) : undefined,
      isolated: isolatedOption(options),
      market: options.market,
    });

    if (options.json) {
      printJson(verdict);
    } else {
      process.stdout.write(`\n${renderVerdict(verdict)}\n\n`);
      if (verdict.status === 'BLOCKED') {
        process.stdout.write(
          dim('Copy is refused. Review the suggested parameters, then re-run risk-check.\n'),
        );
      }
    }

    process.exitCode = exitCodeForVerdict(verdict, options.force);
  });
}
