import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    decideScan,
    scanDecision,
    SCAN_CONFIG_KEY,
    SCAN_SESSION_KEY,
    SCAN_SESSIONS_KEY,
    type ScanDecisionAction,
    type ScanDecisionBody,
    type ScanSession,
} from '../-services/scan-station-services';
import { apiErrorMessage, apiErrorStatus, isPlanChanged, isScanNotFound } from '../-lib/api-error';

export const scanSessionKey = (sessionId: string, instituteId: string) =>
    [SCAN_SESSION_KEY, sessionId, instituteId] as const;

export const scanConfigKey = (instituteId: string) => [SCAN_CONFIG_KEY, instituteId] as const;

/**
 * Handles a 404 from any scan-station call: the feature was switched off while
 * the page was open (or the session is gone). The config is read again at once,
 * whatever its staleTime, so the page shows the "switched off" state instead of
 * the session it last saw. Returns whether it was a 404.
 */
export const useOnScanNotFound = (instituteId: string) => {
    const queryClient = useQueryClient();
    return (e: unknown): boolean => {
        if (!isScanNotFound(e)) return false;
        void queryClient.invalidateQueries({ queryKey: scanConfigKey(instituteId) });
        return true;
    };
};

/**
 * Store a session the server just returned, so the screen shows the new plan at
 * once, and refresh the session list behind it.
 */
export const useApplySession = (instituteId: string) => {
    const queryClient = useQueryClient();
    return (session: ScanSession) => {
        queryClient.setQueryData(scanSessionKey(session.id, instituteId), session);
        void queryClient.invalidateQueries({ queryKey: [SCAN_SESSIONS_KEY] });
    };
};

/**
 * What to tell the clerk when an accept is refused because what they were
 * shown has changed (409 PLAN_CHANGED): the copy, the blank pages, or a flag.
 */
export const planChangedKey = (body: Pick<ScanDecisionBody, 'action' | 'code'>) =>
    body.action === 'ACCEPT_COPY'
        ? 'errors.copyChanged'
        : body.code === 'BLANKS_TO_CONFIRM'
          ? 'errors.blanksChanged'
          : 'errors.flagChanged';

/**
 * One clerk decision; the server re-plans and the screen takes its answer. An
 * accept carries expected_fingerprint (what the clerk was shown); when the
 * plan has moved on, the session is refreshed and the clerk told to look again.
 */
export const useScanActions = (sessionId: string, instituteId: string) => {
    const { t } = useTranslation('scanStation');
    const queryClient = useQueryClient();
    const apply = useApplySession(instituteId);
    const onNotFound = useOnScanNotFound(instituteId);
    const mutation = useMutation({
        mutationFn: (body: ScanDecisionBody) => decideScan(sessionId, instituteId, body),
        onSuccess: apply,
        onError: (e, body) => {
            if (onNotFound(e)) {
                toast.error(t('errors.decision'));
                return;
            }
            if (isPlanChanged(e)) {
                toast.error(t(planChangedKey(body)));
                void queryClient.invalidateQueries({
                    queryKey: scanSessionKey(sessionId, instituteId),
                });
                return;
            }
            if (apiErrorStatus(e) === 409) {
                toast.error(t('errors.locked'));
                void queryClient.invalidateQueries({
                    queryKey: scanSessionKey(sessionId, instituteId),
                });
                return;
            }
            toast.error(apiErrorMessage(e, t('errors.decision')));
        },
    });
    const decide = (
        action: ScanDecisionAction,
        fields: Partial<Omit<ScanDecisionBody, 'action'>> = {}
    ) => mutation.mutate(scanDecision(action, fields));
    return { decide, pending: mutation.isPending };
};

export type DecideFn = ReturnType<typeof useScanActions>['decide'];
