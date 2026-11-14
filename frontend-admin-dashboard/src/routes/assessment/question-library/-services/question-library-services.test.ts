import { describe, expect, it } from 'vitest';
import {
    buildTree,
    filterTree,
    flattenTree,
    nodePath,
    pageTotals,
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

describe('filterTree', () => {
    const roots = buildTree([
        node('ncert', null, 'NCERT'),
        node('c10', 'ncert', 'Class 10'),
        node('sci', 'c10', 'Science'),
        node('chem', 'sci', 'Chemical Reactions'),
        node('life', 'sci', 'Life Processes'),
        node('upsc', null, 'UPSC'),
    ]);

    it('returns everything for an empty search', () => {
        expect(filterTree(roots, '  ')).toBe(roots);
    });

    it('keeps the folders that lead to a match and drops the rest', () => {
        const result = filterTree(roots, 'chemical');
        expect(result.map((n) => n.name)).toEqual(['NCERT']);
        const science = result[0]!.children[0]!.children[0]!;
        expect(science.children.map((n) => n.name)).toEqual(['Chemical Reactions']);
    });

    it('keeps everything inside a folder whose own name matches', () => {
        const result = filterTree(roots, 'science');
        expect(result[0]!.children[0]!.children[0]!.children).toHaveLength(2);
    });

    it('returns nothing when no name matches', () => {
        expect(filterTree(roots, 'zzz')).toEqual([]);
    });
});

describe('pageTotals', () => {
    it('reads either spelling of the page envelope', () => {
        expect(pageTotals({ content: [], total_elements: 3, total_pages: 1 })).toEqual({
            elements: 3,
            pages: 1,
        });
        expect(pageTotals({ content: [], totalElements: 30, totalPages: 2 })).toEqual({
            elements: 30,
            pages: 2,
        });
        expect(pageTotals(undefined)).toEqual({ elements: 0, pages: 0 });
    });
});
