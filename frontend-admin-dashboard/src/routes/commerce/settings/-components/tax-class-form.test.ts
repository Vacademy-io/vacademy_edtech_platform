import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
    EMPTY_RULE,
    EMPTY_TAX_CLASS,
    type TaxRuleValues,
    buildTaxClassSchema,
    slabsOverlap,
    taxClassToValues,
    valuesToTaxClassRequest,
} from './tax-class-form';

const t = ((key: string) => key) as unknown as TFunction;
const schema = buildTaxClassSchema(t);

const rule = (over: Partial<TaxRuleValues> = {}): TaxRuleValues => ({
    ...EMPTY_RULE,
    rate_percent: '5',
    effective_from: '2026-04-01',
    ...over,
});

const valid = (rules: TaxRuleValues[] = [rule()]) => ({
    name: 'Cotton fabric',
    code: 'COTTON',
    hsn_code: '5208',
    unit: 'MTR',
    rules,
});

const issues = (input: unknown) => {
    const result = schema.safeParse(input);
    return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

describe('tax class form', () => {
    it('nothing is pre-filled: no rate, HSN, unit or date', () => {
        expect(EMPTY_TAX_CLASS).toMatchObject({ name: '', code: '', hsn_code: '', unit: '' });
        expect(EMPTY_RULE).toMatchObject({
            rate_percent: '',
            cess_percent: '',
            effective_from: '',
        });
        expect(issues(EMPTY_TAX_CLASS).length).toBeGreaterThan(0);
    });

    it('accepts a complete class', () => {
        expect(issues(valid())).toEqual([]);
    });

    it('refuses a bad HSN, a rate over 100, a missing date and an upper price below the lower', () => {
        expect(issues({ ...valid(), hsn_code: '52080' })).toEqual([
            'hsn_code:taxClasses.validation.hsn',
        ]);
        expect(issues(valid([rule({ rate_percent: '101' })]))).toEqual([
            'rules.0.rate_percent:taxClasses.validation.rate',
        ]);
        expect(issues(valid([rule({ effective_from: '' })]))).toEqual([
            'rules.0.effective_from:taxClasses.validation.fromRequired',
        ]);
        expect(issues(valid([rule({ min_unit_price: '1000', max_unit_price: '1000' })]))).toEqual([
            'rules.0.max_unit_price:taxClasses.validation.maxAboveMin',
        ]);
        expect(issues(valid([rule({ effective_to: '2026-03-31' })]))).toEqual([
            'rules.0.effective_to:taxClasses.validation.toBeforeFrom',
        ]);
        expect(issues(valid([]))).toEqual(['rules:taxClasses.validation.oneSlab']);
    });

    it('slabs that meet at a price boundary do not overlap; slabs that share a price do', () => {
        const low = rule({ min_unit_price: '0', max_unit_price: '1000' });
        const high = rule({ min_unit_price: '1000', max_unit_price: '', rate_percent: '12' });
        expect(slabsOverlap([low, high])).toBe(false);
        expect(slabsOverlap([low, rule({ min_unit_price: '999.99', max_unit_price: '' })])).toBe(
            true
        );
        expect(slabsOverlap([rule(), rule()])).toBe(true);
    });

    it('the same price range in two periods that do not meet is allowed', () => {
        const old = rule({ effective_from: '2025-04-01', effective_to: '2026-03-31' });
        const current = rule({ effective_from: '2026-04-01', rate_percent: '12' });
        expect(slabsOverlap([old, current])).toBe(false);
        expect(
            slabsOverlap([
                rule({ effective_from: '2025-04-01', effective_to: '2026-04-01' }),
                current,
            ])
        ).toBe(true);
    });

    it('round trip: what the server sent is what is sent back', () => {
        const values = taxClassToValues({
            id: 'tc-1',
            code: 'cotton',
            name: 'Cotton',
            hsn_code: null,
            unit: 'mtr',
            status: 'ACTIVE',
            rules: [
                {
                    id: 'r-1',
                    min_unit_price: 0,
                    max_unit_price: 1000,
                    rate_percent: 5,
                    cess_percent: null,
                    effective_from: '2026-04-01',
                    effective_to: null,
                },
            ],
        });
        expect(values.code).toBe('COTTON');
        expect(valuesToTaxClassRequest(values)).toEqual({
            name: 'Cotton',
            code: 'COTTON',
            hsn_code: null,
            unit: 'MTR',
            rules: [
                {
                    id: 'r-1',
                    min_unit_price: 0,
                    max_unit_price: 1000,
                    rate_percent: 5,
                    cess_percent: null,
                    effective_from: '2026-04-01',
                    effective_to: null,
                },
            ],
        });
    });
});
