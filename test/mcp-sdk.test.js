// Interoperability: connect with the official MCP SDK client over both
// transports a real agent would use, instead of hand-rolled JSON-RPC.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPreviewServer } from '../src/server.js';
import { TOOL_DEFINITIONS } from '../src/agent-tools.js';
import { makeProject } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'bin', 'cli.js');

let server;
let url;

before(async () => {
  const { root } = await makeProject();
  server = await createPreviewServer({ root, log: () => {} });
  ({ url } = await server.listen(0));
});

after(() => server.close());

async function exercise(client) {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOL_DEFINITIONS.map((t) => t.name));

  const project = await client.callTool({ name: 'get_project', arguments: {} });
  assert.equal(project.isError, undefined);
  assert.deepEqual(project.structuredContent.layouts, ['A', 'B', 'C']);

  const set = await client.callTool({ name: 'set_og_overrides', arguments: { layout: 'A', overrides: { headline: 'Via SDK', headingSize: null } } });
  assert.equal(set.isError, undefined, JSON.stringify(set.content));
  assert.equal(set.structuredContent.overrides.headline, 'Via SDK');

  const missing = await client.callTool({ name: 'save_og_image', arguments: { layout: 'A' } });
  assert.equal(missing.isError, true, 'a save without a revision must be refused');
  assert.match(missing.content[0].text, /revision is required/);

  const saved = await client.callTool({ name: 'save_og_image', arguments: { layout: 'A', revision: set.structuredContent.revision } });
  assert.equal(saved.isError, undefined, JSON.stringify(saved.content));
  assert.equal(saved.structuredContent.path, 'public/metadata/og.png');
}

test('the official SDK client works over Streamable HTTP with the session token', async () => {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { 'X-Metadata-Gen-Token': server.token } },
  });
  const client = new Client({ name: 'sdk-test', version: '0' });
  await client.connect(transport);
  try {
    const info = client.getServerVersion();
    assert.equal(info.name, 'metadata-gen');
    assert.match(client.getInstructions() || '', /no need to drive the page/);
    await exercise(client);
  } finally {
    await client.close();
  }
});

test('the official SDK client works over stdio through `metadata-gen mcp`', async (t) => {
  const { root } = await makeProject();
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], cwd: root, stderr: 'pipe' });
  const client = new Client({ name: 'sdk-stdio-test', version: '0' });
  t.after(() => client.close().catch(() => {}));
  await client.connect(transport);
  await exercise(client);
  await client.close();
});
