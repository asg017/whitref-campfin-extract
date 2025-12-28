# Lessons Learned: Web Scraping with Playwright

## Key Challenges & Solutions

### 1. Dynamic Session Keys
**Problem**: PDFs required session-specific keys that changed on each request.  
**Solution**: Extract the key from the iframe's `<object>` element data attribute using regex: `/PdfHandler\.axd[^?]*\?key=([a-f0-9]{32})/`

### 2. Cookie/Session Dependency
**Problem**: Direct HTTP requests failed with "Unexpected whitespace after header value" errors.  
**Solution**: Use `page.evaluate()` to run `fetch()` in the browser context, maintaining all cookies and session state.

### 3. Complex UI Elements
**Problem**: DevExpress components (buttons rendered as spans, not standard HTML).  
**Solution**: Target the actual DOM structure (`span.dx-vam:has-text("Search")`) rather than semantic elements.

### 4. PDF URL Construction
**Problem**: Download URL format wasn't obvious from the page.  
**Solution**: Pattern: `https://.../PdfHandler.axd?key={key}PdfDownloadSessionKey&download=True&fileName=Form`

### 5. Iframe PDF Detection
**Problem**: PDF loaded in nested iframe, not immediately accessible.  
**Solution**: Iterate through all page frames and check each for `object[type="application/pdf"]` elements.

### 6. Test Flakiness
**Problem**: Network timeouts on slow connections.  
**Solution**: 
- Use `domcontentloaded` instead of `load` for initial page load
- Catch and continue on `networkidle` timeouts
- Add retry logic with delays for iframe detection

## Best Practices

1. **Use browser context for downloads**: `page.evaluate(fetch)` > `context.request.get()` > `page.goto()`
2. **Validate PDFs**: Check magic bytes (`0x25 0x50 0x44 0x46` = `%PDF`)
3. **Structure for testability**: Extract pure functions for data parsing, URL building
4. **Snapshot testing**: Store SHA256 hashes to detect data changes
5. **Add generous timeouts and retries**: Real websites are slow and flaky

## Tools That Worked

- **Playwright**: Excellent for handling complex web apps with iframes and dynamic content
- **Node built-in test runner**: Simple, fast, no dependencies
- **TypeScript with `--experimental-strip-types`**: Type safety without build step
- **Snapshot testing**: JSON files for regression detection
