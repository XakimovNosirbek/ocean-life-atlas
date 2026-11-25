import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import './styles.css';
import { fmt } from './dom';
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

// About
const about = $<HTMLDialogElement>('#about');
$('#about-open').addEventListener('click', () => about.showModal());
about.querySelector('.about-close')?.addEventListener('click', () => about.close());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !about.open && !$('#panel').hidden && document.activeElement !== $('#search')) panel.close();
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
