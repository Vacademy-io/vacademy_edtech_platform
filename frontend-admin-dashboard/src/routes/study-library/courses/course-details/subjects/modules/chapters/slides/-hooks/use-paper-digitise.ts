import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    isInsufficientCreditsError,
    paperDigitiseErrorMessage,
    rememberPendingPaperRead,
    startPaperDigitise,
    type DigitisedPaper,
    type PaperDigitiseStart,
} from '@/services/paper-digitise';

export type DigitiseState =
    | { phase: 'idle' }
    | { phase: 'review'; paper: DigitisedPaper }
    | { phase: 'failed'; message: string };

/**
 * Start a question-paper read for a test and, later, bring its result into a
 * review step. Shared by the slide create form and "Enable AI checking".
 *
 * The read runs for minutes, so nothing here waits for it: `start` returns as
 * soon as the job exists and remembers it for the root watcher (one toast when
 * it settles) — the test's own card shows progress from the server. When the
 * teacher is ready, `attach(paper)` opens the review.
 *
 *  - `starting` covers the window before the job exists — a double-click there
 *    would start, and charge, two reads;
 *  - nothing touches state after unmount.
 */
export const usePaperDigitise = () => {
    const { t } = useTranslation('studyLibraryAssessmentCreateForm');
    const queryClient = useQueryClient();
    const [state, setState] = useState<DigitiseState>({ phase: 'idle' });
    const [starting, setStarting] = useState(false);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    /** Kick off a read. Resolves with the job once it exists, null when it could not start. */
    const start = useCallback(
        async (input: {
            pdfUrl: string;
            expectedTotalMarks?: number;
            title?: string;
            assessmentId: string;
            /** Shown in the toast and the bell. */
            name: string;
            returnPath?: string;
        }): Promise<PaperDigitiseStart | null> => {
            if (starting) return null;
            setStarting(true);
            try {
                const started = await startPaperDigitise(input);
                rememberPendingPaperRead({
                    taskId: started.task_id,
                    assessmentId: input.assessmentId,
                    name: input.name,
                    path: input.returnPath ?? '',
                });
                queryClient.invalidateQueries({ queryKey: ['PAPER_READ', input.assessmentId] });
                if (alive.current) setState({ phase: 'idle' });
                return started;
            } catch (error: unknown) {
                if (!alive.current) return null;
                const message = isInsufficientCreditsError(error)
                    ? paperDigitiseErrorMessage(error, t('aiCheck.insufficientCredits'))
                    : paperDigitiseErrorMessage(error, t('aiCheck.startFailed'));
                setState({ phase: 'failed', message });
                return null;
            } finally {
                if (alive.current) setStarting(false);
            }
        },
        [queryClient, starting, t]
    );

    /** A finished read the teacher wants to look at now. */
    const attach = useCallback(
        (paper: DigitisedPaper) => {
            if (paper.questions.length === 0) {
                setState({ phase: 'failed', message: t('aiCheck.noQuestions') });
            } else {
                setState({ phase: 'review', paper });
            }
        },
        [t]
    );

    /** Close whatever is open and go back to idle. */
    const abandon = useCallback(() => {
        setState({ phase: 'idle' });
    }, []);

    return { state, starting, start, attach, abandon };
};
