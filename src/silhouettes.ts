// Simple silhouettes for each kind of sea life, shown when a species has no photo. Drawn for this atlas
// (64 x 64 viewBox, filled shapes, no strokes) so a photo-less tile still says "this is a fish" at a glance.
import { groupOf, type GroupId, type Taxon } from './taxa';

const SHELL = 'M34 10c12 1 21 11 20 23-1 11-10 19-21 19H12c-1.7 0-2.6-2-1.4-3.2l3.6-3.6C11 41 9 36.5 9.5 31.5 10.5 19 21 9 34 10zm-1 9c-7 0-12 5-12 11.5S26 42 32 42c5.5 0 9.5-4 9.5-9 0-4.5-3.5-8-8-8-3.8 0-6.5 2.8-6.5 6.2 0 2.8 2.2 4.8 4.8 4.8 2.2 0 3.7-1.6 3.7-3.5';

const P: Record<GroupId, string> = {
  fish: 'M6 32c7-9 17-13 28-12 6 .5 11 3 15 6l9-7c1 0 1 1 1 1l-3 12 3 12s0 1-1 1l-9-7c-4 3-9 5.5-15 6-11 1-21-3-28-12zm13-2.5a2 2 0 1 0 .1 0z',
  sharks: 'M3 35c6-4 14-6 23-6.5l7-12c.6-1 2-.6 2 .5l-.6 11.5c5 .3 10 1.2 14 2.6l9-8c.7-.6 1.8 0 1.5.9l-3.4 9.5 3.4 9.5c.3.9-.8 1.5-1.5.9l-9-8c-6 2.2-14 3.2-22 3l-3 6.5c-.4.9-1.7.7-1.8-.3l-.4-6.6C14 39.6 8 38 3 35z',
  mammals: 'M5 34c0-9 9-15 22-15 12 0 21 5 25 12 1.5-3 4.5-6 8-6.5.8-.1 1.3.8.8 1.4l-3.3 4.6 3.4 4.4c.5.7 0 1.6-.8 1.5-3.6-.6-6.6-3-8-6.2C49 39 42 45 30 45c-5 0-9-1-12-2.5L13 47c-.7.6-1.7 0-1.4-.9l1.7-5.6C8.5 38.5 5 36.5 5 34z',
  turtles: 'M32 18c9 0 16 6 16 14s-7 14-16 14-16-6-16-14 7-14 16-14zm16 6c4-3 8-3 10-2 1 .5 1 1.5.4 2-2 2-5 3-8.5 3zm0 16c3.5 0 6.5 1 8.5 3 .6.5.6 1.5-.4 2-2 1-6 1-10-2zM16 24c-3.5 0-6.5-1-8.5-3-.6-.5-.6-1.5.4-2 2-1 6-1 10 2zm0 16c-4 3-8 3-10 2-1-.5-1-1.5-.4-2 2-2 5-3 8.5-3zm.5-8c-3 0-6 .8-9 2-.8.3-1.5-.4-1.2-1.2C7.5 29 10 28 13 28z',
  birds: 'M4 30c6-1.5 12 0 17 4 3-8 11-14 22-15 4-.4 8 .2 11 1.5.8.3.7 1.4-.1 1.6-9 2.5-15 8-17 15 4 0 8 1 11 3 .7.4.5 1.5-.3 1.6-6 .5-12 .8-17 0-3-.4-6-1.6-8.5-3.4C17 34.6 11 32 4.4 31.3 3.6 31.2 3.3 30.2 4 30z',
  corals: 'M30 58V40c-6-1-10-5-11-11l-5-3c-.8-.5-.5-1.7.4-1.8l3.6-.4-1-7c-.1-.9 1-1.4 1.6-.7L23 21c1 4 3.5 7 7 8V16l-3-5c-.4-.8.5-1.6 1.2-1.1L32 13l3.8-3.1c.7-.5 1.6.3 1.2 1.1l-3 5v18c4-1 7-4 8-8l1-8c.1-.9 1.3-1.1 1.6-.2l1.6 4.3 3.4-2c.8-.4 1.6.5 1.1 1.2L48 26c-1 7-6 12-14 13.5V58z',
  molluscs: 'M32 8c9 0 15 7 15 15 0 5-2 9-5 11l2 6c1 3 4 4 6 3 .9-.4 1.7.6 1.1 1.4-2.5 3-7 3.5-9.5.5L40 40l-.5 9c-.2 3 2 6 4.5 7 .9.4.6 1.7-.4 1.7-4.3 0-7.5-3.5-7.6-7.7L36 41l-2.3 13c-.5 2.6.6 5 2.4 6.3.8.6.3 1.8-.7 1.6-3.6-.6-5.8-4.2-5.2-7.8L32 41l-2.8 8c-1 2.8-3.8 4.6-6.8 4.3-1-.1-1.2-1.4-.3-1.8 2.4-1 4-3.3 4.2-5.8L27 40l-3 2.5c-2.5 3-7 2.5-9.5-.5-.6-.8.2-1.8 1.1-1.4 2 1 5 0 6-3l2-6c-3-2-5-6-5-11 0-8 6-15 15-15z',
  crustaceans: 'M32 26c8 0 14 4 14 10s-6 10-14 10-14-4-14-10 6-10 14-10zM14 14c4 1 7 4 7 8l-2 3c-3-1-6-3-7-6l-3 1c-.9.3-1.5-.8-.8-1.4zm36 0l5.8 4.6c.7.6.1 1.7-.8 1.4l-3-1c-1 3-4 5-7 6l-2-3c0-4 3-7 7-8zM18 38l-8 4m8 0l-7 7m35-11l8 4m-8 0l7 7M23 26l-3-5m21 5l3-5',
  echinoderms: 'M32 5l6.5 17.5L57 23l-14.5 11.5L48 53 32 42.5 16 53l5.5-18.5L7 23l18.5-.5z',
  algae: 'M20 60c-2-10 4-16 1-26-2-6-6-10-4-18 .2-.9 1.5-1 1.8-.1 2 6 7 11 7 19 0 9-5 15-3 25zm12 0c0-12 6-18 4-30-1-6-4-10-2-18 .2-.9 1.5-.9 1.8 0 2.4 7 6 12 5.6 20-.4 10-6 16-6 28zm12 0c-1-9 3-14 1-22-1.5-5-4-8-2.5-14 .2-.8 1.4-.9 1.7-.1 1.8 5 5 9 4.8 15-.2 8-4 12-3 21z',
  other: 'M32 12c11 0 19 7 19 16 0 2-1.5 3.5-3.5 3.5h-31C14.5 31.5 13 30 13 28c0-9 8-16 19-16zM19 35c1 7-2 12-1 20m9-20c0 8-3 13-2 21m7-21c0 8 3 13 2 21m7-21c-1 7 2 12 1 20',
};

/** Groups whose shapes are lines (legs, tentacles): drawn with a stroke as well as a fill. */
const STROKED = new Set<GroupId>(['crustaceans', 'other']);

/** Silhouette for a taxon: as its group, except snails, clams and other shelled molluscs get a shell, not an octopus. */
export function silhouetteFor(t: Taxon): SVGSVGElement {
  const g = groupOf(t);
  return g === 'molluscs' && t.class !== 'Cephalopoda' ? silhouette(g, SHELL) : silhouette(g);
}

export function silhouette(group: GroupId, d = P[group]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('silhouette');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  if (d === SHELL) { path.setAttribute('fill-rule', 'evenodd'); }
  else if (STROKED.has(group)) { path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '3'); path.setAttribute('stroke-linecap', 'round'); }
  svg.append(path);
  return svg;
}
