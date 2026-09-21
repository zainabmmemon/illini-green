# Illini Green MVP — Google Sheets connected

This version reads the public **Green Spaces** Google Sheet tab at runtime. The site does not read the student response tabs.

## Run locally

```powershell
npm install
npm run dev
```

## Data workflow

1. Maintain approved public locations in the Google Sheet's `Green Spaces` tab.
2. Keep `Space Suggestions` and `Improvement Proposals` as private response/admin tabs.
3. Only publish the `Green Spaces` tab to the web as CSV.
4. The site fetches that published CSV through `/api/locations`.
5. Rows with `approved` set to `FALSE`, `NO`, `0`, or `PENDING` are hidden.

## Important

The published URL is intentionally hard-coded in `src/lib/sheetConfig.js` for this MVP. If you later create a new published sheet URL, replace it there and redeploy.

The site keeps the original 31-location list as a fallback if Google Sheets is unavailable.
