// Tag tracks (satellite and acoustic) and seasonality from OBIS occurrence rows. Pure (test/tracks.test.ts).
//
// OBIS publishes animal telemetry (e.g. the US Animal Telemetry Network) as ordinary occurrence rows with
// basisOfRecord "MachineObservation" and the tagged animal in organismID. The API ignores a basisofrecord filter,
// so rows are filtered here.

export interface OccRow {
  id?: string;
  organismID?: string;
  eventDate?: string;
  decimalLongitude?: number;
  decimalLatitude?: number;
  dataset_id?: string;
  basisOfRecord?: string;
  month?: string | number;
}

export interface Track {
  key: string;            // dataset_id|organismID
  dataset: string;
  animal: string;
  start: number;          // ms since epoch
  end: number;
  km: number;
  /** One or more continuous pieces; a long silence or an impossible jump starts a new piece. */
  segments: [number, number, number][][]; // [lon, lat, t] with lon unwrapped across the antimeridian
}

const DAY = 86400000;
/** Gap that starts a new piece of line: a tag silent for this long tells us nothing about the path in between. */
export const MAX_GAP_DAYS = 20;
/** Faster than this between fixes is a location error, not swimming or flying (albatrosses manage ~1,000 km/day). */
export const MAX_KM_PER_DAY = 1200;

export function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const first = s.split('/')[0].trim().replace(' ', 'T');
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(first) || first.length <= 10 ? first : `${first}Z`);
  return Number.isFinite(t) ? t : null;
}

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isTelemetry(r: OccRow): boolean {
  return r.basisOfRecord === 'MachineObservation' && !!r.organismID && !!r.dataset_id
    && Number.isFinite(r.decimalLongitude) && Number.isFinite(r.decimalLatitude);
}

export function buildTracks(rows: OccRow[], minFixes = 5): Track[] {
  const groups = new Map<string, { t: number; lon: number; lat: number }[]>();
  for (const r of rows) {
    if (!isTelemetry(r)) continue;
    const t = parseDate(r.eventDate);
    if (t == null) continue;
    const key = `${r.dataset_id}|${r.organismID}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ t, lon: r.decimalLongitude!, lat: r.decimalLatitude! });
  }
  const out: Track[] = [];
  for (const [key, pts] of groups) {
    if (pts.length < minFixes) continue;
    pts.sort((a, b) => a.t - b.t);
    const segments: [number, number, number][][] = [];
    let seg: [number, number, number][] = [], km = 0, prev: (typeof pts)[0] | null = null, lonU = 0;
    for (const p of pts) {
      if (prev) {
        const d = haversineKm(prev.lon, prev.lat, p.lon, p.lat);
        const days = Math.max((p.t - prev.t) / DAY, 1 / 24);
        if (p.t === prev.t && d < 0.01) continue; // duplicate fix
        if (d / days > MAX_KM_PER_DAY) continue; // location error: skip this fix
        if (days > MAX_GAP_DAYS) { if (seg.length > 1) segments.push(seg); seg = []; }
        else km += d;
        let dl = p.lon - prev.lon; // unwrap so a path across 180° does not jump round the globe
        if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
        lonU += dl;
      } else lonU = p.lon;
      seg.push([+lonU.toFixed(4), +p.lat.toFixed(4), p.t]);
      prev = p;
    }
    if (seg.length > 1) segments.push(seg);
    if (!segments.length) continue;
    const [dataset, animal] = key.split('|');
    out.push({ key, dataset, animal, start: segments[0][0][2], end: segments.at(-1)!.at(-1)![2], km: Math.round(km), segments });
  }
  return out.sort((a, b) => b.km - a.km);
}

/** Position of a track at a fraction of its own duration (0 = tagging, 1 = last fix), for the "play" animation. */
export function trackAt(tr: Track, frac: number): { upto: [number, number][][]; head: [number, number] | null } {
  const tNow = tr.start + Math.max(0, Math.min(1, frac)) * (tr.end - tr.start);
  const upto: [number, number][][] = [];
  let head: [number, number] | null = null;
  for (const seg of tr.segments) {
    if (seg[0][2] > tNow) break;
    const part: [number, number][] = [];
    for (let i = 0; i < seg.length; i++) {
      const [x, y, t] = seg[i];
      if (t <= tNow) { part.push([x, y]); head = [x, y]; continue; }
      const [px, py, pt] = seg[i - 1];
      const f = (tNow - pt) / (t - pt);
      head = [px + (x - px) * f, py + (y - py) * f];
      part.push(head);
      break;
    }
    if (part.length > 1) upto.push(part);
  }
  return { upto, head };
}

/** Records per calendar month (index 0 = January) from rows with a month or a parseable date. */
export function monthCounts(rows: OccRow[]): number[] {
  const m = new Array(12).fill(0);
  for (const r of rows) {
    let k = Number(r.month);
    if (!(k >= 1 && k <= 12)) {
      const t = parseDate(r.eventDate);
      k = t == null ? NaN : new Date(t).getUTCMonth() + 1;
    }
    if (k >= 1 && k <= 12) m[k - 1]++;
  }
  return m;
}

/** Records per decade from OBIS statistics/years, starting at the first decade with data (or 1900 at the latest). */
export function decadeCounts(years: { year: number; records: number }[]): { decade: number; records: number }[] {
  const by = new Map<number, number>();
  for (const y of years) if (y.year >= 1800 && y.year <= 2100) by.set(Math.floor(y.year / 10) * 10, (by.get(Math.floor(y.year / 10) * 10) ?? 0) + y.records);
  if (!by.size) return [];
  const from = Math.min(Math.min(...by.keys()), 1900), to = Math.max(...by.keys());
  const out: { decade: number; records: number }[] = [];
  for (let d = from; d <= to; d += 10) out.push({ decade: d, records: by.get(d) ?? 0 });
  return out;
}
