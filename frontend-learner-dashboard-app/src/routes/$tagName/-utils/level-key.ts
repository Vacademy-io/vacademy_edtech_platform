/**
 * Level keys: a course whose LEVEL is named like a stream or category belongs
 * to it, as if it carried that folder's tag. Sites that structure courses by
 * level ("Vedic Parenting", "History") then fill their stream tabs without
 * tagging every course again.
 *
 * Both sides become `level:<slug>` entries next to the real tags — a folder's
 * course tag, title and subtitle; a course's level name — so every rule that
 * intersects a stream's tags with a course's tag set matches them unchanged,
 * and the prefix keeps a level key from ever equalling a real tag or filter.
 * Matching is exact on the slug ("India of temples" = "india-of-temples").
 * Pure.
 */

export const LEVEL_KEY_PREFIX = "level:";

/** Placeholder level names that never name a place. */
const IGNORED = new Set(["default"]);

const slug = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `level:<slug>` of a name, or null for one with no Latin letters/digits or a placeholder. */
export const levelKey = (name: unknown): string | null => {
  if (typeof name !== "string") return null;
  const s = slug(name);
  return s && !IGNORED.has(s) ? LEVEL_KEY_PREFIX + s : null;
};

/** The level keys of several names, unique, without nulls. */
export const levelKeys = (...names: unknown[]): string[] => {
  const out = new Set<string>();
  for (const n of names) {
    const k = levelKey(n);
    if (k) out.add(k);
  }
  return [...out];
};
