// The globe: NASA Blue Marble imagery, plus overlays: records density, the clicked square, a species range, its MiCO
// migration network and satellite-tag tracks.
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { bboxRing, geohashBounds, type BBox } from './geo';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export const COLORS = { abyss: '#0b2233', plankton: '#f2c94c', foam: '#f4f8f7', looked: ['#2a1d5c', '#2f6f99', '#5fc0b0', '#c8ef9c', '#fff7c2'] };
/** One colour per tagged animal, cycled; all readable on dark water. The range squares are dimmed while tracks show. */
export const TRACK_COLORS = ['#7fe3c8', '#ff9e7a', '#8ecbff', '#ffd166', '#c39bff', '#ff7aa2', '#b8f27c', '#ffffff'];
/** MiCO site colours by what the animals do there. */
export const ACTIVITY_COLORS = { breeding: '#ff7aa2', feeding: '#7fe3c8', migrating: '#8ecbff', observed: '#f4f8f7' };

const style: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sky: {
    'sky-color': COLORS.abyss,
    'horizon-color': '#2b6274',
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 5, 0.6, 7, 0],
  },
  sources: {
    earth: {
      type: 'raster', tiles: [GIBS], tileSize: 256, maxzoom: 8,
      attribution: 'Imagery: NASA Blue Marble via <a href="https://earthdata.nasa.gov/gibs">GIBS</a>',
    },
    looked: { type: 'geojson', data: EMPTY },
    range: { type: 'geojson', data: EMPTY },
    square: { type: 'geojson', data: EMPTY },
    micoRoutes: { type: 'geojson', data: EMPTY },
    micoSites: { type: 'geojson', data: EMPTY },
    tracks: { type: 'geojson', data: EMPTY },
    heads: { type: 'geojson', data: EMPTY },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': COLORS.abyss } },
    { id: 'earth', type: 'raster', source: 'earth', paint: { 'raster-saturation': -0.15, 'raster-contrast': 0.05 } },
    {
      id: 'looked', type: 'fill', source: 'looked', layout: { visibility: 'none' },
      paint: {
        'fill-color': ['interpolate', ['linear'], ['log10', ['max', 1, ['get', 'n']]],
          0, COLORS.looked[0], 1.5, COLORS.looked[1], 3, COLORS.looked[2], 4.5, COLORS.looked[3], 6, COLORS.looked[4]],
        'fill-opacity': 0.82,
        'fill-antialias': false,
      },
    },
    {
      id: 'range', type: 'fill', source: 'range',
      paint: { 'fill-color': COLORS.plankton, 'fill-opacity': ['interpolate', ['linear'], ['log10', ['max', 1, ['get', 'n']]], 0, 0.45, 3, 0.85] },
    },
    { id: 'range-edge', type: 'line', source: 'range', paint: { 'line-color': '#7a5d00', 'line-width': 0.4, 'line-opacity': 0.6 } },
    {
      id: 'mico-routes', type: 'line', source: 'micoRoutes', layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#ffb3c7',
        'line-width': ['interpolate', ['linear'], ['log10', ['max', 1, ['get', 'n']]], 0, 0.8, 2, 3.2],
        'line-opacity': 0.6,
      },
    },
    {
      id: 'mico-sites', type: 'circle', source: 'micoSites',
      paint: {
        'circle-color': ['match', ['get', 'kind'], 'breeding', ACTIVITY_COLORS.breeding, 'feeding', ACTIVITY_COLORS.feeding,
          'migrating', ACTIVITY_COLORS.migrating, ACTIVITY_COLORS.observed],
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['max', 1, ['get', 'n']]], 1, 3.5, 30, 10],
        'circle-stroke-color': COLORS.abyss, 'circle-stroke-width': 1.2, 'circle-opacity': 0.92,
      },
    },
    {
      id: 'tracks', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['to-color', ['at', ['%', ['get', 'c'], TRACK_COLORS.length], ['literal', TRACK_COLORS]]], 'line-width': 1.8, 'line-opacity': 0.9 },
    },
    {
      id: 'heads', type: 'circle', source: 'heads',
      paint: {
        'circle-color': ['to-color', ['at', ['%', ['get', 'c'], TRACK_COLORS.length], ['literal', TRACK_COLORS]]],
        'circle-radius': 4.5, 'circle-stroke-color': COLORS.abyss, 'circle-stroke-width': 1.5,
      },
    },
    { id: 'square', type: 'line', source: 'square', paint: { 'line-color': COLORS.foam, 'line-width': 2.5 } },
  ],
};

maplibregl.setWorkerUrl(workerUrl);

export class Globe {
  map: maplibregl.Map;
  private ready: Promise<void>;
  private lookedLoaded = false;

  constructor(container: HTMLElement, private dataBase: string) {
    this.map = new maplibregl.Map({
      container, style, center: [60, 8], zoom: 2.1, minZoom: 0.8, maxZoom: 9,
      attributionControl: { compact: true }, renderWorldCopies: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.ready = new Promise((res) => this.map.once('load', () => res()));
  }

  onClick(fn: (lon: number, lat: number) => void) {
    this.map.on('click', (e: MapMouseEvent) => fn(e.lngLat.lng, e.lngLat.lat));
  }

  async showSquare(b: BBox | null) {
    await this.ready;
    const data: GeoJSON.FeatureCollection = b
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: bboxRing(b) } }] }
      : EMPTY;
    (this.map.getSource('square') as GeoJSONSource).setData(data);
  }

  async showRange(fc: GeoJSON.FeatureCollection | null) {
    await this.ready;
    (this.map.getSource('range') as GeoJSONSource).setData(fc ?? EMPTY);
  }

  /** Set one of the journey overlays (micoRoutes, micoSites, tracks, heads); null clears it. */
  async setOverlay(source: 'micoRoutes' | 'micoSites' | 'tracks' | 'heads', fc: GeoJSON.FeatureCollection | null) {
    await this.ready;
    (this.map.getSource(source) as GeoJSONSource).setData(fc ?? EMPTY);
  }

  /** Fade the yellow range squares so journeys drawn on top stay readable. */
  async dimRange(dim: boolean) {
    await this.ready;
    this.map.setPaintProperty('range', 'fill-opacity', dim ? 0.22
      : ['interpolate', ['linear'], ['log10', ['max', 1, ['get', 'n']]], 0, 0.45, 3, 0.85]);
  }

  /** Frame a set of points. Wide sets (an ocean basin or more) get a centred globe view: fitBounds on a globe would
   *  zoom into the middle of the box instead. */
  async fitTo(points: [number, number][]) {
    await this.ready;
    if (!points.length) return;
    let sx = 0, sy = 0;
    for (const [x] of points) { sx += Math.cos((x * Math.PI) / 180); sy += Math.sin((x * Math.PI) / 180); }
    const cLon = (Math.atan2(sy, sx) * 180) / Math.PI;
    const rel = points.map(([x, y]) => [((x - cLon + 540) % 360) - 180, y] as [number, number]);
    const xs = rel.map((p) => p[0]), ys = points.map((p) => p[1]);
    const w = Math.min(...xs), e = Math.max(...xs), s = Math.max(-80, Math.min(...ys)), n = Math.min(80, Math.max(...ys));
    if (e - w > 100 || n - s > 70) { this.flyTo(cLon + (w + e) / 2, (s + n) / 2, 1.7); return; }
    this.map.fitBounds([[cLon + w, s], [cLon + e, n]], { padding: 60, maxZoom: 5, duration: 1400 });
  }

  /** Records per 1.4° square, loaded the first time the layer is switched on. */
  async setLooked(on: boolean): Promise<{ total: number; fetched: string } | null> {
    await this.ready;
    let meta: { total: number; fetched: string } | null = null;
    if (on && !this.lookedLoaded) {
      const r = await fetch(`${this.dataBase}data/records-gh3.json`);
      if (!r.ok) throw new Error(`records layer: HTTP ${r.status}`);
      const d = (await r.json()) as { gh: string; n: number[]; total: number; fetched: string };
      const features: GeoJSON.Feature[] = [];
      for (let i = 0; i < d.n.length; i++) {
        const b = geohashBounds(d.gh.slice(i * 3, i * 3 + 3));
        features.push({ type: 'Feature', properties: { n: d.n[i] }, geometry: { type: 'Polygon', coordinates: [bboxRing(b)] } });
      }
      (this.map.getSource('looked') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
      this.lookedLoaded = true;
      meta = { total: d.total, fetched: d.fetched };
    }
    this.map.setLayoutProperty('looked', 'visibility', on ? 'visible' : 'none');
    return meta;
  }

  async flyTo(lon: number, lat: number, zoom?: number) {
    await this.ready;
    this.map.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 3), duration: 1400, essential: false });
  }

  /** Keep the clicked square visible beside the panel (panel on the right on wide screens, at the bottom on phones). */
  setPadding(p: { right?: number; bottom?: number }) {
    this.map.setPadding({ top: 0, left: 0, right: p.right ?? 0, bottom: p.bottom ?? 0 });
  }
}
