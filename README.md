# MySpaceX – Static Site (Tailwind + Vanilla JS + SheetDB)

A modern, user-friendly static website. Shared navbar/footer are injected on each page.
Data (Hours Tracker) is stored in **SheetDB.io** using client-side `fetch`.

## Quick start
1) Unzip.
2) Open the folder in VS Code and run **Live Server**, or serve with Python:
   ```bash
   python -m http.server 4000
   ```
   Then visit http://localhost:4000
   > Fetching local partials (`/public/partials/*.html`) requires an HTTP server (file:// won’t work).

3) Configure SheetDB:
   - Create a Google Sheet with columns: `id, date, start, end, hours`
   - Create a SheetDB endpoint from that sheet.
   - Copy `public/assets/js/config.example.js` to `public/assets/js/config.js`
   - Set `SHEETDB_API` to your endpoint (e.g., `https://sheetdb.io/api/v1/XXXXX`), and set `SHEET_NAME` if your tab name isn’t `Sheet1`.

## Pages
- `index.html` – Home + feature cards
- `hours.html` – Hours Tracker: clock in/out, manual add, CSV export (stored in SheetDB)
- `feature2.html`, `feature3.html`, `feature4.html` – placeholders you can fill

## Notes
- Tailwind is included via CDN, no build step.
- Everything is vanilla JS.
- If you enable authentication on SheetDB, add the `Authorization` header in `hours.js` where `fetch` is called.
