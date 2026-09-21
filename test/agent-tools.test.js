import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS, bindTools, toolResult, describeTool } from '../src/agent-tools.js';

test('tool names are unique and snake_case', () => {
  const names = TOOL_DEFINITIONS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-z][a-z0-9_]*$/);
});

test('descriptions stay within Chrome budgets', () => {
  for (const t of TOOL_DEFINITIONS) {
    assert.ok(t.description.length <= 500, `${t.name} description too long`);
    for (const [key, prop] of Object.entries(t.inputSchema.properties || {})) {
      if (prop.description) assert.ok(prop.description.length <= 150, `${t.name}.${key} description too long`);
    }
  }
});

test('every input schema is an object schema with known required keys', () => {
  for (const t of TOOL_DEFINITIONS) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.inputSchema.properties, 'object');
    for (const r of t.inputSchema.required || []) {
      assert.ok(r in t.inputSchema.properties, `${t.name} requires unknown ${r}`);
    }
  }
});

test('write tools carry consequentialHint, read tools readOnlyHint', () => {
  for (const t of TOOL_DEFINITIONS) {
    if (t.kind === 'write') assert.equal(t.annotations.consequentialHint, true, t.name);
    if (t.kind === 'read') assert.equal(t.annotations.readOnlyHint, true, t.name);
    if (t.kind !== 'read') assert.notEqual(t.annotations.readOnlyHint, true, t.name);
  }
});

test('bindTools wraps results and errors', async () => {
  const api = Object.fromEntries(
    ['getProject', 'getOgPreview', 'getFaviconPreview', 'selectLayout', 'setOgOverrides', 'resetOgOverrides',
      'setFaviconOptions', 'setSocialText', 'saveConfig', 'saveOgImage', 'saveFaviconSet']
      .map((m) => [m, async (input) => ({ echo: input })])
  );
  api.saveOgImage = async () => { throw new Error('layout X does not exist'); };
  const tools = bindTools(api);
  const get = tools.find((t) => t.name === 'get_og_preview');
  const ok = await get.execute({ layout: 'A' });
  assert.deepEqual(ok.structuredContent, { echo: { layout: 'A' } });
  assert.equal(ok.content[0].type, 'text');
  const save = tools.find((t) => t.name === 'save_og_image');
  const bad = await save.execute({ layout: 'X' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /layout X does not exist/);
});

test('bindTools refuses an incomplete api', () => {
  assert.throws(() => bindTools({}), /missing getProject/);
});

test('describeTool strips execute and kind', () => {
  const d = describeTool({ ...TOOL_DEFINITIONS[0], execute() {} });
  assert.deepEqual(Object.keys(d).sort(), ['annotations', 'description', 'inputSchema', 'name']);
});

test('toolResult serializes objects and passes strings', () => {
  assert.equal(toolResult('hi').content[0].text, 'hi');
  assert.equal(toolResult({ a: 1 }).structuredContent.a, 1);
});

test('reset-by-null is expressible in the schemas', () => {
  const og = TOOL_DEFINITIONS.find((t) => t.name === 'set_og_overrides').inputSchema.properties.overrides.properties;
  for (const [key, schema] of Object.entries(og)) {
    assert.ok(Array.isArray(schema.type) && schema.type.includes('null'), `${key} must accept null`);
    if (schema.enum) assert.ok(schema.enum.includes(null), `${key} enum must accept null`);
  }
  const fav = TOOL_DEFINITIONS.find((t) => t.name === 'set_favicon_options').inputSchema.properties.options.properties;
  assert.ok(fav.faviconSrc.type.includes('null'));
});

test('save tools require the revision', () => {
  for (const name of ['save_og_image', 'save_favicon_set']) {
    const t = TOOL_DEFINITIONS.find((d) => d.name === name);
    assert.ok(t.inputSchema.required.includes('revision'), `${name} must require revision`);
  }
});
