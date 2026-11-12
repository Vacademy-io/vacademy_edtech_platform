/**
 * Tag filter for column layouts (e.g. a Books page: one book per column).
 *
 * Authoring (website builder → Column layout):
 *   props.columnTags   string[][]  tags of each column, same index as slots
 *   props.showTagFilter boolean    render the chip bar above this layout
 *   props.tagFilterAllLabel string label of the "show everything" chip
 *   props.tagOrder     string[]    chip order (tags not listed follow in
 *                                  first-seen order)
 *
 * The chosen chip lives in the URL (?tag=…), so every tagged layout on the
 * page filters together and a link such as /books?tag=Storybooks opens the
 * page already filtered. Tags match case- and space-insensitively.
 */

/** The URL parameter holding the picked chip. */
export const TAG_FILTER_PARAM = "tag";

export const normalizeFilterTag = (tag: string): string => tag.trim().replace(/\s+/g, " ").toLowerCase();

/** One column's tags: accepts a string[] or a comma-separated string. */
export const parseFilterTags = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/\s+/g, " ");
    const key = normalizeFilterTag(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
};

/** Tags of every column of a layout, aligned with its slots. */
export const columnTagLists = (props: { slots?: unknown; columnTags?: unknown } | undefined): string[][] => {
  const rawSlots = props?.slots;
  const rawTags = props?.columnTags;
  const slots: unknown[] = Array.isArray(rawSlots) ? rawSlots : [];
  const columnTags: unknown[] = Array.isArray(rawTags) ? rawTags : [];
  return slots.map((_, i) => parseFilterTags(columnTags[i]));
};

/** Does any column of the layout carry a tag? Untagged layouts never filter. */
export const layoutHasFilterTags = (lists: string[][]): boolean => lists.some((l) => l.length > 0);

/** Is column `index` shown for the active chip (null = All)? */
export const columnMatchesFilter = (lists: string[][], index: number, active: string | null): boolean => {
  if (!active || !layoutHasFilterTags(lists)) return true;
  const key = normalizeFilterTag(active);
  return (lists[index] || []).some((tag) => normalizeFilterTag(tag) === key);
};

interface FilterableComponent {
  type?: string;
  enabled?: boolean;
  props?: { slots?: unknown; columnTags?: unknown; tagOrder?: unknown };
}

/**
 * The chips for a page: every tag on its enabled column layouts, ordered by
 * `order` first (unknown names ignored) and then by first appearance. The
 * label kept is the one the author wrote first.
 */
export const collectPageFilterTags = (components: FilterableComponent[] | undefined, order?: unknown): string[] => {
  const labels = new Map<string, string>();
  for (const c of components || []) {
    if (c?.type !== "columnLayout" || c.enabled === false) continue;
    for (const list of columnTagLists(c.props)) {
      for (const tag of list) {
        const key = normalizeFilterTag(tag);
        if (!labels.has(key)) labels.set(key, tag);
      }
    }
  }
  const ordered: string[] = [];
  for (const name of parseFilterTags(order)) {
    const key = normalizeFilterTag(name);
    const label = labels.get(key);
    if (label) {
      ordered.push(label);
      labels.delete(key);
    }
  }
  return [...ordered, ...labels.values()];
};

/** The active chip from the URL, or null when it names no tag on the page. */
export const resolveActiveFilterTag = (fromUrl: string | null, pageTags: string[]): string | null => {
  if (!fromUrl) return null;
  const key = normalizeFilterTag(fromUrl);
  return pageTags.find((tag) => normalizeFilterTag(tag) === key) ?? null;
};
