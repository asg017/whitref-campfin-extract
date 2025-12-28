import { chromium, Page, Locator } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FilingRecord {
  formType: string;
  filingDate: string;
  formattedDate: string;
  filerName: string;
}

/**
 * Extract filing record data from a table row
 */
function extractFilingRecord(
  formTypeText: string | null,
  filingDateText: string | null,
  candidateLastName: string | null
): FilingRecord | null {
  if (!filingDateText || !candidateLastName || !formTypeText) {
    return null;
  }

  // Parse filing date (format: M/D/YYYY)
  const filingDate = filingDateText.trim();
  const [month, day, year] = filingDate.split('/');
  const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  // Extract form type (e.g., "410" from "410 Statement of Organization, Form 410")
  const formType = formTypeText.trim().match(/^(\d+(-[A-Z])?)/)?.[1] || 'unknown';

  const filerName = candidateLastName.trim();

  return { formType, filingDate, formattedDate, filerName };
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
 * Save PDF to file
 */
function savePdf(buffer: Buffer, downloadDir: string, record: FilingRecord): string {
  const filename = `${record.formattedDate}.${record.filerName}.${record.formType}.pdf`;
  const filepath = path.join(downloadDir, filename);
  fs.writeFileSync(filepath, buffer);
  return filename;
}

/**
 * Process a single filing record and download its PDF
 */
async function processFilingRecord(
  page: Page,
  pdfLink: Locator,
  record: FilingRecord,
  downloadDir: string
): Promise<boolean> {
  try {
    console.log(`Processing: ${record.formattedDate}.${record.filerName}.${record.formType}.pdf`);

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
      const filename = savePdf(buffer, downloadDir, record);
      console.log(`  Saving to: ${path.join(downloadDir, filename)}`);
      console.log(`✓ Downloaded: ${filename}`);
      
      // Close the popup
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
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

async function main() {
  // Create downloads directory if it doesn't exist
  const downloadDir = path.join(__dirname, '2025');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    acceptDownloads: true
  });

  const page = await context.newPage();

  // Perform search
  await performSearch(page, '01/01/2025', '12/31/2025');

  // Get all PDF links from the results table
  console.log('Finding PDF links...');
  const rows = await page.locator('tr[id*="gridFilers_DXDataRow"]').all();
  console.log(`Found ${rows.length} rows`);

  let downloadCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Extract data from the row
    const formTypeText = await row.locator('td').nth(0).textContent();
    const filingDateText = await row.locator('td').nth(1).textContent();
    const candidateLastName = await row.locator('td').nth(3).textContent();

    const record = extractFilingRecord(formTypeText, filingDateText, candidateLastName);
    if (!record) {
      continue;
    }

    // Find the PDF link in this row
    const pdfLink = row.locator('a[id*="DXCBtn"]').first();

    if (await pdfLink.count() > 0) {
      const success = await processFilingRecord(page, pdfLink, record, downloadDir);
      if (success) {
        downloadCount++;
      }
    }
  }

  console.log(`\nDownload complete! Total PDFs downloaded: ${downloadCount}`);

  await browser.close();
}

main().catch(console.error);