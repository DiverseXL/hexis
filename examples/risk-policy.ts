// Custom risk policy: hold every market to 5x and require 8% liquidation distance.
import { HexisClient, HARDCODED_MANIFEST, type Manifest } from '@hexis/core';

const manifest: Manifest = {
  ...structuredClone(HARDCODED_MANIFEST),
  caps: {
    maxLeverage: 5,
    minLiquidationDistancePct: 8,
    maxLeadDrawdown30dPct: 20,
  },
};

const hexis = new HexisClient({ manifest });
const lead = process.argv[2] ?? (await hexis.discover({ limit: 1 }))[0]?.address;
if (!lead) throw new Error('No lead found.');

for (const leverage of [8, 5, 3]) {
  const verdict = await hexis.riskCheck(lead, { leverage, sizePct: 5, isolated: true });
  console.log(`${leverage}x -> ${verdict.status} ${verdict.code}`);
  if (verdict.suggested) console.log('  suggested:', verdict.suggested);
}
