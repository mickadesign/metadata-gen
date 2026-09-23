import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createPreviewServer, sanitizeOgOverrides, sanitizeFaviconOptions } from '../src/server.js';
import { makeProject, jsonHeaders } from './helpers.js';

let project;
let server;
let url;
let token;

before(async () => {
  project = await makeProject();
  server = await createPreviewServer({ root: project.root, log: () => {} });
  ({ url } = await server.listen(0));
  token = server.token;
});

after(() => server.close());

test('binds to loopback only', () => {
  assert.equal(server.httpServer.address().address, '127.0.0.1');
});

test('mutations without the token are refused', async () => {
  const res = await fetch(`${url}/api/render`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: 'A', overrides: {} }),
  });
  assert.equal(res.status, 401);
});

test('mutations from a foreign origin are refused even with the token', async () => {
  const res = await fetch(`${url}/api/render`, {
    method: 'POST', headers: jsonHeaders(token, { Origin: 'http://evil.example' }), body: JSON.stringify({ layout: 'A', overrides: {} }),
  });
  assert.equal(res.status, 403);
});

test('cross-site fetch metadata is refused', async () => {
  const res = await fetch(`${url}/api/render`, {
    method: 'POST', headers: jsonHeaders(token, { 'Sec-Fetch-Site': 'cross-site' }), body: JSON.stringify({ layout: 'A', overrides: {} }),
  });
  assert.equal(res.status, 403);
});

test('same-origin mutation with the token succeeds and bumps the revision', async () => {
  const before = server.state.og.A.revision;
  const res = await fetch(`${url}/api/render`, {
    method: 'POST', headers: jsonHeaders(token, { Origin: url }), body: JSON.stringify({ layout: 'A', overrides: { headline: 'Hello' } }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.revision, before + 1);
  assert.equal(data.overrides.headline, 'Hello');
  assert.match(data.url, /\/preview\/og\/a\.png\?rev=/);
  assert.equal(data.ignored.length, 0);
});

test('unknown and out-of-range override keys are reported, not applied', async () => {
  const res = await fetch(`${url}/api/render`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ layout: 'A', overrides: { headingSize: 999, bogus: 1, align: 'middle' } }),
  });
  const data = await res.json();
  const keys = data.ignored.map((i) => i.key).sort();
  assert.deepEqual(keys, ['align', 'bogus', 'headingSize']);
  assert.equal('headingSize' in data.overrides, false);
});

test('unknown layout gives a descriptive 400', async () => {
  const res = await fetch(`${url}/api/render`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ layout: 'Z', overrides: {} }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Available layouts: A, B, C/);
});

test('preview route serves the cached PNG with its revision', async () => {
  const res = await fetch(`${url}/preview/og/a.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-revision'), String(server.state.og.A.revision));
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
});

test('a stale revision cannot be saved; the current one writes the cached image', async () => {
  const current = server.state.og.A.revision;
  const stale = await fetch(`${url}/api/download/og`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ layout: 'A', revision: current - 1 }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentRevision, current);

  const ok = await fetch(`${url}/api/download/og`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ layout: 'A', revision: current }),
  });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.path, 'public/metadata/og.png');
  const onDisk = await readFile(join(project.root, 'public/metadata/og.png'));
  assert.ok(onDisk.equals(server.state.og.A.png));
});

test('the latest of two overlapping renders wins the cache', async () => {
  const a = server.state.renderOg('B', { headline: 'first' });
  const b = server.state.renderOg('B', { headline: 'second' });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.stale, true);
  assert.equal(rb.stale, false);
  assert.equal(server.state.og.B.overrides.headline, 'second');
});

test('favicon options change bumps the revision and partial renders merge', async () => {
  const before = server.state.favicon.revision;
  const first = await fetch(`${url}/api/render-favicon`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ letter: 'Q', modes: ['light'], sizes: [32] }),
  });
  const d1 = await first.json();
  assert.equal(d1.revision, before + 1);
  assert.ok(d1.light[32].startsWith('data:image/png;base64,'));
  assert.equal(d1.dark, undefined);
  assert.deepEqual(Object.keys(server.state.favicon.buffers), ['light']);

  const second = await fetch(`${url}/api/render-favicon`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ letter: 'Q', modes: ['dark'], sizes: [16] }),
  });
  const d2 = await second.json();
  assert.equal(d2.revision, before + 1, 'same options keep the revision');
  assert.ok(server.state.favicon.buffers.light[32], 'earlier partial render kept');
  assert.ok(server.state.favicon.buffers.dark[16], 'new partial render merged');
});

test('favicon preview route renders missing combinations on demand', async () => {
  const res = await fetch(`${url}/preview/favicon/dark/96.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bad = await fetch(`${url}/preview/favicon/sepia/96.png`);
  assert.equal(bad.status, 400);
});

test('a stale favicon revision cannot be saved', async () => {
  const res = await fetch(`${url}/api/download/favicons`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ revision: server.state.favicon.revision - 1 }),
  });
  assert.equal(res.status, 409);
});

test('saving favicons writes the set from the current options', async () => {
  const res = await fetch(`${url}/api/download/favicons`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ revision: server.state.favicon.revision }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.count, 9);
  await stat(join(project.root, 'public/metadata/favicon.ico'));
});

test('save-config writes the file and updates social state', async () => {
  const res = await fetch(`${url}/api/save-config`, {
    method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ title: 'Renamed', url: 'https://renamed.example' }),
  });
  assert.equal(res.status, 200);
  const saved = JSON.parse(await readFile(join(project.root, 'metadata.config.json'), 'utf-8'));
  assert.equal(saved.title, 'Renamed');
  assert.equal(server.state.social.title, 'Renamed');
  assert.equal(server.state.social.url, 'https://renamed.example');
});

test('state snapshot has what get_project promises', async () => {
  const snap = await (await fetch(`${url}/api/state`)).json();
  assert.deepEqual(snap.layouts, ['A', 'B', 'C']);
  assert.equal(snap.previewUrl, url);
  assert.equal(typeof snap.og.A.revision, 'number');
  assert.match(snap.og.A.previewUrl, /preview\/og\/a\.png/);
  assert.match(snap.favicon.previewUrls.light[32], /preview\/favicon\/light\/32\.png/);
  assert.match(snap.agent.addCommand, /claude mcp add/);
  assert.equal(snap.agent.pageOpen, false);
});

test('the served page carries the boot data with the token', async () => {
  const html = await (await fetch(`${url}/`)).text();
  assert.match(html, /id="metadata-gen-boot"/);
  assert.ok(html.includes(token));
  assert.equal(html.includes('__METADATA_GEN_BOOT__'), false);
});

test('agent-tools.js is served as a module', async () => {
  const res = await fetch(`${url}/agent-tools.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /export function bindTools/);
});

test('sanitizers accept 3-digit hex and reject non-colors', () => {
  const ctx = { fontPaths: new Set(), logoCandidates: [] };
  assert.equal(sanitizeOgOverrides({ background: '#abc' }, ctx).safe.background, '#abc');
  assert.equal(sanitizeOgOverrides({ background: 'red' }, ctx).ignored[0].key, 'background');
  assert.equal(sanitizeFaviconOptions({ fontWeight: 500 }, ctx).ignored[0].key, 'fontWeight');
  assert.equal(sanitizeFaviconOptions({ faviconSrc: null }, ctx).safe.faviconSrc, null);
  assert.equal(sanitizeOgOverrides({ textWidth: 900 }, ctx).safe.textWidth, 900);
  assert.equal(sanitizeOgOverrides({ textWidth: 100 }, ctx).ignored[0].key, 'textWidth');
});
