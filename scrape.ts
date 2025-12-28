import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  
  console.log('Navigating to the search page...');
  await page.goto('https://www.southtechhosting.com/WhittierCity/CampaignDocsWebRetrieval/Search/SearchByFiledForm.aspx');
  
  // Wait for the page to load
  await page.waitForLoadState('networkidle');
  
  // Fill in the date range
  console.log('Setting date range...');
  
  // Fill "From" date
  const fromDateInput = page.locator('input[name*="From"], input[id*="From"]').first();
  await fromDateInput.fill('01/01/2025');
  
  // Fill "To" date
  const toDateInput = page.locator('input[name*="To"], input[id*="To"]').first();
  await toDateInput.fill('12/31/2025');
  
  // Click the Search button
  console.log('Clicking search button...');
  await page.click('span.dx-vam:has-text("Search")');
  
  // Wait for results to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
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
    
    if (!filingDateText || !candidateLastName || !formTypeText) {
      continue;
    }
    
    // Parse filing date (format: M/D/YYYY)
    const filingDate = filingDateText.trim();
    const [month, day, year] = filingDate.split('/');
    const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    
    // Extract form type (e.g., "410" from "410 Statement of Organization, Form 410")
    const formType = formTypeText.trim().match(/^(\d+(-[A-Z])?)/)?.[1] || 'unknown';
    
    const filerName = candidateLastName.trim();
    
    // Find the PDF link in this row (the <a> with the img inside)
    const pdfLink = row.locator('a[id*="DXCBtn"]').first();
    
    if (await pdfLink.count() > 0) {
      try {
        console.log(`Processing: ${formattedDate}.${filerName}.${formType}.pdf`);
        
        // Click the PDF link to open the iframe
        console.log('  Clicking PDF link...');
        await pdfLink.click();
        
        // Wait for the iframe/popup to appear
        console.log('  Waiting for popup/iframe...');
        await page.waitForTimeout(1500);
        
        // Find the iframe
        console.log('  Looking for iframe...');
        const frames = page.frames();
        console.log(`  Found ${frames.length} frames`);
        
        let pdfUrl = null;
        
        // Check each frame for the PDF object
        for (const frame of frames) {
          try {
            const pdfObject = await frame.locator('object[type="application/pdf"]').first();
            if (await pdfObject.count() > 0) {
              console.log('  Found PDF object in frame');
              pdfUrl = await pdfObject.getAttribute('data');
              if (pdfUrl) {
                console.log(`  Extracted PDF URL: ${pdfUrl}`);
                break;
              }
            }
          } catch (e) {
            // Frame might not be accessible, continue
          }
        }
        
        if (pdfUrl) {
          // Extract the key from the URL using improved regex
          const keyMatch = pdfUrl.match(/PdfHandler\.axd[^?]*\?key=([a-f0-9]{32})/);
          if (!keyMatch) {
            console.error(`  ❌ Could not extract key from URL: ${pdfUrl}`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            continue;
          }
          
          const key = keyMatch[1];
          console.log(`  Extracted key: ${key}`);
          
          // Construct the correct download URL
          const downloadUrl = `https://www.southtechhosting.com/WhittierCity/CampaignDocsWebRetrieval/PdfHandler.axd?key=${key}PdfDownloadSessionKey&download=True&fileName=Form`;
          console.log(`  Download URL: ${downloadUrl}`);
          
          console.log('  Attempting download via fetch...');
          
          try {
            // Use fetch in the page context to maintain cookies/session
            const pdfData = await page.evaluate(async (url) => {
              const response = await fetch(url);
              const blob = await response.blob();
              const arrayBuffer = await blob.arrayBuffer();
              // Convert to array so we can transfer it back to Node
              return Array.from(new Uint8Array(arrayBuffer));
            }, downloadUrl);
            
            const buffer = Buffer.from(pdfData);
            console.log(`  Response size: ${buffer.length} bytes`);
            
            // Verify it's actually a PDF
            if (buffer.length > 100 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
              // Save with custom filename
              const filename = `${formattedDate}.${filerName}.${formType}.pdf`;
              const filepath = path.join(downloadDir, filename);
              console.log(`  Saving to: ${filepath}`);
              fs.writeFileSync(filepath, buffer);
              
              downloadCount++;
              console.log(`✓ Downloaded: ${filename}`);
            } else {
              console.error(`  ❌ Response is not a valid PDF`);
              console.error(`  First 100 chars: ${buffer.slice(0, 100).toString()}`);
            }
            
          } catch (err) {
            console.error(`  ❌ Error fetching PDF:`, err instanceof Error ? err.message : String(err));
          }
          
          // Close the popup/dialog on main page
          console.log('  Closing popup...');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        } else {
          console.error(`  ❌ Could not find PDF URL for ${filerName}`);
          // Try to close any open dialogs
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }
        
      } catch (error) {
        console.error(`  ❌ Error downloading PDF for ${filerName}:`, error instanceof Error ? error.message : String(error));
        // Try to close any open dialogs
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }
  }
  
  console.log(`\nDownload complete! Total PDFs downloaded: ${downloadCount}`);
  
  await browser.close();
}

main().catch(console.error);