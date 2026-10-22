// Agent skill walkthrough: expose the MCP manifest, then run the read-only loop.
import { HexisClient, MCP_MANIFEST } from '@hexis/core';

const hexis = new HexisClient();
const leads = await hexis.discover({ platform: 'hyperliquid', limit: 1 });
if (!leads.length) throw new Error('Discovery returned no leads.');

const lead = leads[0]!;
const verdict = await hexis.riskCheck(lead.address, { leverage: 8, sizePct: 5, isolated: true });

console.log(JSON.stringify({ tools: MCP_MANIFEST.tools.map((tool) => tool.name) }, null, 2));
console.log(JSON.stringify({ lead: lead.address, verdict }, null, 2));
console.log(
  verdict.status === 'SAFE'
    ? 'Next: hexis_copy (requires a key) -- never force autonomously.'
    : `Stop: ${verdict.code}. Inspect suggested parameters before retrying.`,
);
