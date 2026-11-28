/**
 * Whether an authored page opens with a heading of its own.
 *
 * A catalogue page with a Title gets a coloured title bar rendered above it as
 * fallback chrome, so a bare page is not untitled. Pages that already open
 * with their own heading must opt out, or the visitor sees two titles stacked.
 */
const OPENS_WITH_OWN_TITLE = new Set([
    "heroSection",
    "sectionHeading",
    "detailBlocks",
    // A pasted HTML SECTION, which may carry the page's heading...
    "htmlBlock",
    // ...and a pasted whole PAGE, which always does: it is created by the
    // Add Page > HTML page flow as a page's only component and brings its own
    // header, nav and footer. Omitting it put a title bar above the7cs's own
    // branded header on the Toddler Reset page.
    "htmlPage",
    "banner",
]);

/** Blocks with no place in the page flow — they open over it. */
const OVERLAY_ONLY = new Set(["promoPopup"]);

/**
 * `components` is the page's component list; disabled entries are ignored by
 * the caller before this is asked.
 */
export const pageOpensWithOwnHeader = (
    components: Array<{ type?: string; props?: unknown } | null | undefined>,
): boolean => {
    // What the visitor first SEES: a block that only floats over the page
    // (promoPopup) takes no room, so it never decides whether a title bar shows.
    const first = components.find((c) => !OVERLAY_ONLY.has(c?.type ?? ""));
    return (
        components.some((c) => c?.type === "heroSection") ||
        OPENS_WITH_OWN_TITLE.has(first?.type ?? "") ||
        opensWithCatalogHero(first)
    );
};

/**
 * A Courses grid that draws its own page hero (courseCatalog.hero, opt-in)
 * already shows the page's title, breadcrumb and lead above everything else.
 */
const opensWithCatalogHero = (
    component: { type?: string; props?: unknown } | null | undefined,
): boolean => {
    if (component?.type !== "courseCatalog") return false;
    const hero = (component.props as { hero?: { enabled?: unknown } } | undefined)?.hero;
    return hero?.enabled === true;
};
