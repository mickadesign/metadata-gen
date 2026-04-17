import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FAVICON_SIZES = [16, 32, 48, 96, 180, 192, 512];

/**
 * Normalize a hex color to 6-digit format (#rgb -> #rrggbb).
 */
function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') return '#000000';
  hex = hex.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (/^#[0-9a-fA-F]{6,}$/.test(hex)) {
    return hex.slice(0, 7);
  }
  return hex;
}

/**
 * Parse a normalized 6-digit hex string into { r, g, b }.
 */
function hexToRgb(hex) {
  hex = normalizeHex(hex);
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Load a font file by weight. Caches after first read.
 */
const fontCache = {};
async function loadFont(weight) {
  const key = weight >= 600 ? 'bold' : 'regular';
  if (!fontCache[key]) {
    const filename = key === 'bold' ? 'Inter-Bold.ttf' : 'Inter-Regular.ttf';
    fontCache[key] = await readFile(join(__dirname, 'fonts', filename));
  }
  return fontCache[key];
}

/**
 * Generate a lettermark PNG using Satori.
 *
 * Config options:
 * - faviconLetter: custom letter(s) (default: first char of title)
 * - faviconLetterSize: font size as % of icon size (default: 60)
 * - faviconBorderRadius: corner radius as % (default: 19)
 * - faviconFontWeight: 400 or 700 (default: 700)
 * - faviconTransparent: if true, bg is transparent (default: false)
 * - colors.background: bg hex
 * - colors.accent: letter color hex (default fallback: #333)
 */
async function generateLettermarkPng(config, size) {
  const letter = config.faviconLetter || (config.title || 'A')[0].toUpperCase();
  const letterSizePct = config.faviconLetterSize || 60;
  const borderRadiusPct = config.faviconBorderRadius ?? 19;
  const borderRadius = Math.round(size * (borderRadiusPct / 100));
  const fontWeight = config.faviconFontWeight || 700;
  const transparent = config.faviconTransparent || false;
  const letterColor = config.colors.accent || '#333333';
  const bgColor = transparent ? 'transparent' : (config.colors.background || '#ffffff');

  const font = await loadFont(fontWeight);

  const jsx = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: bgColor,
        borderRadius: `${borderRadius}px`,
        fontFamily: 'Inter',
      },
      children: {
        type: 'div',
        props: {
          style: {
            fontSize: Math.round(size * (letterSizePct / 100)),
            fontWeight: fontWeight,
            color: letterColor,
          },
          children: letter,
        },
      },
    },
  };

  const svg = await satori(jsx, {
    width: size,
    height: size,
    fonts: [
      {
        name: 'Inter',
        data: font,
        weight: fontWeight,
        style: 'normal',
      },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

/**
 * Render a logo SVG/PNG to a square PNG at the given size.
 */
async function renderLogoToPng(logoPath, projectRoot, size, config) {
  const fullPath = join(projectRoot, logoPath);
  const buffer = await readFile(fullPath);

  const padding = Math.round(size * 0.1);
  const innerSize = size - padding * 2;

  const resized = await sharp(buffer)
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const transparent = config.faviconTransparent || false;
  const { r, g, b } = hexToRgb(config.colors.background);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r, g, b, alpha: transparent ? 0 : 255 },
    },
  })
    .composite([{ input: resized, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/**
 * Generate the dual-mode favicon.svg with light/dark support.
 */
function generateFaviconSvg(config) {
  const letter = config.faviconLetter || (config.title || 'A')[0].toUpperCase();
  const fontWeight = config.faviconFontWeight || 700;
  const borderRadiusPct = config.faviconBorderRadius ?? 19;
  const rx = Math.round(32 * (borderRadiusPct / 100));
  const letterColor = config.colors.accent || '#333333';

  const bg = config.colors.background;
  const darkBg = bg;
  const darkFg = letterColor;
  const lightBg = '#ffffff';
  const lightFg = letterColor;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
    :root { --bg: ${lightBg}; --fg: ${lightFg}; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: ${darkBg}; --fg: ${darkFg}; }
    }
  </style>
  <rect width="32" height="32" rx="${rx}" fill="var(--bg)"/>
  <text x="16" y="22" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="${fontWeight}" fill="var(--fg)">${letter}</text>
</svg>`;
}

/**
 * Generate the site.webmanifest file content.
 */
function generateWebManifest(config) {
  return JSON.stringify(
    {
      name: config.title || '',
      short_name: config.title || '',
      icons: [
        {
          src: '/metadata/android-chrome-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/metadata/android-chrome-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
      theme_color: config.colors.accent,
      background_color: config.colors.background,
      display: 'standalone',
    },
    null,
    2
  );
}

/**
 * Generate the full favicon set and write to outputDir.
 */
export async function generateFaviconSet(config, projectRoot = process.cwd(), outputDirOverride) {
  const outputDir = outputDirOverride || join(projectRoot, config.outputDir || 'public/metadata');
  await mkdir(outputDir, { recursive: true });

  const hasLogo = !!config.faviconSrc;
  const writtenFiles = [];

  const pngBuffers = {};
  for (const size of FAVICON_SIZES) {
    if (hasLogo) {
      pngBuffers[size] = await renderLogoToPng(config.faviconSrc, projectRoot, size, config);
    } else {
      pngBuffers[size] = await generateLettermarkPng(config, size);
    }
  }

  const pngFileMap = {
    16: 'favicon-16x16.png',
    32: 'favicon-32x32.png',
    96: 'favicon-96x96.png',
    180: 'apple-touch-icon.png',
    192: 'android-chrome-192x192.png',
    512: 'android-chrome-512x512.png',
  };

  for (const [size, filename] of Object.entries(pngFileMap)) {
    const filePath = join(outputDir, filename);
    await writeFile(filePath, pngBuffers[parseInt(size)]);
    writtenFiles.push(filePath);
  }

  const icoBuffer = await pngToIco([pngBuffers[16], pngBuffers[32], pngBuffers[48]]);
  const icoPath = join(outputDir, 'favicon.ico');
  await writeFile(icoPath, icoBuffer);
  writtenFiles.push(icoPath);

  const svgContent = generateFaviconSvg(config);
  const svgPath = join(outputDir, 'favicon.svg');
  await writeFile(svgPath, svgContent);
  writtenFiles.push(svgPath);

  const manifestContent = generateWebManifest(config);
  const manifestPath = join(outputDir, 'site.webmanifest');
  await writeFile(manifestPath, manifestContent);
  writtenFiles.push(manifestPath);

  return writtenFiles;
}

/**
 * Generate favicon preview images for the browser UI.
 * Returns separate light and dark variants at 2x resolution for retina.
 *
 * Shape: { light: { 16: base64, 32: ..., 96: ..., 180: ... }, dark: { ... } }
 */
export async function generateFaviconPreviews(config, projectRoot = process.cwd()) {
  const hasLogo = !!config.faviconSrc;
  const previewSizes = [16, 32, 96, 180];

  // Build light config (white/light bg)
  const lightConfig = {
    ...config,
    colors: { ...config.colors, background: config.colors.background || '#ffffff' },
  };

  // Build dark config (dark bg)
  const darkConfig = {
    ...config,
    colors: { ...config.colors, background: config.faviconDarkBg || '#000000' },
  };

  // Optional custom-bg config
  const customBg = config.faviconCustomBg;
  const customConfig = customBg
    ? { ...config, colors: { ...config.colors, background: customBg } }
    : null;

  const light = {};
  const dark = {};
  const custom = customConfig ? {} : null;

  for (const size of previewSizes) {
    const renderSize = size * 2; // 2x for retina

    if (hasLogo) {
      light[size] = `data:image/png;base64,${(await renderLogoToPng(config.faviconSrc, projectRoot, renderSize, lightConfig)).toString('base64')}`;
      dark[size] = `data:image/png;base64,${(await renderLogoToPng(config.faviconSrc, projectRoot, renderSize, darkConfig)).toString('base64')}`;
      if (custom) custom[size] = `data:image/png;base64,${(await renderLogoToPng(config.faviconSrc, projectRoot, renderSize, customConfig)).toString('base64')}`;
    } else {
      light[size] = `data:image/png;base64,${(await generateLettermarkPng(lightConfig, renderSize)).toString('base64')}`;
      dark[size] = `data:image/png;base64,${(await generateLettermarkPng(darkConfig, renderSize)).toString('base64')}`;
      if (custom) custom[size] = `data:image/png;base64,${(await generateLettermarkPng(customConfig, renderSize)).toString('base64')}`;
    }
  }

  return custom ? { light, dark, custom } : { light, dark };
}
