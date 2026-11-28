import { describe, expect, it } from 'vitest';
import type { FolderNode } from '../../-services/folder-library-service';
import { collectPathLeaves, pathSteps, pathTotal, versionLabels, type PathMapping } from './learning-path-utils';

const m = (over: Partial<PathMapping>): PathMapping => ({
    status: 'ACTIVE',
    payment_plan: { actual_price: 100, currency: 'INR' },
    ...over,
});

describe('pathSteps', () => {
    it('orders steps by display_order and folds language versions into one step', () => {
        const steps = pathSteps([
            m({ id: '3', package_id: 'c2', package_name: 'Vedas', level_name: 'English', display_order: 2 }),
            m({ id: '1', package_id: 'c1', package_name: 'Yoga', level_name: 'Hindi', display_order: 0 }),
            m({ id: '2', package_id: 'c1', package_name: 'Yoga', level_name: 'English', display_order: 1 }),
            m({ id: 'x', package_id: 'c3', package_name: 'Gone', display_order: 0, status: 'INACTIVE' }),
        ]);
        expect(steps.map((s) => s.title)).toEqual(['Yoga', 'Vedas']);
        expect(steps[0]!.versions.map((v) => v.id)).toEqual(['1', '2']);
        expect(versionLabels(steps[0]!)).toEqual(['Hindi', 'English']);
    });

    it('keeps arrival order for equal display_order and copes with nothing', () => {
        const steps = pathSteps([
            m({ id: 'a', package_id: 'A', package_name: 'A', display_order: 0 }),
            m({ id: 'b', package_id: 'B', package_name: 'B', display_order: 0 }),
        ]);
        expect(steps.map((s) => s.courseId)).toEqual(['A', 'B']);
        expect(pathSteps(undefined)).toEqual([]);
    });

    it('drops placeholder level names from the version chips', () => {
        const [step] = pathSteps([m({ package_id: 'A', level_name: 'DEFAULT' }), m({ package_id: 'A', level_name: 'Hindi' })]);
        expect(versionLabels(step!)).toEqual(['Hindi']);
    });
});

describe('pathTotal', () => {
    it('adds the first version price of every step', () => {
        const steps = pathSteps([
            m({ package_id: 'A', payment_plan: { actual_price: 499, currency: 'INR' } }),
            m({ package_id: 'A', payment_plan: { actual_price: 999, currency: 'INR' } }),
            m({ package_id: 'B', payment_plan: { actual_price: 0, currency: 'INR' } }),
            m({ package_id: 'C', payment_plan: { actual_price: 1, currency: 'INR' } }),
        ]);
        expect(pathTotal(steps)).toEqual({ total: 500, currency: 'INR' });
    });

    it('gives no total for mixed currencies or no prices', () => {
        const mixed = pathSteps([
            m({ package_id: 'A', payment_plan: { actual_price: 5, currency: 'INR' } }),
            m({ package_id: 'B', payment_plan: { actual_price: 5, currency: 'USD' } }),
        ]);
        expect(pathTotal(mixed)).toBeNull();
        expect(pathTotal(pathSteps([m({ package_id: 'A', payment_plan: null })]))).toBeNull();
    });
});

const node = (over: Partial<FolderNode>): FolderNode => ({
    id: 'n',
    node_type: 'FOLDER',
    display_order: 0,
    status: 'ACTIVE',
    children: [],
    ...over,
});
const page = (id: string, over: Partial<FolderNode> = {}): FolderNode =>
    node({ id, node_type: 'PRODUCT_PAGE', product_page_code: `code-${id}`, product_page_status: 'ACTIVE', ...over });

describe('collectPathLeaves', () => {
    const roots = [
        node({
            id: 'shiksha',
            title: 'Shiksha',
            children: [
                page('p1'),
                node({ id: 'cat', title: 'Vedas', children: [page('p2'), page('draft', { product_page_status: 'DRAFT' })] }),
                node({ id: 'hidden', status: 'HIDDEN', children: [page('p3')] }),
            ],
        }),
        node({ id: 'dharma', title: 'Dharma', children: [page('p4'), page('p5', { status: 'HIDDEN' })] }),
        page('top'),
    ];

    it('lists every live product page with its stream, in tree order', () => {
        const leaves = collectPathLeaves(roots);
        expect(leaves.map((l) => l.node.id)).toEqual(['p1', 'p2', 'p4', 'top']);
        expect(leaves.map((l) => l.stream?.id ?? null)).toEqual(['shiksha', 'shiksha', 'dharma', null]);
    });

    it('limits to a start folder and keeps the stream of nested folders', () => {
        expect(collectPathLeaves(roots, 'cat').map((l) => [l.node.id, l.stream?.id])).toEqual([['p2', 'shiksha']]);
        expect(collectPathLeaves(roots, 'dharma').map((l) => l.node.id)).toEqual(['p4']);
    });

    it('shows nothing for a hidden or missing start folder', () => {
        expect(collectPathLeaves(roots, 'hidden')).toEqual([]);
        expect(collectPathLeaves(roots, 'nope')).toEqual([]);
    });

    // The live section (learner collectPathEntries / pathsInScope) follows the same three rules.
    const withComingSoon = [
        node({
            id: 'ayurveda',
            title: 'Ayurveda',
            coming_soon: true,
            children: [page('soon1'), node({ id: 'herbs', children: [page('soon2')] })],
        }),
        node({ id: 'yoga', title: 'Yoga', children: [page('y1')] }),
    ];

    it('does not open coming-soon folders: what is inside has not launched', () => {
        expect(collectPathLeaves(withComingSoon).map((l) => l.node.id)).toEqual(['y1']);
    });

    it('shows nothing when the start folder itself is coming soon', () => {
        expect(collectPathLeaves(withComingSoon, 'ayurveda')).toEqual([]);
        expect(collectPathLeaves(withComingSoon, 'yoga').map((l) => l.node.id)).toEqual(['y1']);
    });

    it('lists a product page placed in two folders once, where it first appears', () => {
        const twice = [
            node({ id: 'a', children: [page('first', { product_page_code: 'shared' })] }),
            node({ id: 'b', children: [page('second', { product_page_code: ' shared ' }), page('other')] }),
        ];
        expect(collectPathLeaves(twice).map((l) => [l.node.id, l.stream?.id])).toEqual([
            ['first', 'a'],
            ['other', 'b'],
        ]);
    });
});
