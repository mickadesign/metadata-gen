// Shared plumbing for the evals: a throwaway project, a preview server, and
// two ways to call the same tools. "direct" calls the bound tool's execute
// (what WebMCP does in the page); "mcp" goes through the HTTP JSON-RPC
// endpoint (what a coding agent's client does).

import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewServer } from '../src/server.js';

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1d4ed8"/></svg>';

export async function makeEvalProject() {
  const root = await mkdtemp(join(tmpdir(), 'metadata-gen-eval-'));
  await writeFile(join(root, 'metadata.config.json'), JSON.stringify({
    title: 'Eval Project',
    tagline: 'A project used by the metadata-gen evals',
    colors: { background: '#0f0f0f', foreground: '#ffffff', accent: '#888888' },
    logo: null,
    faviconSrc: null,
    outputDir: 'public/metadata',
    font: 'Inter',
    url: 'https://eval.example',
  }, null, 2));
  await writeFile(join(root, 'logo.svg'), LOGO_SVG);
  await mkdir(join(root, 'public'), { recursive: true });
  return root;
}

export async function startEvalServer(options = {}) {
  const root = await makeEvalProject();
  const server = await createPreviewServer({ root, log: () => {}, ...options });
  const { url } = await server.listen(0);
  return {
    root,
    server,
    url,
    token: server.token,
    async close() {
      server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Parse a tool result into { ok, value, text }. */
export function parseResult(result) {
  const text = (result.content || []).map((c) => c.text || '').join('\n');
  if (result.isError) return { ok: false, value: null, text };
  let value = result.structuredContent;
  if (value === undefined) {
    try { value = JSON.parse(text); } catch { value = text; }
  }
  return { ok: true, value, text };
}

export function makeCallers(ctx) {
  let nextId = 1;
  const byName = new Map(ctx.server.tools.map((t) => [t.name, t]));
  return {
    direct: {
      name: 'direct',
      async call(name, args) {
        const tool = byName.get(name);
        if (!tool) throw new Error(`No tool ${name}`);
        return parseResult(await tool.execute(args || {}, {}));
      },
    },
    mcp: {
      name: 'mcp',
      async call(name, args) {
        const res = await fetch(`${ctx.url}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Metadata-Gen-Token': ctx.token },
          body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args || {} } }),
        });
        const body = await res.json();
        if (body.error) return { ok: false, value: null, text: body.error.message, rpcError: body.error };
        return parseResult(body.result);
      },
      async list() {
        const res = await fetch(`${ctx.url}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Metadata-Gen-Token': ctx.token },
          body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/list', params: {} }),
        });
        return (await res.json()).result.tools;
      },
    },
  };
}

/**
 * A fake preview page: subscribes to the event stream and answers consent
 * requests with the configured decision. Lets the evals exercise the
 * confirmation path without a browser.
 */
export async function openFakePage(ctx, { decision = 'allow' } = {}) {
  const controller = new AbortController();
  const res = await fetch(`${ctx.url}/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const seen = [];
  let buffer = '';
  const pump = (async () => {
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
          if (!ev || !data) continue;
          const payload = JSON.parse(data[1]);
          seen.push({ event: ev[1], data: payload });
          if (ev[1] === 'consent') {
            await fetch(`${ctx.url}/api/consent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Metadata-Gen-Token': ctx.token },
              body: JSON.stringify({ id: payload.id, allowed: decision === 'allow' }),
            });
          }
        }
      }
    } catch {
      // aborted
    }
  })();
  await new Promise((r) => setTimeout(r, 50));
  return { seen, close: () => { controller.abort(); return pump; } };
}

/** Poll until `predicate()` is truthy or the timeout passes. */
export async function waitFor(predicate, { timeoutMs = 1500, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return !!predicate();
}
