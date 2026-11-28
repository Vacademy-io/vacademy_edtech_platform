import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeDiagnosis } from '@/services/engagement-diagnosis';
import {
    buildView,
    locale,
    NOT_OFF,
    weeklyFixture,
} from '../../../-utils/__tests__/diagnosis-test-kit';
import { WeeklySections } from '../WeeklySections';

// A link needs a router; here it is just an anchor.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: ({
        to,
        search,
        children,
        ...rest
    }: {
        to: string;
        search: Record<string, string>;
        children: ReactNode;
    }) => createElement('a', { href: `${to}?${new URLSearchParams(search)}`, ...rest }, children),
}));

// happy-dom has no layout: the table and the chart watch their size.
beforeAll(() => {
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

const i18n = i18next.createInstance();
beforeAll(async () => {
    await i18n.use(initReactI18next).init({
        lng: 'en',
        resources: { en: { engagementDailyReport: locale } },
        ns: ['engagementDailyReport'],
        defaultNS: 'engagementDailyReport',
        interpolation: { escapeValue: false },
    });
});

const renderSections = (patch: Parameters<typeof normalizeDiagnosis>[0] = {}) => {
    const diagnosis = normalizeDiagnosis({ ...weeklyFixture(), ...patch });
    const view = buildView(i18n.t.bind(i18n) as never, diagnosis, NOT_OFF);
    const onRetry = vi.fn();
    render(
        // MyTable mounts the app's row-action dialogs, which read the query client.
        <QueryClientProvider client={new QueryClient()}>
            <I18nextProvider i18n={i18n}>
                <WeeklySections diagnosis={diagnosis} view={view} onRetry={onRetry} />
            </I18nextProvider>
        </QueryClientProvider>
    );
    return { onRetry };
};

/** The card of one stage: the heading's whole card. */
const card = (stage: string) => {
    const heading = screen.getByRole('heading', { level: 3, name: stage });
    const el = heading.closest('div.flex.min-w-0.flex-col');
    if (!el) throw new Error(`no card for ${stage}`);
    return within(el as HTMLElement);
};

describe('the weekly stage sections', () => {
    it('has one card per stage, each with its own status', () => {
        renderSections();
        for (const stage of ['Leads', 'Calling', 'WhatsApp', 'Email', 'Engine']) {
            expect(screen.getByRole('heading', { level: 3, name: stage })).toBeInTheDocument();
        }
        // The chips beside the headings: 2 problems stages, one that could not load, one too early.
        expect(screen.getAllByText('1 problem')).toHaveLength(2);
        expect(screen.getAllByText('Couldn’t load').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Not enough data yet').length).toBeGreaterThan(0);
    });

    it('shows each row’s numbers, and what a short row needs in place of a verdict', () => {
        renderSections();
        // WhatsApp templates: best and worst are marked, the 40-send row is not.
        expect(screen.getByText('intro_v3')).toBeInTheDocument();
        expect(screen.getByText('Best')).toBeInTheDocument();
        expect(screen.getByText('Worst')).toBeInTheDocument();
        // The 40-send template, and the version of the instructions with 80 sends.
        expect(screen.getAllByText('Needs 100 sends')).toHaveLength(2);
        expect(screen.getByText('follow_up')).toBeInTheDocument();
        // Lead sources and hours with too little data say what they need.
        expect(screen.getByText('Needs 30 leads')).toBeInTheDocument();
        expect(screen.getByText('Needs 20 calls')).toBeInTheDocument();
        // The prompt versions, newest first, with the one too early to judge.
        expect(screen.getByText('Shorter opening')).toBeInTheDocument();
        expect(screen.getByText('Ask about budget')).toBeInTheDocument();
    });

    it('shows the engine checks and the call detail', () => {
        renderSections();
        expect(screen.getByText('Messaged twice')).toBeInTheDocument();
        expect(screen.getByText('Likely to convert')).toBeInTheDocument();
        expect(screen.getByText('budget')).toBeInTheDocument();
        expect(screen.getByText('Under 20 seconds')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: /share of calls answered/ })).toBeInTheDocument();
    });

    it('shows an error, not empty tables, for a stage that could not be read', () => {
        renderSections();
        // EMAIL is UNAVAILABLE in the fixture: no subjects table, an error with a retry.
        expect(screen.queryByText('Quick question')).not.toBeInTheDocument();
        expect(
            within(screen.getByRole('alert')).getByText(/couldn’t load this section/i)
        ).toBeInTheDocument();
        expect(card('Email')).toBeDefined();
    });

    it('says a quiet week is quiet, with no table', () => {
        renderSections({
            stages: ['LEADS', 'CALLING', 'WHATSAPP', 'EMAIL', 'ENGINE'].map((stage) => ({
                stage,
                status: 'NO_ACTIVITY',
            })),
            weekly: {
                minimums: { leadsPerSource: 30, callsPerHour: 20, sendsPerRow: 100 },
                engineChecks: {
                    doubleContact: 0,
                    sentAfterReply: 0,
                    stuckMembers: 0,
                },
            } as never,
        });
        expect(screen.getByText('No leads came in this week.')).toBeInTheDocument();
        expect(screen.getByText('No calls were placed this week.')).toBeInTheDocument();
        expect(screen.getByText('No WhatsApp messages were sent this week.')).toBeInTheDocument();
        expect(screen.getByText('No emails were sent this week.')).toBeInTheDocument();
        // Zero engine checks are a real answer, so they are shown.
        expect(screen.getByText('Sent after a reply')).toBeInTheDocument();
    });

    it('shows every stage as unavailable when the response has no weekly part', () => {
        renderSections({ weekly: null });
        expect(screen.getAllByRole('alert')).toHaveLength(5);
    });
});
