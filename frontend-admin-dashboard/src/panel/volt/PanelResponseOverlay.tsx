/**
 * Live responses bar for quiz / feedback slides. Fork of
 * components/ResponseOverlay.tsx (140-174: poll GET engage/admin/{sid}/slide/
 * {slideId}/responses every 5 s; countdown from slide_start_timestamp), at
 * classroom size with design tokens.
 *
 * Reuses the admin LeaderboardModal and ResponseDistributionModal as-is. The
 * word cloud is PanelWordCloud: the admin WordCloudModal's layout library calls
 * OffscreenCanvas unguarded, which throws on the Chrome 66 panel WebView.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartBar, Cloud, Timer, Trophy, Users } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { LeaderboardModal } from '@/components/common/slides/components/LeaderboardModal';
import { ResponseDistributionModal } from '@/components/common/slides/components/ResponseDistributionModal';
import type { QuizSlideData } from '@/components/common/slides/utils/types';
import { BASE_URL } from '@/constants/urls';
import { cn } from '@/lib/utils';
import panelApi from '../lib/api';
import { PanelWordCloud } from './PanelWordCloud';

const POLL_MS = 5000;
const RESPONSES_URL_BASE = `${BASE_URL}/community-service/engage/admin/`;

/** AdminSlideResponseViewDto (ResponseOverlay.tsx:14-24). */
interface SlideResponse {
    username: string;
    time_to_response_millis: number;
    submitted_at: number;
    response_data: {
        type: string;
        selected_option_ids: string[];
        text_answer: string | null;
    };
    is_correct: boolean | null;
}

export interface PanelResponseOverlayProps {
    sessionId: string;
    slideData: QuizSlideData;
    slideStartTimestamp: number | null;
    defaultSecondsForQuestion: number;
    /** added_question from the session (real option UUIDs for matching answers). */
    addedQuestion?: unknown;
}

function useCountdown(startTs: number | null, totalSeconds: number): number {
    const compute = () => {
        if (totalSeconds <= 0) return 0;
        const elapsed = Math.floor((Date.now() - (startTs || Date.now())) / 1000);
        return Math.max(0, totalSeconds - elapsed);
    };
    const [remaining, setRemaining] = useState(compute);
    useEffect(() => {
        setRemaining(compute());
        if (totalSeconds <= 0) return undefined;
        const timer = window.setInterval(() => {
            const next = compute();
            setRemaining(next);
            if (next <= 0) window.clearInterval(timer);
        }, 1000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startTs, totalSeconds]);
    return remaining;
}

export function PanelResponseOverlay({
    sessionId,
    slideData,
    slideStartTimestamp,
    defaultSecondsForQuestion,
    addedQuestion,
}: PanelResponseOverlayProps) {
    const { t } = useTranslation('volt');
    const [responses, setResponses] = useState<SlideResponse[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState<'leaderboard' | 'distribution' | 'cloud' | null>(null);
    const remaining = useCountdown(slideStartTimestamp, defaultSecondsForQuestion);
    const isMcq = (slideData.elements?.singleChoiceOptions?.length ?? 0) > 0;

    useEffect(() => {
        let cancelled = false;
        setResponses([]);
        setLoaded(false);
        const fetchResponses = async () => {
            try {
                const response = await panelApi.get<SlideResponse[]>(
                    `${RESPONSES_URL_BASE}${encodeURIComponent(sessionId)}/slide/${encodeURIComponent(slideData.id)}/responses`
                );
                if (!cancelled && Array.isArray(response.data)) setResponses(response.data);
            } catch (error) {
                // Polling: stay quiet, the next tick retries (ResponseOverlay.tsx:155-158).
                console.warn('[panel/volt] responses poll failed', error);
            } finally {
                if (!cancelled) setLoaded(true);
            }
        };
        void fetchResponses();
        const timer = window.setInterval(() => void fetchResponses(), POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [sessionId, slideData.id]);

    const answers = useMemo(
        () => responses.map((response) => response.response_data?.text_answer),
        [responses]
    );

    const hasTimer = defaultSecondsForQuestion > 0;
    const expired = hasTimer && remaining <= 0;

    return (
        <>
            <div className="pointer-events-auto absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center space-x-6 rounded-lg border border-border bg-card px-6 py-3 shadow-lg">
                {hasTimer && (
                    <div
                        className={cn(
                            'flex items-center space-x-2 text-h2 font-semibold tabular-nums',
                            expired
                                ? 'text-danger-600'
                                : remaining <= 10
                                  ? 'text-warning-600'
                                  : 'text-neutral-800'
                        )}
                        role="timer"
                    >
                        <Timer size={36} aria-hidden />
                        <span>{expired ? t('responses.timeUp') : `${remaining}s`}</span>
                    </div>
                )}
                <div className="flex items-center space-x-2 text-h2 font-semibold tabular-nums text-neutral-800">
                    <Users size={36} aria-hidden />
                    <span className="whitespace-nowrap" aria-live="polite">
                        {loaded ? t('responses.count', { count: responses.length }) : '…'}
                    </span>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-5 sm:min-w-0"
                    onClick={() => setOpen('leaderboard')}
                >
                    <span className="flex items-center space-x-2">
                        <Trophy size={28} aria-hidden />
                        <span>{t('responses.leaderboard')}</span>
                    </span>
                </MyButton>
                {isMcq ? (
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-5 sm:min-w-0"
                        onClick={() => setOpen('distribution')}
                    >
                        <span className="flex items-center space-x-2">
                            <ChartBar size={28} aria-hidden />
                            <span>{t('responses.distribution')}</span>
                        </span>
                    </MyButton>
                ) : (
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-5 sm:min-w-0"
                        onClick={() => setOpen('cloud')}
                    >
                        <span className="flex items-center space-x-2">
                            <Cloud size={28} aria-hidden />
                            <span>{t('responses.wordCloud')}</span>
                        </span>
                    </MyButton>
                )}
            </div>

            <LeaderboardModal
                isOpen={open === 'leaderboard'}
                onClose={() => setOpen(null)}
                responses={responses}
                slideData={slideData}
                isMcq={isMcq}
                addedQuestion={addedQuestion}
            />
            {isMcq ? (
                <ResponseDistributionModal
                    isOpen={open === 'distribution'}
                    onClose={() => setOpen(null)}
                    responses={responses}
                    slideData={slideData}
                    addedQuestion={addedQuestion}
                />
            ) : (
                <PanelWordCloud
                    open={open === 'cloud'}
                    onOpenChange={(next) => setOpen(next ? 'cloud' : null)}
                    answers={answers}
                />
            )}
        </>
    );
}

export default PanelResponseOverlay;
