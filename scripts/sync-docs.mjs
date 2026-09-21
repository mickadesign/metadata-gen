#!/usr/bin/env node
// Keeps the landing page demo (docs/) identical to the CLI's preview page.
//
// The demo reuses, byte for byte, the social mockups and form controls from
// src/preview.html, the OG layout templates from src/templates/, and the
// browser-tab mockup images from src/preview-assets/. Run this after editing
// any of those: it rewrites the marked regions in docs/demo.js and
// docs/index.html and copies the files over.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const previewPath = join(root, 'src', 'preview.html');
const preview = readFileSync(previewPath, 'utf8');
const lines = preview.split('\n');

// Top-level functions and consts in the preview script are indented by four
// spaces and end on a line that is exactly "    }" / "    };" / "    ];".
function extractJs(name) {
  const start = lines.findIndex((l) => l.startsWith(`    function ${name}(`) || l.startsWith(`    const ${name} =`));
  if (start < 0) throw new Error(`sync-docs: ${name} not found in src/preview.html`);
  const end = lines.findIndex((l, i) => i > start && ['    }', '    };', '    ];'].includes(l));
  return lines.slice(start, end + 1).map((l) => l.replace(/^ {4}/, '')).join('\n');
}

function extractCss(startMarker, endMarker) {
  const i = preview.indexOf(startMarker);
  const j = preview.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error(`sync-docs: CSS region ${startMarker.trim()} not found`);
  return preview.slice(i, j).trimEnd();
}

function replaceRegion(file, startMarker, endMarker, body) {
  const src = readFileSync(file, 'utf8');
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error(`sync-docs: markers not found in ${file}`);
  const next = src.slice(0, i + startMarker.length) + '\n\n' + body + '\n\n' + src.slice(j);
  const changed = next !== src;
  if (changed) writeFileSync(file, next);
  return changed;
}

const JS_PIECES = [
  'normalizeHex', 'el', 'ffSlider', 'ffColor', 'ffSelect', 'ffToggle',
  'SOCIAL_LIMITS', 'truncate', 'domainFromUrl', 'PLATFORM_ICON_SVGS', 'platformIcon', 'SOCIAL_PLATFORMS',
];
const CSS_PIECES = [
  ['    /* --- Refine panel --- */', '    /* --- Favicon section --- */'],
  ['    .ff-toggle {', '    .favicon-size {'],
  ['    .platform-icon {', '    .mi-preview-toggle .platform-icon'],
  ['    /* Shared: truncation ellipsis */', '    /* --- Metadata images: 3-zone flow --- */'],
];

const changes = [];

if (replaceRegion(
  join(root, 'docs', 'demo.js'),
  '// >>> ported from src/preview.html — do not edit here, run `npm run sync-docs`',
  '// <<< end ported',
  JS_PIECES.map(extractJs).join('\n\n'),
)) changes.push('docs/demo.js');

if (replaceRegion(
  join(root, 'docs', 'index.html'),
  '    /* >>> ported from src/preview.html — do not edit here, run `npm run sync-docs` */',
  '    /* <<< end ported */',
  CSS_PIECES.map(([a, b]) => extractCss(a, b)).join('\n\n'),
)) changes.push('docs/index.html');

for (const [from, to] of [['src/templates', 'docs/templates'], ['src/preview-assets', 'docs/preview-assets']]) {
  mkdirSync(join(root, to), { recursive: true });
  for (const f of readdirSync(join(root, from))) {
    if (!/\.(js|png)$/.test(f) || f === 'AGENTS.md') continue;
    const a = readFileSync(join(root, from, f));
    let same = false;
    try { same = a.equals(readFileSync(join(root, to, f))); } catch {}
    if (!same) { copyFileSync(join(root, from, f), join(root, to, f)); changes.push(`${to}/${f}`); }
  }
}

console.log(changes.length ? `sync-docs: updated ${changes.join(', ')}` : 'sync-docs: docs already in sync');
