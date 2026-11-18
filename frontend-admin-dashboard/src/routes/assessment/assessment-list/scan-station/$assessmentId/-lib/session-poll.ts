import type { ScanSession } from '../-services/scan-station-services';
import { isBusy } from './review-model';
import { isScanNotFound } from './api-error';

/**
 * How often to re-read a session: every `ms` while the server is still
 * working, never once a read has come back 404 (the feature was switched off,
 * or the session is gone). A failed refetch keeps the last data, so polling
 * keyed on the data alone would go on asking the same 404 forever.
 */
export const sessionPollInterval = (
    state: { data?: ScanSession; error: unknown },
    ms: number
): number | false => {
    if (isScanNotFound(state.error)) return false;
    return state.data && isBusy(state.data) ? ms : false;
};
