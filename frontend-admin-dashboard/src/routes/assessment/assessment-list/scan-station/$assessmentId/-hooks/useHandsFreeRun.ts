import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    buildScanSession,
    startScanSession,
    type ScanSession,
} from '../-services/scan-station-services';
import { defaultStartBody, type HandsFreeSettings } from '../-lib/hands-free';
import { apiErrorMessage } from '../-lib/api-error';

/**
 * With "check by itself" on: as soon as every load is read and the session is
 * READY (nothing for a person to look at), make the copies; once they are made,
 * start the AI check with the test's usual settings. Each step is tried once per
 * state the session reaches, so a failure shows a message instead of a loop;
 * a session that needs a look simply waits until the clerk has looked.
 */
export const useHandsFreeRun = ({
    session,
    settings,
    assessmentId,
    instituteId,
    apply,
}: {
    session: ScanSession | undefined;
    settings: HandsFreeSettings;
    assessmentId: string;
    instituteId: string;
    apply: (session: ScanSession) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const tried = useRef(new Set<string>());

    const loadsRead =
        !!session &&
        session.loads.length > 0 &&
        session.loads.every((l) => l.status === 'DONE' || l.status === 'FAILED');
    const step: 'build' | 'start' | null =
        !session || !settings.autoCheck
            ? null
            : session.status === 'OPEN' && session.verdict === 'READY' && loadsRead
              ? 'build'
              : session.status === 'BUILT'
                ? 'start'
                : null;
    // One try per step per shape of the session: a new load or decision is a new shape.
    const key =
        session && step
            ? `${session.id}:${step}:${session.loads.length}:${session.copies.length}`
            : null;

    useEffect(() => {
        if (!session || !step || !key || tried.current.has(key)) return;
        tried.current.add(key);
        const run = async () => {
            try {
                if (step === 'build') {
                    apply(await buildScanSession(session.id, instituteId));
                } else {
                    const body = await defaultStartBody(
                        assessmentId,
                        instituteId,
                        settings.matchStudents
                    );
                    const result = await startScanSession(session.id, instituteId, body);
                    apply(result.session);
                    toast.success(t('start.started', { count: result.batch.total_items }));
                }
            } catch (e) {
                toast.error(
                    apiErrorMessage(e, t(step === 'build' ? 'bar.buildFailed' : 'start.failed'))
                );
            }
        };
        void run();
        // key captures every input that matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return { running: step !== null };
};
