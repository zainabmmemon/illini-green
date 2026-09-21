import { loadLocations } from '$lib/locations.js';

export async function load() {
  return loadLocations();
}