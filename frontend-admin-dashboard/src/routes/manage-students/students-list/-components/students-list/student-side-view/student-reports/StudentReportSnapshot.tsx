import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    ArrowDown,
    ArrowUp,
    Books,
    CalendarCheck,
    ChartBar,
    Exam,
    TrendUp,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    getStudentReportSnapshotQuery,
    STRENGTH_THRESHOLD,
    type StudentReportSnapshot as Snapshot,
    type TopicMastery,
} from '@/services/student-report-snapshot';
import {
    ProfileEmpty,
    ProfileError,
    ProfileHeroStat,
    ProfileSectionCard,
    ProfileSkeleton,
} from '../profile-ui';

const MAX_TOPICS = 5;

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 10) / 10}%`);

/** Topics at or above the cut-off are strengths (best first); below it, weaknesses (weakest first). */
export const splitStrengths = (topics: TopicMastery[]) => {
    const scored = topics.filter((t) => t.accuracy != null && t.questions > 0);
    const strengths = scored
        .filter((t) => (t.accuracy ?? 0) >= STRENGTH_THRESHOLD)
        .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
    const weaknesses = scored
        .filter((t) => (t.accuracy ?? 0) < STRENGTH_THRESHOLD)
        .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
    return { strengths, weaknesses };
};

const Bar = ({
    value,
    tone,
}: {
    value: number | null | undefined;
    tone: 'success' | 'danger' | 'primary';
}) => (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100" aria-hidden>
        <div
            className={cn(
                'h-full rounded-full',
                tone === 'success' && 'bg-success-600',
                tone === 'danger' && 'bg-danger-600',
                tone === 'primary' && 'bg-primary-500'
            )}
            // Width is data, not a design token.
            style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
        />
    </div>
);

const TopicList = ({
    topics,
    tone,
    empty,
}: {
    topics: TopicMastery[];
    tone: 'success' | 'danger';
    empty: string;
}) =>
    topics.length === 0 ? (
        <p className="py-1 text-xs text-neutral-400">{empty}</p>
    ) : (
        <ul className="flex flex-col gap-2">
            {topics.slice(0, MAX_TOPICS).map((t) => (
                <li key={t.topic} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-neutral-700" title={t.topic}>
                            {t.topic}
                        </span>
                        <span className="shrink-0 text-neutral-500">
                            {pct(t.accuracy)} · {t.correct}/{t.questions}
                        </span>
                    </div>
                    <Bar value={t.accuracy} tone={tone} />
                </li>
            ))}
        </ul>
    );

/** Marks by subject with the class average beside it, when the assessments carry one. */
const SubjectGrid = ({ snapshot }: { snapshot: Snapshot }) => {
    const rows = useMemo(() => {
        const classAvg = new Map(
            (snapshot.academics?.subject_performance ?? []).map((s) => [
                s.subject.trim().toLowerCase(),
                s.class_average,
            ])
        );
        return (snapshot.subject_marks?.subjects ?? [])
            .filter((s) => s.subject)
            .map((s) => ({
                ...s,
                class_average: classAvg.get(s.subject.trim().toLowerCase()) ?? null,
            }))
            .sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1));
    }, [snapshot]);

    if (rows.length === 0) {
        return <p className="py-1 text-xs text-neutral-400">No graded work in these dates.</p>;
    }
    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rows.map((s) => {
                const tone =
                    s.percentage == null
                        ? 'primary'
                        : s.percentage >= STRENGTH_THRESHOLD
                          ? 'success'
                          : 'danger';
                return (
                    <div
                        key={s.subject}
                        className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2.5"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <span
                                className="truncate text-sm font-semibold text-neutral-700"
                                title={s.subject}
                            >
                                {s.subject}
                            </span>
                            <span
                                className={cn(
                                    'shrink-0 text-sm font-semibold',
                                    tone === 'success' && 'text-success-700',
                                    tone === 'danger' && 'text-danger-700',
                                    tone === 'primary' && 'text-neutral-600'
                                )}
                            >
                                {pct(s.percentage)}
                            </span>
                        </div>
                        <Bar value={s.percentage} tone={tone} />
                        <div className="flex justify-between text-2xs text-neutral-500">
                            <span>
                                {s.marks_obtained ?? '—'} / {s.total_marks ?? '—'} marks
                                {s.item_count ? ` · ${s.item_count} graded` : ''}
                            </span>
                            {s.class_average != null && (
                                <span>Class avg {pct(s.class_average)}</span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export const StudentReportSnapshot = ({
    userId,
    instituteId,
    batchId,
    range,
}: {
    userId: string;
    instituteId: string;
    batchId?: string;
    range: { start: string; end: string } | null;
}) => {
    const { data, isLoading, isError, refetch } = useQuery({
        ...getStudentReportSnapshotQuery({
            userId,
            instituteId,
            batchId,
            startDate: range?.start ?? '',
            endDate: range?.end ?? '',
        }),
    });

    const { strengths, weaknesses } = useMemo(
        () => splitStrengths(data?.learning_insights?.topic_mastery ?? []),
        [data]
    );

    if (!range) {
        return (
            <p className="text-xs text-neutral-500">Pick a start and end date to see the report.</p>
        );
    }
    if (isLoading) return <ProfileSkeleton blocks={3} />;
    if (isError || !data) {
        return (
            <ProfileError
                title="Couldn't load the report"
                hint="Check the dates and try again."
                onRetry={() => refetch()}
            />
        );
    }

    const academics = data.academics;
    const assessments = academics?.assessments?.length ?? 0;
    const hasTopics = (data.learning_insights?.topic_mastery?.length ?? 0) > 0;
    const nothing =
        !academics?.available &&
        !data.subject_marks?.available &&
        !data.learning_insights?.available &&
        !data.attendance?.available &&
        !data.course_progress?.available;

    if (nothing) {
        return (
            <ProfileEmpty
                icon={ChartBar as PhosphorIcon}
                title="Nothing to report for these dates"
                hint="No assessments, graded work, attendance or progress were recorded. Try a wider range."
            />
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
                <ProfileHeroStat
                    label="Average score"
                    value={pct(academics?.average_percentage)}
                    tone={
                        academics?.average_percentage == null
                            ? 'neutral'
                            : academics.average_percentage >= STRENGTH_THRESHOLD
                              ? 'success'
                              : 'warning'
                    }
                    icon={TrendUp as PhosphorIcon}
                />
                <ProfileHeroStat
                    label="Assessments taken"
                    value={assessments}
                    tone="neutral"
                    icon={Exam as PhosphorIcon}
                />
                <ProfileHeroStat
                    label="Attendance"
                    value={
                        data.attendance?.available ? pct(data.attendance.overall_percentage) : '—'
                    }
                    tone="neutral"
                    icon={CalendarCheck as PhosphorIcon}
                />
                <ProfileHeroStat
                    label="Course progress"
                    value={
                        data.course_progress?.available
                            ? pct(data.course_progress.overall_completion_percentage)
                            : '—'
                    }
                    tone="neutral"
                    icon={Books as PhosphorIcon}
                />
            </div>
            {academics?.class_average_percentage != null && (
                <p className="-mt-1 text-2xs text-neutral-500">
                    Class average {pct(academics.class_average_percentage)}
                    {academics.best_subject ? ` · Best: ${academics.best_subject}` : ''}
                    {academics.weakest_subject ? ` · Weakest: ${academics.weakest_subject}` : ''}
                </p>
            )}
            {!data.course_progress?.available && !batchId && (
                <p className="-mt-1 text-2xs text-neutral-500">
                    Pick a batch to see course progress.
                </p>
            )}

            <ProfileSectionCard icon={TrendUp as PhosphorIcon} heading="Strengths and weaknesses">
                {!hasTopics ? (
                    <p className="py-1 text-xs text-neutral-400">
                        Strengths and weaknesses come from analysed assessment attempts. None were
                        analysed in these dates.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <span className="flex items-center gap-1 text-xs font-semibold text-success-700">
                                <ArrowUp className="size-3.5" weight="bold" />
                                Strengths ({strengths.length})
                            </span>
                            <TopicList
                                topics={strengths}
                                tone="success"
                                empty="No topic at 60% or above yet."
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="flex items-center gap-1 text-xs font-semibold text-danger-700">
                                <ArrowDown className="size-3.5" weight="bold" />
                                Needs work ({weaknesses.length})
                            </span>
                            <TopicList
                                topics={weaknesses}
                                tone="danger"
                                empty="No topic below 60%."
                            />
                        </div>
                    </div>
                )}
                {hasTopics && (
                    <p className="mt-2 text-2xs text-neutral-400">
                        Topic accuracy from {data.learning_insights?.attempts_analyzed ?? 0}{' '}
                        analysed attempt(s). 60% or above counts as a strength.
                    </p>
                )}
            </ProfileSectionCard>

            <ProfileSectionCard icon={ChartBar as PhosphorIcon} heading="Performance by subject">
                <SubjectGrid snapshot={data} />
            </ProfileSectionCard>
        </div>
    );
};
