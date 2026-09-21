<script>
import { onMount } from 'svelte';

export let data;

let spaces = data.locations;
let dataSource =
  data.source === 'google-sheets' ? 'Google Sheets' : data.source === 'cached-fallback' ? 'cached copy' : 'built-in list';
let mapElement, map, leaflet;
let search = '';
let category = 'All';
let selected = null;
let mapError = '';
let suggestUrl = '';
let improvementUrl = '';
let showAllLabels = false;

$: categories = ['All', ...new Set(spaces.map((s) => s.type))];
$: filtered = spaces.filter((s) =>
  (category === 'All' || s.type === category) &&
  (!search.trim() || `${s.name} ${s.type} ${s.location}`.toLowerCase().includes(search.trim().toLowerCase()))
);

function select(s) {
  selected = s;
  if (map) map.setView([s.lat, s.lng], 16, { animate: true });
}

// Rough screen-space collision avoidance for permanent tooltips: try a
// handful of positions above/below each marker (moving further out each
// time) and use the first one that doesn't overlap an already-placed
// label. Approximate on purpose — this only matters when several names
// are visible at once, and a slightly-imperfect nudge beats an exact
// calculation nobody needs for ~30 points.
function declutterLabels(entries) {
  if (!map) return;
  const placed = [];
  const candidates = [
    { dir: 'top', dy: -6 }, { dir: 'bottom', dy: 6 },
    { dir: 'top', dy: -26 }, { dir: 'bottom', dy: 26 },
    { dir: 'top', dy: -46 }, { dir: 'bottom', dy: 46 }
  ];

  entries.forEach(({ marker, name }) => {
    const pt = map.latLngToContainerPoint(marker.getLatLng());
    const w = Math.min(160, name.length * 5.6 + 14);
    const h = 20;

    let placement = candidates[0];
    for (const c of candidates) {
      const bottom = c.dir === 'top' ? pt.y + c.dy : pt.y + c.dy + h;
      const top = bottom - h;
      const rect = { left: pt.x - w / 2, right: pt.x + w / 2, top, bottom };
      const collides = placed.some(
        (r) => rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top
      );
      if (!collides) {
        placed.push(rect);
        placement = c;
        break;
      }
      if (c === candidates[candidates.length - 1]) placed.push(rect);
    }

    marker.unbindTooltip();
    marker.bindTooltip(name, { direction: placement.dir, offset: [0, placement.dy], permanent: true });
  });
}

function addMarkers() {
  if (!map || !leaflet) return;
  map.eachLayer((layer) => {
    if (layer._illini) map.removeLayer(layer);
  });
  const shownLabels = [];
  filtered.forEach((s) => {
    const marker = leaflet.circleMarker([s.lat, s.lng], {
      radius: 7,
      weight: 2,
      color: '#fff',
      fillColor: '#54783b',
      fillOpacity: 0.95
    });
    marker._illini = true;
    const isSelected = selected && selected.id === s.id;
    const showLabel = selected ? isSelected : showAllLabels;
    marker.addTo(map).bindTooltip(s.name, { direction: 'top', offset: [0, -6], permanent: showLabel });
    marker.on('click', () => select(s));
    if (showLabel) shownLabels.push({ marker, name: s.name });
  });
  if (shownLabels.length > 1) declutterLabels(shownLabels);
}

onMount(async () => {
  try {
    const cfg = await fetch('/forms.json').then((r) => r.json()).catch(() => ({}));
    suggestUrl = cfg.suggestUrl || '';
    improvementUrl = cfg.improvementUrl || '';

    leaflet = await import('leaflet');
    map = leaflet.map(mapElement, { zoomControl: false, scrollWheelZoom: true })
      .setView([40.105, -88.225], 13.3);
    leaflet.control.zoom({ position: 'bottomright' }).addTo(map);
    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    map.whenReady(addMarkers);
    map.on('zoomend', addMarkers);
  } catch (error) {
    mapError = 'The map could not load. Check your internet connection and try again.';
    console.error(error);
  }
});

$: if (map && leaflet && filtered) {
  selected;
  showAllLabels;
  addMarkers();
}
</script>

<svelte:head>
  <title>Illini Green — Explore UIUC's Outdoor Spaces</title>
  <meta name="description" content="Explore green spaces and outdoor areas around the University of Illinois Urbana-Champaign." />
</svelte:head>

<header class="nav">
  <a class="brand" href="/"><span class="logo">🌱</span><span><strong>Illini Green</strong><small>Explore. Improve. Reimagine.</small></span></a>
  <nav>
    <a href="#about">About</a>
    <a class="outline" href={suggestUrl || '#actions'}>Suggest a space</a>
    <a class="solid" href={improvementUrl || '#actions'}>Propose an improvement</a>
  </nav>
</header>

<section class="hero">
  <div class="hero-inner">
    <div class="eyebrow">UNIVERSITY OF ILLINOIS URBANA-CHAMPAIGN</div>
    <h1>Explore green spaces.<br /><em>Shape what's next.</em></h1>
    <p>Discover parks, gardens, natural areas, recreation spaces, and campus landscapes around UIUC and the surrounding community.</p>
    <div class="hero-actions">
      <a class="solid big" href={suggestUrl || '#actions'}>＋ Suggest a green space</a>
      <a class="outline big" href={improvementUrl || '#actions'}>＋ Propose an improvement</a>
    </div>
  </div>
</section>

<main class="explorer">
  <aside class="sidebar">
    <div class="search"><span>⌕</span><input bind:value={search} placeholder="Search spaces..." /></div>
    <div class="label">FILTER BY TYPE</div>
    <div class="chips">
      {#each categories as c}
        <button class:chosen={category === c} on:click={() => category = c}>{c}</button>
      {/each}
    </div>
    <div class="count">{filtered.length} OF {spaces.length} SPACES</div>
    <div class="list">
      {#each filtered as s}
        <button class="card" on:click={() => select(s)}>
          <span class="icon">🌿</span>
          <span><strong>{s.name}</strong><small>{s.type}</small><small>{s.location}</small></span>
        </button>
      {:else}
        <p class="empty">No spaces match your search.</p>
      {/each}
    </div>
  </aside>

  <section class="map-wrap">
    <div class="map" bind:this={mapElement}></div>
    {#if mapError}<div class="map-error">{mapError}</div>{/if}
    <button class="label-toggle" class:on={showAllLabels} on:click={() => showAllLabels = !showAllLabels}>
      <span class="dot"></span>{showAllLabels ? 'Names shown' : 'Show all names'}
    </button>
    <div class="map-caption"><span class="pin"></span> Approved locations <b>•</b> {spaces.length} spaces <span class="source">· {dataSource}</span></div>
  </section>
</main>

<section id="actions" class="actions">
  <div>
    <div class="eyebrow">GET INVOLVED</div>
    <h2>Help shape a greener campus.</h2>
    <p>Know a space we missed, or have an idea for improving an existing area? Submissions are reviewed before they become part of the public inventory.</p>
  </div>
  <div class="action-cards">
    <a href={suggestUrl || '#'} class="action-card"><span>🌱</span><div><strong>Suggest a green space</strong><small>Tell us about an existing outdoor space.</small></div><b>→</b></a>
    <a href={improvementUrl || '#'} class="action-card"><span>💡</span><div><strong>Propose an improvement</strong><small>Suggest a way to make an area greener.</small></div><b>→</b></a>
  </div>
</section>

<section id="about" class="actions">
  <div>
    <div class="eyebrow">ABOUT</div>
    <h2>Questions or feedback?</h2>
    <p>Illini Green is maintained by the Illinois Student Government Committee on Environmental Sustainability. Reach out with comments, corrections, or ideas about any listed space.</p>
  </div>
  <div class="action-cards">
    <a href="mailto:ISG-SustainabilityChairperson@illinois.edu" class="action-card"><span>✉️</span><div><strong>Email the ISG Sustainability Chair</strong><small>ISG-SustainabilityChairperson@illinois.edu</small></div><b>→</b></a>
    <a href="mailto:isg-studentlifecoordinator@illinois.edu" class="action-card"><span>✉️</span><div><strong>Email the ISG Sustainability Coordinator</strong><small>ISG-StudentLifeCoordinator@illinois.edu</small></div><b>→</b></a>
    <a href="https://isg.illinois.edu/about" target="_blank" rel="noopener" class="action-card"><span>📅</span><div><strong>Come to the Environmental Sustainability Committee</strong><small>See the current schedule on the ISG website</small></div><b>→</b></a>
  </div>
</section>

<footer><strong>Illini Green</strong><span>A student-led campus green-space inventory.</span><span>Map data © OpenStreetMap contributors.</span></footer>

{#if selected}
  <div class="detail">
    <button class="close" on:click={() => selected = null}>×</button>
    <div class="detail-icon">🌿</div>
    <div class="eyebrow">APPROVED SPACE</div>
    <h2>{selected.name}</h2>
    <span class="tag">{selected.type}</span>
    <p>{selected.description}</p>
    <div class="location"><a href={selected.mapsUrl} target="_blank" rel="noopener">📍 {selected.location || 'Open in Google Maps'}</a></div>
    <a class="solid full" href={improvementUrl || '#actions'}>Propose an improvement here</a>
  </div>
{/if}
