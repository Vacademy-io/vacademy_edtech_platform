/**
 * WP-53 opening-stock panel: each status renders with its sentence, the panel is absent while
 * the switch-over feature is off (and asks nothing), warehouse staff see no money, the links
 * go to Receive / Labels / Counts, and the readiness answer is normalised.
 */
import fs from 'node:fs';
import path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: null as unknown }));
vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, string>) =>
            values ? `${key} ${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(' ')}` : key,
        i18n: { language: 'en' },
    }),
}));
vi.mock('../-shared/inventory-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../-shared/inventory-api')>();
    return { ...actual, fetchOpeningReadiness: vi.fn() };
});

import { COMMERCE_FEATURE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import * as api from '../-shared/inventory-api';
import { accessFor, MANAGER, WAREHOUSE } from '../-shared/inventory-test-fixtures';
import { OPENING_STATUSES, type OpeningReadiness, type OpeningStatus } from '../-shared/inventory-types';
import { OpeningStockPanel } from './OpeningStockPanel';

const fetchReadiness = vi.mocked(api.fetchOpeningReadiness);

const readiness = (status: OpeningStatus, overrides: Partial<OpeningReadiness> = {}): OpeningReadiness => ({
    location_id: 'L1',
    status,
    ready: status === 'PASSED',
    blockers: [],
    items: { tracked: 20, with_cost: 20, without_cost: 0, without_cost_skus: [], untracked: 1 },
    receipts: { count: 1, lines: 20, units: 40, units_costed: 40, value: 4000, uncosted_receipts: [] },
    recount:
        status === 'PASSED' || status === 'RECOUNT_FAILED'
            ? {
                  recount_id: 'rc-1',
                  recount_number: 'CNT-000002',
                  count_id: 'c-1',
                  count_number: 'CNT-000001',
                  main_lines: 20,
                  compared: 2,
                  agreeing: status === 'PASSED' ? 2 : 1,
                  percent: status === 'PASSED' ? 100 : 50,
                  sample_percent: 10,
                  sample_needed: 2,
                  sample_ok: true,
                  agreement_ok: status === 'PASSED',
                  passes: status === 'PASSED',
              }
            : null,
    sees_cost: true,
    ...overrides,
});

const renderPanel = (locationId: string | null = 'L1', onGo = vi.fn()) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <OpeningStockPanel locationId={locationId} onGo={onGo} />
        </QueryClientProvider>
    );
    return onGo;
};

describe('OpeningStockPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.access = accessFor(MANAGER);
    });

    it.each(OPENING_STATUSES)('%s renders its chip and sentence', async (status) => {
        fetchReadiness.mockResolvedValue(readiness(status));
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('opening-status').textContent).toBe(`status.${status}`));
        expect(screen.getByText(`statusHelp.${status}`)).toBeTruthy();
        expect(fetchReadiness).toHaveBeenCalledWith('L1');
    });

    it('is absent and asks nothing while the switch-over feature is off', () => {
        state.access = {
            ...resolveCommerceAccess({
                roles: MANAGER,
                isFeatureOn: (key) => key !== COMMERCE_FEATURE.MIGRATION,
            }),
            isResolved: true,
        };
        renderPanel();
        expect(screen.queryByTestId('opening-stock-panel')).toBeNull();
        expect(fetchReadiness).not.toHaveBeenCalled();
    });

    it('is absent for "all my locations"', () => {
        renderPanel(null);
        expect(screen.queryByTestId('opening-stock-panel')).toBeNull();
        expect(fetchReadiness).not.toHaveBeenCalled();
    });

    it('shows the value to a manager', async () => {
        fetchReadiness.mockResolvedValue(readiness('RECEIVING'));
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('opening-value').textContent).toContain('4,000.00'));
    });

    it('shows warehouse staff no money', async () => {
        state.access = accessFor(WAREHOUSE);
        fetchReadiness.mockResolvedValue(
            readiness('RECEIVING', {
                sees_cost: false,
                receipts: { count: 1, lines: 20, units: 40, units_costed: 40, value: null, uncosted_receipts: [] },
            })
        );
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('opening-status')).toBeTruthy());
        expect(screen.queryByTestId('opening-value')).toBeNull();
        expect(screen.getByTestId('opening-stock-panel').textContent).not.toContain('₹');
    });

    it('lists the blockers with the SKUs and receipt numbers they name', async () => {
        fetchReadiness.mockResolvedValue(
            readiness('RECOUNT_FAILED', {
                blockers: ['COSTS_MISSING', 'UNCOSTED_OPENING_RECEIPT', 'SAMPLE_TOO_SMALL'],
                items: {
                    tracked: 20,
                    with_cost: 13,
                    without_cost: 7,
                    without_cost_skus: ['TST-0001', 'TST-0002', 'TST-0003', 'TST-0004', 'TST-0005', 'TST-0006', 'TST-0007'],
                    untracked: 0,
                },
                receipts: {
                    count: 1,
                    lines: 20,
                    units: 40,
                    units_costed: 0,
                    value: null,
                    uncosted_receipts: [{ id: 'r-1', receipt_number: 'GRN-000001', received_date: '2026-11-16', lines: 20, units: 40 }],
                },
            })
        );
        renderPanel();
        const list = await screen.findByTestId('opening-blockers');
        expect(list.textContent).toContain('blockers.COSTS_MISSING items=7');
        expect(list.textContent).toContain('TST-0005, …');
        expect(list.textContent).not.toContain('TST-0006');
        expect(list.textContent).toContain('GRN-000001');
        expect(list.textContent).toContain('blockers.SAMPLE_TOO_SMALL compared=2 needed=2');
    });

    it('links to Receive, Labels and Counts', async () => {
        fetchReadiness.mockResolvedValue(readiness('NOT_STARTED', { receipts: { count: 0, lines: 0, units: 0, units_costed: 0, value: null, uncosted_receipts: [] } }));
        const onGo = renderPanel();
        fireEvent.click(await screen.findByText('actions.receive'));
        fireEvent.click(screen.getByText('actions.labels'));
        fireEvent.click(screen.getByText('actions.counts'));
        expect(onGo.mock.calls.map((c) => c[0])).toEqual(['receive', 'labels', 'counts']);
    });
});

describe('normalizeOpeningReadiness', () => {
    it('reads numbers, drops unknown blockers and keeps a missing value as null', () => {
        const read = api.normalizeOpeningReadiness({
            location_id: 'L1',
            status: 'COUNTING',
            ready: false,
            blockers: ['COSTS_MISSING', 'SOMETHING_ELSE'],
            items: { tracked: '20', with_cost: 18, without_cost: 2, without_cost_skus: ['TST-0001', null], untracked: 0 },
            receipts: { count: 1, lines: 20, units: 40, units_costed: 38 },
            recount: { recount_id: 'rc-1', compared: 2, main_lines: 20, percent: 97.9, sample_percent: 10, passes: false },
            sees_cost: false,
        });
        expect(read.status).toBe('COUNTING');
        expect(read.blockers).toEqual(['COSTS_MISSING']);
        expect(read.items.tracked).toBe(20);
        expect(read.items.without_cost_skus).toEqual(['TST-0001']);
        expect(read.receipts.value).toBeNull();
        expect(read.recount?.percent).toBe(97.9);
        expect(api.normalizeOpeningReadiness({ status: 'WHATEVER' }).status).toBe('NOT_STARTED');
    });
});

describe('opening-stock strings', () => {
    const LOCALES = path.resolve(__dirname, '../../../../../public/locales');
    const flatten = (tree: Record<string, unknown>, prefix = ''): Record<string, string> =>
        Object.entries(tree).reduce<Record<string, string>>((out, [key, value]) => {
            const full = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'string') out[full] = value;
            else Object.assign(out, flatten(value as Record<string, unknown>, full));
            return out;
        }, {});
    const load = (lng: string) =>
        flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, lng, 'commerceOpeningStock.json'), 'utf8')));
    const placeholders = (text: string) => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort();

    it('English and Hindi have the same keys and placeholders, and the Hindi is Hindi', () => {
        const en = load('en');
        const hi = load('hi');
        expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
        Object.keys(en).forEach((key) => {
            expect(placeholders(hi[key] ?? ''), key).toEqual(placeholders(en[key] ?? ''));
            expect(hi[key], key).toMatch(/[ऀ-ॿ]|^{{\s*\w+\s*}}%$/);
        });
    });

    it('every key the panel asks for exists in both languages', () => {
        const source = fs.readFileSync(path.join(__dirname, 'OpeningStockPanel.tsx'), 'utf8');
        const literal = [...source.matchAll(/\btr\(\s*'([^'\n]+)'/g)].map((m) => m[1] as string);
        const built = OPENING_STATUSES.flatMap((s) => [`status.${s}`, `statusHelp.${s}`]).concat(
            ['COSTS_MISSING', 'UNCOSTED_OPENING_RECEIPT', 'SAMPLE_TOO_SMALL', 'AGREEMENT_BELOW_98'].map((b) => `blockers.${b}`)
        );
        expect(literal.length).toBeGreaterThan(10);
        ['en', 'hi'].forEach((lng) => {
            const map = load(lng);
            [...literal, ...built].forEach((key) => expect(map[key], `${lng} ${key}`).toBeTruthy());
        });
    });
});
