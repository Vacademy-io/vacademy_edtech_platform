import type { TFunction } from 'i18next';
import {
    LIBRARY_TAG_KINDS,
    type LibraryFacets,
    type LibraryFilters,
    type LibraryNode,
    type LibraryTag,
    type LibraryTagKind,
} from '../-services/question-library-services';
import { DIFFICULTIES, QUESTION_TYPES } from '../-components/library-constants';

/**
 * The filter panel of the Question Library: what is ticked, how it turns into the list
 * filter, and the groups with their counts. Any value inside a group, every group:
 * "Kinematics or Laws of Motion, and Hard, and PYQ 2023".
 */
export interface FacetSelection {
    /** Topics right below the open one. Empty = the open topic as a whole. */
    topics: string[];
    difficulties: string[];
    types: string[];
    tags: Record<LibraryTagKind, string[]>;
}

export type FacetKey = 'topics' | 'difficulties' | 'types' | `tag:${LibraryTagKind}`;

export interface FacetItem {
    value: string;
    label: string;
    /** Undefined while the counts are loading: unknown, not zero. */
    count?: number;
}

export interface FacetGroup {
    key: FacetKey;
    title: string;
    items: FacetItem[];
    selected: string[];
}

export const emptySelection = (): FacetSelection => ({
    topics: [],
    difficulties: [],
    types: [],
    tags: { CONCEPT: [], PYQ: [], SOURCE: [] },
});

export const selectionCount = (selection: FacetSelection): number =>
    selection.topics.length +
    selection.difficulties.length +
    selection.types.length +
    LIBRARY_TAG_KINDS.reduce((sum, kind) => sum + selection.tags[kind].length, 0);

const flip = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/** Ticks or unticks one value. */
export const toggleFacet = (
    selection: FacetSelection,
    key: FacetKey,
    value: string
): FacetSelection => {
    if (key === 'topics') return { ...selection, topics: flip(selection.topics, value) };
    if (key === 'difficulties')
        return { ...selection, difficulties: flip(selection.difficulties, value) };
    if (key === 'types') return { ...selection, types: flip(selection.types, value) };
    const kind = key.slice('tag:'.length) as LibraryTagKind;
    return { ...selection, tags: { ...selection.tags, [kind]: flip(selection.tags[kind], value) } };
};

/** Unticks every value of one group. */
export const clearFacet = (selection: FacetSelection, key: FacetKey): FacetSelection => {
    if (key === 'topics') return { ...selection, topics: [] };
    if (key === 'difficulties') return { ...selection, difficulties: [] };
    if (key === 'types') return { ...selection, types: [] };
    const kind = key.slice('tag:'.length) as LibraryTagKind;
    return { ...selection, tags: { ...selection.tags, [kind]: [] } };
};

/**
 * The list filter for a selection.
 * @param scopeNodeIds what "no topic ticked" means: the open topic, every topic (the
 *                     picker), or undefined for no topic constraint (the owner's whole bank).
 */
export const selectionToFilters = (
    selection: FacetSelection,
    scopeNodeIds: string[] | undefined,
    extra: Pick<LibraryFilters, 'name' | 'exclude_question_ids' | 'unsorted_only'> = {}
): LibraryFilters => {
    const tagGroups: Record<string, string[]> = {};
    LIBRARY_TAG_KINDS.forEach((kind) => {
        if (selection.tags[kind].length) tagGroups[kind] = selection.tags[kind];
    });
    return {
        ...extra,
        library_node_ids: selection.topics.length ? selection.topics : scopeNodeIds,
        difficulties: selection.difficulties.length ? selection.difficulties : undefined,
        question_types: selection.types.length ? selection.types : undefined,
        tag_groups: Object.keys(tagGroups).length ? tagGroups : undefined,
    };
};

/** Tags seen so far by id, so a ticked tag keeps its name when its count drops to zero. */
export const rememberTags = (
    known: Map<string, LibraryTag>,
    tags: LibraryTag[] | undefined
): Map<string, LibraryTag> => {
    if (!tags?.length || tags.every((tag) => known.get(tag.tag_id)?.tag_name === tag.tag_name)) {
        return known;
    }
    const next = new Map(known);
    tags.forEach((tag) => next.set(tag.tag_id, tag));
    return next;
};

/**
 * The groups to show, in order. Topics are the children of the open topic (all of them,
 * so an empty chapter still shows). Types and tags list only what occurs, plus anything
 * ticked. A group with nothing to offer is left out.
 */
export const buildFacetGroups = ({
    t,
    topicNodes,
    topicsTitle,
    facets,
    selection,
    knownTags,
    includeTopics = true,
}: {
    t: TFunction;
    topicNodes: LibraryNode[];
    topicsTitle: string;
    facets: LibraryFacets | undefined;
    selection: FacetSelection;
    knownTags: Map<string, LibraryTag>;
    includeTopics?: boolean;
}): FacetGroup[] => {
    const loaded = !!facets;
    const groups: FacetGroup[] = [];

    if (includeTopics && topicNodes.length > 0) {
        const byId = new Map((facets?.topics ?? []).map((row) => [row.id, row.count]));
        groups.push({
            key: 'topics',
            title: topicsTitle,
            selected: selection.topics,
            items: topicNodes.map((node) => ({
                value: node.id,
                label: node.name,
                count: loaded ? byId.get(node.id) ?? 0 : undefined,
            })),
        });
    }

    groups.push({
        key: 'difficulties',
        title: t('filters.difficulty'),
        selected: selection.difficulties,
        items: DIFFICULTIES.map((level) => ({
            value: level,
            label: t(`difficulty.${level}`),
            count: loaded ? facets?.difficulties?.[level] ?? 0 : undefined,
        })),
    });

    const typeItems = QUESTION_TYPES.filter(
        (type) =>
            !loaded || (facets?.question_types?.[type] ?? 0) > 0 || selection.types.includes(type)
    ).map((type) => ({
        value: type,
        label: t(`types.${type}`),
        count: loaded ? facets?.question_types?.[type] ?? 0 : undefined,
    }));
    if (typeItems.length > 0) {
        groups.push({
            key: 'types',
            title: t('filters.type'),
            selected: selection.types,
            items: typeItems,
        });
    }

    LIBRARY_TAG_KINDS.forEach((kind) => {
        const present = (facets?.tags ?? []).filter((tag) => tag.kind === kind);
        const items: FacetItem[] = present.map((tag) => ({
            value: tag.tag_id,
            label: tag.tag_name,
            count: tag.question_count ?? 0,
        }));
        selection.tags[kind].forEach((id) => {
            if (items.some((item) => item.value === id)) return;
            items.push({
                value: id,
                label: knownTags.get(id)?.tag_name ?? '…',
                count: loaded ? 0 : undefined,
            });
        });
        if (items.length === 0) return;
        groups.push({
            key: `tag:${kind}`,
            title: t(`tags.kind.${kind}`),
            selected: selection.tags[kind],
            items,
        });
    });

    return groups;
};

/** One removable chip per ticked value, labelled as the panel labels it. */
export const activeFacetChips = (groups: FacetGroup[]) =>
    groups.flatMap((group) =>
        group.selected.map((value) => ({
            key: group.key,
            value,
            label: group.items.find((item) => item.value === value)?.label ?? value,
        }))
    );
