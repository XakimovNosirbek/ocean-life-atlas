// Geohash cells and small geometry helpers. Pure, no DOM (test/geo.test.ts).
// A geohash-3 cell is 1.40625 deg on each side: the square the atlas uses for "life here".

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash (longitude bit first). Longitude is wrapped to [-180, 180), latitude clamped. */
export function geohash(lon: number, lat: number, precision: number): string {
  const wlon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const clat = Math.max(-90, Math.min(90, lat));
  const lo = [-180, 180], la = [-90, 90];
  let even = true, bit = 0, ch = 0, out = '';
  while (out.length < precision) {
    const r = even ? lo : la, v = even ? wlon : clat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

export interface BBox { west: number; south: number; east: number; north: number }

/** Bounds of a geohash cell. Throws on characters outside the geohash alphabet. */
export function geohashBounds(hash: string): BBox {
  const lo = [-180, 180], la = [-90, 90];
  let even = true;
  for (const c of hash) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error(`not a geohash: ${hash}`);
    for (let b = 4; b >= 0; b--) {
      const r = even ? lo : la, mid = (r[0] + r[1]) / 2;
      if ((v >> b) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { west: lo[0], south: la[0], east: lo[1], north: la[1] };
}

/** WKT polygon for the OBIS API geometry parameter (counter-clockwise ring, closed). */
export function bboxToWkt(b: BBox): string {
  const f = (n: number) => +n.toFixed(5);
  const ring = [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
  return `POLYGON((${ring.map(([x, y]) => `${f(x)} ${f(y)}`).join(',')}))`;
}

export function bboxRing(b: BBox): [number, number][] {
  return [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
}

/** "22.5° N, 69.6° E" */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}° ${ns}, ${Math.abs(lon).toFixed(1)}° ${ew}`;
}

/** Record-weighted centre of a set of cells, with longitudes averaged on the circle (ranges that cross 180°). */
export function weightedCentre(cells: { bbox: BBox; n: number }[]): { lon: number; lat: number } | null {
  let sx = 0, sy = 0, sl = 0, w = 0;
  for (const c of cells) {
    const lon = ((c.bbox.west + c.bbox.east) / 2) * (Math.PI / 180);
    const lat = (c.bbox.south + c.bbox.north) / 2;
    const k = Math.log10(1 + c.n);
    sx += Math.cos(lon) * k; sy += Math.sin(lon) * k; sl += lat * k; w += k;
  }
  if (w === 0) return null;
  return { lon: Math.atan2(sy, sx) * (180 / Math.PI), lat: sl / w };
}
