// Server-only. Imported by both src/routes/api/locations/+server.js (the
// JSON API) and src/routes/+page.server.js (SSR load for the initial page
// render) so there's a single implementation instead of two copies to keep
// in sync.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SHEET_CSV_URL } from './sheetConfig.js';
import { greenSpaces as fallbackSpaces } from './greenSpaces.js';

const CACHE_PATH = '.data/locations-cache.json';

// Hosts Google issues for shortened maps links (from the "Share" button,
// mainly on mobile). These carry no coordinates themselves — only the page
// they redirect to does — so they're resolved with a single redirect
// follow. This is a plain HTTP hop, not a rate-limited geocoding call, so
// it costs nothing extra and scales to any number of places.
const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJSON(path, data) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
  } catch (error) {
    console.error(`Could not write ${path}:`, error);
  }
}

function readCache() {
  return readJSON(CACHE_PATH);
}

function writeCache(locations) {
  writeJSON(CACHE_PATH, { locations, cachedAt: new Date().toISOString() });
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function isShortLink(googleMapsUrl) {
  try {
    return SHORT_LINK_HOSTS.has(new URL(googleMapsUrl).hostname);
  } catch {
    return false;
  }
}

async function resolveShortLink(googleMapsUrl) {
  try {
    const response = await fetch(googleMapsUrl, { redirect: 'follow' });
    return response.url || googleMapsUrl;
  } catch {
    return googleMapsUrl;
  }
}

// Every marker's position comes directly from coordinates embedded in the
// Google Maps URL — a pin-drop or place-page "Share" link carries these
// automatically. There is no name-based geocoding fallback: no external
// lookup service, no rate limit, no cache to keep warm, no ceiling on how
// many places the sheet can hold. A URL that doesn't carry coordinates
// (e.g. a plain text-search link) is treated as unusable for that row.
//
//  - "...!3d40.11515!4d-88.22273" — precise marker, from a place page
//  - "...@40.11515,-88.22273,17z" — map view center, from a dropped pin
//  - "...?q=40.11515,-88.22273"   — bare coordinates in the query
function parseGoogleMapsUrl(googleMapsUrl) {
  let url;
  try {
    url = new URL(googleMapsUrl);
  } catch {
    return null;
  }

  const decoded = decodeURIComponent(url.href);

  const markerMatch = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (markerMatch) {
    return { lat: parseFloat(markerMatch[1]), lng: parseFloat(markerMatch[2]) };
  }

  const viewMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+),/);
  if (viewMatch) {
    return { lat: parseFloat(viewMatch[1]), lng: parseFloat(viewMatch[2]) };
  }

  // "/maps/search/40.111729,+-88.227035" — what a maps.app.goo.gl pin-drop
  // shortlink resolves to. The "+" here is a literal character (this is a
  // path segment, not a query string, so it's never space-decoded), not
  // part of the number.
  const searchMatch = decoded.match(/\/maps\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/);
  if (searchMatch) {
    return { lat: parseFloat(searchMatch[1]), lng: parseFloat(searchMatch[2]) };
  }

  const q = url.searchParams.get('q');
  if (q && /^-?\d+\.\d+,-?\d+\.\d+$/.test(q.trim())) {
    const [lat, lng] = q.trim().split(',').map(Number);
    return { lat, lng };
  }

  // Last resort: Google has more coordinate-in-URL shapes than are worth
  // naming individually. Any "lat,lng"-looking pair (comma-separated,
  // several decimal places, optional literal "+" before the second
  // number) is treated as coordinates rather than dropping the row.
  const genericMatch = decoded.match(/(-?\d{1,3}\.\d{4,}),\+?(-?\d{1,3}\.\d{4,})/);
  if (genericMatch) {
    return { lat: parseFloat(genericMatch[1]), lng: parseFloat(genericMatch[2]) };
  }

  return null;
}

async function toLocations(csv) {
  const rows = parseCSV(csv);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.toLowerCase().trim());
  const index = (name) => headers.indexOf(name);
  const get = (row, name) => row[index(name)] ?? '';

  const locations = [];
  for (let i = 0; i < rows.slice(1).length; i++) {
    const row = rows[i + 1];
    const name = get(row, 'name');
    const address = get(row, 'location');
    const approvedRaw = get(row, 'approved').toLowerCase();
    const approved = !['false', 'no', '0', 'pending'].includes(approvedRaw);

    if (!name || !approved) continue;

    // Required: a Google Maps URL with coordinates in it. No address
    // fallback, no name-based lookup — a row without a usable coordinate
    // link is skipped, and logged so it doesn't go missing silently.
    let mapsUrl = get(row, 'google_maps_url');
    if (!mapsUrl) {
      console.warn(`Skipping "${name}": no google_maps_url.`);
      continue;
    }

    if (isShortLink(mapsUrl)) {
      mapsUrl = await resolveShortLink(mapsUrl);
    }

    const coords = parseGoogleMapsUrl(mapsUrl);
    if (!coords) {
      console.warn(`Skipping "${name}": google_maps_url has no coordinates in it. Use a dropped-pin or place-page "Share" link, not a text-search link.`);
      continue;
    }

    locations.push({
      id: get(row, 'id') || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${i}`,
      name,
      type: get(row, 'type') || 'Green Space',
      location: address,
      lat: coords.lat,
      lng: coords.lng,
      // Built from the coordinates we just parsed, not the original sheet
      // URL — this is Google's documented universal maps link, so it
      // opens reliably on both mobile (deep-links into the app) and
      // desktop, and doesn't depend on a shortlink still redirecting
      // correctly later.
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`,
      description: get(row, 'description') || 'Outdoor area included in the Illini Green inventory.',
      approved
    });
  }

  return locations;
}

// The single entry point both the API route and the SSR load function
// call. Same three-tier fallback as before (live sheet → last-known cache
// → built-in list), just no longer duplicated in two files.
export async function loadLocations() {
  if (!SHEET_CSV_URL) {
    return { locations: fallbackSpaces, source: 'local-fallback' };
  }

  try {
    const response = await fetch(SHEET_CSV_URL, { headers: { accept: 'text/csv,*/*' } });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const locations = await toLocations(await response.text());
    if (!locations.length) throw new Error('No valid locations found in the published sheet.');
    writeCache(locations);
    return { locations, source: 'google-sheets' };
  } catch (error) {
    console.error('Google Sheets import failed:', error);

    // Sheet unreachable or empty: fall back to the last known-good cached
    // result if this instance happens to have one (best-effort only —
    // Vercel's filesystem doesn't persist this across cold starts), else
    // the built-in local list.
    const cached = readCache();
    if (cached?.locations?.length) {
      return {
        locations: cached.locations,
        source: 'cached-fallback',
        cachedAt: cached.cachedAt,
        error: 'Could not load the published Google Sheet. Showing the last known data.'
      };
    }

    return { locations: fallbackSpaces, source: 'local-fallback', error: 'Could not load the published Google Sheet.' };
  }
}