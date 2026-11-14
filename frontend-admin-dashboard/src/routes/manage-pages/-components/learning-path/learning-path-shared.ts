import type { CatalogueConfig, Component, LearningPathProps } from '../../-types/editor-types';

/**
 * A Learning Paths page may split the featured layout over two learningPath
 * sections (goal chips + featured path above a band, the other paths below
 * it). Both need the same goals and featured path: the grid section leaves
 * out the featured path and follows the ?goal= chips of the other one.
 *
 * The learner can read them from another section (`sharedWith`), but a site
 * that keeps a copy in each section needs the copies kept equal, so the
 * editor copies what it changes to every such sibling.
 */

/**
 * The keys the editor copies between sibling sections. `featured` is copied
 * per sub-key ('featured.code', 'featured.badge'): the editor has no field for
 * the rest of it (e.g. `featured.image`), which each section keeps.
 */
export const SHARED_PATH_KEYS = ['goals', 'allGoalsLabel', 'featured'] as const;

type Section = Pick<Component, 'id' | 'type' | 'props'>;

export const isFeaturedPathList = (props: LearningPathProps | undefined): boolean =>
    props?.mode === 'list' && props?.listLayout === 'featured';

const eachSection = (components: unknown, visit: (c: Section) => void) => {
    if (!Array.isArray(components)) return;
    for (const c of components as Section[]) {
        if (!c || typeof c !== 'object') continue;
        visit(c);
        const slots = c.props?.slots;
        if (Array.isArray(slots)) slots.forEach((slot) => eachSection(slot, visit));
    }
};

/** The learningPath section `props.sharedWith` names on the page, if any. */
export const sharedPathSource = (components: unknown, props: LearningPathProps): Section | null => {
    const id = typeof props.sharedWith === 'string' ? props.sharedWith.trim() : '';
    if (!id) return null;
    let found: Section | null = null;
    eachSection(components, (c) => {
        if (!found && c.id === id && c.type === 'learningPath') found = c;
    });
    return found;
};

/**
 * Other featured-layout sections on the page that list the same library and
 * keep their own copy (a section reading this one through sharedWith has none).
 */
export const featuredPathSiblings = (components: unknown, self: { id: string; props: LearningPathProps }): Section[] => {
    const libraryId = self.props.libraryId || '';
    if (!libraryId || !isFeaturedPathList(self.props)) return [];
    const out: Section[] = [];
    eachSection(components, (c) => {
        const p = c.props as LearningPathProps | undefined;
        if (c.id === self.id || c.type !== 'learningPath' || !p) return;
        if (isFeaturedPathList(p) && p.libraryId === libraryId && p.sharedWith !== self.id) out.push(c);
    });
    return out;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const asObject = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The section with this id on the page (column children included), and its 1-based position. */
export const findPathSection = (components: unknown, id: string): { section: Section; position: number } | null => {
    let hit: { section: Section; position: number } | null = null;
    let position = 0;
    eachSection(components, (c) => {
        position += 1;
        if (!hit && c.id === id) hit = { section: c, position };
    });
    return hit;
};

/** What the editor copies: goals (+ the first chip) and the featured path (+ its badge). */
const goalsOf = (p: LearningPathProps) => [Array.isArray(p.goals) ? p.goals : [], p.allGoalsLabel || ''];
const featuredOf = (p: LearningPathProps) => {
    const f = asObject(p.featured);
    return [f.code || '', f.badge || ''];
};

/**
 * Which copied parts a sibling holds differently from this section ('goals',
 * 'featured'). The first edit here replaces the sibling's copy, so the panel
 * warns before it does.
 */
export const sharedPathDifferences = (components: unknown, selfId: string): ('goals' | 'featured')[] => {
    const self = findPathSection(components, selfId)?.section;
    if (!self) return [];
    const props = self.props as LearningPathProps;
    const siblings = featuredPathSiblings(components, { id: selfId, props }).map((s) => s.props as LearningPathProps);
    const out: ('goals' | 'featured')[] = [];
    if (siblings.some((p) => !same(goalsOf(p), goalsOf(props)))) out.push('goals');
    if (siblings.some((p) => !same(featuredOf(p), featuredOf(props)))) out.push('featured');
    return out;
};

const mapSections = (components: Component[], fn: (c: Component) => Component): Component[] => {
    let changed = false;
    const next = components.map((c) => {
        let out = fn(c);
        const slots = out.props?.slots;
        if (Array.isArray(slots)) {
            const mapped = (slots as Component[][]).map((slot) => mapSections(slot, fn));
            if (mapped.some((slot, i) => slot !== slots[i])) out = { ...out, props: { ...out.props, slots: mapped } };
        }
        if (out !== c) changed = true;
        return out;
    });
    return changed ? next : components;
};

const mapPage = (config: CatalogueConfig, pageId: string, fn: (c: Component) => Component): CatalogueConfig => {
    let changed = false;
    const pages = config.pages.map((page) => {
        if (page.id !== pageId) return page;
        const components = mapSections(page.components, fn);
        if (components === page.components) return page;
        changed = true;
        return { ...page, components };
    });
    return changed ? { ...config, pages } : config;
};

/** The config with one section's props replaced. */
export const withSectionProps = (
    config: CatalogueConfig,
    pageId: string,
    sectionId: string,
    props: Record<string, unknown>
): CatalogueConfig => mapPage(config, pageId, (c) => (c.id === sectionId ? { ...c, props } : c));

/**
 * Copies `keys` of section `sourceId` to its siblings (a key the source does
 * not have is removed from them). A key 'featured.code' copies that one
 * sub-key into the sibling's own `featured`. Every other prop of a sibling is
 * kept. Returns `config` itself when the siblings already match.
 */
export const syncSharedPathProps = (
    config: CatalogueConfig,
    pageId: string,
    sourceId: string,
    keys: readonly string[]
): CatalogueConfig => {
    const page = config.pages.find((p) => p.id === pageId);
    let source: Section | null = null;
    eachSection(page?.components, (c) => {
        if (!source && c.id === sourceId) source = c;
    });
    if (!source) return config;
    const from = (source as Section).props as LearningPathProps;
    const siblingIds = new Set(featuredPathSiblings(page?.components, { id: sourceId, props: from }).map((s) => s.id));
    const shared = keys.filter((k) => (SHARED_PATH_KEYS as readonly string[]).includes(k.split('.')[0]!));
    if (!siblingIds.size || !shared.length) return config;
    // Sets (or, for undefined, removes) `key` of `target`; false when it already matched.
    const put = (target: Record<string, unknown>, key: string, value: unknown) => {
        if (same(target[key], value)) return false;
        if (value === undefined) delete target[key];
        else target[key] = JSON.parse(JSON.stringify(value));
        return true;
    };
    return mapPage(config, pageId, (c) => {
        if (!siblingIds.has(c.id)) return c;
        const props: Record<string, unknown> = { ...c.props };
        let changed = false;
        for (const key of shared) {
            const [head, sub] = key.split('.') as [string, string | undefined];
            const value = (from as Record<string, unknown>)[head];
            if (!sub) {
                changed = put(props, head, value) || changed;
                continue;
            }
            const own = { ...asObject(props[head]) };
            if (put(own, sub, asObject(value)[sub])) {
                props[head] = own;
                changed = true;
            }
        }
        return changed ? { ...c, props } : c;
    });
};
