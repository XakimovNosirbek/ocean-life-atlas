// Turning OBIS taxonomy into groups a non-specialist recognises, plus small summaries. Pure (test/taxa.test.ts).

export interface Taxon {
  taxonID: number;
  scientificName: string;
  taxonRank?: string;
  kingdom?: string;
  phylum?: string;
  subphylum?: string;
  superclass?: string;
  class?: string;
  order?: string;
  family?: string;
  category?: string; // IUCN Red List category when OBIS knows it
  records?: number;
}

export type GroupId =
  | 'fish' | 'sharks' | 'mammals' | 'turtles' | 'birds' | 'corals' | 'molluscs' | 'crustaceans' | 'echinoderms'
  | 'algae' | 'other';

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'fish', label: 'Fish' },
  { id: 'sharks', label: 'Sharks and rays' },
  { id: 'mammals', label: 'Whales, dolphins and seals' },
  { id: 'turtles', label: 'Sea reptiles' },
  { id: 'birds', label: 'Seabirds' },
  { id: 'corals', label: 'Corals and jellyfish' },
  { id: 'molluscs', label: 'Shells, squid and octopus' },
  { id: 'crustaceans', label: 'Crabs, shrimp and krill' },
  { id: 'echinoderms', label: 'Starfish and urchins' },
  { id: 'algae', label: 'Seaweed and plankton' },
  { id: 'other', label: 'Everything else' },
];
export const GROUP_LABEL: Record<GroupId, string> = Object.fromEntries(GROUPS.map((g) => [g.id, g.label])) as Record<GroupId, string>;

const FISH_CLASSES = new Set(['Actinopteri', 'Actinopterygii', 'Teleostei', 'Myxini', 'Petromyzonti', 'Sarcopterygii', 'Coelacanthi']);

export function groupOf(t: Taxon): GroupId {
  if (t.class === 'Elasmobranchii' || t.class === 'Holocephali') return 'sharks';
  if (t.class && FISH_CLASSES.has(t.class)) return 'fish';
  if (t.class === 'Mammalia') return 'mammals';
  if (t.class === 'Aves') return 'birds';
  if (t.superclass === 'Reptilia' || t.class === 'Reptilia' || t.order === 'Testudines' || t.order === 'Squamata') return 'turtles';
  if (t.phylum === 'Cnidaria' || t.phylum === 'Ctenophora') return 'corals';
  if (t.phylum === 'Mollusca') return 'molluscs';
  if (t.phylum === 'Arthropoda') return 'crustaceans';
  if (t.phylum === 'Echinodermata') return 'echinoderms';
  if (t.kingdom === 'Plantae' || t.kingdom === 'Chromista') return 'algae';
  return 'other';
}

/** Species-level animals, plants and algae only: bacteria, archaea, fungi and higher ranks are not what people look for. */
export function isShowable(t: Taxon): boolean {
  if (t.taxonRank !== 'Species') return false;
  return t.kingdom === 'Animalia' || t.kingdom === 'Plantae' || t.kingdom === 'Chromista';
}

export const IUCN_LABEL: Record<string, string> = {
  EX: 'Extinct', EW: 'Extinct in the wild', CR: 'Critically endangered', EN: 'Endangered', VU: 'Vulnerable',
  NT: 'Near threatened', LC: 'Least concern', DD: 'Data deficient',
};
export const THREATENED = new Set(['CR', 'EN', 'VU']);

/** Keep showable species, most-recorded first, ties by name (stable output for the same input). */
export function rankSpecies<T extends Taxon>(list: T[]): T[] {
  return list.filter(isShowable).sort((a, b) => (b.records ?? 0) - (a.records ?? 0) || a.scientificName.localeCompare(b.scientificName));
}

export function countByGroup(list: Taxon[]): Map<GroupId, number> {
  const m = new Map<GroupId, number>();
  for (const t of list) m.set(groupOf(t), (m.get(groupOf(t)) ?? 0) + 1);
  return m;
}

export interface Bin { from: number; records: number }

/** Record-weighted quantile of binned values (bin = [from, next from)), interpolated inside the bin. */
export function binnedQuantile(bins: Bin[], q: number, lastWidth: number): number | null {
  const s = bins.filter((b) => Number.isFinite(b.from)).sort((a, b) => a.from - b.from);
  const total = s.reduce((t, b) => t + b.records, 0);
  if (total === 0) return null;
  const target = q * total;
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    const b = s[i], width = i + 1 < s.length ? s[i + 1].from - b.from : lastWidth;
    if (b.records > 0 && acc + b.records >= target) return b.from + ((target - acc) / b.records) * width;
    acc += b.records;
  }
  return s[s.length - 1].from + lastWidth;
}

/** "Usually 0–80 m deep": the middle 80 % of depth records, rounded to a readable step. */
export function depthRange(bins: Bin[]): { from: number; to: number; records: number } | null {
  const records = bins.reduce((t, b) => t + b.records, 0);
  const lo = binnedQuantile(bins, 0.1, 10), hi = binnedQuantile(bins, 0.9, 10);
  if (lo == null || hi == null) return null;
  const step = (v: number) => (v < 100 ? 5 : v < 1000 ? 10 : 100);
  return { from: Math.floor(lo / step(lo)) * step(lo), to: Math.max(Math.ceil(hi / step(hi)) * step(hi), 5), records };
}

/** Merge OBIS env depth bins into display bands (0-10, 10-50, 50-200, 200-1000, 1000-4000, 4000+ m). */
export const DEPTH_BANDS: { from: number; to: number; label: string }[] = [
  { from: 0, to: 10, label: 'Surface, 0–10 m' },
  { from: 10, to: 50, label: '10–50 m' },
  { from: 50, to: 200, label: '50–200 m, sunlit sea' },
  { from: 200, to: 1000, label: '200–1,000 m, twilight zone' },
  { from: 1000, to: 4000, label: '1–4 km, midnight zone' },
  { from: 4000, to: Infinity, label: 'Below 4 km, abyss' },
];
export function depthBands(bins: Bin[]): number[] {
  const out = DEPTH_BANDS.map(() => 0);
  for (const b of bins) {
    const i = DEPTH_BANDS.findIndex((d) => b.from >= d.from && b.from < d.to);
    if (i >= 0) out[i] += b.records;
  }
  return out;
}

/** Round-robin across groups (groups ordered by their best-recorded species), each group most-recorded first. */
export function interleaveGroups<T extends Taxon>(ranked: T[]): T[] {
  const by = new Map<GroupId, T[]>();
  for (const t of ranked) { const g = groupOf(t); if (!by.has(g)) by.set(g, []); by.get(g)!.push(t); }
  const queues = [...by.values()];
  const out: T[] = [];
  for (let i = 0; out.length < ranked.length; i++) for (const q of queues) if (i < q.length) out.push(q[i]);
  return out;
}
