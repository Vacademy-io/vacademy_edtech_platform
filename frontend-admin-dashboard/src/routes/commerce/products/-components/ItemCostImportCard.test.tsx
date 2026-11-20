/**
 * WP-53 lane A, item-costs card: hidden with the switch-over feature off or for
 * warehouse staff; a checked file shows its errors and Load stays disabled
 * while any row has one; a clean file loads with the token validate gave; every
 * key the card asks for exists in English and Hindi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: null as unknown }));
vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
// save-blob pulls a native-app module the web test run does not have.
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('./item-cost-import-api', () => ({
    validateItemCosts: vi.fn(),
    commitItemCosts: vi.fn(),
    downloadItemCostTemplate: vi.fn(),
}));

import { COMMERCE_FEATURE, COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import * as api from './item-cost-import-api';
import type { ItemCostValidation } from './item-cost-import-api';
import { ItemCostImportCard, NS } from './ItemCostImportCard';

const mocked = vi.mocked(api);

const accessFor = (roles: string[], migration = true) => ({
    ...resolveCommerceAccess({
        roles,
        isFeatureOn: (key) => key !== COMMERCE_FEATURE.MIGRATION || migration,
    }),
    isResolved: true,
});

const validation = (extra: Partial<ItemCostValidation> = {}): ItemCostValidation => ({
    rows: 2,
    ok: 2,
    error_count: 0,
    errors: [],
    warning_count: 0,
    warnings: [],
    unchanged: 0,
    to_change: 2,
    sum_old: '0',
    sum_new: '1100',
    missing_after: { count: 0, skus: [] },
    spot_check: [
        {
            row: 2,
            sku: 'TST-0001',
            name: 'Sample item',
            price: '1180',
            includes_tax: true,
            rate: '18',
            cost: '1000',
            current_cost: null,
            unit: 'PCS',
            qty_scale: 1,
            cost_per_unit: '1000',
        },
    ],
    token: 'a'.repeat(64),
    tax_mode: 'REGULAR',
    tax_rule: 'REMOVE_INCLUDED_TAX',
    ...extra,
});

const chooseAndCheck = async () => {
    const input = screen.getByTestId('item-costs-file') as HTMLInputElement;
    const file = new File(['sku,purchase_price,includes_tax\n'], 'costs.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('validate'));
    await waitFor(() => expect(screen.getByTestId('item-costs-validation')).toBeTruthy());
    return file;
};

describe('ItemCostImportCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.access = accessFor([COMMERCE_ROLE.STORE_MANAGER]);
    });

    it('is hidden when the switch-over feature is off', () => {
        state.access = accessFor(['ADMIN'], false);
        const { container } = render(<ItemCostImportCard />);
        expect(container.innerHTML).toBe('');
    });

    it('is hidden for warehouse staff and the cashier, shown for the accountant and an admin', () => {
        state.access = accessFor([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        expect(render(<ItemCostImportCard />).container.innerHTML).toBe('');
        state.access = accessFor([COMMERCE_ROLE.POS_CASHIER]);
        expect(render(<ItemCostImportCard />).container.innerHTML).toBe('');
        state.access = accessFor([COMMERCE_ROLE.ACCOUNTANT]);
        render(<ItemCostImportCard />);
        expect(screen.getAllByText('title').length).toBe(1);
        state.access = accessFor(['ADMIN']);
        render(<ItemCostImportCard />);
        expect(screen.getAllByText('title').length).toBe(2);
    });

    it('renders the errors and keeps Load disabled while any row has one', async () => {
        mocked.validateItemCosts.mockResolvedValue(
            validation({
                ok: 1,
                error_count: 1,
                errors: [
                    {
                        row: 3,
                        column: 'includes_tax',
                        code: 'REQUIRED',
                        message: 'enter yes or no',
                        sku: 'TST-0002',
                    },
                ],
            })
        );
        render(<ItemCostImportCard />);
        await chooseAndCheck();
        const errors = screen.getByTestId('item-costs-errors');
        expect(errors.textContent).toContain('TST-0002');
        expect(errors.textContent).toContain('REQUIRED');
        expect(errors.textContent).toContain('enter yes or no');
        expect(screen.getByTestId('item-costs-load')).toBeDisabled();
        expect(screen.getByText('fixErrorsFirst')).toBeTruthy();
        fireEvent.click(screen.getByTestId('item-costs-load'));
        expect(mocked.commitItemCosts).not.toHaveBeenCalled();
    });

    it('shows the totals and spot check and loads with the token of the check', async () => {
        mocked.validateItemCosts.mockResolvedValue(validation());
        mocked.commitItemCosts.mockResolvedValue({
            rows: 2,
            changed: 2,
            already_done: 0,
            unchanged: 0,
            sum_old: '0',
            sum_new: '1100',
        });
        render(<ItemCostImportCard />);
        const file = await chooseAndCheck();
        expect(screen.getByTestId('item-costs-spot-check').textContent).toContain('TST-0001');
        expect(screen.getByTestId('item-costs-spot-check').textContent).toContain('1,000.00');
        const load = screen.getByTestId('item-costs-load');
        expect(load).not.toBeDisabled();
        fireEvent.click(load);
        await waitFor(() => expect(screen.getByTestId('item-costs-result')).toBeTruthy());
        expect(mocked.commitItemCosts).toHaveBeenCalledWith(file, 'a'.repeat(64));
        expect(screen.getByTestId('item-costs-load')).toBeDisabled();
    });

    it('shows the price per selling unit beside the cost stored per base unit, and the tax rule', async () => {
        mocked.validateItemCosts.mockResolvedValue(
            validation({
                tax_mode: 'UNREGISTERED',
                tax_rule: 'KEEP_TAX_IN_COST',
                spot_check: [
                    {
                        row: 2,
                        sku: 'TST-0009',
                        name: 'Sample cloth',
                        price: '120',
                        includes_tax: false,
                        rate: null,
                        cost: '12',
                        current_cost: null,
                        unit: 'MTR',
                        qty_scale: 10,
                        cost_per_unit: '120',
                    },
                ],
            })
        );
        render(<ItemCostImportCard />);
        await chooseAndCheck();
        const table = screen.getByTestId('item-costs-spot-check').textContent ?? '';
        expect(table).toContain('120.00');
        expect(table).toContain('12.00');
        expect(table).toContain('spotCheck.perBaseUnit');
        expect(screen.getByTestId('item-costs-tax-rule').textContent).toBe('taxRule.KEEP_TAX_IN_COST');
    });
});

describe('item-costs strings exist in English and Hindi', () => {
    type Tree = { [key: string]: Tree | string };
    const root = path.resolve(__dirname, '../../../../..');
    const load = (lng: string): Record<string, string> => {
        const tree = JSON.parse(
            fs.readFileSync(path.join(root, 'public/locales', lng, `${NS}.json`), 'utf8')
        ) as Tree;
        const out: Record<string, string> = {};
        const walk = (node: Tree, prefix: string) =>
            Object.entries(node).forEach(([key, value]) => {
                const full = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'string') out[full] = value;
                else walk(value, full);
            });
        walk(tree, '');
        return out;
    };
    const en = load('en');
    const hi = load('hi');
    const placeholders = (text: string) => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort();

    it('both languages have the same keys, placeholders, and Hindi is Devanagari', () => {
        expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
        Object.keys(en).forEach((key) => {
            expect(en[key]?.trim(), key).toBeTruthy();
            expect(hi[key], key).toMatch(/[ऀ-ॿ]|^(SKU|GST.*|.*Excel.*|.*CSV.*)$/);
            expect(placeholders(hi[key] ?? ''), key).toEqual(placeholders(en[key] ?? ''));
        });
    });

    it('every key the card asks for exists', () => {
        const source = fs.readFileSync(path.join(__dirname, 'ItemCostImportCard.tsx'), 'utf8');
        const literal = [...source.matchAll(/\btr\(\s*'([^'\n]+)'/g)].map((m) => m[1] ?? '');
        const built = [
            ...['row', 'item', 'column', 'code', 'message'].map((c) => `columns.${c}`),
            ...['row', 'sku', 'name', 'price', 'includesTax', 'rate', 'costPerUnit', 'cost', 'current'].map(
                (c) => `spotCheck.columns.${c}`
            ),
            ...['REMOVE_INCLUDED_TAX', 'KEEP_TAX_IN_COST'].map((r) => `taxRule.${r}`),
        ];
        expect(literal.length).toBeGreaterThan(25);
        [...literal, ...built].forEach((key) => {
            expect(typeof en[key], `en ${key}`).toBe('string');
            expect(typeof hi[key], `hi ${key}`).toBe('string');
        });
    });
});
