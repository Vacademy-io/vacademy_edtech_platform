import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/webinarsPanel.json';
import { WebinarsPanel } from '../../WebinarsPanel';
import { safeLink, useWebinarClock, webinarPhase, type WebinarDto } from '@/services/webinars';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('@/constants/urls', () => ({ WEBINARS_BASE_URL: '/webinars' }));

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { webinarsPanel: copy } },
    interpolation: { escapeValue: false },
});

const NOW = Date.parse('2026-12-04T12:00:00Z');

function webinar(over: Partial<WebinarDto> & Pick<WebinarDto, 'id' | 'startsAt'>): WebinarDto {
    return {
        title: over.id,
        description: null,
        endsAt: new Date(Date.parse(over.startsAt) + 60 * 60 * 1000).toISOString(),
        joinUrl: null,
        recordingUrl: null,
        active: true,
        ...over,
    };
}

const ROWS: WebinarDto[] = [
    webinar({
        id: 'Running now',
        startsAt: '2026-12-04T11:30:00Z',
        joinUrl: 'https://meet.example.com/live',
    }),
    webinar({
        id: 'Starting soon',
        startsAt: '2026-12-04T12:20:00Z',
        joinUrl: 'https://meet.example.com/soon',
    }),
    webinar({ id: 'Next week', startsAt: '2026-12-11T11:30:00Z' }),
    webinar({ id: 'Bad link', startsAt: '2026-12-18T11:30:00Z', joinUrl: 'javascript:alert(1)' }),
    webinar({
        id: 'Last Friday',
        startsAt: '2026-11-27T11:30:00Z',
        recordingUrl: 'https://cdn.example.com/rec.mp4',
    }),
    webinar({ id: 'Two Fridays ago', startsAt: '2026-11-20T11:30:00Z' }),
];

function renderPanel(webinars: WebinarDto[] | undefined = ROWS) {
    return render(
        <I18nextProvider i18n={i18n}>
            <WebinarsPanel
                open
                onClose={() => {}}
                webinars={webinars}
                loading={false}
                error={false}
                onRetry={() => {}}
                now={NOW}
            />
        </I18nextProvider>
    );
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('webinarPhase', () => {
    const w = { startsAt: '2026-12-04T11:30:00Z', endsAt: '2026-12-04T12:30:00Z' };
    it('is live from the start up to the end', () => {
        expect(webinarPhase(w, Date.parse(w.startsAt) - 1)).toBe('upcoming');
        expect(webinarPhase(w, Date.parse(w.startsAt))).toBe('live');
        expect(webinarPhase(w, Date.parse(w.endsAt) - 1)).toBe('live');
        expect(webinarPhase(w, Date.parse(w.endsAt))).toBe('past');
    });
});

describe('safeLink', () => {
    it('only lets http(s) links through', () => {
        expect(safeLink('https://meet.example.com/x')).toBe('https://meet.example.com/x');
        expect(safeLink('javascript:alert(1)')).toBeNull();
        expect(safeLink('meet.example.com/x')).toBeNull();
        expect(safeLink(null)).toBeNull();
    });
});

describe('WebinarsPanel', () => {
    it('shows the live webinar with a Join now button that opens its link', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        renderPanel();
        expect(screen.getByText('Live now')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /join now/i }));
        expect(open).toHaveBeenCalledWith(
            'https://meet.example.com/live',
            '_blank',
            'noopener,noreferrer'
        );
    });

    it('lists upcoming webinars soonest first, with a Join button or "link coming soon"', () => {
        renderPanel();
        expect(screen.getByText('Starts in 20 min')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /^join$/i })).toHaveLength(1);
        // No link yet, and a javascript: link, both read as "coming soon" — never a button.
        expect(screen.getAllByText('Join link coming soon')).toHaveLength(2);
        const titles = screen
            .getAllByText(/Starting soon|Next week|Bad link/)
            .map((n) => n.textContent);
        expect(titles).toEqual(['Starting soon', 'Next week', 'Bad link']);
    });

    it('plays a past recording in the app, and marks the ones without a recording', () => {
        renderPanel();
        expect(screen.getByText(/Recording coming soon/)).toBeTruthy();
        expect(
            (screen.getByRole('button', { name: /Two Fridays ago/ }) as HTMLButtonElement).disabled
        ).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: /Last Friday/ }));
        const video = document.querySelector('video');
        expect(video?.getAttribute('src')).toBe('https://cdn.example.com/rec.mp4');
    });

    it('shows the loading state while Retry refetches after an error', () => {
        const retry = vi.fn();
        const { rerender } = render(
            <I18nextProvider i18n={i18n}>
                <WebinarsPanel
                    open
                    onClose={() => {}}
                    webinars={undefined}
                    loading={false}
                    error
                    onRetry={retry}
                    now={NOW}
                />
            </I18nextProvider>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(retry).toHaveBeenCalledTimes(1);
        rerender(
            <I18nextProvider i18n={i18n}>
                <WebinarsPanel
                    open
                    onClose={() => {}}
                    webinars={undefined}
                    loading
                    error
                    onRetry={retry}
                    now={NOW}
                />
            </I18nextProvider>
        );
        expect(screen.queryByText("Couldn't load webinars.")).toBeNull();
    });

    it('says so when there are no webinars yet', () => {
        renderPanel([]);
        expect(screen.getByText('No webinars yet')).toBeTruthy();
    });
});

describe('useWebinarClock', () => {
    it('catches up when the list arrives late, then flips to past at the end', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-12-04T10:00:00Z'));
        const { result, rerender } = renderHook(
            ({ rows }: { rows: WebinarDto[] | undefined }) => useWebinarClock(rows),
            { initialProps: { rows: undefined } }
        );
        // Nothing ahead: no timer keeps the dock re-rendering.
        expect(vi.getTimerCount()).toBe(0);

        // Time passes with no timer running, then the list arrives mid-webinar.
        vi.setSystemTime(Date.parse('2026-12-04T11:40:00Z'));
        const rows = [webinar({ id: 'w', startsAt: '2026-12-04T11:30:00Z' })];
        act(() => rerender({ rows }));
        expect(webinarPhase(rows[0]!, result.current)).toBe('live');

        act(() => vi.advanceTimersByTime(51 * 60 * 1000));
        expect(webinarPhase(rows[0]!, result.current)).toBe('past');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('flips an upcoming webinar to live at its start time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-12-04T09:00:00Z'));
        const rows = [webinar({ id: 'w', startsAt: '2026-12-04T11:30:00Z' })];
        const { result } = renderHook(() => useWebinarClock(rows));
        expect(webinarPhase(rows[0]!, result.current)).toBe('upcoming');
        act(() => vi.advanceTimersByTime(2.5 * 60 * 60 * 1000 + 2000));
        expect(webinarPhase(rows[0]!, result.current)).toBe('live');
    });
});
