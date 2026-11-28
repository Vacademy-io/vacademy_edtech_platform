import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { AxiosError, AxiosHeaders } from 'axios';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ScanSession } from '../-services/scan-station-services';

const axiosCall = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: (...a: unknown[]) => axiosCall(...a) }));
vi.mock('@/constants/urls', () => ({ SCAN_STATION_BASE_URL: '/scan' }));
vi.mock('@/components/common/ai-credits/useToolCostPreview', () => ({
    useToolCostPreview: () => ({ credits: 10, currentBalance: 100, sufficient: true }),
}));
vi.mock('@/components/common/ai-copy-check/CommentPlacementPicker', () => ({
    CommentPlacementPicker: () => null,
    useInstituteCommentPlacement: () => [null, vi.fn()],
}));
vi.mock('@/components/common/ai-copy-check/CopyCheckSettingsFields', () => ({
    CopyCheckSettingsFields: () => null,
    toCopyCheckConfig: () => ({}),
    useCopyCheckSettings: () => [{ subject: '' }, vi.fn()],
}));
vi.mock('@/components/common/ai-copy-check/CopyCheckCriteriaPanel', () => ({
    CopyCheckCriteriaPanel: () => null,
}));
vi.mock(
    '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services',
    () => ({ getCopyCheckConfig: vi.fn() })
);
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { StartCheckingDialog } from './StartCheckingDialog';
import { scanConfigKey, scanSessionKey } from '../-hooks/useScanActions';

const refused = (status: number, ex: string) =>
    new AxiosError(ex, String(status), undefined, undefined, {
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { ex },
    });

const BUILT = {
    id: 's1',
    status: 'BUILT',
    verdict: 'READY',
    built: [{ copy_key: 'L1-S0', file_id: 'out1', page_count: 4 }],
} as unknown as ScanSession;

const setup = () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const onOpenChange = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(
        <StartCheckingDialog
            open
            onOpenChange={onOpenChange}
            session={BUILT}
            assessmentId="a1"
            instituteId="inst1"
            onStarted={vi.fn()}
        />,
        { wrapper }
    );
    return { invalidate, onOpenChange };
};

describe('StartCheckingDialog refusals', () => {
    beforeEach(() => {
        axiosCall.mockReset();
        toastError.mockReset();
    });

    it('turns PLAN_CHANGED into the clerk’s language and refreshes the session', async () => {
        axiosCall.mockRejectedValue(
            refused(409, 'PLAN_CHANGED: the copies changed after they were made; make them again')
        );
        const { invalidate, onOpenChange } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'start.confirm' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('start.planChanged'));
        expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('PLAN_CHANGED'));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: scanSessionKey('s1', 'inst1') });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('any other 409 says the session changed and refreshes it', async () => {
        axiosCall.mockRejectedValue(refused(409, 'Scan session is not built'));
        const { invalidate } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'start.confirm' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('errors.locked'));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: scanSessionKey('s1', 'inst1') });
    });

    it('a 404 (switched off) re-reads the config', async () => {
        axiosCall.mockRejectedValue(refused(404, 'Not found'));
        const { invalidate } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'start.confirm' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('start.failed'));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: scanConfigKey('inst1') });
    });

    it('still shows the server text for any other failure', async () => {
        axiosCall.mockRejectedValue(refused(422, 'Not enough credits'));
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'start.confirm' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Not enough credits'));
    });
});
