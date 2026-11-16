import { describe, expect, it } from 'vitest';
import {
    type VariantRowLike,
    combinationKey,
    countCombinations,
    duplicateSkus,
    generateCombinations,
    reconcileVariants,
    suggestSku,
} from './variant-combinations';

const size = { attributeId: 'size', valueIds: ['s', 'm', 'l'] };
const colour = { attributeId: 'colour', valueIds: ['red', 'blue'] };

const row = (
    sku: string,
    optionValues: Record<string, string>,
    saved = true,
    status = 'ACTIVE'
): VariantRowLike => ({
    package_session_id: saved ? `ps-${sku}` : '',
    sku,
    status,
    option_values: optionValues,
});

const create = (combination: Record<string, string>): VariantRowLike =>
    row(`NEW-${Object.values(combination).join('-')}`, combination, false);

describe('generateCombinations', () => {
    it('no options gives the one default variant', () => {
        expect(generateCombinations([])).toEqual([{}]);
        expect(countCombinations([])).toBe(1);
    });

    it('one option gives one row per ticked value, in order', () => {
        expect(generateCombinations([size])).toEqual([{ size: 's' }, { size: 'm' }, { size: 'l' }]);
    });

    it('two options give the full grid, first option slowest', () => {
        const rows = generateCombinations([colour, size]);
        expect(rows).toHaveLength(6);
        expect(rows[0]).toEqual({ colour: 'red', size: 's' });
        expect(rows[2]).toEqual({ colour: 'red', size: 'l' });
        expect(rows[3]).toEqual({ colour: 'blue', size: 's' });
        expect(countCombinations([colour, size])).toBe(6);
    });

    it('three options multiply', () => {
        const length = { attributeId: 'length', valueIds: ['short', 'long'] };
        expect(generateCombinations([colour, size, length])).toHaveLength(12);
    });

    it('an option with nothing ticked gives no rows at all', () => {
        expect(generateCombinations([size, { attributeId: 'colour', valueIds: [] }])).toEqual([]);
        expect(countCombinations([size, { attributeId: 'colour', valueIds: [] }])).toBe(0);
    });

    it('a value ticked twice counts once', () => {
        expect(generateCombinations([{ attributeId: 'size', valueIds: ['s', 's', 'm'] }])).toEqual([
            { size: 's' },
            { size: 'm' },
        ]);
    });

    it('never produces the same combination twice', () => {
        const keys = generateCombinations([colour, size]).map(combinationKey);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('combinationKey', () => {
    it('does not depend on key order', () => {
        expect(combinationKey({ size: 's', colour: 'red' })).toBe(
            combinationKey({ colour: 'red', size: 's' })
        );
    });

    it('tells different combinations apart', () => {
        expect(combinationKey({ size: 's' })).not.toBe(combinationKey({ size: 'm' }));
        expect(combinationKey({})).toBe('');
    });
});

describe('reconcileVariants', () => {
    it('keeps rows that are still wanted, untouched', () => {
        const small = row('K-S', { size: 's' });
        const result = reconcileVariants(
            [small],
            [{ attributeId: 'size', valueIds: ['s'] }],
            create
        );
        expect(result.rows).toEqual([small]);
        expect(result.rows[0]).toBe(small);
        expect(result).toMatchObject({ added: 0, archived: 0, restored: 0 });
    });

    it('adds a row for a newly ticked value', () => {
        const result = reconcileVariants([row('K-S', { size: 's' })], [size], create);
        expect(result.rows.map((r) => r.sku)).toEqual(['K-S', 'NEW-m', 'NEW-l']);
        expect(result.added).toBe(2);
    });

    it('archives a saved row that is no longer wanted, and keeps it', () => {
        const result = reconcileVariants(
            [row('K-S', { size: 's' }), row('K-M', { size: 'm' })],
            [{ attributeId: 'size', valueIds: ['s'] }],
            create
        );
        expect(result.rows.map((r) => [r.sku, r.status])).toEqual([
            ['K-S', 'ACTIVE'],
            ['K-M', 'ARCHIVED'],
        ]);
        expect(result.archived).toBe(1);
    });

    it('drops an unsaved row that is no longer wanted', () => {
        const result = reconcileVariants(
            [row('K-S', { size: 's' }), row('K-M', { size: 'm' }, false)],
            [{ attributeId: 'size', valueIds: ['s'] }],
            create
        );
        expect(result.rows.map((r) => r.sku)).toEqual(['K-S']);
        expect(result.archived).toBe(0);
    });

    it('brings an archived saved row back when its value is ticked again', () => {
        const result = reconcileVariants(
            [row('K-S', { size: 's' }), row('K-M', { size: 'm' }, true, 'ARCHIVED')],
            [{ attributeId: 'size', valueIds: ['s', 'm'] }],
            create
        );
        expect(result.rows.map((r) => [r.sku, r.status])).toEqual([
            ['K-S', 'ACTIVE'],
            ['K-M', 'ACTIVE'],
        ]);
        expect(result).toMatchObject({ added: 0, restored: 1 });
    });

    it('adding an option archives the old default variant and makes the grid', () => {
        const result = reconcileVariants([row('KURTA', {})], [size], create);
        expect(result.rows.map((r) => [r.sku, r.status])).toEqual([
            ['NEW-s', 'ACTIVE'],
            ['NEW-m', 'ACTIVE'],
            ['NEW-l', 'ACTIVE'],
            ['KURTA', 'ARCHIVED'],
        ]);
    });

    it('removing every option leaves one default row and archives the rest', () => {
        const result = reconcileVariants(
            [row('K-S', { size: 's' }), row('K-M', { size: 'm' })],
            [],
            create
        );
        expect(result.rows.filter((r) => r.status !== 'ARCHIVED')).toHaveLength(1);
        expect(result.rows.filter((r) => r.status === 'ARCHIVED').map((r) => r.sku)).toEqual([
            'K-S',
            'K-M',
        ]);
    });

    it('does not count an already archived leftover again', () => {
        const result = reconcileVariants(
            [row('K-S', { size: 's' }), row('K-M', { size: 'm' }, true, 'ARCHIVED')],
            [{ attributeId: 'size', valueIds: ['s'] }],
            create
        );
        expect(result.archived).toBe(0);
        expect(result.rows).toHaveLength(2);
    });

    it('prefers the saved row when two rows hold one combination', () => {
        const unsaved = row('DRAFT-S', { size: 's' }, false);
        const saved = row('K-S', { size: 's' });
        const result = reconcileVariants(
            [unsaved, saved],
            [{ attributeId: 'size', valueIds: ['s'] }],
            create
        );
        expect(result.rows.map((r) => r.sku)).toEqual(['K-S']);
    });

    it('is stable: running it twice changes nothing more', () => {
        const once = reconcileVariants([row('K-S', { size: 's' })], [size, colour], create);
        const twice = reconcileVariants(once.rows, [size, colour], create);
        expect(twice.rows).toEqual(once.rows);
        expect(twice).toMatchObject({ added: 0, archived: 0, restored: 0 });
    });
});

describe('suggestSku', () => {
    it('joins the base and the value codes', () => {
        expect(suggestSku('kurta', ['red', 'm'])).toBe('KURTA-RED-M');
    });

    it('drops what a SKU should not hold and empty parts', () => {
        expect(suggestSku('  Silk Saree! ', ['', 'deep_blue'])).toBe('SILK-SAREE-DEEP-BLUE');
        expect(suggestSku('', [])).toBe('');
    });

    it('is never longer than the server allows', () => {
        expect(suggestSku('A'.repeat(150), ['B'])).toHaveLength(100);
    });
});

describe('duplicateSkus', () => {
    it('finds skus used on two rows, ignoring blanks and outer spaces', () => {
        expect(
            duplicateSkus([{ sku: 'A' }, { sku: ' A ' }, { sku: 'B' }, { sku: '' }, { sku: '' }])
        ).toEqual(['A']);
    });

    it('compares exactly, as the server does', () => {
        expect(duplicateSkus([{ sku: 'a' }, { sku: 'A' }])).toEqual([]);
    });
});
