/**
 * Plain-language facts about one block, shared by the Structure outline and
 * the canvas placeholders: the first heading a visitor reads, and which
 * opt-in course-catalogue features are switched on. Pure — no React, no i18n
 * (callers translate the feature keys).
 */

type Props = Record<string, unknown>;

const HEADING_KEYS = ['heading', 'title', 'headerText', 'headline'];

/** Objects inside props that carry a section's heading (catalogue hero,
 *  hero section's left column, the footer's brand column). */
const HEADING_HOSTS = ['hero', 'left', 'leftSection'];

const asProps = (value: unknown): Props | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Props) : null;

/** Visible text of a string that may hold rich-text HTML. */
const plainText = (value: unknown): string =>
    typeof value === 'string'
        ? value
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
        : '';

const headingIn = (props: Props | null): string => {
    if (!props) return '';
    for (const key of HEADING_KEYS) {
        const text = plainText(props[key]);
        if (text) return text;
    }
    return '';
};

/**
 * The first heading of a block, as plain text ('' when it has none).
 * Header: its menu labels, since it has no heading of its own.
 */
export const firstHeading = (component: { props?: unknown }): string => {
    const props = asProps(component.props);
    if (!props) return '';
    const own = headingIn(props);
    if (own) return own;
    for (const host of HEADING_HOSTS) {
        const nested = asProps(props[host]);
        // The catalogue hero is opt-in: its title shows only while enabled.
        if (host === 'hero' && nested?.enabled !== true) continue;
        const text = headingIn(nested);
        if (text) return text;
    }
    const body = plainText(props.content) || plainText(props.text);
    if (body) return body;
    if (Array.isArray(props.navigation)) {
        return props.navigation
            .filter((item) => asProps(item)?.enabled !== false)
            .map((item) => plainText(asProps(item)?.label))
            .filter(Boolean)
            .join(' · ');
    }
    return '';
};

export type CatalogFeatureKey =
    | 'hero'
    | 'streamIcons'
    | 'streamTabs'
    | 'filterSidebar'
    | 'highlightedRows'
    | 'editorialCards';

export interface CatalogFeature {
    key: CatalogFeatureKey;
    count?: number;
}

/** The opt-in course-catalogue features a section uses, in page order.
 *  Empty for a catalogue that uses none of them. */
export const catalogFeatures = (props: unknown): CatalogFeature[] => {
    const p = asProps(props);
    if (!p) return [];
    const features: CatalogFeature[] = [];
    if (asProps(p.hero)?.enabled === true) features.push({ key: 'hero' });
    const streams = asProps(p.streams);
    if (streams?.enabled === true) {
        features.push({ key: streams.variant === 'icons' ? 'streamIcons' : 'streamTabs' });
    }
    // The site draws the sidebar only for the editorial variant (resolveFilterSidebar).
    if (asProps(p.filterSidebar)?.variant === 'editorial') features.push({ key: 'filterSidebar' });
    if (Array.isArray(p.columnSections) && p.columnSections.length > 0) {
        features.push({ key: 'highlightedRows', count: p.columnSections.length });
    }
    if (asProps(p.render)?.cardStyle === 'editorial') features.push({ key: 'editorialCards' });
    return features;
};

/** `list` with the item at `from` moved to index `to`; null when nothing moves. */
export const moveItem = <T>(list: readonly T[], from: number, to: number): T[] | null => {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return null;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item as T);
    return next;
};
