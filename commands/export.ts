import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

interface ExportOptions {
  database: string;
  output: string;
}

/**
 * Parse command line arguments for export command
 */
function parseExportArgs(args: string[]): ExportOptions {
  if (args.length < 3) {
    console.error('Error: database path and -o output directory are required');
    console.error('Usage: node cli.ts export database.db -o output-dir');
    process.exit(1);
  }

  const database = args[0];
  let output: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-o' && i + 1 < args.length) {
      output = args[++i];
    }
  }

  if (!output) {
    console.error('Error: -o output directory is required');
    console.error('Usage: node cli.ts export database.db -o output-dir');
    process.exit(1);
  }

  return { database, output };
}

/**
 * Main export command implementation
 */
export async function exportCommand(args: string[]): Promise<void> {
  const options = parseExportArgs(args);

  if (!fs.existsSync(options.database)) {
    console.error(`Database not found: ${options.database}`);
    process.exit(1);
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(options.output)) {
    fs.mkdirSync(options.output, { recursive: true });
  }

  console.log(`Extracting PDFs from ${options.database} to ${options.output}`);

  const db = new DatabaseSync(options.database);

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
    const outputPath = path.join(options.output, row.file_name);
    fs.writeFileSync(outputPath, row.pdf_blob);
    count++;
    console.log(`${count}/${rows.length} - Extracted: ${row.file_name}`);
  }

  console.log(`\nDone! Extracted ${count} PDFs to ${options.output}`);
}
