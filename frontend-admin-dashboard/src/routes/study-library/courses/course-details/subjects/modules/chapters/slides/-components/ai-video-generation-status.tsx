import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleNotch, FilmSlate, StopCircle, XCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cancelLmsVideo, parseLmsVideoError, type LmsVideoStatus } from '@/services/lms-ai-video';

const NS = 'studyLibraryVideoSlidePreview';

/** Pipeline stages with a teacher-friendly label; anything else reads "Working on it". */
const KNOWN_STAGES = new Set([
    'PENDING',
    'EXTRACT',
    'SCRIPT',
    'TTS',
    'WORDS',
    'AVATAR',
    'HTML',
    'RENDER',
    'WRITE_BACK',
    'AWAITING_INPUT',
]);

export const stageKey = (status: LmsVideoStatus): string => {
    const stage = (status.current_stage || status.status || '').toUpperCase();
    return KNOWN_STAGES.has(stage) ? stage : 'default';
};

export const clampPercentage = (value: number | null | undefined): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
};

/** Live progress of an AI video that is still being generated, with a confirmed Cancel. */
export function AiVideoProgressCard({
    status,
    onCancelled,
}: {
    status: LmsVideoStatus;
    /** Called after a successful cancel so the caller re-reads the status. */
    onCancelled: () => void;
}) {
    const { t } = useTranslation(NS);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const percentage = clampPercentage(status.percentage);
    const shotsTotal = status.shots_total ?? 0;
    const shotsDone = Math.min(status.shots_completed ?? 0, shotsTotal);

    const handleCancel = async () => {
        setCancelling(true);
        try {
            await cancelLmsVideo(status.video_id);
            toast.success(t('aiVideo.cancel.success'));
            setConfirmOpen(false);
            onCancelled();
        } catch (error) {
            toast.error(parseLmsVideoError(error, t('aiVideo.cancel.failed')).detail);
        } finally {
            setCancelling(false);
        }
    };

    return (
        <div className="flex w-full justify-center p-4">
            <div
                className="flex w-full max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm"
                aria-live="polite"
            >
                <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                        <FilmSlate className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-subtitle font-semibold text-foreground">
                            {t('aiVideo.progress.title')}
                        </h3>
                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <CircleNotch className="size-3.5 shrink-0 animate-spin" />
                            {t(`aiVideo.progress.stages.${stageKey(status)}`)}
                        </p>
                    </div>
                    <span className="shrink-0 text-subtitle font-semibold text-foreground">
                        {t('aiVideo.progress.percent', { value: percentage })}
                    </span>
                </div>

                <Progress
                    value={percentage}
                    className="h-2 border border-border"
                    aria-label={t('aiVideo.progress.title')}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    {shotsTotal > 0 ? (
                        <span>
                            {t('aiVideo.progress.shots', { done: shotsDone, total: shotsTotal })}
                        </span>
                    ) : (
                        <span />
                    )}
                    <span>{t('aiVideo.progress.keepWorking')}</span>
                </div>

                <div className="flex justify-end border-t border-border pt-3">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setConfirmOpen(true)}
                        className="gap-1.5"
                    >
                        <StopCircle className="size-4" />
                        {t('aiVideo.cancel.button')}
                    </MyButton>
                </div>
            </div>

            <AlertDialog open={confirmOpen} onOpenChange={(o) => !cancelling && setConfirmOpen(o)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('aiVideo.cancel.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('aiVideo.cancel.body')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cancelling}>
                            {t('aiVideo.cancel.keep')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={cancelling}
                            onClick={(e) => {
                                // Keep the dialog open until the request settles.
                                e.preventDefault();
                                void handleCancel();
                            }}
                            className="bg-danger-600 text-white hover:bg-danger-500"
                        >
                            {cancelling
                                ? t('aiVideo.cancel.cancelling')
                                : t('aiVideo.cancel.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

/** FAILED / CANCELLED: the run is over and its credits were refunded. No retry in phase 1. */
export function AiVideoEndedCard({ status }: { status: LmsVideoStatus }) {
    const { t } = useTranslation(NS);
    const cancelled = (status.status || '').toUpperCase() === 'CANCELLED';
    return (
        <div className="flex w-full justify-center p-4">
            <div
                role="status"
                className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-danger-200 bg-danger-50 p-6"
            >
                <div className="flex items-start gap-3">
                    <XCircle className="size-6 shrink-0 text-danger-600" weight="fill" />
                    <div className="min-w-0 space-y-1">
                        <h3 className="text-subtitle font-semibold text-danger-700">
                            {cancelled
                                ? t('aiVideo.ended.cancelledTitle')
                                : t('aiVideo.ended.failedTitle')}
                        </h3>
                        {!cancelled && status.error_message && (
                            <p className="break-words text-sm text-danger-700">
                                {t('aiVideo.ended.reason', { message: status.error_message })}
                            </p>
                        )}
                        <p className="text-sm text-danger-700">{t('aiVideo.ended.refunded')}</p>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">{t('aiVideo.ended.hint')}</p>
            </div>
        </div>
    );
}

/** Shown while the first status call is in flight. */
export function AiVideoCheckingCard() {
    const { t } = useTranslation(NS);
    return (
        <div className="flex h-64 items-center justify-center rounded-lg bg-muted">
            <div className="flex flex-col items-center gap-3">
                <CircleNotch className="size-8 animate-spin text-primary-500" />
                <p className="text-sm text-muted-foreground">{t('aiVideo.checking')}</p>
            </div>
        </div>
    );
}
