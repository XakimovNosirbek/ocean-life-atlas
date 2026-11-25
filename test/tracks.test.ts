import { describe, expect, it } from 'vitest';
import { buildTracks, decadeCounts, haversineKm, monthCounts, parseDate, trackAt, type OccRow } from '../src/tracks';

const fix = (animal: string, date: string, lon: number, lat: number, basis = 'MachineObservation'): OccRow =>
  ({ organismID: animal, dataset_id: 'ds1', eventDate: date, decimalLongitude: lon, decimalLatitude: lat, basisOfRecord: basis });

describe('dates and distance', () => {
  it('reads the OBIS date shapes seen in real rows', () => {
    expect(parseDate('2005-05-24T12:00:00Z')).toBe(Date.UTC(2005, 4, 24, 12));
    expect(parseDate('2022-04-22 22:21:59')).toBe(Date.UTC(2022, 3, 22, 22, 21, 59));
    expect(parseDate('2011-12-25')).toBe(Date.UTC(2011, 11, 25));
    expect(parseDate('2011-12-25/2011-12-26')).toBe(Date.UTC(2011, 11, 25));
    expect(parseDate('sometime')).toBeNull();
  });
  it('measures a degree of latitude as ~111 km', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.2, 0);
  });
});

describe('tracks', () => {
  const days = (n: number) => `2020-01-${String(n).padStart(2, '0')}T00:00:00Z`;
  it('groups fixes per animal, orders them in time and keeps only telemetry', () => {
    const rows = [fix('A', days(3), 2, 0), fix('A', days(1), 0, 0), fix('A', days(2), 1, 0), fix('A', days(4), 3, 0), fix('A', days(5), 4, 0),
      fix('A', days(6), 5, 0, 'HumanObservation'), fix('B', days(1), 9, 9)];
    const t = buildTracks(rows);
    expect(t).toHaveLength(1); // B has too few fixes, the human sighting is not part of A's track
    expect(t[0].segments[0].map((p) => p[0])).toEqual([0, 1, 2, 3, 4]);
    expect(t[0].km).toBeGreaterThan(440); expect(t[0].km).toBeLessThan(450);
  });
  it('starts a new piece after a long silence and drops impossible jumps', () => {
    const rows = [fix('A', days(1), 0, 0), fix('A', days(2), 1, 0), fix('A', days(3), 2, 0),
      fix('A', days(4), 80, 0), // 8,700 km in a day: a location error
      fix('A', days(28), 3, 0), fix('A', days(29), 4, 0)];
    const t = buildTracks(rows)[0];
    expect(t.segments).toHaveLength(2);
    expect(t.segments.flat().some((p) => p[0] === 80)).toBe(false);
  });
  it('unwraps longitude across the antimeridian', () => {
    const rows = [179, -179.5, -178, -177, -176].map((lon, i) => fix('A', days(i + 1), lon, 10));
    expect(buildTracks(rows)[0].segments[0].map((p) => p[0])).toEqual([179, 180.5, 182, 183, 184]);
  });
  it('interpolates the head of the track for the animation', () => {
    const tr = buildTracks([0, 1, 2, 3, 4].map((x, i) => fix('A', days(i + 1), x, 0)))[0];
    expect(trackAt(tr, 0.5).head).toEqual([2, 0]);
    expect(trackAt(tr, 0.625).head![0]).toBeCloseTo(2.5);
    expect(trackAt(tr, 1).upto[0]).toHaveLength(5);
  });
});

describe('seasonality', () => {
  it('counts months from the month field, else from the date', () => {
    const m = monthCounts([{ month: 3 }, { month: '3' }, { eventDate: '2020-12-01' }, { month: 13 }]);
    expect(m[2]).toBe(2); expect(m[11]).toBe(1); expect(m.reduce((a, b) => a + b)).toBe(3);
  });
  it('fills empty decades from 1900', () => {
    const d = decadeCounts([{ year: 1928, records: 7 }, { year: 1951, records: 1 }, { year: 1958, records: 1 }]);
    expect(d.map((x) => x.decade)).toEqual([1900, 1910, 1920, 1930, 1940, 1950]);
    expect(d.find((x) => x.decade === 1950)!.records).toBe(2);
  });
});

describe('journey labels', () => {
  it('classifies MiCO activities and finds a clear season only when there is one', async () => {
    const { activityKind, peakSeason } = await import('../src/journeys');
    expect(activityKind('Breeding;Feeding')).toBe('breeding');
    expect(activityKind('Nesting')).toBe('breeding');
    expect(activityKind('Feeding;Observation')).toBe('feeding');
    expect(activityKind('Migrating')).toBe('migrating');
    expect(activityKind('Observation')).toBe('observed');
    expect(peakSeason(new Array(12).fill(10))).toBeNull(); // flat year
    const winter = [30, 25, 5, 2, 1, 1, 1, 1, 1, 2, 5, 28]; // Dec-Feb peak wraps the year end
    expect(peakSeason(winter)).toMatchObject({ from: 11, to: 1 });
    expect(peakSeason([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBeNull(); // too few records
  });
});
