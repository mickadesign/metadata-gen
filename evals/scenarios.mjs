// Scenario evals: scripted agent trajectories over the tool surface.
//
// Each scenario is what a competent agent would do for a user request,
// expressed as tool calls, plus checks on the results and on the project on
// disk. A scenario passes when every check holds. The `calls` budget is the
// number of tool calls a good agent needs; going over is reported as a
// warning, not a failure.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { openFakePage, waitFor } from './harness.mjs';

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

async function fetchPng(url) {
  const res = await fetch(url);
  expect(res.status === 200, `preview URL ${url} returned ${res.status}`);
  expect((res.headers.get('content-type') || '').includes('image/png'), 'preview is not a PNG');
  return res;
}

export const SCENARIOS = [
  {
    id: 'orient',
    request: 'What does this project look like?',
    calls: 1,
    async run({ call }) {
      const r = await call('get_project', {});
      expect(r.ok, r.text);
      const p = r.value;
      expect(Array.isArray(p.layouts) && p.layouts.length >= 3, 'layouts missing');
      expect(p.previewUrl && p.previewUrl.startsWith('http'), 'previewUrl missing');
      expect(p.og[p.layouts[0]].previewUrl, 'per-layout preview URL missing');
      expect(typeof p.og[p.layouts[0]].revision === 'number', 'revision missing');
      expect(p.favicon.previewUrls.light[32], 'favicon preview URL missing');
      expect(p.logoCandidates.includes('./logo.svg'), 'logo candidate missing');
      expect(p.agent.addCommand, 'agent add command missing');
    },
  },
  {
    id: 'tweak-and-save',
    request: 'Make layout B say "Eval headline" at 80px and save it as og.png.',
    calls: 3,
    async run({ call, ctx }) {
      const set = await call('set_og_overrides', { layout: 'B', overrides: { headline: 'Eval headline', headingSize: 80 } });
      expect(set.ok, set.text);
      expect(set.value.ignored.length === 0, `unexpected ignored: ${JSON.stringify(set.value.ignored)}`);
      const preview = await call('get_og_preview', { layout: 'B' });
      expect(preview.ok && preview.value.revision === set.value.revision, 'preview revision differs from render');
      const res = await fetchPng(preview.value.url);
      expect(res.headers.get('x-revision') === String(set.value.revision), 'preview route revision header mismatch');
      const save = await call('save_og_image', { layout: 'B', revision: set.value.revision });
      expect(save.ok, save.text);
      const onDisk = await readFile(join(ctx.root, save.value.path));
      expect(onDisk.equals(ctx.server.state.og.B.png), 'saved bytes differ from the preview');
    },
  },
  {
    id: 'recover-from-bad-input',
    request: 'Set the headline size of A to 500 and align it "middle".',
    calls: 2,
    async run({ call }) {
      const bad = await call('set_og_overrides', { layout: 'A', overrides: { headingSize: 500, align: 'middle' } });
      expect(bad.ok, 'a partially valid call should not be a hard error');
      const keys = bad.value.ignored.map((i) => i.key).sort();
      expect(keys.join(',') === 'align,headingSize', `ignored keys: ${keys}`);
      const reasons = bad.value.ignored.map((i) => i.reason).join(' ');
      expect(/12 and 120/.test(reasons), 'headingSize reason lacks the valid range');
      expect(/left, center or right/.test(reasons), 'align reason lacks the valid values');
      const retry = await call('set_og_overrides', { layout: 'A', overrides: { headingSize: 96, align: 'center' } });
      expect(retry.ok && retry.value.ignored.length === 0, 'retry with corrected values failed');
      expect(retry.value.overrides.headingSize === 96, 'corrected value not applied');
    },
  },
  {
    id: 'unknown-layout',
    request: 'Show me layout Q.',
    calls: 2,
    async run({ call }) {
      const bad = await call('get_og_preview', { layout: 'Q' });
      expect(!bad.ok, 'unknown layout must be an error');
      expect(/Available layouts: A, B, C/.test(bad.text), `error does not list layouts: ${bad.text}`);
      const good = await call('get_og_preview', { layout: 'A' });
      expect(good.ok, good.text);
    },
  },
  {
    id: 'stale-save',
    request: 'Save layout C after two edits, using the revision from the first one.',
    calls: 4,
    async run({ call, ctx }) {
      const r1 = await call('set_og_overrides', { layout: 'C', overrides: { headline: 'First' } });
      const r2 = await call('set_og_overrides', { layout: 'C', overrides: { headline: 'Second' } });
      expect(r2.value.revision === r1.value.revision + 1, 'revision did not advance');
      const stale = await call('save_og_image', { layout: 'C', revision: r1.value.revision });
      expect(!stale.ok, 'stale save must be refused');
      expect(new RegExp(`revision ${r2.value.revision}`).test(stale.text), `stale error does not name the current revision: ${stale.text}`);
      const ok = await call('save_og_image', { layout: 'C', revision: r2.value.revision });
      expect(ok.ok, ok.text);
      expect(ctx.server.state.og.C.overrides.headline === 'Second', 'wrong overrides saved');
    },
  },
  {
    id: 'favicon-logo-roundtrip',
    request: 'Use logo.svg as the favicon with rounder corners, then go back to a lettermark "E", and save the set.',
    calls: 3,
    async run({ call, ctx }) {
      const logo = await call('set_favicon_options', { options: { faviconSrc: './logo.svg', borderRadius: 30 } });
      expect(logo.ok, logo.text);
      expect(logo.value.options.faviconSrc === './logo.svg', 'logo not applied');
      await fetchPng(logo.value.previewUrls.dark[32]);
      const letter = await call('set_favicon_options', { options: { faviconSrc: null, letter: 'E' } });
      expect(letter.ok, letter.text);
      expect(letter.value.options.faviconSrc === null, 'null did not select the lettermark');
      expect(letter.value.options.letter === 'E', 'letter not applied');
      expect(letter.value.options.borderRadius === 30, 'earlier option lost on merge');
      const save = await call('save_favicon_set', { revision: letter.value.revision });
      expect(save.ok, save.text);
      expect(save.value.count === 9, `expected 9 files, got ${save.value.count}`);
      await stat(join(ctx.root, 'public/metadata/favicon.ico'));
    },
  },
  {
    id: 'social-text',
    request: 'Change the title to "Eval Title" and the description, then save the metadata.',
    calls: 3,
    async run({ call, ctx }) {
      const social = await call('set_social_text', { title: 'Eval Title', tagline: 'Eval tagline' });
      expect(social.ok, social.text);
      expect(Object.keys(social.value.og).length === 3, 'not every layout re-rendered');
      const project = await call('get_project', {});
      expect(project.value.og.A.defaultCopy.headline === 'Eval Title', 'default copy not updated');
      const save = await call('save_config', { title: 'Eval Title', tagline: 'Eval tagline' });
      expect(save.ok, save.text);
      const cfg = JSON.parse(await readFile(join(ctx.root, 'metadata.config.json'), 'utf-8'));
      expect(cfg.title === 'Eval Title', 'config not written');
    },
  },
  {
    id: 'select-and-reset',
    request: 'Select layout C, then put layout B back to its defaults.',
    calls: 3,
    async run({ call }) {
      const sel = await call('select_layout', { layout: 'C' });
      expect(sel.ok && sel.value.selectedLayout === 'C', 'select failed');
      const reset = await call('reset_og_overrides', { layout: 'B' });
      expect(reset.ok, reset.text);
      expect(!('headline' in reset.value.overrides), 'headline survived the reset');
      const project = await call('get_project', {});
      expect(project.value.selectedLayout === 'C', 'selection not reported');
    },
  },
  {
    id: 'save-without-looking',
    request: 'Just save og.png for layout A without checking it.',
    calls: 2,
    async run({ call }) {
      const blind = await call('save_og_image', { layout: 'A' });
      expect(!blind.ok, 'a save without a revision must be refused');
      expect(/get_og_preview/.test(blind.text), `error does not say how to get a revision: ${blind.text}`);
      const preview = await call('get_og_preview', { layout: 'A' });
      expect(preview.ok, preview.text);
    },
  },
  {
    id: 'consent-denied',
    request: 'Save og.png while the user says no in the page.',
    calls: 2,
    async run({ call, ctx }) {
      const page = await openFakePage(ctx, { decision: 'deny' });
      try {
        const before = await stat(join(ctx.root, 'public/metadata/og.png')).then((s) => s.mtimeMs).catch(() => 0);
        const preview = await call('get_og_preview', { layout: 'A' });
        const r = await call('save_og_image', { layout: 'A', revision: preview.value.revision });
        expect(!r.ok, 'denied save must be an error');
        expect(/declined/.test(r.text), `error does not say declined: ${r.text}`);
        const after = await stat(join(ctx.root, 'public/metadata/og.png')).then((s) => s.mtimeMs).catch(() => 0);
        expect(before === after, 'file changed despite denial');
        expect(await waitFor(() => page.seen.some((e) => e.event === 'consent')), 'page never saw the consent request');
      } finally {
        await page.close();
      }
    },
  },
  {
    id: 'consent-allowed',
    request: 'Save og.png while the user says yes in the page.',
    calls: 2,
    async run({ call, ctx }) {
      const page = await openFakePage(ctx, { decision: 'allow' });
      try {
        const preview = await call('get_og_preview', { layout: 'A' });
        const r = await call('save_og_image', { layout: 'A', revision: preview.value.revision });
        expect(r.ok, r.text);
        await stat(join(ctx.root, r.value.path));
        expect(await waitFor(() => page.seen.some((e) => e.event === 'saved')), 'page never saw the saved event');
      } finally {
        await page.close();
      }
    },
  },
];
