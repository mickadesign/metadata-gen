import express from 'express';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { renderOgImage, renderAllVariants, getLayoutLetters, PROJECT_TEMPLATES_SUBDIR } from './renderer.js';
import { generateFaviconSet, generateFaviconPreviews } from './favicon.js';
import { scanAllLogos, scanFonts } from './scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Try to find an available port starting from the given port.
 */
async function findPort(startPort, maxAttempts = 3) {
  const net = await import('node:net');
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const available = await new Promise((resolve) => {
      const server = net.default.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
    if (available) return port;
  }
  throw new Error(`No available port found (tried ${startPort}-${startPort + maxAttempts - 1})`);
}

/**
 * Prompt in the terminal for overwrite confirmation.
 */
async function promptOverwrite(filePath) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${filePath} already exists. Overwrite? [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Start the preview server.
 */
export async function startServer(options = {}) {
  const root = process.cwd();
  const configPath = join(root, 'metadata.config.json');

  // Check config exists
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

  // Ensure required fields exist
  config.colors = config.colors || {};
  config.colors.background = config.colors.background || '#0f0f0f';
  config.colors.foreground = config.colors.foreground || '#ffffff';
  config.colors.accent = config.colors.accent || '#888888';
  config.title = config.title || '';
  config.tagline = config.tagline || '';

  const outputDir = options.outputDir || join(root, config.outputDir || 'public/metadata');

  console.log('\nmetadata-gen\n');
  console.log('\u2713 Read metadata.config.json');

  if (config.logo) {
    console.log(`\u2713 Found logo: ${config.logo}`);
  }

  console.log('\u2713 Rendering metadata image variants...');

  // Pre-render all variants
  const variants = await renderAllVariants(config, root);
  const variantBuffers = {};
  for (const v of variants) {
    variantBuffers[v.layout] = v.png;
  }

  console.log('\u2713 Rendering favicon set...');

  // Pre-render favicon previews
  let faviconPreviews = await generateFaviconPreviews(config, root);

  // Scan for all logo candidates
  const logoCandidates = await scanAllLogos(root);

  // Scan for TTF/OTF fonts in the project
  const projectFonts = await scanFonts(root);
  const fontPaths = new Set(projectFonts.map((f) => f.path));

  // Set up Express
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Serve static preview assets (browser tab mockups, etc.)
  app.use('/preview-assets', express.static(join(__dirname, 'preview-assets')));

  // Serve uploaded logos so the browser can preview them directly
  app.use('/uploaded', express.static(outputDir));

  // Serve preview HTML
  app.get('/', async (req, res) => {
    const html = await readFile(join(__dirname, 'preview.html'), 'utf-8');
    res.type('html').send(html);
  });

  // API: get config
  app.get('/api/config', (req, res) => {
    res.json(config);
  });

  // API: get all logo candidates
  app.get('/api/logo-candidates', (req, res) => {
    res.json(logoCandidates);
  });

  // API: get all scanned project fonts
  app.get('/api/fonts', (req, res) => {
    res.json(projectFonts);
  });

  // API: get all OG previews as base64
  app.get('/api/previews', (req, res) => {
    const previews = {};
    for (const [layout, buffer] of Object.entries(variantBuffers)) {
      previews[layout] = `data:image/png;base64,${buffer.toString('base64')}`;
    }
    res.json(previews);
  });

  const VALID_LAYOUTS = await getLayoutLetters(root);

  // API: list available layouts (auto-discovered from packaged + project templates)
  app.get('/api/layouts', (req, res) => {
    res.json(VALID_LAYOUTS);
  });

  // API: absolute paths used by Option 4 so the copied prompt points at the
  // user's own project directory — any agent can read/write there regardless
  // of where metadata-gen is installed.
  const projectTemplatesDir = join(root, PROJECT_TEMPLATES_SUBDIR);
  const toolInfo = {
    projectRoot: root,
    templatesDir: projectTemplatesDir,
    agentsMdPath: join(projectTemplatesDir, 'AGENTS.md'),
    existingLetters: VALID_LAYOUTS,
  };
  app.get('/api/tool-info', (req, res) => {
    res.json(toolInfo);
  });

  // API: persist title / tagline / url edits back to metadata.config.json.
  // The user still has to rebuild their site for the new meta tags to appear
  // — this only updates the source of truth the preview reads from.
  app.post('/api/save-config', async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      for (const key of ['title', 'tagline', 'url']) {
        if (typeof body[key] === 'string') patch[key] = body[key].slice(0, 500);
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'Nothing to save' });
      }
      Object.assign(config, patch);
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
      res.json({ ok: true, config });
    } catch (err) {
      console.error('Save config error:', err.message);
      res.status(500).json({ error: 'Save failed' });
    }
  });

  // API: re-render a single variant with overrides
  app.post('/api/render', async (req, res) => {
    try {
      const { layout, overrides } = req.body;
      if (!VALID_LAYOUTS.includes(layout)) {
        return res.status(400).json({ error: `Invalid layout. Must be one of: ${VALID_LAYOUTS.join(', ')}` });
      }
      // Sanitize overrides — only allow known keys
      const safe = {};
      if (overrides && typeof overrides === 'object') {
        for (const key of ['headline', 'tagline', 'background', 'foreground', 'accent', 'taglineColor']) {
          if (typeof overrides[key] === 'string') safe[key] = overrides[key].slice(0, 500);
        }
        for (const key of ['headingSize', 'taglineSize']) {
          if (typeof overrides[key] === 'number' && overrides[key] >= 12 && overrides[key] <= 120) {
            safe[key] = overrides[key];
          }
        }
        if (typeof overrides.logoSize === 'number' && overrides.logoSize >= 24 && overrides.logoSize <= 300) {
          safe.logoSize = overrides.logoSize;
        }
        if (typeof overrides.logoGap === 'number' && overrides.logoGap >= 0 && overrides.logoGap <= 160) {
          safe.logoGap = overrides.logoGap;
        }
        if (['left', 'center', 'right'].includes(overrides.align)) {
          safe.align = overrides.align;
        }
        if (['left', 'top'].includes(overrides.logoPosition)) {
          safe.logoPosition = overrides.logoPosition;
        }
        for (const key of ['headingFont', 'taglineFont']) {
          const v = overrides[key];
          if (v === '__inter__') safe[key] = '__inter__';
          else if (typeof v === 'string' && fontPaths.has(v)) safe[key] = v;
        }
        if (typeof overrides.showLogo === 'boolean') safe.showLogo = overrides.showLogo;
        if (typeof overrides.logoPath === 'string' && logoCandidates.includes(overrides.logoPath)) {
          safe.logoPath = overrides.logoPath;
        }
      }
      const png = await renderOgImage(config, layout, safe, root);
      // Update cached buffer
      variantBuffers[layout] = png;
      res.json({
        image: `data:image/png;base64,${png.toString('base64')}`,
      });
    } catch (err) {
      console.error('Render error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // API: download a chosen OG image
  app.post('/api/download/og', async (req, res) => {
    try {
      const { layout } = req.body;
      if (!VALID_LAYOUTS.includes(layout)) {
        return res.status(400).json({ error: 'Invalid layout' });
      }
      const buffer = variantBuffers[layout];
      if (!buffer) {
        return res.status(400).json({ error: 'Unknown layout' });
      }

      await mkdir(outputDir, { recursive: true });
      const filePath = join(outputDir, 'og.png');

      // Check if file exists
      let shouldWrite = true;
      try {
        await access(filePath);
        // File exists — in server mode, auto-overwrite (user confirmed via UI)
        shouldWrite = true;
      } catch {
        // File doesn't exist, write it
      }

      if (shouldWrite) {
        await writeFile(filePath, buffer);
        const relativePath = filePath.replace(root, '').replace(/^\//, '');
        console.log(`\u2713 Saved ${relativePath}`);
        res.json({ path: relativePath });
      }
    } catch (err) {
      console.error('Download error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // API: get favicon previews
  app.get('/api/favicon-previews', (req, res) => {
    res.json(faviconPreviews);
  });

  // API: re-render favicon previews with overrides
  app.post('/api/render-favicon', async (req, res) => {
    try {
      const { letter, faviconSrc, background, accent, letterSize, borderRadius, transparent, fontWeight, darkBg, customBg } = req.body;
      const overrideConfig = {
        ...config,
        colors: { ...config.colors },
      };
      if (typeof letter === 'string' && letter.length > 0) {
        overrideConfig.faviconLetter = letter.slice(0, 4);
      }
      if (typeof letterSize === 'number' && letterSize >= 20 && letterSize <= 80) {
        overrideConfig.faviconLetterSize = letterSize;
      }
      if (typeof borderRadius === 'number' && borderRadius >= 0 && borderRadius <= 50) {
        overrideConfig.faviconBorderRadius = borderRadius;
      }
      if (typeof fontWeight === 'number' && [400, 700].includes(fontWeight)) {
        overrideConfig.faviconFontWeight = fontWeight;
      }
      if (typeof transparent === 'boolean') {
        overrideConfig.faviconTransparent = transparent;
      }
      if (typeof darkBg === 'string') {
        overrideConfig.faviconDarkBg = darkBg;
      }
      if (typeof customBg === 'string') {
        overrideConfig.faviconCustomBg = customBg;
      }
      if (faviconSrc === null) {
        overrideConfig.faviconSrc = null;
      } else if (typeof faviconSrc === 'string' && logoCandidates.includes(faviconSrc)) {
        overrideConfig.faviconSrc = faviconSrc;
      }
      if (typeof background === 'string') overrideConfig.colors.background = background;
      if (typeof accent === 'string') overrideConfig.colors.accent = accent;
      faviconPreviews = await generateFaviconPreviews(overrideConfig, root);
      res.json(faviconPreviews);
    } catch (err) {
      console.error('Favicon render error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // API: upload a logo file (base64-encoded JSON)
  app.post('/api/upload-logo', async (req, res) => {
    try {
      const { filename, dataBase64 } = req.body;
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
      // Relative path from project root for use by the renderer/favicon pipeline
      const relFromRoot = destPath.replace(root, '').replace(/^\//, '');
      const relPath = `./${relFromRoot}`;
      if (!logoCandidates.includes(relPath)) logoCandidates.push(relPath);
      console.log(`\u2713 Uploaded logo: ${relPath}`);
      res.json({ path: relPath, candidates: logoCandidates });
    } catch (err) {
      console.error('Upload error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // API: download full favicon set
  app.post('/api/download/favicons', async (req, res) => {
    try {
      const files = await generateFaviconSet(config, root, outputDir);
      const relativePaths = files.map((f) => f.replace(root, '').replace(/^\//, ''));
      console.log(`\u2713 Saved favicon set (${files.length} files)`);
      res.json({ files: relativePaths, count: files.length });
    } catch (err) {
      console.error('Favicon download error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Start server
  const port = await findPort(3131);
  app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.log(`\u2713 Server running at ${url}`);

    if (options.open !== false) {
      try {
        const openModule = await import('open');
        await openModule.default(url);
        console.log('\u2713 Opening browser...');
      } catch {
        console.log(`Could not open browser. Preview available at ${url}`);
      }
    }

    console.log('\nPress Ctrl+C to stop.');
  });
}
