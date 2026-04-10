import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutA } from './templates/layout-a.js';
import { layoutB } from './templates/layout-b.js';
import { layoutC } from './templates/layout-c.js';
import { generateCopyVariants } from './copy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const templates = {
  A: layoutA,
  B: layoutB,
  C: layoutC,
};

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
 * @param {string} layout - Layout name: 'A', 'B', or 'C'
 * @param {object} [overrides] - Per-card overrides (headline, tagline, colors, showLogo)
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderOgImage(config, layout, overrides = {}, projectRoot = process.cwd()) {
  const fonts = await loadFonts();
  const templateFn = templates[layout];
  if (!templateFn) {
    throw new Error(`Unknown layout: ${layout}`);
  }

  // Generate copy for this variant index
  const variants = generateCopyVariants(config);
  const variantIndex = { A: 0, B: 1, C: 2 }[layout];
  const copy = variants[variantIndex];

  // Load logo if needed — logoPath override takes precedence
  const showLogo = overrides.showLogo !== false;
  const logoSrc = overrides.logoPath || config.logo;
  const logoBase64 = showLogo ? await loadLogo(logoSrc, projectRoot) : null;

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
    headingSize: overrides.headingSize ?? undefined,
    taglineSize: overrides.taglineSize ?? undefined,
  };

  // Render via Satori
  const jsx = templateFn(templateConfig);
  const svg = await satori(jsx, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Inter',
        data: fonts.regular,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Inter',
        data: fonts.bold,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  // Convert SVG to PNG via resvg
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

/**
 * Render all 3 OG image variants.
 *
 * @param {object} config
 * @param {string} projectRoot
 * @returns {Promise<Array<{ layout: string, png: Buffer }>>}
 */
export async function renderAllVariants(config, projectRoot = process.cwd()) {
  const results = await Promise.all(
    ['A', 'B', 'C'].map(async (layout) => ({
      layout,
      png: await renderOgImage(config, layout, {}, projectRoot),
    }))
  );
  return results;
}
