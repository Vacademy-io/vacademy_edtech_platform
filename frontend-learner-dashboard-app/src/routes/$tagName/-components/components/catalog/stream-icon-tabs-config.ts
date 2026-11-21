/**
 * The opt-in "icons" stream tabs (feature 'tabs', specs/stream-tabs.json).
 * Pure: reads courseCatalog.streams. A section resolves to null — and keeps
 * the original pill tabs — unless it sets `variant: "icons"` exactly.
 */

export interface StreamIconTabsConfig {
  /** "English name · 12" counts (catalogue totals). */
  showCounts: boolean;
  /** Second line of the All tab ('' = none). Already localized by the props pass. */
  allSubtitle: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const resolveStreamIconTabs = (raw: unknown): StreamIconTabsConfig | null => {
  if (!isObject(raw) || raw.enabled !== true || raw.variant !== "icons") return null;
  return {
    showCounts: raw.showCounts === true,
    allSubtitle: typeof raw.allSubtitle === "string" ? raw.allSubtitle.trim() : "",
  };
};

/**
 * The first user-perceived character of a name ("शि" of "शिक्षा", "K" of
 * "kala"), upper-cased — the fallback icon of a stream without an image.
 */
export const firstGrapheme = (text: string): string => {
  const s = (text || "").trim();
  if (!s) return "";
  const Segmenter = (Intl as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    for (const part of new Segmenter(undefined, { granularity: "grapheme" }).segment(s)) return part.segment.toUpperCase();
  }
  return (Array.from(s)[0] || "").toUpperCase();
};
