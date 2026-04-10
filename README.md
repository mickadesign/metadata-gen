# metadata-gen

Generate metadata images and a complete favicon set from your project's existing assets and config. No API keys, no external services — everything runs locally.

**What it does:**

- Scans your project for colors, logo, title, and tagline
- Generates 3 OG image options (1200x630) using different layouts
- Generates a full favicon set (ICO, SVG with light/dark mode, PNGs, webmanifest)
- Opens a local preview where you can refine and download

## Quick start

```bash
npx metadata-gen init
npx metadata-gen
```

That's it. Two commands, under 90 seconds.

## How it works

### Step 1 — Init

```bash
npx metadata-gen init
```

Scans your project root and writes `metadata.config.json`:

```
metadata-gen init

Scanning project...

✓ Title:       "Vybe"                         (package.json .name)
✓ Tagline:     "Your AI team, ready to work"  (package.json .description)
✓ Background:  #0f0f0f                        (globals.css --background)
✓ Foreground:  #ffffff                        (globals.css --foreground)
✓ Accent:      #7C3AED                        (tailwind.config.js)
✓ Logo:        ./assets/logo.svg

Confirm? Press Enter to accept, or "n" to cancel.
```

Skip confirmation with `--yes`:

```bash
npx metadata-gen init --yes
```

### Step 2 — Generate and preview

```bash
npx metadata-gen
```

Renders all variants, starts a local server, and opens your browser:

```
✓ Read metadata.config.json
✓ Rendering metadata image variants...
✓ Rendering favicon set...
✓ Server running at http://localhost:3131
✓ Opening browser...
```

The preview page shows:

- **3 metadata image options** side by side — each with a refine panel (colors, text, logo toggle) and a download button
- **Favicon set** at multiple sizes in light and dark mode — with a single "Download full set" button

Downloads write directly to `public/metadata/` in your repo.

### Flags

```bash
npx metadata-gen --no-open        # skip auto browser open
npx metadata-gen --output <dir>   # override output directory
```

## What it scans

All scanning is static and read-only — no project code is executed.

| Field | Sources (priority order) |
|-------|------------------------|
| Title | `package.json` name, `README.md` heading, folder name |
| Tagline | `package.json` description |
| Colors | CSS custom properties (`--background`, `--foreground`, `--accent`), Tailwind v4 `@theme` blocks, Tailwind v3 config, design token JSON files |
| Logo | `logo.svg` in root, `public/`, `assets/`, `src/assets/` (SVG preferred, PNG fallback) |

If no logo is found, a lettermark (first letter of title) is generated for favicons.

## Output

Everything lands in `public/metadata/`:

```
public/metadata/
├── og.png                    # chosen metadata image (1200x630)
├── favicon.ico               # 16+32+48 multi-size ICO
├── favicon.svg               # single SVG with light/dark mode
├── favicon-16x16.png
├── favicon-32x32.png
├── favicon-96x96.png
├── apple-touch-icon.png      # 180x180
├── android-chrome-192x192.png
├── android-chrome-512x512.png
└── site.webmanifest
```

## Config

`metadata.config.json` is written by `init` and lives at your project root:

```json
{
  "title": "Vybe",
  "tagline": "Your AI team, ready to work",
  "colors": {
    "background": "#0f0f0f",
    "foreground": "#ffffff",
    "accent": "#7C3AED"
  },
  "logo": "./assets/logo.svg",
  "faviconSrc": "./assets/logo.svg",
  "outputDir": "public/metadata",
  "font": "Inter"
}
```

All fields are optional with sensible defaults. Edit directly or re-run `init`.

## Requirements

- Node.js 18+

## License

MIT
