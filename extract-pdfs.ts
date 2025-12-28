#!/usr/bin/env node --experimental-strip-types
/**
 * Extract PDFs from SQLite database
 * Usage: node extract-pdfs.ts <database.db> <output-dir>
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: node extract-pdfs.ts <database.db> <output-dir>');
  console.error('Example: node extract-pdfs.ts campfin.db ./pdfs');
  process.exit(1);
}

const [dbPath, outputDir] = args;

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`Extracting PDFs from ${dbPath} to ${outputDir}`);

const db = new DatabaseSync(dbPath);

const stmt = db.prepare(`
  SELECT f.id, f.file_name, p.pdf_blob 
  FROM filings f
  JOIN filing_pdfs p ON f.id = p.filing_id
  ORDER BY f.filing_date, f.id
`);
const rows = stmt.all() as Array<{ id: number; file_name: string; pdf_blob: Buffer }>;

console.log(`Found ${rows.length} PDFs to extract`);

let count = 0;
for (const row of rows) {
  const outputPath = path.join(outputDir, row.file_name);
  fs.writeFileSync(outputPath, row.pdf_blob);
  count++;
  console.log(`${count}/${rows.length} - Extracted: ${row.file_name}`);
}

console.log(`\nDone! Extracted ${count} PDFs to ${outputDir}`);
