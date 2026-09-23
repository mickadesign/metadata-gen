#!/usr/bin/env node

import { Command, InvalidArgumentError } from 'commander';
import { createRequire } from 'node:module';
import { init } from '../src/init.js';

const { version } = createRequire(import.meta.url)('../package.json');
const program = new Command();

program
  .name('metadata-gen')
  .description('Generate metadata images and favicon sets from your project')
  .version(version);

program
  .command('init')
  .description('Scan project and write metadata.config.json')
  .option('--yes', 'Skip confirmation, accept all inferred values')
  .option('--no-agent', 'Do not offer to wire up agent access (.mcp.json, AGENTS.md)')
  .action(async (opts) => {
    try {
      await init({ yes: opts.yes, agent: opts.agent });
    } catch (err) {
      console.error('Error during init:', err.message);
      process.exit(1);
    }
  });

program
  .command('generate', { isDefault: true })
  .description('Generate previews and start the local server')
  .option('--no-open', 'Skip auto-opening the browser')
  .option('--output <dir>', 'Override output directory')
  .option('--port <number>', 'Serve on this exact port (fails if it is taken)', (value) => {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new InvalidArgumentError('Port must be an integer between 1 and 65535.');
    }
    return port;
  })
  .action(async (opts) => {
    try {
      const { startServer } = await import('../src/server.js');
      await startServer({
        open: opts.open,
        outputDir: opts.output,
        port: opts.port,
      });
    } catch (err) {
      if (err.code === 'CONFIG_NOT_FOUND') {
        console.error('No metadata.config.json found. Run `metadata-gen init` first.');
        process.exit(1);
      }
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('mcp')
  .description('Expose the preview tools to an agent over stdio (for .mcp.json / claude mcp add)')
  .action(async () => {
    try {
      const { runMcpShim } = await import('../src/mcp-stdio.js');
      await runMcpShim({ root: process.cwd() });
      // stdin closed and the server (if we started one) is released; do not
      // let a lingering socket keep the agent's subprocess alive.
      process.exit(0);
    } catch (err) {
      if (err.code === 'CONFIG_NOT_FOUND') {
        console.error('No metadata.config.json found. Run `metadata-gen init` first.');
        process.exit(1);
      }
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();
