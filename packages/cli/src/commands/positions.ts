import { Command } from 'commander';
import { createClient, integerOption, printJson, type CommonOptions } from '../context.js';
import { bold, dim, renderPositions } from '../format.js';
import { applyColor, withCommonOptions } from '../options.js';

interface PositionsCliOptions extends CommonOptions {
  watch?: boolean;
  interval?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerPositions(program: Command): void {
  withCommonOptions(
    program
      .command('positions')
      .description('Show open positions with mark, liquidation price and liquidation distance.')
      .option('--watch', 'poll and redraw until Ctrl+C')
      .option('--interval <seconds>', 'watch interval in seconds', '5'),
  ).action(async (options: PositionsCliOptions) => {
    applyColor(options);
    const client = await createClient(options);

    if (!options.watch) {
      const positions = await client.positions();
      if (options.json) {
        printJson({ count: positions.length, positions });
      } else {
        process.stdout.write(`${bold('Open positions')}\n\n${renderPositions(positions)}\n`);
      }
      return;
    }

    const interval = integerOption(options.interval ?? '5', '--interval', 1, 3600) * 1000;
    let running = true;
    process.once('SIGINT', () => {
      running = false;
    });

    while (running) {
      try {
        const positions = await client.positions();
        if (options.json) {
          printJson({ ts: new Date().toISOString(), count: positions.length, positions });
        } else {
          process.stdout.write('\x1b[2J\x1b[H');
          const close = positions.filter(
            (position) =>
              position.liquidationDistancePct !== null && position.liquidationDistancePct < 10,
          );
          process.stdout.write(
            `${bold('Hexis positions')}  ${dim(new Date().toISOString())}  ${dim(
              `(every ${interval / 1000}s, Ctrl+C to stop)`,
            )}\n\n${renderPositions(positions)}\n`,
          );
          if (close.length) {
            process.stdout.write(
              `\n${bold('Liquidation watch:')} ${close
                .map(
                  (position) =>
                    `${position.symbol} ${position.liquidationDistancePct!.toFixed(1)}% from liquidation`,
                )
                .join('  |  ')}\n`,
            );
          }
        }
      } catch (error) {
        process.stderr.write(`poll failed: ${(error as Error).message}\n`);
      }
      if (running) await sleep(interval);
    }
  });
}
