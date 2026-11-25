import { describe, expect, it } from 'vitest';
import { binnedQuantile, countByGroup, interleaveGroups, depthBands, depthRange, groupOf, isShowable, rankSpecies, type Taxon } from '../src/taxa';

// Shapes copied from real OBIS checklist answers (2026-11-25).
const turtle: Taxon = { taxonID: 137206, scientificName: 'Chelonia mydas', taxonRank: 'Species', kingdom: 'Animalia', phylum: 'Chordata', superclass: 'Reptilia', order: 'Testudines', category: 'EN', records: 199 };
const egret: Taxon = { taxonID: 212665, scientificName: 'Egretta gularis', taxonRank: 'Species', kingdom: 'Animalia', phylum: 'Chordata', superclass: 'Reptilia', class: 'Aves', records: 40 };
const bacteria: Taxon = { taxonID: 393070, scientificName: 'Clostridiales', taxonRank: 'Order', kingdom: 'Bacteria', records: 25 };
const shark: Taxon = { taxonID: 105847, scientificName: 'Rhincodon typus', taxonRank: 'Species', kingdom: 'Animalia', phylum: 'Chordata', class: 'Elasmobranchii', records: 40 };
const tuna: Taxon = { taxonID: 127029, scientificName: 'Thunnus albacares', taxonRank: 'Species', kingdom: 'Animalia', phylum: 'Chordata', class: 'Teleostei', records: 5 };

describe('groups', () => {
  it('puts each kind of animal where a reader expects it', () => {
    expect(groupOf(turtle)).toBe('turtles');
    expect(groupOf(egret)).toBe('birds'); // OBIS gives birds superclass Reptilia: class must win
    expect(groupOf(shark)).toBe('sharks');
    expect(groupOf(tuna)).toBe('fish');
    expect(groupOf({ taxonID: 1, scientificName: 'x', kingdom: 'Animalia', phylum: 'Cnidaria' })).toBe('corals');
    expect(groupOf({ taxonID: 1, scientificName: 'x', kingdom: 'Chromista' })).toBe('algae');
  });
  it('hides bacteria and anything above species rank', () => {
    expect(isShowable(bacteria)).toBe(false);
    expect(isShowable(turtle)).toBe(true);
  });
  it('ranks by records, ties by name', () => {
    expect(rankSpecies([tuna, egret, bacteria, turtle, shark]).map((t) => t.scientificName))
      .toEqual(['Chelonia mydas', 'Egretta gularis', 'Rhincodon typus', 'Thunnus albacares']);
    expect(countByGroup([turtle, shark, tuna]).get('fish')).toBe(1);
  });
  it('interleaves kinds so one well-surveyed group does not fill the first screen', () => {
    const birds = [1, 2, 3].map((i) => ({ ...egret, taxonID: i, scientificName: `Bird ${i}`, records: 1000 - i }));
    const out = interleaveGroups([...birds, tuna, shark]);
    expect(out.map((t) => t.scientificName)).toEqual(['Bird 1', 'Thunnus albacares', 'Rhincodon typus', 'Bird 2', 'Bird 3']);
  });
});

describe('depth', () => {
  // Real whale shark depth bins start like this (records per 10 m bin from 0 m).
  const bins = [{ from: 0, records: 2596 }, { from: 10, records: 126 }, { from: 20, records: 184 }, { from: 30, records: 119 }, { from: 50, records: 62 }, { from: 80, records: 78 }, { from: 1000, records: 3 }];
  it('interpolates a record-weighted quantile inside the bin', () => {
    expect(binnedQuantile([{ from: 0, records: 10 }, { from: 10, records: 10 }], 0.5, 10)).toBeCloseTo(10);
    expect(binnedQuantile([], 0.5, 10)).toBeNull();
  });
  it('reports the middle 80 % in readable steps', () => {
    const r = depthRange(bins)!;
    expect(r.from).toBe(0);
    expect(r.to).toBeGreaterThan(0);
    expect(r.to).toBeLessThanOrEqual(50);
    expect(r.records).toBe(3168);
  });
  it('sums bins into ocean zones', () => {
    const z = depthBands(bins);
    expect(z[0]).toBe(2596); expect(z[1]).toBe(126 + 184 + 119); expect(z[2]).toBe(62 + 78); expect(z[4]).toBe(3);
  });
});
