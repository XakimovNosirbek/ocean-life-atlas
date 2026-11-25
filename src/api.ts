// Live data clients. Every service here allows browser requests (CORS *), needs no key, and is cached per session.
//   OBIS        https://api.obis.org/v3        species lists, ranges, depth/temperature statistics
//   WoRMS       https://www.marinespecies.org  search by common name, vernacular names
//   Wikidata    https://query.wikidata.org     photo, common name in the reader's language, Wikipedia article
//   Commons     https://commons.wikimedia.org  photo author and licence
//   Wikipedia   https://en.wikipedia.org       one-paragraph summary
//   Marine Regions https://www.marineregions.org  sea name for a point
import type { Bin, Taxon } from './taxa';
import { parseWikidata, type WikiInfo } from './wiki';
import type { Completion } from './search-merge';

const OBIS = 'https://api.obis.org/v3';
const WORMS = 'https://www.marinespecies.org/rest';
const cache = new Map<string, Promise<unknown>>();

export class HttpError extends Error {
  constructor(public status: number, url: string) { super(`HTTP ${status} for ${url}`); }
}

function getJSON<T>(url: string, init?: RequestInit, timeoutMs = 25000): Promise<T> {
  const key = url + (init?.body ? `|${String(init.body)}` : '');
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const once = () => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }).then(async (r) => {
    if (r.status === 204) return [] as T; // WoRMS answers "nothing found" with 204
    if (!r.ok) throw new HttpError(r.status, url);
    return (await r.json()) as T;
  });
  // Busy public services (Wikidata, OBIS) sometimes answer 5xx/429: try twice more with a pause.
  const p = retry(once, [1200, 3500]);
  cache.set(key, p);
  p.catch(() => cache.delete(key)); // do not keep failures
  return p;
}

async function retry<T>(fn: () => Promise<T>, waits: number[]): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const transient = e instanceof HttpError ? e.status >= 500 || e.status === 429 : e instanceof TypeError;
      if (!transient || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

const q = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

// ---------- OBIS ----------
export async function obisChecklist(wkt: string, size = 1000): Promise<{ total: number; results: Taxon[] }> {
  return getJSON(`${OBIS}/checklist?${q({ geometry: wkt, size })}`);
}
export interface ObisStats { records: number; species: number; datasets: number; yearrange?: [number, number] }
export function obisStatsArea(wkt: string): Promise<ObisStats> {
  return getJSON(`${OBIS}/statistics?${q({ geometry: wkt })}`);
}
export function obisStatsTaxon(id: number): Promise<ObisStats> {
  return getJSON(`${OBIS}/statistics?${q({ taxonid: id })}`);
}
export async function obisTaxon(id: number): Promise<Taxon | null> {
  const r = await getJSON<{ results: Taxon[] }>(`${OBIS}/taxon/${id}`);
  return r.results?.[0] ?? null;
}
export interface RangeCell { coordinates: [number, number][][]; n: number }
export async function obisRange(id: number, precision = 3): Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon, { n: number }>> {
  return getJSON(`${OBIS}/occurrence/grid/${precision}?${q({ taxonid: id })}`, undefined, 40000);
}
export interface EnvStats { depth: (Bin & { to?: number })[]; sst: { sst: number; records: number }[] }
export function obisEnv(id: number): Promise<EnvStats> {
  return getJSON(`${OBIS}/statistics/env?${q({ taxonid: id })}`);
}
/** OBIS record counts for many taxa in one request. */
export async function obisRecordCounts(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const r = await getJSON<{ results: Taxon[] }>(`${OBIS}/checklist?${q({ taxonid: ids.join(','), size: ids.length * 4 })}`).catch(() => null);
  for (const t of r?.results ?? []) if (ids.includes(t.taxonID)) out.set(t.taxonID, t.records ?? 0);
  return out;
}
export function obisComplete(text: string): Promise<Completion[]> {
  return getJSON(`${OBIS}/taxon/complete/verbose/${encodeURIComponent(text)}`);
}

// ---------- WoRMS ----------
export interface AphiaRecord {
  AphiaID: number; scientificname: string; status: string; rank: string; valid_AphiaID: number | null; valid_name: string | null;
  kingdom: string | null; phylum: string | null; class: string | null; order: string | null; family: string | null;
  isMarine?: number | null;
}
export function wormsByVernacular(name: string, like = true, offset = 1): Promise<AphiaRecord[]> {
  return getJSON(`${WORMS}/AphiaRecordsByVernacular/${encodeURIComponent(name)}?like=${like}&offset=${offset}`);
}
export async function wormsEnglishName(id: number): Promise<string | null> {
  const v = await getJSON<{ vernacular: string; language_code: string }[]>(`${WORMS}/AphiaVernacularsByAphiaID/${id}`).catch(() => []);
  return v.find((x) => x.language_code === 'eng')?.vernacular ?? null;
}

// ---------- Wikidata / Commons / Wikipedia ----------
export function readerLanguage(): string {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(l) ? l : 'en';
}

/** Wikidata facts for WoRMS ids. Primary endpoint: QLever (a fast public mirror of Wikidata, CORS *); fallback: the
 *  Wikidata Query Service, which is often rate-limited (seen on 2026-11-25: "1 req / min" during an outage). */
const SPARQL_ENDPOINTS = ['https://qlever.dev/api/wikidata', 'https://query.wikidata.org/sparql'];
const PREFIXES = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
`;
type Bindings = { results: { bindings: Record<string, { value: string }>[] } };

export function speciesQuery(ids: number[], lang: string): string {
  const safeLang = /^[a-z]{2,3}$/.test(lang) ? lang : 'en';
  return `${PREFIXES}SELECT ?aphia (SAMPLE(?img) AS ?image) (SAMPLE(?cn) AS ?common) (SAMPLE(?lab) AS ?label)
  (SAMPLE(?cnEn) AS ?commonEn) (SAMPLE(?labEn) AS ?labelEn) (SAMPLE(?art) AS ?article) WHERE {
  VALUES ?aphia { ${ids.filter(Number.isInteger).map((id) => `"${id}"`).join(' ')} }
  ?item wdt:P850 ?aphia .
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P1843 ?cn FILTER(LANG(?cn) = "${safeLang}") }
  OPTIONAL { ?item rdfs:label ?lab FILTER(LANG(?lab) = "${safeLang}") }
  OPTIONAL { ?item wdt:P1843 ?cnEn FILTER(LANG(?cnEn) = "en") }
  OPTIONAL { ?item rdfs:label ?labEn FILTER(LANG(?labEn) = "en") }
  OPTIONAL { ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
} GROUP BY ?aphia`;
}

export async function wikidataByAphia(ids: number[], sciById?: Map<number, string>, lang = readerLanguage()): Promise<Map<number, WikiInfo>> {
  const out = new Map<number, WikiInfo>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
  await Promise.all(chunks.map(async (chunk) => {
    const query = speciesQuery(chunk, lang);
    for (const ep of SPARQL_ENDPOINTS) {
      const r = await getJSON<Bindings>(`${ep}?${q({ query })}`, { headers: { Accept: 'application/sparql-results+json' } }, 15000).catch(() => null);
      if (r?.results?.bindings) { for (const [k, v] of parseWikidata(r.results.bindings, sciById)) out.set(k, v); return; }
    }
  }));
  return out;
}

export interface Credit { artist: string; licence: string; page: string }
export async function commonsCredits(files: string[]): Promise<Map<string, Credit>> {
  const out = new Map<string, Credit>();
  const strip = (s?: string) => (s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < files.length; i += 40) {
    const titles = files.slice(i, i + 40).map((f) => `File:${f}`).join('|');
    const r = await getJSON<{ query?: { normalized?: { from: string; to: string }[]; pages: Record<string, { title: string; imageinfo?: { extmetadata?: Record<string, { value: string }>; descriptionurl?: string }[] }> } }>(
      `https://commons.wikimedia.org/w/api.php?${q({ action: 'query', titles, prop: 'imageinfo', iiprop: 'extmetadata|url', format: 'json', origin: '*' })}`,
    ).catch(() => null);
    if (!r?.query) continue;
    const back = new Map((r.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of Object.values(r.query.pages)) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const title = back.get(p.title) ?? p.title;
      out.set(title.replace(/^File:/, ''), {
        artist: strip(ii.extmetadata?.Artist?.value) || 'Unknown author',
        licence: strip(ii.extmetadata?.LicenseShortName?.value) || 'see file page',
        page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
      });
    }
  }
  return out;
}

export async function wikipediaSummary(title: string): Promise<{ extract: string; url: string } | null> {
  const r = await getJSON<{ extract?: string; content_urls?: { desktop?: { page?: string } }; type?: string }>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  ).catch(() => null);
  if (!r?.extract || r.type === 'disambiguation') return null;
  return { extract: r.extract, url: r.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
}

// ---------- Marine Regions ----------
type Gaz = { preferredGazetteerName: string; placeType: string };
const LOCAL = ['Reef', 'Bay', 'Gulf', 'Strait', 'Sound', 'Lagoon', 'Fjord', 'Estuary', 'Sea'];
const WATER = new Set(['IHO Sea Area', 'EEZ', 'Territorial Sea', 'Internal waters', 'High Seas', 'Ocean', 'Sea']);

export interface PlaceName { name: string; land: boolean }

export async function seaName(lat: number, lon: number): Promise<PlaceName | null> {
  const r = await getJSON<Gaz[]>(
    `https://www.marineregions.org/rest/getGazetteerRecordsByLatLong.json/${lat.toFixed(3)}/${lon.toFixed(3)}/`, undefined, 12000,
  ).catch(() => []);
  return pickSeaName(r);
}

/** Most specific water body plus its sea ("Great Barrier Reef, Coral Sea"); a country name when the point is on land. */
export function pickSeaName(r: Gaz[]): PlaceName | null {
  if (!r.length) return null;
  if (!r.some((x) => WATER.has(x.placeType))) {
    const nation = r.find((x) => x.placeType === 'Nation') ?? r.find((x) => x.placeType === 'Continent');
    return nation ? { name: nation.preferredGazetteerName, land: true } : null;
  }
  const iho = r.filter((x) => x.placeType === 'IHO Sea Area').map((x) => x.preferredGazetteerName);
  // a named sea ("Coral Sea") is more useful than the ocean around it ("South Pacific Ocean")
  const sea = iho.find((n) => !/Ocean/.test(n)) ?? iho[0] ?? r.find((x) => x.placeType === 'Ocean')?.preferredGazetteerName;
  const local = LOCAL.map((t) => r.find((x) => x.placeType === t)).find(Boolean)?.preferredGazetteerName;
  if (local && sea && local !== sea) return { name: `${local}, ${sea}`, land: false };
  const name = local ?? sea;
  return name ? { name, land: false } : null;
}
