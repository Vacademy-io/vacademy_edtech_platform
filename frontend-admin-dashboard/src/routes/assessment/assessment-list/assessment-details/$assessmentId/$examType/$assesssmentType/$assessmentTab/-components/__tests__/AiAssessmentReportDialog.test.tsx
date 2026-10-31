import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dialog } from '@/components/ui/dialog';
import { AiAssessmentReportDialog } from '../AiAssessmentReportDialog';

const request = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: (config: unknown) => request(config),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const status = (over: Record<string, unknown> = {}) => ({
    available: true,
    generating: false,
    generated_at: '2026-09-04T10:00:00Z',
    stale: false,
    credits_required: 10,
    current_balance: 500,
    sufficient: true,
    history: [
        { id: 'v3', generated_at: '2026-09-04T10:00:00Z', current: true },
        { id: 'v2', generated_at: '2026-08-30T09:00:00Z', current: false },
        { id: 'v1', generated_at: '2026-08-21T08:00:00Z', current: false },
    ],
    ...over,
});

const renderDialog = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <Dialog open>
                <AiAssessmentReportDialog
                    assessmentId="a1"
                    instituteId="i1"
                    assessmentName="MRT 01"
                    onClose={vi.fn()}
                />
            </Dialog>
        </QueryClientProvider>
    );

describe('AiAssessmentReportDialog history', () => {
    beforeEach(() => {
        request.mockReset();
        // jsdom has no object-URL plumbing; the download path needs both.
        window.URL.createObjectURL = vi.fn(() => 'blob:x');
        window.URL.revokeObjectURL = vi.fn();
    });

    it('lists past generations but not the live one', async () => {
        request.mockResolvedValue({ data: status() });
        renderDialog();

        await screen.findByText('aiReport.historyTitle');
        // 3 rows exist, but only the 2 superseded ones get a download link —
        // the live report already has its own primary button.
        expect(await screen.findAllByText('aiReport.historyDownload')).toHaveLength(2);
    });

    it('downloads a past version by id, not by regenerating', async () => {
        request.mockImplementation((config: { responseType?: string }) =>
            config.responseType === 'blob'
                ? Promise.resolve({ data: new Blob(['%PDF']) })
                : Promise.resolve({ data: status() })
        );
        renderDialog();

        const links = await screen.findAllByText('aiReport.historyDownload');
        fireEvent.click(links[1]!);

        await waitFor(() => {
            const pdfCall = request.mock.calls
                .map((c) => c[0] as { params?: Record<string, unknown> })
                .find((c) => c.params?.versionId);
            expect(pdfCall?.params).toMatchObject({
                versionId: 'v1',
                generate: false,
                regenerate: false,
            });
        });
    });

    it('shows no history block when only one report exists', async () => {
        request.mockResolvedValue({
            data: status({ history: [{ id: 'v1', generated_at: '2026-09-04T10:00:00Z', current: true }] }),
        });
        renderDialog();

        await screen.findByText('aiReport.title');
        expect(screen.queryByText('aiReport.historyTitle')).toBeNull();
    });

    it('survives a backend with no history field at all', async () => {
        // An older assessment_service build returns the status without it.
        const { history: _omitted, ...withoutHistory } = status();
        request.mockResolvedValue({ data: withoutHistory });
        renderDialog();

        await screen.findByText('aiReport.title');
        expect(screen.queryByText('aiReport.historyTitle')).toBeNull();
    });
});
