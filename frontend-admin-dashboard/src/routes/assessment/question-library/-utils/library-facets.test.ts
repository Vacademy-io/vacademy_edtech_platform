import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
    activeFacetChips,
    buildFacetGroups,
    clearFacet,
    emptySelection,
    rememberTags,
    selectionCount,
    selectionToFilters,
    toggleFacet,
} from './library-facets';
import type { LibraryFacets, LibraryNode } from '../-services/question-library-services';

const t = ((key: string) => key) as unknown as TFunction;

const node = (id: string, name: string): LibraryNode => ({
    id,
    parent_id: 'phy',
    name,
    display_order: 0,
    depth: 2,
    question_count: 0,
    easy_count: 0,
    medium_count: 0,
    hard_count: 0,
});

const facets: LibraryFacets = {
    difficulties: { EASY: 3, HARD: 1 },
    question_types: { MCQS: 4 },
    topics: [{ id: 'kin', count: 3 }],
    tags: [
        { tag_id: 't-vec', tag_name: 'Vectors', kind: 'CONCEPT', question_count: 2 },
        { tag_id: 't-2023', tag_name: '2023', kind: 'PYQ', question_count: 1 },
    ],
};

describe('library facets', () => {
    it('ticks and unticks values per group', () => {
        let selection = toggleFacet(emptySelection(), 'difficulties', 'EASY');
        selection = toggleFacet(selection, 'difficulties', 'HARD');
        selection = toggleFacet(selection, 'tag:CONCEPT', 't-vec');
        selection = toggleFacet(selection, 'topics', 'kin');
        expect(selection.difficulties).toEqual(['EASY', 'HARD']);
        expect(selectionCount(selection)).toBe(4);

        selection = toggleFacet(selection, 'difficulties', 'EASY');
        expect(selection.difficulties).toEqual(['HARD']);
        expect(clearFacet(selection, 'tag:CONCEPT').tags.CONCEPT).toEqual([]);
    });

    it('turns a selection into the list filter', () => {
        expect(selectionToFilters(emptySelection(), ['phy'], { name: 'force' })).toEqual({
            name: 'force',
            library_node_ids: ['phy'],
            difficulties: undefined,
            question_types: undefined,
            tag_groups: undefined,
        });

        let selection = toggleFacet(emptySelection(), 'topics', 'kin');
        selection = toggleFacet(selection, 'tag:PYQ', 't-2023');
        selection = toggleFacet(selection, 'types', 'MCQS');
        const filters = selectionToFilters(selection, ['phy']);
        // Ticked topics replace the open one; only kinds with a tick become groups.
        expect(filters.library_node_ids).toEqual(['kin']);
        expect(filters.tag_groups).toEqual({ PYQ: ['t-2023'] });
        expect(filters.question_types).toEqual(['MCQS']);
    });

    it('builds groups with counts, hiding types and tags that never occur', () => {
        const groups = buildFacetGroups({
            t,
            topicNodes: [node('kin', 'Kinematics'), node('lom', 'Laws of Motion')],
            topicsTitle: 'In Physics',
            facets,
            selection: emptySelection(),
            knownTags: new Map(),
        });

        expect(groups.map((group) => group.key)).toEqual([
            'topics',
            'difficulties',
            'types',
            'tag:CONCEPT',
            'tag:PYQ',
        ]);
        // An empty chapter still shows, with zero.
        expect(groups[0]!.items).toEqual([
            { value: 'kin', label: 'Kinematics', count: 3 },
            { value: 'lom', label: 'Laws of Motion', count: 0 },
        ]);
        expect(groups[1]!.items.map((item) => item.count)).toEqual([3, 0, 1]);
        expect(groups[2]!.items).toEqual([{ value: 'MCQS', label: 'types.MCQS', count: 4 }]);
    });

    it('shows no numbers while counts load, and keeps a ticked tag that dropped to zero', () => {
        const known = rememberTags(new Map(), facets.tags);
        const selection = toggleFacet(emptySelection(), 'tag:CONCEPT', 't-vec');

        const loading = buildFacetGroups({
            t,
            topicNodes: [],
            topicsTitle: '',
            facets: undefined,
            selection,
            knownTags: known,
        });
        expect(loading.find((group) => group.key === 'difficulties')!.items[0]!.count).toBe(
            undefined
        );

        const dropped = buildFacetGroups({
            t,
            topicNodes: [],
            topicsTitle: '',
            facets: { ...facets, tags: [] },
            selection,
            knownTags: known,
        });
        const concept = dropped.find((group) => group.key === 'tag:CONCEPT')!;
        expect(concept.items).toEqual([{ value: 't-vec', label: 'Vectors', count: 0 }]);
        expect(activeFacetChips(dropped)).toEqual([
            { key: 'tag:CONCEPT', value: 't-vec', label: 'Vectors' },
        ]);
    });

    it('returns the same map when no tag is new, so state does not churn', () => {
        const known = rememberTags(new Map(), facets.tags);
        expect(rememberTags(known, facets.tags)).toBe(known);
        expect(rememberTags(known, undefined)).toBe(known);
    });
});
