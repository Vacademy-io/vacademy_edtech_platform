/**
 * The question paper folders switch must be read from the server, not from the 24h
 * localStorage copy of the assessment settings: that copy kept folders hidden for a day
 * on every browser other than the one that turned them on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const getAssessmentSettings = vi.fn();
vi.mock('@/services/assessment-settings', () => ({
    getAssessmentSettings: (...args: unknown[]) => getAssessmentSettings(...args),
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: vi.fn() }));

const { useQuestionPaperFoldersEnabled } = await import('../question-paper-folders');

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe('useQuestionPaperFoldersEnabled', () => {
    beforeEach(() => {
        getAssessmentSettings.mockReset();
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    it('reads the setting from the server (forceRefresh), not the cached copy', async () => {
        getAssessmentSettings.mockResolvedValue({ questionPaperFolders: { enabled: true } });
        const { result } = renderHook(() => useQuestionPaperFoldersEnabled(), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
        expect(getAssessmentSettings).toHaveBeenCalledWith(true);
    });

    it('is off unless the setting is explicitly true', async () => {
        getAssessmentSettings.mockResolvedValue({});
        const { result } = renderHook(() => useQuestionPaperFoldersEnabled(), { wrapper });
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('does not fetch when disabled (the Question Papers page list itself)', () => {
        const { result } = renderHook(() => useQuestionPaperFoldersEnabled(false), { wrapper });
        expect(result.current).toBeUndefined();
        expect(getAssessmentSettings).not.toHaveBeenCalled();
    });
});
