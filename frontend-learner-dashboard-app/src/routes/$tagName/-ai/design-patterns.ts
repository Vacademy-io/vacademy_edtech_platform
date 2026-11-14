/**
 * Design-pattern registry: the ONE description of the opt-in catalogue widgets
 * that every AI surface reads (MCP website(schema / patterns), the in-product
 * composer, review rules, the admin template library).
 *
 * Why it lives here: the learner renderer's types are the authority on what a
 * prop means. Every `minimal` example is typed against those props, so `tsc`
 * fails when a prop is renamed, and the drift tests next to this file fail
 * when a new variant literal has no entry or a `fullFrom` pointer stops
 * resolving in the Brahm Varchas fixture.
 *
 * Nothing renders from this file. It is data plus two pure helpers
 * (`fullExampleOf`, `scrubExample`) that the exporter
 * (scripts/export-catalogue-schema-catalog.mjs) uses to write
 * ai_service/app/data/catalogue_schema_catalog.json and the admin copy
 * frontend-admin-dashboard/src/routes/manage-pages/-utils/generated/design-patterns.json.
 * Regenerate both after editing: node scripts/export-catalogue-schema-catalog.mjs
 *
 * Conventions
 *  - `minimal` is rooted where the pattern is written: a section's `props`,
 *    `globalSettings.layout.header.props` / `.footer.props` for chrome, and
 *    `globalSettings` for site settings. `propPath` says where that is.
 *  - Text in angle brackets ("<libraryId …>") is a placeholder the AI must
 *    replace with a real value; it is never valid as-is.
 *  - `bound` lists the paths (relative to the same root) that hold ids of
 *    institute records. Syntax: "a.b", "a[].b" (each item), "a[]" (an array of
 *    ids), "a{}" (an object keyed by ids). The exporter replaces them with
 *    placeholders in the `full` example so one institute's ids never reach
 *    another institute's site.
 *  - Hex colours are given only through the fixture (`fullFrom`), never as
 *    literals here, so the design-lint raw-hex rule holds.
 */
import type {
  CourseCatalogProps,
  FooterProps,
  GlobalSettings,
  HeaderSectionProps,
} from "../-types/course-catalogue-types";
import type {
  CtaBannerBandProps,
  FooterBrandProps,
  HeaderChromeProps,
  StepsCardsProps,
} from "../-types/site-chrome-types";
import type { HeroEditorialProps } from "../-components/components/HeroEditorial";
import type { LearningPathProps } from "../-components/components/LearningPathComponent";
import { PALETTE_KEYS } from "../-utils/catalogue-palette";

/* ── types ──────────────────────────────────────────────────────────────── */

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Renderer-supplied learningPath props: never authored. */
type LearningPathRuntimeKeys = "instituteId" | "tagName" | "globalSettings" | "isPreviewMode" | "pageSections";

/** What a pattern's `minimal` is typed against, per component. */
export interface PatternMinimalByComponent {
  courseCatalog: DeepPartial<CourseCatalogProps>;
  heroSection: DeepPartial<HeroEditorialProps> & { variant?: "default" | "editorial"; layout?: "split" | "centered" };
  learningPath: DeepPartial<Omit<LearningPathProps, LearningPathRuntimeKeys>>;
  ctaBanner: DeepPartial<CtaBannerBandProps> & { layout?: "centered" | "split" };
  stepsProcess: DeepPartial<StepsCardsProps>;
  header: DeepPartial<HeaderSectionProps & HeaderChromeProps>;
  footer: DeepPartial<FooterProps & FooterBrandProps>;
  globalSettings: DeepPartial<GlobalSettings>;
}

export type PatternComponent = keyof PatternMinimalByComponent;

export type PatternRequirementKind =
  | "folderLibrary"
  | "courseTags"
  | "productPage"
  | "campaign"
  | "courseFormats"
  | "courseLanguages"
  | "i18n"
  | "asset";

export interface PatternRequirement {
  kind: PatternRequirementKind;
  detail: string;
}

/** How the review rules should count a section built from this pattern. */
export type PatternReviewRole = "hero" | "proof" | "content" | "styledBand" | "cta" | "form";

/** Which of the pattern's strings the site dictionary translates (catalogue-i18n.ts rules). */
export type PatternI18n = "translatable" | "opaque" | "mixed";

export interface PatternFullFrom {
  fixture: "brahm-varchas-site";
  /** JSON pointer to the pattern's root (same root as `minimal`) in the fixture. */
  pointer: string;
  /**
   * Relative pointers under `pointer` that make up the pattern ("hero/quickFilterBar",
   * "columnSections/1"). Absent = the whole value at `pointer`.
   */
  pick?: string[];
}

interface DesignPatternBase<C extends PatternComponent> {
  /** Stable id: 'catalog.hero', 'cta.band', 'footer.brand', 'global.palette'… */
  id: string;
  /** Short name an admin reads (editor variant switcher, template library, MCP index): 'Catalogue hero'. */
  label: string;
  component: C;
  /** Where `minimal` is written: 'props.hero', 'globalSettings.layout.header.props', 'globalSettings.theme.palette'. */
  propPath: string;
  /** What it looks like, so an AI can match it against a frame or screenshot. */
  looksLike: string;
  /** Concrete visual signals in a Figma frame (layer shapes, counts, sizes, text patterns). */
  figmaCues: string[];
  useWhen: string;
  avoidWhen: string;
  /** Data that must exist before the pattern can show anything. */
  requires: PatternRequirement[];
  /** Paths (relative to `minimal`'s root) that hold institute record ids. */
  bound: string[];
  i18n: PatternI18n;
  reviewAs: PatternReviewRole[];
  pitfalls: string[];
  minimal: PatternMinimalByComponent[C];
  fullFrom?: PatternFullFrom;
}

export type DesignPattern = { [C in PatternComponent]: DesignPatternBase<C> }[PatternComponent];

/** Typed constructor: `minimal` is checked against the component named in `component`. */
const pattern = <C extends PatternComponent>(p: DesignPatternBase<C>): DesignPattern => p as DesignPattern;

export interface DesignRecipeSection {
  component: PatternComponent;
  /** Pattern ids combined in this one section (several opt-ins share one courseCatalog). */
  patterns: string[];
  note?: string;
  /** Section props beyond its patterns' minimal JSON (e.g. the featured path section hides its own grid). */
  props?: Record<string, unknown>;
}

export interface DesignRecipe {
  id: string;
  name: string;
  description: string;
  /** Pages in order, each with its sections top to bottom. */
  pages: Array<{ route: string; title: string; sections: DesignRecipeSection[] }>;
  /** Site settings and chrome patterns the recipe needs (header / footer / globalSettings). */
  site: string[];
}

/* ── placeholders ──────────────────────────────────────────────────────── */

// Ids of institute records are never written by an AI: page / layout writes do
// not check them. Each id placeholder says so, and who fills it instead.
const LIBRARY = "<libraryId: leave empty — the admin picks a folder library (Manage Pages → Folders) in the editor>";
const CAMPAIGN = "<audienceId: leave empty — wire it with website_edit(link_lead_form), or the admin picks an ACTIVE campaign in the editor>";
const PRODUCT_PAGE = "<productPageCode: leave empty — the admin picks a product page in the editor>";
const COURSE = "<course id: leave empty — the admin picks the course in the editor>";
const MEDIA = "<image url from website(list_media) or website_edit(import_image)>";
/** Absolute links of the fixture's institute (its own pages, policies, social profiles). */
const LINK = "<link: a route of this site (e.g. /courses) or this institute's own https url>";
const BRAND_NAME = "<institute name>";
const TAGLINE = "<the institute's tagline>";

/* ── the registry ──────────────────────────────────────────────────────── */

const CATALOG_FIXTURE_ROOT = "/pages/1/components/0/props";

export const DESIGN_PATTERNS: DesignPattern[] = [
  /* ── courseCatalog ───────────────────────────────────────────────────── */
  pattern({
    id: "catalog.hero",
    label: "Catalogue hero",
    component: "courseCatalog",
    propPath: "props.hero",
    looksLike:
      "A full-bleed cream band above the course grid: breadcrumb trail, a large H1, a one-line lead, 2-3 big live numbers with small labels on the right, a wide search box with a solid button, then a row of rounded 'Popular:' shortcut chips.",
    figmaCues: [
      "full-width band directly above stream tabs or the grid, 200-320px tall, tinted (cream/sand) fill",
      "breadcrumb text 'Home / Courses' over a 40-48px heading",
      "2-3 large numerals each with a small caption ('24 courses & resources')",
      "a 56-64px tall input with a filled button on its right",
      "a 'Popular:' label followed by 4-8 pill chips",
    ],
    useWhen: "A course listing page opens with a search-led band. Numbers shown are courses, streams or categories.",
    avoidWhen:
      "The design shows a marketing hero (image, CTA buttons) — use heroSection. Never add a separate heroSection above a catalogue that has this band: it duplicates the H1 and the search.",
    requires: [{ kind: "folderLibrary", detail: "stats of kind 'streams'/'categories' and chips with streamSlug need streams.source 'folderLibrary'" }],
    bound: [],
    i18n: "mixed",
    reviewAs: ["hero", "proof"],
    pitfalls: [
      "Stats are LIVE (kind: courses | streams | categories). Never author the numbers from the design; the label is the only text.",
      "The breadcrumb is hidden on the site's home route; on other routes the last item is the current page and is never a link.",
      "Popular chips act by precedence: searchValue > streamSlug (+categorySlug) > quickFilterId > route. streamSlug/categorySlug are folder slugs, not names.",
      "At most 3 stats and 8 chips are shown.",
    ],
    minimal: {
      hero: {
        enabled: true,
        title: "All courses",
        lead: "<one line about the catalogue, from the design>",
        stats: [{ kind: "courses", label: "courses & resources" }],
        search: { enabled: true },
      },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["hero/enabled", "hero/breadcrumb", "hero/title", "hero/lead", "hero/stats", "hero/search", "hero/popular"] },
  }),
  pattern({
    id: "catalog.resultsHeader",
    label: "Results header",
    component: "courseCatalog",
    propPath: "props.hero.resultsHeader",
    looksLike: "A thin row above the results: 'Showing 22 courses', a chip with the current stream, and a boxed 'Sort: Most popular' select on the right.",
    figmaCues: ["text 'Showing N courses' left-aligned above the first card row", "a bordered select reading 'Sort: …' on the same row"],
    useWhen: "The design shows a result count and a sort box above the grid instead of a toolbar card.",
    avoidWhen: "The design keeps the original search + sort toolbar card.",
    requires: [],
    bound: [],
    i18n: "translatable",
    reviewAs: ["content"],
    pitfalls: ["It also appears automatically whenever hero.search is on, so the page keeps exactly one search box."],
    minimal: { hero: { resultsHeader: { enabled: true } } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["hero/resultsHeader"] },
  }),
  pattern({
    id: "catalog.quickFilters",
    label: "Quick filters",
    component: "courseCatalog",
    propPath: "props.quickFilters + props.hero.quickFilterBar",
    looksLike: "A 'Quick filters:' label followed by small filled chips (Popular, New, Free, Bestseller, Hindi, Under ₹1000).",
    figmaCues: ["a row of 4-6 small chips (12px bold text) preceded by a label ending in ':'", "the active chip is solid filled"],
    useWhen: "The design shows one-tap shortcut chips above the grid.",
    avoidWhen: "The chips are navigation to other pages — use hero.popular or links.",
    requires: [{ kind: "courseLanguages", detail: "kind 'language' needs globalSettings.courseLanguages.enabled" }],
    bound: [],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: [
      "Leave label '' to get the built-in translated label for the kind.",
      "kind 'language' takes value = a courseLanguages code ('hi'); kind 'priceMax' takes a number.",
    ],
    minimal: {
      quickFilters: [
        { id: "qf-popular", label: "", kind: "popular" },
        { id: "qf-new", label: "", kind: "new" },
        { id: "qf-free", label: "", kind: "free" },
        { id: "qf-bestseller", label: "", kind: "bestseller" },
        { id: "qf-hindi", label: "", kind: "language", value: "hi" },
        { id: "qf-under-1000", label: "", kind: "priceMax", value: 1000 },
      ],
      hero: { quickFilterBar: { label: "Quick filters:", variant: "filled" } },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["quickFilters", "hero/quickFilterBar"] },
  }),
  pattern({
    id: "catalog.streams.icons",
    label: "Stream icon tabs",
    component: "courseCatalog",
    propPath: "props.streams",
    looksLike:
      "A full-width row of equal tabs, each a 40px round image over the stream's native name and an 'English · 12' line, with an accent underline under the active tab.",
    figmaCues: [
      "6-8 equal-width columns in one row, each with a 40-72px circle image and two text lines",
      "a second line in a smaller muted style with a middle dot and a number",
      "a 2-3px underline under one tab",
    ],
    useWhen: "Courses are grouped into streams that the design shows as icon tabs.",
    avoidWhen: "The tabs are plain rounded pills (catalog.streams.pills) or there is no folder library to back them.",
    requires: [{ kind: "folderLibrary", detail: "a library whose top-level folders (streams) have an image, a title and a subtitle, and whose course_tag matches course tags" }],
    bound: ["streams.libraryId"],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: [
      "Counts are live catalogue totals per stream (they ignore other filters). Never author them.",
      "The icon band is not sticky unless sticky:true is set (pills default to sticky).",
      "labelMode 'both' shows title + subtitle; use it for bilingual stream names.",
    ],
    minimal: { streams: { enabled: true, source: "folderLibrary", libraryId: LIBRARY, variant: "icons", showCounts: true } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["streams"] },
  }),
  pattern({
    id: "catalog.streams.pills",
    label: "Stream pill tabs",
    component: "courseCatalog",
    propPath: "props.streams",
    looksLike: "A row of rounded pill tabs above the grid ('All courses', 'Science', 'Arts'…), sticky under the header.",
    figmaCues: ["3-10 rounded-full chips in one scrollable row above the grid", "one chip filled with the brand colour"],
    useWhen: "The design groups courses by subject with simple pill tabs.",
    avoidWhen: "The tabs carry round images and counts (catalog.streams.icons).",
    requires: [{ kind: "courseTags", detail: "source 'tags': each item filters by one course tag; source 'folderLibrary' needs a library instead" }],
    bound: [],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: ["items[].tag must be a tag the courses already carry; slug is the ?stream= URL value."],
    minimal: {
      streams: {
        enabled: true,
        source: "tags",
        variant: "pills",
        items: [{ label: "<tab label>", slug: "<url-slug>", tag: "<existing course tag>" }],
      },
    },
  }),
  pattern({
    id: "catalog.filterSidebar.editorial",
    label: "Editorial filter sidebar",
    component: "courseCatalog",
    propPath: "props.filterSidebar + priceFilter + categoryFilter + languageFilter",
    looksLike:
      "One 280px card titled 'Filters' with 'Clear all', uppercase group labels (PRICE / LANGUAGE / FORMAT / CATEGORY / FOR) with −/+ toggles, square checkboxes, greyed zero-count rows and '+ Show all N'.",
    figmaCues: [
      "a left column 260-300px wide beside the grid, one bordered card",
      "uppercase 11-12px group labels each followed by 2-8 checkbox rows",
      "a '+ Show all 12 categories' text link",
    ],
    useWhen: "The design shows a checkbox filter card left of the results.",
    avoidWhen: "The design has no sidebar (set showFilters false) or uses dropdown filters.",
    requires: [
      { kind: "folderLibrary", detail: "the category group lists the streams' sub-folders" },
      { kind: "courseLanguages", detail: "the language group needs globalSettings.courseLanguages.enabled" },
    ],
    bound: [],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: [
      "order[] takes 'price', 'language', 'category' and customFilters ids; unlisted groups follow.",
      "priceFilter.control 'checkbox' = Free / Paid checkboxes with no 'Any price' row.",
      "Colour props take hex; the palette fills everything else.",
    ],
    minimal: {
      showFilters: true,
      filterSidebar: { variant: "editorial", order: ["price", "language", "category"] },
      priceFilter: { enabled: true, control: "checkbox" },
      languageFilter: { enabled: true },
      categoryFilter: { enabled: true, scope: "all", labelMode: "both", sort: "count", hideComingSoon: true, visibleCount: 6 },
    },
    fullFrom: {
      fixture: "brahm-varchas-site",
      pointer: CATALOG_FIXTURE_ROOT,
      pick: ["showFilters", "filterSidebar/variant", "filterSidebar/width", "filterSidebar/sticky", "filterSidebar/collapsible", "filterSidebar/order", "filterSidebar/dividerColor", "filterSidebar/checkboxColor", "filterSidebar/checkboxSoftColor", "priceFilter", "languageFilter", "categoryFilter"],
    },
  }),
  pattern({
    id: "catalog.filterSidebar.promo",
    label: "Sidebar promo card",
    component: "courseCatalog",
    propPath: "props.filterSidebar.promo",
    looksLike: "A dark card under the filter card: small coloured eyebrow, a bold title, one line of text, a button, and a phone mock-up showing an app screen.",
    figmaCues: ["a dark-filled rounded card in the left column below the filters", "a phone outline with a screenshot inside", "an eyebrow in an accent colour"],
    useWhen: "The design promotes an app or offer under the filters.",
    avoidWhen: "There is no editorial sidebar (the promo renders only inside it).",
    requires: [{ kind: "asset", detail: "screenImage (the picture inside the drawn phone) or image (a ready illustration)" }],
    bound: [],
    i18n: "mixed",
    reviewAs: ["cta"],
    pitfalls: ["enabled must be true; button.target is a site route or an https URL."],
    minimal: {
      filterSidebar: {
        variant: "editorial",
        promo: { enabled: true, eyebrow: "<app name>", title: "<promo title>", button: { text: "Get the app", target: "/login" }, screenImage: MEDIA },
      },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["filterSidebar/variant", "filterSidebar/promo"] },
  }),
  pattern({
    id: "catalog.customFilters",
    label: "Custom filters",
    component: "courseCatalog",
    propPath: "props.customFilters",
    looksLike: "Extra checkbox groups such as FORMAT (E-books, Live sessions…) and FOR (Parents, Students…) inside the filter sidebar.",
    figmaCues: ["filter groups whose options are not price, language or category", "options that read like audiences or media types"],
    useWhen: "The design filters by format or audience.",
    avoidWhen: "The options are not backed by course tags or level names yet — tag the courses first.",
    requires: [
      { kind: "courseFormats", detail: "source 'courseFormats' lists globalSettings.courseFormats" },
      { kind: "courseTags", detail: "authored options match course tags (e.g. for-parents) or level names" },
      { kind: "courseTags", detail: "source 'tags' also lists every course tag starting with its prefix (\"for parents\" → Parents)" },
    ],
    bound: [],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: [
      "Each group id is also its ?<id>= URL parameter; option ids are slugs.",
      "An option no course has is not listed; one that is 0 only under other filters stays, greyed, unless showEmpty is false.",
      "A source 'tags' group needs a prefix; with none it is an authored group.",
    ],
    minimal: {
      customFilters: [
        { id: "format", label: "Format", source: "courseFormats" },
        { id: "for", label: "For", source: "options", options: [{ id: "parents", label: "Parents", tags: ["for-parents"] }] },
        { id: "audience", label: "Audience", source: "tags", prefix: "for", exclude: ["everyone"] },
      ],
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["customFilters"] },
  }),
  pattern({
    id: "catalog.cards.editorial",
    label: "Editorial course cards",
    component: "courseCatalog",
    propPath: "props.render.cardStyle + props.render.card",
    looksLike:
      "Course cards with a format pill and a 'Free' pill on the image, a small round stream icon and stream line, the title, a short description, EN/हिं chips, then a hairline and the price with a 'View course →' text link. No buttons.",
    figmaCues: ["cards with no filled button, only a text link ending in an arrow", "a small pill over the top-left of the card image", "a 16-20px round icon beside a muted stream name"],
    useWhen: "The design's course card is text-led with pills and a text link.",
    avoidWhen: "The design shows add-to-cart buttons on each card (default card).",
    requires: [{ kind: "courseFormats", detail: "the format pill comes from globalSettings.courseFormats" }],
    bound: ["render.card.descriptions{}"],
    i18n: "opaque",
    reviewAs: ["content"],
    pitfalls: [
      "render is opaque to the props translator: text here is base language and shown through the site dictionary.",
      "descriptions is keyed by course (package) id; only for courses whose own description is unsuitable.",
      "freeCtaByFormat maps a format key to start | watch | read | listen.",
    ],
    minimal: { render: { cardStyle: "editorial", card: { streamLabel: "subtitle" } } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["render/cardStyle", "render/card"] },
  }),
  pattern({
    id: "catalog.pagination.loadMore",
    label: "Load more",
    component: "courseCatalog",
    propPath: "props.render.pagination + props.render.gridHeading",
    looksLike: "An 'All courses · Sorted by most popular' heading over the grid and a centred 'Load more courses' button with 'Showing 9 of 24' under it.",
    figmaCues: ["a single outlined button centred under the grid", "small text 'Showing N of M'", "a heading with a muted 'Sorted by…' note"],
    useWhen: "The design pages the grid with a Load more button.",
    avoidWhen: "The design shows numbered pages (the default).",
    requires: [],
    bound: [],
    i18n: "opaque",
    reviewAs: ["content"],
    pitfalls: ["pageSize is clamped 1..60 (default 9)."],
    minimal: { render: { pagination: { mode: "loadMore", pageSize: 9 }, gridHeading: { showSort: true } } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["render/pagination", "render/gridHeading"] },
  }),
  pattern({
    id: "catalog.languageVersions",
    label: "Language versions",
    component: "courseCatalog",
    propPath: "props.groupLanguageVersions + props.languageFilter",
    looksLike: "One card per course with EN / हिं chips instead of one card per language version.",
    figmaCues: ["two small language chips on each card ('EN', 'हिं')", "a LANGUAGE filter group"],
    useWhen: "Courses exist in several languages and the design shows them as one card.",
    avoidWhen: "The site has a single language of courses.",
    requires: [{ kind: "courseLanguages", detail: "globalSettings.courseLanguages (global.courseLanguages), plus versionGroups for separate packages" }],
    bound: [],
    i18n: "opaque",
    reviewAs: ["content"],
    pitfalls: ["Nothing groups unless globalSettings.courseLanguages.enabled is true."],
    minimal: { groupLanguageVersions: true, languageFilter: { enabled: true, label: "Language" } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["groupLanguageVersions", "languageFilter"] },
  }),
  pattern({
    id: "catalog.sections.freeCourses",
    label: "Start-free row",
    component: "courseCatalog",
    propPath: "props.columnSections[kind=free-courses]",
    looksLike: "Inside the results column, before the grid: 'New here? Start free' with 3 free course cards and 'See all N free →'.",
    figmaCues: ["a heading + subtitle and a row of 3 cards inside the results column, above the main grid", "a 'See all … free' link"],
    useWhen: "The design highlights free courses inside the catalogue.",
    avoidWhen: "The free courses belong on another page (use courseShowcase there).",
    requires: [{ kind: "courseTags", detail: "free courses (price 0) must exist; courseIds pins the order" }],
    bound: ["columnSections[].courseIds[]"],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: ["showWhen 'unfiltered' shows it only on the plain All view."],
    minimal: { columnSections: [{ id: "start-free", kind: "free-courses", title: "New here? Start free", limit: 3 }] },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["columnSections/0"] },
  }),
  pattern({
    id: "catalog.sections.spotlight",
    label: "Spotlight carousel",
    component: "courseCatalog",
    propPath: "props.columnSections[kind=spotlight]",
    looksLike:
      "A tinted flagship panel inside the results column: eyebrow, title with a native-script title, a paragraph, numbered step cards with prices ('Free', '₹251'), an 'Enrol for ₹X' button and carousel dots.",
    figmaCues: ["a sand-tinted rounded panel 300-400px tall inside the results column", "3-4 small numbered circles with labels and prices", "pager dots or arrows"],
    useWhen: "The design spotlights one or more flagship programmes inside the catalogue.",
    avoidWhen: "The programme does not exist yet — never invent a course.",
    requires: [{ kind: "productPage", detail: "cta.action 'course' needs a course id (+ invite); 'product-page' a product page code; 'open-form' a campaign — all picked by the admin in the editor, so leave them empty" }],
    bound: [
      "columnSections[].slides[].cta.courseId",
      "columnSections[].slides[].cta.enrollInviteId",
      "columnSections[].slides[].cta.packageSessionId",
      "columnSections[].slides[].cta.productPageCode",
      "columnSections[].slides[].cta.audienceId",
      "columnSections[].slides[].steps[].audienceId",
    ],
    i18n: "mixed",
    reviewAs: ["content", "cta"],
    pitfalls: ["'{price}' in the label is the LIVE price; the authored price is used only when no live price exists.", "Carousel controls hide when there is one slide."],
    minimal: {
      columnSections: [
        {
          id: "flagship",
          kind: "spotlight",
          slides: [
            {
              id: "s1",
              eyebrow: "Flagship program",
              title: "<a real course name>",
              cta: { label: "Enrol for {price}", action: "product-page", productPageCode: PRODUCT_PAGE },
              steps: [{ title: "<step>", meta: "Free", tone: "accent" }],
            },
          ],
        },
      ],
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["columnSections/1"] },
  }),
  pattern({
    id: "catalog.sections.comingSoon",
    label: "Coming-soon cards",
    component: "courseCatalog",
    propPath: "props.columnSections[kind=coming-soon]",
    looksLike: "After the grid: 'Coming soon' with dashed cards, each a bell icon, a category name and a 'Notify me' button.",
    figmaCues: ["dashed-border cards after the pagination", "a bell icon and 'Notify me' on each card"],
    useWhen: "The design lists categories that have not launched.",
    avoidWhen: "No folder-library category is flagged coming soon.",
    requires: [{ kind: "folderLibrary", detail: "categories flagged coming_soon, each with an audience form for Notify me" }],
    bound: [],
    i18n: "mixed",
    reviewAs: ["form"],
    pitfalls: ["The title 'Coming soon' is real content here, not placeholder copy.", "categorySlugs are folder slugs; absent = every coming-soon category in scope."],
    minimal: { columnSections: [{ id: "soon", kind: "coming-soon", placement: "after-grid", title: "Coming soon" }] },
    fullFrom: { fixture: "brahm-varchas-site", pointer: CATALOG_FIXTURE_ROOT, pick: ["columnSections/2"] },
  }),

  /* ── heroSection ─────────────────────────────────────────────────────── */
  pattern({
    id: "hero.editorial",
    label: "Editorial hero",
    component: "heroSection",
    propPath: "props",
    looksLike:
      "A split hero on a tinted band: breadcrumb, a short rule + uppercase eyebrow, a two-line headline whose second line is in the accent colour, a lead, ✓ bullets, a filled and an outlined button, and an unframed illustration on the right.",
    figmaCues: ["a 24-32px horizontal line before an uppercase eyebrow", "a 48-56px headline whose second line has a different colour", "3 short lines each starting with a check icon", "an illustration with no card or shadow"],
    useWhen: "A content page (learning paths, about) opens with an editorial split hero.",
    avoidWhen: "The page is a course catalogue with search (catalog.hero) or a photo-led landing hero (default heroSection).",
    requires: [{ kind: "asset", detail: "the right-hand illustration" }],
    bound: [],
    i18n: "translatable",
    reviewAs: ["hero"],
    pitfalls: ["titleAccent is its own line; do not repeat it in title.", "Images with baked-in English text will not translate."],
    minimal: {
      variant: "editorial",
      layout: "split",
      eyebrow: { text: "<eyebrow>", style: "rule" },
      left: {
        title: "<headline line 1>",
        titleAccent: "<headline line 2>",
        checklist: ["<benefit>", "<benefit>"],
        buttons: [{ text: "<primary action>", action: "navigate", target: "#paths", variant: "primary" }],
      },
      right: { image: MEDIA },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/2/components/0/props" },
  }),

  /* ── learningPath ────────────────────────────────────────────────────── */
  pattern({
    id: "learningPath.featured",
    label: "Featured path",
    component: "learningPath",
    propPath: "props",
    looksLike:
      "Goal chips that filter paths ('Raise my child', 'Care for my health'), then one large featured path card with a stepper of its courses, the total, 'View path' and a 'Step 1 is free' pill.",
    figmaCues: ["a row of 4-6 rounded goal chips under a question heading", "one wide card with a numbered horizontal stepper and a price total", "a badge pill such as 'Most popular path'"],
    useWhen: "The design sells ordered course sequences (paths) built from product pages.",
    avoidWhen: "There are no product pages per path in a folder library — this section is admin-bound; never add it with an invented library.",
    requires: [
      { kind: "folderLibrary", detail: "a library whose leaves are product pages, one per path" },
      { kind: "productPage", detail: "one product page per path; featured.code names one" },
    ],
    bound: ["libraryId", "folderId", "productPageCode", "featured.code", "pathExtras[].code", "pathExtras[].comingSoon[].audienceId"],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: [
      "Steps, prices and totals are live from each product page; never author them.",
      "To put a band between the featured part and the grid, split into two sections: this one with showGrid:false, learningPath.moreGrid after the band.",
      "goals[].tags are stream folder slugs.",
    ],
    minimal: {
      mode: "list",
      listLayout: "featured",
      libraryId: LIBRARY,
      title: "What do you want to achieve?",
      goals: [{ key: "<goal-key>", label: "<goal label>", tags: ["<stream folder slug>"] }],
      featured: { code: PRODUCT_PAGE, badge: "Most popular path" },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/2/components/1/props" },
  }),
  pattern({
    id: "learningPath.moreGrid",
    label: "More paths grid",
    component: "learningPath",
    propPath: "props",
    looksLike: "'More learning paths' — two-column path cards further down the page, after a band.",
    figmaCues: ["a 2-column grid of path cards with a heading and a muted note on the right"],
    useWhen: "The featured paths and the remaining paths are separated by another band.",
    avoidWhen: "One learningPath section can show everything (leave showGrid on).",
    requires: [{ kind: "folderLibrary", detail: "the same library as learningPath.featured" }],
    bound: ["libraryId", "folderId", "productPageCode", "featured.code", "pathExtras[].code", "pathExtras[].comingSoon[].audienceId"],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: ["Use sharedWith: '<id of the featured section>' to keep one copy of goals / featured / pathExtras."],
    minimal: { mode: "list", listLayout: "featured", libraryId: LIBRARY, showGoals: false, showFeatured: false, moreTitle: "More learning paths" },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/2/components/3/props" },
  }),
  pattern({
    id: "learningPath.pathExtras",
    label: "Path extras",
    component: "learningPath",
    propPath: "props.pathExtras",
    looksLike: "Inside an opened path: two language versions shown as one step, and 'coming soon' steps with a Notify me action.",
    figmaCues: ["a step row with 'EN · हिं' and one price", "a greyed step labelled 'Coming soon'"],
    useWhen: "A path has a course in two languages or a step that has not launched.",
    avoidWhen: "The path's steps are all live single-language courses.",
    requires: [{ kind: "campaign", detail: "comingSoon[].audienceId opens a notify form" }],
    bound: ["pathExtras[].code", "pathExtras[].comingSoon[].audienceId"],
    i18n: "mixed",
    reviewAs: ["content"],
    pitfalls: ["mergeSteps positions are 1-based and refer to the steps as shown."],
    minimal: { pathExtras: [{ code: PRODUCT_PAGE, mergeSteps: [[1, 2]], comingSoon: [{ title: "<step not launched yet>", audienceId: CAMPAIGN }] }] },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/2/components/1/props", pick: ["pathExtras"] },
  }),

  /* ── ctaBanner ───────────────────────────────────────────────────────── */
  pattern({
    id: "cta.band",
    label: "Dark CTA band",
    component: "ctaBanner",
    propPath: "props",
    looksLike: "A full-width dark band: heading, one line of text, a filled (olive/primary) button with an arrow and an outlined light button.",
    figmaCues: ["a full-bleed band 220-300px tall with a dark fill", "two buttons side by side, one filled, one outlined in white"],
    useWhen: "The design ends a section with a two-action band.",
    avoidWhen: "The band holds a form (use leadForm) or only text (use sectionHeading).",
    requires: [{ kind: "campaign", detail: "a button with action 'openForm' needs an ACTIVE campaign" }],
    bound: ["button.audienceId", "secondaryButton.audienceId"],
    i18n: "mixed",
    reviewAs: ["cta", "styledBand"],
    pitfalls: [
      "Button styles: primary | olive | outline-light (on dark) | outline-dark (on light). icon 'arrow' adds →.",
      "The renderer reads heading/subheading/button/secondaryButton only — headerText/buttonText are ignored.",
    ],
    minimal: {
      variant: "band",
      heading: "<band heading>",
      button: { enabled: true, text: "<action>", style: "olive", action: "navigate", target: "/learning-paths", icon: "arrow" },
      secondaryButton: { enabled: true, text: "Talk to us", style: "outline-light", action: "openForm", audienceId: CAMPAIGN },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/1/components/1/props" },
  }),
  pattern({
    id: "cta.band.light",
    label: "Light CTA band",
    component: "ctaBanner",
    propPath: "props",
    looksLike: "A taller light band ('For schools & institutions'): eyebrow, heading, text, an outlined dark button and a filled primary button.",
    figmaCues: ["a light (sand/cream) band 300-360px tall", "an uppercase eyebrow over the heading", "an outlined dark button next to a filled one"],
    useWhen: "A secondary audience (institutions, partners) gets its own call to action.",
    avoidWhen: "The band is the page's main dark CTA (cta.band).",
    requires: [{ kind: "campaign", detail: "openForm buttons need an ACTIVE campaign" }],
    bound: ["button.audienceId", "secondaryButton.audienceId"],
    i18n: "mixed",
    reviewAs: ["cta", "styledBand"],
    pitfalls: ["bandSize 'lg' = 72px padding and the 16/26 subheading."],
    minimal: {
      variant: "band",
      bandSize: "lg",
      eyebrow: "<eyebrow>",
      heading: "<band heading>",
      button: { enabled: true, text: "Talk to us", style: "outline-dark", action: "openForm", audienceId: CAMPAIGN },
      secondaryButton: { enabled: true, text: "Partner with us", style: "primary", action: "openForm", audienceId: CAMPAIGN },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/2/components/2/props" },
  }),
  pattern({
    id: "cta.band.app",
    label: "App band",
    component: "ctaBanner",
    propPath: "props",
    looksLike: "A dark app banner: eyebrow, heading, text and a button on the left, a phone showing an app screenshot on the right.",
    figmaCues: ["a phone frame with a screenshot inside a dark band", "one filled button under the copy"],
    useWhen: "The design promotes an app in a band.",
    avoidWhen: "There is no real app screenshot to show.",
    requires: [{ kind: "asset", detail: "the app screenshot for mockup.image" }],
    bound: [],
    i18n: "mixed",
    reviewAs: ["cta", "styledBand"],
    pitfalls: ["mockup.kind is 'phone'; the screenshot is cropped into the screen."],
    minimal: {
      variant: "band",
      eyebrow: "<app name>",
      heading: "<band heading>",
      mockup: { kind: "phone", image: MEDIA },
      button: { enabled: true, text: "Get the app", style: "olive", action: "navigate", target: "/login", icon: "arrow" },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/2/components/4/props" },
  }),

  /* ── stepsProcess ────────────────────────────────────────────────────── */
  pattern({
    id: "steps.cards",
    label: "Step cards",
    component: "stepsProcess",
    propPath: "props",
    looksLike: "'How it works': three white numbered cards in one row on a tinted band.",
    figmaCues: ["3-4 equal white cards in a row on a tinted band", "a filled number circle at the top of each card"],
    useWhen: "The design explains a short process with numbered cards.",
    avoidWhen: "The steps need a timeline or alternating layout (timeline-cards | alternating variants).",
    requires: [],
    bound: [],
    i18n: "translatable",
    reviewAs: ["content", "styledBand"],
    pitfalls: ["accentColor colours the number circles (default: palette primary)."],
    minimal: { variant: "cards", headerText: "<heading>", steps: [{ number: "1", title: "<step>", description: "<one line>" }] },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/pages/2/components/5/props" },
  }),

  /* ── header (set_layout) ─────────────────────────────────────────────── */
  pattern({
    id: "header.editorial",
    label: "Editorial header",
    component: "header",
    propPath: "globalSettings.layout.header.props",
    looksLike: "A 64px white header: logo only, small text nav with the current page bold in gold, a line search icon, a segmented हिन्दी | EN switch, and a cart icon only once the cart has items.",
    figmaCues: ["a 64px bar with a 40-48px logo and no site name", "13px nav text items 32px apart", "a two-part bordered language toggle"],
    useWhen: "The design's header is compact and text-led.",
    avoidWhen: "The design shows the default header (title next to logo, pill-highlighted nav).",
    requires: [{ kind: "asset", detail: "the logo" }],
    bound: ["navigation[].megaMenu.libraryId"],
    i18n: "mixed",
    reviewAs: [],
    pitfalls: ["set_layout replaces the whole header: send every prop, not just the changed ones.", "The language switch shows only on a site with more than one locale (global.i18n)."],
    minimal: {
      logo: MEDIA,
      logoOnly: true,
      barSize: "compact",
      contentWidth: "contained",
      navStyle: "editorial",
      activeStyle: "underline",
      languageSwitcherStyle: "segmented",
      cartDisplay: "whenNotEmpty",
      navigation: [{ label: "Courses", route: "courses" }],
    },
    fullFrom: {
      fixture: "brahm-varchas-site",
      pointer: "/globalSettings/layout/header/props",
      pick: ["logo", "logoOnly", "barSize", "contentWidth", "navStyle", "activeStyle", "showSearch", "showLanguageSwitcher", "languageSwitcherStyle", "cartDisplay", "navigation", "authLinks"],
    },
  }),
  pattern({
    id: "header.megaMenu",
    label: "Mega menu",
    component: "header",
    propPath: "globalSettings.layout.header.props.navigation[type=megaMenu]",
    looksLike: "A nav item that opens a panel of stream tiles (120px images), the open stream's categories in a cream box, a legend and a footnote.",
    figmaCues: ["a separate frame named like 'Mega Menu' under the header", "a grid of image tiles with captions plus a category list"],
    useWhen: "The design's main nav opens a streams panel.",
    avoidWhen: "There is no folder library of streams.",
    requires: [{ kind: "folderLibrary", detail: "streams = top-level folders, categories = their children" }],
    bound: ["navigation[].megaMenu.libraryId"],
    i18n: "mixed",
    reviewAs: [],
    pitfalls: ["Link patterns take {stream} / {category} folder slugs; a folder's own link_url wins."],
    minimal: {
      megaMenuStyle: "editorial",
      navigation: [
        {
          label: "<nav label>",
          route: "/courses",
          type: "megaMenu",
          megaMenu: { libraryId: LIBRARY, eyebrow: "<panel eyebrow>", showLegend: true },
        },
      ],
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings/layout/header/props", pick: ["megaMenuStyle", "navigation/0"] },
  }),

  /* ── footer (set_layout) ─────────────────────────────────────────────── */
  pattern({
    id: "footer.brand",
    label: "Brand footer",
    component: "footer",
    propPath: "globalSettings.layout.footer.props",
    looksLike: "A tinted footer: logo, large wordmark, description and tagline, a newsletter box, social icons, four link columns and a bottom bar with a language toggle.",
    figmaCues: ["a footer with 4 link columns plus a brand column", "a large wordmark under the logo", "an email input with a Subscribe button"],
    useWhen: "The design's footer carries the brand, a newsletter and 4 link columns.",
    avoidWhen: "The design has a simple two- or three-column footer (default variant).",
    requires: [{ kind: "asset", detail: "the logo" }],
    bound: ["newsletter.audienceId"],
    i18n: "mixed",
    reviewAs: [],
    pitfalls: ["rightSection1..4 are the columns; showLanguageSwitcher shows only on a multi-language site."],
    minimal: {
      variant: "brand",
      layout: "four-column",
      leftSection: { title: "<brand name>", logo: MEDIA, tagline: "<tagline>" },
      rightSection1: { title: "Explore", links: [{ label: "Courses", route: "/courses" }] },
      bottomTagline: "<line>",
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings/layout/footer/props" },
  }),
  pattern({
    id: "footer.newsletter",
    label: "Footer newsletter",
    component: "footer",
    propPath: "globalSettings.layout.footer.props.newsletter",
    looksLike: "'Stay connected' with an email field and a Subscribe button inside the brand footer.",
    figmaCues: ["an email input and button inside the footer"],
    useWhen: "The brand footer has a newsletter signup.",
    avoidWhen: "There is no campaign to receive the addresses.",
    requires: [{ kind: "campaign", detail: "an ACTIVE newsletter campaign" }],
    bound: ["newsletter.audienceId"],
    i18n: "translatable",
    reviewAs: ["form"],
    pitfalls: ["Only the brand footer renders it."],
    minimal: { variant: "brand", newsletter: { enabled: true, heading: "Stay connected", audienceId: CAMPAIGN } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings/layout/footer/props", pick: ["variant", "newsletter"] },
  }),

  /* ── globalSettings ──────────────────────────────────────────────────── */
  pattern({
    id: "global.palette",
    label: "Palette",
    component: "globalSettings",
    propPath: "globalSettings.theme.palette",
    looksLike: "A named colour set used across the design: ink, body, muted text, brand, gold/accent highlights, cream/sand surfaces and hairline borders.",
    figmaCues: ["5-17 recurring solid fills across frames", "a page background that is not pure white", "hairline 1px borders in a warm grey"],
    useWhen: "The design has its own colour system beyond one brand colour.",
    avoidWhen: "One brand colour is enough (theme.primaryColor / preset).",
    requires: [],
    bound: [],
    i18n: "opaque",
    reviewAs: [],
    pitfalls: [
      "Values are hex (#rgb or #rrggbb); anything else is ignored.",
      "applyToTokens:true re-points the shared catalogue tokens at the palette (light mode only) — check the cart drawer and course pages after.",
      "Set theme.primaryColor to palette.primary as well.",
    ],
    minimal: {
      theme: {
        primaryColor: "<palette.primary hex>",
        palette: { text: "<ink hex>", body: "<body text hex>", primary: "<brand hex>", canvas: "<page background hex>", border: "<hairline hex>", applyToTokens: true },
      },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["theme/primaryColor", "theme/palette"] },
  }),
  pattern({
    id: "global.contentMaxWidth",
    label: "Content width",
    component: "globalSettings",
    propPath: "globalSettings.theme.contentMaxWidth",
    looksLike: "Content sits in a column narrower than the frame (1152px on a 1440px frame).",
    figmaCues: ["most content starts at x=144 and ends at x=1296 in a 1440 frame (inner width = frame − 2 × side margin)"],
    useWhen: "The design's content column differs from the default.",
    avoidWhen: "The design uses the default width.",
    requires: [],
    bound: [],
    i18n: "opaque",
    reviewAs: [],
    pitfalls: ["px of content, gutters excluded; 320-2400, anything else is ignored."],
    minimal: { theme: { contentMaxWidth: 1152 } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["theme/contentMaxWidth"] },
  }),
  pattern({
    id: "global.fonts",
    label: "Fonts",
    component: "globalSettings",
    propPath: "globalSettings.fonts",
    looksLike: "One body font across the design (e.g. Lato), with Devanagari runs in Noto Sans Devanagari.",
    figmaCues: ["TEXT styles share one family", "Devanagari text layers"],
    useWhen: "The design names a font from the registered list.",
    avoidWhen: "The font is not on the registered list — pick the closest one and say so.",
    requires: [],
    bound: [],
    i18n: "opaque",
    reviewAs: [],
    pitfalls: [
      "Do NOT set fonts.headingFamily on a Hindi site: it replaces the heading stack without the Devanagari fallback.",
      "Lato has no 500/600: Semibold in the design renders as 700.",
    ],
    minimal: { fonts: { enabled: true, family: "Lato, sans-serif" } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["fonts"] },
  }),
  pattern({
    id: "global.courseFormats",
    label: "Course formats",
    component: "globalSettings",
    propPath: "globalSettings.courseFormats + courseFormatOrder",
    looksLike: "A format taxonomy (E-books, Live sessions, Short film…) on card pills, the FORMAT filter and path steps.",
    figmaCues: ["the same set of 4-8 media-type words on cards and in a filter group"],
    useWhen: "Courses come in several formats the design names.",
    avoidWhen: "Every course has the same format.",
    requires: [{ kind: "courseTags", detail: "courses tagged format-<key>, or a level name listed in levels[]" }],
    bound: [],
    i18n: "opaque",
    reviewAs: [],
    pitfalls: ["Keys are lower-case slugs; a course's format is tag format-<key> first, then a listed tag, then a listed level name.", "Labels are base-language text shown through the site dictionary."],
    minimal: { courseFormats: { ebook: { label: "E-books", levels: ["eBook"] }, live: { label: "Live sessions" } }, courseFormatOrder: ["ebook", "live"] },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["courseFormats", "courseFormatOrder"] },
  }),
  pattern({
    id: "global.courseLanguages",
    label: "Course languages",
    component: "globalSettings",
    propPath: "globalSettings.courseLanguages",
    looksLike: "Language chips on cards and a LANGUAGE filter: one course, several language versions.",
    figmaCues: ["'EN' / 'हिं' chips on cards"],
    useWhen: "Courses exist in more than one language.",
    avoidWhen: "All courses share one language.",
    requires: [{ kind: "courseTags", detail: "language words in the level names, or versionGroups pairing separate packages" }],
    bound: ["courseLanguages.versionGroups"],
    i18n: "opaque",
    reviewAs: [],
    pitfalls: ["versionGroups lists course (package) ids of one course in several languages; the admin pairs them in the editor — leave it empty."],
    minimal: {
      courseLanguages: {
        enabled: true,
        languages: [
          { code: "en", label: "English", chip: "EN", match: ["english", "en"] },
          { code: "hi", label: "Hindi", chip: "हिं", match: ["hindi", "hi"] },
        ],
      },
    },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["courseLanguages"] },
  }),
  pattern({
    id: "global.naming",
    label: "Naming",
    component: "globalSettings",
    propPath: "globalSettings.naming",
    looksLike: "The site's own word for a level/course ('Format' instead of 'Level').",
    figmaCues: ["filter or card labels that rename the platform's level/course/session terms"],
    useWhen: "The design uses its own term for levels, courses or sessions.",
    avoidWhen: "The institute's Naming Settings already match.",
    requires: [],
    bound: [],
    i18n: "translatable",
    reviewAs: [],
    pitfalls: ["Affects this site only, not the institute's other surfaces."],
    minimal: { naming: { level: "<word for level>" } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["naming"] },
  }),
  pattern({
    id: "global.siteCart",
    label: "Site cart",
    component: "globalSettings",
    propPath: "globalSettings.siteCart",
    looksLike: "One site-wide cart icon whose checkout is a store product page.",
    figmaCues: ["a cart icon in the header", "'Add whole path to cart' actions"],
    useWhen: "Visitors buy several courses in one checkout.",
    avoidWhen: "There is no store product page selling every course.",
    requires: [{ kind: "productPage", detail: "a store product page that sells the courses" }],
    bound: ["siteCart.storeProductPageCode"],
    i18n: "opaque",
    reviewAs: [],
    pitfalls: ["Absent = the original catalogue cart."],
    minimal: { siteCart: { enabled: true, storeProductPageCode: PRODUCT_PAGE } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["siteCart"] },
  }),
  pattern({
    id: "global.i18n",
    label: "Site languages",
    component: "globalSettings",
    propPath: "globalSettings.i18n",
    looksLike: "A language switcher; the site in two languages.",
    figmaCues: ["a हिन्दी | EN toggle", "the same frame repeated in two scripts"],
    useWhen: "The design is bilingual.",
    avoidWhen: "The site has one language.",
    requires: [{ kind: "i18n", detail: "translations keyed by the EXACT base-language text" }],
    bound: [],
    i18n: "opaque",
    reviewAs: [],
    pitfalls: [
      "Never write the second language into props: translations live in strings[locale][<exact base text>].",
      "Keys ending in Id/Slug/Url/Route/Color/Value and everything under render/styles/style/theme are not translated by key.",
    ],
    minimal: { i18n: { enabled: true, defaultLocale: "en", locales: [{ code: "en", label: "EN" }, { code: "hi", label: "हिन्दी" }] } },
    fullFrom: { fixture: "brahm-varchas-site", pointer: "/globalSettings", pick: ["i18n/enabled", "i18n/defaultLocale", "i18n/locales"] },
  }),
];

/* ── page recipes ──────────────────────────────────────────────────────── */

export const DESIGN_RECIPES: DesignRecipe[] = [
  {
    id: "editorial-catalogue",
    name: "Editorial catalogue",
    description: "A Courses page built from ONE courseCatalog with every editorial opt-in, then a help band.",
    pages: [
      {
        route: "courses",
        title: "Courses",
        sections: [
          {
            component: "courseCatalog",
            patterns: [
              "catalog.hero",
              "catalog.resultsHeader",
              "catalog.quickFilters",
              "catalog.streams.icons",
              "catalog.filterSidebar.editorial",
              "catalog.filterSidebar.promo",
              "catalog.customFilters",
              "catalog.cards.editorial",
              "catalog.pagination.loadMore",
              "catalog.languageVersions",
              "catalog.sections.freeCourses",
              "catalog.sections.spotlight",
              "catalog.sections.comingSoon",
            ],
            note:
              "Deep-merge the patterns' minimal objects into one section's props: merge nested objects key by key (hero, filterSidebar, render…) and concatenate arrays (columnSections, quickFilters, customFilters). The hero carries the H1, so the section title is empty; the legacy level/session/tag filter groups are off (FORMAT and the sidebar replace them).",
            props: { title: "", filtersConfig: [] },
          },
          { component: "ctaBanner", patterns: ["cta.band"] },
        ],
      },
    ],
    site: ["global.palette", "global.contentMaxWidth", "global.fonts", "global.courseFormats", "global.courseLanguages"],
  },
  {
    id: "learning-paths",
    name: "Learning paths",
    description: "Editorial hero, goals + featured path, an institutions band, the remaining paths, an app band, how-it-works cards and a closing band.",
    pages: [
      {
        route: "learning-paths",
        title: "Learning Paths",
        sections: [
          { component: "heroSection", patterns: ["hero.editorial"] },
          { component: "learningPath", patterns: ["learningPath.featured", "learningPath.pathExtras"], note: "showGrid:false", props: { showGrid: false } },
          { component: "ctaBanner", patterns: ["cta.band.light"] },
          { component: "learningPath", patterns: ["learningPath.moreGrid"] },
          { component: "ctaBanner", patterns: ["cta.band.app"] },
          { component: "stepsProcess", patterns: ["steps.cards"] },
          { component: "ctaBanner", patterns: ["cta.band"] },
        ],
      },
    ],
    site: ["global.palette", "global.contentMaxWidth", "global.siteCart"],
  },
  {
    id: "brand-chrome",
    name: "Brand chrome",
    description: "Compact editorial header with a streams mega menu and the brand footer with a newsletter, on a bilingual site.",
    pages: [],
    site: ["header.editorial", "header.megaMenu", "footer.brand", "footer.newsletter", "global.i18n", "global.naming"],
  },
];

/* ── chrome + site-settings contracts ──────────────────────────────────── */

export interface ContractField {
  /** Shape in one line ('"compact" | "default"', 'hex', 'number 320-2400'). */
  type: string;
  description: string;
}

export interface ChromeContract {
  where: string;
  howToWrite: string;
  fields: Record<string, ContractField>;
  patterns: string[];
}

export const CHROME_CONTRACT: Record<"header" | "footer", ChromeContract> = {
  header: {
    where: "globalSettings.layout.header.props",
    howToWrite: "website_edit(set_layout, header={props:{…}}) — replaces the whole header, so send every prop.",
    fields: {
      logo: { type: "image url", description: "Logo (from list_media / import_image)." },
      logoOnly: { type: "boolean", description: "Logo only, no site title beside it." },
      navigation: { type: "[{label, route, type?: 'link'|'megaMenu', megaMenu?}]", description: "Nav items; type 'megaMenu' opens a streams panel (header.megaMenu)." },
      authLinks: { type: "[{label, route, style?: 'primary'|'outline'|'text', audienceId?}]", description: "Login / signup / CTA buttons." },
      activeStyle: { type: "'pill' | 'underline'", description: "How the current page's nav item is marked." },
      barSize: { type: "'default' | 'compact'", description: "'compact' = a 64px bar at every width with a 48px logo." },
      contentWidth: { type: "'full' | 'contained'", description: "'contained' = content in a 1280px container." },
      navStyle: { type: "'default' | 'editorial'", description: "'editorial' = 13px text nav, current page bold in the palette gold." },
      languageSwitcherStyle: { type: "'pill' | 'segmented'", description: "'segmented' = a bordered two-part हिन्दी | EN control." },
      cartDisplay: { type: "'always' | 'whenNotEmpty'", description: "'whenNotEmpty' = the site-cart icon shows once the cart has an item." },
      megaMenuStyle: { type: "'default' | 'editorial'", description: "'editorial' = the streams panel with 120px tiles and a cream detail box." },
      showSearch: { type: "boolean", description: "Search icon that opens a site search." },
      showLanguageSwitcher: { type: "boolean", description: "Language switch (only on a site with more than one locale)." },
    },
    patterns: ["header.editorial", "header.megaMenu"],
  },
  footer: {
    where: "globalSettings.layout.footer.props",
    howToWrite: "website_edit(set_layout, footer={props:{…}}) — replaces the whole footer, so send every prop.",
    fields: {
      variant: { type: "'brand' | absent", description: "'brand' = logo + wordmark + tagline, newsletter, socials, 4 link columns, bottom bar." },
      layout: { type: "'two-column' | 'three-column' | 'four-column'", description: "Column count." },
      leftSection: { type: "{title, text, logo?, tagline?, socials?}", description: "Brand column; logo and tagline are brand-variant only." },
      rightSection1: { type: "{title, links:[{label, route}]}", description: "Link column (also rightSection2-4; rightSection4 is brand-variant only)." },
      newsletter: { type: "{enabled, heading, subheading, placeholder, buttonText, note, successMessage, audienceId}", description: "Signup inside the brand footer; audienceId is an ACTIVE campaign." },
      bottomNote: { type: "string", description: "Bottom-left line (copyright)." },
      bottomTagline: { type: "string", description: "Bottom-right line (brand variant)." },
      showLanguageSwitcher: { type: "boolean", description: "हिन्दी | EN in the bottom bar (brand variant, multi-language site only)." },
    },
    patterns: ["footer.brand", "footer.newsletter"],
  },
};

export interface GlobalSettingsContractEntry extends ContractField {
  patterns: string[];
}

/** The opt-in site settings an AI may need to reproduce a design (beyond theme preset / fonts / motion). */
export const GLOBAL_SETTINGS_CONTRACT: Record<string, GlobalSettingsContractEntry> = {
  "theme.palette": {
    type: `{${PALETTE_KEYS.join(", ")}: hex, applyToTokens?: boolean}`,
    description: "Named site colours (CSS variables --palette-*). applyToTokens re-points the shared catalogue tokens at them (light mode).",
    patterns: ["global.palette"],
  },
  "theme.contentMaxWidth": {
    type: "number 320-2400 (px of content, gutters excluded)",
    description: "Width of the content column on every page.",
    patterns: ["global.contentMaxWidth"],
  },
  fonts: {
    type: "{enabled, family}",
    description: "Body font from the registered list; Devanagari falls back to Noto Sans Devanagari on a Hindi site.",
    patterns: ["global.fonts"],
  },
  courseFormats: {
    type: "{<key>: {label, levels?: string[], tags?: string[]}}",
    description: "Course formats matched by tag format-<key>, a listed tag, then a listed level name.",
    patterns: ["global.courseFormats"],
  },
  courseFormatOrder: { type: "string[] of courseFormats keys", description: "Display order of the formats.", patterns: ["global.courseFormats"] },
  courseLanguages: {
    type: "{enabled, languages:[{code, label, chip?, match?}], versionGroups?: [[course id, …]]}",
    description: "Reads a course's language from its level names so one card shows every version.",
    patterns: ["global.courseLanguages", "catalog.languageVersions"],
  },
  naming: {
    type: "{course?, coursePlural?, level?, levelPlural?, session?, sessionPlural?}",
    description: "This site's own words for course / level / session.",
    patterns: ["global.naming"],
  },
  siteCart: {
    type: "{enabled, storeProductPageCode, storeProductPageName?}",
    description: "One site-wide cart whose checkout is the store product page.",
    patterns: ["global.siteCart"],
  },
  i18n: {
    type: "{enabled, defaultLocale, locales:[{code, label}], strings:{<locale>:{<exact base text>: <translation>}}}",
    description: "Site languages; translations are a dictionary keyed by the exact base-language text.",
    patterns: ["global.i18n"],
  },
};

/* ── helpers (used by the exporter and the drift tests) ────────────────── */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** RFC 6901 pointer read ("" or "/" = the root). Undefined when any step is missing. */
export const readPointer = (root: unknown, pointer: string): unknown => {
  const parts = pointer === "" || pointer === "/" ? [] : pointer.split("/").slice(1);
  let node: unknown = root;
  for (const raw of parts) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(key)) return undefined;
      node = node[Number(key)];
    } else if (isObject(node)) {
      node = Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined;
    } else {
      return undefined;
    }
    if (node === undefined) return undefined;
  }
  return node;
};

/**
 * The pattern's full example out of the fixture: the value at `pointer`, or —
 * with `pick` — an object holding just the picked paths, nested as in the
 * fixture (picked array items are compacted: "columnSections/2" → columnSections[0]).
 * Undefined when any part does not resolve.
 */
export const fullExampleOf = (fixture: unknown, from: PatternFullFrom): unknown => {
  const root = readPointer(fixture, from.pointer);
  if (root === undefined) return undefined;
  if (!from.pick) return clone(root);
  const out: Record<string, unknown> = {};
  const slots = new Map<unknown[], Map<string, number>>();
  for (const rel of from.pick) {
    const value = readPointer(root, `/${rel}`);
    if (value === undefined) return undefined;
    const parts = rel.split("/");
    let node: Record<string, unknown> | unknown[] = out;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]!);
      const container = (): unknown => (nextIsIndex ? [] : {});
      if (Array.isArray(node)) {
        const arr = node;
        const index = slots.get(arr) ?? new Map<string, number>();
        slots.set(arr, index);
        if (!index.has(part)) {
          index.set(part, arr.length);
          arr.push(last ? clone(value) : container());
        } else if (last) {
          arr[index.get(part)!] = clone(value);
        }
        node = arr[index.get(part)!] as Record<string, unknown> | unknown[];
      } else {
        const obj = node as Record<string, unknown>;
        if (last) obj[part] = clone(value);
        else if (obj[part] === undefined) obj[part] = container();
        node = obj[part] as Record<string, unknown> | unknown[];
      }
    });
  }
  return out;
};

interface BoundStep {
  key: string;
  each: boolean;
  idKeys: boolean;
}

const parseBound = (path: string): BoundStep[] =>
  path.split(".").map((seg) => ({
    key: seg.replace(/(\[\]|\{\})$/, ""),
    each: seg.endsWith("[]"),
    idKeys: seg.endsWith("{}"),
  }));

/** True when `path` (bound syntax) reaches at least one value in `root`. */
export const boundPathExists = (root: unknown, path: string): boolean => {
  const walk = (node: unknown, steps: BoundStep[]): boolean => {
    if (!isObject(node)) return false;
    const [step, ...rest] = steps;
    if (!step || !(step.key in node)) return false;
    const value = node[step.key];
    if (rest.length === 0) return value !== undefined;
    if (step.each) return Array.isArray(value) && value.some((item) => walk(item, rest));
    return walk(value, rest);
  };
  return walk(root, parseBound(path));
};

/** Placeholder per id key. */
const ID_PLACEHOLDERS: Record<string, unknown> = {
  libraryId: LIBRARY,
  folderId: "<folderId: leave empty — the admin picks a folder of that library>",
  audienceId: CAMPAIGN,
  productPageCode: PRODUCT_PAGE,
  storeProductPageCode: PRODUCT_PAGE,
  code: PRODUCT_PAGE,
  courseId: COURSE,
  courseIds: COURSE,
  enrollInviteId: "<enrollInviteId: leave empty — the admin picks that course's invite>",
  packageSessionId: "<packageSessionId: leave empty — the admin picks that course's batch>",
  descriptions: COURSE,
  versionGroups: [["<course id (English version): leave empty — the admin groups versions>", "<course id (Hindi version): leave empty>"]],
};

/** Editor-only display names of bound records: never meaningful on another site. */
const DISPLAY_NAME_KEYS = new Set(["libraryName", "productPageName", "audienceName", "storeProductPageName"]);
/** Keys whose http(s) value is an uploaded asset of the fixture's institute. */
const ASSET_KEYS = new Set(["logo", "image", "screenImage", "imageUrl", "src", "avatar", "backgroundImage", "coverImage"]);
/** Keys that always hold the fixture institute's own slogan. */
const TAGLINE_KEYS = new Set(["tagline", "bottomTagline"]);
export const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ABSOLUTE_URL = /^https?:\/\//i;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>)]+/gi;

/**
 * The brand names of each fixture's institute, in every spelling the fixture
 * uses (display name, script, domain / handle). The scrub turns them into
 * placeholders and the exporter refuses a full example that still has one.
 */
export const FIXTURE_BRAND_NAMES: Record<PatternFullFrom["fixture"], string[]> = {
  "brahm-varchas-site": ["Brahm Varchas", "ब्रह्म वर्चस", "brahmvarchas", "BVShiksha"],
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const placeholderFor = (key: string): unknown => clone(ID_PLACEHOLDERS[key] ?? `<${key}>`);

/**
 * A full example made safe to show another institute: every `bound` path, the
 * editor display names, the fixture's uploaded asset URLs, its absolute links
 * (own pages, policies, social profiles), its taglines and its brand names
 * (`brandNames`, see FIXTURE_BRAND_NAMES) become placeholders, and any id
 * left in a string becomes "<id>". Empty values stay empty. Pure; returns a copy.
 */
export const scrubExample = (value: unknown, bound: string[], brandNames: string[] = []): unknown => {
  const out = clone(value);
  const brand = brandNames.length
    ? new RegExp(brandNames.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|"), "gi")
    : null;
  const replaceBound = (node: unknown, steps: BoundStep[]): void => {
    if (!isObject(node)) return;
    const [step, ...rest] = steps;
    if (!step || !(step.key in node)) return;
    const current = node[step.key];
    if (rest.length === 0) {
      if (step.idKeys && isObject(current)) {
        const first = Object.values(current)[0];
        node[step.key] = first === undefined ? {} : { [String(placeholderFor(step.key))]: first };
      } else if (step.each && Array.isArray(current)) {
        node[step.key] = current.length ? [placeholderFor(step.key)] : [];
      } else if (current !== "" && current !== null && current !== undefined) {
        node[step.key] = placeholderFor(step.key);
      }
      return;
    }
    if (step.each && Array.isArray(current)) current.forEach((item) => replaceBound(item, rest));
    else replaceBound(current, rest);
  };
  for (const path of bound) replaceBound(out, parseBound(path));

  const sweep = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (ABSOLUTE_URL.test(node.trim())) return LINK;
      const text = node.replace(UUID_PATTERN, "<id>").replace(URL_IN_TEXT, "<url>");
      return brand ? text.replace(brand, BRAND_NAME) : text;
    }
    if (Array.isArray(node)) return node.map(sweep);
    if (!isObject(node)) return node;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (DISPLAY_NAME_KEYS.has(k) && typeof v === "string") next[k] = v ? "<name shown in the editor>" : v;
      else if (ASSET_KEYS.has(k) && typeof v === "string" && ABSOLUTE_URL.test(v)) next[k] = MEDIA;
      else if (TAGLINE_KEYS.has(k) && typeof v === "string") next[k] = v ? TAGLINE : v;
      else next[k.replace(UUID_PATTERN, "<id>")] = sweep(v);
    }
    return next;
  };
  return sweep(out);
};

export const findDesignPattern = (id: string): DesignPattern | undefined => DESIGN_PATTERNS.find((p) => p.id === id);
