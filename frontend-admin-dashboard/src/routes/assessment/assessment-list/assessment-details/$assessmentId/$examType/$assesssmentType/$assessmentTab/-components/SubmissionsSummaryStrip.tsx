import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ClipboardText, Hourglass, PaperPlaneTilt, ChartBar } from '@phosphor-icons/react';
import { getAdminParticipants, getAttemptsFileStatus } from '../-services/assessment-details-services';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { SubmissionStudentData } from '@/types/assessments/assessment-overview';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';

interface SubmissionsSummaryStripProps {
    assessmentId: string;
    instituteId: string | undefined;
    assessmentType: string;
    registrationSource: string;
    batches: MyFilterOption[];
    totalMarks: number;
    // Bump to force a refetch (e.g. after a manual refresh / revaluation / release).
    refreshKey?: number;
    // MANUAL evaluation assessments: the first tile becomes "Submissions / Attempts"
    // where submissions counts attempts with a submitted answer-sheet file.
    isManualEvaluation?: boolean;
}

interface SummaryStats {
    submitted: number;
    // Attempts with a submitted answer-sheet file (manual evaluation only; null otherwise).
    fileSubmissions: number | null;
    evaluated: number;
    pendingEvaluation: number;
    resultsReleased: number;
    avgScore: number | null;
    highScore: number | null;
    lowScore: number | null;
}

// Pull every attempted submission for the current slice (assessments are bounded,
// so a single large page is cheap) and derive the batch-level snapshot a teacher
// wants before drilling into individual rows.
const computeStats = (
    rows: SubmissionStudentData[],
    total: number,
    fileSubmissions: number | null
): SummaryStats => {
    const evaluated = rows.filter((r) => r.evaluation_status === 'COMPLETED').length;
    const pendingEvaluation = rows.filter(
        (r) => r.evaluation_status !== 'COMPLETED'
    ).length;
    const resultsReleased = rows.filter(
        (r) => r.report_release_result_status === 'RELEASED'
    ).length;

    // Only rows with an actual marks value count toward the score stats. An
    // ungraded attempt has score === null, and Number(null) === 0 would wrongly
    // pin the low score to 0 and deflate the average while grading is in progress.
    const scores = rows
        .filter((r) => r.score !== null && r.score !== undefined)
        .map((r) => (typeof r.score === 'number' ? r.score : Number(r.score)))
        .filter((s): s is number => typeof s === 'number' && !Number.isNaN(s));

    const avgScore = scores.length
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : null;

    return {
        submitted: total,
        fileSubmissions,
        evaluated,
        pendingEvaluation,
        resultsReleased,
        avgScore,
        highScore: scores.length ? Math.max(...scores) : null,
        lowScore: scores.length ? Math.min(...scores) : null,
    };
};

type TileAccent = 'success' | 'warning' | 'primary' | 'info' | 'neutral';

// Each accent pairs a tinted icon chip with the colour the headline number takes, so a
// glance across the row reads as five statuses rather than five identical boxes.
const TILE_ACCENTS: Record<TileAccent, { chip: string; icon: string; value: string }> = {
    success: { chip: 'bg-success-50', icon: 'text-success-600', value: 'text-success-600' },
    warning: { chip: 'bg-warning-100', icon: 'text-warning-600', value: 'text-warning-600' },
    primary: { chip: 'bg-primary-50', icon: 'text-primary-500', value: 'text-primary-500' },
    info: { chip: 'bg-info-50', icon: 'text-info-600', value: 'text-info-600' },
    neutral: { chip: 'bg-neutral-100', icon: 'text-neutral-500', value: 'text-neutral-700' },
};

const StatTile = ({
    icon,
    label,
    value,
    sublabel,
    accent = 'neutral',
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    sublabel?: string;
    accent?: TileAccent;
}) => {
    const styles = TILE_ACCENTS[accent];
    return (
        <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-3">
            <div
                className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg',
                    styles.chip
                )}
            >
                <span className={cn('flex items-center', styles.icon)}>{icon}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-caption text-neutral-500">{label}</span>
                <span className={cn('truncate text-h3 font-semibold leading-tight', styles.value)}>
                    {value}
                </span>
                {sublabel && (
                    <span className="text-2xs leading-tight text-neutral-400">{sublabel}</span>
                )}
            </div>
        </div>
    );
};

export const SubmissionsSummaryStrip = ({
    assessmentId,
    instituteId,
    assessmentType,
    registrationSource,
    batches,
    totalMarks,
    refreshKey = 0,
    isManualEvaluation = false,
}: SubmissionsSummaryStripProps) => {
    const { t } = useTranslation('assessmentSubmissionsSummaryStrip');

    // Cached via react-query: switching sub-tabs / remounting reuses the cached
    // stats instead of refiring the (large-page) participants call. refreshKey is
    // part of the key, so the existing "bump to refresh" contract (after
    // revaluation / release / upload) still forces a fresh fetch.
    const {
        data: stats = null,
        isLoading,
        isError,
    } = useQuery({
        queryKey: [
            'ASSESSMENT_SUBMISSIONS_SUMMARY',
            assessmentId,
            instituteId,
            assessmentType,
            registrationSource,
            batches.map((b) => b.id),
            isManualEvaluation,
            refreshKey,
        ],
        queryFn: async (): Promise<SummaryStats> => {
            // Single large page: evaluated/pending/score stats are derived from
            // these rows while "Submitted" uses total_elements. Assessments don't
            // approach this size in practice; beyond 1000 attempted submissions the
            // derived counts would undercount (Submitted stays exact).
            const data = await getAdminParticipants(assessmentId, instituteId, 0, 1000, {
                name: '',
                assessment_type: assessmentType,
                attempt_type: ['ENDED'],
                registration_source: registrationSource,
                batches,
                status: ['ACTIVE'],
                sort_columns: {},
            });
            const rows: SubmissionStudentData[] = data?.content ?? [];

            // Manual evaluation: count how many attempts have a submitted
            // answer-sheet file (batch endpoint; map only contains attempts
            // that have one). Non-fatal — the tile falls back to attempts only.
            let fileSubmissions: number | null = null;
            if (isManualEvaluation) {
                const attemptIds = rows
                    .map((r) => r.attempt_id)
                    .filter((id): id is string => Boolean(id));
                if (attemptIds.length > 0) {
                    try {
                        const fileMap = await getAttemptsFileStatus(attemptIds);
                        fileSubmissions = Object.keys(fileMap ?? {}).length;
                    } catch (error) {
                        console.error('Failed to load submission file counts:', error);
                    }
                } else {
                    fileSubmissions = 0;
                }
            }

            return computeStats(rows, data?.total_elements ?? rows.length, fileSubmissions);
        },
        staleTime: 5 * 60 * 1000,
    });

    if (isError) return null; // Fail quietly — the table below is the source of truth.

    if (isLoading) {
        return (
            <div className="flex h-16 items-center justify-center rounded-lg border border-neutral-200 bg-white">
                <DashboardLoader size={20} />
            </div>
        );
    }

    if (!stats || stats.submitted === 0) return null;

    return (
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            {/* Manual evaluation: attempts vs answer-sheet files actually submitted. */}
            {isManualEvaluation && stats.fileSubmissions !== null ? (
                <StatTile
                    icon={<ClipboardText size={20} />}
                    label={t('tiles.submissionsAttempts.label')}
                    value={t('tiles.ratio', {
                        numerator: stats.fileSubmissions,
                        denominator: stats.submitted,
                    })}
                    sublabel={t('tiles.submissionsAttempts.sublabel')}
                    accent="primary"
                />
            ) : (
                <StatTile
                    icon={<ClipboardText size={20} />}
                    label={t('tiles.submitted.label')}
                    value={String(stats.submitted)}
                    sublabel={t('tiles.submitted.sublabel')}
                    accent="primary"
                />
            )}
            <StatTile
                icon={<CheckCircle size={20} weight="fill" />}
                label={t('tiles.evaluated.label')}
                value={t('tiles.ratio', {
                    numerator: stats.evaluated,
                    denominator: stats.submitted,
                })}
                sublabel={t('tiles.evaluated.sublabel')}
                accent="success"
            />
            <StatTile
                icon={<Hourglass size={20} weight="fill" />}
                label={t('tiles.pendingEvaluation.label')}
                value={String(stats.pendingEvaluation)}
                sublabel={t('tiles.pendingEvaluation.sublabel')}
                accent="warning"
            />
            <StatTile
                icon={<PaperPlaneTilt size={20} weight="fill" />}
                label={t('tiles.resultsReleased.label')}
                value={t('tiles.ratio', {
                    numerator: stats.resultsReleased,
                    denominator: stats.submitted,
                })}
                sublabel={t('tiles.resultsReleased.sublabel')}
                accent="info"
            />
            <StatTile
                icon={<ChartBar size={20} weight="fill" />}
                // High/low move to the sub-label so the headline is the one number a
                // teacher actually scans for — the class average out of total marks.
                label={t('tiles.averageScore.label')}
                value={
                    stats.avgScore === null
                        ? '—'
                        : t('tiles.averageScore.value', {
                              avg: stats.avgScore.toFixed(1),
                              totalMarks,
                          })
                }
                sublabel={
                    stats.avgScore === null
                        ? undefined
                        : t('tiles.averageScore.sublabel', {
                              high: stats.highScore?.toFixed(1),
                              low: stats.lowScore?.toFixed(1),
                          })
                }
                accent="neutral"
            />
        </div>
    );
};
