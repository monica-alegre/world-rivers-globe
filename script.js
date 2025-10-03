/* global Globe */
const el = document.getElementById('globeViz');

// ---------- Globe setup ----------
const world = new Globe(el)
  .globeImageUrl('data/basemap.jpg')
  .backgroundColor('#01070e')
  .showAtmosphere(true)
  .atmosphereColor('#2b5e91')   // blue tone to match halo
  .atmosphereAltitude(0.15)       // slightly thicker halo
  .showGraticules(false)
  .lineHoverPrecision(2.5)
  .pathTransitionDuration(0);     // disable path morphing to avoid stutter

// Force ambient-only blue lighting (kill any DirectionalLight)
function applyBlueAmbient() {
  if (window.THREE && typeof world.lights === 'function') {
    world.lights([ new THREE.AmbientLight(0x224477, 0.8) ]);
  }
}
applyBlueAmbient();

// Guard against late-added default lights (remove Directional if it reappears)
if (world.scene().addEventListener) {
  world.scene().addEventListener('childadded', (ev) => {
    const c = ev.child;
    if (c && c.isLight && c.type === 'DirectionalLight') {
      world.scene().remove(c);
      applyBlueAmbient(); // keep ambient-only
    }
  });
}

// Initial POV without animation (smooth entry)
world.pointOfView({ lat: 0, lng: 0, altitude: 2 }); // no duration

// Enable auto-rotate at start; stop on any user interaction
world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 1;
world.controls().addEventListener('start', () => {
  world.controls().autoRotate = false;
});

// Resize
function fit() { world.width(window.innerWidth).height(window.innerHeight); }
fit();
window.addEventListener('resize', fit);

// ---------- Data containers ----------
let visualPaths = [];
let virtualPaths = [];
let allPaths = [];
let SELECT = []; // selection state (array of selected virtual features)

// UI controls
const slider = document.getElementById('lenSlider');
const sliderVal = document.getElementById('lenValue');
const resetBtn = document.getElementById('resetBtn');
const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const infoClose = document.getElementById('info-close');

// Info modal handlers
infoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  infoModal.classList.remove('hidden');
});
infoClose.addEventListener('click', (e) => {
  e.stopPropagation();
  infoModal.classList.add('hidden');
});

// ---------- Load all layers ----------
(async function init() {
  try {
    // Load all data first before any animation
    const [visResp, virtResp] = await Promise.all([
      fetch('data/ne_rivers.geojson'),
      fetch('data/ne_rivers_virtual.geojson')
    ]);
    if (!visResp.ok) throw new Error('Failed to load ne_rivers.geojson');
    if (!virtResp.ok) throw new Error('Failed to load ne_rivers_virtual.geojson');

    const visGJ = await visResp.json();
    const virtGJ = await virtResp.json();

    // --- VISUAL: style by strokeweig, store riverlength if present ---
    visualPaths = visGJ.features.flatMap(f => {
      const props = f.properties || {};
      const strokeVal = Number(props.strokeweig ?? props.strokewieg ?? 1);
      const riverlength = numOrNull(props.riverlength); // aggregated river length

      if (f.geometry?.type === 'LineString') {
        return [{
          _layer: 'visual',
          strokeVal,
          riverlength,
          pnts: f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        }];
      } else if (f.geometry?.type === 'MultiLineString') {
        return f.geometry.coordinates.map(line => ({
          _layer: 'visual',
          strokeVal,
          riverlength,
          pnts: line.map(([lng, lat]) => [lat, lng])
        }));
      }
      return [];
    });

    // Compute stroke scale (safe)
    const strokeVals = visualPaths.map(d => d.strokeVal).filter(Number.isFinite);
    const strokeMin = strokeVals.length ? Math.min(...strokeVals) : 0;
    const strokeMax = strokeVals.length ? Math.max(...strokeVals) : 1;
    const strokeRange = Math.max(1e-9, strokeMax - strokeMin);

    // Use logarithmic scaling for smoother transitions
    const strokePx = v => {
      const norm = Math.log1p(v - strokeMin) / Math.log1p(strokeRange);
      return 0.5 + norm * 2.5;
    };

    const colorFromStroke = v => {
      // Enhanced gradient: dark blue (small rivers) -> bright cyan (major rivers)
      const t = (v - strokeMin) / strokeRange;
      const dark  = [5, 25, 70];      // #030c25 - dark blue
      const light = [120, 210, 255];  // #6ecefd - bright cyan
      const r = Math.round(dark[0] + (light[0] - dark[0]) * t);
      const g = Math.round(dark[1] + (light[1] - dark[1]) * t);
      const b = Math.round(dark[2] + (light[2] - dark[2]) * t);
      return `rgb(${r},${g},${b})`;
    };

    // --- VIRTUAL: tooltip + click + popup (use Wikidata) ---
    virtualPaths = virtGJ.features.flatMap(f => {
      const props = f.properties || {};
      const name = props.name || props.NAME || props.river || 'Unnamed river';
      const qid  = props.wikidataid || props.wikidata || props.wikitaid || null;
      const riverlength = numOrNull(props.riverlength); // aggregated river length
      const rivernum = props.rivernum || props.RIVERNUM || null;

      if (f.geometry?.type === 'LineString') {
        return [{
          _layer: 'virtual',
          name, qid, riverlength, rivernum,
          pnts: f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        }];
      } else if (f.geometry?.type === 'MultiLineString') {
        return f.geometry.coordinates.map(line => ({
          _layer: 'virtual',
          name, qid, riverlength, rivernum,
          pnts: line.map(([lng, lat]) => [lat, lng])
        }));
      }
      return [];
    });

    // Combine visual and virtual
    allPaths = [...visualPaths, ...virtualPaths];

    // Visual constants
    const VIRTUAL_BASE_COLOR = 'rgba(255,255,255,0)'; // fully invisible unless selected
    const VIRTUAL_SEL_COLOR  = 'rgba(0,200,255,1.0)';   // cyan
    const VIRTUAL_STROKE_PX  = 6.0;                     // thick hitbox
    const VIRTUAL_ALT        = 0.003;                   // slightly above visual layer

    // Stable accessors
    const pointAlt = d => (d._layer === 'virtual' ? VIRTUAL_ALT : 0.0);
    const stroke   = d => {
      if (d._layer === 'visual') return strokePx(d.strokeVal);
      return VIRTUAL_STROKE_PX;
    };
    const color = d => {
      if (d._layer === 'visual') return colorFromStroke(d.strokeVal);
      return SELECT.includes(d) ? VIRTUAL_SEL_COLOR : VIRTUAL_BASE_COLOR;
    };

    // Load all data and configure
    world
      .pathsData(allPaths)
      .pathPoints('pnts')
      .pathPointLat(p => p[0])
      .pathPointLng(p => p[1])
      .pathPointAlt(pointAlt)
      .pathStroke(stroke)
      .pathColor(color)
      .pathLabel(d => d._layer === 'virtual' ? `<strong>${escapeHtml(d.name)}</strong>` : null)
      .onPathHover(d => {
        el.style.cursor = (d && d._layer === 'virtual') ? 'pointer' : '';
      })
      .onPathClick(d => {
        console.log('Path clicked:', d);
        if (!d || d._layer !== 'virtual') {
          console.log('Click ignored - not virtual layer');
          return;
        }

        console.log('Virtual path clicked:', d.name, 'rivernum:', d.rivernum);

        // Select all segments with the same rivernum
        if (d.rivernum != null) {
          SELECT = virtualPaths.filter(p => p.rivernum === d.rivernum);
        } else {
          SELECT = [d];
        }
        world.pathColor(world.pathColor()); // refresh selection color

        openPopup(loadingCard(d.name));
        if (d.qid) {
          fetchWikiByQID(d.qid).then(info => updatePopup(info, d.name, d.qid));
        } else {
          updatePopup(null, d.name, null);
        }
      });

    // Close popup → clear selection and refresh color
    document.getElementById('popup-close').addEventListener('click', () => {
      document.getElementById('popup').classList.add('hidden');
      SELECT = [];
      world.pathColor(world.pathColor());
    });

    // ------ Slider setup (riverlength: 0-5000 km with snaps) ------
    const snapValues = [0, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
    slider.min = '0';
    slider.max = String(snapValues.length - 1);
    slider.step = '1';
    slider.value = '0';
    sliderVal.textContent = '0';

    console.log('Slider initialized with snaps:', snapValues);

    slider.addEventListener('input', () => {
      const snapIndex = Number(slider.value);
      const minLen = snapValues[snapIndex];
      sliderVal.textContent = String(minLen);

      // Filter both visual and virtual layers by riverlength
      const filteredVisual = minLen > 0
        ? visualPaths.filter(d => Number.isFinite(d.riverlength) && d.riverlength >= minLen)
        : visualPaths;

      const filteredVirtual = minLen > 0
        ? virtualPaths.filter(d => Number.isFinite(d.riverlength) && d.riverlength >= minLen)
        : virtualPaths;

      const next = [...filteredVisual, ...filteredVirtual];

      console.log('Filter minLen:', minLen, 'Visual:', filteredVisual.length, 'Virtual:', filteredVirtual.length, 'Total:', next.length);

      // Clear selection if any selected feature is no longer present
      SELECT = SELECT.filter(s => next.includes(s));
      world.pathsData(next);
      // No need to re-set accessors; they remain bound
    });

    // ------ Reset button ------
    resetBtn.addEventListener('click', () => {
      world.pointOfView({ lat: 0, lng: 0, altitude: 2 }, 1000);
      world.controls().autoRotate = true;

      document.getElementById('popup').classList.add('hidden');
      SELECT = [];
      world.pathColor(world.pathColor());

      // Keep ambient-only lighting after reset
      if (typeof applyBlueAmbient === 'function') applyBlueAmbient();
    });

  } catch (err) {
    console.error('Error loading layers:', err);
  }
})();

// ---------- Popup ----------
function openPopup(innerHTML) {
  const el = document.getElementById('popup');
  const content = document.getElementById('popup-content');
  content.innerHTML = innerHTML;
  el.classList.remove('hidden');
}
function loadingCard(name) {
  return `<h3>${escapeHtml(name)}</h3><p>Loading preview…</p>`;
}

// ---------- Wikidata helpers ----------
async function fetchWikiByQID(qid) {
  try {
    // Entity data
    const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    if (!r.ok) return null;
    const data = await r.json();
    const entity = data.entities?.[qid];
    if (!entity) return null;

    // Preferred sitelink for summary
    const sl = entity.sitelinks || {};
    const site = sl.enwiki || sl.eswiki;
    let title = site ? site.title : null;
    let summary = null;
    if (title) {
      const rest = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
      if (rest.ok) summary = await rest.json();
    }

    // Claims: pick 'preferred' rank first
    const claims = entity.claims || {};
    const lenClaim = pickQuantity(claims.P2043); // length
    const widClaim = pickQuantity(claims.P2049); // width
    const countryIds = (claims.P17 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

    // Convert units
    const lengthKm = lenClaim ? convertLengthToKm(lenClaim.amount, lenClaim.unit) : null;
    const widthM   = widClaim ? convertWidthToM(widClaim.amount, widClaim.unit)   : null;

    // Resolve country labels (if any)
    let countryNames = null;
    if (countryIds.length) {
      countryNames = await fetchLabels(countryIds, 'en'); // array of names
    }

    return {
      title: summary?.title || title || '',
      extract: summary?.extract || '',
      url: summary?.content_urls?.desktop?.page || (site ? site.url : ''),
      thumb: summary?.thumbnail?.source || null,
      length: lengthKm ? formatKm(lengthKm) : null,     // main value only
      width:  widthM  ? `≈ ${formatM(widthM)}` : null,  // show as average with ≈
      country: countryNames ? countryNames.join(', ') : null
    };
  } catch {
    return null;
  }
}

// Pick a numeric claim preferring 'preferred' rank; returns {amount, unit} or null
function pickQuantity(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const pref = arr.find(c => c.rank === 'preferred') || arr[0];
  const v = pref?.mainsnak?.datavalue?.value;
  if (!v || typeof v.amount === 'undefined') return null;
  const amount = parseFloat(v.amount);
  const unit = v.unit || '';
  if (!Number.isFinite(amount)) return null;
  return { amount, unit };
}

// Convert length to kilometers from Wikidata units
function convertLengthToKm(amount, unit) {
  // metre QID: Q11573, kilometre QID: Q828224
  if (unit.endsWith('/Q11573')) return amount / 1000; // metres -> km
  if (unit.endsWith('/Q828224')) return amount;       // km
  return amount; // fallback (assume km)
}

// Convert width to meters from Wikidata units
function convertWidthToM(amount, unit) {
  if (unit.endsWith('/Q11573')) return amount;        // m
  if (unit.endsWith('/Q828224')) return amount * 1000;// km -> m (rare)
  return amount; // fallback
}

// Resolve labels for QIDs (country names)
async function fetchLabels(qids, lang = 'en') {
  const ids = Array.from(new Set(qids)).join('|');
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels&languages=${lang}&format=json&origin=*`;
  const r = await fetch(url);
  if (!r.ok) return qids;
  const j = await r.json();
  const out = [];
  for (const id of Object.keys(j.entities || {})) {
    const lbl = j.entities[id]?.labels?.[lang]?.value;
    if (lbl) out.push(lbl);
  }
  return out.length ? out : qids;
}

// ---------- Formatting ----------
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function formatKm(km) {
  return Number(km).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function formatM(m) {
  return Number(m).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ---------- Popup ----------
function updatePopup(info, name, qid) {
  const content = document.getElementById('popup-content');
  if (!info) {
    content.innerHTML = `<h3>${escapeHtml(name)}</h3><p>No information available.</p>`;
    return;
  }

  let html = `<h3>${escapeHtml(info.title || name)}</h3>`;

  if (info.thumb) {
    html += `<img src="${escapeHtml(info.thumb)}" class="thumb" alt="${escapeHtml(info.title || name)}" />`;
  }

  if (info.length) {
    html += `<p><strong>Length:</strong> ${escapeHtml(info.length)} km</p>`;
  }
  if (info.width) {
    html += `<p><strong>Width:</strong> ${escapeHtml(info.width)} m</p>`;
  }
  if (info.country) {
    html += `<p><strong>Country:</strong> ${escapeHtml(info.country)}</p>`;
  }

  if (info.extract) {
    html += `<p>${escapeHtml(info.extract)}</p>`;
  }

  if (info.url) {
    html += `<p><a href="${escapeHtml(info.url)}" target="_blank" rel="noopener">Read more →</a></p>`;
  }

  content.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}
