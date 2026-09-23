// Minimal MCP server over Streamable HTTP, plus a stdio shim that proxies to
// it. JSON-RPC 2.0 request/response only: no server-initiated streams, no
// sessions. Enough for tools/list and tools/call from Claude Code, Cursor,
// Claude Desktop and the like without pulling in the SDK's dependency tree.

import { describeTool } from './agent-tools.js';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const MCP_INSTRUCTIONS = [
  'metadata-gen renders OG images and favicons for the project and shows them in a local preview page.',
  'Use these tools to inspect, change and save them. They update the page the user is looking at and',
  'return preview URLs, so there is no need to drive the page with a browser, screenshots or clicks.',
  'Start with get_project. Write tools ask the user for confirmation in the page.',
].join(' ');

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Build a message handler. `tools` are bound tools from bindTools().
 * Returns { handleMessage, express } where express is a request handler.
 */
export function createMcpServer({ tools, name = 'metadata-gen', version = '0.0.0', instructions = MCP_INSTRUCTIONS }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function handleMessage(msg, context = {}) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg && msg.id, -32600, 'Invalid Request');
    }
    const { id, method, params = {} } = msg;
    const isNotification = id === undefined;

    if (isNotification) {
      // notifications/initialized, notifications/cancelled, etc. Nothing to do.
      return null;
    }

    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          instructions,
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: tools.map(describeTool) });
      case 'tools/call': {
        const tool = byName.get(params.name);
        if (!tool) {
          return rpcError(id, -32602, `Unknown tool: ${params.name}. Call tools/list for the available names.`);
        }
        const result = await tool.execute(params.arguments || {}, { signal: context.signal });
        return rpcResult(id, result);
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  async function express(req, res) {
    if (req.method === 'GET') {
      // No server-to-client stream; clients fall back to plain request/response.
      res.status(405).set('Allow', 'POST, DELETE').json(rpcError(null, -32000, 'Server-initiated streams are not supported'));
      return;
    }
    if (req.method === 'DELETE') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST, DELETE').end();
      return;
    }
    const body = req.body;
    const controller = new AbortController();
    // `close` on the response fires both when the client goes away and when
    // the response finishes; only the former is a cancellation.
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      if (Array.isArray(body)) {
        const responses = (await Promise.all(body.map((m) => handleMessage(m, { signal: controller.signal })))).filter(Boolean);
        if (responses.length === 0) return res.status(202).end();
        return res.json(responses);
      }
      const response = await handleMessage(body, { signal: controller.signal });
      if (response === null) return res.status(202).end();
      return res.json(response);
    } catch (err) {
      return res.status(500).json(rpcError(body && body.id, -32603, err.message || 'Internal error'));
    }
  }

  return { handleMessage, express };
}

/**
 * stdio <-> HTTP proxy. Reads newline-delimited JSON-RPC from `input`, POSTs
 * each message to `${url}/mcp` with the session token, writes responses to
 * `output`. Notifications get no output. Resolves when input ends.
 */
export async function proxyStdio({ url, token, input = process.stdin, output = process.stdout, log = () => {} }) {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input, crlfDelay: Infinity });
  const endpoint = `${url.replace(/\/$/, '')}/mcp`;
  const inflight = new Set();

  async function forward(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      output.write(JSON.stringify(rpcError(null, -32700, 'Parse error')) + '\n');
      return;
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-Metadata-Gen-Token': token,
        },
        body: trimmed,
      });
      if (res.status === 202) return;
      const text = await res.text();
      if (!text) return;
      // Server answers JSON; write it through untouched.
      output.write(text.trim() + '\n');
    } catch (err) {
      log(`metadata-gen mcp: request failed: ${err.message}`);
      const id = msg && msg.id;
      if (id !== undefined) {
        output.write(JSON.stringify(rpcError(id, -32001, `Preview server unreachable: ${err.message}`)) + '\n');
      }
    }
  }

  for await (const line of rl) {
    const p = forward(line).finally(() => inflight.delete(p));
    inflight.add(p);
  }
  await Promise.all(inflight);
}
