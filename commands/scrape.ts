import { chromium } from 'playwright';
import {
  convertDateFormat,
  initDatabase,
  performSearch,
  getPaginationInfo,
  goToNextPage,
  processCurrentPage
} from '../lib/scraper.ts';

interface ScrapeOptions {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  output?: string; // path to SQLite DB (optional)
  debug: boolean; // debug mode
}

/**
 * Parse command line arguments for scrape command
 */
function parseScrapeArgs(args: string[]): ScrapeOptions {
  const options: Partial<ScrapeOptions> = {
    debug: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--start' && i + 1 < args.length) {
      options.start = args[++i];
    } else if (arg === '--end' && i + 1 < args.length) {
      options.end = args[++i];
    } else if (arg === '-o' && i + 1 < args.length) {
      options.output = args[++i];
    } else if (arg === '--debug') {
      options.debug = true;
    }
  }

  if (!options.start || !options.end) {
    console.error('Error: --start and --end are required for scrape command');
    console.error('Usage: node cli.ts scrape --start YYYY-MM-DD --end YYYY-MM-DD -o database.db [--debug]');
    process.exit(1);
  }

  return options as ScrapeOptions;
}

/**
 * Main scrape command implementation
 */
export async function scrapeCommand(args: string[]): Promise<void> {
  const options = parseScrapeArgs(args);
  
  console.log(`Date range: ${options.start} to ${options.end}`);
  if (options.output) {
    console.log(`Output database: ${options.output}`);
  } else {
    console.log(`No database specified - running in dry-run mode`);
  }
  if (options.debug) {
    console.log(`Debug mode: enabled (browser visible + 5 min pause after each PDF)`);
  }
  
  // Initialize database
  const db = initDatabase(options.output);
  
  // Convert dates to website format
  const fromDate = convertDateFormat(options.start);
  const toDate = convertDateFormat(options.end);
  
  console.log(`Converted dates: ${fromDate} to ${toDate}`);

  const browser = await chromium.launch({
    headless: !options.debug  // headless OFF when debug is true
  });

  const context = await browser.newContext({
    acceptDownloads: true
  });

  const page = await context.newPage();

  // Perform search
  await performSearch(page, fromDate, toDate);

  // Check pagination info
  const paginationInfo = await getPaginationInfo(page);
  if (paginationInfo) {
    console.log(`\nPagination detected: Page ${paginationInfo.currentPage} of ${paginationInfo.totalPages} (${paginationInfo.totalItems} total items)`);
  } else {
    console.log('\nNo pagination detected - processing single page');
  }

  let downloadCount = 0;
  let currentPage = 1;
  const totalPages = paginationInfo?.totalPages || 1;

  // Process all pages
  while (true) {
    console.log(`\n--- Processing page ${currentPage}/${totalPages} ---`);
    
    const pageCount = await processCurrentPage(page, db, options.debug);
    downloadCount += pageCount;
    
    console.log(`Page ${currentPage} complete: ${pageCount} PDFs downloaded`);

    // Check if there's a next page
    if (currentPage >= totalPages) {
      console.log('No more pages to process');
      break;
    }

    // Try to go to next page
    console.log(`\nNavigating to page ${currentPage + 1}...`);
    const hasNextPage = await goToNextPage(page);
    
    if (!hasNextPage) {
      console.log('Could not find next page button - stopping');
      break;
    }
    
    currentPage++;
  }

  console.log(`\n=== Download complete! ===`);
  console.log(`Total PDFs downloaded: ${downloadCount}`);
  if (options.output) {
    console.log(`Database saved to: ${options.output}`);
  }

  await browser.close();
}
