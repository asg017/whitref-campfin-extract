#!/usr/bin/env -S node --experimental-strip-types --experimental-sqlite
/**
 * CLI entry point for campaign finance extraction tools
 * Usage:
 *   campfin scrape --start YYYY-MM-DD --end YYYY-MM-DD -o database.db [--debug]
 *   campfin export database.db -o output-dir
 */

import { scrapeCommand } from './commands/scrape.ts';
import { exportCommand } from './commands/export.ts';

const args = process.argv.slice(2);

if (args.length === 0) {
  printUsage();
  process.exit(1);
}

const command = args[0];

switch (command) {
  case 'scrape':
    await scrapeCommand(args.slice(1));
    break;
  case 'export':
    await exportCommand(args.slice(1));
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}

function printUsage() {
  console.error('Usage:');
  console.error('  campfin scrape --start YYYY-MM-DD --end YYYY-MM-DD -o database.db [--debug]');
  console.error('  campfin export database.db -o output-dir');
  console.error('');
  console.error('Examples:');
  console.error('  campfin scrape --start 2025-01-01 --end 2025-12-31 -o campfin.db');
  console.error('  campfin scrape --start 2025-01-01 --end 2025-12-31 -o campfin.db --debug');
  console.error('  campfin export campfin.db -o ./pdfs');
}
