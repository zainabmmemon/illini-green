import { json } from '@sveltejs/kit';
import { loadLocations } from '$lib/locations.js';

export async function GET() {
  const result = await loadLocations();
  const isLive = result.source === 'google-sheets';
  return json(result, isLive ? { headers: { 'cache-control': 'public, max-age=60, s-maxage=60' } } : {});
}