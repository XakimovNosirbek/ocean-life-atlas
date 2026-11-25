// URL hash <-> view state, so every place and species has a link. Pure (test/state.test.ts).
// #at=22.52,69.61            a place (the life-here panel for that point)
// #sp=105847                 a species (WoRMS AphiaID)
// #at=..&sp=..               a species opened from a place (Back returns to the place)

export interface ViewState { at?: { lat: number; lon: number }; sp?: number; looked?: boolean }

export function parseHash(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const s: ViewState = {};
  const at = p.get('at');
  if (at) {
    const [lat, lon] = at.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) s.at = { lat, lon };
  }
  const sp = Number(p.get('sp'));
  if (Number.isInteger(sp) && sp > 0) s.sp = sp;
  if (p.get('layer') === 'looked') s.looked = true;
  return s;
}

export function formatHash(s: ViewState): string {
  const parts: string[] = [];
  if (s.at) parts.push(`at=${s.at.lat.toFixed(2)},${s.at.lon.toFixed(2)}`);
  if (s.sp) parts.push(`sp=${s.sp}`);
  if (s.looked) parts.push('layer=looked');
  return parts.length ? `#${parts.join('&')}` : '';
}
