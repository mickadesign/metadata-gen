import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wireMcpJson, wireAgentInstructions, AGENT_INSTRUCTIONS_MARKER } from '../src/init.js';

async function tmp() {
  return mkdtemp(join(tmpdir(), 'metadata-gen-init-'));
}

test('wireMcpJson creates .mcp.json and then skips', async () => {
  const root = await tmp();
  const first = await wireMcpJson(root);
  assert.equal(first.status, 'created');
  const data = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf-8'));
  assert.deepEqual(data.mcpServers['metadata-gen'], { command: 'npx', args: ['metadata-gen', 'mcp'] });
  const second = await wireMcpJson(root);
  assert.equal(second.status, 'skipped');
});

test('wireMcpJson keeps other servers in an existing file', async () => {
  const root = await tmp();
  await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  const r = await wireMcpJson(root);
  assert.equal(r.status, 'updated');
  const data = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf-8'));
  assert.deepEqual(Object.keys(data.mcpServers).sort(), ['metadata-gen', 'other']);
});

test('wireMcpJson refuses to clobber invalid JSON', async () => {
  const root = await tmp();
  await writeFile(join(root, '.mcp.json'), '{ not json');
  await assert.rejects(() => wireMcpJson(root), /not valid JSON/);
});

test('wireAgentInstructions creates AGENTS.md when neither file exists, once', async () => {
  const root = await tmp();
  const first = await wireAgentInstructions(root);
  assert.equal(first.status, 'created');
  const content = await readFile(join(root, 'AGENTS.md'), 'utf-8');
  assert.ok(content.includes(AGENT_INSTRUCTIONS_MARKER));
  assert.match(content, /Do not drive/);
  const second = await wireAgentInstructions(root);
  assert.equal(second.status, 'skipped');
  assert.equal((await readFile(join(root, 'AGENTS.md'), 'utf-8')).split(AGENT_INSTRUCTIONS_MARKER).length, 2);
});

test('wireAgentInstructions appends to an existing CLAUDE.md', async () => {
  const root = await tmp();
  await writeFile(join(root, 'CLAUDE.md'), '# Project notes');
  const r = await wireAgentInstructions(root);
  assert.equal(r.status, 'updated');
  assert.equal(r.path, join(root, 'CLAUDE.md'));
  const content = await readFile(join(root, 'CLAUDE.md'), 'utf-8');
  assert.ok(content.startsWith('# Project notes\n'));
  assert.ok(content.includes('## metadata-gen'));
});
