import { describe, expect, it } from 'vitest';
import { pickSeaName, speciesQuery } from '../src/api';
import { mergeHits, rankHits } from '../src/search-merge';
import { formatHash, parseHash } from '../src/state';
import { articleTitle, commonsFile, commonsThumb, parseWikidata, pickName } from '../src/wiki';

describe('url state', () => {
  it('round-trips place, species and layer', () => {
    const s = { at: { lat: 22.52, lon: 69.61 }, sp: 105847, looked: true };
    expect(parseHash(formatHash(s))).toEqual(s);
  });
  it('ignores junk', () => {
    expect(parseHash('#at=999,1&sp=-3&layer=x')).toEqual({});
    expect(formatHash({})).toBe('');
  });
});

describe('wikidata', () => {
  it('reads file names and article titles', () => {
    expect(commonsFile('http://commons.wikimedia.org/wiki/Special:FilePath/Whale%20shark%20Georgia%20aquarium.jpg')).toBe('Whale shark Georgia aquarium.jpg');
    expect(commonsThumb('A b.jpg', 360)).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/A_b.jpg?width=360');
    expect(articleTitle('https://en.wikipedia.org/wiki/Whale_shark')).toBe('Whale_shark');
  });
  it('never shows the scientific name as the common name', () => {
    expect(pickName({ label: { value: 'Rhincodon typus' }, commonEn: { value: 'whale shark' } }, 'Rhincodon typus')).toBe('Whale shark');
    expect(pickName({ common: { value: 'kit akula' } }, 'Rhincodon typus')).toBe('Kit akula');
    expect(pickName({ label: { value: 'Rhincodon typus' } }, 'Rhincodon typus')).toBeUndefined();
  });
  it('parses SPARQL bindings', () => {
    const m = parseWikidata([{ aphia: { value: '105847' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/X.jpg' }, labelEn: { value: 'whale shark' } }]);
    expect(m.get(105847)).toEqual({ name: 'Whale shark', image: 'X.jpg', article: undefined });
  });
});

describe('search merge', () => {
  it('dedupes synonyms to the accepted id and puts common-name hits first', () => {
    const worms = [
      { AphiaID: 1, scientificname: 'Rhiniodon typus', status: 'unaccepted', rank: 'Species', valid_AphiaID: 105847, valid_name: 'Rhincodon typus', kingdom: 'Animalia', phylum: 'Chordata', class: 'Elasmobranchii', order: null, family: null },
      { AphiaID: 105847, scientificname: 'Rhincodon typus', status: 'accepted', rank: 'Species', valid_AphiaID: 105847, valid_name: 'Rhincodon typus', kingdom: 'Animalia', phylum: 'Chordata', class: 'Elasmobranchii', order: null, family: null },
    ];
    const obis = [{ taxonID: 105706, id: 105706, acceptedNameUsageID: 105706, scientificName: 'Rhincodontidae', rank: 'Family', kingdom: 'Animalia' }];
    const hits = mergeHits(worms, obis as never, 'whale shark');
    expect(hits.map((x) => x.id)).toEqual([105847, 105706]);
    expect(hits[0].group).toBe('sharks');
  });
});

describe('sea names', () => {
  it('prefers the most specific water body and adds the ocean', () => {
    const r = [
      { preferredGazetteerName: 'Gujarat', placeType: 'State' },
      { preferredGazetteerName: 'Indian Ocean', placeType: 'IHO Sea Area' },
      { preferredGazetteerName: 'Gulf of Kutch', placeType: 'Gulf' },
      { preferredGazetteerName: 'Northern Arabian Sea', placeType: 'General Sea Area' },
    ];
    expect(pickSeaName(r)).toEqual({ name: 'Gulf of Kutch, Indian Ocean', land: false });
    expect(pickSeaName([{ preferredGazetteerName: 'Indian Ocean', placeType: 'IHO Sea Area' }])).toEqual({ name: 'Indian Ocean', land: false });
    expect(pickSeaName([])).toBeNull();
  });
  it('prefers a named sea over the ocean (real Great Barrier Reef answer, trimmed)', () => {
    const r = ['Great Barrier Reef|Reef', 'Queensland|State', 'South Pacific Ocean|IHO Sea Area', 'Pacific Ocean|Ocean', 'Coral Sea|IHO Sea Area', 'Central Indo-Pacific|Realm']
      .map((s) => { const [preferredGazetteerName, placeType] = s.split('|'); return { preferredGazetteerName, placeType }; });
    expect(pickSeaName(r)).toEqual({ name: 'Great Barrier Reef, Coral Sea', land: false });
  });
  it('says land when only land places match (real inland Arabia answer, trimmed)', () => {
    const r = ['Saudi Arabia|Nation', 'Asia|Continent', 'Central Indo-Pacific|General Sea Area']
      .map((s) => { const [preferredGazetteerName, placeType] = s.split('|'); return { preferredGazetteerName, placeType }; });
    expect(pickSeaName(r)).toEqual({ name: 'Saudi Arabia', land: true });
  });
});

describe('search ranking', () => {
  const hit = (id: number, scientificName: string, rank = 'Species', exact = false) => ({ id, scientificName, rank, group: 'molluscs' as const, viaCommon: true, exact });
  it('puts the exact common name first, then the most recorded species', () => {
    const hits = [hit(1, 'Abdopus horridus'), hit(2, 'Octopus cyanea'), hit(3, 'Octopus', 'Genus'), hit(4, 'Octopus vulgaris', 'Species', true)];
    const counts = new Map([[1, 12], [2, 900], [4, 11102]]);
    expect(rankHits(hits, counts, 'octopus').map((h) => h.scientificName)).toEqual(['Octopus vulgaris', 'Octopus', 'Octopus cyanea', 'Abdopus horridus']);
  });
});

describe('species query', () => {
  it('declares its prefixes (QLever needs them) and refuses odd language codes', () => {
    const qy = speciesQuery([105847, 137206], 'uz');
    expect(qy).toContain('PREFIX wdt:');
    expect(qy).toContain('"105847" "137206"');
    expect(qy).toContain('LANG(?cn) = "uz"');
    expect(speciesQuery([1], 'x") } DROP')).toContain('LANG(?cn) = "en"');
  });
  it('prefers the English label over an English common name', () => {
    expect(pickName({ labelEn: { value: 'long-finned pilot whale' }, commonEn: { value: 'Atlantic Pilot Whale' } }, 'Globicephala melas')).toBe('Long-finned pilot whale');
  });
});
