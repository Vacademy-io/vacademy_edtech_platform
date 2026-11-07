/**
 * Live-session state machine for the presenter:
 *   checking → waiting → live → finished      (plus lost / error)
 *
 * Reimplements the session half of SlideEditorComponent.tsx (create 530-548,
 * start 558-575, finish 733-760) and the SSE + optimistic move of
 * ActualPresentationDisplay.tsx (119-240, 285-337) without the editor, router,
 * audio, transcript or recommendation code.
 *
 * Creation happens before this hook mounts (activeSession.createLiveSession),
 * so a remount — error-boundary retry, Home and back, app restart — resumes the
 * stored session instead of creating a second one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    cacheSession,
    clearActiveSession,
    endSession,
    getCachedSession,
    readActiveSession,
    updateActiveSession,
    type ActiveVoltSession,
} from './activeSession';
import {
    openPresenterSse,
    type PresenterSseConnection,
    type PresenterSseStatus,
} from './presenterSse';
import {
    getUpdatedDetails,
    isServerRejection,
    moveSession,
    startSession,
    voltErrorMessage,
} from './voltApi';
import type { VoltLiveSession, VoltParticipant } from './types';

export type VoltLivePhase = 'checking' | 'waiting' | 'live' | 'finished' | 'lost' | 'error';

export interface PanelVoltSession {
    phase: VoltLivePhase;
    record: ActiveVoltSession | null;
    session: VoltLiveSession | null;
    participants: VoltParticipant[];
    sseStatus: PresenterSseStatus;
    slideIndex: number;
    slideStartTimestamp: number | null;
    errorDetail?: string;
    start: (firstSlideOrder: number) => Promise<void>;
    /** Optimistic: shows `index` at once, then tells the server (serialised, latest wins). */
    move: (index: number, slideOrder: number) => void;
    /** Finish on the server. Rethrows on a network failure (record kept). */
    end: () => Promise<void>;
    retry: () => void;
    reconnect: () => void;
}

export function usePanelVoltSession(sessionId: string | undefined): PanelVoltSession {
    const { t } = useTranslation('volt');
    const [phase, setPhase] = useState<VoltLivePhase>('checking');
    const [record, setRecord] = useState<ActiveVoltSession | null>(null);
    const [session, setSession] = useState<VoltLiveSession | null>(null);
    const [participants, setParticipants] = useState<VoltParticipant[]>([]);
    const [sseStatus, setSseStatus] = useState<PresenterSseStatus>('connecting');
    const [slideIndex, setSlideIndex] = useState(0);
    const [slideStartTimestamp, setSlideStartTimestamp] = useState<number | null>(null);
    const [errorDetail, setErrorDetail] = useState<string | undefined>();
    const [attempt, setAttempt] = useState(0);
    const sseRef = useRef<PresenterSseConnection | null>(null);

    // ---------------------------------------------------------------- resolve
    useEffect(() => {
        let cancelled = false;
        setPhase('checking');
        setErrorDetail(undefined);
        const stored = readActiveSession();
        if (!sessionId || !stored || stored.sessionId !== sessionId) {
            setRecord(null);
            setPhase('lost');
            return undefined;
        }
        setRecord(stored);

        // Straight after create the in-memory DTO is fresh; once live, the server's
        // copy (current slide, slide timer) is the truth, so re-read it.
        const cached = getCachedSession(sessionId);
        if (cached && stored.status === 'waiting') {
            setSession(cached);
            setSlideIndex(0);
            setSlideStartTimestamp(null);
            setPhase('waiting');
            return undefined;
        }

        getUpdatedDetails(sessionId)
            .then((server) => {
                if (cancelled) return;
                cacheSession(server);
                setSession(server);
                const live = server.session_status === 'LIVE';
                // The server's index is where learners are; prefer it to the stored one.
                const index =
                    typeof server.current_slide_index === 'number'
                        ? server.current_slide_index
                        : stored.slideIndex;
                setSlideIndex(index);
                setSlideStartTimestamp(server.slide_start_timestamp ?? null);
                updateActiveSession(sessionId, {
                    status: live ? 'live' : 'waiting',
                    slideIndex: index,
                });
                setPhase(live ? 'live' : 'waiting');
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                if (isServerRejection(error)) {
                    // Unknown or FINISHED on the server: nothing left to resume.
                    clearActiveSession(sessionId);
                    setPhase('lost');
                } else {
                    setErrorDetail(voltErrorMessage(error));
                    setPhase('error');
                }
            });
        return () => {
            cancelled = true;
        };
    }, [sessionId, attempt]);

    // -------------------------------------------------------------------- SSE
    const sseWanted = phase === 'waiting' || phase === 'live';
    useEffect(() => {
        if (!sessionId || !sseWanted) return undefined;
        const connection = openPresenterSse(sessionId, {
            onParticipants: (list) => setParticipants(list),
            onStatus: setSseStatus,
            onState: (state) => {
                if (state.sessionStatus === 'FINISHED') {
                    clearActiveSession(sessionId);
                    setPhase('finished');
                }
            },
        });
        sseRef.current = connection;
        setSseStatus(connection.getStatus());
        return () => {
            connection.close();
            if (sseRef.current === connection) sseRef.current = null;
        };
    }, [sessionId, sseWanted]);

    // ------------------------------------------------------------------ start
    const start = useCallback(
        async (firstSlideOrder: number) => {
            if (!sessionId) return;
            try {
                const result = await startSession(sessionId, firstSlideOrder);
                setSlideIndex(0);
                setSlideStartTimestamp(result?.slide_start_timestamp ?? Date.now());
                updateActiveSession(sessionId, { status: 'live', slideIndex: 0 });
                setPhase('live');
            } catch (error) {
                toast.error(t('live.startFailed'), { description: voltErrorMessage(error) });
            }
        },
        [sessionId, t]
    );

    // ------------------------------------------------------------------- move
    const wantedRef = useRef<{ index: number; order: number } | null>(null);
    const sentRef = useRef<number | null>(null);
    const inFlightRef = useRef(false);

    const pump = useCallback(async () => {
        if (!sessionId || inFlightRef.current) return;
        inFlightRef.current = true;
        try {
            while (wantedRef.current && wantedRef.current.index !== sentRef.current) {
                const target = wantedRef.current;
                try {
                    const result = await moveSession(sessionId, target.order);
                    sentRef.current = target.index;
                    if (
                        wantedRef.current?.index === target.index &&
                        result?.slide_start_timestamp
                    ) {
                        setSlideStartTimestamp(result.slide_start_timestamp);
                    }
                } catch (error) {
                    // One toast per failed sync (ActualPresentationDisplay.tsx:306), then stop.
                    toast.error(t('live.moveFailed'), { description: voltErrorMessage(error) });
                    sentRef.current = null;
                    break;
                }
            }
        } finally {
            inFlightRef.current = false;
        }
    }, [sessionId, t]);

    const move = useCallback(
        (index: number, slideOrder: number) => {
            setSlideIndex(index);
            if (!sessionId) return;
            setSlideStartTimestamp(Date.now());
            updateActiveSession(sessionId, { slideIndex: index });
            wantedRef.current = { index, order: slideOrder };
            void pump();
        },
        [sessionId, pump]
    );

    // -------------------------------------------------------------------- end
    const end = useCallback(async () => {
        if (!sessionId) return;
        await endSession(sessionId);
        sseRef.current?.close();
        setPhase('finished');
    }, [sessionId]);

    const retry = useCallback(() => setAttempt((value) => value + 1), []);
    const reconnect = useCallback(() => sseRef.current?.reconnect(), []);

    return {
        phase,
        record,
        session,
        participants,
        sseStatus,
        slideIndex,
        slideStartTimestamp,
        errorDetail,
        start,
        move,
        end,
        retry,
        reconnect,
    };
}
