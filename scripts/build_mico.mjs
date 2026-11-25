// Build public/data/mico/: the MiCO migration network (sites where animals gather and the routes between them) per
// species, keyed by WoRMS AphiaID so the species page can find it.
//
// Source: Bentley, L.K. et al. (2025) Marine megavertebrate migrations connect the global ocean. Nature Communications.
// Data: Zenodo 10.5281/zenodo.14873514 (lkbentley/mico v1.0.0), CC0 1.0.
//
// usage: node scripts/build_mico.mjs        (downloads ~1 MB, checks the MD5, needs `unzip`)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ZIP = 'https://zenodo.org/api/records/14873514/files/lkbentley/mico-v1.0.0.zip/content';
const MD5 = '7915041ae8f0147b2c705bbf409aeb59';
const OUT = 'public/data/mico';
const UA = { 'User-Agent': 'ocean-life-atlas data build' };

/** RFC 4180 CSV (quoted fields, doubled quotes, commas and newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0]);
}

// MiCO species whose common name WoRMS does not know verbatim (codes are MiCO's own)
const KNOWN = {
  ALVU: 'Alopias vulpinus', HYAM: 'Hyperoodon ampullatus', MOBI: 'Mobula birostris', THAL: 'Thunnus alalunga',
  TRIN: 'Trichechus inunguis',
};

const round = (v, d = 3) => Math.round(Number(v) * 10 ** d) / 10 ** d;

async function aphiaFor(scientific, common) {
  const get = async (url) => {
    const r = await fetch(url, { headers: UA });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  };
  if (scientific) {
    let id = await get(`https://www.marinespecies.org/rest/AphiaIDByName/${encodeURIComponent(scientific)}?marine_only=true`);
    if (id === -999) { // several records share the name: take the accepted one
      const recs = (await get(`https://www.marinespecies.org/rest/AphiaRecordsByName/${encodeURIComponent(scientific)}?like=false&marine_only=true`)) ?? [];
      id = (recs.find((x) => x.status === 'accepted') ?? recs[0])?.valid_AphiaID ?? null;
    }
    if (Number.isInteger(id) && id > 0) {
      const rec = await get(`https://www.marinespecies.org/rest/AphiaRecordByAphiaID/${id}`);
      return { id: rec?.valid_AphiaID ?? id, scientific: rec?.valid_name ?? scientific };
    }
  }
  const hits = (await get(`https://www.marinespecies.org/rest/AphiaRecordsByVernacular/${encodeURIComponent(common)}?like=false`)) ?? [];
  const sp = hits.find((h) => h.rank === 'Species' && h.status === 'accepted') ?? hits.find((h) => h.rank === 'Species');
  return sp ? { id: sp.valid_AphiaID ?? sp.AphiaID, scientific: sp.valid_name ?? sp.scientificname } : null;
}

async function main() {
  const res = await fetch(ZIP, { headers: UA });
  if (!res.ok) throw new Error(`Zenodo: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const md5 = createHash('md5').update(buf).digest('hex');
  if (md5 !== MD5) throw new Error(`MD5 ${md5}, expected ${MD5}: the archive changed, check the record before using it`);
  const dir = mkdtempSync(join(tmpdir(), 'mico-'));
  writeFileSync(join(dir, 'mico.zip'), buf);
  execFileSync('unzip', ['-q', '-o', join(dir, 'mico.zip'), '-d', dir]);
  const root = execFileSync('find', [dir, '-type', 'd', '-name', 'Data']).toString().trim().split('\n')[0];
  const read = (f) => parseCsv(readFileSync(join(root, f), 'utf8'));

  const [sh, ...sites] = read('mico_metasites.csv');
  const S = Object.fromEntries(sh.map((k, i) => [k, i]));
  const [rh, ...routes] = read('mico_metasites_crossing_oceans_all.csv');
  // the header repeats eez_id/eez_name, so index by position
  const R = { code: 0, common: 1, sci: 2, type: 3, sx: 7, sy: 8, src: 10, tgt: 11, ex: 14, ey: 15 };
  if (rh[R.sx] !== 'start_x' || rh[R.ex] !== 'end_x' || rh[R.src] !== 'metasite_source') throw new Error('route columns moved');

  const species = new Map(); // code -> { common, sci }
  for (const s of sites) species.set(s[S.species_code], { common: s[S.common_name], sci: '' });
  for (const r of routes) species.set(r[R.code], { common: r[R.common], sci: r[R.sci] });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const index = {}, unmatched = [];
  for (const [code, sp] of species) {
    const a = await aphiaFor(sp.sci || KNOWN[code], sp.common);
    if (!a) { unmatched.push(`${code} ${sp.common}`); continue; }
    const mySites = sites.filter((s) => s[S.species_code] === code).map((s) => ({
      id: s[S.metasite_id], lon: round(s[S.longitude]), lat: round(s[S.latitude]), n: Math.round(Number(s[S.n_ndvdl]) || 0),
      act: s[S.activity],
    }));
    const pairs = new Map();
    for (const r of routes) {
      if (r[R.code] !== code) continue;
      const key = `${r[R.src]}>${r[R.tgt]}`;
      const p = pairs.get(key) ?? { s: [round(r[R.sx]), round(r[R.sy])], e: [round(r[R.ex]), round(r[R.ey])], n: 0, tracked: 0 };
      p.n++;
      if (r[R.type] === 'METAROUTE') p.tracked++;
      pairs.set(key, p);
    }
    const out = {
      common: sp.common, scientific: a.scientific,
      sites: mySites.map((s) => [s.lon, s.lat, s.n, s.act]),
      routes: [...pairs.values()].map((p) => [...p.s, ...p.e, p.n, p.tracked]),
    };
    writeFileSync(join(OUT, `${a.id}.json`), JSON.stringify(out));
    index[a.id] = { common: sp.common, scientific: a.scientific, sites: out.sites.length, routes: out.routes.length };
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({
    source: 'Bentley et al. (2025) Marine megavertebrate migrations connect the global ocean, Nature Communications; data Zenodo 10.5281/zenodo.14873514 (CC0 1.0)',
    species: index,
  }));
  rmSync(dir, { recursive: true, force: true });
  const n = Object.keys(index).length;
  console.log(`${n} species written to ${OUT}; ${unmatched.length} without a WoRMS match: ${unmatched.join('; ') || 'none'}`);
  if (n < 90) throw new Error(`only ${n} species matched, expected about 109`);
}

if (process.argv[1]?.endsWith('build_mico.mjs')) await main();
