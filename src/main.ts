import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import './styles.css';
import * as api from './api';
import { fmt, h } from './dom';
import { Globe } from './map';
import { Panel } from './panel';
import { initSearch } from './search';
import { formatHash, parseHash, type ViewState } from './state';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const base = import.meta.env.BASE_URL;

const globe = new Globe($('#map'), base);
const hint = $('#hint');
const wide = () => window.matchMedia('(min-width: 760px)').matches;
let looked = false;
let writingHash = false;

const setHash = (s: ViewState) => {
  const next = formatHash({ ...s, looked });
  if (next === location.hash || (!next && !location.hash)) return;
  writingHash = true;
  history.replaceState(null, '', next || location.pathname + location.search);
  writingHash = false;
};

const panel = new Panel($('#panel'), $('#panel .panel-body'), {
  showSquare: (b) => globe.showSquare(b),
  showRange: (fc) => globe.showRange(fc),
  flyTo: (lon, lat) => globe.flyTo(lon, lat),
  setHash: (s) => setHash(s),
  journeys: {
    setOverlay: (src, fc) => globe.setOverlay(src, fc),
    dimRange: (d) => globe.dimRange(d),
    fitTo: (p) => globe.fitTo(p),
    base,
  },
  opened: (open) => {
    document.body.classList.toggle('panel-open', open);
    globe.setPadding(open ? (wide() ? { right: 460 } : { bottom: window.innerHeight * 0.55 }) : {});
  },
});

globe.onClick((lon, lat) => {
  hint.hidden = true;
  panel.showPlace(lat, lon);
});

initSearch($('#search'), $('#hits'), $('#search-status'), (id) => { hint.hidden = true; panel.showSpecies(id); });

// "Where scientists have looked"
const lookedBtn = $<HTMLButtonElement>('#looked');
const legend = $('#legend');
const setLooked = async (on: boolean) => {
  looked = on;
  lookedBtn.setAttribute('aria-pressed', String(on));
  legend.hidden = !on;
  try {
    const meta = await globe.setLooked(on);
    if (meta) $('#legend-note').textContent = `${fmt(meta.total)} OBIS records, counted ${meta.fetched}. Where you see the plain globe, nobody has recorded anything. Squares on land hold shore and river-mouth records.`;
  } catch (e) {
    $('#legend-note').textContent = 'This layer did not load. Reload the page to try again.';
    console.warn(e);
  }
  setHash(parseHash(location.hash));
};
lookedBtn.addEventListener('click', () => setLooked(!looked));

// Migrations: the species with a MiCO network, most connected first
const migrations = $<HTMLDialogElement>('#migrations');
$('#migrations-open').addEventListener('click', async () => {
  migrations.showModal();
  const list = migrations.querySelector('ul')!;
  if (list.childElementCount) return;
  try {
    const idx = await api.micoIndex(base);
    const items = Object.entries(idx.species).sort((a, b) => b[1].routes - a[1].routes || b[1].sites - a[1].sites);
    for (const [id, sp] of items) {
      const b = h('button', { class: 'mig' }, h('span', { class: 'mig-name', text: sp.common }), h('span', { class: 'latin', text: sp.scientific }),
        h('span', { class: 'mig-n', text: sp.routes ? `${fmt(sp.routes)} routes, ${fmt(sp.sites)} places` : `${fmt(sp.sites)} places` }));
      b.addEventListener('click', () => { migrations.close(); hint.hidden = true; panel.showSpecies(Number(id)); });
      list.append(h('li', {}, b));
    }
  } catch {
    list.append(h('li', { class: 'fine', text: 'The list did not load. Reload the page to try again.' }));
  }
});
migrations.querySelector('.about-close')?.addEventListener('click', () => migrations.close());
migrations.addEventListener('click', (e) => { if (e.target === migrations) migrations.close(); });

// About
const about = $<HTMLDialogElement>('#about');
$('#about-open').addEventListener('click', () => about.showModal());
about.querySelector('.about-close')?.addEventListener('click', () => about.close());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !about.open && !migrations.open && !$('#panel').hidden && document.activeElement !== $('#search')) panel.close();
  if (e.key === '/' && document.activeElement !== $('#search')) { e.preventDefault(); $('#search').focus(); }
});

// Deep links
const apply = (s: ViewState) => {
  if (!!s.looked !== looked) setLooked(!!s.looked);
  if (s.sp) {
    hint.hidden = true;
    if (s.at) { panel.rememberPlace(s.at.lat, s.at.lon); globe.flyTo(s.at.lon, s.at.lat, 3.2); }
    panel.showSpecies(s.sp, !!s.at);
  }
  else if (s.at) { hint.hidden = true; globe.flyTo(s.at.lon, s.at.lat, 4); panel.showPlace(s.at.lat, s.at.lon); }
};
window.addEventListener('hashchange', () => { if (!writingHash) apply(parseHash(location.hash)); });
apply(parseHash(location.hash));

// test hook for scripts/screenshots.mjs
(window as unknown as { __atlas: unknown }).__atlas = { globe, panel };
