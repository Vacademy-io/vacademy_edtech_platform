import { describe, expect, it } from 'vitest';
import {
    buildTree,
    flattenTree,
    nodePath,
    subtreeHeight,
    subtreeIds,
    type LibraryNode,
} from './question-library-services';

const node = (
    id: string,
    parent: string | null,
    name: string,
    order = 0,
    depth = 1
): LibraryNode => ({
    id,
    parent_id: parent,
    name,
    display_order: order,
    depth,
    question_count: 0,
    easy_count: 0,
    medium_count: 0,
    hard_count: 0,
});

// physics(1) > mechanics(2) > friction(3); chemistry sorts before physics by display_order
const NODES: LibraryNode[] = [
    node('friction', 'mechanics', 'Friction', 0, 3),
    node('physics', null, 'Physics', 1, 1),
    node('mechanics', 'physics', 'Mechanics', 0, 2),
    node('chemistry', null, 'Chemistry', 0, 1),
];

describe('question library tree helpers', () => {
    it('builds a tree ordered by display_order, whatever order the API sends', () => {
        const roots = buildTree(NODES);
        expect(roots.map((r) => r.id)).toEqual(['chemistry', 'physics']);
        expect(roots[1]!.children[0]!.children[0]!.id).toBe('friction');
    });

    it('flattens depth-first for indented pickers', () => {
        expect(flattenTree(buildTree(NODES)).map((n) => n.id)).toEqual([
            'chemistry',
            'physics',
            'mechanics',
            'friction',
        ]);
    });

    it('names a topic by its full path', () => {
        expect(nodePath('friction', NODES)).toBe('Physics › Mechanics › Friction');
        expect(nodePath('missing', NODES)).toBe('');
    });

    it('finds a subtree and its height', () => {
        expect([...subtreeIds('physics', NODES)].sort()).toEqual([
            'friction',
            'mechanics',
            'physics',
        ]);
        expect(subtreeHeight('physics', NODES)).toBe(3);
        expect(subtreeHeight('chemistry', NODES)).toBe(1);
    });

    it('treats a node whose parent is missing as a root instead of dropping it', () => {
        const roots = buildTree([node('orphan', 'gone', 'Orphan')]);
        expect(roots.map((r) => r.id)).toEqual(['orphan']);
    });
});
