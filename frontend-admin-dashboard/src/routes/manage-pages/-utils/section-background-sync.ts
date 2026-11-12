/**
 * One section colour, two pickers.
 *
 * Most section blocks have their own "Background Color" (props.backgroundColor)
 * and the Style panel has another (style.backgroundColor). The live site paints
 * the block's own colour on top of the Style one, so once a block has its own
 * colour, picking a Style colour changed nothing visible (e.g. an About
 * "Meet the Founder" heading set to cream in Style, still white on the site).
 *
 * Fix: while a block has its own colour, a Style colour pick writes both, and
 * the Style picker shows the block's colour (the one visitors see).
 */

/** Blocks whose props.backgroundColor IS the section band the live site
 *  paints (checked against the learner renderers, 2026-11-12). Anything else
 *  keeps the old picker: e.g. a Button block's own colour is the button fill,
 *  and statsHighlights / testimonialSection paint props.styles.backgroundColor. */
const OWN_COLOUR_IS_THE_BAND = new Set([
    'sectionHeading',
    'faqSection',
    'contactForm',
    'announcementFeed',
    'tabsAccordion',
    'featureGrid',
    'newsletterSignup',
    'stepsProcess',
    'ctaBanner',
    'countdownTimer',
    'marquee',
    'heroSection',
    'documentViewer',
    'scormViewer',
    'blog',
    'courseShowcase',
]);

interface Syncable {
    type?: string;
    props?: object;
    style?: { backgroundColor?: unknown };
}

const colourOf = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** The block's own section colour, when it has one that overrides the Style colour. */
export const ownSectionBackground = (component: Syncable | undefined): string | undefined => {
    if (!component?.type || !OWN_COLOUR_IS_THE_BAND.has(component.type)) return undefined;
    const own = colourOf((component.props as { backgroundColor?: unknown } | undefined)?.backgroundColor);
    // Only a solid hex paints over the Style colour. 'transparent' (layered
    // heroes) lets the Style background show already — leave those alone.
    return own && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(own) ? own : undefined;
};

/**
 * The update for a Style-panel Background Color pick: the Style colour, plus
 * the block's own colour when it has one (else the pick would not show). Only
 * the picker calls this — other Style edits (padding…) never touch props.
 */
export const styleBackgroundUpdate = <T extends Syncable>(
    component: T,
    nextStyle: NonNullable<T['style']>,
): Partial<T> => {
    const next = colourOf(nextStyle.backgroundColor);
    const own = ownSectionBackground(component);
    if (!next || !own || next === own) return { style: nextStyle } as Partial<T>;
    return { style: nextStyle, props: { ...component.props, backgroundColor: next } } as Partial<T>;
};
