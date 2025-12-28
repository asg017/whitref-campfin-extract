import { chromium, } from 'playwright';
import type {Locator, Page} from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FilingRecord {
  formType: string;              // Full text from Form Type column
  filingDate: string;            // Date in YYYY-MM-DD format
  filerName: string;             // Full text from Filer Name column
  candidateLastName: string;     // Full text from Candidate Last Name column
  candidateFirstName: string;    // Full text from Candidate First Name column
  candidateMiddleName: string;   // Full text from Candidate Middle Name column
}

interface CliOptions {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  output?: string; // path to SQLite DB (optional)
  debug: boolean; // debug mode
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Partial<CliOptions> = {
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
    console.error('Usage: node scrape.ts --start YYYY-MM-DD --end YYYY-MM-DD [-o path/to/db.sqlite] [--debug]');
    console.error('Example: node scrape.ts --start 2025-01-01 --end 2025-12-31 -o campfin.db');
    console.error('Example: node scrape.ts --start 2025-01-01 --end 2025-12-31 --debug');
    process.exit(1);
  }

  return options as CliOptions;
}

/**
 * Convert YYYY-MM-DD to MM/DD/YYYY format for the website
 */
function convertDateFormat(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year}`;
}

/**
 * Initialize SQLite database with schema
 */
function initDatabase(dbPath: string | undefined): DatabaseSync | null {
  if (!dbPath) {
    return null;
  }
  
  const db = new DatabaseSync(dbPath);
  
  // Create filings metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS filings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_type TEXT NOT NULL,
      filing_date TEXT NOT NULL,
      filer_name TEXT NOT NULL,
      candidate_last_name TEXT NOT NULL,
      candidate_first_name TEXT NOT NULL,
      candidate_middle_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(form_type, filing_date, filer_name, candidate_last_name, candidate_first_name)
    )
  `);
  
  // Create PDF blobs table with foreign key
  db.exec(`
    CREATE TABLE IF NOT EXISTS filing_pdfs (
      filing_id INTEGER PRIMARY KEY,
      pdf_blob BLOB NOT NULL,
      FOREIGN KEY (filing_id) REFERENCES filings(id) ON DELETE CASCADE
    )
  `);
  
  console.log(`Database initialized at: ${dbPath}`);
  return db;
}

/**
 * Save PDF to database
 */
function savePdfToDb(db: DatabaseSync | null, record: FilingRecord, pdfBuffer: Buffer): void {
  if (!db) {
    console.log(`  Skipping database save (no -o specified)`);
    return;
  }
  
  const filename = `${record.filingDate}.${record.filerName}.${record.formType}.pdf`;
  
  // Insert or update the filing metadata
  const stmtFiling = db.prepare(`
    INSERT INTO filings (form_type, filing_date, filer_name, candidate_last_name, candidate_first_name, candidate_middle_name, file_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(form_type, filing_date, filer_name, candidate_last_name, candidate_first_name) 
    DO UPDATE SET file_name = excluded.file_name
    RETURNING id
  `);
  
  const result = stmtFiling.get(
    record.formType, 
    record.filingDate, 
    record.filerName, 
    record.candidateLastName,
    record.candidateFirstName,
    record.candidateMiddleName,
    filename
  ) as { id: number };
  
  const filingId = result.id;
  
  // Insert or replace the PDF blob
  const stmtPdf = db.prepare(`
    INSERT OR REPLACE INTO filing_pdfs (filing_id, pdf_blob)
    VALUES (?, ?)
  `);
  
  stmtPdf.run(filingId, pdfBuffer);
}

/**
 * Extract filing record data from a table row
 */
function extractFilingRecord(
  formTypeText: string | null,
  filingDateText: string | null,
  filerNameText: string | null,
  candidateLastNameText: string | null,
  candidateFirstNameText: string | null,
  candidateMiddleNameText: string | null
): FilingRecord | null {
  if (!filingDateText || !formTypeText) {
    return null;
  }

  // Parse filing date (format: M/D/YYYY) and convert to YYYY-MM-DD
  const filingDateRaw = filingDateText.trim();
  const [month, day, year] = filingDateRaw.split('/');
  const filingDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  // Store exact values from columns
  const formType = formTypeText.trim();
  const filerName = filerNameText?.trim() || '';
  const candidateLastName = candidateLastNameText?.trim() || '';
  const candidateFirstName = candidateFirstNameText?.trim() || '';
  const candidateMiddleName = candidateMiddleNameText?.trim() || '';

  return { 
    formType, 
    filingDate, 
    filerName,
    candidateLastName,
    candidateFirstName,
    candidateMiddleName
  };
}

/**
 * Extract PDF URL from iframe
 */
async function extractPdfUrlFromIframe(page: Page): Promise<string | null> {
  const frames = page.frames();
  console.log(`  Found ${frames.length} frames`);

  for (const frame of frames) {
    try {
      const pdfObject = await frame.locator('object[type="application/pdf"]').first();
      if (await pdfObject.count() > 0) {
        console.log('  Found PDF object in frame');
        const pdfUrl = await pdfObject.getAttribute('data');
        if (pdfUrl) {
          console.log(`  Extracted PDF URL: ${pdfUrl}`);
          return pdfUrl;
        }
      }
    } catch (e) {
      // Frame might not be accessible, continue
    }
  }

  return null;
}

/**
 * Extract session key from PDF handler URL
 */
function extractSessionKey(pdfUrl: string): string | null {
  const keyMatch = pdfUrl.match(/PdfHandler\.axd[^?]*\?key=([a-f0-9]{32})/);
  return keyMatch ? keyMatch[1] : null;
}

/**
 * Build the PDF download URL
 */
function buildDownloadUrl(key: string): string {
  return `https://www.southtechhosting.com/WhittierCity/CampaignDocsWebRetrieval/PdfHandler.axd?key=${key}PdfDownloadSessionKey&download=True&fileName=Form`;
}

/**
 * Download PDF using fetch in the browser context
 */
async function downloadPdfData(page: Page, downloadUrl: string): Promise<Buffer> {
  const pdfData = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    // Convert to array so we can transfer it back to Node
    return Array.from(new Uint8Array(arrayBuffer));
  }, downloadUrl);

  return Buffer.from(pdfData);
}

/**
 * Verify if buffer is a valid PDF
 */
function isValidPdf(buffer: Buffer): boolean {
  return buffer.length > 100 && 
         buffer[0] === 0x25 && 
         buffer[1] === 0x50 && 
         buffer[2] === 0x44 && 
         buffer[3] === 0x46;
}

/**
 * Process a single filing record and download its PDF
 */
async function processFilingRecord(
  page: Page,
  pdfLink: Locator,
  record: FilingRecord,
  db: DatabaseSync | null,
  debugMode: boolean
): Promise<boolean> {
  try {
    console.log(`Processing: ${record.filingDate}.${record.filerName}.${record.formType}.pdf`);

    // Click the PDF link to open the iframe
    console.log('  Clicking PDF link...');
    await pdfLink.click();

    // Wait for the iframe/popup to appear
    console.log('  Waiting for popup/iframe...');
    await page.waitForTimeout(1500);

    // Extract PDF URL from iframe
    console.log('  Looking for iframe...');
    const pdfUrl = await extractPdfUrlFromIframe(page);

    if (!pdfUrl) {
      console.error(`  ❌ Could not find PDF URL for ${record.filerName}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      return false;
    }

    // Extract session key
    const key = extractSessionKey(pdfUrl);
    if (!key) {
      console.error(`  ❌ Could not extract key from URL: ${pdfUrl}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      return false;
    }

    console.log(`  Extracted key: ${key}`);

    // Build download URL
    const downloadUrl = buildDownloadUrl(key);
    console.log(`  Download URL: ${downloadUrl}`);

    // Download PDF
    console.log('  Attempting download via fetch...');
    const buffer = await downloadPdfData(page, downloadUrl);
    console.log(`  Response size: ${buffer.length} bytes`);

    // Verify and save PDF
    if (isValidPdf(buffer)) {
      savePdfToDb(db, record, buffer);
      console.log(`✓ Saved to database: ${record.filingDate}.${record.filerName}.${record.formType}.pdf`);
      
      // Close the popup
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
      // Debug mode: wait 5 minutes for manual inspection
      if (debugMode) {
        console.log('  ⏸️  Debug mode: waiting 5 minutes for manual inspection...');
        await page.waitForTimeout(5 * 60 * 1000); // 5 minutes
      }
      
      return true;
    } else {
      console.error(`  ❌ Response is not a valid PDF`);
      console.error(`  First 100 chars: ${buffer.slice(0, 100).toString()}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      return false;
    }

  } catch (err) {
    console.error(`  ❌ Error downloading PDF for ${record.filerName}:`, err instanceof Error ? err.message : String(err));
    // Try to close any open dialogs
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return false;
  }
}

/**
 * Navigate to search page and perform search
 */
async function performSearch(page: Page, fromDate: string, toDate: string): Promise<void> {
  console.log('Navigating to the search page...');
  await page.goto('https://www.southtechhosting.com/WhittierCity/CampaignDocsWebRetrieval/Search/SearchByFiledForm.aspx');
  await page.waitForLoadState('networkidle');

  console.log('Setting date range...');
  const fromDateInput = page.locator('input[name*="From"], input[id*="From"]').first();
  await fromDateInput.fill(fromDate);

  const toDateInput = page.locator('input[name*="To"], input[id*="To"]').first();
  await toDateInput.fill(toDate);

  console.log('Clicking search button...');
  await page.click('span.dx-vam:has-text("Search")');

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

/**
 * Get pagination info from the page
 */
async function getPaginationInfo(page: Page): Promise<{ currentPage: number; totalPages: number; totalItems: number } | null> {
  try {
    const pagerText = await page.locator('b.dxp-lead.dxp-summary').textContent({ timeout: 5000 });
    if (!pagerText) {
      return null;
    }

    // Parse "Page 1 of 5 (46 items)"
    const match = pagerText.match(/Page (\d+) of (\d+) \((\d+) items\)/);
    if (!match) {
      return null;
    }

    return {
      currentPage: parseInt(match[1], 10),
      totalPages: parseInt(match[2], 10),
      totalItems: parseInt(match[3], 10),
    };
  } catch (e) {
    // Timeout or element not found - no pagination
    return null;
  }
}

/**
 * Click next page button
 */
async function goToNextPage(page: Page): Promise<boolean> {
  // Look for the "Next" button that is NOT disabled
  const nextButton = page.locator('a.dxp-button.dxp-bi:has(img[alt="Next"])');
  
  if (await nextButton.count() === 0) {
    return false;
  }

  await nextButton.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  return true;
}

/**
 * Process all rows on the current page
 */
async function processCurrentPage(
  page: Page,
  db: DatabaseSync | null,
  debugMode: boolean
): Promise<number> {
  const rows = await page.locator('tr[id*="gridFilers_DXDataRow"]').all();
  console.log(`  Found ${rows.length} rows on this page`);

  let pageDownloadCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Extract data from all columns (matching the screenshot)
    // Column indices: 0=Form Type, 1=Filing Date, 2=Filer Name, 
    // 3=Candidate Last Name, 4=Candidate First Name, 5=Candidate Middle Name
    const formTypeText = await row.locator('td').nth(0).textContent();
    const filingDateText = await row.locator('td').nth(1).textContent();
    const filerNameText = await row.locator('td').nth(2).textContent();
    const candidateLastNameText = await row.locator('td').nth(3).textContent();
    const candidateFirstNameText = await row.locator('td').nth(4).textContent();
    const candidateMiddleNameText = await row.locator('td').nth(5).textContent();

    const record = extractFilingRecord(
      formTypeText, 
      filingDateText, 
      filerNameText,
      candidateLastNameText,
      candidateFirstNameText,
      candidateMiddleNameText
    );
    
    if (!record) {
      continue;
    }

    // Find the PDF link in this row
    const pdfLink = row.locator('a[id*="DXCBtn"]').first();

    if (await pdfLink.count() > 0) {
      const success = await processFilingRecord(page, pdfLink, record, db, debugMode);
      if (success) {
        pageDownloadCount++;
      }
    }
  }

  return pageDownloadCount;
}

async function main() {
  // Parse CLI arguments
  const options = parseArgs();
  
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

main().catch(console.error);