import { describe, expect, it } from 'vitest';
import { bboxToWkt, formatLatLon, geohash, geohashBounds, weightedCentre } from '../src/geo';

describe('geohash', () => {
  it('matches known reference hashes', () => {
    expect(geohash(-5.6, 42.6, 5)).toBe('ezs42'); // the Wikipedia example
    expect(geohash(0, 0, 3)).toBe('s00');
  });
  it('round-trips: a point lies inside its own cell, and a level-3 cell is 1.40625° square', () => {
    for (const [lon, lat] of [[69.6, 22.5], [-150.2, -60.1], [179.99, 89.9], [-180, -90]]) {
      const b = geohashBounds(geohash(lon, lat, 3));
      expect(lon).toBeGreaterThanOrEqual(b.west); expect(lon).toBeLessThanOrEqual(b.east);
      expect(lat).toBeGreaterThanOrEqual(b.south); expect(lat).toBeLessThanOrEqual(b.north);
      expect(b.east - b.west).toBeCloseTo(1.40625); expect(b.north - b.south).toBeCloseTo(1.40625);
    }
  });
  it('wraps longitude past the antimeridian', () => {
    expect(geohash(181, 10, 3)).toBe(geohash(-179, 10, 3));
  });
  it('rejects characters outside the alphabet', () => {
    expect(() => geohashBounds('a1')).toThrow();
  });
});

describe('helpers', () => {
  it('writes a closed WKT ring', () => {
    expect(bboxToWkt({ west: 1, south: 2, east: 3, north: 4 })).toBe('POLYGON((1 2,3 2,3 4,1 4,1 2))');
  });
  it('formats hemispheres', () => {
    expect(formatLatLon(-12.34, -45.67)).toBe('12.3° S, 45.7° W');
  });
  it('averages longitudes on the circle, so a range across 180° is centred near 180°, not 0°', () => {
    const c = weightedCentre([
      { bbox: { west: 178, east: 179, south: 0, north: 1 }, n: 10 },
      { bbox: { west: -179, east: -178, south: 0, north: 1 }, n: 10 },
    ])!;
    expect(Math.abs(Math.abs(c.lon) - 180)).toBeLessThan(1);
    expect(c.lat).toBeCloseTo(0.5);
  });
});
