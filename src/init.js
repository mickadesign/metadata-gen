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

  if (options.agent !== false) {
    await offerAgentWiring(root, options);
  }
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

// --- Agent wiring ------------------------------------------------------------
//
// Two files make a coding agent use the metadata-gen tools instead of driving
// the preview page with a browser: a project-scoped .mcp.json entry so the
// agent finds the server, and a note in AGENTS.md / CLAUDE.md telling it to
// prefer the tools. Both are merged into existing files and never duplicated.

export const MCP_SERVER_NAME = 'metadata-gen';
export const MCP_SERVER_ENTRY = { command: 'npx', args: ['metadata-gen', 'mcp'] };
export const AGENT_INSTRUCTIONS_MARKER = '<!-- metadata-gen -->';

export function agentInstructions() {
  return [
    '',
    AGENT_INSTRUCTIONS_MARKER,
    '## metadata-gen',
    '',
    'OG image and favicon work: use the `metadata-gen` MCP tools. Start with',
    '`get_project`, then `set_og_overrides`, `set_favicon_options`, `set_social_text`,',
    'and save with `save_og_image`, `save_favicon_set`, `save_config`. Do not drive',
    'the preview page with a browser: the tools update it and return preview URLs.',
    'If a tool reports no server, run `npx metadata-gen` first.',
    '',
  ].join('\n');
}

/**
 * Merge the metadata-gen entry into <root>/.mcp.json. Returns
 * 'created' | 'updated' | 'skipped' (already present) and never drops
 * other servers.
 */
export async function wireMcpJson(root) {
  const path = join(root, '.mcp.json');
  let data = {};
  let existed = false;
  try {
    data = JSON.parse(await readFile(path, 'utf-8'));
    existed = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`.mcp.json is not valid JSON: ${err.message}`);
  }
  if (!data || typeof data !== 'object') data = {};
  data.mcpServers = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {};
  if (data.mcpServers[MCP_SERVER_NAME]) return { path, status: 'skipped' };
  data.mcpServers[MCP_SERVER_NAME] = { ...MCP_SERVER_ENTRY };
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  return { path, status: existed ? 'updated' : 'created' };
}

/**
 * Append the instructions block to AGENTS.md or CLAUDE.md, whichever exists
 * (AGENTS.md is created when neither does). Skipped when the marker is
 * already present in either file.
 */
export async function wireAgentInstructions(root) {
  const candidates = ['AGENTS.md', 'CLAUDE.md'];
  const existing = [];
  for (const name of candidates) {
    try {
      const content = await readFile(join(root, name), 'utf-8');
      existing.push({ name, content });
    } catch {
      // missing
    }
  }
  if (existing.some((f) => f.content.includes(AGENT_INSTRUCTIONS_MARKER))) {
    return { path: join(root, existing.find((f) => f.content.includes(AGENT_INSTRUCTIONS_MARKER)).name), status: 'skipped' };
  }
  const target = existing[0] || { name: 'AGENTS.md', content: '' };
  const path = join(root, target.name);
  const separator = target.content && !target.content.endsWith('\n') ? '\n' : '';
  await writeFile(path, target.content + separator + agentInstructions());
  return { path, status: existing[0] ? 'updated' : 'created' };
}

async function offerAgentWiring(root, options) {
  if (!options.yes) {
    const ok = await confirm('\nWire up agent access? Adds a metadata-gen entry to .mcp.json and a note to AGENTS.md. [Y/n]\n> ');
    if (!ok) {
      console.log('Skipped agent wiring. Run `metadata-gen init` again to add it later.');
      return;
    }
  }
  const mcp = await wireMcpJson(root);
  const notes = await wireAgentInstructions(root);
  const describe = (r) => (r.status === 'skipped' ? `already set up in ${r.path}` : `${r.status} ${r.path}`);
  console.log(`\u2713 Agent config: ${describe(mcp)}`);
  console.log(`\u2713 Agent instructions: ${describe(notes)}`);
  console.log('  Claude Code picks up .mcp.json on next start and asks once to approve the server.');
}
