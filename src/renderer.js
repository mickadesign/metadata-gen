import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateCopyVariants } from './copy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGED_TEMPLATES_DIR = join(__dirname, 'templates');
export const PROJECT_TEMPLATES_SUBDIR = 'metadata-templates';
const LAYOUT_FILENAME = /^layout-([a-z])\.js$/;

const templatesCache = new Map();

/**
 * Discover layout templates. Merges two sources in this priority order:
 *   1. <projectRoot>/metadata-templates/layout-*.js  (user overrides & additions)
 *   2. <tool>/src/templates/layout-*.js              (packaged defaults)
 * A letter present in both is taken from the project.
 *
 * See metadata-templates/AGENTS.md (seeded by `metadata-gen init`) for the
 * per-layout contract.
 */
async function discoverTemplates(projectRoot = process.cwd()) {
  if (templatesCache.has(projectRoot)) return templatesCache.get(projectRoot);

  const projectDir = join(projectRoot, PROJECT_TEMPLATES_SUBDIR);
  // Packaged first so the project dir can overwrite keys on top.
  const packaged = await loadTemplatesFromDir(PACKAGED_TEMPLATES_DIR);
  const project = await loadTemplatesFromDir(projectDir);

  const templates = { ...packaged, ...project };
  const letters = Object.keys(templates).sort();
  const result = { templates, letters };
  templatesCache.set(projectRoot, result);
  return result;
}

async function loadTemplatesFromDir(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return {};
  }

  const matches = files
    .map((f) => ({ file: f, match: f.match(LAYOUT_FILENAME) }))
    .filter(({ match }) => match)
    .map(({ file, match }) => ({ file, letter: match[1].toUpperCase() }));

  const loaded = await Promise.all(matches.map(async ({ file, letter }) => {
    const url = pathToFileURL(join(dir, file)).href;
    const mod = await import(url);
    const fn = Object.values(mod).find((v) => typeof v === 'function');
    if (!fn) throw new Error(`Template ${file} has no exported function`);
    return [letter, fn];
  }));

  return Object.fromEntries(loaded);
}

export async function getLayoutLetters(projectRoot) {
  const { letters } = await discoverTemplates(projectRoot);
  return letters;
}

let fontRegular = null;
let fontBold = null;

/**
 * Load Inter fonts (cached after first load).
 */
async function loadFonts() {
  if (!fontRegular) {
    fontRegular = await readFile(join(__dirname, 'fonts', 'Inter-Regular.ttf'));
    fontBold = await readFile(join(__dirname, 'fonts', 'Inter-Bold.ttf'));
  }
  return { regular: fontRegular, bold: fontBold };
}

const customFontCache = new Map();
async function loadCustomFont(relPath, projectRoot) {
  if (customFontCache.has(relPath)) return customFontCache.get(relPath);
  try {
    const buf = await readFile(join(projectRoot, relPath));
    customFontCache.set(relPath, buf);
    return buf;
  } catch {
    return null;
  }
}

/**
 * Load a logo file and return a base64 data URI, or null.
 */
async function loadLogo(logoPath, projectRoot) {
  if (!logoPath) return null;

  try {
    const fullPath = join(projectRoot, logoPath);
    const buffer = await readFile(fullPath);
    const ext = extname(logoPath).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Render a single OG image variant.
 *
 * @param {object} config - Full config from metadata.config.json
 * @param {string} layout - Discovered layout letter (see getLayoutLetters)
 * @param {object} [overrides] - Per-card overrides (headline, tagline, colors, showLogo)
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderOgImage(config, layout, overrides = {}, projectRoot = process.cwd()) {
  const fonts = await loadFonts();
  const { templates, letters } = await discoverTemplates(projectRoot);
  const templateFn = templates[layout];
  if (!templateFn) {
    throw new Error(`Unknown layout: ${layout}`);
  }

  // Generate copy for this variant. Layouts beyond the Nth cycle back.
  const variants = generateCopyVariants(config);
  const layoutIndex = letters.indexOf(layout);
  const copy = variants[layoutIndex % variants.length];

  // Load logo if needed — logoPath override takes precedence
  const showLogo = overrides.showLogo !== false;
  const logoSrc = overrides.logoPath || config.logo;
  const logoBase64 = showLogo ? await loadLogo(logoSrc, projectRoot) : null;

  // Resolve custom heading/tagline fonts (optional)
  const satoriFonts = [
    { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
    { name: 'Inter', data: fonts.bold, weight: 700, style: 'normal' },
  ];

  let headingFontName = 'Inter';
  let taglineFontName = 'Inter';

  if (overrides.headingFont && overrides.headingFont !== '__inter__') {
    const data = await loadCustomFont(overrides.headingFont, projectRoot);
    if (data) {
      satoriFonts.push({ name: 'HeadingFont', data, weight: 400, style: 'normal' });
      satoriFonts.push({ name: 'HeadingFont', data, weight: 700, style: 'normal' });
      headingFontName = 'HeadingFont';
    }
  }

  if (overrides.taglineFont && overrides.taglineFont !== '__inter__') {
    const data = await loadCustomFont(overrides.taglineFont, projectRoot);
    if (data) {
      satoriFonts.push({ name: 'TaglineFont', data, weight: 400, style: 'normal' });
      satoriFonts.push({ name: 'TaglineFont', data, weight: 700, style: 'normal' });
      taglineFontName = 'TaglineFont';
    }
  }

  // Build template config with overrides
  const templateConfig = {
    headline: overrides.headline ?? copy.headline,
    tagline: overrides.tagline ?? copy.tagline,
    colors: {
      background: overrides.background ?? config.colors.background,
      foreground: overrides.foreground ?? config.colors.foreground,
      accent: overrides.accent ?? config.colors.accent,
      tagline: overrides.taglineColor ?? null,
    },
    logoBase64,
    headingSize: overrides.headingSize,
    taglineSize: overrides.taglineSize,
    align: overrides.align,
    logoSize: overrides.logoSize,
    logoGap: overrides.logoGap,
    logoPosition: overrides.logoPosition,
    headingFont: headingFontName,
    taglineFont: taglineFontName,
  };

  // Render via Satori
  const jsx = templateFn(templateConfig);
  const svg = await satori(jsx, {
    width: 1200,
    height: 630,
    fonts: satoriFonts,
  });

  // Convert SVG to PNG via resvg
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

/**
 * Render every discovered OG image variant.
 */
export async function renderAllVariants(config, projectRoot = process.cwd()) {
  const { letters } = await discoverTemplates(projectRoot);
  const results = await Promise.all(
    letters.map(async (layout) => ({
      layout,
      png: await renderOgImage(config, layout, {}, projectRoot),
    }))
  );
  return results;
}
