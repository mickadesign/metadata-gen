import { readFile, access } from 'node:fs/promises';
import { join, basename } from 'node:path';

const DEFAULTS = {
  colors: {
    background: '#0f0f0f',
    foreground: '#ffffff',
    accent: '#888888',
  },
};

const LOGO_PATHS_SVG = [
  'logo.svg',
  'public/logo.svg',
  'assets/logo.svg',
  'src/assets/logo.svg',
  'public/images/logo.svg',
];

const LOGO_PATHS_PNG = [
  'public/logo.png',
  'src/assets/logo.png',
];

const CSS_PATHS = [
  'globals.css',
  'src/styles/globals.css',
  'app/globals.css',
  'src/app/globals.css',
  'styles/globals.css',
];

const TAILWIND_CONFIG_PATHS = [
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
];

const TOKEN_PATHS = [
  'tokens.json',
  'design-tokens.json',
];

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely read a file, returning null if it doesn't exist.
 */
async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Convert HSL values (space-separated, as used in Tailwind/Shadcn) to hex.
 * Handles formats like "0 0% 6%" or "240 10% 3.9%"
 */
function hslToHex(h, s, l) {
  h = parseFloat(h);
  s = parseFloat(s) / 100;
  l = parseFloat(l) / 100;

  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Parse a CSS color value — handles hex, hsl space-separated, hsl(), oklch() best-effort.
 * Returns a hex string or null.
 */
function parseCssColorValue(value) {
  if (!value) return null;
  value = value.trim().replace(/;$/, '').trim();

  // Direct hex
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    // Normalize 3-char hex to 6-char
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    return value.slice(0, 7); // strip alpha if present
  }

  // Space-separated HSL (Tailwind/Shadcn: "0 0% 6%")
  const hslSpace = value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (hslSpace) {
    return hslToHex(hslSpace[1], hslSpace[2], hslSpace[3]);
  }

  // hsl() function
  const hslFunc = value.match(/hsl\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (hslFunc) {
    return hslToHex(hslFunc[1], hslFunc[2], hslFunc[3]);
  }

  // oklch() — best-effort: skip, return null (too complex for regex)
  if (value.startsWith('oklch(')) {
    return null;
  }

  return null;
}

/**
 * Scan CSS files for custom properties.
 */
async function scanCssColors(root) {
  const colors = {};

  for (const cssPath of CSS_PATHS) {
    const content = await safeRead(join(root, cssPath));
    if (!content) continue;

    // Map of CSS variable names to our color keys
    const varMap = {
      '--background': 'background',
      '--foreground': 'foreground',
      '--accent': 'accent',
      '--primary': 'accent', // fallback for accent
    };

    for (const [varName, colorKey] of Object.entries(varMap)) {
      if (colors[colorKey]) continue; // already found

      // Match: --background: value; (handles multiline)
      const regex = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const parsed = parseCssColorValue(match[1]);
        if (parsed) {
          colors[colorKey] = { value: parsed, source: cssPath };
          break;
        }
      }
    }

    if (colors.background && colors.foreground && colors.accent) break;
  }

  return colors;
}

/**
 * Scan Tailwind v4 CSS @theme blocks for color values.
 */
async function scanTailwindV4Css(root) {
  const colors = {};

  for (const cssPath of CSS_PATHS) {
    const content = await safeRead(join(root, cssPath));
    if (!content) continue;

    // Look for @theme block
    const themeMatch = content.match(/@theme\s*\{([^}]+)\}/s);
    if (!themeMatch) continue;

    const themeBlock = themeMatch[1];

    const varMap = {
      '--color-background': 'background',
      '--color-foreground': 'foreground',
      '--color-accent': 'accent',
      '--color-primary': 'accent',
    };

    for (const [varName, colorKey] of Object.entries(varMap)) {
      if (colors[colorKey]) continue;
      const regex = new RegExp(`${varName}\\s*:\\s*([^;]+);`);
      const match = themeBlock.match(regex);
      if (match) {
        const parsed = parseCssColorValue(match[1]);
        if (parsed) {
          colors[colorKey] = { value: parsed, source: `${cssPath} (@theme)` };
        }
      }
    }
  }

  return colors;
}

/**
 * Scan Tailwind config files (v3) for color hex values via regex.
 */
async function scanTailwindConfig(root) {
  const colors = {};

  for (const configPath of TAILWIND_CONFIG_PATHS) {
    const content = await safeRead(join(root, configPath));
    if (!content) continue;

    // Try to find hex colors near known key names
    const colorKeys = [
      { keys: ['background', 'bg'], target: 'background' },
      { keys: ['foreground', 'fg'], target: 'foreground' },
      { keys: ['accent', 'primary'], target: 'accent' },
    ];

    for (const { keys, target } of colorKeys) {
      if (colors[target]) continue;
      for (const key of keys) {
        // Match patterns like: background: '#0f0f0f' or background: "#0f0f0f"
        const regex = new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]?(#[0-9a-fA-F]{3,8})['"]?`);
        const match = content.match(regex);
        if (match) {
          colors[target] = { value: match[1], source: configPath };
          break;
        }
      }
    }
  }

  return colors;
}

/**
 * Scan design token JSON files.
 */
async function scanTokens(root) {
  const colors = {};

  for (const tokenPath of TOKEN_PATHS) {
    const content = await safeRead(join(root, tokenPath));
    if (!content) continue;

    try {
      const tokens = JSON.parse(content);

      const findColor = (obj, keys) => {
        for (const key of keys) {
          // Check top-level
          if (obj[key] && typeof obj[key] === 'string' && obj[key].startsWith('#')) {
            return obj[key];
          }
          // Check nested under 'color' or 'colors'
          for (const parent of ['color', 'colors']) {
            if (obj[parent]?.[key]?.value) return obj[parent][key].value;
            if (obj[parent]?.[key] && typeof obj[parent][key] === 'string') return obj[parent][key];
          }
        }
        return null;
      };

      const bg = findColor(tokens, ['background', 'bg']);
      if (bg) colors.background = { value: bg, source: tokenPath };

      const fg = findColor(tokens, ['foreground', 'fg', 'text']);
      if (fg) colors.foreground = { value: fg, source: tokenPath };

      const accent = findColor(tokens, ['accent', 'primary', 'brand']);
      if (accent) colors.accent = { value: accent, source: tokenPath };
    } catch {
      // Invalid JSON, skip
    }
  }

  return colors;
}

/**
 * Merge color results from multiple sources in priority order.
 */
function mergeColors(...sources) {
  const result = {};
  for (const colorKey of ['background', 'foreground', 'accent']) {
    for (const source of sources) {
      if (source[colorKey]) {
        result[colorKey] = source[colorKey];
        break;
      }
    }
  }
  return result;
}

/**
 * Scan for title and tagline.
 */
async function scanTitleAndTagline(root) {
  // 1. package.json
  const pkgContent = await safeRead(join(root, 'package.json'));
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      const title = pkg.name || null;
      const tagline = pkg.description || null;
      if (title) {
        return {
          title: { value: title, source: 'package.json .name' },
          tagline: tagline
            ? { value: tagline, source: 'package.json .description' }
            : { value: '', source: null },
        };
      }
    } catch {
      // Invalid JSON
    }
  }

  // 2. README.md first heading
  const readme = await safeRead(join(root, 'README.md'));
  if (readme) {
    const headingMatch = readme.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return {
        title: { value: headingMatch[1].trim(), source: 'README.md' },
        tagline: { value: '', source: null },
      };
    }
  }

  // 3. Folder name
  const folderName = basename(root);
  return {
    title: { value: folderName, source: 'folder name' },
    tagline: { value: '', source: null },
  };
}

/**
 * Scan for logo file.
 */
async function scanLogo(root) {
  // SVG first
  for (const logoPath of LOGO_PATHS_SVG) {
    const fullPath = join(root, logoPath);
    if (await fileExists(fullPath)) {
      return { value: `./${logoPath}`, source: logoPath };
    }
  }

  // PNG fallback
  for (const logoPath of LOGO_PATHS_PNG) {
    const fullPath = join(root, logoPath);
    if (await fileExists(fullPath)) {
      return { value: `./${logoPath}`, source: logoPath };
    }
  }

  return null;
}

/**
 * Main scan function. Returns all inferred values with sources.
 */
export async function scan(root) {
  const { title, tagline } = await scanTitleAndTagline(root);

  // Colors: CSS vars > Tailwind v4 CSS > Tailwind v3 config > tokens > defaults
  const cssColors = await scanCssColors(root);
  const twV4Colors = await scanTailwindV4Css(root);
  const twColors = await scanTailwindConfig(root);
  const tokenColors = await scanTokens(root);
  const merged = mergeColors(cssColors, twV4Colors, twColors, tokenColors);

  const colors = {
    background: merged.background || { value: DEFAULTS.colors.background, source: 'default' },
    foreground: merged.foreground || { value: DEFAULTS.colors.foreground, source: 'default' },
    accent: merged.accent || { value: DEFAULTS.colors.accent, source: 'default' },
  };

  const logo = await scanLogo(root);
  const faviconSrc = logo; // Same as logo for now

  return {
    title,
    tagline,
    colors,
    logo,
    faviconSrc,
  };
}
