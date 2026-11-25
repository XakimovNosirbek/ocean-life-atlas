// Species-page sections about movement and time:
//   "How it travels"     MiCO migration network (stored) and satellite-tag tracks from OBIS (live, on request)
//   "When it is recorded" records by month (from a random sample) and by decade (OBIS statistics)
import * as api from './api';
import { h, fmt } from './dom';
import { greatCircle } from './geo';
import { ACTIVITY_COLORS, TRACK_COLORS } from './map';
import { buildTracks, decadeCounts, isTelemetry, monthCounts, trackAt, type OccRow, type Track } from './tracks';

export interface JourneyHost {
  setOverlay(source: 'micoRoutes' | 'micoSites' | 'tracks' | 'heads', fc: GeoJSON.FeatureCollection | null): void;
  dimRange(dim: boolean): void;
  fitTo(points: [number, number][]): void;
  base: string;
}

const MAX_TRACK_ROWS = 30000;
/** Dataset ids go in the URL (36 characters each); 40 keeps the request well under server URL limits. */
const MAX_TRACK_DATASETS = 40;
const MAX_TRACKS_DRAWN = 150;
const PLAY_MS = 14000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ext = { target: '_blank', rel: 'noopener' };

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

export function activityKind(act: string): keyof typeof ACTIVITY_COLORS {
  if (/breed|nest|calv|pup/i.test(act)) return 'breeding';
  if (/feed|forag/i.test(act)) return 'feeding';
  if (/migrat/i.test(act)) return 'migrating';
  return 'observed';
}

/** The busiest run of three consecutive months (wrapping Dec to Jan), or null when records are spread evenly. */
export function peakSeason(m: number[]): { from: number; to: number; share: number } | null {
  const total = m.reduce((a, b) => a + b, 0);
  if (total < 30) return null;
  let best = 0, at = 0;
  for (let i = 0; i < 12; i++) {
    const s = m[i] + m[(i + 1) % 12] + m[(i + 2) % 12];
    if (s > best) { best = s; at = i; }
  }
  const share = best / total;
  return share >= 0.4 ? { from: at, to: (at + 2) % 12, share } : null; // three months hold 25 % by chance
}

/** Everything a species page adds below the summary. Returns a cleanup that stops animations and clears the globe. */
export function renderJourneys(id: number, commonName: string, mount: HTMLElement, host: JourneyHost, alive: () => boolean): () => void {
  let raf = 0, stopped = false;
  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    for (const s of ['micoRoutes', 'micoSites', 'tracks', 'heads'] as const) host.setOverlay(s, null);
    host.dimRange(false);
  };
  const ok = () => alive() && !stopped;

  const travel = h('section', { class: 'journeys' }, h('h3', { text: 'How it travels' }));
  const micoBox = h('div', { class: 'mico' });
  const tagBox = h('div', { class: 'tags' }, h('p', { class: 'fine', text: 'Looking for tagged animals…' }));
  travel.append(micoBox, tagBox);
  const when = h('section', { class: 'seasons' }, h('h3', { text: 'When it is recorded' }), h('p', { class: 'fine', text: 'Loading…' }));
  mount.append(travel, when);

  let shown = { mico: false, tracks: false };
  const updateDim = () => host.dimRange(shown.mico || shown.tracks);

  // ---- MiCO network ----
  api.micoIndex(host.base).then(async (idx) => {
    const meta = idx.species[String(id)];
    if (!meta || !ok()) { micoBox.remove(); return; }
    const d = await api.micoSpecies(host.base, id);
    if (!ok()) return;
    const sites = fc(d.sites.map(([lon, lat, n, act]) => ({
      type: 'Feature', properties: { n, kind: activityKind(act) }, geometry: { type: 'Point', coordinates: [lon, lat] },
    })));
    const routes = fc(d.routes.map(([x1, y1, x2, y2, n]) => ({
      type: 'Feature', properties: { n }, geometry: { type: 'LineString', coordinates: greatCircle([x1, y1], [x2, y2], 24) },
    })));
    const btn = h('button', { class: 'btn small', text: 'Hide the network', attrs: { 'aria-pressed': 'true' } });
    const show = (on: boolean) => {
      shown.mico = on;
      host.setOverlay('micoSites', on ? sites : null);
      host.setOverlay('micoRoutes', on ? routes : null);
      btn.textContent = on ? 'Hide the network' : 'Show the network';
      btn.setAttribute('aria-pressed', String(on));
      updateDim();
    };
    btn.addEventListener('click', () => show(!shown.mico));
    const kinds = new Set(sites.features.map((f) => f.properties!.kind as keyof typeof ACTIVITY_COLORS));
    const label: Record<keyof typeof ACTIVITY_COLORS, string> = { breeding: 'breeding or nesting', feeding: 'feeding', migrating: 'on the move', observed: 'seen' };
    micoBox.append(
      h('p', { text: `Migration network: ${fmt(d.sites.length)} places where this species gathers${d.routes.length ? ` and ${fmt(d.routes.length)} routes between them` : ''}, pieced together from published tracking and tagging studies.` }),
      h('ul', { class: 'legend-dots' }, ...[...kinds].map((k) => h('li', {}, h('span', { class: 'dot', attrs: { style: `background:${ACTIVITY_COLORS[k]}` } }), label[k])),
        d.routes.length ? h('li', {}, h('span', { class: 'line' }), 'route') : null),
      btn,
      h('p', { class: 'fine' }, 'MiCO, ', h('a', { text: 'Bentley et al. 2025, Nature Communications', attrs: { href: 'https://doi.org/10.1038/s41467-025-59271-7', ...ext } }),
        '; data ', h('a', { text: 'CC0', attrs: { href: 'https://doi.org/10.5281/zenodo.14873514', ...ext } }), '. Places are summaries of many animals, not exact spots.'),
    );
    show(true);
    host.fitTo(d.sites.map(([lon, lat]) => [lon, lat]));
  }).catch(() => micoBox.remove());

  // ---- sample: seasonality now, tracks on request ----
  Promise.all([api.obisSample(id).catch(() => null), api.obisYears(id).catch(() => [])]).then(([sample, years]) => {
    if (!ok()) return;
    renderSeasons(when, sample?.results ?? [], years);
    if (!sample) { tagBox.replaceChildren(h('p', { class: 'fine', text: 'Tracking data did not load. Open the species again to retry.' })); return; }
    const tagged = new Map<string, Set<string>>(), rowsPer = new Map<string, number>();
    for (const r of sample.results) if (isTelemetry(r)) {
      if (!tagged.has(r.dataset_id!)) tagged.set(r.dataset_id!, new Set());
      tagged.get(r.dataset_id!)!.add(r.organismID!);
      rowsPer.set(r.dataset_id!, (rowsPer.get(r.dataset_id!) ?? 0) + 1);
    }
    const studies = [...rowsPer.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
    const used = studies.slice(0, MAX_TRACK_DATASETS);
    if (!tagged.size) {
      tagBox.replaceChildren(h('p', { class: 'fine', text: `No tracks of tagged animals for ${commonName.toLowerCase()} in OBIS.` }));
      return;
    }
    const animals = [...tagged.values()].reduce((a, s) => a + s.size, 0);
    const go = h('button', { class: 'btn small', text: 'Show their journeys' });
    const status = h('p', { class: 'fine', attrs: { 'aria-live': 'polite' } });
    tagBox.replaceChildren(
      h('p', { text: `Tagged animals: at least ${fmt(animals)} carried a satellite or acoustic tag, in ${fmt(tagged.size)} ${tagged.size === 1 ? 'study' : 'studies'} published to OBIS.` }),
      go, status);
    go.addEventListener('click', async () => {
      go.disabled = true;
      status.textContent = 'Loading tracking records…';
      try {
        const { rows, total } = await api.obisRowsInDatasets(id, used, MAX_TRACK_ROWS,
          (got, all) => { if (ok()) status.textContent = `Loading tracking records: ${fmt(got)} of ${fmt(all)}…`; });
        if (!ok()) return;
        const notes = [rows.length < total ? `the first ${fmt(rows.length)} of ${fmt(total)} records` : '',
          studies.length > used.length ? `the ${used.length} largest of ${studies.length} studies` : ''].filter(Boolean);
        showTracks(buildTracks(rows), notes.length ? notes.join(' in ') : null);
      } catch {
        if (ok()) { status.textContent = 'Tracking records did not load. Try again in a moment.'; go.disabled = false; }
      }
    });

    const showTracks = (tracks: Track[], partial: string | null) => {
      if (!tracks.length) { tagBox.replaceChildren(h('p', { class: 'fine', text: 'The tag records here are too sparse to draw a path.' })); return; }
      const drawn = tracks.slice(0, MAX_TRACKS_DRAWN);
      const full = fc(drawn.flatMap((tr, i) => tr.segments.map((seg) => ({
        type: 'Feature' as const, properties: { c: i }, geometry: { type: 'LineString' as const, coordinates: seg.map(([x, y]) => [x, y]) },
      }))));
      const heads = (frac: number) => fc(drawn.flatMap((tr, i) => {
        const p = trackAt(tr, frac).head;
        return p ? [{ type: 'Feature' as const, properties: { c: i }, geometry: { type: 'Point' as const, coordinates: p } }] : [];
      }));
      shown.tracks = true;
      updateDim();
      host.setOverlay('tracks', full);
      host.setOverlay('heads', heads(1));
      host.fitTo(drawn.flatMap((tr) => tr.segments.flat().map(([x, y]) => [x, y] as [number, number])));

      const play = h('button', { class: 'btn small', text: 'Play journeys' });
      const clock = h('span', { class: 'clock', attrs: { 'aria-live': 'off' } });
      play.addEventListener('click', () => {
        cancelAnimationFrame(raf);
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const t0 = performance.now();
        let last = 0;
        const longest = Math.max(...drawn.map((tr) => tr.end - tr.start));
        const frame = (now: number) => {
          if (!ok()) return;
          const f = reduce ? 1 : Math.min(1, (now - t0) / PLAY_MS);
          if (now - last > 40 || f === 1) { // ~25 frames a second is plenty and keeps the globe smooth
            last = now;
            host.setOverlay('tracks', fc(drawn.flatMap((tr, i) => trackAt(tr, f).upto.map((part) => ({
              type: 'Feature' as const, properties: { c: i }, geometry: { type: 'LineString' as const, coordinates: part },
            })))));
            host.setOverlay('heads', heads(f));
            clock.textContent = `day ${fmt(Math.round((f * longest) / 86400000))} after tagging`;
          }
          if (f < 1) raf = requestAnimationFrame(frame);
          else clock.textContent = 'all journeys, start to last signal';
        };
        raf = requestAnimationFrame(frame);
      });

      const longestKm = drawn[0].km;
      const list = h('ol', { class: 'track-list' }, ...drawn.slice(0, 5).map((tr, i) => h('li', {},
        h('span', { class: 'dot', attrs: { style: `background:${TRACK_COLORS[i % TRACK_COLORS.length]}` } }),
        `${/^\d+$/.test(tr.animal) ? `Tag ${tr.animal}` : tr.animal}: ${fmt(tr.km)} km, ${new Date(tr.start).getUTCFullYear()}${new Date(tr.end).getUTCFullYear() !== new Date(tr.start).getUTCFullYear() ? `–${new Date(tr.end).getUTCFullYear()}` : ''}`)));
      const credits = h('p', { class: 'fine', text: 'Loading who tagged them…' });
      tagBox.replaceChildren(
        h('p', { text: `${fmt(tracks.length)} tagged ${tracks.length === 1 ? 'animal' : 'animals'}; the longest path is ${fmt(longestKm)} km. Each colour is one animal${tracks.length > drawn.length ? ` (the ${drawn.length} longest are drawn)` : ''}.` }),
        h('div', { class: 'play-row' }, play, clock), list, credits,
        h('p', { class: 'fine', text: 'Acoustic tags are heard only near listening stations, so their paths join those stations. Gaps of more than 20 days are left open, and fixes that would need more than 1,200 km a day are dropped as location errors.' }));
      if (partial) tagBox.append(h('p', { class: 'fine', text: `Drawn from ${partial}.` }));

      const byDataset = new Map<string, number>();
      for (const tr of drawn) byDataset.set(tr.dataset, (byDataset.get(tr.dataset) ?? 0) + 1);
      const top = [...byDataset.entries()].sort((a, b) => b[1] - a[1]);
      Promise.all(top.slice(0, 6).map(([d]) => api.obisDataset(d))).then((metas) => {
        if (!ok()) return;
        const items = metas.filter((m): m is api.DatasetMeta => !!m);
        credits.replaceChildren('Tracks from ', ...items.flatMap((m, i) => [
          i ? (i === items.length - 1 && top.length <= 6 ? ' and ' : ', ') : '',
          h('a', { text: m.title, attrs: { href: m.url, ...ext } }), ` (${m.licence})`,
        ]), top.length > 6 ? ` and ${top.length - 6} more studies in OBIS.` : ', through OBIS.');
        if (items.some((m) => /aggregated|1-degree|rounded/i.test(m.title))) {
          credits.after(h('p', { class: 'fine', text: 'Some studies publish positions rounded to 1° squares to protect the animals, so their paths look stepped.' }));
        }
      });
    };
  });

  return cleanup;
}

function renderSeasons(section: HTMLElement, rows: OccRow[], years: { year: number; records: number }[]) {
  const m = monthCounts(rows);
  const n = m.reduce((a, b) => a + b, 0);
  const dec = decadeCounts(years);
  section.replaceChildren(h('h3', { text: 'When it is recorded' }));
  if (n >= 30) {
    const max = Math.max(...m);
    const peak = peakSeason(m);
    section.append(
      h('p', { text: peak ? `Most records from ${FULL_MONTHS[peak.from]} to ${FULL_MONTHS[peak.to]} (${Math.round(peak.share * 100)} %).` : 'Recorded all year round, without a clear season.' }),
      h('ol', { class: 'months', attrs: { 'aria-label': 'Records by month' } }, ...m.map((v, i) => h('li', { attrs: { title: `${FULL_MONTHS[i]}: ${fmt(v)}` } },
        h('span', { class: 'mbar', attrs: { style: `--h:${(v / max) * 100}%` } }), h('span', { class: 'mlabel', text: MONTHS[i][0] })))),
      h('p', { class: 'fine', text: `From a random sample of ${fmt(n)} dated records. North and south of the equator the seasons are opposite.` }),
    );
  }
  if (dec.length > 1) {
    const max = Math.max(...dec.map((d) => d.records));
    section.append(
      h('ol', { class: 'decades', attrs: { 'aria-label': 'Records by decade' } }, ...dec.map((d) => h('li', { attrs: { title: `${d.decade}s: ${fmt(d.records)}` } },
        h('span', { class: 'mbar', attrs: { style: `--h:${Math.max(d.records ? 4 : 0, Math.sqrt(d.records / max) * 100)}%` } })))),
      h('p', { class: 'fine', text: `Records per decade, ${dec[0].decade}s to ${dec.at(-1)!.decade}s (bar height grows with the square root, so small decades stay visible). Both charts also show when people went looking.` }),
    );
  }
  if (n < 30 && dec.length <= 1) section.append(h('p', { class: 'fine', text: 'Too few dated records to show a pattern.' }));
}
