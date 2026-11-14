import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    forgetPendingPaperRead,
    getPaperDigitiseJob,
    isJobRunning,
    listPendingPaperReads,
} from '@/services/paper-digitise';

const TICK_MS = 10_000;

/**
 * Says, once, when a question-paper read started in this browser has settled.
 *
 * A read takes minutes and the teacher may have moved on, so this lives at the
 * root and watches the reads remembered in localStorage: on completion one
 * toast with a "Review" action (the bell alert from the server is the durable
 * copy), then the read is forgotten — so a reload, a second tab or the next
 * tick cannot announce it again. Nothing runs while the list is empty.
 */
export const PaperReadWatcher = ({ onOpen }: { onOpen: (path: string) => void }) => {
    const { t } = useTranslation('studyLibraryAssessmentCreateForm');
    const queryClient = useQueryClient();

    useEffect(() => {
        let busy = false;
        const tick = async () => {
            if (busy) return;
            const pending = listPendingPaperReads();
            if (pending.length === 0) return;
            busy = true;
            try {
                for (const read of pending) {
                    let job;
                    try {
                        job = await getPaperDigitiseJob(read.taskId);
                    } catch {
                        continue; // network blip or signed out — try again next tick
                    }
                    if (isJobRunning(job)) continue;
                    // forget FIRST: whoever removes it is the one who speaks
                    if (!forgetPendingPaperRead(read.taskId)) continue;
                    queryClient.invalidateQueries({ queryKey: ['PAPER_READ', read.assessmentId] });
                    queryClient.invalidateQueries({ queryKey: ['GET_AI_CREDITS'] });
                    if (job.status === 'COMPLETED' && job.result && job.result.questions.length > 0) {
                        toast.success(
                            t('background.readyToast', {
                                name: read.name,
                                count: job.result.questions.length,
                            }),
                            {
                                duration: 15_000,
                                action: read.path
                                    ? { label: t('background.review'), onClick: () => onOpen(read.path) }
                                    : undefined,
                            }
                        );
                    } else {
                        toast.error(
                            t('background.failedToast', {
                                name: read.name,
                                reason: job.status_message || t('aiCheck.readFailed'),
                            }),
                            { duration: 15_000 }
                        );
                    }
                }
            } finally {
                busy = false;
            }
        };
        void tick();
        const id = window.setInterval(() => void tick(), TICK_MS);
        return () => window.clearInterval(id);
    }, [onOpen, queryClient, t]);

    return null;
};
