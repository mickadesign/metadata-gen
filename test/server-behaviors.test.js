import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPreviewServer } from '../src/server.js';
import { makeProject, jsonHeaders } from './helpers.js';

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#f00"/></svg>';

let project;
let server;
let url;
let token;

async function post(path, body, headers = {}) {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers: jsonHeaders(token, headers), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

/** Open an event stream and collect parsed events until closed. */
async function openEvents() {
  const controller = new AbortController();
  const res = await fetch(`${url}/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = chunk.match(/^event: (.*)$/m);
          const data = chunk.match(/^data: (.*)$/m);
          if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
        }
      }
    } catch {
      // aborted
    }
  })();
  await new Promise((r) => setTimeout(r, 50));
  return { events, close: () => controller.abort() };
}

before(async () => {
  project = await makeProject();
  await writeFile(join(project.root, 'logo.svg'), LOGO_SVG);
  server = await createPreviewServer({ root: project.root, log: () => {}, consentTimeoutMs: 300 });
  ({ url } = await server.listen(0));
  token = server.token;
});

after(() => server.close());

test('the project logo is a candidate for OG and favicon', async () => {
  const snap = await (await fetch(`${url}/api/state`)).json();
  assert.ok(snap.logoCandidates.includes('./logo.svg'));
});

test('merge renders fold into current overrides and null removes a key', async () => {
  const first = await post('/api/render', { layout: 'A', overrides: { headline: 'Kept', headingSize: 70 } });
  assert.equal(first.status, 200);
  const second = await post('/api/render', { layout: 'A', overrides: { headingSize: null, accent: '#00ff00' }, merge: true });
  assert.equal(second.body.overrides.headline, 'Kept');
  assert.equal('headingSize' in second.body.overrides, false);
  assert.equal(second.body.overrides.accent, '#00ff00');
  const replace = await post('/api/render', { layout: 'A', overrides: { tagline: 'Only' } });
  assert.deepEqual(replace.body.overrides, { tagline: 'Only' });
});

test('faviconSrc null selects the lettermark even when merged', async () => {
  const logo = await post('/api/render-favicon', { faviconSrc: './logo.svg', modes: ['light'], sizes: [32] });
  assert.equal(logo.body.options.faviconSrc, './logo.svg');
  const merged = await post('/api/render-favicon', { faviconSrc: null, letter: 'Z', merge: true, modes: ['light'], sizes: [32] });
  assert.equal(merged.body.options.faviconSrc, null, 'null survived the merge');
  assert.equal(merged.body.options.letter, 'Z');
  assert.equal(server.state.favicon.config.faviconSrc, null);
});

test('favicon custom mode without a custom background is a descriptive error', async () => {
  const res = await fetch(`${url}/preview/favicon/custom/32.png`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /customBg/);
  const set = await post('/api/render-favicon', { customBg: '#123456', merge: true, modes: ['custom'], sizes: [32] });
  assert.ok(set.body.custom[32]);
  assert.equal((await fetch(`${url}/preview/favicon/custom/32.png`)).status, 200);
});

test('select and social routes update state and broadcast', async () => {
  const stream = await openEvents();
  const bad = await post('/api/select', { layout: 'Q' });
  assert.equal(bad.status, 400);
  const ok = await post('/api/select', { layout: 'C' });
  assert.equal(ok.body.selectedLayout, 'C');
  const social = await post('/api/social', { title: 'Streamed title' });
  assert.equal(social.body.title, 'Streamed title');
  await new Promise((r) => setTimeout(r, 50));
  const kinds = stream.events.map((e) => e.event);
  assert.ok(kinds.includes('select'));
  assert.ok(kinds.includes('social'));
  const snap = await (await fetch(`${url}/api/state`)).json();
  assert.equal(snap.selectedLayout, 'C');
  assert.equal(snap.social.title, 'Streamed title');
  assert.equal(snap.agent.pageOpen, true);
  stream.close();
});

test('render events carry the client id so a page can skip its own echo', async () => {
  const stream = await openEvents();
  await post('/api/render', { layout: 'B', overrides: { headline: 'Echo' } }, { 'X-Metadata-Gen-Client': 'tab-1' });
  await new Promise((r) => setTimeout(r, 50));
  const og = stream.events.find((e) => e.event === 'og');
  assert.ok(og);
  assert.equal(og.data.client, 'tab-1');
  assert.equal(og.data.layout, 'B');
  assert.match(og.data.url, /preview\/og\/b\.png\?rev=\d+/);
  assert.equal(og.data.overrides.headline, 'Echo');
  stream.close();
});

test('an unanswered consent times out and writes nothing', async () => {
  const stream = await openEvents();
  const before = await readFile(join(project.root, 'metadata.config.json'), 'utf-8');
  const tool = server.tools.find((t) => t.name === 'save_config');
  const result = await tool.execute({ title: 'Should not land' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /did not answer/);
  assert.equal(await readFile(join(project.root, 'metadata.config.json'), 'utf-8'), before);
  assert.ok(stream.events.some((e) => e.event === 'consent' && e.data.tool === 'save_config'));
  stream.close();
});

test('answering a consent twice is harmless', async () => {
  const res = await post('/api/consent', { id: 'nope', allowed: true });
  assert.equal(res.body.ok, false);
});

test('upload-logo validates input and adds the file to candidates', async () => {
  const bad = await post('/api/upload-logo', { filename: 'x.exe', dataBase64: 'AAAA' });
  assert.equal(bad.status, 400);
  const ok = await post('/api/upload-logo', { filename: 'mark.svg', dataBase64: Buffer.from(LOGO_SVG).toString('base64') });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.candidates.includes('./public/metadata/mark.svg'));
  const snap = await (await fetch(`${url}/api/state`)).json();
  assert.ok(snap.logoCandidates.includes('./public/metadata/mark.svg'));
});

test('server tools set_social_text re-renders every layout and reset keeps the base copy', async () => {
  const setSocial = server.tools.find((t) => t.name === 'set_social_text');
  const r = await setSocial.execute({ title: 'Tool title', tagline: 'Tool tagline' });
  const revs = Object.values(r.structuredContent.og).map((o) => o.revision);
  assert.equal(revs.length, 3);
  const snap = server.state.snapshot();
  assert.equal(snap.og.A.defaultCopy.headline, 'Tool title');
  const reset = server.tools.find((t) => t.name === 'reset_og_overrides');
  const rr = await reset.execute({ layout: 'A' });
  assert.deepEqual(Object.keys(rr.structuredContent.overrides).sort(), ['baseTagline', 'baseTitle']);
  assert.equal(rr.structuredContent.copy.headline, 'Tool title');
});

test('saves without a revision are refused on both routes and both tools', async () => {
  const og = await post('/api/download/og', { layout: 'A' });
  assert.equal(og.status, 400);
  assert.match(og.body.error, /revision is required/);
  const fav = await post('/api/download/favicons', {});
  assert.equal(fav.status, 400);
  const tool = server.tools.find((t) => t.name === 'save_favicon_set');
  const r = await tool.execute({});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /get_favicon_preview or set_favicon_options/);
});

test('health requires the token and names the project root', async () => {
  const anon = await fetch(`${url}/api/health`);
  assert.equal(anon.status, 401);
  const res = await fetch(`${url}/api/health`, { headers: { 'X-Metadata-Gen-Token': token } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).root, project.root);
});

test('the advertised URL uses the loopback address the server binds', async () => {
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const snap = await (await fetch(`${url}/api/state`)).json();
  assert.ok(snap.og.A.previewUrl.startsWith('http://127.0.0.1:'));
  assert.ok(snap.agent.mcpUrl.startsWith('http://127.0.0.1:'));
});

test('an on-demand favicon render reports the revision its bytes belong to', async () => {
  await post('/api/render-favicon', { letter: 'R', modes: ['light'], sizes: [16] });
  const { buffer, revision } = await server.state.ensureFaviconBuffer('dark', 180);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(revision, server.state.favicon.revision);
  const res = await fetch(`${url}/preview/favicon/dark/180.png`);
  assert.equal(res.headers.get('x-revision'), String(revision));
});
