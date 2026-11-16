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

/* ── Page-level filter (a layout with showTagFilter hosts it) ─────────────
 * With a host on the page, every tagged column of every column layout is
 * shown as ONE grid at the host's place (a Books page is 8 rows of 4: a
 * filter used to leave each row with its own gaps). Untagged layouts are
 * untouched.
 *
 *   props.tagFilterStyle   'chips' (default) | 'sidebar' (the Courses page look)
 *   props.tagFilterGroups  [{ label, tags[] }] sidebar checkbox groups;
 *                          OR inside a group, AND across groups
 *   props.tagFilterColumns 2 | 3 | 4 cards per row (default 3 sidebar / 4 chips)
 */

export interface FilterGroup {
  label: string;
  tags: string[];
}

export interface FilterItem {
  /** The column layout the item comes from (builder selection). */
  layoutId: string;
  slotIndex: number;
  tags: string[];
  /** The column's blocks (rendered as the layout would). */
  children: unknown[];
}

interface LayoutLike {
  id?: string;
  type?: string;
  enabled?: boolean;
  props?: Record<string, unknown>;
}

/** The layout that hosts the page's filter: the first enabled one with the bar on. */
export const findFilterHost = <T extends LayoutLike>(components: T[] | undefined): T | undefined =>
  (components || []).find((c) => c?.type === "columnLayout" && c.enabled !== false && !!c.props?.showTagFilter);

/** Every column of every tagged, enabled column layout, in page order. */
export const collectFilterItems = (components: LayoutLike[] | undefined): FilterItem[] => {
  const items: FilterItem[] = [];
  for (const c of components || []) {
    if (c?.type !== "columnLayout" || c.enabled === false) continue;
    const lists = columnTagLists(c.props);
    if (!layoutHasFilterTags(lists)) continue;
    const slots = Array.isArray(c.props?.slots) ? (c.props!.slots as unknown[]) : [];
    slots.forEach((slot, i) => {
      items.push({
        layoutId: String(c.id ?? ""),
        slotIndex: i,
        tags: lists[i] || [],
        children: Array.isArray(slot) ? slot : [],
      });
    });
  }
  return items;
};

/**
 * The sidebar groups: authored groups keep their order and only the tags that
 * exist on the page; tags in no group go to a last group named `otherLabel`.
 * No groups authored → one group with every tag.
 */
export const resolveFilterGroups = (raw: unknown, pageTags: string[], otherLabel: string): FilterGroup[] => {
  const onPage = new Map(pageTags.map((t) => [normalizeFilterTag(t), t]));
  const used = new Set<string>();
  const groups: FilterGroup[] = [];
  for (const g of Array.isArray(raw) ? raw : []) {
    if (!g || typeof g !== "object") continue;
    const label = typeof (g as FilterGroup).label === "string" ? (g as FilterGroup).label.trim() : "";
    const tags: string[] = [];
    for (const name of parseFilterTags((g as FilterGroup).tags)) {
      const key = normalizeFilterTag(name);
      const label2 = onPage.get(key);
      if (label2 && !used.has(key)) {
        used.add(key);
        tags.push(label2);
      }
    }
    if (tags.length) groups.push({ label: label || otherLabel, tags });
  }
  const rest = pageTags.filter((t) => !used.has(normalizeFilterTag(t)));
  if (rest.length) groups.push({ label: otherLabel, tags: rest });
  return groups;
};

/** The picked tags from the URL (?tag=a,b), kept only when they exist on the page. */
export const resolveSelectedTags = (fromUrl: string[], pageTags: string[]): string[] => {
  const out: string[] = [];
  for (const raw of fromUrl) {
    const hit = resolveActiveFilterTag(raw, pageTags);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
};

/** OR inside a group, AND across groups; nothing picked = everything. */
export const itemMatchesSelection = (itemTags: string[], selected: string[], groups: FilterGroup[]): boolean => {
  if (!selected.length) return true;
  const have = new Set(itemTags.map(normalizeFilterTag));
  const picked = new Set(selected.map(normalizeFilterTag));
  return groups.every((g) => {
    const inGroup = g.tags.map(normalizeFilterTag).filter((k) => picked.has(k));
    return inGroup.length === 0 || inGroup.some((k) => have.has(k));
  });
};

/** Items each option would show if it were ticked (with the other groups' picks kept). */
export const filterOptionCounts = (items: FilterItem[], selected: string[], groups: FilterGroup[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const g of groups) {
    const groupKeys = new Set(g.tags.map(normalizeFilterTag));
    const others = selected.filter((s) => !groupKeys.has(normalizeFilterTag(s)));
    for (const tag of g.tags) {
      const sel = [...others, tag];
      counts[normalizeFilterTag(tag)] = items.filter((it) => itemMatchesSelection(it.tags, sel, groups)).length;
    }
  }
  return counts;
};
