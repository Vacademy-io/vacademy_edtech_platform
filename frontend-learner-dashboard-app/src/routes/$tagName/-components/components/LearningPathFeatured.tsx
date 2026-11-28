import React from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Path } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import { courseLanguagesOf, preferredCourseLanguage, type CourseLanguageOption } from "../../-utils/course-variants";
import { useCatalogueLocale, useSiteT } from "../../-utils/catalogue-locale";
import { URL_PARAMS, useCatalogueSearchParams } from "../../-utils/catalogue-url-state";
import { useCourseFormats } from "../../-utils/course-format";
import { hexToHslChannels } from "../../-utils/catalogue-palette";
import { nodeTitle, pathTo, type PublicFolderNode } from "../../-services/folder-library-service";
import { streamsFromFolderTree, type CatalogStream } from "./catalog/catalog-streams";
import {
  buildPathSteps,
  displayVariant,
  formatPathPrice,
  goalMatchesPath,
  mappingTags,
  mergePathSteps,
  pathLanguages,
  pathPill,
  pathStreams,
  pathTotalSummary,
  pickFeaturedEntry,
  variantPrice,
  withComingSoonSteps,
  type ComingSoonStep,
  type FeaturedStepItem,
  type PathEntry,
  type PathGoal,
  type PathMapping,
  type PathPill,
  type PathTotalSummary,
} from "./learning-path-utils";

/**
 * learningPath list layout "featured" (opt-in: `listLayout: "featured"`), the
 * Brahm Varchas Learning Paths page (Figma 73:443 goal chips, 73:458 featured
 * path, 73:535 "More learning paths"):
 *
 * - goal chips ("All paths · 5", then one chip per authored goal that matches
 *   a path), kept in ?goal= so the grid section below follows the same pick;
 * - the featured path as a wide card with a numbered stepper, the total and
 *   "View path" / "Start free step";
 * - every other path as a card with its numbered steps ("format · price"),
 *   coming-soon steps, a pill ("All steps free" / "Step 1 is free") and the
 *   total.
 *
 * A page may split the parts over two sections (chips + featured above a
 * band, the grid below it) with showGoals / showFeatured / showGrid; the
 * section that shows the featured part hosts an opened path.
 *
 * Live data: steps, prices and languages come from each path's product page
 * (the same query PathDetail uses, so opening a path is instant), streams from
 * the folder library, formats from globalSettings.courseFormats. Authored
 * text arrives localized; live names go through siteT; fixed words are
 * coursePlayerB `learningPaths.*` keys.
 */

export interface LearningPathExtra {
  /** The path's product page code. */
  code: string;
  /** Short per-step names for the stepper / rows (by shown position), else the course name. */
  stepLabels?: string[];
  /** 1-based step positions that are ONE course in several languages, e.g. [[1, 2]]. */
  mergeSteps?: number[][];
  /** Steps that have not launched (title, 1-based position, notify form). */
  comingSoon?: ComingSoonStep[];
  /** Goal keys this path belongs to, besides the ones its stream tags match. */
  goalTags?: string[];
}

export interface LearningPathFeaturedOptions {
  /** List mode: "featured" = this layout; absent / "cards" = the path cards, unchanged. */
  listLayout?: "cards" | "featured";
  /** Featured layout: the parts this section shows (each defaults to true). */
  showGoals?: boolean;
  showFeatured?: boolean;
  showGrid?: boolean;
  /** Query parameter holding the picked goal (default "goal"). */
  goalParam?: string;
  /** Label of the first chip (default "All paths"); shown as "All paths · {count}". */
  allGoalsLabel?: string;
  goals?: PathGoal[];
  featured?: {
    /** Product page code of the featured path (default: the first path). */
    code?: string;
    /** Pill on its image ("Most popular path"). */
    badge?: string;
    /** Image instead of the path's own folder image. */
    image?: string;
  };
  pathExtras?: LearningPathExtra[];
  /** Short format names for step rows, by format key ({ ebook: "E-book" }); else the format's own label. */
  formatLabels?: Record<string, string>;
  /** Grid heading (default "More learning paths") and the note on its right. */
  moreTitle?: string;
  moreNote?: string;
  /** Hex colours the site palette has no name for (default: palette / catalogue tokens). */
  outlineColor?: string;
  dividerColor?: string;
  trackColor?: string;
  freeColor?: string;
  /**
   * Opt-in: the id of another learningPath section on the page to read the
   * goals, featured path and path extras from (see withSharedPathOptions), so
   * a page split over two sections keeps one copy.
   */
  sharedWith?: string;
}

/** What a section with `sharedWith` reads from the section it names. */
export const SHARED_PATH_OPTION_KEYS = ["goals", "allGoalsLabel", "goalParam", "featured", "pathExtras"] as const;

type SectionLike = { id?: unknown; type?: unknown; props?: unknown };

const findSection = (sections: unknown, id: string): SectionLike | null => {
  if (!Array.isArray(sections)) return null;
  for (const section of sections as SectionLike[]) {
    if (!section || typeof section !== "object") continue;
    if (section.id === id) return section;
    const slots = (section.props as { slots?: unknown } | null | undefined)?.slots;
    for (const slot of Array.isArray(slots) ? slots : []) {
      const hit = findSection(slot, id);
      if (hit) return hit;
    }
  }
  return null;
};

/**
 * `sharedWith: "<section id>"`: the shared options come from that learningPath
 * section on the page (its values win; a key it lacks stays the section's
 * own). Without `sharedWith`, or when it names no learningPath section, the
 * props are returned unchanged. `localize` puts the source's text in the
 * visitor's language, as the renderer does for every section.
 */
export const withSharedPathOptions = <P extends LearningPathFeaturedOptions>(
  own: P,
  sections: unknown,
  localize: (props: Record<string, unknown>) => Record<string, unknown> = (props) => props,
): P => {
  const id = typeof own.sharedWith === "string" ? own.sharedWith.trim() : "";
  if (!id) return own;
  const source = findSection(sections, id);
  if (!source || source.type !== "learningPath" || !source.props || typeof source.props !== "object") return own;
  const from = localize(source.props as Record<string, unknown>);
  const shared: Record<string, unknown> = {};
  for (const key of SHARED_PATH_OPTION_KEYS) if (from[key] !== undefined) shared[key] = from[key];
  return { ...own, ...shared };
};

interface LearningPathFeaturedProps extends LearningPathFeaturedOptions {
  entries: PathEntry[];
  roots: PublicFolderNode[];
  instituteId: string;
  tagName?: string;
  globalSettings?: Partial<GlobalSettings>;
  /** Goal chips heading ("What do you want to achieve?"). */
  title?: string;
  viewPathLabel?: string;
  backgroundColor?: string;
  sectionRef?: (node: HTMLElement | null) => void;
  onOpenPath: (code: string) => void;
}

// Exact Figma values. Arbitrary values (and colour vars) live only on these lines.
const OUTLINE = "border-[hsl(var(--lp-outline,var(--palette-border-strong,var(--catalogue-border-strong))))]"; // design-lint-ignore: authored outline colour var
const C = {
  goalsHeading: "text-lg font-bold leading-[26px] text-palette-text", // design-lint-ignore: Figma 18/26
  chip: "inline-flex items-center rounded-full border px-[18px] py-2.5 text-sm font-normal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-primary/40", // design-lint-ignore: Figma chip padding 18px
  chipIdle: `${OUTLINE} bg-catalogue-bg-elevated text-palette-text hover:border-palette-primary`,
  featuredCard: "flex flex-col overflow-hidden rounded-[24px] border border-palette-border bg-palette-canvas shadow-[0_8px_28px_0_rgba(26,20,5,0.08)] lg:flex-row", // design-lint-ignore: Figma featured card radius + shadow
  featuredImage: "relative aspect-[16/9] w-full shrink-0 bg-palette-sand lg:aspect-auto lg:w-[400px] lg:self-stretch", // design-lint-ignore: Figma 400px image column
  featuredBody: "flex min-w-0 flex-1 flex-col gap-4 px-5 py-6 md:px-10 md:py-9",
  featuredTitle: "text-2xl font-bold leading-8 text-palette-text md:text-[30px] md:leading-[38px]", // design-lint-ignore: Figma 30/38
  featuredDesc: "text-base leading-[26px] text-palette-body", // design-lint-ignore: Figma 16/26
  pillFeatured: "absolute start-5 top-5 rounded-full bg-palette-primary px-3 py-1.5 text-xs font-bold text-white",
  pillGrid: "absolute start-4 top-4 rounded-full bg-palette-olive px-3 py-[5px] text-xs font-bold text-white", // design-lint-ignore: Figma pill 5px padding
  meta: "min-w-0 flex-1 whitespace-pre-wrap text-[11px] font-bold uppercase leading-4 tracking-[1.1px] text-palette-gold", // design-lint-ignore: Figma 11px meta, 1.1px tracking
  stepCircle: "flex size-8 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold leading-4", // design-lint-ignore: Figma 13px numeral
  stepCircleIdle: `${OUTLINE} bg-catalogue-bg-elevated text-palette-primary`,
  track: "bg-[hsl(var(--lp-track,var(--palette-border-strong,var(--catalogue-border-strong))))]", // design-lint-ignore: authored track colour var
  stepLabel: "text-[13px] font-bold leading-[18px] text-palette-text", // design-lint-ignore: Figma 13/18
  free: "text-[hsl(var(--lp-free,var(--palette-olive,var(--primary-500))))]", // design-lint-ignore: authored free-price colour var
  divider: "bg-[hsl(var(--lp-divider,var(--palette-border,var(--catalogue-border))))]", // design-lint-ignore: authored divider colour var
  rowDivider: "border-t border-[hsl(var(--lp-divider,var(--palette-border,var(--catalogue-border))))]", // design-lint-ignore: authored divider colour var
  featuredTotal: "text-2xl font-bold leading-[30px] text-palette-text", // design-lint-ignore: Figma 24/30
  button: "inline-flex items-center justify-center gap-2 rounded-lg px-7 py-3.5 text-[15px] font-normal leading-[23px] no-underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-primary/40", // design-lint-ignore: Figma 15/23 button
  buttonPrimary: "bg-palette-primary text-white hover:bg-palette-primary/90",
  buttonOutline: `border ${OUTLINE} bg-catalogue-bg-elevated text-palette-text hover:border-palette-primary`,
  gridSection: "pb-12 pt-6 md:pb-[72px]", // design-lint-ignore: Figma 72px band bottom
  gridTitle: "text-[22px] font-bold leading-8 text-palette-text md:text-[26px] md:leading-[34px]", // design-lint-ignore: Figma 26/34
  gridNote: "text-[13px] leading-[18px] text-palette-muted", // design-lint-ignore: Figma 13/18
  card: "flex h-full flex-col overflow-hidden rounded-[20px] border border-palette-border bg-catalogue-bg-elevated shadow-[0_4px_16px_0_rgba(26,20,5,0.06)]", // design-lint-ignore: Figma card radius + shadow
  cardImage: "relative h-[190px] w-full shrink-0 bg-palette-sand", // design-lint-ignore: Figma 190px image
  cardImageSkeleton: "catalogue-skeleton-shimmer h-[190px] w-full shrink-0", // design-lint-ignore: Figma 190px image
  cardBody: "flex flex-1 flex-col gap-3 px-5 pb-6 pt-[22px] md:px-7", // design-lint-ignore: Figma 22px top padding
  cardTitle: "text-[22px] font-bold leading-[29px] text-palette-text", // design-lint-ignore: Figma 22/29
  cardDesc: "text-[15px] leading-6 text-palette-body", // design-lint-ignore: Figma 15/24
  rowNumber: `flex size-6 shrink-0 items-center justify-center rounded-full border ${OUTLINE} bg-palette-cream text-[11px] font-bold leading-[14px] text-palette-primary`, // design-lint-ignore: Figma 11/14 numeral
  rowRight: "max-w-[50%] shrink-0 text-end text-xs", // design-lint-ignore: keep the course name the wider column
  cardTotal: "text-xl font-bold leading-[26px] text-palette-text", // design-lint-ignore: Figma 20/26
  cardButton: `inline-flex shrink-0 items-center gap-2 rounded-lg border ${OUTLINE} bg-catalogue-bg-elevated px-[22px] py-3 text-sm font-normal text-palette-text transition-colors hover:border-palette-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-palette-primary/40`, // design-lint-ignore: Figma 22px button padding
};

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

interface StepRow {
  key: string;
  number: number;
  label: string;
  /** "E-book · ₹251", "Coming soon"… (grid rows). */
  right: string;
  /** The price alone ("Free", "₹551"; "" when hidden), or "Coming soon" (featured stepper). */
  price: string;
  free: boolean;
  soon: boolean;
  audienceId: string | null;
}

interface PathView {
  entry: PathEntry;
  title: string;
  description: string;
  image: string | null;
  streams: CatalogStream[];
  meta: string;
  rows: StepRow[];
  summary: PathTotalSummary;
  pill: PathPill;
  /** Tags the goal chips match against. */
  tags: string[];
  goalTags: string[];
  loading: boolean;
  /** The first free step's course page (for "Start free step"). */
  freeStep: { packageId: string; row: PathMapping; label: string } | null;
}

/** Inline colour vars for the authored colours (only those set). */
export const featuredColorVars = (opts: Pick<LearningPathFeaturedOptions, "outlineColor" | "dividerColor" | "trackColor" | "freeColor">) => {
  const vars: Record<string, string> = {};
  const set = (name: string, raw: unknown) => {
    const channels = hexToHslChannels(raw);
    if (channels) vars[`--lp-${name}`] = channels;
  };
  set("outline", opts.outlineColor);
  set("divider", opts.dividerColor);
  set("track", opts.trackColor);
  set("free", opts.freeColor);
  return vars;
};

const StreamIcon: React.FC<{ stream: CatalogStream; large?: boolean }> = ({ stream, large }) => (
  <span
    aria-hidden="true"
    className={cn(
      "relative inline-flex shrink-0 overflow-hidden rounded-full",
      large ? "size-8" : "size-7",
      !stream.accentColor && "bg-palette-sand",
    )}
    style={stream.accentColor ? { backgroundColor: stream.accentColor } : undefined} // design-lint-ignore: stream accent colour is folder data (validated hex)
  >
    {stream.imageUrl && <img src={stream.imageUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
  </span>
);

const CardImage: React.FC<{ src: string | null; className: string; children?: React.ReactNode }> = ({
  src,
  className,
  children,
}) => (
  <div className={className}>
    {src ? (
      <FitImage src={src} alt="" loading="lazy" className="absolute inset-0 size-full" />
    ) : (
      <div className="absolute inset-0 flex items-center justify-center text-palette-gold">
        <Path className="size-10 opacity-60" weight="duotone" aria-hidden="true" />
      </div>
    )}
    {children}
  </div>
);

const RowsSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div aria-busy="true" className="space-y-3 pt-1">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="catalogue-skeleton-shimmer h-6 w-full rounded-catalogue-xs" />
    ))}
  </div>
);

/**
 * While the library loads: placeholders for the parts this section shows only
 * (a grid-only section does not flash chips and a featured block), on the
 * section's own band colour.
 */
export const LearningPathFeaturedSkeleton: React.FC<
  Pick<LearningPathFeaturedOptions, "showGoals" | "showFeatured" | "showGrid"> & {
    backgroundColor?: string;
    sectionRef?: (node: HTMLElement | null) => void;
  }
> = ({ showGoals = true, showFeatured = true, showGrid = true, backgroundColor, sectionRef }) => {
  if (!showGoals && !showFeatured && !showGrid) return null;
  return (
    <section
      ref={sectionRef}
      data-path-layout="featured"
      className="w-full bg-catalogue-bg"
      // Admin-authored band colour (free-form), as on the loaded section.
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      <div aria-busy="true" className="catalogue-shell space-y-6 py-8">
        {showGoals && (
          <div className="flex flex-wrap gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="catalogue-skeleton-shimmer h-10 w-32 rounded-full" />
            ))}
          </div>
        )}
        {showFeatured && <div className="catalogue-skeleton-shimmer h-72 w-full rounded-catalogue-lg" />}
        {showGrid && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className={C.card}>
                <div className={C.cardImageSkeleton} />
                <div className="space-y-3 p-5 md:px-7">
                  <div className="catalogue-skeleton-shimmer h-6 w-3/4 rounded-catalogue-xs" />
                  <div className="catalogue-skeleton-shimmer h-4 w-full rounded-catalogue-xs" />
                  <RowsSkeleton />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export const LearningPathFeatured: React.FC<LearningPathFeaturedProps> = ({
  entries,
  roots,
  instituteId,
  tagName,
  globalSettings,
  title,
  viewPathLabel,
  backgroundColor,
  sectionRef,
  onOpenPath,
  showGoals = true,
  showFeatured = true,
  showGrid = true,
  goalParam,
  allGoalsLabel,
  goals,
  featured,
  pathExtras,
  formatLabels,
  moreTitle,
  moreNote,
  outlineColor,
  dividerColor,
  trackColor,
  freeColor,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const siteT = useSiteT();
  const { locale } = useCatalogueLocale();
  const { get, update } = useCatalogueSearchParams();
  const { formatOf } = useCourseFormats(globalSettings);
  const hidePrices = shouldHidePaidPurchaseUI();

  const languages: CourseLanguageOption[] = courseLanguagesOf(globalSettings?.courseLanguages);
  const groupVersions = !!globalSettings?.courseLanguages?.enabled;
  const preferred = preferredCourseLanguage(locale, languages);
  const streams = React.useMemo(() => streamsFromFolderTree(roots), [roots]);

  // Same query (and key) as PathDetail: the open path reuses it.
  const results = useQueries({
    queries: entries.map((e) => ({ ...handleGetProductPage(e.code, instituteId) })),
  });

  const extrasByCode = new Map<string, LearningPathExtra>();
  for (const x of Array.isArray(pathExtras) ? pathExtras : []) {
    if (x && typeof x.code === "string" && x.code.trim() && !extrasByCode.has(x.code.trim())) {
      extrasByCode.set(x.code.trim(), x);
    }
  }

  const free = t("learningPaths.free", "Free");
  const priceText = (row: PathMapping): string => {
    const price = variantPrice(row);
    if (price === null) return "";
    if (price === 0) return free;
    return hidePrices ? "" : formatPathPrice(price, row.payment_plan?.currency);
  };
  const formatText = (row: PathMapping): string => {
    const format = formatOf(row);
    if (!format) return "";
    const short = formatLabels && typeof formatLabels[format.key] === "string" ? formatLabels[format.key]!.trim() : "";
    // Through siteT even though authored: some format keys ("animation",
    // "video") are data keys to the props localizer, so it leaves them as is.
    return siteT(short || format.label);
  };

  const views: PathView[] = entries.map((entry, i) => {
    const result = results[i];
    const extra = extrasByCode.get(entry.code);
    const mappings = ((result?.data as { mappings?: PathMapping[] } | undefined)?.mappings || []) as PathMapping[];
    const built = buildPathSteps(mappings, { groupVersions, languages, preferredLanguage: preferred });
    const steps = mergePathSteps(built, extra?.mergeSteps, languages, preferred);
    const items: FeaturedStepItem<PathMapping>[] = withComingSoonSteps(steps, extra?.comingSoon);
    const shown = new Map(steps.map((s) => [s.key, displayVariant(s, languages, preferred)]));
    const labels = Array.isArray(extra?.stepLabels) ? extra!.stepLabels : [];
    const labelAt = (index: number, fallback: string) => {
      const own = typeof labels[index] === "string" ? labels[index]!.trim() : "";
      return own || fallback;
    };

    const rows: StepRow[] = items.map((item) => {
      if (item.kind === "soon") {
        return {
          key: `soon-${item.index}`,
          number: item.index + 1,
          label: labelAt(item.index, item.title),
          right: t("learningPaths.comingSoon", "Coming soon"),
          price: t("learningPaths.comingSoon", "Coming soon"),
          free: false,
          soon: true,
          audienceId: item.audienceId,
        };
      }
      const row = shown.get(item.step.key)!;
      const price = priceText(row);
      return {
        key: item.step.key,
        number: item.index + 1,
        label: labelAt(item.index, siteT(row.package_name)),
        right: [formatText(row), price].filter(Boolean).join(" · "),
        price,
        free: variantPrice(row) === 0,
        soon: false,
        audienceId: null,
      };
    });

    const variants = steps.map((s) => shown.get(s.key)!);
    const allRows = steps.flatMap((s) => s.variants);
    const top = pathTo(roots, entry.node.id)[0];
    const fallback = top ? streams.find((s) => s.id === top.id) ?? null : null;
    const pathStreamList = pathStreams(allRows, streams, fallback);
    const langs = pathLanguages(allRows, languages);
    const comingSoonCount = items.length - steps.length;
    const summary = pathTotalSummary(variants, comingSoonCount);

    const meta = [
      pathStreamList.map((s) => siteT(s.subtitle || s.title)).join(" + "),
      items.length ? t("learningPaths.stepCount", { count: items.length, defaultValue: "{{count}} steps" }) : "",
      langs.map((l) => siteT(l.label)).join(t("learningPaths.languageJoin", " & ")),
    ]
      .filter(Boolean)
      .join("  ·  ");

    const freeItem = items.find(
      (it) => it.kind === "step" && variantPrice(shown.get(it.step.key)!) === 0,
    ) as Extract<FeaturedStepItem<PathMapping>, { kind: "step" }> | undefined;
    const freeRow = freeItem ? shown.get(freeItem.step.key)! : null;

    return {
      entry,
      title: siteT(nodeTitle(entry.node)) || entry.code,
      description: siteT(entry.node.description),
      image: entry.node.image_url || null,
      streams: pathStreamList,
      meta,
      rows,
      summary,
      pill: pathPill(variants.map(variantPrice), items[0]?.kind === "soon"),
      tags: [...new Set([...pathStreamList.flatMap((s) => s.tags), ...allRows.flatMap(mappingTags)])],
      goalTags: Array.isArray(extra?.goalTags) ? extra!.goalTags.filter((g): g is string => typeof g === "string") : [],
      loading: !!result?.isLoading,
      freeStep:
        freeRow && typeof freeRow.package_id === "string" && freeRow.package_id
          ? {
              packageId: freeRow.package_id,
              row: freeRow,
              label: rows[freeItem!.index]?.label || siteT(freeRow.package_name),
            }
          : null,
    };
  });

  // ─── goal chips ───────────────────────────────────────────────────────────
  const goalKey = (goalParam || "").trim() || URL_PARAMS.goal;
  const wanted = (get(goalKey) || "").toLowerCase();
  const goalList = (Array.isArray(goals) ? goals : []).filter(
    (g): g is PathGoal => !!g && typeof g.key === "string" && !!g.key.trim() && typeof g.label === "string" && !!g.label.trim(),
  );
  // A path's tags are known once its product page loads: until every page has,
  // keep all authored chips (and the ?goal= pick) so the row does not jump.
  const pagesLoading = views.some((v) => v.loading);
  const shownGoals = pagesLoading ? goalList : goalList.filter((g) => views.some((v) => goalMatchesPath(g, v)));
  const activeGoal = wanted ? shownGoals.find((g) => g.key.trim().toLowerCase() === wanted) ?? null : null;
  const matching = activeGoal ? views.filter((v) => goalMatchesPath(activeGoal, v)) : views;

  const featuredEntry = pickFeaturedEntry(entries, featured?.code);
  const featuredView = showFeatured ? matching.find((v) => v.entry === featuredEntry) ?? null : null;
  const gridViews = showGrid ? matching.filter((v) => v.entry !== featuredEntry) : [];

  const selectGoal = (key: string | null) => update({ [goalKey]: key });

  const viewLabel = viewPathLabel || t("learningPaths.viewPath", "View path");
  const countWord = (n: number) =>
    n >= 1 && n <= NUMBER_WORDS.length ? t(`learningPaths.number${n}`, NUMBER_WORDS[n - 1]!) : String(n);

  const totalTexts = (view: PathView, inFeatured: boolean): { amount: string; note: string } | null => {
    const { summary } = view;
    if (view.loading || summary.total === null || !view.rows.length) return null;
    if (summary.note === "allFree") {
      return { amount: free, note: t("learningPaths.totalAllFree", "Every step is free") };
    }
    if (hidePrices && summary.total > 0) return null;
    const amount = summary.total === 0 ? free : formatPathPrice(summary.total, summary.currency);
    if (summary.note === "available") {
      return { amount, note: t("learningPaths.totalAvailable", "Total of available steps") };
    }
    let note = inFeatured
      ? t("learningPaths.totalAllFeatured", {
          count: summary.count,
          countWord: countWord(summary.count),
          defaultValue: "Total of all {{countWord}} steps, bought individually.",
        })
      : t("learningPaths.totalAll", {
          count: summary.count,
          countWord: countWord(summary.count),
          defaultValue: "Total of all {{countWord}} steps",
        });
    if (inFeatured && summary.freeSteps.length === 1 && view.freeStep) {
      note += ` ${t("learningPaths.stepIsFree", { step: view.freeStep.label, defaultValue: "{{step}} is free." })}`;
    }
    return { amount, note };
  };

  const freeStepLink = (view: PathView, className: string) => {
    const step = view.freeStep;
    if (!step || !tagName) return null;
    const row = step.row;
    return (
      <Link
        to="/$tagName/$courseId"
        params={{ tagName, courseId: step.packageId }}
        search={{
          enrollInviteId: row.enroll_invite_id || undefined,
          packageSessionId: row.package_session_id,
          productPageCode: view.entry.code,
          bannerImage: undefined,
          level: row.level_name || undefined,
          price: row.payment_plan?.actual_price?.toString(),
          available_slots: undefined,
        }}
        className={className}
      >
        {t("learningPaths.startFreeStep", "Start free step")}
      </Link>
    );
  };

  const metaRow = (view: PathView, large: boolean) =>
    view.streams.length || view.meta ? (
      <div className={cn("flex w-full items-center", large ? "gap-2.5" : "gap-1.5")}>
        {view.streams.map((s) => (
          <StreamIcon key={s.id} stream={s} large={large} />
        ))}
        {view.meta && <p className={cn(C.meta, !large && view.streams.length > 0 && "ps-1.5")}>{view.meta}</p>}
      </div>
    ) : null;

  const notify = (row: StepRow) => {
    if (!row.audienceId) return;
    window.dispatchEvent(
      new CustomEvent("openAudienceForm", { detail: { audienceId: row.audienceId, title: row.label } }),
    );
  };

  // ─── featured card ────────────────────────────────────────────────────────
  const featuredCard = (view: PathView) => {
    const totals = totalTexts(view, true);
    const start = freeStepLink(view, cn(C.button, C.buttonPrimary));
    const badge = (featured?.badge || "").trim();
    const image = (featured?.image || "").trim() || view.image;
    return (
      <article aria-label={t("learningPaths.featuredAria", "Featured learning path")} className={C.featuredCard}>
        <CardImage src={image} className={C.featuredImage}>
          {badge && <span className={C.pillFeatured}>{badge}</span>}
        </CardImage>
        <div className={C.featuredBody}>
          {metaRow(view, true)}
          <h3 className={C.featuredTitle}>{view.title}</h3>
          {view.description && <p className={C.featuredDesc}>{view.description}</p>}
          {view.loading ? (
            <RowsSkeleton count={2} />
          ) : view.rows.length > 0 ? (
            <ol
              aria-label={t("learningPath.stepsAria", { title: view.title, defaultValue: "Steps in {{title}}" })}
              className="flex w-full flex-col pt-2 md:flex-row"
            >
              {view.rows.map((row, i) => {
                const last = i === view.rows.length - 1;
                return (
                  <li key={row.key} className="flex min-w-0 gap-3 md:flex-1 md:flex-col md:gap-2">
                    <div className="flex shrink-0 flex-col items-center md:w-full md:flex-row">
                      <span
                        aria-hidden="true"
                        className={cn(
                          C.stepCircle,
                          // Figma 73:472: the free step is the filled one.
                          row.free ? "border-palette-olive bg-palette-olive text-white" : C.stepCircleIdle,
                        )}
                      >
                        {row.number}
                      </span>
                      {!last && (
                        <span aria-hidden="true" className={cn("my-0.5 w-0.5 flex-1 md:my-0 md:h-0.5 md:w-auto", C.track)} />
                      )}
                    </div>
                    <div
                      className={cn(
                        "flex min-w-0 flex-1 items-baseline justify-between gap-3 pt-1.5 md:flex-none md:flex-col md:items-start md:justify-start md:gap-2 md:pe-3 md:pt-0",
                        !last && "pb-6 md:pb-0",
                      )}
                    >
                      <span className="sr-only">
                        {t("learningPath.stepLabel", { number: row.number, defaultValue: "Step {{number}}" })}
                      </span>
                      {row.soon && row.audienceId ? (
                        <button
                          type="button"
                          onClick={() => notify(row)}
                          aria-label={t("learningPaths.notifyAria", { title: row.label, defaultValue: "Notify me when {{title}} launches" })}
                          className={cn(C.stepLabel, "text-start text-palette-muted2 hover:underline")}
                        >
                          {row.label}
                        </button>
                      ) : (
                        <span className={cn(C.stepLabel, row.soon && "text-palette-muted2")}>{row.label}</span>
                      )}
                      {row.price && (
                        <span className={cn("shrink-0 text-xs", row.free ? cn("font-bold", C.free) : "text-palette-muted")}>
                          {row.price}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
          <div aria-hidden="true" className={cn("h-px w-full", C.divider)} />
          <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              {totals && (
                <>
                  <p className={C.featuredTotal}>{totals.amount}</p>
                  <p className="text-xs text-palette-muted">{totals.note}</p>
                </>
              )}
            </div>
            <div className={cn("grid gap-3 md:flex md:shrink-0", start ? "grid-cols-2" : "grid-cols-1")}>
              <button
                type="button"
                onClick={() => onOpenPath(view.entry.code)}
                aria-label={`${viewLabel} — ${view.title}`}
                className={cn(C.button, start ? C.buttonOutline : C.buttonPrimary)}
              >
                {viewLabel}
              </button>
              {start}
            </div>
          </div>
        </div>
      </article>
    );
  };

  // ─── grid card ────────────────────────────────────────────────────────────
  const gridCard = (view: PathView) => {
    const totals = totalTexts(view, false);
    const pill =
      view.pill === "allFree"
        ? t("learningPaths.allStepsFree", "All steps free")
        : view.pill === "firstFree"
          ? t("learningPaths.firstStepFree", "Step 1 is free")
          : "";
    return (
      <li key={view.entry.code} className="min-w-0">
        <article className={C.card}>
          <CardImage src={view.image} className={C.cardImage}>
            {pill && <span className={C.pillGrid}>{pill}</span>}
          </CardImage>
          <div className={C.cardBody}>
            {metaRow(view, false)}
            <h3 className={C.cardTitle}>{view.title}</h3>
            {view.description && <p className={C.cardDesc}>{view.description}</p>}
            {view.loading ? (
              <RowsSkeleton />
            ) : view.rows.length > 0 ? (
              <ol
                aria-label={t("learningPath.stepsAria", { title: view.title, defaultValue: "Steps in {{title}}" })}
                className="flex w-full flex-col pt-1"
              >
                {view.rows.map((row, i) => {
                  const name = <span className={cn("min-w-0 flex-1 text-sm font-bold", row.soon ? "text-palette-muted2" : "text-palette-text")}>{row.label}</span>;
                  return (
                    <li key={row.key} className={cn("flex items-center gap-3 py-2", i > 0 && C.rowDivider)}>
                      <span aria-hidden="true" className={C.rowNumber}>
                        {row.number}
                      </span>
                      <span className="sr-only">
                        {t("learningPath.stepLabel", { number: row.number, defaultValue: "Step {{number}}" })}
                      </span>
                      {row.soon && row.audienceId ? (
                        <button
                          type="button"
                          onClick={() => notify(row)}
                          aria-label={t("learningPaths.notifyAria", { title: row.label, defaultValue: "Notify me when {{title}} launches" })}
                          className="flex min-w-0 flex-1 items-center gap-3 text-start hover:underline"
                        >
                          {name}
                        </button>
                      ) : (
                        name
                      )}
                      {row.right && (
                        <span className={cn(C.rowRight, row.free ? C.free : "text-palette-muted")}>{row.right}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <div aria-hidden="true" className="flex-1" />
            <div aria-hidden="true" className={cn("h-px w-full", C.divider)} />
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                {totals && (
                  <>
                    <p className={C.cardTotal}>{totals.amount}</p>
                    <p className="text-xs text-palette-muted">{totals.note}</p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenPath(view.entry.code)}
                aria-label={`${viewLabel} — ${view.title}`}
                className={C.cardButton}
              >
                {viewLabel}
                <ArrowRight className="size-3.5 rtl:rotate-180" weight="bold" aria-hidden="true" />
              </button>
            </div>
          </div>
        </article>
      </li>
    );
  };

  const goalsBlock = showGoals ? (
    <div className={cn("flex flex-col gap-3.5 pt-8", featuredView ? "pb-2" : "pb-10")}>
      {title && <h2 className={C.goalsHeading}>{title}</h2>}
      <div role="group" aria-label={title || t("learningPaths.goalsAria", "Filter learning paths by goal")} className="flex flex-wrap gap-2.5">
        <button
          type="button"
          aria-pressed={!activeGoal}
          onClick={() => selectGoal(null)}
          className={cn(C.chip, !activeGoal ? "border-palette-primary bg-palette-primary text-white" : C.chipIdle)}
        >
          {t("learningPaths.chipCount", {
            label: allGoalsLabel || t("learningPaths.allPaths", "All paths"),
            count: views.length,
            defaultValue: "{{label}} · {{count}}",
          })}
        </button>
        {shownGoals.map((g) => {
          const active = g === activeGoal;
          return (
            <button
              key={g.key}
              type="button"
              aria-pressed={active}
              onClick={() => selectGoal(active ? null : g.key.trim())}
              className={cn(C.chip, active ? "border-palette-primary bg-palette-primary text-white" : C.chipIdle)}
            >
              {g.label}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  const gridBlock =
    gridViews.length > 0 ? (
      <div className={cn("flex flex-col gap-6", C.gridSection)}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <h2 className={C.gridTitle}>{moreTitle || t("learningPaths.moreTitle", "More learning paths")}</h2>
          {moreNote && <p className={C.gridNote}>{moreNote}</p>}
        </div>
        <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2">{gridViews.map(gridCard)}</ul>
      </div>
    ) : null;

  if (!goalsBlock && !featuredView && !gridBlock) return null;

  const sectionStyle = {
    // Admin-authored band colour (free-form) and the authored colour vars.
    ...(backgroundColor ? { backgroundColor } : {}),
    ...featuredColorVars({ outlineColor, dividerColor, trackColor, freeColor }),
  } as React.CSSProperties;

  return (
    <section ref={sectionRef} data-path-layout="featured" className="w-full bg-catalogue-bg" style={sectionStyle}>
      <div className="catalogue-shell">
        {goalsBlock}
        {featuredView && <div className={cn("pb-10 md:pb-14", showGoals ? "pt-8" : "pt-10")}>{featuredCard(featuredView)}</div>}
        {gridBlock}
      </div>
    </section>
  );
};

export default LearningPathFeatured;
