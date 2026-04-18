import { writeFile, access, mkdir, copyFile, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { scan } from './scanner.js';
import { PROJECT_TEMPLATES_SUBDIR } from './renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Format a scan result line for terminal display.
 */
function formatLine(label, result) {
  const value = result?.value ?? '(not found)';
  const source = result?.source ? `(${result.source})` : '';
  const check = result?.value ? '\u2713' : '\u2717';
  const padLabel = label.padEnd(12);
  const padValue = `"${value}"`.padEnd(34);
  return `${check} ${padLabel} ${padValue} ${source}`;
}

/**
 * Display scan results to the user.
 */
function displayResults(results) {
  console.log('\nmetadata-gen init\n');
  console.log('Scanning project...\n');

  console.log(formatLine('Title:', results.title));
  console.log(formatLine('Tagline:', results.tagline));
  console.log(formatLine('Background:', results.colors.background));
  console.log(formatLine('Foreground:', results.colors.foreground));
  console.log(formatLine('Accent:', results.colors.accent));

  if (results.logo) {
    console.log(formatLine('Logo:', results.logo));
  } else {
    const letter = (results.title?.value || 'A')[0].toUpperCase();
    console.log(`\u2713 Favicon src: "${letter}" (lettermark \u2014 first letter of title)`);
  }

  console.log();
}

/**
 * Prompt user for confirmation.
 */
async function confirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

async function readExistingConfig(configPath) {
  try {
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Build the config object from scan results.
 */
function buildConfig(results, existing = {}) {
  const config = {
    title: results.title?.value || '',
    tagline: results.tagline?.value || '',
    colors: {
      background: results.colors.background.value,
      foreground: results.colors.foreground.value,
      accent: results.colors.accent.value,
    },
    logo: results.logo?.value || null,
    faviconSrc: results.faviconSrc?.value || null,
    outputDir: 'public/metadata',
    font: 'Inter',
  };
  // Preserve a user-set url across re-inits.
  if (existing.url) config.url = existing.url;
  return config;
}

/**
 * Run the init command.
 */
export async function init(options = {}) {
  const root = process.cwd();
  const results = await scan(root);

  // If metadata.config.json already exists, its user-edited title/tagline/url
  // take precedence over scanner defaults — re-running init shouldn't clobber
  // a value the user explicitly set.
  const existing = await readExistingConfig(join(root, 'metadata.config.json'));
  if (existing) {
    if (existing.title) results.title = { value: existing.title, source: 'metadata.config.json' };
    if (existing.tagline) results.tagline = { value: existing.tagline, source: 'metadata.config.json' };
  }

  displayResults(results);

  if (!options.yes) {
    const proceed = await confirm('Confirm? Press Enter to accept, or "n" to cancel.\n> ');
    if (!proceed) {
      console.log('\nCancelled.');
      return;
    }
  }

  const configPath = join(root, 'metadata.config.json');
  const config = buildConfig(results, existing || {});
  const exists = existing !== null;

  if (exists && !options.yes) {
    const overwrite = await confirm('metadata.config.json already exists. Overwrite? [y/N]\n> ');
    if (!overwrite) {
      console.log('\nKept existing config.');
      return;
    }
  } else if (exists && options.yes) {
    // --yes skips all prompts but we still warn
    console.log('\u26a0 Overwriting existing metadata.config.json');
  }

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n\u2713 Written to ${configPath}`);

  await scaffoldTemplatesDir(root);
}

/**
 * Create <project>/metadata-templates/ with a seeded AGENTS.md so agents have
 * a project-local contract to follow when adding new layouts. Existing files
 * are never overwritten.
 */
async function scaffoldTemplatesDir(root) {
  const dir = join(root, PROJECT_TEMPLATES_SUBDIR);
  await mkdir(dir, { recursive: true });

  const agentsSrc = join(__dirname, 'templates', 'AGENTS.md');
  const agentsDst = join(dir, 'AGENTS.md');

  try {
    await copyFile(agentsSrc, agentsDst, fsConstants.COPYFILE_EXCL);
    console.log(`\u2713 Seeded ${agentsDst}`);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}
