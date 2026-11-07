import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));

// The test environment ships without Web Storage; a plain map is all the hook needs.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
});

import { emptyPaymentSummary } from '../paymentSummary';
import { PaymentKpiCards, type KpiBilling } from '../../-components/PaymentKpiCards';
import {
    KpiCardSettings,
    defaultVisibleKpiCards,
    useKpiCardPrefs,
} from '../../-components/KpiCardSettings';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Vasco runs instalment plans whose next instalment is weeks away, so the 30-day Upcoming read ₹0
 * next to an Outstanding of lakhs — three cards, all describing the same money differently. An
 * instalment institute now sees every future instalment under Upcoming and no separate
 * Outstanding; everyone else keeps the row they had. Admins can pick the cards themselves.
 */

const billing = (over: Partial<KpiBilling> = {}): KpiBilling => ({
    collected: 450000,
    due: 0,
    upcoming: 0,
    upcomingDays: 30,
    learnersOwing: 0,
    learnersUpcoming: 0,
    activatedWithoutPaymentCount: 0,
    outstanding: 845000,
    learnersOutstanding: 23,
    upcomingAll: 845000,
    learnersUpcomingAll: 23,
    nextDueDate: '2026-11-06',
    usesInstallments: true,
    currency: 'INR',
    ...over,
});

describe('default cards', () => {
    it('instalment institute: Upcoming replaces Outstanding', () => {
        const keys = defaultVisibleKpiCards(billing());
        expect(keys.has('outstanding')).toBe(false);
        expect([...keys]).toEqual(['paid', 'due', 'upcoming', 'pending', 'failed']);
    });

    it('subscription institute (Suchbliss): exactly the old row', () => {
        const suchbliss = billing({
            usesInstallments: false,
            due: 7299,
            outstanding: 7299,
            upcoming: 23400,
            upcomingAll: 23400,
        });
        expect([...defaultVisibleKpiCards(suchbliss)]).toEqual([
            'paid',
            'due',
            'upcoming',
            'pending',
            'failed',
        ]);
    });

    it('non-instalment institute with future invoices still gets Outstanding', () => {
        const keys = defaultVisibleKpiCards(
            billing({ usesInstallments: false, due: 100, outstanding: 500 })
        );
        expect(keys.has('outstanding')).toBe(true);
    });
});

describe('Upcoming card for instalments', () => {
    it('shows every future instalment and the next due date, not the 30-day ₹0', () => {
        render(
            <PaymentKpiCards
                summary={emptyPaymentSummary()}
                billing={billing()}
                visibleKeys={defaultVisibleKpiCards(billing())}
            />
        );
        expect(screen.queryByText('Outstanding')).toBeNull();
        expect(screen.getByText('Upcoming')).toBeTruthy();
        expect(screen.getByText(/845,000/)).toBeTruthy();
        expect(screen.getByText(/23 learners · next due 6 Nov/)).toBeTruthy();
    });

    it("names the year when the next due date is not this year's", () => {
        // "next due 6 Sept" on 27 Sept read as a date already gone; it was 6 Sept of next year.
        const nextYear = new Date().getFullYear() + 1;
        const data = billing({ nextDueDate: `${nextYear}-09-06` });
        render(
            <PaymentKpiCards
                summary={emptyPaymentSummary()}
                billing={data}
                visibleKeys={defaultVisibleKpiCards(data)}
            />
        );
        expect(screen.getByText(new RegExp(`next due 6 Sept? ${nextYear}`))).toBeTruthy();
    });

    it('leaves the year off a date in this year', () => {
        const thisYear = new Date().getFullYear();
        const data = billing({ nextDueDate: `${thisYear}-12-06` });
        render(
            <PaymentKpiCards
                summary={emptyPaymentSummary()}
                billing={data}
                visibleKeys={defaultVisibleKpiCards(data)}
            />
        );
        expect(screen.getByText(/next due 6 Dec$/)).toBeTruthy();
    });

    it('keeps the 30-day figure when the institute has no instalments', () => {
        render(
            <PaymentKpiCards
                summary={emptyPaymentSummary()}
                billing={billing({
                    usesInstallments: false,
                    upcoming: 23400,
                    learnersUpcoming: 13,
                })}
            />
        );
        expect(screen.getByText(/13 learners · next 30 days/)).toBeTruthy();
    });
});

describe('card preferences', () => {
    beforeEach(() => localStorage.clear());

    it('a ticked choice sticks per institute; reset returns to the defaults', () => {
        const { result } = renderHook(() => useKpiCardPrefs(billing()));
        expect(result.current.isCustomised).toBe(false);

        act(() => result.current.toggle('failed'));
        expect(result.current.visible.has('failed')).toBe(false);
        expect(JSON.parse(localStorage.getItem('payment-kpi-cards:inst-1') ?? '[]')).not.toContain(
            'failed'
        );

        const again = renderHook(() => useKpiCardPrefs(billing()));
        expect(again.result.current.visible.has('failed')).toBe(false);

        act(() => result.current.reset());
        expect(result.current.visible.has('failed')).toBe(true);
        expect(localStorage.getItem('payment-kpi-cards:inst-1')).toBeNull();
    });
});

describe('Total card', () => {
    beforeEach(() => store.clear());

    const vasco = () => billing({ livePlanCount: 28, instalmentPlanCount: 28 });
    const shikshaNation = () =>
        billing({ livePlanCount: 14032, instalmentPlanCount: 2, due: 42000 });

    it('starts on only where instalments are the fee model', () => {
        expect(defaultVisibleKpiCards(vasco()).has('billed')).toBe(true);
        expect(defaultVisibleKpiCards(shikshaNation()).has('billed')).toBe(false);
        // Subscription / one-time institutes: exactly the old row.
        expect(
            defaultVisibleKpiCards(
                billing({ usesInstallments: false, livePlanCount: 120, instalmentPlanCount: 0 })
            ).has('billed')
        ).toBe(false);
        // An older server sends no instalment count: old row.
        expect(defaultVisibleKpiCards(billing()).has('billed')).toBe(false);
    });

    it('appears for an admin who saved a row before Total existed', () => {
        store.set('payment-kpi-cards:inst-1', JSON.stringify(['paid', 'due', 'upcoming']));
        const { result } = renderHook(() => useKpiCardPrefs(vasco()));
        expect([...result.current.visible].sort()).toEqual([
            'billed',
            'due',
            'paid',
            'schedule',
            'upcoming',
        ]);

        // …but not where it would not be on by default.
        const sn = renderHook(() => useKpiCardPrefs(shikshaNation()));
        expect(sn.result.current.visible.has('billed')).toBe(false);
    });

    it('stays off once the admin switches it off, and Reset brings the default back', () => {
        store.set('payment-kpi-cards:inst-1', JSON.stringify(['paid', 'due', 'upcoming']));
        const { result } = renderHook(() => useKpiCardPrefs(vasco()));

        act(() => result.current.toggle('billed'));
        expect(result.current.visible.has('billed')).toBe(false);
        // Only Total goes; the schedule it showed by default is kept as the admin saw it.
        expect(JSON.parse(store.get('payment-kpi-cards:inst-1')!)).toEqual([
            'paid',
            'due',
            'upcoming',
            'schedule',
        ]);
        expect(store.get('payment-kpi-cards-v2:inst-1')).toBe('1');

        act(() => result.current.reset());
        expect(result.current.visible.has('billed')).toBe(true);
        expect(store.has('payment-kpi-cards-v2:inst-1')).toBe(false);
    });

    it('can be switched on by any institute', () => {
        const { result } = renderHook(() => useKpiCardPrefs(shikshaNation()));
        act(() => result.current.toggle('billed'));
        expect(result.current.visible.has('billed')).toBe(true);
    });
});

describe('Instalment schedule setting', () => {
    beforeEach(() => store.clear());

    const newton = () => billing({ livePlanCount: 54, instalmentPlanCount: 28 });
    const enark = () => billing({ livePlanCount: 299, instalmentPlanCount: 25 });

    it('starts on where instalments are at least half the plans, off where they are fewer', () => {
        expect(defaultVisibleKpiCards(newton()).has('schedule')).toBe(true);
        expect(defaultVisibleKpiCards(enark()).has('schedule')).toBe(false);
    });

    it('can be switched on by a mixed institute with fewer instalment plans', () => {
        const { result } = renderHook(() => useKpiCardPrefs(enark()));
        act(() => result.current.toggle('schedule'));
        expect(result.current.visible.has('schedule')).toBe(true);
        expect(JSON.parse(store.get('payment-kpi-cards:inst-1')!)).toContain('schedule');
    });

    it('is not offered where the screen hides it', () => {
        render(
            <TooltipProvider>
                <KpiCardSettings
                    visible={new Set(['paid'])}
                    onToggle={() => {}}
                    onReset={() => {}}
                    isCustomised={false}
                    hiddenOptions={['schedule']}
                />
            </TooltipProvider>
        );
        act(() => screen.getByRole('button', { name: 'Choose which cards to show' }).click());
        expect(screen.getByText('Total')).toBeTruthy();
        expect(screen.queryByText('Instalment schedule')).toBeNull();
    });
});
