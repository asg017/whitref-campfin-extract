# Campaign Finance Scraper

Web scraper for Whittier City campaign finance documents using Playwright.

## Installation

```bash
npm install
```

## Usage

The scraper is a CLI tool that downloads PDFs and optionally stores them in a SQLite database.

### Basic Usage

```bash
npm run scrape -- --start YYYY-MM-DD --end YYYY-MM-DD [-o database.db] [--debug]
```

### CLI Options

- `--start YYYY-MM-DD` - Start date for filing search (required)
- `--end YYYY-MM-DD` - End date for filing search (required)
- `-o <path>` - Path to SQLite database file (optional - if omitted, runs in dry-run mode)
- `--debug` - Debug mode: keeps browser visible and pauses 5 minutes after each PDF for manual inspection

### Examples

Download all filings and save to database:
```bash
npm run scrape -- --start 2025-01-01 --end 2025-12-31 -o campfin.db
```

Dry-run mode (no database, just test the scraper):
```bash
npm run scrape -- --start 2025-01-01 --end 2025-12-31
```

Debug mode with visible browser and 5-minute pauses:
```bash
npm run scrape -- --start 2025-01-01 --end 2025-12-31 -o campfin.db --debug
```

### Database Schema

The SQLite database contains a single table `filings` with the following columns:

- `id` - Auto-incrementing primary key
- `form_type` - Form type (e.g., "410", "460")
- `filing_date` - Filing date in YYYY-MM-DD format
- `filer_name` - Name of the filer
- `file_name` - Generated filename for the PDF
- `pdf_blob` - The PDF file as a BLOB
- `created_at` - Timestamp when the record was created

### Querying the Database

You can query the database using any SQLite client:

```bash
# List all filings
sqlite3 campfin.db "SELECT id, form_type, filing_date, filer_name, file_name FROM filings"

# Extract a specific PDF
sqlite3 campfin.db "SELECT pdf_blob FROM filings WHERE id = 1" > output.pdf

# Count filings by form type
sqlite3 campfin.db "SELECT form_type, COUNT(*) FROM filings GROUP BY form_type"
```

### Extracting PDFs from Database

Use the included `extract-pdfs.ts` script to extract all PDFs from the database:

```bash
npm run extract -- campfin.db ./output-pdfs
```

Or directly:

```bash
node --experimental-strip-types extract-pdfs.ts campfin.db ./output-pdfs
```

This will create individual PDF files in the `./output-pdfs` directory.

## Testing

```bash
npm test
```

## How It Works

See [agents.md](./agents.md) for implementation details and lessons learned.
