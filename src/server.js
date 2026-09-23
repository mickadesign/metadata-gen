import express from 'express';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOgImage, renderAllVariants, getLayoutLetters, getLayoutCopy, PROJECT_TEMPLATES_SUBDIR } from './renderer.js';
import { generateFaviconSet, renderFaviconPreviewBuffers, faviconBuffersToDataUrls } from './favicon.js';
import { scanAllLogos, scanFonts } from './scanner.js';
import { bindTools } from './agent-tools.js';
import { createMcpServer } from './mcp.js';
import { writeLockfile, removeLockfile } from './lockfile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PKG = require('../package.json');

export const TOKEN_HEADER = 'x-metadata-gen-token';
export const CLIENT_HEADER = 'x-metadata-gen-client';
export const MCP_ADD_COMMAND = 'claude mcp add metadata-gen -- npx metadata-gen mcp';
const LOOPBACK = '127.0.0.1';
const FAVICON_MODES = ['light', 'dark', 'custom'];
const FAVICON_SIZES = [16, 32, 96, 180];
const DEFAULT_CONSENT_TIMEOUT_MS = 90_000;

/**
 * True when nothing listens on `port` on either the wildcard address or the
 * IPv4 loopback. Both probes are needed: on macOS a wildcard (dual-stack)
 * bind succeeds next to a process bound to 127.0.0.1 only, and a 127.0.0.1
 * bind succeeds next to a process on the IPv6 wildcard. Either case would
 * make `localhost:PORT` reach one server or the other depending on the
 * client.
 */
async function portIsFree(port) {
  const net = await import('node:net');
  const probe = (host) => new Promise((resolve) => {
    const server = net.default.createServer();
    server.once('error', () => resolve(false));
    server.listen(host ? { port, host } : { port }, () => server.close(() => resolve(true)));
  });
  return (await probe(undefined)) && (await probe(LOOPBACK));
}

/**
 * Find a free port starting from `startPort`.
 */
async function findPort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No available port found (tried ${startPort}-${startPort + maxAttempts - 1})`);
}

async function loadConfig(root) {
  const configPath = join(root, 'metadata.config.json');
  try {
    await access(configPath);
  } catch {
    const err = new Error('No metadata.config.json found');
    err.code = 'CONFIG_NOT_FOUND';
    throw err;
  }
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch {
    throw new Error('metadata.config.json contains invalid JSON. Delete it and run `metadata-gen init` again.');
  }
  config.colors = config.colors || {};
  config.colors.background = config.colors.background || '#0f0f0f';
  config.colors.foreground = config.colors.foreground || '#ffffff';
  config.colors.accent = config.colors.accent || '#888888';
  config.title = config.title || '';
  config.tagline = config.tagline || '';
  return { config, configPath };
}

function isHex(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim());
}

/**
 * Keep only known OG override keys with valid values. `ignored` lists what
 * was dropped and why, so an agent can correct its next call.
 */
export function sanitizeOgOverrides(overrides, { fontPaths, logoCandidates }) {
  const safe = {};
  const ignored = [];
  if (!overrides || typeof overrides !== 'object') return { safe, ignored };
  const known = new Set([
    'headline', 'tagline', 'background', 'foreground', 'accent', 'taglineColor', 'baseTitle', 'baseTagline',
    'headingSize', 'taglineSize', 'textWidth', 'logoSize', 'logoGap', 'align', 'logoPosition', 'headingFont', 'taglineFont',
    'showLogo', 'logoPath',
  ]);
  for (const key of Object.keys(overrides)) {
    if (!known.has(key)) ignored.push({ key, reason: 'unknown key' });
  }
  for (const key of ['headline', 'tagline', 'baseTitle', 'baseTagline']) {
    if (typeof overrides[key] === 'string') safe[key] = overrides[key].slice(0, 500);
    else if (overrides[key] != null) ignored.push({ key, reason: 'must be a string' });
  }
  for (const key of ['background', 'foreground', 'accent', 'taglineColor']) {
    if (overrides[key] == null) continue;
    if (isHex(overrides[key])) safe[key] = overrides[key].trim().slice(0, 7);
    else ignored.push({ key, reason: 'must be a hex color like #0f0f0f' });
  }
  for (const key of ['headingSize', 'taglineSize']) {
    if (overrides[key] == null) continue;
    if (typeof overrides[key] === 'number' && overrides[key] >= 12 && overrides[key] <= 120) safe[key] = overrides[key];
    else ignored.push({ key, reason: 'must be a number between 12 and 120' });
  }
  if (overrides.textWidth != null) {
    if (typeof overrides.textWidth === 'number' && overrides.textWidth >= 320 && overrides.textWidth <= 1040) safe.textWidth = overrides.textWidth;
    else ignored.push({ key: 'textWidth', reason: 'must be a number between 320 and 1040' });
  }
  if (overrides.logoSize != null) {
    if (typeof overrides.logoSize === 'number' && overrides.logoSize >= 24 && overrides.logoSize <= 300) safe.logoSize = overrides.logoSize;
    else ignored.push({ key: 'logoSize', reason: 'must be a number between 24 and 300' });
  }
  if (overrides.logoGap != null) {
    if (typeof overrides.logoGap === 'number' && overrides.logoGap >= 0 && overrides.logoGap <= 160) safe.logoGap = overrides.logoGap;
    else ignored.push({ key: 'logoGap', reason: 'must be a number between 0 and 160' });
  }
  if (overrides.align != null) {
    if (['left', 'center', 'right'].includes(overrides.align)) safe.align = overrides.align;
    else ignored.push({ key: 'align', reason: 'must be left, center or right' });
  }
  if (overrides.logoPosition != null) {
    if (['left', 'top'].includes(overrides.logoPosition)) safe.logoPosition = overrides.logoPosition;
    else ignored.push({ key: 'logoPosition', reason: 'must be top or left' });
  }
  for (const key of ['headingFont', 'taglineFont']) {
    const v = overrides[key];
    if (v == null) continue;
    if (v === '__inter__') safe[key] = '__inter__';
    else if (typeof v === 'string' && fontPaths.has(v)) safe[key] = v;
    else ignored.push({ key, reason: 'must be "__inter__" or a font path from get_project.fonts' });
  }
  if (overrides.showLogo != null) {
    if (typeof overrides.showLogo === 'boolean') safe.showLogo = overrides.showLogo;
    else ignored.push({ key: 'showLogo', reason: 'must be a boolean' });
  }
  if (overrides.logoPath != null) {
    if (typeof overrides.logoPath === 'string' && logoCandidates.includes(overrides.logoPath)) safe.logoPath = overrides.logoPath;
    else ignored.push({ key: 'logoPath', reason: 'must be one of get_project.logoCandidates' });
  }
  return { safe, ignored };
}

/**
 * Keep only known favicon option keys with valid values.
 */
export function sanitizeFaviconOptions(options, { logoCandidates }) {
  const safe = {};
  const ignored = [];
  if (!options || typeof options !== 'object') return { safe, ignored };
  const { letter, faviconSrc, background, accent, darkAccent, letterSize, borderRadius, transparent, fontWeight, darkBg, customBg } = options;
  const known = new Set(['letter', 'faviconSrc', 'background', 'accent', 'darkAccent', 'letterSize', 'borderRadius', 'transparent', 'fontWeight', 'darkBg', 'customBg', 'modes', 'sizes']);
  for (const key of Object.keys(options)) {
    if (!known.has(key)) ignored.push({ key, reason: 'unknown key' });
  }
  if (letter != null) {
    if (typeof letter === 'string' && letter.length > 0) safe.letter = letter.slice(0, 4);
    else ignored.push({ key: 'letter', reason: 'must be a non-empty string of up to 4 characters' });
  }
  if (letterSize != null) {
    if (typeof letterSize === 'number' && letterSize >= 20 && letterSize <= 80) safe.letterSize = letterSize;
    else ignored.push({ key: 'letterSize', reason: 'must be a number between 20 and 80' });
  }
  if (borderRadius != null) {
    if (typeof borderRadius === 'number' && borderRadius >= 0 && borderRadius <= 50) safe.borderRadius = borderRadius;
    else ignored.push({ key: 'borderRadius', reason: 'must be a number between 0 and 50' });
  }
  if (fontWeight != null) {
    if ([400, 700].includes(fontWeight)) safe.fontWeight = fontWeight;
    else ignored.push({ key: 'fontWeight', reason: 'must be 400 or 700' });
  }
  if (transparent != null) {
    if (typeof transparent === 'boolean') safe.transparent = transparent;
    else ignored.push({ key: 'transparent', reason: 'must be a boolean' });
  }
  for (const [key, v] of [['background', background], ['accent', accent], ['darkAccent', darkAccent], ['darkBg', darkBg], ['customBg', customBg]]) {
    if (v == null) continue;
    if (isHex(v)) safe[key] = v.trim().slice(0, 7);
    else ignored.push({ key, reason: 'must be a hex color like #0f0f0f' });
  }
  if (faviconSrc === null) {
    safe.faviconSrc = null;
  } else if (faviconSrc !== undefined) {
    if (typeof faviconSrc === 'string' && logoCandidates.includes(faviconSrc)) safe.faviconSrc = faviconSrc;
    else ignored.push({ key: 'faviconSrc', reason: 'must be null or one of get_project.logoCandidates' });
  }
  return { safe, ignored };
}

/** Map sanitized favicon options onto the config shape favicon.js reads. */
function buildFaviconConfig(config, safe) {
  const out = { ...config, colors: { ...config.colors } };
  if (safe.letter !== undefined) out.faviconLetter = safe.letter;
  if (safe.letterSize !== undefined) out.faviconLetterSize = safe.letterSize;
  if (safe.borderRadius !== undefined) out.faviconBorderRadius = safe.borderRadius;
  if (safe.fontWeight !== undefined) out.faviconFontWeight = safe.fontWeight;
  if (safe.transparent !== undefined) out.faviconTransparent = safe.transparent;
  if (safe.darkBg !== undefined) out.faviconDarkBg = safe.darkBg;
  if (safe.customBg !== undefined) out.faviconCustomBg = safe.customBg;
  if (safe.faviconSrc !== undefined) out.faviconSrc = safe.faviconSrc;
  if (safe.background !== undefined) out.colors.background = safe.background;
  if (safe.accent !== undefined) out.colors.accent = safe.accent;
  if (safe.darkAccent !== undefined) out.faviconDarkAccent = safe.darkAccent;
  return out;
}

/** Merge a patch into current values; a null value removes the key. */
function mergePatch(current, patch) {
  const next = { ...current };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

/**
 * Build the preview server without listening. Returns the Express app, the
 * shared state, the bound agent tools and a `listen()` helper. `startServer`
 * wraps this for the CLI; tests use it directly.
 */
export async function createPreviewServer(options = {}) {
  const root = options.root || process.cwd();
  const log = options.log || console.log;
  const token = options.token || randomBytes(24).toString('base64url');
  const consentTimeoutMs = options.consentTimeoutMs || DEFAULT_CONSENT_TIMEOUT_MS;
  const { config, configPath } = await loadConfig(root);
  const outputDir = options.outputDir || join(root, config.outputDir || 'public/metadata');

  log('\nmetadata-gen\n');
  log('\u2713 Read metadata.config.json');
  if (config.logo) log(`\u2713 Found logo: ${config.logo}`);

  const logoCandidates = await scanAllLogos(root);
  const projectFonts = await scanFonts(root);
  const fontPaths = new Set(projectFonts.map((f) => f.path));
  const layouts = await getLayoutLetters(root);
  const sanitizeCtx = { fontPaths, logoCandidates };

  log('\u2713 Rendering metadata image variants...');
  const og = {};
  for (const v of await renderAllVariants(config, root)) {
    og[v.layout] = {
      overrides: {},
      revision: 1,
      seq: 0,
      png: v.png,
      copy: await getLayoutCopy(config, v.layout, {}, root),
    };
  }

  log('\u2713 Rendering favicon set...');
  const favicon = {
    options: {},
    config: buildFaviconConfig(config, {}),
    revision: 1,
    buffers: {},
  };
  favicon.buffers = await renderFaviconPreviewBuffers(favicon.config, root);

  const social = { title: config.title || '', tagline: config.tagline || '', url: config.url || '' };
  const projectTemplatesDir = join(root, PROJECT_TEMPLATES_SUBDIR);

  // --- Server-sent events: every page mirrors what agents change ---------
  const sseClients = new Set();
  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(payload);
  }
  const heartbeat = setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  // --- Consent: write tools called through MCP ask the open page ---------
  const pendingConsent = new Map();
  async function requestConsent({ tool, detail }) {
    if (sseClients.size === 0) {
      // No page is open. The MCP client's own permission prompt is the gate.
      return { allowed: true, via: 'no-page' };
    }
    const id = randomBytes(8).toString('hex');
    const answer = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingConsent.delete(id);
        resolve({ allowed: false, via: 'timeout' });
      }, consentTimeoutMs);
      pendingConsent.set(id, { resolve, timer });
    });
    broadcast('consent', { id, tool, detail });
    return answer;
  }
  function answerConsent(id, allowed) {
    const entry = pendingConsent.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pendingConsent.delete(id);
    entry.resolve({ allowed: allowed === true, via: 'page' });
    return true;
  }

  const state = {
    root, outputDir, config, configPath, layouts, logoCandidates, projectFonts, fontPaths,
    og, favicon, social, token,
    selectedLayout: layouts[0] || null,
    baseUrl: '',
    allowedOrigins: new Set(),
    broadcast,
    requestConsent,
    answerConsent,
    sseClientCount: () => sseClients.size,
  };

  function setPort(port) {
    state.port = port;
    // The listener is IPv4-only, so advertise 127.0.0.1: `localhost` can
    // resolve to ::1 first on some systems and never reach it.
    state.baseUrl = `http://${LOOPBACK}:${port}`;
    state.allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  }

  function requireLayout(layout) {
    const entry = og[layout];
    if (!entry) {
      throw httpError(400, `Unknown layout "${layout}". Available layouts: ${layouts.join(', ')}.`);
    }
    return entry;
  }
  function ogUrl(layout, revision) {
    return `${state.baseUrl}/preview/og/${layout.toLowerCase()}.png?rev=${revision}`;
  }
  function faviconUrl(mode, size, revision) {
    return `${state.baseUrl}/preview/favicon/${mode}/${size}.png?rev=${revision}`;
  }
  function faviconUrls() {
    const out = {};
    for (const mode of FAVICON_MODES) {
      if (mode === 'custom' && !favicon.config.faviconCustomBg) continue;
      out[mode] = {};
      for (const size of FAVICON_SIZES) out[mode][size] = faviconUrl(mode, size, favicon.revision);
    }
    return out;
  }

  /**
   * Render one layout. `merge` folds `overrides` into the current ones (null
   * removes a key); otherwise they replace. Only the latest in-flight render
   * per layout updates the cache and revision.
   */
  state.renderOg = async function renderOg(layout, overrides, { merge = false, client = null } = {}) {
    const entry = requireLayout(layout);
    const next = merge ? mergePatch(entry.overrides, overrides) : (overrides || {});
    const { safe, ignored } = sanitizeOgOverrides(next, sanitizeCtx);
    const seq = ++entry.seq;
    const png = await renderOgImage(config, layout, safe, root);
    const copy = await getLayoutCopy(config, layout, safe, root);
    const stale = seq !== entry.seq;
    if (!stale) {
      entry.png = png;
      entry.overrides = safe;
      entry.copy = copy;
      entry.revision += 1;
      broadcast('og', { layout, revision: entry.revision, overrides: safe, copy, url: ogUrl(layout, entry.revision), client });
    }
    return { layout, revision: entry.revision, url: ogUrl(layout, entry.revision), copy, overrides: safe, ignored, png, stale };
  };

  /**
   * Update favicon options and render the requested modes/sizes. Options that
   * differ from the current ones bump the revision and drop cached buffers.
   */
  state.renderFavicon = async function renderFavicon(options, { merge = false, modes = null, sizes = null, client = null } = {}) {
    const next = merge ? mergePatch(favicon.options, options) : (options || {});
    // faviconSrc: null means "use the lettermark"; it must survive the merge.
    if (merge && options && options.faviconSrc === null) next.faviconSrc = null;
    const { safe, ignored } = sanitizeFaviconOptions(next, sanitizeCtx);
    if (JSON.stringify(safe) !== JSON.stringify(favicon.options)) {
      favicon.options = safe;
      favicon.config = buildFaviconConfig(config, safe);
      favicon.revision += 1;
      favicon.buffers = {};
      broadcast('favicon', { revision: favicon.revision, options: safe, urls: faviconUrls(), client });
    }
    const filter = {
      modes: Array.isArray(modes) ? modes.filter((m) => FAVICON_MODES.includes(m)) : null,
      sizes: Array.isArray(sizes) ? sizes.filter((s) => FAVICON_SIZES.includes(s)) : null,
    };
    const revision = favicon.revision;
    const buffers = await renderFaviconPreviewBuffers(favicon.config, root, filter);
    const stale = revision !== favicon.revision;
    if (!stale) {
      for (const [mode, bySize] of Object.entries(buffers)) {
        favicon.buffers[mode] = { ...(favicon.buffers[mode] || {}), ...bySize };
      }
    }
    return { revision, options: favicon.options, previews: faviconBuffersToDataUrls(buffers), urls: faviconUrls(), ignored, stale };
  };

  /**
   * Bytes for one favicon preview plus the revision they belong to. When the
   * options change mid-render, render again for the new revision (bounded)
   * so the caller never gets old bytes labeled with a newer revision.
   */
  state.ensureFaviconBuffer = async function ensureFaviconBuffer(mode, size) {
    if (!FAVICON_MODES.includes(mode)) throw httpError(400, `Unknown favicon mode "${mode}". Use light, dark or custom.`);
    if (!FAVICON_SIZES.includes(size)) throw httpError(400, `Unknown favicon size ${size}. Use 16, 32, 96 or 180.`);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (mode === 'custom' && !favicon.config.faviconCustomBg) {
        throw httpError(400, 'No custom background is set. Set favicon option customBg first.');
      }
      const cached = favicon.buffers[mode] && favicon.buffers[mode][size];
      if (cached) return { buffer: cached, revision: favicon.revision };
      const revision = favicon.revision;
      const buffers = await renderFaviconPreviewBuffers(favicon.config, root, { modes: [mode], sizes: [size] });
      const buf = buffers[mode] && buffers[mode][size];
      if (!buf) throw httpError(500, 'Favicon render produced no image');
      if (revision === favicon.revision) {
        favicon.buffers[mode] = { ...(favicon.buffers[mode] || {}), [size]: buf };
        return { buffer: buf, revision };
      }
    }
    throw httpError(503, 'Favicon options keep changing; try again.');
  };

  state.select = function select(layout, client = null) {
    requireLayout(layout);
    state.selectedLayout = layout;
    broadcast('select', { layout, client });
    return layout;
  };

  state.setSocial = function setSocial(patch, client = null) {
    const applied = {};
    for (const key of ['title', 'tagline', 'url']) {
      if (typeof patch[key] === 'string') {
        social[key] = patch[key].slice(0, 500);
        applied[key] = social[key];
      }
    }
    if (Object.keys(applied).length) broadcast('social', { ...social, client });
    return { ...social };
  };

  state.saveConfig = async function saveConfig(patch) {
    const applied = {};
    for (const key of ['title', 'tagline', 'url']) {
      if (typeof patch[key] === 'string') applied[key] = patch[key].slice(0, 500);
    }
    if (Object.keys(applied).length === 0) throw httpError(400, 'Nothing to save: pass title, tagline or url.');
    Object.assign(config, applied);
    Object.assign(social, applied);
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    broadcast('config', { config, social });
    log('\u2713 Saved metadata.config.json');
    return { ok: true, path: 'metadata.config.json', config: { title: config.title, tagline: config.tagline, url: config.url || '' } };
  };

  function requireRevision(revision, hint) {
    if (typeof revision !== 'number' || !Number.isInteger(revision)) {
      throw httpError(400, `revision is required: pass the revision from ${hint} so a changed preview is never written by mistake.`);
    }
  }

  state.saveOg = async function saveOg(layout, revision) {
    const entry = requireLayout(layout);
    requireRevision(revision, `get_og_preview or set_og_overrides for layout ${layout}`);
    if (revision !== entry.revision) {
      throw httpError(409, `Revision ${revision} is stale; the preview for layout ${layout} is now at revision ${entry.revision}. Read it and save again.`, { currentRevision: entry.revision });
    }
    // Snapshot before the first await: a render finishing meanwhile must not
    // change what revision N writes.
    const snapshot = { revision: entry.revision, png: entry.png };
    await mkdir(outputDir, { recursive: true });
    const filePath = join(outputDir, 'og.png');
    await writeFile(filePath, snapshot.png);
    const path = filePath.replace(root, '').replace(/^\//, '');
    log(`\u2713 Saved ${path}`);
    broadcast('saved', { kind: 'og', layout, path, revision: snapshot.revision });
    return { path, layout, revision: snapshot.revision };
  };

  state.saveFavicons = async function saveFavicons(revision) {
    requireRevision(revision, 'get_favicon_preview or set_favicon_options');
    if (revision !== favicon.revision) {
      throw httpError(409, `Revision ${revision} is stale; the favicon preview is now at revision ${favicon.revision}. Read it and save again.`, { currentRevision: favicon.revision });
    }
    // favicon.config is replaced, never mutated, so holding it is a snapshot.
    const snapshot = { revision: favicon.revision, config: favicon.config };
    const files = await generateFaviconSet(snapshot.config, root, outputDir);
    const paths = files.map((f) => f.replace(root, '').replace(/^\//, ''));
    log(`\u2713 Saved favicon set (${files.length} files)`);
    broadcast('saved', { kind: 'favicons', files: paths, revision: snapshot.revision });
    return { files: paths, count: paths.length, revision: snapshot.revision };
  };

  state.snapshot = function snapshot() {
    const ogOut = {};
    for (const [layout, entry] of Object.entries(og)) {
      ogOut[layout] = { revision: entry.revision, overrides: entry.overrides, defaultCopy: entry.copy, previewUrl: ogUrl(layout, entry.revision) };
    }
    return {
      previewUrl: state.baseUrl,
      projectRoot: root,
      outputDir: outputDir.replace(root, '').replace(/^\//, '') || outputDir,
      config: {
        title: config.title, tagline: config.tagline, url: config.url || '',
        colors: config.colors, logo: config.logo || null, faviconSrc: config.faviconSrc || null,
      },
      social: { ...social },
      selectedLayout: state.selectedLayout,
      layouts,
      logoCandidates,
      fonts: projectFonts,
      og: ogOut,
      favicon: { revision: favicon.revision, options: favicon.options, previewUrls: faviconUrls() },
      templates: { dir: projectTemplatesDir, agentsMd: join(projectTemplatesDir, 'AGENTS.md'), existingLetters: layouts },
      agent: { mcpUrl: `${state.baseUrl}/mcp`, addCommand: MCP_ADD_COMMAND, pageOpen: sseClients.size > 0 },
    };
  };

  // --- Tools bound to the server state (MCP transport) --------------------
  async function gated(tool, detail, run) {
    const consent = await requestConsent({ tool, detail });
    if (!consent.allowed) {
      throw new Error(consent.via === 'timeout'
        ? 'The user did not answer the confirmation in the preview page. Nothing was written.'
        : 'The user declined this write in the preview page. Nothing was written.');
    }
    return run();
  }
  const serverApi = {
    getProject: () => state.snapshot(),
    getOgPreview: ({ layout }) => {
      const entry = requireLayout(layout);
      return { layout, revision: entry.revision, url: ogUrl(layout, entry.revision), width: 1200, height: 630, overrides: entry.overrides };
    },
    getFaviconPreview: async ({ mode, size }) => {
      const { revision } = await state.ensureFaviconBuffer(mode, size);
      return { mode, size, revision, url: faviconUrl(mode, size, revision) };
    },
    selectLayout: ({ layout }) => ({ selectedLayout: state.select(layout, 'agent') }),
    setOgOverrides: async ({ layout, overrides }, { signal } = {}) => {
      const r = await state.renderOg(layout, overrides, { merge: true, client: 'agent' });
      if (signal && signal.aborted) throw new Error('Cancelled');
      return { layout: r.layout, revision: r.revision, url: r.url, copy: r.copy, overrides: r.overrides, ignored: r.ignored };
    },
    resetOgOverrides: async ({ layout }) => {
      const r = await state.renderOg(layout, { baseTitle: social.title, baseTagline: social.tagline }, { merge: false, client: 'agent' });
      return { layout: r.layout, revision: r.revision, url: r.url, copy: r.copy, overrides: r.overrides };
    },
    setFaviconOptions: async ({ options }) => {
      const r = await state.renderFavicon(options, { merge: true, client: 'agent' });
      return { revision: r.revision, options: r.options, previewUrls: r.urls, ignored: r.ignored };
    },
    setSocialText: async (args) => {
      const applied = state.setSocial(args, 'agent');
      const ogOut = {};
      for (const layout of layouts) {
        const r = await state.renderOg(layout, { baseTitle: applied.title, baseTagline: applied.tagline }, { merge: true, client: 'agent' });
        ogOut[layout] = { revision: r.revision, url: r.url };
      }
      return { social: applied, og: ogOut };
    },
    saveConfig: (args) => gated('save_config', 'Write title, tagline and URL to metadata.config.json', () => state.saveConfig(args)),
    saveOgImage: ({ layout, revision }) => {
      requireLayout(layout);
      requireRevision(revision, `get_og_preview or set_og_overrides for layout ${layout}`);
      return gated('save_og_image', `Overwrite og.png with layout ${layout}`, () => state.saveOg(layout, revision));
    },
    saveFaviconSet: ({ revision }) => {
      requireRevision(revision, 'get_favicon_preview or set_favicon_options');
      return gated('save_favicon_set', 'Overwrite the favicon set in the output folder', () => state.saveFavicons(revision));
    },
  };
  const tools = bindTools(serverApi);
  const mcp = createMcpServer({ tools, name: 'metadata-gen', version: PKG.version });

  // --- Express -------------------------------------------------------------
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  // Every mutation must come from this page or from a client holding the
  // session token. Origin is checked exactly, Fetch Metadata as a second
  // layer, and the token last. GETs are read-only previews on loopback.
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !state.allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    }
    const site = req.headers['sec-fetch-site'];
    if (site && !['same-origin', 'none'].includes(site)) {
      return res.status(403).json({ error: 'Cross-site requests are not allowed' });
    }
    if (req.headers[TOKEN_HEADER] !== token) {
      return res.status(401).json({ error: 'Missing or invalid session token' });
    }
    next();
  });

  app.use('/preview-assets', express.static(join(__dirname, 'preview-assets')));
  app.use('/uploaded', express.static(outputDir));

  app.get('/', async (req, res) => {
    let html = await readFile(join(__dirname, 'preview.html'), 'utf-8');
    const boot = { token, version: PKG.version, mcpUrl: `${state.baseUrl}/mcp`, addCommand: MCP_ADD_COMMAND };
    html = html.replace('<!-- __METADATA_GEN_BOOT__ -->',
      `<script id="metadata-gen-boot" type="application/json">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>`);
    res.set('Cache-Control', 'no-store').type('html').send(html);
  });

  app.get('/agent-tools.js', (req, res) => {
    res.set('Cache-Control', 'no-store').sendFile(join(__dirname, 'agent-tools.js'));
  });

  // Authenticated so a lockfile can only validate against the server that
  // wrote it; the root lets the shim reject a reused port.
  app.get('/api/health', (req, res) => {
    if (req.headers[TOKEN_HEADER] !== token) {
      return res.status(401).json({ ok: false, error: 'Missing or invalid session token' });
    }
    res.json({ ok: true, pid: process.pid, version: PKG.version, root });
  });

  app.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  app.post('/api/consent', (req, res) => {
    const { id, allowed } = req.body || {};
    const found = answerConsent(String(id), allowed === true);
    res.json({ ok: found });
  });

  app.get('/api/state', (req, res) => res.json(state.snapshot()));
  app.get('/api/config', (req, res) => res.json(config));
  app.get('/api/logo-candidates', (req, res) => res.json(logoCandidates));
  app.get('/api/fonts', (req, res) => res.json(projectFonts));
  app.get('/api/layouts', (req, res) => res.json(layouts));
  app.get('/api/previews', (req, res) => {
    const previews = {};
    for (const [layout, entry] of Object.entries(og)) {
      previews[layout] = `data:image/png;base64,${entry.png.toString('base64')}`;
    }
    res.json(previews);
  });
  app.get('/api/copy', (req, res) => {
    const out = {};
    for (const [layout, entry] of Object.entries(og)) out[layout] = entry.copy;
    res.json(out);
  });
  app.get('/api/tool-info', (req, res) => {
    res.json({
      projectRoot: root,
      templatesDir: projectTemplatesDir,
      agentsMdPath: join(projectTemplatesDir, 'AGENTS.md'),
      existingLetters: layouts,
    });
  });

  app.get('/preview/og/:layout.png', (req, res) => {
    const layout = String(req.params.layout).toUpperCase();
    const entry = og[layout];
    if (!entry) return res.status(404).json({ error: 'Unknown layout' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Revision': String(entry.revision) }).send(entry.png);
  });
  app.get('/preview/favicon/:mode/:size.png', async (req, res) => {
    try {
      const { buffer, revision } = await state.ensureFaviconBuffer(req.params.mode, parseInt(req.params.size, 10));
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Revision': String(revision) }).send(buffer);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  const clientOf = (req) => (typeof req.headers[CLIENT_HEADER] === 'string' ? req.headers[CLIENT_HEADER].slice(0, 64) : null);

  app.post('/api/select', (req, res) => {
    try {
      res.json({ selectedLayout: state.select(req.body && req.body.layout, clientOf(req)) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/social', (req, res) => {
    res.json(state.setSocial(req.body || {}, clientOf(req)));
  });

  app.post('/api/save-config', async (req, res) => {
    try {
      res.json(await state.saveConfig(req.body || {}));
    } catch (err) {
      console.error('Save config error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/render', async (req, res) => {
    try {
      const { layout, overrides, merge } = req.body || {};
      const r = await state.renderOg(layout, overrides, { merge: merge === true, client: clientOf(req) });
      res.json({
        image: `data:image/png;base64,${r.png.toString('base64')}`,
        copy: r.copy,
        revision: r.revision,
        url: r.url,
        overrides: r.overrides,
        ignored: r.ignored,
        stale: r.stale,
      });
    } catch (err) {
      console.error('Render error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/download/og', async (req, res) => {
    try {
      const { layout, revision } = req.body || {};
      res.json(await state.saveOg(layout, revision));
    } catch (err) {
      console.error('Download error:', err.message);
      res.status(err.status || 500).json({ error: err.message, currentRevision: err.currentRevision });
    }
  });

  app.get('/api/favicon-previews', (req, res) => {
    res.json({ revision: favicon.revision, previews: faviconBuffersToDataUrls(favicon.buffers) });
  });

  app.post('/api/render-favicon', async (req, res) => {
    try {
      const { modes, sizes, merge, ...options } = req.body || {};
      const r = await state.renderFavicon(options, { merge: merge === true, modes, sizes, client: clientOf(req) });
      // Legacy shape: previews keyed by mode at the top level, plus metadata.
      res.json({ ...r.previews, revision: r.revision, options: r.options, urls: r.urls, ignored: r.ignored, stale: r.stale });
    } catch (err) {
      console.error('Favicon render error:', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/upload-logo', async (req, res) => {
    try {
      const { filename, dataBase64 } = req.body || {};
      if (typeof filename !== 'string' || typeof dataBase64 !== 'string') {
        return res.status(400).json({ error: 'filename and dataBase64 are required' });
      }
      const safeName = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = extname(safeName).toLowerCase();
      if (!['.svg', '.png', '.jpg', '.jpeg'].includes(ext)) {
        return res.status(400).json({ error: 'Only .svg, .png, .jpg, .jpeg are allowed' });
      }
      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (max 5MB)' });
      }
      await mkdir(outputDir, { recursive: true });
      const destPath = join(outputDir, safeName);
      await writeFile(destPath, buf);
      const relFromRoot = destPath.replace(root, '').replace(/^\//, '');
      const relPath = `./${relFromRoot}`;
      if (!logoCandidates.includes(relPath)) logoCandidates.push(relPath);
      log(`\u2713 Uploaded logo: ${relPath}`);
      res.json({ path: relPath, candidates: logoCandidates });
    } catch (err) {
      console.error('Upload error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/download/favicons', async (req, res) => {
    try {
      const { revision } = req.body || {};
      res.json(await state.saveFavicons(revision));
    } catch (err) {
      console.error('Favicon download error:', err.message);
      res.status(err.status || 500).json({ error: err.message, currentRevision: err.currentRevision });
    }
  });

  app.all('/mcp', mcp.express);

  let httpServer = null;
  async function listenOn(port) {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, LOOPBACK, () => resolve(server));
      server.once('error', reject);
    });
  }
  async function listen(port) {
    if (port !== undefined) {
      httpServer = await listenOn(port);
    } else {
      // The probe and the real bind are not atomic; retry on a lost race.
      let start = 3131;
      for (let attempt = 0; ; attempt++) {
        const candidate = await findPort(start);
        try {
          httpServer = await listenOn(candidate);
          break;
        } catch (err) {
          if (err.code !== 'EADDRINUSE' || attempt >= 5) throw err;
          start = candidate + 1;
        }
      }
    }
    setPort(httpServer.address().port);
    return { port: state.port, url: state.baseUrl };
  }
  function close() {
    clearInterval(heartbeat);
    for (const res of sseClients) res.end();
    sseClients.clear();
    for (const { timer } of pendingConsent.values()) clearTimeout(timer);
    pendingConsent.clear();
    if (httpServer) {
      httpServer.close();
      // Keep-alive sockets from our own shim or a page would otherwise hold
      // the process open until they time out.
      if (typeof httpServer.closeAllConnections === 'function') httpServer.closeAllConnections();
    }
    httpServer = null;
  }

  return { app, state, tools, token, mcp, listen, close, get httpServer() { return httpServer; } };
}

/**
 * Start the preview server for the CLI: listen on loopback, write the
 * lockfile, print how to reach it, open the browser.
 */
export async function startServer(options = {}) {
  const root = options.root || process.cwd();
  const log = options.log || console.log;
  const server = await createPreviewServer({ root, outputDir: options.outputDir, log });
  // An explicit port (--port) is used as-is so tooling can rely on it. A PORT
  // from the environment is only a request: when it is taken, fall back to
  // the first free port from 3131.
  let listening;
  if (options.port !== undefined) {
    if (!(await portIsFree(options.port))) {
      server.close();
      throw new Error(`Port ${options.port} is already in use. Pick another with --port.`);
    }
    try {
      listening = await server.listen(options.port);
    } catch (err) {
      server.close();
      if (err.code === 'EADDRINUSE') throw new Error(`Port ${options.port} is already in use. Pick another with --port.`);
      throw err;
    }
  } else {
    const envPort = Number.parseInt(process.env.PORT || '', 10);
    const requested = Number.isInteger(envPort) ? envPort : undefined;
    listening = await server.listen(requested !== undefined && await portIsFree(requested) ? requested : undefined);
  }
  const { port, url } = listening;
  await writeLockfile(root, { port, url, token: server.token, pid: process.pid, startedAt: new Date().toISOString() });

  log(`\u2713 Server running at ${url} (also http://localhost:${port})`);
  log(`\u2713 Agent tools: MCP at ${url}/mcp (WebMCP in the page where the browser supports it)`);
  log(`  Add to Claude Code: ${MCP_ADD_COMMAND}`);

  if (options.open !== false) {
    try {
      const openModule = await import('open');
      await openModule.default(url);
      log('\u2713 Opening browser...');
    } catch {
      log(`Could not open browser. Preview available at ${url}`);
    }
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    server.close();
    await removeLockfile(root);
  }

  if (options.registerSignals !== false) {
    const stop = () => { close().finally(() => process.exit(0)); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    log('\nPress Ctrl+C to stop.');
  }

  return { url, port, token: server.token, close, server };
}
