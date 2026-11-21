import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MonthValue } from '@/components/design-system/month-picker';
import { getInstituteId } from '@/constants/helper';
import { fetchJournalEntries, fetchPnlSnapshot, hrKeys } from '@/routes/erp/-shared/hr-service';
import type { JournalEntryDTO } from '@/routes/erp/-shared/hr-types';
import { normalizePnlSnapshot, type NormalizedPnl } from './pnl-shape';

// Re-exported so components can take the normalized shape without reaching past
// this hook into the parser module.
export type { NormalizedPnl };

/**
 * Data layer for the two finance screens.
 *
 * Both endpoints are one cheap month-scoped read, so there is no prefetching,
 * pagination or suspense plumbing here — just a query keyed by institute + period
 * so switching months is instant on the way back.
 */

/** "2026-07" — sorts correctly in a downloads folder, unlike "July 2026". */
export const monthFileStamp = ({ month, year }: MonthValue): string =>
    `${year}-${String(month).padStart(2, '0')}`;

/**
 * Hand a fetched blob to the browser as a download.
 *
 * The object URL is revoked on the next task rather than immediately: revoking it
 * in the same tick as the click cancels the download in Safari, which is exactly
 * the bug you only find in production. Revoking at all matters here because these
 * are CSVs an admin may pull for a dozen months in a row — each un-revoked URL
 * pins its blob in memory for the life of the tab.
 */
export function downloadBlobAsFile(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
}

export interface JournalQueryResult {
    entries: JournalEntryDTO[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
}

export function useJournal(period: MonthValue, enabled = true): JournalQueryResult {
    const instituteId = getInstituteId();

    const query = useQuery({
        queryKey: hrKeys.journal(period.year, period.month),
        queryFn: () => fetchJournalEntries(period.year, period.month),
        enabled: !!instituteId && enabled,
    });

    return {
        entries: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: () => void query.refetch(),
    };
}

export interface PnlQueryResult {
    snapshot: NormalizedPnl | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
}

/**
 * The P&L snapshot, already read through the defensive normalizer. Screens never
 * see the raw payload — that is what keeps a moved key from turning into a wrong
 * number on a finance dashboard.
 */
export function usePnlSnapshot(period: MonthValue, enabled = true): PnlQueryResult {
    const instituteId = getInstituteId();

    const query = useQuery({
        queryKey: hrKeys.pnlSnapshot(period.year, period.month),
        queryFn: () => fetchPnlSnapshot(period.year, period.month),
        enabled: !!instituteId && enabled,
    });

    const snapshot = useMemo(
        () => (query.data ? normalizePnlSnapshot(query.data) : undefined),
        [query.data]
    );

    return {
        snapshot,
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: () => void query.refetch(),
    };
}
