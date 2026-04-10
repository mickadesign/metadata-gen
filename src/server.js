import express from 'express';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { renderOgImage, renderAllVariants } from './renderer.js';
import { generateFaviconSet, generateFaviconPreviews } from './favicon.js';
import { scanAllLogos } from './scanner.js';

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

  // Set up Express
  const app = express();
  app.use(express.json());

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

  // API: get all OG previews as base64
  app.get('/api/previews', (req, res) => {
    const previews = {};
    for (const [layout, buffer] of Object.entries(variantBuffers)) {
      previews[layout] = `data:image/png;base64,${buffer.toString('base64')}`;
    }
    res.json(previews);
  });

  const VALID_LAYOUTS = ['A', 'B', 'C'];

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
      const { letter, faviconSrc, background, accent, letterSize, borderRadius } = req.body;
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
