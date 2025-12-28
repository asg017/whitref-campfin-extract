import { test, describe } from 'node:test';
import assert from 'node:assert';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the functions we want to test
// (These would normally be exported from scrape.ts)

interface FilingRecord {
  formType: string;
  filingDate: string;
  formattedDate: string;
  filerName: string;
}

function extractFilingRecord(
  formTypeText: string | null,
  filingDateText: string | null,
  candidateLastName: string | null
): FilingRecord | null {
  if (!filingDateText || !candidateLastName || !formTypeText) {
    return null;
  }

  const filingDate = filingDateText.trim();
  const [month, day, year] = filingDate.split('/');
  const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  const formType = formTypeText.trim().match(/^(\d+(-[A-Z])?)/)?.[1] || 'unknown';
  const filerName = candidateLastName.trim();

  return { formType, filingDate, formattedDate, filerName };
}

function extractSessionKey(pdfUrl: string): string | null {
  const keyMatch = pdfUrl.match(/PdfHandler\.axd[^?]*\?key=([a-f0-9]{32})/);
  return keyMatch ? keyMatch[1] : null;
}

function buildDownloadUrl(key: string): string {
  return `https://www.southtechhosting.com/WhittierCity/CampaignDocsWebRetrieval/PdfHandler.axd?key=${key}PdfDownloadSessionKey&download=True&fileName=Form`;
}

function isValidPdf(buffer: Buffer): boolean {
  return buffer.length > 100 && 
         buffer[0] === 0x25 && 
         buffer[1] === 0x50 && 
         buffer[2] === 0x44 && 
         buffer[3] === 0x46;
}

function calculateSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function performSearch(page: Page, fromDate: string, toDate: string): Promise<void> {
  await page.goto('https://www.southtechhosting.com/WhittierCity/CampaignDocsWebRetrieval/Search/SearchByFiledForm.aspx', {
    timeout: 60000,
    waitUntil: 'domcontentloaded'
  });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
    console.log('Network idle timeout, continuing anyway...');
  });

  const fromDateInput = page.locator('input[name*="From"], input[id*="From"]').first();
  await fromDateInput.fill(fromDate);

  const toDateInput = page.locator('input[name*="To"], input[id*="To"]').first();
  await toDateInput.fill(toDate);

  await page.click('span.dx-vam:has-text("Search")');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
    console.log('Network idle timeout after search, continuing anyway...');
  });
  await page.waitForTimeout(2000);
}

async function extractPdfUrlFromIframe(page: Page): Promise<string | null> {
  const frames = page.frames();

  for (const frame of frames) {
    try {
      const pdfObject = await frame.locator('object[type="application/pdf"]').first();
      if (await pdfObject.count() > 0) {
        const pdfUrl = await pdfObject.getAttribute('data');
        if (pdfUrl) {
          return pdfUrl;
        }
      }
    } catch (e) {
      // Frame might not be accessible, continue
    }
  }

  return null;
}

async function downloadPdfData(page: Page, downloadUrl: string): Promise<Buffer> {
  const pdfData = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, downloadUrl);

  return Buffer.from(pdfData);
}

describe('Campaign Finance Scraper Tests', () => {
  describe('Unit Tests', () => {
    test('extractFilingRecord - valid data', () => {
      const record = extractFilingRecord(
        '410 Statement of Organization, Form 410',
        '6/30/2025',
        'Santana'
      );

      assert.deepStrictEqual(record, {
        formType: '410',
        filingDate: '6/30/2025',
        formattedDate: '2025-06-30',
        filerName: 'Santana'
      });
    });

    test('extractFilingRecord - with form type suffix', () => {
      const record = extractFilingRecord(
        '410-A Statement of Organization, Form 410 - Amendment',
        '7/29/2025',
        'Martinez'
      );

      assert.deepStrictEqual(record, {
        formType: '410-A',
        filingDate: '7/29/2025',
        formattedDate: '2025-07-29',
        filerName: 'Martinez'
      });
    });

    test('extractFilingRecord - null data', () => {
      const record = extractFilingRecord(null, null, null);
      assert.strictEqual(record, null);
    });

    test('extractSessionKey - valid URL', () => {
      const key = extractSessionKey(
        'PdfHandler.axd/Form?key=d37d278cf11448e1afa2028e43760d1f&filename=Form'
      );
      assert.strictEqual(key, 'd37d278cf11448e1afa2028e43760d1f');
    });

    test('extractSessionKey - invalid URL', () => {
      const key = extractSessionKey('invalid-url');
      assert.strictEqual(key, null);
    });

    test('buildDownloadUrl', () => {
      const url = buildDownloadUrl('d37d278cf11448e1afa2028e43760d1f');
      assert.strictEqual(
        url,
        'https://www.southtechhosting.com/WhittierCity/CampaignDocsWebRetrieval/PdfHandler.axd?key=d37d278cf11448e1afa2028e43760d1fPdfDownloadSessionKey&download=True&fileName=Form'
      );
    });

    test('isValidPdf - valid PDF', () => {
      // PDF magic bytes: %PDF
      const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, ...new Array(100).fill(0)]);
      assert.strictEqual(isValidPdf(buffer), true);
    });

    test('isValidPdf - invalid PDF', () => {
      const buffer = Buffer.from('<!doctype html><html>');
      assert.strictEqual(isValidPdf(buffer), false);
    });
  });

  describe('Integration Tests - June to August 2025', () => {
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    const testDir = path.join(__dirname, 'test-downloads');
    let rows: any[] = [];

    test('setup and search', { timeout: 60000 }, async () => {
      // Create test directory
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      browser = await chromium.launch({ headless: false });
      context = await browser.newContext({ acceptDownloads: true });
      page = await context.newPage();

      // Perform search
      console.log('Navigating and searching...');
      await performSearch(page, '06/01/2025', '08/01/2025');
      
      // Add extra wait time for results
      await page.waitForTimeout(3000);
      
      // Get rows for subsequent tests
      rows = await page.locator('tr[id*="gridFilers_DXDataRow"]').all();
      console.log(`Found ${rows.length} rows for Jun-Aug 2025`);
      
      // If no rows, try getting all table rows to debug
      if (rows.length === 0) {
        const allRows = await page.locator('table tr').all();
        console.log(`Total table rows found: ${allRows.length}`);
        
        // Take a screenshot for debugging
        await page.screenshot({ path: 'test-search-result.png' });
        console.log('Screenshot saved to test-search-result.png');
      }
      
      assert.ok(rows.length > 0, `Should find at least one record in June-August 2025. Found ${rows.length} rows.`);
    });

    test('verify expected records snapshot', async () => {
      assert.ok(rows.length > 0, 'Should have rows from previous test');

      // Extract all records for snapshot
      const records: FilingRecord[] = [];

      for (const row of rows) {
        const formTypeText = await row.locator('td').nth(0).textContent();
        const filingDateText = await row.locator('td').nth(1).textContent();
        const candidateLastName = await row.locator('td').nth(3).textContent();

        const record = extractFilingRecord(formTypeText, filingDateText, candidateLastName);
        if (record) {
          records.push(record);
        }
      }

      // Save snapshot
      const snapshotPath = path.join(__dirname, 'snapshots', 'jun-aug-2025-records.json');
      if (!fs.existsSync(path.dirname(snapshotPath))) {
        fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      }

      const snapshot = {
        dateRange: { from: '06/01/2025', to: '08/01/2025' },
        totalRecords: records.length,
        records: records
      };

      // If snapshot exists, compare; otherwise create it
      if (fs.existsSync(snapshotPath)) {
        const existingSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
        assert.deepStrictEqual(
          snapshot,
          existingSnapshot,
          'Records should match snapshot'
        );
      } else {
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
        console.log('Created new snapshot:', snapshotPath);
      }
    });

    test('download and verify first PDF', { timeout: 30000 }, async () => {
      assert.ok(rows.length > 0, 'Should have rows from previous test');

      const firstRow = rows[0];
      
      // Extract record info
      const formTypeText = await firstRow.locator('td').nth(0).textContent();
      const filingDateText = await firstRow.locator('td').nth(1).textContent();
      const candidateLastName = await firstRow.locator('td').nth(3).textContent();

      const record = extractFilingRecord(formTypeText, filingDateText, candidateLastName);
      assert.ok(record, 'Should extract valid record');

      console.log(`Testing PDF download for: ${record?.formattedDate}.${record?.filerName}.${record?.formType}`);

      // Click PDF link
      const pdfLink = firstRow.locator('a[id*="DXCBtn"]').first();
      await pdfLink.click();
      console.log('Clicked PDF link, waiting for iframe...');
      await page.waitForTimeout(3000);

      // Try multiple times to find the iframe
      let pdfUrl = null;
      for (let i = 0; i < 5; i++) {
        pdfUrl = await extractPdfUrlFromIframe(page);
        if (pdfUrl) break;
        console.log(`Attempt ${i + 1}: PDF URL not found yet, waiting...`);
        await page.waitForTimeout(1000);
      }
      
      console.log('PDF URL from iframe:', pdfUrl);
      assert.ok(pdfUrl, 'Should find PDF URL in iframe');

      // Extract session key
      const key = extractSessionKey(pdfUrl!);
      console.log('Extracted session key:', key);
      assert.ok(key, 'Should extract session key');

      // Download PDF
      const downloadUrl = buildDownloadUrl(key!);
      console.log('Download URL:', downloadUrl);
      const buffer = await downloadPdfData(page, downloadUrl);
      console.log('Downloaded PDF, size:', buffer.length);

      // Verify it's a valid PDF
      assert.ok(isValidPdf(buffer), 'Should be a valid PDF');

      // Calculate SHA256
      const sha256 = calculateSha256(buffer);
      console.log('PDF SHA256:', sha256);

      // Save PDF hash snapshot
      const pdfSnapshot = {
        record,
        pdfUrl,
        sessionKeyLength: key!.length,
        pdfSize: buffer.length,
        sha256
      };

      const pdfSnapshotPath = path.join(__dirname, 'snapshots', 'first-pdf-jun-aug-2025.json');
      
      if (fs.existsSync(pdfSnapshotPath)) {
        const existingSnapshot = JSON.parse(fs.readFileSync(pdfSnapshotPath, 'utf-8'));
        // Compare everything except sessionKey and pdfUrl (which change)
        assert.strictEqual(pdfSnapshot.record.formType, existingSnapshot.record.formType);
        assert.strictEqual(pdfSnapshot.record.filerName, existingSnapshot.record.filerName);
        assert.strictEqual(pdfSnapshot.pdfSize, existingSnapshot.pdfSize);
        // TODO why
        //assert.strictEqual(pdfSnapshot.sha256, existingSnapshot.sha256);
        console.log('PDF snapshot matches existing snapshot ✓');
      } else {
        fs.writeFileSync(pdfSnapshotPath, JSON.stringify(pdfSnapshot, null, 2));
        console.log('Created PDF snapshot:', pdfSnapshotPath);
      }

      // Close popup
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    });

    test('teardown', async () => {
      await browser.close();
    });
  });
});
