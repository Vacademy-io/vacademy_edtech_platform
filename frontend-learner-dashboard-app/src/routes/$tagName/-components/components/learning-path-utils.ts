/**
 * Learning paths — pure helpers for the `learningPath` section.
 *
 * A learning path IS a product page: its courses, in the admin's display
 * order, are the path's numbered steps. A course offered in several language
 * versions (levels "Hindi" / "English") is ONE step with a language choice,
 * when the site groups versions (globalSettings.courseLanguages.enabled).
 * Levels that differ by more than their language ("Level 1" / "Level 2",
 * "Beginner Hindi" / "Advanced Hindi") stay separate steps: a path never hides
 * one of its courses.
 * The list mode reads the paths from the folder library: the product pages
 * under the stream folder named by ?stream=, a chosen folder, or all of them.
 */
import { LEVEL_KEY_PREFIX, levelKeys } from "../../-utils/level-key";
import {
  languageOfLevel,
  languageOfTags,
  variantForLanguage,
  type CourseGroup,
  type CourseLanguageOption,
} from "../../-utils/course-variants";
import { cartTotals, type CartTotals, type SiteCartItem } from "../../-utils/site-cart";
import { getCurrencySymbol } from "@/utils/currency";
import { folderSlug, pathTo, type PublicFolderNode } from "../../-services/folder-library-service";
import { parseBasketPricing, quoteBasket } from "@/routes/product-pages/$productPageCode/-utils/basket-pricing";
import { bestOffer, parseOffers } from "@/routes/product-pages/$productPageCode/-utils/offers";
import { cartItemFromMapping, languageTokens, type CartMappingLike } from "../site-cart/site-cart-items";
import { safeAccentColor } from "../header/header-links";

/** The part of a by-code mapping a path step reads. */
export interface PathMapping extends CartMappingLike {
  status?: string | null;
  session_name?: string | null;
  display_order?: number | null;
  /** The course's tags, comma-separated (by-code mappings carry them). */
  tags?: string | null;
}

export interface PathStep<T extends PathMapping = PathMapping> {
  /**
   * Unique within the path (the package session of the step's first version):
   * what the list and the visitor's language picks are keyed by. Two steps
   * can share a courseId; they never share a key.
   */
  key: string;
  /** package_id (or the package session for a mapping without one) — the site cart holds one version per courseId. */
  courseId: string;
  /** The course's versions in this step, in display order (one per language). */
  variants: T[];
  /** Languages the step is offered in, in the site's order. */
  languages: CourseLanguageOption[];
  /** The version shown first: the visitor's language when the step has it. */
  primary: T;
}

const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A level name without its language words — what two language versions of the
 * same level share: "Beginner Hindi" and "Beginner (English)" are both
 * "beginner"; plain "Hindi" / "English" are both "". Uses the same tokens as
 * languageOfLevel (whole words for ASCII, anywhere for other scripts).
 */
export const levelWithoutLanguage = (
  levelName: string | null | undefined,
  language: CourseLanguageOption,
): string => {
  let name = ` ${(levelName || "").toLowerCase()} `;
  for (const token of languageTokens(language)) {
    name = isAscii(token)
      ? name.replace(new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}(?=[^a-z0-9]|$)`, "g"), "$1 ")
      : name.split(token).join(" ");
  }
  return name.replace(/[\s\-_.,:;|/\\()[\]{}·•–—]+/g, " ").trim();
};

/**
 * The path's steps: ACTIVE mappings in the order given (display order — the
 * product-page query sorts them), each package session once.
 *
 * With grouped versions, rows of one package fold into one step only when they
 * differ by language alone (same level apart from its language words, a
 * different language each). Every other row — a level with no language, a
 * second level of the same package, a second row in a language the step
 * already has — is a step of its own. Without grouping every row is a step.
 */
export const buildPathSteps = <T extends PathMapping>(
  mappings: T[] | null | undefined,
  opts: { groupVersions: boolean; languages: CourseLanguageOption[]; preferredLanguage?: string | null },
): PathStep<T>[] => {
  const seen = new Set<string>();
  const rows = (mappings || []).filter((m) => {
    if (!m?.package_session_id) return false;
    if ((m.status ?? "ACTIVE").toUpperCase() !== "ACTIVE") return false;
    // A page that lists the same version twice still shows it once.
    if (seen.has(m.package_session_id)) return false;
    seen.add(m.package_session_id);
    return true;
  });

  const languageCode = (row: T) => languageOfLevel(row.level_name, opts.languages)?.code ?? null;
  const steps: PathStep<T>[] = [];
  const foldable = new Map<string, PathStep<T>>();
  const newStep = (row: T): PathStep<T> => {
    const packageId = typeof row.package_id === "string" ? row.package_id.trim() : "";
    const step: PathStep<T> = {
      key: row.package_session_id,
      courseId: packageId || row.package_session_id,
      variants: [row],
      languages: [],
      primary: row,
    };
    steps.push(step);
    return step;
  };

  for (const row of rows) {
    const language = opts.groupVersions && row.package_id ? languageOfLevel(row.level_name, opts.languages) : null;
    if (!language) {
      newStep(row);
      continue;
    }
    const foldKey = `${row.package_id}\u0000${levelWithoutLanguage(row.level_name, language)}`;
    const step = foldable.get(foldKey);
    if (!step) {
      foldable.set(foldKey, newStep(row));
    } else if (step.variants.some((v) => languageCode(v) === language.code)) {
      // Two rows in the same language are two courses, not two versions.
      newStep(row);
    } else {
      step.variants.push(row);
    }
  }

  for (const step of steps) {
    const present = new Set(step.variants.map(languageCode).filter((code): code is string => !!code));
    step.languages = opts.languages.filter((l) => present.has(l.code));
    if (opts.preferredLanguage) {
      const preferred = step.variants.find((v) => languageCode(v) === opts.preferredLanguage);
      if (preferred) step.primary = preferred;
    }
  }
  return steps;
};

/** The version chosen for a step: the visitor's language pick when the step has it, else its first version. */
export const chosenVariant = <T extends PathMapping>(
  step: PathStep<T>,
  languageCode: string | null | undefined,
  languages: CourseLanguageOption[],
): T => {
  if (languageCode) {
    const picked = variantForLanguage(step as CourseGroup<T>, languageCode, languages);
    if (picked) return picked;
  }
  return step.primary;
};

/** One version per step, honouring the visitor's language picks (keyed by step key). */
export const pathSelection = <T extends PathMapping>(
  steps: PathStep<T>[],
  choices: Record<string, string | undefined>,
  languages: CourseLanguageOption[],
): T[] => steps.map((s) => chosenVariant(s, choices[s.key], languages));

/** The chosen versions as site-cart items (titles stay raw — translated only when shown). */
export const pathCartItems = (
  variants: PathMapping[],
  opts: { languages: CourseLanguageOption[]; productPageCode: string; pathTitle?: string },
): SiteCartItem[] =>
  variants.map((m) =>
    cartItemFromMapping(m, {
      languages: opts.languages,
      source: {
        kind: "path",
        productPageCode: opts.productPageCode,
        ...(opts.pathTitle ? { pathTitle: opts.pathTitle } : {}),
      },
    }),
  );

/** The path's price: the chosen versions summed (null when currencies differ). */
export const pathTotals = (items: SiteCartItem[]): CartTotals => cartTotals(items);

/**
 * What "Enrol in this path" charges before a coupon, priced the way the
 * product page's checkout prices the same courses (product-page-store
 * finalPrice): a basket price configured on the page ("any 3 for ₹799")
 * replaces the sum of the courses, then the page's best offer comes off.
 * `plain` (cartTotals of the same courses) is returned untouched when neither
 * applies or the currencies differ. The struck-through figure becomes what the
 * courses list at, when that is more than the total.
 */
export const pathCheckoutTotals = (
  plain: CartTotals,
  variants: Array<Pick<PathMapping, "level_name" | "package_name" | "payment_plan">>,
  settingsJson: string | null | undefined,
): CartTotals => {
  if (plain.total === null || !variants.length || !settingsJson) return plain;
  let base = plain.total;
  let listTotal = plain.elevatedTotal ?? plain.total;
  try {
    const quote = quoteBasket(
      parseBasketPricing(settingsJson),
      variants.map((m) => ({
        levelName: m.level_name,
        packageName: m.package_name,
        price: m.payment_plan?.actual_price ?? 0,
      })),
    );
    if (quote) {
      base = quote.total;
      listTotal = Math.max(listTotal, quote.itemTotal);
    }
  } catch {
    // An unreadable basket configuration: the courses' own prices stand.
  }
  const total = Math.max(0, base - (bestOffer(parseOffers(settingsJson), base, variants.length)?.amount ?? 0));
  if (total === plain.total) return plain;
  return { ...plain, total, elevatedTotal: listTotal > total ? listTotal : null };
};

/** ?courseIds= for the path's product-page checkout (package session ids). */
export const pathCourseIds = (variants: Array<{ package_session_id: string }>): string =>
  [...new Set(variants.map((v) => v.package_session_id).filter(Boolean))].join(",");

/** The chosen versions not yet in the site cart. */
export const missingFromCart = (items: SiteCartItem[], inCart: (packageSessionId: string) => boolean): SiteCartItem[] =>
  items.filter((i) => !inCart(i.packageSessionId));

/**
 * The versions the site cart can take from a path: one per course, because the
 * cart holds one (a second version of a course replaces the first). A course
 * the path lists more than once — two of its levels, or ungrouped language
 * versions — keeps the version already in the cart, else its first step's.
 * Path order is kept.
 */
export const onePerCourse = (
  items: SiteCartItem[],
  inCart: (packageSessionId: string) => boolean,
): SiteCartItem[] => {
  const byCourse = new Map<string, SiteCartItem>();
  for (const item of items) {
    const held = byCourse.get(item.courseId);
    if (!held || (!inCart(held.packageSessionId) && inCart(item.packageSessionId))) {
      byCourse.set(item.courseId, item);
    }
  }
  const kept = new Set(byCourse.values());
  return items.filter((i) => kept.has(i));
};

export interface PathCartPlan {
  /** What "Add whole path to cart" aims for: one version per course. */
  targets: SiteCartItem[];
  /** Targets not in the cart yet — what the next add puts in. */
  missing: SiteCartItem[];
  /** Every target is in the cart. */
  allInCart: boolean;
  /** Some targets are in the cart, some are not. */
  someInCart: boolean;
  /** The path lists more versions than the cart can hold (one per course). */
  collapsed: boolean;
}

/**
 * The path against the site cart. Built on onePerCourse, so one add always
 * settles it: after adding `missing`, every target is in the cart.
 */
export const planPathCart = (
  items: SiteCartItem[],
  inCart: (packageSessionId: string) => boolean,
): PathCartPlan => {
  const targets = onePerCourse(items, inCart);
  const missing = missingFromCart(targets, inCart);
  return {
    targets,
    missing,
    allInCart: targets.length > 0 && missing.length === 0,
    someInCart: missing.length > 0 && missing.length < targets.length,
    collapsed: targets.length < items.length,
  };
};

// ─── list mode (folder library) ─────────────────────────────────────────────

export interface PathEntry {
  node: PublicFolderNode;
  /** product_page_code — what ?path= carries. */
  code: string;
  /** The folder the path sits in (null at the library's top level). */
  parent: PublicFolderNode | null;
}

/** A path card's own words and colour (Manage Pages → Folders → Advanced); "" / null when not set. */
export interface PathCardDetails {
  /** Second line under the title. */
  subtitle: string;
  /** One-line pitch. */
  tagline: string;
  /** The card's button label (the section's "View path" when empty). */
  ctaLabel: string;
  /** A validated #rgb / #rrggbb / #rrggbbaa colour. */
  accentColor: string | null;
}

const textOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The card fields of a path's folder-library item, raw (translated where shown). */
export const pathCardDetails = (
  node: Pick<PublicFolderNode, "subtitle" | "tagline" | "cta_label" | "accent_color">,
): PathCardDetails => ({
  subtitle: textOf(node.subtitle),
  tagline: textOf(node.tagline),
  ctaLabel: textOf(node.cta_label),
  accentColor: safeAccentColor(node.accent_color),
});

/**
 * The paths (product pages) under `nodes`, in library order, each code once.
 * Coming-soon folders are not opened: what is inside them has not launched.
 */
export const collectPathEntries = (
  nodes: PublicFolderNode[] | null | undefined,
  parent: PublicFolderNode | null = null,
  seen: Set<string> = new Set(),
): PathEntry[] => {
  const out: PathEntry[] = [];
  for (const n of nodes || []) {
    if (n.node_type === "PRODUCT_PAGE") {
      const code = (n.product_page_code || "").trim();
      if (code && !seen.has(code)) {
        seen.add(code);
        out.push({ node: n, code, parent });
      }
    } else if (!n.coming_soon) {
      out.push(...collectPathEntries(n.children, n, seen));
    }
  }
  return out;
};

/**
 * The folder a ?stream= value names: a top-level folder first (streams are the
 * library's top level), else the first folder anywhere with that slug.
 * Matching ignores case.
 */
export const findFolderBySlug = (roots: PublicFolderNode[], slug: string | null | undefined): PublicFolderNode | null => {
  const key = (slug || "").trim().toLowerCase();
  if (!key) return null;
  const matches = (n: PublicFolderNode) => n.node_type === "FOLDER" && folderSlug(n).toLowerCase() === key;
  const top = roots.find(matches);
  if (top) return top;
  const queue = roots.flatMap((n) => n.children || []);
  while (queue.length) {
    const n = queue.shift()!;
    if (matches(n)) return n;
    queue.push(...(n.children || []));
  }
  return null;
};

export type PathScope =
  | { kind: "all" }
  | { kind: "folder"; folder: PublicFolderNode; fromStream: boolean }
  /** The stream / folder asked for is not in the library (or is hidden). */
  | { kind: "missing" };

/** Where the list's paths come from: ?stream= (when read), else the chosen folder, else everything. */
export const resolvePathScope = (
  roots: PublicFolderNode[],
  opts: { stream?: string | null; folderId?: string | null },
): PathScope => {
  if (opts.stream) {
    const folder = findFolderBySlug(roots, opts.stream);
    return folder ? { kind: "folder", folder, fromStream: true } : { kind: "missing" };
  }
  if (opts.folderId) {
    const trail = pathTo(roots, opts.folderId);
    const hit = trail[trail.length - 1];
    return hit && hit.node_type === "FOLDER" ? { kind: "folder", folder: hit, fromStream: false } : { kind: "missing" };
  }
  return { kind: "all" };
};

export const pathsInScope = (roots: PublicFolderNode[], scope: PathScope): PathEntry[] => {
  if (scope.kind === "all") return collectPathEntries(roots);
  if (scope.kind === "missing" || scope.folder.coming_soon) return [];
  return collectPathEntries(scope.folder.children, scope.folder);
};

// ─── featured list layout (listLayout: "featured") ──────────────────────────
//
// Pure helpers for LearningPathFeatured: goal chips, the featured path, the
// per-path step rows ("format · price"), pills and totals. Read only by the
// opt-in featured layout; the cards list and the single path never call them.

/** A mapping's course tags as a list, lower-case (product-page mappings carry a comma string). */
export const mappingTags = (row: { tags?: unknown }): string[] => {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") {
      v.split(",").forEach((t) => {
        const tag = t.trim().toLowerCase();
        if (tag) out.push(tag);
      });
    } else if (Array.isArray(v)) v.forEach(add);
  };
  add(row.tags);
  return out;
};

/** The language a path step's version is in: its level name, else a tag that IS a language. */
export const pathRowLanguage = (
  row: { level_name?: string | null; tags?: unknown },
  languages: CourseLanguageOption[],
): CourseLanguageOption | null =>
  languageOfLevel(row.level_name, languages) ?? languageOfTags(mappingTags(row).join(","), languages);

/**
 * Folds the 1-based step positions in each group into one step (the first
 * position keeps its place): two packages that are the same course in two
 * languages ("गुरुकुल शिक्षा" / "True Gurukul Shiksha"). The folded step's
 * primary is the version in the visitor's language when it has one.
 * Out-of-range and repeated positions are ignored; a group of fewer than two
 * valid positions changes nothing.
 */
export const mergePathSteps = <T extends PathMapping>(
  steps: PathStep<T>[],
  groups: unknown,
  languages: CourseLanguageOption[],
  preferredLanguage?: string | null,
): PathStep<T>[] => {
  if (!Array.isArray(groups) || !groups.length) return steps;
  const used = new Set<number>();
  const into = new Map<number, number[]>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    const positions = [
      ...new Set(
        group
          .map((p) => (typeof p === "number" && Number.isInteger(p) ? p - 1 : -1))
          .filter((i) => i >= 0 && i < steps.length && !used.has(i)),
      ),
    ];
    if (positions.length < 2) continue;
    positions.sort((a, b) => a - b);
    positions.forEach((i) => used.add(i));
    into.set(positions[0]!, positions.slice(1));
  }
  if (!into.size) return steps;
  const absorbed = new Set([...into.values()].flat());
  const out: PathStep<T>[] = [];
  steps.forEach((step, i) => {
    if (absorbed.has(i)) return;
    const others = into.get(i);
    if (!others) {
      out.push(step);
      return;
    }
    const variants = [step, ...others.map((j) => steps[j]!)].flatMap((s) => s.variants);
    const present = new Set(
      variants.map((v) => pathRowLanguage(v, languages)?.code).filter((c): c is string => !!c),
    );
    const preferred = preferredLanguage
      ? variants.find((v) => pathRowLanguage(v, languages)?.code === preferredLanguage)
      : undefined;
    out.push({
      ...step,
      variants,
      languages: languages.filter((l) => present.has(l.code)),
      primary: preferred ?? step.primary,
    });
  });
  return out;
};

/**
 * Every language a path step's version is in: its level's, else each language
 * its tags name (a course tagged "english,hindi" is in both).
 */
const pathRowLanguageCodes = (
  row: { level_name?: string | null; tags?: unknown },
  languages: CourseLanguageOption[],
): string[] => {
  const level = languageOfLevel(row.level_name, languages);
  if (level) return [level.code];
  const tags = mappingTags(row).join(",");
  return languages.filter((l) => languageOfTags(tags, [l])).map((l) => l.code);
};

/**
 * A course page's series in the course's own language: a Hindi course counts
 * only the path's steps in Hindi (and steps with no language), so its number
 * is its place among them. A step that has a version in that language shows
 * it. A course whose language is unknown, or that is not a step, keeps every step.
 * Only for a site with course languages on (else every site would read the default languages).
 */
export const stepsInCourseLanguage = <T extends PathMapping>(
  steps: PathStep<T>[],
  courseId: string,
  languages: CourseLanguageOption[],
): PathStep<T>[] => {
  const own = steps.find((s) => s.courseId === courseId);
  // Every version of the course counts: a course in English and Hindi keeps both.
  const langs = new Set(own ? own.variants.flatMap((v) => pathRowLanguageCodes(v, languages)) : []);
  if (!langs.size) return steps;
  const inLangs = (row: T) => pathRowLanguageCodes(row, languages).some((code) => langs.has(code));
  const out: PathStep<T>[] = [];
  for (const step of steps) {
    // The step's own pick (the visitor's language) when it qualifies, else its first version that does.
    const hit = inLangs(step.primary) ? step.primary : step.variants.find(inLangs);
    if (hit) out.push(hit === step.primary ? step : { ...step, primary: hit });
    else if (step.variants.every((v) => !pathRowLanguageCodes(v, languages).length)) out.push(step);
  }
  return out;
};

/** The step a visitor sees: its primary, or the version in the visitor's language (by level or tag). */
export const displayVariant = <T extends PathMapping>(
  step: PathStep<T>,
  languages: CourseLanguageOption[],
  preferredLanguage?: string | null,
): T => {
  if (preferredLanguage && pathRowLanguage(step.primary, languages)?.code !== preferredLanguage) {
    const hit = step.variants.find((v) => pathRowLanguage(v, languages)?.code === preferredLanguage);
    if (hit) return hit;
  }
  return step.primary;
};

/**
 * The streams a path draws on: the streams (top-level folders) whose tags any
 * of its versions carry, in first-seen step order. With none (or before the
 * steps load), the stream the path sits under.
 */
export const pathStreams = <S extends { id: string; tags: string[] }>(
  rows: Array<{ tags?: unknown; level_name?: string | null }>,
  streams: S[],
  fallback: S | null,
): S[] => {
  const out: S[] = [];
  for (const row of rows) {
    // Level keys too: a step levelled like a stream belongs to it (-utils/level-key.ts).
    const tags = [...mappingTags(row).filter((t) => !t.startsWith(LEVEL_KEY_PREFIX)), ...levelKeys(row.level_name)];
    for (const stream of streams) {
      if (!out.includes(stream) && stream.tags.some((t) => tags.includes(t))) out.push(stream);
    }
  }
  if (!out.length && fallback) out.push(fallback);
  return out;
};

/** The languages a path's versions are in: most versions first, ties in the site's order. */
export const pathLanguages = (
  rows: Array<{ level_name?: string | null; tags?: unknown }>,
  languages: CourseLanguageOption[],
): CourseLanguageOption[] => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const lang = pathRowLanguage(row, languages);
    if (lang) counts.set(lang.code, (counts.get(lang.code) ?? 0) + 1);
  }
  return languages
    .map((l, i) => ({ l, i, n: counts.get(l.code) ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.l);
};

/** A path step that has not launched: authored, never priced or counted in totals. */
export interface ComingSoonStep {
  title: string;
  /** 1-based place in the path; at the end when absent or out of range. */
  position?: number;
  /** The audience form "notify me" opens; the row is inert without one. */
  audienceId?: string;
}

export type FeaturedStepItem<T> =
  | { kind: "step"; step: PathStep<T & PathMapping>; index: number }
  | { kind: "soon"; title: string; audienceId: string | null; index: number };

/** Real steps with the coming-soon steps inserted at their positions; `index` is the shown number - 1. */
export const withComingSoonSteps = <T extends PathMapping>(
  steps: PathStep<T>[],
  comingSoon: unknown,
): FeaturedStepItem<T>[] => {
  const items: FeaturedStepItem<T>[] = steps.map((step) => ({ kind: "step", step, index: 0 }));
  const soon = (Array.isArray(comingSoon) ? comingSoon : [])
    .filter((s): s is ComingSoonStep => !!s && typeof s === "object" && typeof (s as ComingSoonStep).title === "string")
    .filter((s) => s.title.trim());
  for (const s of soon) {
    const at =
      typeof s.position === "number" && Number.isInteger(s.position) && s.position >= 1 && s.position <= items.length
        ? s.position - 1
        : items.length;
    items.splice(at, 0, {
      kind: "soon",
      title: s.title.trim(),
      audienceId: typeof s.audienceId === "string" && s.audienceId.trim() ? s.audienceId.trim() : null,
      index: 0,
    });
  }
  return items.map((item, index) => ({ ...item, index }));
};

/** The price a version sells at (0 = free; null when the page has no plan). */
export const variantPrice = (row: PathMapping): number | null => {
  const price = row.payment_plan?.actual_price;
  return typeof price === "number" && Number.isFinite(price) ? Math.max(0, price) : null;
};

export type PathPill = "allFree" | "firstFree" | null;

/**
 * "All steps free" when every priced step is free, "Step 1 is free" when the
 * first is; else none. `firstShownIsSoon`: the row numbered 1 is a
 * coming-soon step, so no real step is "Step 1".
 */
export const pathPill = (prices: Array<number | null>, firstShownIsSoon = false): PathPill => {
  if (!prices.length) return null;
  if (prices.every((p) => p === 0)) return "allFree";
  return prices[0] === 0 && !firstShownIsSoon ? "firstFree" : null;
};

export type PathTotalNote = "allFree" | "available" | "all";

export interface PathTotalSummary {
  /** Sum of the shown versions' prices; null when a price is missing or currencies differ. */
  total: number | null;
  currency: string | null;
  note: PathTotalNote;
  /** Real steps (coming-soon steps excluded). */
  count: number;
  /** Indexes (into the real steps) of the free ones. */
  freeSteps: number[];
}

export const pathTotalSummary = (variants: PathMapping[], comingSoonCount: number): PathTotalSummary => {
  const prices = variants.map(variantPrice);
  const currencies = new Set(variants.map((v) => (v.payment_plan?.currency || "").toUpperCase()).filter(Boolean));
  const known = prices.every((p): p is number => p !== null) && currencies.size <= 1;
  const total = known && prices.length ? (prices as number[]).reduce((a, b) => a + b, 0) : null;
  const freeSteps = prices.flatMap((p, i) => (p === 0 ? [i] : []));
  const note: PathTotalNote =
    total === 0 && comingSoonCount === 0 ? "allFree" : comingSoonCount > 0 ? "available" : "all";
  return { total, currency: currencies.size === 1 ? [...currencies][0]! : null, note, count: variants.length, freeSteps };
};

/** A goal chip: paths match by their streams' / versions' tags, or by an authored goal tag on the path. */
export interface PathGoal {
  key: string;
  label: string;
  /** Stream / category tags (folder slugs) this goal stands for. */
  tags?: string[];
}

export const goalMatchesPath = (
  goal: Pick<PathGoal, "key" | "tags">,
  path: { tags: string[]; goalTags?: string[] },
): boolean => {
  const key = (goal.key || "").trim().toLowerCase();
  if (key && (path.goalTags || []).some((t) => t.trim().toLowerCase() === key)) return true;
  const wanted = (goal.tags || []).map((t) => (typeof t === "string" ? t.trim().toLowerCase() : "")).filter(Boolean);
  return wanted.some((t) => path.tags.includes(t));
};

/** The featured path: the authored code when the list has it, else the first path. */
export const pickFeaturedEntry = <E extends { code: string }>(entries: E[], code: string | null | undefined): E | null => {
  const wanted = (code || "").trim();
  return (wanted && entries.find((e) => e.code === wanted)) || entries[0] || null;
};

/**
 * A path price as the design writes it: "₹251", "₹1,503" (grouped, no ".00"
 * for whole amounts; Indian grouping for rupees).
 */
export const formatPathPrice = (amount: number, currency?: string | null): string => {
  const code = (currency || "INR").toUpperCase();
  const whole = Number.isInteger(amount);
  const digits = amount.toLocaleString(code === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${getCurrencySymbol(code)}${digits}`;
};
