import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowClockwise,
    ArrowSquareOut,
    ClockCounterClockwise,
    Exam,
    FilmSlate,
    GraduationCap,
    Note,
    Spinner,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import type { StatusType } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    deleteGeneration,
    fetchGenerationPdf,
    listGenerations,
    publishGenerationLink,
} from '../-services/paper-service';
import type { PaperPdfOptions } from '../-services/paper-service';
import { PaperDownloadMenu } from './paper/PaperDownloadMenu';
import type { ArtifactType, GenerationStatus, KbGeneration } from '../-types/paper';

/**
 * Icon and label per artifact type. Adding a capability means one entry here —
 * the table, the endpoints and this list are all artifact-agnostic.
 */
const buildArtifactMeta = (
    t: TFunction
): Record<ArtifactType, { label: string; icon: typeof Exam }> => ({
    QUESTION_PAPER: { label: t('artifactType.questionPaper'), icon: Exam },
    COURSE: { label: t('artifactType.course'), icon: GraduationCap },
    PRESENTATION: { label: t('artifactType.presentation'), icon: FilmSlate },
    QUIZ: { label: t('artifactType.quiz'), icon: Exam },
    ASSESSMENT: { label: t('artifactType.assessment'), icon: Exam },
    NOTES: { label: t('artifactType.notes'), icon: Note },
    SUMMARY: { label: t('artifactType.summary'), icon: Note },
    LESSON_PLAN: { label: t('artifactType.lessonPlan'), icon: Note },
    WORKSHEET: { label: t('artifactType.worksheet'), icon: Note },
});

const buildStatusMeta = (
    t: TFunction
): Record<GenerationStatus, { label: string; tone: StatusType }> => ({
    DRAFT: { label: t('status.draft'), tone: 'INFO' },
    GENERATING: { label: t('status.generating'), tone: 'INFO' },
    READY: { label: t('status.notSavedYet'), tone: 'WARNING' },
    SAVED: { label: t('status.saved'), tone: 'SUCCESS' },
    FAILED: { label: t('status.failed'), tone: 'DANGER' },
});

const when = (iso: string | null, t: TFunction, locale: string): string => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return t('time.justNow');
    if (mins < 60) return t('time.minutesAgo', { count: mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return t('time.hoursAgo', { count: hours });
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
};

interface GenerationHistoryProps {
    kbId: string;
    /** Bump to refetch — e.g. after returning from a generation. */
    refreshKey?: number;
}

/**
 * Everything this knowledge base has produced.
 *
 * Exists because a generation used to live only in one browser tab: navigating
 * away, or a job failing, lost both the output AND the plan that produced it,
 * with no trace that it ever happened. A failed run stays here with its reason
 * and its blueprint, so it can be picked up rather than started over.
 */
export const GenerationHistory = ({ kbId, refreshKey = 0 }: GenerationHistoryProps) => {
    const { t, i18n } = useTranslation('knowledgeBaseGenerationHistory');
    const navigate = useNavigate();
    const [rows, setRows] = useState<KbGeneration[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const artifactMeta = buildArtifactMeta(t);
    const statusMeta = buildStatusMeta(t);

    useEffect(() => {
        let cancelled = false;
        listGenerations(kbId)
            .then((r) => !cancelled && setRows(r))
            .catch(() => !cancelled && setRows([]));
        return () => {
            cancelled = true;
        };
    }, [kbId, refreshKey]);

    // Anything still running should resolve without a manual refresh.
    useEffect(() => {
        if (!rows?.some((r) => r.status === 'GENERATING')) return;
        const handle = setTimeout(() => {
            listGenerations(kbId)
                .then(setRows)
                .catch(() => undefined);
        }, 5000);
        return () => clearTimeout(handle);
    }, [rows, kbId]);

    // Publish a variant and keep the row current, so reopening the share
    // dialog shows the link instead of minting another.
    const publish = async (row: KbGeneration, options: PaperPdfOptions) => {
        const link = await publishGenerationLink(row.id, options);
        setRows(
            (prev) =>
                prev?.map((r) =>
                    r.id === row.id
                        ? { ...r, published: { ...(r.published ?? {}), [link.variant]: link } }
                        : r
                ) ?? null
        );
        return link;
    };

    const remove = async (row: KbGeneration) => {
        setBusyId(row.id);
        try {
            await deleteGeneration(row.id);
            setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? null);
            toast.success(t('toast.removed'));
        } catch {
            toast.error(t('toast.removeFailed'));
        } finally {
            setBusyId(null);
        }
    };

    if (rows === null) return <Skeleton className="h-28 w-full rounded-lg" />;

    if (rows.length === 0) {
        return (
            <Card className="flex flex-col items-center gap-2 p-6 text-center">
                <ClockCounterClockwise className="size-6 text-neutral-300" />
                <p className="text-body text-neutral-500">{t('emptyState.title')}</p>
                <p className="text-caption text-neutral-400">{t('emptyState.description')}</p>
            </Card>
        );
    }

    return (
        <Card className="overflow-hidden">
            {rows.map((row) => {
                const meta = artifactMeta[row.artifact_type] ?? artifactMeta.QUESTION_PAPER;
                const status = statusMeta[row.status] ?? statusMeta.DRAFT;
                const Icon = meta.icon;
                const resumable = row.artifact_type === 'QUESTION_PAPER';

                return (
                    <div
                        key={row.id}
                        className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-3 last:border-b-0"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                                <Icon className="mt-0.5 size-5 shrink-0 text-neutral-400" />
                                <div className="min-w-0">
                                    <p className="break-words text-body font-medium text-neutral-700">
                                        {row.title}
                                    </p>
                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-neutral-500">
                                        <span>{meta.label}</span>
                                        {row.items_planned > 0 && (
                                            <span>
                                                {t('progress.questions', {
                                                    delivered: row.items_delivered,
                                                    planned: row.items_planned,
                                                    count: row.items_planned,
                                                })}
                                            </span>
                                        )}
                                        {row.credits_charged > 0 && (
                                            <span>
                                                {t('progress.credits', {
                                                    count: Math.round(row.credits_charged),
                                                })}
                                            </span>
                                        )}
                                        <span>{when(row.created_at, t, i18n.language)}</span>
                                    </p>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {row.status === 'GENERATING' ? (
                                    <span className="flex items-center gap-1.5 text-caption text-primary-500">
                                        <Spinner className="size-4 animate-spin" />
                                        {t('status.generating')}
                                    </span>
                                ) : (
                                    <StatusChip
                                        status={status.tone}
                                        text={status.label}
                                        textSize="text-caption"
                                        showIcon={false}
                                    />
                                )}
                            </div>
                        </div>

                        {row.status === 'FAILED' && row.error_message && (
                            <p className="ml-8 flex items-start gap-1.5 break-words text-caption text-danger-600">
                                <WarningCircle className="mt-0.5 size-3.5 shrink-0" />
                                {row.error_message}
                            </p>
                        )}

                        <div className="ml-8 flex flex-wrap items-center gap-2">
                            {resumable && row.status !== 'GENERATING' && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    disable={busyId === row.id}
                                    onClick={() =>
                                        navigate({
                                            to: '/knowledge-base/paper/$kbId',
                                            params: { kbId },
                                            search: { resume: row.id },
                                        })
                                    }
                                >
                                    <ArrowClockwise className="mr-1 size-3.5" />
                                    {row.status === 'FAILED'
                                        ? t('actions.tryAgain')
                                        : t('actions.open')}
                                </MyButton>
                            )}
                            {resumable &&
                                (row.status === 'READY' || row.status === 'SAVED') &&
                                row.items_delivered > 0 && (
                                    <PaperDownloadMenu
                                        scale="small"
                                        buttonType="text"
                                        disabled={busyId === row.id}
                                        title={row.title}
                                        published={row.published}
                                        fetchPdf={(options) => fetchGenerationPdf(row.id, options)}
                                        onPublish={(options) => publish(row, options)}
                                    />
                                )}
                            {row.status === 'SAVED' && (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => navigate({ to: '/assessment/question-papers' })}
                                >
                                    <ArrowSquareOut className="mr-1 size-3.5" />
                                    {t('actions.inQuestionBank')}
                                </MyButton>
                            )}
                            <MyButton
                                buttonType="text"
                                scale="small"
                                disable={busyId === row.id}
                                onClick={() => remove(row)}
                                className="text-danger-600"
                            >
                                <Trash className="mr-1 size-3.5" />
                                {t('actions.remove')}
                            </MyButton>
                        </div>
                    </div>
                );
            })}
        </Card>
    );
};
