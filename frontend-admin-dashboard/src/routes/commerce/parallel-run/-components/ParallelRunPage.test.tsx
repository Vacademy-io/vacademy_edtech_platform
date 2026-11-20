/**
 * WP-53 lane D, switch-over days page: one row per day with the server's
 * figures, the streak banner ("n of 7"), inline entry for a manager only, the
 * server's refusals worded (NOTE_REQUIRED, SESSION_OPEN), nothing asked while
 * the migration feature is off. Neutral data only ("Test Store").
 */
import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('@/routes/commerce/reports/-components/report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
vi.mock('@/routes/commerce/-components/CommercePage', () => ({
    CommercePage: ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
        <div>
            <h2>{title}</h2>
            <div>{actions}</div>
            {children}
        </div>
    ),
}));
const who = vi.hoisted(() => ({ roles: ['COMMERCE_STORE_MANAGER'] as string[], off: [] as string[] }));
vi.mock('@/lib/commerce/use-commerce-access', async () => {
    const { resolveCommerceAccess } = await import('@/lib/commerce/commerce-access');
    return {
        useCommerceAccess: () => ({
            ...resolveCommerceAccess({ roles: who.roles, isFeatureOn: (key: string) => !who.off.includes(key) }),
            isResolved: true,
        }),
    };
});
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/routes/commerce/products/-components/ItemCostImportCard', () => ({
    ItemCostImportCard: () => <div data-testid="item-cost-card" />,
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('@/routes/commerce/reports/-shared/reports-api', () => ({
    fetchReportPlaces: vi.fn(async () => ({
        places: [{ id: 'loc-1', name: 'Test Store', code: 'TST', gstin: null }],
        allPlaces: false,
    })),
}));
vi.mock('../-shared/parallel-run-api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../-shared/parallel-run-api')>();
    return {
        ...real,
        fetchParallelRunDays: vi.fn(),
        saveParallelRunDay: vi.fn(),
        downloadParallelRun: vi.fn(),
    };
});

import * as reportsApi from '@/routes/commerce/reports/-shared/reports-api';
import { renderWithQuery, serverError } from '@/routes/commerce/reports/-components/report-test-kit';
import * as api from '../-shared/parallel-run-api';
import { normalizeDays, saveDayBody } from '../-shared/parallel-run-api';
import fs from 'node:fs';
import path from 'node:path';
import {
    draftProblems,
    draftToInput,
    ERROR_FALLBACKS,
    ParallelRunPage,
    recentMonths,
    SAVE_ERROR_CODES,
} from './ParallelRunPage';

const fetchDays = vi.mocked(api.fetchParallelRunDays);
const saveDay = vi.mocked(api.saveParallelRunDay);
const fetchPlaces = vi.mocked(reportsApi.fetchReportPlaces);

/** The server's JSON of `GET /parallel-run/days` (snake_case). */
const DAYS_JSON = {
    location_id: 'loc-1',
    from: '2026-11-01',
    to: '2026-11-02',
    today: '2026-11-20',
    days: [
        {
            date: '2026-11-01',
            status: 'CLEAN',
            platform: { bills: 2, sales_value: 800.0, tax: 38.1, cash: 400.0, returns: 0, open_sessions: 0 },
            old: { bill_count: 2, sales_value: 800.0, tax: 38.1, cash: 400.0, returns: null },
            difference: { bills: 0, sales_value: 0, tax: 0, cash: 0, returns: null },
            result: 'CLEAN',
            platform_changed: false,
            counts_clean: true,
            note: null,
            reviewed_by: 'u-1',
            reviewed_by_name: 'Test Manager',
            reviewed_at: '2026-11-01T21:10:00+05:30',
            version: 0,
        },
        {
            date: '2026-11-02',
            status: 'NOT_SAVED',
            platform: { bills: 5, sales_value: '1250.00', tax: '59.52', cash: '700.00', returns: '0.00', open_sessions: 1 },
            old: null,
            difference: null,
            result: null,
            platform_changed: false,
            counts_clean: false,
            note: null,
            reviewed_by: null,
            reviewed_by_name: null,
            reviewed_at: null,
            version: null,
        },
    ],
    streak: 3,
    passed: false,
    clean_days_needed: 7,
    latest_saved: '2026-11-01',
    tolerance: 1.0,
    as_of: '2026-11-20T10:00:00+05:30',
};

describe('ParallelRunPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        who.roles = ['COMMERCE_STORE_MANAGER'];
        who.off = [];
        fetchDays.mockResolvedValue(normalizeDays(DAYS_JSON));
    });

    it('shows one row per day and the streak as "n of 7"', async () => {
        renderWithQuery(<ParallelRunPage />);
        expect(await screen.findByTestId('parallel-run-day-2026-11-01')).toBeTruthy();
        expect(screen.getByTestId('parallel-run-day-2026-11-02')).toBeTruthy();
        expect(screen.getByTestId('parallel-run-streak').textContent).toBe('commerceParallelRun:streak.progress 3 7');
        expect(screen.getByText('commerceParallelRun:status.CLEAN')).toBeTruthy();
        expect(screen.getByText('commerceParallelRun:status.NOT_SAVED')).toBeTruthy();
        expect(screen.getByText('commerceParallelRun:openSessions 1')).toBeTruthy();
        expect(fetchDays).toHaveBeenCalledWith('loc-1', expect.any(String), expect.any(String));
    });

    it('a passed run says so', async () => {
        fetchDays.mockResolvedValue(normalizeDays({ ...DAYS_JSON, streak: 7, passed: true }));
        renderWithQuery(<ParallelRunPage />);
        await waitFor(() => expect(screen.getByTestId('parallel-run-streak').textContent).toBe('commerceParallelRun:streak.passed 7 7'));
    });

    it('a manager enters a day; the body carries the figures and the version', async () => {
        saveDay.mockResolvedValue(normalizeDays(DAYS_JSON).days[0]!);
        renderWithQuery(<ParallelRunPage />);
        fireEvent.click(await screen.findByTestId('parallel-run-edit-2026-11-02'));
        fireEvent.change(screen.getByTestId('parallel-run-input-bills'), { target: { value: '5' } });
        fireEvent.change(screen.getByTestId('parallel-run-input-sales'), { target: { value: '1,250.00' } });
        fireEvent.change(screen.getByTestId('parallel-run-input-tax'), { target: { value: '59.52' } });
        fireEvent.change(screen.getByTestId('parallel-run-input-cash'), { target: { value: '700' } });
        fireEvent.click(screen.getByTestId('parallel-run-save'));
        await waitFor(() => expect(saveDay).toHaveBeenCalledTimes(1));
        expect(saveDay).toHaveBeenCalledWith('loc-1', '2026-11-02', {
            oldBillCount: 5,
            oldSalesValue: '1250.00',
            oldTax: '59.52',
            oldCash: '700',
            oldReturns: null,
            note: null,
            version: null,
        });
    });

    it('the server asking for a note is worded, and nothing is saved twice', async () => {
        saveDay.mockRejectedValue(serverError(400, 'NOTE_REQUIRED: the figures differ; write a note on why'));
        renderWithQuery(<ParallelRunPage />);
        fireEvent.click(await screen.findByTestId('parallel-run-edit-2026-11-01'));
        fireEvent.change(screen.getByTestId('parallel-run-input-sales'), { target: { value: '805' } });
        fireEvent.click(screen.getByTestId('parallel-run-save'));
        expect((await screen.findByTestId('parallel-run-save-error')).textContent).toBe('commerceParallelRun:errors.NOTE_REQUIRED');
        expect(saveDay).toHaveBeenCalledWith('loc-1', '2026-11-01', expect.objectContaining({ version: 0 }));
    });

    it('an open counter session is worded', async () => {
        saveDay.mockRejectedValue(serverError(409, 'SESSION_OPEN: a counter session is still open'));
        renderWithQuery(<ParallelRunPage />);
        fireEvent.click(await screen.findByTestId('parallel-run-edit-2026-11-01'));
        fireEvent.click(screen.getByTestId('parallel-run-save'));
        expect((await screen.findByTestId('parallel-run-save-error')).textContent).toBe('commerceParallelRun:errors.SESSION_OPEN');
    });

    it('bad boxes are marked and not sent', async () => {
        renderWithQuery(<ParallelRunPage />);
        fireEvent.click(await screen.findByTestId('parallel-run-edit-2026-11-02'));
        fireEvent.change(screen.getByTestId('parallel-run-input-bills'), { target: { value: '2.5' } });
        fireEvent.click(screen.getByTestId('parallel-run-save'));
        expect(await screen.findByText('commerceParallelRun:form.invalid.bills')).toBeTruthy();
        expect(saveDay).not.toHaveBeenCalled();
    });

    it('the accountant reads but has no entry buttons', async () => {
        who.roles = ['COMMERCE_ACCOUNTANT'];
        renderWithQuery(<ParallelRunPage />);
        expect(await screen.findByTestId('parallel-run-day-2026-11-01')).toBeTruthy();
        expect(screen.queryByTestId('parallel-run-edit-2026-11-01')).toBeNull();
        expect(screen.queryByTestId('parallel-run-edit-2026-11-02')).toBeNull();
    });

    it('the accountant gets the item-costs card here; a manager and an admin load costs on the import page', async () => {
        who.roles = ['COMMERCE_ACCOUNTANT'];
        const first = renderWithQuery(<ParallelRunPage />);
        expect(await screen.findByTestId('item-cost-card')).toBeTruthy();
        first.unmount();
        for (const roles of [['COMMERCE_STORE_MANAGER'], ['ADMIN'], ['COMMERCE_ACCOUNTANT', 'COMMERCE_STORE_MANAGER']]) {
            who.roles = roles;
            const view = renderWithQuery(<ParallelRunPage />);
            expect(await screen.findByTestId('parallel-run-day-2026-11-01')).toBeTruthy();
            expect(screen.queryByTestId('item-cost-card')).toBeNull();
            view.unmount();
        }
    });

    it('no item-costs card for the accountant while the migration feature is off', async () => {
        who.roles = ['COMMERCE_ACCOUNTANT'];
        who.off = ['commerce.migration'];
        renderWithQuery(<ParallelRunPage />);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(screen.queryByTestId('item-cost-card')).toBeNull();
    });

    it('asks nothing while the migration feature is off', async () => {
        who.off = ['commerce.migration'];
        renderWithQuery(<ParallelRunPage />);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(fetchPlaces).not.toHaveBeenCalled();
        expect(fetchDays).not.toHaveBeenCalled();
    });
});

describe('parallel-run logic', () => {
    it('draft problems: whole bills, two decimals, cash may be negative, returns optional', () => {
        const ok = { bills: '3', sales: '1,200.50', tax: '57.17', cash: '-20', returns: '', note: '' };
        expect(draftProblems(ok)).toEqual([]);
        expect(draftProblems({ ...ok, bills: '-1', sales: '1.234', tax: '', returns: 'x' })).toEqual([
            'bills',
            'sales',
            'tax',
            'returns',
        ]);
        expect(draftProblems({ ...ok, note: 'a'.repeat(501) })).toEqual(['note']);
        expect(draftToInput({ ...ok, returns: ' 10 ' }, 4)).toEqual({
            oldBillCount: 3,
            oldSalesValue: '1200.50',
            oldTax: '57.17',
            oldCash: '-20',
            oldReturns: '10',
            note: null,
            version: 4,
        });
    });

    it('the PUT body leaves out empty returns, a blank note and a missing version', () => {
        expect(saveDayBody({ oldBillCount: 2, oldSalesValue: '800', oldTax: '38.10', oldCash: '400', oldReturns: null, note: '  ' }))
            .toEqual({ old_bill_count: 2, old_sales_value: '800', old_tax: '38.10', old_cash: '400' });
        expect(saveDayBody({ oldBillCount: 2, oldSalesValue: '800', oldTax: '38.10', oldCash: '400', oldReturns: '5', note: 'why', version: 1 }))
            .toEqual({ old_bill_count: 2, old_sales_value: '800', old_tax: '38.10', old_cash: '400', old_returns: '5', note: 'why', version: 1 });
    });

    it('reads the answer in the server names and keeps money as text', () => {
        const days = normalizeDays(DAYS_JSON);
        expect(days.streak).toBe(3);
        expect(days.cleanDaysNeeded).toBe(7);
        expect(days.days[0]!.platform.salesValue).toBe('800.00');
        expect(days.days[0]!.old?.returns).toBeNull();
        expect(days.days[1]!.platform.openSessions).toBe(1);
        expect(days.days[1]!.old).toBeNull();
    });

    it('offers this month and the eleven before it', () => {
        const months = recentMonths('2026-02-10');
        expect(months).toHaveLength(12);
        expect(months[0]).toBe('2026-02');
        expect(months[2]).toBe('2025-12');
    });
});

describe('parallel-run strings', () => {
    type Tree = { [key: string]: Tree | string };
    const load = (lng: string): Record<string, string> => {
        const file = path.resolve(__dirname, `../../../../../public/locales/${lng}/commerceParallelRun.json`);
        const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
            Object.entries(tree).reduce<Record<string, string>>((out, [key, value]) => {
                const full = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'string') out[full] = value;
                else Object.assign(out, flatten(value, full));
                return out;
            }, {});
        return flatten(JSON.parse(fs.readFileSync(file, 'utf8')) as Tree);
    };
    const en = load('en');
    const hi = load('hi');
    const placeholders = (text: string) => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort();

    it('English and Hindi have the same keys, the same placeholders, and the Hindi is Hindi', () => {
        expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
        Object.keys(en).forEach((key) => {
            expect(en[key]?.trim(), `en ${key}`).toBeTruthy();
            expect(hi[key], `hi ${key}`).toMatch(/[\u0900-\u097F]/);
            expect(placeholders(hi[key] ?? ''), key).toEqual(placeholders(en[key] ?? ''));
        });
    });

    it('every refusal the page words and every status has a sentence', () => {
        [...SAVE_ERROR_CODES, ...ERROR_FALLBACKS].forEach((code) => {
            expect(en[`errors.${code}`], code).toBeTruthy();
            expect(hi[`errors.${code}`], code).toBeTruthy();
        });
        ['CLEAN', 'DIFFERENT', 'RECHECK', 'NOT_SAVED', 'NO_SALES'].forEach((status) =>
            expect(en[`status.${status}`] && hi[`status.${status}`], status).toBeTruthy()
        );
    });
});
