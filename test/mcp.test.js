import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createPreviewServer } from '../src/server.js';
import { proxyStdio } from '../src/mcp.js';
import { TOOL_DEFINITIONS } from '../src/agent-tools.js';
import { makeProject, jsonHeaders } from './helpers.js';

let server;
let url;
let token;
let nextId = 1;

async function rpc(method, params, headers = {}) {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: jsonHeaders(token, headers),
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}

before(async () => {
  const project = await makeProject();
  server = await createPreviewServer({ root: project.root, log: () => {} });
  ({ url } = await server.listen(0));
  token = server.token;
});

after(() => server.close());

test('initialize negotiates a protocol version and advertises tools', async () => {
  const { status, body } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(status, 200);
  assert.equal(body.result.protocolVersion, '2025-06-18');
  assert.equal(body.result.serverInfo.name, 'metadata-gen');
  assert.ok(body.result.capabilities.tools);
  assert.match(body.result.instructions, /no need to drive the page/);
});

test('notifications are accepted with 202 and no body', async () => {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(res.status, 202);
});

test('tools/list matches the shared definitions exactly', async () => {
  const { body } = await rpc('tools/list', {});
  const names = body.result.tools.map((t) => t.name);
  assert.deepEqual(names, TOOL_DEFINITIONS.map((t) => t.name));
  for (const t of body.result.tools) {
    assert.deepEqual(Object.keys(t).sort(), ['annotations', 'description', 'inputSchema', 'name']);
  }
});

test('tools/call get_project returns the snapshot as structured content', async () => {
  const { body } = await rpc('tools/call', { name: 'get_project', arguments: {} });
  assert.equal(body.result.isError, undefined);
  assert.deepEqual(body.result.structuredContent.layouts, ['A', 'B', 'C']);
});

test('tools/call set_og_overrides merges, renders and reports ignored keys', async () => {
  const first = await rpc('tools/call', { name: 'set_og_overrides', arguments: { layout: 'A', overrides: { headline: 'From MCP', headingSize: 80 } } });
  const r1 = first.body.result.structuredContent;
  assert.equal(r1.overrides.headline, 'From MCP');
  const second = await rpc('tools/call', { name: 'set_og_overrides', arguments: { layout: 'A', overrides: { headingSize: null, align: 'sideways' } } });
  const r2 = second.body.result.structuredContent;
  assert.equal(r2.overrides.headline, 'From MCP', 'merge keeps earlier keys');
  assert.equal('headingSize' in r2.overrides, false, 'null removes a key');
  assert.equal(r2.ignored[0].key, 'align');
  assert.equal(r2.revision, r1.revision + 1);
});

test('tools/call with an unknown layout is a tool error, not a transport error', async () => {
  const { body } = await rpc('tools/call', { name: 'get_og_preview', arguments: { layout: 'Q' } });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /Available layouts/);
});

test('unknown tool and unknown method are JSON-RPC errors', async () => {
  const a = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal(a.body.error.code, -32602);
  const b = await rpc('bogus/method', {});
  assert.equal(b.body.error.code, -32601);
});

test('write tools run without a page open and refuse a stale revision', async () => {
  const preview = await rpc('tools/call', { name: 'get_og_preview', arguments: { layout: 'A' } });
  const rev = preview.body.result.structuredContent.revision;
  const stale = await rpc('tools/call', { name: 'save_og_image', arguments: { layout: 'A', revision: rev - 1 } });
  assert.equal(stale.body.result.isError, true);
  assert.match(stale.body.result.content[0].text, /stale/);
  const ok = await rpc('tools/call', { name: 'save_og_image', arguments: { layout: 'A', revision: rev } });
  assert.equal(ok.body.result.structuredContent.path, 'public/metadata/og.png');
});

test('write tools wait for the page when one is connected, and honor a denial', async () => {
  const controller = new AbortController();
  const es = await fetch(`${url}/events`, { signal: controller.signal });
  const reader = es.body.getReader();
  const decoder = new TextDecoder();
  // Let the server register the client before the tool call.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(server.state.sseClientCount(), 1);

  const call = rpc('tools/call', { name: 'save_favicon_set', arguments: { revision: server.state.favicon.revision } });
  let text = '';
  let consentId = null;
  while (!consentId) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
    const m = text.match(/event: consent\ndata: (.*)\n/);
    if (m) consentId = JSON.parse(m[1]).id;
  }
  assert.ok(consentId);
  const answer = await fetch(`${url}/api/consent`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ id: consentId, allowed: false }),
  });
  assert.equal((await answer.json()).ok, true);
  const { body } = await call;
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /declined/);
  controller.abort();
});

test('the mcp endpoint needs the token and rejects foreign origins', async () => {
  const noToken = await fetch(`${url}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(noToken.status, 401);
  const foreign = await fetch(`${url}/mcp`, {
    method: 'POST', headers: jsonHeaders(token, { Origin: 'http://evil.example' }), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(foreign.status, 403);
  const get = await fetch(`${url}/mcp`);
  assert.equal(get.status, 405);
});

test('the stdio proxy forwards requests and swallows notifications', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (chunk) => { out += chunk.toString(); });
  const done = proxyStdio({ url, token, input, output });
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 'x1', method: 'ping' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 'x2', method: 'tools/list' }) + '\n');
  input.end();
  await done;
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.deepEqual(byId.x1.result, {});
  assert.equal(byId.x2.result.tools.length, TOOL_DEFINITIONS.length);
});
