import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { MCP_MANIFEST } from '../src/mcp.js';

test('the exported MCP manifest matches hexis.mcp.json', async () => {
  const text = await readFile(new URL('../../../hexis.mcp.json', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(MCP_MANIFEST)));
});

test('every MCP tool has a name, description, and input schema', () => {
  for (const tool of MCP_MANIFEST.tools) {
    assert.ok(tool.name.startsWith('hexis_'));
    assert.ok(tool.description.length > 20);
    assert.equal((tool.input as { type?: string }).type, 'object');
  }
});
