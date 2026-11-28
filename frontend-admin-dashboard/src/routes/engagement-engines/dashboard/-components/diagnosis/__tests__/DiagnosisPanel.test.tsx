import { createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeDiagnosis, type EngagementDiagnosis } from '@/services/engagement-diagnosis';
import type { ReportKpi } from '../../../-utils/report-kpis';
import { buildView, locale, NOT_OFF } from '../../../-utils/__tests__/diagnosis-test-kit';
import { AllNumbers } from '../AllNumbers';
import { DiagnosisPanel } from '../DiagnosisPanel';

// A link needs a router; here it is just an anchor that shows where it would go.
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

const wrap = (node: ReactNode) => <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;

const STAGES = ['LEADS', 'CALLING', 'WHATSAPP', 'EMAIL', 'ENGINE'];
const day = (patch: Partial<EngagementDiagnosis> = {}) =>
    normalizeDiagnosis({
        view: 'DAILY',
        from: '2026-11-04',
        to: '2026-11-04',
        days: 1,
        timezone: 'Asia/Dubai',
        stages: STAGES.map((stage) => ({ stage, status: 'OK' })),
        ...patch,
    });

const problem = (code: string, stage: string, numbers: Record<string, number>) => ({
    code,
    stage,
    severity: 'warning' as const,
    affected: 10,
    numbers,
    breakdown: [],
    names: [],
    link: null,
});

const kpi = (key: ReportKpi['key'], label: string, value: string): ReportKpi => ({
    key,
    label,
    value,
    hint: '',
    delta: null,
});

const renderPanel = (
    diagnosis: EngagementDiagnosis | undefined,
    props: Partial<Parameters<typeof DiagnosisPanel>[0]> = {}
) => {
    const view = diagnosis ? buildView(i18n.t.bind(i18n) as never, diagnosis, NOT_OFF) : null;
    const onRetry = vi.fn();
    render(
        wrap(
            <DiagnosisPanel
                view={view}
                isLoading={false}
                isError={false}
                isFetching={false}
                onRetry={onRetry}
                isToday
                kpis={[]}
                {...props}
            />
        )
    );
    return { onRetry };
};

describe('the daily diagnosis panel', () => {
    it('lists the problems with their evidence, advice and a link, and counts the rest', () => {
        renderPanel(
            day({
                problems: [
                    {
                        ...problem('WHATSAPP_FAILED_HIGH', 'WHATSAPP', {
                            failed: 40,
                            tried: 120,
                            rate: 0.33,
                        }),
                        severity: 'critical',
                        breakdown: [{ key: 'NOT_ON_WHATSAPP', count: 35 }],
                        link: {
                            target: 'OUTCOMES',
                            channel: 'WHATSAPP',
                            outcome: 'failed',
                            kind: null,
                        },
                    },
                    problem('SENT_AFTER_REPLY', 'ENGINE', { sends: 6 }),
                ],
                moreProblems: 3,
                stages: STAGES.map((stage) => ({
                    stage,
                    status: stage === 'WHATSAPP' || stage === 'ENGINE' ? 'PROBLEM' : 'OK',
                })),
            })
        );
        expect(screen.getByText('WhatsApp messages are failing')).toBeInTheDocument();
        expect(screen.getByText('40 of 120 messages failed (33%).')).toBeInTheDocument();
        expect(screen.getByText(/Most common: Not on WhatsApp 35/)).toBeInTheDocument();
        expect(screen.getByText('Messages go out after a reply')).toBeInTheDocument();
        expect(screen.getByText('Critical')).toBeInTheDocument();
        const link = screen.getByRole('link', { name: /See the messages/ });
        expect(link.getAttribute('href')).toContain('/engagement-engines/inbox?');
        expect(link.getAttribute('href')).toContain('filter=failed');
        expect(screen.getByText('3 more problems not shown.')).toBeInTheDocument();
        // One line per stage, a stage with a problem says so.
        expect(screen.getAllByText('1 problem')).toHaveLength(2);
        expect(screen.getAllByText('Normal')).toHaveLength(3);
    });

    it('says "No problems today" with the headline numbers on a calm day', () => {
        renderPanel(day(), {
            kpis: [
                kpi('peopleAdded', 'Leads added', '12'),
                kpi('messagesSent', 'Messages sent', '40'),
                kpi('costPerDemo', 'Cost per demo', '9'),
            ],
        });
        expect(screen.getByText('No problems today')).toBeInTheDocument();
        expect(screen.getByText('Leads added')).toBeInTheDocument();
        expect(screen.getByText('40')).toBeInTheDocument();
        // Only the headline four are shown.
        expect(screen.queryByText('Cost per demo')).not.toBeInTheDocument();
    });

    it('says "on this day" for a day that is not today', () => {
        renderPanel(day(), { isToday: false });
        expect(screen.getByText('No problems on this day')).toBeInTheDocument();
    });

    it('does not say all clear when a stage could not be read', () => {
        renderPanel(
            day({
                stages: STAGES.map((stage) => ({
                    stage,
                    status: stage === 'CALLING' ? 'UNAVAILABLE' : 'OK',
                })),
            })
        );
        expect(screen.queryByText('No problems today')).not.toBeInTheDocument();
        expect(
            screen.getByText('No problems found, but some checks didn’t run')
        ).toBeInTheDocument();
        expect(screen.getByText('Couldn’t load')).toBeInTheDocument();
        expect(screen.getAllByText('Normal')).toHaveLength(4);
    });

    it('says what a quiet stage is quiet about, and what the report cannot see', () => {
        renderPanel(
            day({
                stages: [
                    { stage: 'LEADS', status: 'NO_ACTIVITY' },
                    { stage: 'CALLING', status: 'NO_ACTIVITY' },
                    { stage: 'WHATSAPP', status: 'NO_ACTIVITY' },
                    { stage: 'EMAIL', status: 'NOT_ENOUGH_DATA' },
                    { stage: 'ENGINE', status: 'OK' },
                ],
                dataGaps: [{ code: 'EMAIL_REPLIES_NOT_TRACKED', names: ['hello@example.com'] }],
            })
        );
        expect(screen.getByText('No leads added')).toBeInTheDocument();
        expect(screen.getByText('No calls placed')).toBeInTheDocument();
        expect(screen.getByText('Nothing sent')).toBeInTheDocument();
        expect(screen.getByText('Not enough data yet')).toBeInTheDocument();
        expect(
            screen.getByText(
                'Email replies can’t be seen for hello@example.com, so a reply count of 0 may not be real.'
            )
        ).toBeInTheDocument();
    });

    it('shows a problem it does not know as a plain row', () => {
        renderPanel(day({ problems: [problem('A_RULE_FROM_THE_FUTURE', 'EMAIL', { sent: 40 })] }));
        expect(screen.getByText('Needs a look: A Rule From The Future')).toBeInTheDocument();
        expect(screen.getByText('Sent 40')).toBeInTheDocument();
    });

    it('shows a skeleton, with no problems and no all-clear, while it loads', () => {
        renderPanel(undefined, { isLoading: true });
        expect(screen.getByText('What needs attention')).toBeInTheDocument();
        expect(screen.queryByText(/No problems/)).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows a small retryable error in its place when the request failed', () => {
        const { onRetry } = renderPanel(undefined, { isError: true });
        expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load this section');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/No problems/)).not.toBeInTheDocument();
    });
});

describe('All numbers', () => {
    const renderFold = (open: boolean, failed = false) => {
        const onOpenChange = vi.fn();
        render(
            wrap(
                <AllNumbers open={open} onOpenChange={onOpenChange} failed={failed}>
                    <p>The full report</p>
                </AllNumbers>
            )
        );
        return { onOpenChange };
    };

    it('is closed by default: the full report is not on the page', () => {
        renderFold(false);
        expect(screen.getByRole('button', { name: /All numbers/ })).toHaveAttribute(
            'aria-expanded',
            'false'
        );
        expect(screen.queryByText('The full report')).not.toBeInTheDocument();
    });

    it('asks to open when pressed, and shows the report when open', () => {
        const closed = renderFold(false);
        fireEvent.click(screen.getByRole('button', { name: /All numbers/ }));
        expect(closed.onOpenChange).toHaveBeenCalledWith(true);
    });

    it('shows the report when open', () => {
        renderFold(true);
        expect(screen.getByText('The full report')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /All numbers/ })).toHaveAttribute(
            'aria-expanded',
            'true'
        );
    });

    it('says so when the numbers inside could not load', () => {
        renderFold(false, true);
        expect(
            screen.getByText('Couldn’t load the numbers. Open to try again.')
        ).toBeInTheDocument();
    });
});
