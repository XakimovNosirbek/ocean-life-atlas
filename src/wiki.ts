// Parsing Wikidata answers into what a species card needs. Pure (test/wiki.test.ts).

export interface WikiInfo { name?: string; image?: string; article?: string }

/** File name from a Commons Special:FilePath URL ("Whale shark Georgia aquarium.jpg"). */
export function commonsFile(url: string): string | null {
  const m = /Special:FilePath\/(.+)$/.exec(url);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).replace(/_/g, ' '); } catch { return null; }
}

/** Thumbnail URL for a Commons file at a given pixel width (Commons redirects to the scaled image). */
export function commonsThumb(file: string, width: number): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${width}`;
}

/** Wikipedia title from an article URL. */
export function articleTitle(url: string): string | null {
  const m = /\/wiki\/(.+)$/.exec(url);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/** A readable name: the label in the reader's language, then their common name, then the English label (usually
 *  matches Wikipedia: "long-finned pilot whale"), then an English common name; never the scientific name itself
 *  (Wikidata often labels taxa with it). */
export function pickName(b: Record<string, { value: string } | undefined>, scientific?: string): string | undefined {
  const sci = scientific?.trim().toLowerCase();
  for (const k of ['label', 'common', 'labelEn', 'commonEn']) {
    const v = b[k]?.value?.trim();
    if (v && v.toLowerCase() !== sci) return v.charAt(0).toUpperCase() + v.slice(1);
  }
  return undefined;
}

export function parseWikidata(bindings: Record<string, { value: string } | undefined>[], sciById?: Map<number, string>): Map<number, WikiInfo> {
  const out = new Map<number, WikiInfo>();
  for (const b of bindings) {
    const id = Number(b.aphia?.value);
    if (!Number.isInteger(id)) continue;
    const image = b.image ? commonsFile(b.image.value) ?? undefined : undefined;
    out.set(id, { name: pickName(b, sciById?.get(id)), image, article: b.article?.value });
  }
  return out;
}
