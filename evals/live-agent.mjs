#!/usr/bin/env node
// Live eval: a real model drives the tools over the MCP endpoint, exactly as
// a coding agent would, and deterministic graders check the outcome on the
// server and on disk. Needs Anthropic credentials (ANTHROPIC_API_KEY or an
// `ant auth login` profile). Costs real money; each task is one short
// agentic run.
//
//   npm run eval:live                # all tasks
//   npm run eval:live -- --model claude-opus-5 --only tweak-and-save

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { MCP_INSTRUCTIONS } from '../src/mcp.js';
import { startEvalServer, makeCallers } from './harness.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const MODEL = arg('--model', 'claude-opus-5');
const ONLY = arg('--only', null);

// Each task: the user's request as they would type it, and a grader that
// inspects server state and files. `maxCalls` is a soft budget reported as a
// warning; `forbidden` lists tools a good run never needs.
const TASKS = [
  {
    id: 'tweak-and-save',
    prompt: 'Make layout B\'s headline read "Hello from the eval", set its headline size to 72px, and save it as og.png.',
    maxCalls: 4,
    async grade({ ctx }) {
      const ov = ctx.server.state.og.B.overrides;
      const file = await readFile(join(ctx.root, 'public/metadata/og.png')).catch(() => null);
      return [
        ['headline set', ov.headline === 'Hello from the eval'],
        ['size set', ov.headingSize === 72],
        ['og.png written', !!file],
        ['written bytes match preview', !!file && file.equals(ctx.server.state.og.B.png)],
      ];
    },
  },
  {
    id: 'favicon-from-logo',
    prompt: 'Switch the favicon to use the project logo instead of a lettermark and save the favicon set.',
    maxCalls: 4,
    async grade({ ctx }) {
      const ok = await stat(join(ctx.root, 'public/metadata/favicon.ico')).then(() => true).catch(() => false);
      return [
        ['logo selected', ctx.server.state.favicon.options.faviconSrc === './logo.svg'],
        ['favicon set written', ok],
      ];
    },
  },
  {
    id: 'recover-from-range',
    prompt: 'Set layout A\'s headline size to 500px. If that is not possible, use the largest size the tool allows and tell me what you did.',
    maxCalls: 3,
    async grade({ ctx, finalText }) {
      return [
        ['largest allowed size applied', ctx.server.state.og.A.overrides.headingSize === 120],
        ['explained the limit', /120/.test(finalText)],
      ];
    },
  },
  {
    id: 'rename-and-persist',
    prompt: 'Rename the site to "Eval Renamed" everywhere the preview uses the title, and persist it to the config file.',
    maxCalls: 3,
    async grade({ ctx }) {
      const cfg = JSON.parse(await readFile(join(ctx.root, 'metadata.config.json'), 'utf-8'));
      return [
        ['social title updated', ctx.server.state.social.title === 'Eval Renamed'],
        ['config written', cfg.title === 'Eval Renamed'],
      ];
    },
  },
];

async function runTask(client, task) {
  const ctx = await startEvalServer();
  const callers = makeCallers(ctx);
  const calls = [];
  try {
    // Tool definitions come from the live tools/list so the model sees the
    // same descriptions a real MCP client would.
    const listed = await callers.mcp.list();
    const tools = listed.map((t) => betaTool({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      run: async (input) => {
        const r = await callers.mcp.call(t.name, input);
        calls.push({ name: t.name, input, ok: r.ok });
        return r.ok ? JSON.stringify(r.value) : `Error: ${r.text}`;
      },
    }));

    const started = performance.now();
    const finalMessage = await client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      max_iterations: 12,
      system: `${MCP_INSTRUCTIONS}\n\nYou are working inside an automated evaluation. Complete the request with the tools, then reply with one short sentence saying what you did.`,
      tools,
      messages: [{ role: 'user', content: task.prompt }],
    });
    const finalText = finalMessage.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const checks = await task.grade({ ctx, finalText, calls });
    const passed = checks.every(([, ok]) => ok);
    return {
      id: task.id,
      status: passed ? 'pass' : 'fail',
      checks,
      calls: calls.map((c) => c.name),
      overBudget: calls.length > task.maxCalls,
      stopReason: finalMessage.stop_reason,
      usage: finalMessage.usage,
      ms: Math.round(performance.now() - started),
      finalText,
    };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const client = new Anthropic();
  const results = [];
  for (const task of TASKS) {
    if (ONLY && task.id !== ONLY) continue;
    try {
      results.push(await runTask(client, task));
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        console.error('No Anthropic credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.');
        process.exit(2);
      }
      if (err instanceof Anthropic.RateLimitError) {
        console.error('Rate limited; retry later.');
        process.exit(2);
      }
      results.push({ id: task.id, status: 'error', error: err.message });
    }
  }
  console.log(`\nlive agent eval (${MODEL})\n`);
  for (const r of results) {
    console.log(`${r.id.padEnd(22)}${r.status.padEnd(7)}calls=${r.calls ? r.calls.length : '-'}${r.overBudget ? ' !' : ''}  ${r.ms ? r.ms + 'ms' : ''}`);
    for (const [label, ok] of r.checks || []) console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (r.calls) console.log(`  tools: ${r.calls.join(' → ')}`);
    if (r.error) console.log(`  ${r.error}`);
    if (r.usage) console.log(`  tokens in=${r.usage.input_tokens} out=${r.usage.output_tokens}`);
  }
  const failed = results.filter((r) => r.status !== 'pass').length;
  console.log(`\n${results.length - failed}/${results.length} tasks passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
