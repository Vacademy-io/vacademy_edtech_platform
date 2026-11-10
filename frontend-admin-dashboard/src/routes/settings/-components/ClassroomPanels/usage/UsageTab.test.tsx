import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PanelUsageSessionRow } from '@/classroom-shared/apiTypes';
import en from '../../../../../../public/locales/en/settingsClassroomPanels.json';
import ar from '../../../../../../public/locales/ar/settingsClassroomPanels.json';
import fr from '../../../../../../public/locales/fr/settingsClassroomPanels.json';
import hi from '../../../../../../public/locales/hi/settingsClassroomPanels.json';

/** Resolve against the REAL en catalogue so a missing key shows up as a raw key. */
const translate = (key: string, vars?: Record<string, unknown>): string => {
    const value = key.split('.').reduce<unknown>((node, part) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
        return undefined;
    }, en);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
    initReactI18next: { type: '3rdParty', init: () => {} },
    Trans: ({ children }: { children?: unknown }) => children,
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-a' }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'http://api.test' }));
vi.mock('@/lib/auth/roleUtils', () => ({ isAdminForInstitute: () => true }));
vi.mock('@/utils/timezone', () => ({ getBrowserTimezone: () => 'Europe/London' }));

const toast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));

const saved = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/save-blob', () => saved);

const admins = vi.hoisted(() => ({ ids: ['inst-a'] }));
vi.mock('./adminInstitutes', () => ({ adminInstituteIds: () => admins.ids }));
vi.mock('@/lib/auth/instituteService', () => ({
    fetchMultipleInstituteDetails: vi.fn(async () => ({
        'inst-a': { institute_name: 'North School' },
        'inst-b': { institute_name: 'South School' },
    })),
    getInstituteName: (details: { institute_name?: string } | null, id: string) =>
        details?.institute_name ?? id,
}));

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: api }));

import ClassroomPanelsSettings from '../ClassroomPanelsSettings';
import { UsageTab } from './UsageTab';
import {
    EXPORT_MAX_ROWS,
    collectSessions,
    multiToCsv,
    sessionsToCsv,
    type CsvLabels,
} from './exportCsv';
import {
    USAGE_MAX_DAYS,
    datesInRange,
    normaliseUsage,
    presetRange,
    rangeProblem,
} from './usageApi';

const ADMIN = 'http://api.test/auth-service/v1/panel/admin';
// 2026-11-09 is a Monday.
const NOW = new Date(2026, 10, 9, 10, 0, 0);

const reject = (status: number, code: string) =>
    Promise.reject({ response: { status, data: { code, message: 'server text' } } });

const TOTALS = {
    panel_hours: 182.5,
    sessions: 311,
    teachers: 24,
    rooms_used: 18,
    rooms_with_panel: 20,
    idle_rooms: 1,
    classes_started: 41,
    coverage_pct: 63,
};

const USAGE = {
    institute_id: 'inst-a',
    from: '2026-11-03',
    to: '2026-11-09',
    tz: 'Europe/London',
    generated_at: '2026-11-09T10:00:00Z',
    totals: TOTALS,
    by_day: [{ date: '2026-11-04', panel_hours: 31.2, sessions: 52, rooms_used: 17 }],
    by_room: [
        {
            room: { id: 'room-5a', name: '5A' },
            panel_hours: 12.1,
            sessions: 20,
            teachers: 4,
            last_used_at: '2026-11-08T09:00:00Z',
            days_used: 5,
        },
    ],
    by_teacher: [
        {
            user: { id: 'user-t', name: 'Tara Teacher' },
            panel_hours: 9.4,
            sessions: 15,
            rooms: 3,
            days_active: 5,
            top_content: [{ kind: 'LESSON', title: 'Photosynthesis', minutes: 42 }],
        },
    ],
    idle_rooms: [
        {
            room: { id: 'room-7c', name: '7C' },
            device_id: 'dev-7c',
            last_used_at: null,
            online: true,
        },
    ],
    content: [
        {
            kind: 'DECK',
            ref_id: 'deck-1',
            title: 'Fractions deck',
            minutes: 95,
            sessions: 6,
            teachers: 2,
        },
    ],
    notes: { content_recorded_from: '2026-11-05' },
};

const session = (id: string, title = 'Cells') => ({
    id,
    room: { id: 'room-5a', name: '5A' },
    user: { id: 'user-t', name: 'Tara Teacher' },
    started_at: '2026-11-04T04:00:00Z',
    end_at: '2026-11-04T04:45:00Z',
    minutes: 45,
    end_reason: 'SIGN_OUT',
    started_via: 'QR',
    events: [{ kind: 'LESSON', title, started_at: '2026-11-04T04:01:00Z', minutes: 30 }],
});

let usageAnswer: () => Promise<unknown>;
let sessionsAnswer: (params: Record<string, unknown>) => Promise<unknown>;

function respond() {
    api.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
        if (url === `${ADMIN}/usage`) return usageAnswer();
        if (url === `${ADMIN}/usage/sessions`) return sessionsAnswer(config?.params ?? {});
        if (url === `${ADMIN}/usage/multi`) {
            return Promise.resolve({
                data: [
                    { institute_id: 'inst-a', totals: TOTALS },
                    { institute_id: 'inst-b', totals: { ...TOTALS, panel_hours: 400 } },
                ],
            });
        }
        if (url === `${ADMIN}/rooms`) {
            return Promise.resolve({ data: { rooms: [], next_unpaired_room_id: null } });
        }
        if (url === `${ADMIN}/devices`) return Promise.resolve({ data: [] });
        return reject(404, 'FEATURE_OFF');
    });
}

function renderTab() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <UsageTab instituteId="inst-a" />
        </QueryClientProvider>
    );
}

const usageCalls = () =>
    api.get.mock.calls
        .filter(([url]) => url === `${ADMIN}/usage`)
        .map(([, config]) => (config as { params: Record<string, string> }).params);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    admins.ids = ['inst-a'];
    usageAnswer = () => Promise.resolve({ data: USAGE });
    sessionsAnswer = () => Promise.resolve({ data: { sessions: [], page: 0, size: 20, total: 0 } });
    respond();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Usage tab visibility', () => {
    it('stays hidden while /usage answers FEATURE_OFF', async () => {
        usageAnswer = () => reject(404, 'FEATURE_OFF');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <ClassroomPanelsSettings />
            </QueryClientProvider>
        );
        await waitFor(() => expect(usageCalls().length).toBe(1));
        await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(6));
        expect(screen.queryByRole('tab', { name: en.tabs.usage })).toBeNull();
    });

    it('shows the tab when /usage answers, and the tab reuses the probe answer', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <ClassroomPanelsSettings />
            </QueryClientProvider>
        );
        const tab = await screen.findByRole('tab', { name: en.tabs.usage });
        fireEvent.mouseDown(tab);
        fireEvent.click(tab);
        await screen.findByRole('heading', { name: en.usage.title });
        expect(await screen.findByText('182.5')).toBeTruthy();
        // The probe asked for the tab's default range, so opening it asked nothing new.
        expect(usageCalls()).toEqual([
            { institute_id: 'inst-a', from: '2026-11-03', to: '2026-11-09', tz: 'Europe/London' },
        ]);
    });
});

describe('Usage tab states', () => {
    it('loading: shows placeholders while the first answer is on its way', () => {
        usageAnswer = () => new Promise(() => {});
        const { container } = renderTab();
        expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(screen.queryByText(en.usage.loadError, { exact: false })).toBeNull();
    });

    it('error: says so and retries', async () => {
        usageAnswer = () => reject(503, 'TRY_AGAIN');
        renderTab();
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain(en.usage.loadError);
        expect(alert.textContent).toContain(en.errors.TRY_AGAIN);
        expect(alert.textContent).not.toContain('server text');
        usageAnswer = () => Promise.resolve({ data: USAGE });
        fireEvent.click(within(alert).getByRole('button', { name: en.common.retry }));
        expect(await screen.findByText('182.5')).toBeTruthy();
    });

    it('empty: no sessions shows the empty state and still lists idle rooms', async () => {
        usageAnswer = () =>
            Promise.resolve({
                data: {
                    ...USAGE,
                    totals: { ...TOTALS, sessions: 0, panel_hours: 0, rooms_used: 0 },
                    by_day: [],
                    by_room: [],
                    by_teacher: [],
                    content: [],
                },
            });
        renderTab();
        expect(await screen.findByText(en.usage.empty.title)).toBeTruthy();
        expect(screen.getByText('7C')).toBeTruthy();
        expect(screen.queryByText(en.usage.rooms.title)).toBeNull();
        expect(
            screen.getByRole('button', { name: en.usage.export.button }).hasAttribute('disabled')
        ).toBe(true);
    });

    it('data: KPIs, rooms, teachers, idle rooms and content with its coverage note', async () => {
        renderTab();
        expect(await screen.findByText('182.5')).toBeTruthy();
        expect(screen.getByText('18 of 20')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Show sessions in 5A' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Show sessions by Tara Teacher' })).toBeTruthy();
        expect(screen.getByText('Lesson: Photosynthesis (42 min)')).toBeTruthy();
        expect(screen.getByText('7C')).toBeTruthy();
        expect(screen.getByText('Fractions deck')).toBeTruthy();
        expect(screen.getByText(/Content was recorded for 63% of sessions/)).toBeTruthy();
        expect(screen.getByRole('img', { name: /Bar chart of panel hours/ })).toBeTruthy();
    });

    it('a partial answer never breaks the tab', async () => {
        usageAnswer = () => Promise.resolve({ data: {} });
        renderTab();
        expect(await screen.findByText(en.usage.empty.title)).toBeTruthy();
    });

    it('a room opens its sessions in a drawer', async () => {
        sessionsAnswer = () =>
            Promise.resolve({ data: { sessions: [session('s1')], page: 0, size: 20, total: 1 } });
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Show sessions in 5A' }));
        const drawer = await screen.findByRole('dialog');
        expect(within(drawer).getByText('Sessions in 5A')).toBeTruthy();
        expect(await within(drawer).findByText('Lesson: Cells')).toBeTruthy();
        const call = api.get.mock.calls.find(([url]) => url === `${ADMIN}/usage/sessions`);
        expect(call?.[1]).toMatchObject({
            params: { institute_id: 'inst-a', room_id: 'room-5a', page: 0, size: 20 },
        });
        expect((call?.[1] as { params: Record<string, unknown> }).params.user_id).toBeUndefined();
    });
});

describe('Usage date range', () => {
    it('a preset asks for its own dates', async () => {
        renderTab();
        await screen.findByText('182.5');
        fireEvent.click(screen.getByRole('button', { name: en.usage.range.last30 }));
        await waitFor(() => expect(usageCalls()).toHaveLength(2));
        expect(usageCalls()[1]).toMatchObject({ from: '2026-10-11', to: '2026-11-09' });
    });

    it(`a custom range over ${USAGE_MAX_DAYS} days is refused before any request`, async () => {
        renderTab();
        await screen.findByText('182.5');
        fireEvent.click(screen.getByRole('button', { name: en.usage.range.custom }));
        fireEvent.change(screen.getByLabelText(en.usage.range.from), {
            target: { value: '2026-07-01' },
        });
        expect((await screen.findByRole('alert')).textContent).toBe(
            `Pick at most ${USAGE_MAX_DAYS} days.`
        );
        expect(usageCalls()).toHaveLength(1);
        expect(screen.queryByText('182.5')).toBeNull();

        fireEvent.change(screen.getByLabelText(en.usage.range.from), {
            target: { value: '2026-10-01' },
        });
        await waitFor(() => expect(usageCalls()).toHaveLength(2));
        expect(usageCalls()[1]).toMatchObject({ from: '2026-10-01', to: '2026-11-09' });
    });

    it('range rules', () => {
        expect(rangeProblem({ from: '2026-11-01', to: '2026-11-01' })).toBeNull();
        expect(rangeProblem({ from: '2026-11-02', to: '2026-11-01' })).toBe('order');
        expect(rangeProblem({ from: '', to: '2026-11-01' })).toBe('incomplete');
        expect(rangeProblem({ from: '2026-08-01', to: '2026-10-31' })).toBeNull(); // 92 days
        expect(rangeProblem({ from: '2026-07-31', to: '2026-10-31' })).toBe('tooLong');
        expect(presetRange('lastWeek', NOW)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
        expect(presetRange('thisWeek', NOW)).toEqual({ from: '2026-11-09', to: '2026-11-09' });
        expect(presetRange('term', NOW)).toEqual({ from: '2026-08-10', to: '2026-11-09' });
        expect(datesInRange(presetRange('term', NOW))).toHaveLength(USAGE_MAX_DAYS);
        expect(
            normaliseUsage(null, { institute_id: 'i', from: 'a', to: 'b', tz: 'z' }).totals
        ).toMatchObject({ sessions: 0, coverage_pct: null });
    });
});

describe('Usage CSV export', () => {
    it('pages through every session and saves one escaped CSV', async () => {
        sessionsAnswer = (params) => {
            const page = Number(params.page);
            const rows =
                page === 0
                    ? Array.from({ length: 200 }, (_, i) => session(`s${i}`))
                    : [
                          { ...session('s200'), room: { id: 'r', name: '=HYPERLINK("x")' } },
                          session('s201'),
                      ];
            return Promise.resolve({ data: { sessions: rows, page, size: 200, total: 202 } });
        };
        renderTab();
        await screen.findByText('182.5');
        fireEvent.click(screen.getByRole('button', { name: en.usage.export.button }));
        await waitFor(() => expect(saved.saveBlob).toHaveBeenCalledTimes(1));

        const pages = api.get.mock.calls
            .filter(([url]) => url === `${ADMIN}/usage/sessions`)
            .map(([, config]) => (config as { params: Record<string, unknown> }).params);
        expect(pages.map((p) => [p.page, p.size])).toEqual([
            [0, 200],
            [1, 200],
        ]);
        const [blob, name] = saved.saveBlob.mock.calls[0] as [Blob, string];
        expect(name).toBe('classroom-panel-usage-2026-11-03-to-2026-11-09.csv');
        const text = await blob.text();
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
        expect(lines[0]).toBe(
            'Date,Room,Teacher,Started,Ended,Minutes,How it ended,Signed in with,Content'
        );
        expect(lines).toHaveLength(203);
        // A cell that looks like a formula is escaped so a spreadsheet shows it as text.
        expect(text).toContain(`"'=HYPERLINK(""x"")"`);
        expect(toast.success).toHaveBeenCalledWith('Exported sessions: 202.');
    });

    it('stops at the export cap and says so', async () => {
        const fetchPage = vi.fn(async ({ page = 0 }: { page?: number }) => ({
            sessions: Array.from(
                { length: 200 },
                (_, i) => session(`p${page}-${i}`) as unknown as PanelUsageSessionRow
            ),
            page,
            size: 200,
            total: EXPORT_MAX_ROWS + 1000,
        }));
        const collected = await collectSessions(
            { institute_id: 'inst-a', from: '2026-08-10', to: '2026-11-09', tz: 'Europe/London' },
            fetchPage
        );
        expect(collected.rows).toHaveLength(EXPORT_MAX_ROWS);
        expect(collected.truncated).toBe(true);
        expect(fetchPage).toHaveBeenCalledTimes(EXPORT_MAX_ROWS / 200);
    });

    it('escapes formula-like cells', () => {
        const labels: CsvLabels = {
            columns: {
                date: 'd',
                room: 'r',
                teacher: 't',
                started: 's',
                ended: 'e',
                minutes: 'm',
                endReason: 'x',
                startedVia: 'v',
                content: 'c',
            },
            dateTime: (iso) => iso,
            date: (iso) => iso.slice(0, 10),
            endReason: () => 'out',
            startedVia: () => 'qr',
            event: (event) => event.title ?? '',
        };
        const row = { ...session('s1', '=1+1'), room: { id: 'r', name: '@room' } };
        const csv = sessionsToCsv([row as never], labels);
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv).toContain("'@room");
        expect(csv).toContain("'=1+1");

        // Names are meant to be a single line; a cell that has more lines is still text.
        const multiLine = {
            ...session('s2', '@SUM(A1)'),
            room: { id: 'r', name: '=1+1\nx' },
            user: { id: 'u', name: '-2+3\r\nx' },
        };
        const lines = sessionsToCsv([multiLine as never], labels);
        expect(lines).toContain('"\'=1+1\nx"');
        expect(lines).toContain('"\'-2+3\r\nx"');
        expect(lines).toContain("'@SUM(A1)");
    });

    it('keeps multi-line school names as text in the My schools file', () => {
        const csv = multiToCsv(
            [
                {
                    name: '+A\nB',
                    panel_hours: 1.26,
                    sessions: 2,
                    rooms_used: 1,
                    rooms_with_panel: 1,
                    teachers: 1,
                    idle_rooms: 0,
                },
            ],
            {
                school: 's',
                hours: 'h',
                sessions: 'n',
                roomsUsed: 'u',
                roomsWithPanel: 'p',
                teachers: 't',
                idle: 'i',
            }
        );
        expect(csv).toContain('"\'+A\nB"');
        // Numbers are not text and stay as they are.
        expect(csv).toContain(',1.3,2,1,1,1,0');
    });
});

describe('My schools', () => {
    it('is not offered to an admin of a single institute', async () => {
        renderTab();
        await screen.findByText('182.5');
        expect(screen.queryByRole('switch')).toBeNull();
    });

    it('lists every school, most panel hours first', async () => {
        admins.ids = ['inst-a', 'inst-b'];
        renderTab();
        await screen.findByText('182.5');
        fireEvent.click(screen.getByRole('switch'));
        const call = await waitFor(() => {
            const found = api.get.mock.calls.find(([url]) => url === `${ADMIN}/usage/multi`);
            expect(found).toBeTruthy();
            return found!;
        });
        expect((call[1] as { params: Record<string, string> }).params.institute_ids).toBe(
            'inst-a,inst-b'
        );
        await screen.findByText('South School');
        const names = screen
            .getAllByText(/North School|South School/)
            .map((node) => node.textContent);
        expect(names).toEqual(['South School', 'North School']);
    });
});

describe('Usage strings', () => {
    it('every locale has the same usage keys', () => {
        const keys = (node: unknown, prefix = ''): string[] =>
            node && typeof node === 'object'
                ? Object.entries(node).flatMap(([key, value]) =>
                      keys(value, prefix ? `${prefix}.${key}` : key)
                  )
                : [prefix];
        const expected = keys(en.usage).sort();
        expect(expected.length).toBeGreaterThan(100);
        for (const catalogue of [ar, fr, hi]) {
            expect(keys(catalogue.usage).sort()).toEqual(expected);
        }
    });
});
