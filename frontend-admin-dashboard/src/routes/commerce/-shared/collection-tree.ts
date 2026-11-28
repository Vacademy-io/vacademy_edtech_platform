import type { CommerceCollection } from './commerce-types';

/**
 * The collections tree as pure functions: flatten it for display, find what a
 * collection may be moved under, and work out the two position writes of a
 * move up or down among siblings.
 */

export interface FlatCollection {
    collection: CommerceCollection;
    depth: number;
    /** Index among its siblings and how many siblings there are. */
    index: number;
    siblings: number;
}

const byPosition = (a: CommerceCollection, b: CommerceCollection) =>
    (a.position ?? 0) - (b.position ?? 0);

export const sortedChildren = (nodes: CommerceCollection[] | null | undefined) =>
    [...(nodes ?? [])].sort(byPosition);

/** Depth-first, siblings by position: the order the tree is drawn in. */
export function flattenTree(nodes: CommerceCollection[], depth = 0): FlatCollection[] {
    const sorted = sortedChildren(nodes);
    return sorted.flatMap((collection, index) => [
        { collection, depth, index, siblings: sorted.length },
        ...flattenTree(collection.children ?? [], depth + 1),
    ]);
}

/** The collection and everything under it. */
export function subtreeIds(node: CommerceCollection): string[] {
    return [node.id, ...(node.children ?? []).flatMap(subtreeIds)];
}

/**
 * Collections that `moving` may be placed under: everything except itself and
 * its own descendants (the server refuses those too).
 */
export function parentChoices(
    tree: CommerceCollection[],
    moving: CommerceCollection | null
): FlatCollection[] {
    const banned = new Set(moving ? subtreeIds(moving) : []);
    return flattenTree(tree).filter((entry) => !banned.has(entry.collection.id));
}

export interface PositionWrite {
    id: string;
    position: number;
}

/**
 * Moving a collection one step among its siblings. Stored positions can repeat
 * or have gaps, so every sibling whose index changes its stored number is
 * rewritten to its new index; usually that is the two that swap.
 */
export function moveAmongSiblings(
    siblings: CommerceCollection[],
    id: string,
    direction: 'up' | 'down'
): PositionWrite[] {
    const ordered = sortedChildren(siblings);
    const from = ordered.findIndex((node) => node.id === id);
    const to = direction === 'up' ? from - 1 : from + 1;
    const moved = ordered[from];
    const other = ordered[to];
    if (from < 0 || !moved || !other) return [];
    ordered[from] = other;
    ordered[to] = moved;
    return ordered
        .map((node, index) => ({ id: node.id, position: index, was: node.position }))
        .filter((write) => write.was !== write.position)
        .map(({ id: nodeId, position }) => ({ id: nodeId, position }));
}

/** Siblings of a collection: the children of its parent, or the top level. */
export function siblingsOf(tree: CommerceCollection[], id: string): CommerceCollection[] {
    if (tree.some((node) => node.id === id)) return tree;
    for (const node of tree) {
        const found = siblingsOf(node.children ?? [], id);
        if (found.length > 0) return found;
    }
    return [];
}

/** Name in the wanted language, then the other one, then the slug. */
export function i18nName(
    names: Record<string, string> | null | undefined,
    language: string,
    fallback = ''
): string {
    const primary = language.toLowerCase().startsWith('hi') ? 'hi' : 'en';
    const secondary = primary === 'hi' ? 'en' : 'hi';
    return names?.[primary] || names?.[secondary] || Object.values(names ?? {})[0] || fallback;
}
