import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeProject } from './helpers.js';
import { readLockfile, writeLockfile, removeLockfile, lockfileIsLive, lockfilePath } from '../src/lockfile.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'bin', 'cli.js');

test('lockfile helpers round-trip and detect a dead server', async () => {
  const { root } = await makeProject();
  assert.equal(await readLockfile(root), null);
  await writeLockfile(root, { port: 1, url: 'http://127.0.0.1:1', token: 'x', pid: 0 });
  const info = await readLockfile(root);
  assert.equal(info.url, 'http://127.0.0.1:1');
  assert.equal(info.root, root);
  assert.ok(lockfilePath(root).endsWith('.json'));
  assert.equal(await lockfileIsLive(info), false);
  assert.equal(await lockfileIsLive(null), false);
  await removeLockfile(root);
  assert.equal(await readLockfile(root), null);
});

test('the stdio shim starts its own server when none runs, answers, and cleans up', async (t) => {
  const { root } = await makeProject();
  // The test runner marks its own children through NODE_TEST_CONTEXT and
  // NODE_OPTIONS; a real agent would not, so strip them for the shim.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^NODE_(TEST|OPTIONS)/.test(key)) delete env[key];
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { err += d.toString(); });

  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_project', arguments: {} } });

  const deadline = Date.now() + 20000;
  while (out.split('\n').filter(Boolean).length < 2 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const lines = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 2, `stdout: ${out}\nstderr: ${err}`);
  assert.equal(lines[0].result.serverInfo.name, 'metadata-gen');
  assert.deepEqual(lines[1].result.structuredContent.layouts, ['A', 'B', 'C']);
  assert.match(err, /starting one/);

  assert.ok(await readLockfile(root), 'lockfile written while running');
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 0);
  assert.equal(await readLockfile(root), null, 'lockfile removed on exit');
});

test('lockfileIsLive rejects a server that belongs to another project', async () => {
  const { createPreviewServer } = await import('../src/server.js');
  const { root } = await makeProject();
  const other = await makeProject();
  const server = await createPreviewServer({ root, log: () => {} });
  const { url } = await server.listen(0);
  try {
    assert.equal(await lockfileIsLive({ url, token: server.token, root }), true);
    assert.equal(await lockfileIsLive({ url, token: server.token, root: other.root }), false, 'different project');
    assert.equal(await lockfileIsLive({ url, token: 'wrong', root }), false, 'wrong token');
  } finally {
    server.close();
  }
});
