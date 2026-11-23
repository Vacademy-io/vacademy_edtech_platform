import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { AxiosError, AxiosHeaders } from 'axios';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const axiosCall = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: (...a: unknown[]) => axiosCall(...a) }));
vi.mock('@/constants/urls', () => ({ SCAN_STATION_BASE_URL: '/scan' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst1' }));
vi.mock('@/stores/layout-container/useNavHeadingStore', () => ({
    useNavHeadingStore: () => ({ setNavHeading: vi.fn() }),
}));
vi.mock('@/components/core/dashboard-loader', () => ({
    DashboardLoader: () => <div>loading</div>,
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('..', () => ({
    Route: {
        fullPath: '/scan',
        useParams: () => ({ assessmentId: 'a1' }),
        useSearch: () => ({ session: 's1' }),
    },
}));
vi.mock('./LoadIntake', () => ({ LoadIntake: () => null }));
vi.mock('./StartCheckingDialog', () => ({ StartCheckingDialog: () => null }));
vi.mock('./StartedBatchPanel', () => ({ StartedBatchPanel: () => null }));
vi.mock('../-lib/thumb-source', () => ({ thumbUrl: () => Promise.resolve('blob:thumb') }));
const toastError = vi.fn();
vi.mock('sonner', () => ({
    toast: { error: (m: string) => toastError(m), success: vi.fn(), info: vi.fn() },
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { ScanStationPage } from './ScanStationPage';
import { scanSessionKey } from '../-hooks/useScanActions';

const notFound = () =>
    new AxiosError('Not Found', '404', undefined, undefined, {
        status: 404,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { ex: 'No static resource' },
    });

/** A session the server is still reading: the page polls it. */
const BUSY = {
    id: 's1',
    assessment_id: 'a1',
    status: 'OPEN',
    verdict: 'ANALYSING',
    verdict_reasons: [],
    fronts_direction: 'FORWARD',
    fronts_direction_source: 'DEFAULT',
    session_flags: [],
    loads: [
        {
            load_no: 1,
            status: 'ANALYSING',
            attempts: 1,
            error_message: null,
            passes: [],
            layout: null,
            pages: [],
            sheets: [],
            flags: [],
        },
    ],
    copies: [],
    built: null,
    intake_batch_id: null,
    error_message: null,
    totals: { loads: 1, sheets: 0, pages: 0, copies: 0, blank_left_out: 0, excluded: 0 },
};

let enabled = true;
let sessionGone = false;
const calls = (url: string) =>
    axiosCall.mock.calls.filter((c) => (c[0] as { url: string }).url === url).length;

const setup = () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<ScanStationPage />, { wrapper });
    return client;
};

describe('scan station switched off while the page is open', () => {
    beforeEach(() => {
        enabled = true;
        sessionGone = false;
        axiosCall.mockReset();
        toastError.mockReset();
        axiosCall.mockImplementation(async ({ url }: { url: string }) => {
            if (url === '/scan/config') {
                return {
                    data: { enabled, max_loads: 5, max_pages_per_pass: 300, max_copies: 200 },
                };
            }
            if (url === '/scan/session/s1') {
                if (sessionGone) throw notFound();
                return { data: BUSY };
            }
            throw new Error(`unexpected ${url}`);
        });
    });

    it('shows the off state, not the stale session, and stops asking for it', async () => {
        const client = setup();
        await screen.findByText('load.title');
        expect(screen.queryByText('off.title')).toBeNull();

        // The feature is switched off: every session route is now a 404.
        enabled = false;
        sessionGone = true;
        await act(async () => {
            // What the next poll tick does.
            await client.refetchQueries({ queryKey: scanSessionKey('s1', 'inst1') });
        });

        // The config is re-read at once despite its 10-minute staleTime.
        await screen.findByText('off.title');
        expect(screen.queryByText('load.title')).toBeNull();
        expect(calls('/scan/config')).toBe(2);
        // One 404, no retries of it, and the poll is off.
        expect(calls('/scan/session/s1')).toBe(2);
        const query = client.getQueryCache().find({ queryKey: scanSessionKey('s1', 'inst1') });
        expect(query?.state.fetchFailureCount).toBe(1);
    });

    it('says the session is gone when the feature is still on', async () => {
        const client = setup();
        await screen.findByText('load.title');
        sessionGone = true;
        await act(async () => {
            await client.refetchQueries({ queryKey: scanSessionKey('s1', 'inst1') });
        });
        await screen.findByText('sessions.notFound');
        expect(screen.queryByText('load.title')).toBeNull();
        await waitFor(() => expect(calls('/scan/config')).toBe(2));
        expect(screen.queryByText('off.title')).toBeNull();
    });

    it('treats a 404 from the config itself as off, without "try again"', async () => {
        axiosCall.mockImplementation(async () => {
            throw notFound();
        });
        setup();
        await screen.findByText('off.title');
        expect(screen.queryByText('retry')).toBeNull();
        expect(calls('/scan/config')).toBe(1);
    });
});
