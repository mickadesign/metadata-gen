#!/usr/bin/env node
// Deterministic evals for the agent tools. Runs every scenario over both
// transports (direct execute, as WebMCP calls it; JSON-RPC over /mcp, as a
// coding agent's client calls it), checks tool-surface quality, and writes a
// report. Exit code 1 when any scenario fails.
//
//   npm run eval            # all scenarios, both transports
//   npm run eval -- --json  # machine-readable output only

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS } from '../src/agent-tools.js';
import { startEvalServer, makeCallers } from './harness.mjs';
import { SCENARIOS } from './scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const jsonOnly = process.argv.includes('--json');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

function surfaceChecks() {
  const findings = [];
  for (const t of TOOL_DEFINITIONS) {
    if (t.description.length > 500) findings.push({ level: 'fail', tool: t.name, note: 'description over 500 chars' });
    if (t.description.length > 125) findings.push({ level: 'warn', tool: t.name, note: `description is ${t.description.length} chars; the spec suggests 125 for browser agents` });
    if (!/^[A-Z]/.test(t.description)) findings.push({ level: 'warn', tool: t.name, note: 'description should start with a verb phrase' });
    for (const [key, prop] of Object.entries(t.inputSchema.properties || {})) {
      if (!prop.description && !prop.enum && prop.type !== 'object') findings.push({ level: 'warn', tool: t.name, note: `parameter ${key} has no description` });
      if (prop.description && prop.description.length > 150) findings.push({ level: 'fail', tool: t.name, note: `parameter ${key} description over 150 chars` });
    }
    if (t.kind === 'write' && !t.annotations.consequentialHint) findings.push({ level: 'fail', tool: t.name, note: 'write tool without consequentialHint' });
  }
  return findings;
}

async function runScenario(scenario, caller, ctx) {
  let calls = 0;
  const trace = [];
  const call = async (name, args) => {
    calls += 1;
    const started = performance.now();
    const r = await caller.call(name, args);
    trace.push({ name, args, ok: r.ok, ms: Math.round(performance.now() - started), text: r.ok ? undefined : r.text });
    return r;
  };
  const started = performance.now();
  try {
    await scenario.run({ call, ctx, caller });
    return { id: scenario.id, transport: caller.name, status: 'pass', calls, budget: scenario.calls, ms: Math.round(performance.now() - started), trace };
  } catch (err) {
    return { id: scenario.id, transport: caller.name, status: 'fail', calls, budget: scenario.calls, ms: Math.round(performance.now() - started), error: err.message, trace };
  }
}

async function main() {
  const results = [];
  const surface = surfaceChecks();
  for (const transport of ['direct', 'mcp']) {
    for (const scenario of SCENARIOS) {
      if (only && scenario.id !== only) continue;
      // Fresh server per scenario per transport so scenarios cannot leak state.
      const ctx = await startEvalServer({ consentTimeoutMs: 2000 });
      try {
        const callers = makeCallers(ctx);
        results.push(await runScenario(scenario, callers[transport], ctx));
      } finally {
        await ctx.close();
      }
    }
  }

  // Parity: read tools must return the same shape on both transports.
  const parity = [];
  {
    const ctx = await startEvalServer();
    try {
      const callers = makeCallers(ctx);
      for (const [name, args] of [['get_project', {}], ['get_og_preview', { layout: 'A' }], ['get_favicon_preview', { mode: 'light', size: 32 }]]) {
        const a = await callers.direct.call(name, args);
        const b = await callers.mcp.call(name, args);
        const ka = Object.keys(a.value || {}).sort().join(',');
        const kb = Object.keys(b.value || {}).sort().join(',');
        parity.push({ tool: name, status: ka === kb ? 'pass' : 'fail', direct: ka, mcp: kb });
      }
      const listed = (await callers.mcp.list()).map((t) => t.name).join(',');
      const defined = TOOL_DEFINITIONS.map((t) => t.name).join(',');
      parity.push({ tool: 'tools/list', status: listed === defined ? 'pass' : 'fail', direct: defined, mcp: listed });
    } finally {
      await ctx.close();
    }
  }

  const failed = results.filter((r) => r.status === 'fail');
  const overBudget = results.filter((r) => r.status === 'pass' && r.calls > r.budget);
  const surfaceFails = surface.filter((f) => f.level === 'fail');
  const parityFails = parity.filter((p) => p.status === 'fail');
  const report = {
    ranAt: new Date().toISOString(),
    summary: {
      scenarios: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      overBudget: overBudget.length,
      surfaceWarnings: surface.filter((f) => f.level === 'warn').length,
      surfaceFailures: surfaceFails.length,
      parityFailures: parityFails.length,
    },
    results,
    parity,
    surface,
  };

  const outDir = join(here, 'results');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');

  if (jsonOnly) {
    console.log(JSON.stringify(report));
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\nmetadata-gen agent tool evals\n');
    console.log(`${pad('scenario', 26)}${pad('transport', 10)}${pad('status', 8)}${pad('calls', 12)}ms`);
    for (const r of results) {
      const calls = `${r.calls}/${r.budget}${r.calls > r.budget ? ' !' : ''}`;
      console.log(`${pad(r.id, 26)}${pad(r.transport, 10)}${pad(r.status, 8)}${pad(calls, 12)}${r.ms}`);
      if (r.error) console.log(`  ${r.error}`);
    }
    console.log('\nparity (direct vs mcp)');
    for (const p of parity) console.log(`  ${pad(p.tool, 22)}${p.status}${p.status === 'fail' ? `  direct=${p.direct}  mcp=${p.mcp}` : ''}`);
    console.log('\ntool surface');
    if (surface.length === 0) console.log('  no findings');
    for (const f of surface) console.log(`  ${f.level.padEnd(5)} ${f.tool}: ${f.note}`);
    const s = report.summary;
    console.log(`\n${s.passed}/${s.scenarios} scenarios passed, ${s.overBudget} over call budget, ${s.parityFailures} parity failures, ${s.surfaceFailures} surface failures (${s.surfaceWarnings} warnings)`);
    console.log(`report: ${join(outDir, 'latest.json')}\n`);
  }

  process.exit(failed.length || surfaceFails.length || parityFails.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
