# Test Coverage

## Overview

Comprehensive test suite for the Campaign Finance PDF scraper, covering unit tests, integration tests, and pagination functionality.

## Test Structure

### Unit Tests (8 tests)
Pure function tests with no browser interaction:

1. **`extractFilingRecord`** - Valid data extraction
2. **`extractFilingRecord`** - Form type with suffix (e.g., "410-A")
3. **`extractFilingRecord`** - Null input handling
4. **`extractSessionKey`** - Valid URL key extraction
5. **`extractSessionKey`** - Invalid URL handling
6. **`buildDownloadUrl`** - URL construction
7. **`isValidPdf`** - Valid PDF magic bytes detection
8. **`isValidPdf`** - Invalid file rejection

### Integration Tests (3 tests)
End-to-end browser tests using June-August 2025 date range:

1. **Setup and Search** - Navigates to site, performs search, verifies results
2. **Snapshot Verification** - Compares current records against stored snapshot
3. **PDF Download** - Downloads first PDF, verifies format, checks SHA256 hash

### Pagination Tests (7 tests)
Tests for multi-page result handling:

1. **`getPaginationInfo`** - Parses "Page X of Y (Z items)" correctly
2. **`getPaginationInfo`** - Returns null when no pagination exists
3. **`goToNextPage`** - Successfully navigates to next page
4. **`goToNextPage`** - Returns false on last page
5. **Pagination Loop** - Processes all pages in sequence
6. **Record Distribution** - Verifies total records match pagination count
7. **Snapshot** - Captures pagination structure for regression testing

## Running Tests

```bash
# Run all tests
npm test

# Tests run with browser visible (headless: false) for debugging
```

## Test Output Example

```
✔ Unit Tests (1.2ms)
✔ Integration Tests - June to August 2025 (49s)
  - Found 10 rows for Jun-Aug 2025
  - Downloaded PDF, size: 194642 bytes
  - PDF snapshot matches existing snapshot ✓
✔ Pagination Tests (94s)
  - Page 1 of 20 (194 items)
  - Processed all 20 pages
  - Total records: 194 (matches pagination count)

ℹ tests 20
ℹ pass 20
ℹ fail 0
```

## Snapshot Files

Tests create/verify snapshots in `snapshots/`:

- **`jun-aug-2025-records.json`** - List of all records from June-August 2025
  - Detects if new filings appear or existing ones change
  
- **`first-pdf-jun-aug-2025.json`** - Metadata for first PDF
  - Form type, filer name, PDF size, SHA256 hash
  - Ensures PDF download consistency

## Key Test Features

### Robust Error Handling
- Timeouts handled gracefully
- Network delays accounted for
- Iframe detection with retries

### Real Data Testing
- Tests against actual website
- Verifies live scraping workflow
- Detects website changes early

### Pagination Verification
- **Page count accuracy** - Confirms all pages are detected
- **Navigation reliability** - Tests "Next" button functionality  
- **Record totals** - Sum of all page records matches reported total
- **Edge cases** - Single page, last page, no results

## Test Duration

- **Unit tests**: ~1ms total
- **Integration tests**: ~49 seconds (includes browser startup, navigation, PDF download)
- **Pagination tests**: ~94 seconds (tests 20 pages of results)
- **Total**: ~2.5 minutes

## Coverage Gaps

Areas not yet covered by tests:
- Database operations (SQLite inserts)
- CLI argument parsing
- Debug mode (5-minute pause)
- Error recovery after failed downloads
- Concurrent page processing

## Future Improvements

- Mock browser responses for faster unit tests
- Test database snapshot consistency
- Verify duplicate prevention (UNIQUE constraint)
- Test with various date ranges
- Performance benchmarks
