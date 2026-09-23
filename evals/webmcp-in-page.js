// WebMCP eval that runs inside the preview page.
//
// Paste this file into the DevTools console on the preview page (Human or
// Agent view). It wraps document.modelContext so the tools the page registers
// are captured whether or not the browser has native WebMCP, then calls them
// the way a browser agent would and checks the page reacted. It approves
// consent bars by clicking them, like a user would.
//
// Returns a summary object and prints a table.

(async function webmcpEval() {
  const registry = [];
  const native = document.modelContext || navigator.modelContext;
  const hasNative = !!(native && typeof native.registerTool === 'function');
  const shim = {
    async registerTool(tool) {
      registry.push(tool);
      if (hasNative) return native.registerTool(tool);
    },
  };
  Object.defineProperty(document, 'modelContext', { value: shim, configurable: true });
  await registerWebMcpTools();

  const results = [];
  const byName = Object.fromEntries(registry.map((t) => [t.name, t]));
  async function call(name, args) {
    const tool = byName[name];
    if (!tool) throw new Error(`tool ${name} not registered`);
    const result = await tool.execute(args || {}, {});
    const text = (result.content || []).map((c) => c.text || '').join('');
    return result.isError ? { ok: false, text } : { ok: true, value: result.structuredContent ?? JSON.parse(text), text };
  }
  // Click the consent bar the way a user would.
  function autoConsent(choice) {
    const t = setInterval(() => {
      const bar = document.getElementById('agentConsent');
      if (bar && bar.classList.contains('open')) {
        bar.querySelector(`[data-consent="${choice}"]`).click();
      }
    }, 50);
    return () => clearInterval(t);
  }
  async function scenario(id, fn) {
    const started = performance.now();
    try {
      await fn();
      results.push({ scenario: id, status: 'pass', ms: Math.round(performance.now() - started) });
    } catch (err) {
      results.push({ scenario: id, status: 'fail', ms: Math.round(performance.now() - started), error: err.message });
    }
  }
  const expect = (c, m) => { if (!c) throw new Error(m); };

  await scenario('registered all tools', async () => {
    expect(registry.length === 11, `expected 11 tools, got ${registry.length}`);
    for (const t of registry) expect(typeof t.execute === 'function' && t.inputSchema && t.description, `${t.name} incomplete`);
  });

  await scenario('get_project reflects the page', async () => {
    const r = await call('get_project', {});
    expect(r.ok, r.text);
    expect(r.value.layouts.includes(selectedLayout), 'selected layout missing from project');
    expect(r.value.agent.pageOpen === true, 'server does not see this page');
  });

  await scenario('set_og_overrides updates image, controls and revision', async () => {
    const layout = layouts[1] || layouts[0];
    const before = ogRevisions[layout];
    const r = await call('set_og_overrides', { layout, overrides: { headline: 'WebMCP eval', headingSize: 84 } });
    expect(r.ok, r.text);
    expect(r.value.revision > before, 'revision did not advance');
    expect(cardOverrides[layout].headline === 'WebMCP eval', 'page state not updated');
    const img = document.getElementById(`preview-${layout}`);
    expect(img && img.src.length > 0, 'preview image missing');
    selectVariant(layout);
    const input = document.querySelector('#miLayoutSettingsPanel input.ff-input');
    expect(input && input.value === 'WebMCP eval', 'headline control not synced');
    const card = document.querySelector(`.mi-variant-card[data-layout="${layout}"]`);
    expect(card.getAttribute('data-revision') === String(r.value.revision), 'card revision attribute stale');
  });

  await scenario('set_favicon_options with faviconSrc null keeps lettermark', async () => {
    const r = await call('set_favicon_options', { options: { faviconSrc: null, letter: 'W', borderRadius: 40 } });
    expect(r.ok, r.text);
    expect(faviconOverrides.faviconSrc === null, 'faviconSrc null lost');
    expect(faviconOverrides.letter === 'W', 'letter not applied');
    const letterInput = [...document.querySelectorAll('#faviconCustomize input.ff-input')].find((i) => i.maxLength === 4);
    expect(letterInput && letterInput.value === 'W', 'letter control not synced');
  });

  await scenario('get_og_preview URL is fetchable', async () => {
    const r = await call('get_og_preview', { layout: layouts[0] });
    expect(r.ok, r.text);
    const res = await fetch(r.value.url);
    expect(res.ok && res.headers.get('content-type').includes('image/png'), 'preview not a PNG');
  });

  await scenario('unknown layout is an actionable error', async () => {
    const r = await call('get_og_preview', { layout: 'Q' });
    expect(!r.ok && /Available layouts/.test(r.text), `bad error: ${r.text}`);
  });

  await scenario('save_og_image asks and honors Deny', async () => {
    const stop = autoConsent('deny');
    try {
      const r = await call('save_og_image', { layout: layouts[0] });
      expect(!r.ok && /declined/.test(r.text), `expected a decline, got ${r.text}`);
    } finally { stop(); }
  });

  await scenario('save_og_image asks and honors Allow', async () => {
    const stop = autoConsent('once');
    try {
      const r = await call('save_og_image', { layout: layouts[0] });
      expect(r.ok, r.text);
      expect(/og\.png$/.test(r.value.path), 'unexpected path');
    } finally { stop(); }
  });

  await scenario('"Allow this session" skips the next bar', async () => {
    const originalUrl = config.url || '';
    const stop = autoConsent('session');
    try {
      const first = await call('save_config', { url: 'https://webmcp-eval.example' });
      expect(first.ok, first.text);
    } finally { stop(); }
    const bar = document.getElementById('agentConsent');
    const second = await call('save_config', { url: 'https://webmcp-eval-2.example' });
    expect(second.ok, second.text);
    expect(!bar.classList.contains('open'), 'bar should not have opened again');
    // Leave the project as we found it; the session approval covers this too.
    const restore = await call('save_config', { url: originalUrl });
    expect(restore.ok, restore.text);
  });

  console.table(results);
  const summary = {
    nativeWebMCP: hasNative,
    tools: registry.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    results,
  };
  window.__webmcpEval = summary;
  return summary;
})();
