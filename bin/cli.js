#!/usr/bin/env node

import { Command } from 'commander';
import { init } from '../src/init.js';

const program = new Command();

program
  .name('metadata-gen')
  .description('Generate metadata images and favicon sets from your project')
  .version('0.1.0');

program
  .command('init')
  .description('Scan project and write metadata.config.json')
  .option('--yes', 'Skip confirmation, accept all inferred values')
  .action(async (opts) => {
    try {
      await init({ yes: opts.yes });
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
  .action(async (opts) => {
    try {
      const { startServer } = await import('../src/server.js');
      await startServer({
        open: opts.open,
        outputDir: opts.output,
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

program.parse();
