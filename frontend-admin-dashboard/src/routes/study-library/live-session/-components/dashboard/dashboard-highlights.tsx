import { useMemo, useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
    CalendarCheck,
    ChalkboardTeacher,
    Star,
    Trophy,
    UsersFour,
    WarningCircle,
    UserMinus,
} from '@phosphor-icons/react';
import { format, parse } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
    DashboardBatchStats,
    DashboardClassRow,
    DashboardDailyPoint,
    DashboardInstructorStats,
} from '../../-services/live-class-dashboard';
import {
    EMPTY_VALUE,
    formatCount,
    formatDuration,
    formatRate,
    formatRating,
    rateTone,
    type RateTone,
} from '../../-utils/dashboard-format';
import { avatarTint, computeInsights, initialsOf } from '../../-utils/dashboard-insights';
import { EmptyChart, SectionCard } from './dashboard-charts';

// Progress's indicator is a child div; recolour it per tone.
const METER_TONE: Record<RateTone, string> = {
    success: '[&>div]:bg-success-500',
    warning: '[&>div]:bg-warning-500',
    danger: '[&>div]:bg-danger-500',
    neutral: '[&>div]:bg-neutral-300',
};

const TONE_TEXT: Record<RateTone, string> = {
    success: 'text-success-700',
    warning: 'text-warning-700',
    danger: 'text-danger-600',
    neutral: 'text-neutral-500',
};

export function Avatar({
    id,
    name,
    className,
}: {
    id: string;
    name: string | null;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                avatarTint(id),
                className
            )}
            aria-hidden
        >
            {initialsOf(name)}
        </span>
    );
}

const formatDay = (iso: string) => {
    const d = parse(iso, 'yyyy-MM-dd', new Date());
    return Number.isNaN(d.getTime()) ? iso : format(d, 'EEE, dd MMM');
};

// ─── Insights strip ─────────────────────────────────────────────────────────

type InsightTone = 'success' | 'danger' | 'warning' | 'info';

const INSIGHT_TONE: Record<InsightTone, string> = {
    success: 'bg-success-50 text-success-600',
    danger: 'bg-danger-50 text-danger-600',
    warning: 'bg-warning-50 text-warning-600',
    info: 'bg-info-50 text-info-600',
};

function InsightCard({
    icon: IconCmp,
    tone,
    label,
    title,
    meta,
    onClick,
}: {
    icon: Icon;
    tone: InsightTone;
    label: string;
    title: string;
    meta: string;
    onClick?: () => void;
}) {
    const body = (
        <>
            <span
                className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                    INSIGHT_TONE[tone]
                )}
            >
                <IconCmp size={20} weight="duotone" />
            </span>
            <span className="flex min-w-0 flex-col text-left">
                <span className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                    {label}
                </span>
                <span className="truncate text-body font-semibold text-neutral-900" title={title}>
                    {title}
                </span>
                <span className="truncate text-caption text-neutral-500">{meta}</span>
            </span>
        </>
    );
    const shell =
        'flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-card p-4 shadow-sm';
    return onClick ? (
        <Card
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
            className={cn(
                shell,
                'cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300'
            )}
        >
            {body}
        </Card>
    ) : (
        <Card className={shell}>{body}</Card>
    );
}

export function InsightsStrip({
    classes,
    instructors,
    daily,
    classesTerm,
    onOpen,
}: {
    classes: DashboardClassRow[];
    instructors: DashboardInstructorStats[];
    daily: DashboardDailyPoint[];
    classesTerm: string;
    onOpen: (row: DashboardClassRow) => void;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const insights = useMemo(
        () => computeInsights(classes, instructors, daily),
        [classes, instructors, daily]
    );
    const { bestClass, lowestClass, topTeacher, zeroJoinClasses, busiestDay } = insights;
    if (!bestClass && !topTeacher && !busiestDay) return null;

    const classMeta = (c: DashboardClassRow) =>
        t('insights.classMeta', {
            rate: formatRate(c.attendance_rate),
            date: formatDay(c.meeting_date),
        });

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {bestClass && (
                <InsightCard
                    icon={Trophy}
                    tone="success"
                    label={t('insights.best')}
                    title={bestClass.title || t('table.untitled')}
                    meta={classMeta(bestClass)}
                    onClick={() => onOpen(bestClass)}
                />
            )}
            {lowestClass && (
                <InsightCard
                    icon={WarningCircle}
                    tone="danger"
                    label={t('insights.lowest')}
                    title={lowestClass.title || t('table.untitled')}
                    meta={classMeta(lowestClass)}
                    onClick={() => onOpen(lowestClass)}
                />
            )}
            {topTeacher ? (
                <InsightCard
                    icon={Star}
                    tone="warning"
                    label={t('insights.topTeacher')}
                    title={topTeacher.name || topTeacher.email || EMPTY_VALUE}
                    meta={t('insights.teacherMeta', {
                        rating: formatRating(topTeacher.avg_rating),
                        n: formatCount(topTeacher.feedback_count),
                    })}
                />
            ) : busiestDay ? (
                <InsightCard
                    icon={CalendarCheck}
                    tone="info"
                    label={t('insights.busiestDay')}
                    title={formatDay(busiestDay.date)}
                    meta={t('insights.busiestMeta', {
                        n: busiestDay.classes,
                        term: classesTerm.toLowerCase(),
                    })}
                />
            ) : null}
            <InsightCard
                icon={UserMinus}
                tone={zeroJoinClasses > 0 ? 'danger' : 'success'}
                label={t('insights.zeroJoin')}
                title={
                    zeroJoinClasses > 0
                        ? t('insights.zeroJoinTitle', {
                              n: zeroJoinClasses,
                              term: classesTerm.toLowerCase(),
                          })
                        : t('insights.zeroJoinNone')
                }
                meta={t('insights.zeroJoinMeta')}
            />
        </div>
    );
}

// ─── Teacher leaderboard ────────────────────────────────────────────────────

export function TeacherLeaderboard({
    instructors,
    teachersTerm,
    classesTerm,
}: {
    instructors: DashboardInstructorStats[];
    teachersTerm: string;
    classesTerm: string;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const units = { h: t('units.hourShort'), m: t('units.minuteShort') };

    return (
        <SectionCard
            icon={ChalkboardTeacher}
            title={t('teachers.title', { term: teachersTerm })}
            subtitle={t('teachers.subtitle', { term: classesTerm.toLowerCase() })}
        >
            {instructors.length === 0 ? (
                <EmptyChart
                    text={t('empty.noClassesInRange', { term: classesTerm.toLowerCase() })}
                />
            ) : (
                <ol className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
                    {instructors.map((ins, idx) => {
                        const tone = rateTone(ins.attendance_rate);
                        return (
                            <li
                                key={ins.user_id}
                                className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-neutral-50"
                            >
                                <span
                                    className={cn(
                                        'w-6 shrink-0 text-center text-caption font-semibold tabular-nums',
                                        idx < 3 ? 'text-primary-500' : 'text-neutral-400'
                                    )}
                                >
                                    {idx + 1}
                                </span>
                                <Avatar id={ins.user_id} name={ins.name || ins.email} />
                                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="truncate text-body font-semibold text-neutral-900">
                                            {ins.name || ins.email || EMPTY_VALUE}
                                        </span>
                                        <span
                                            className={cn(
                                                'shrink-0 text-body font-semibold tabular-nums',
                                                TONE_TEXT[tone]
                                            )}
                                        >
                                            {formatRate(ins.attendance_rate)}
                                        </span>
                                    </div>
                                    <Progress
                                        value={(ins.attendance_rate ?? 0) * 100}
                                        className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                                        aria-hidden
                                    />
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-neutral-500">
                                        <span>
                                            {t('teachers.classesCount', {
                                                n: ins.classes,
                                                term: classesTerm.toLowerCase(),
                                            })}
                                        </span>
                                        <span>
                                            {t('teachers.joinsCount', {
                                                n: formatCount(ins.joined),
                                            })}
                                        </span>
                                        <span>
                                            {t('teachers.avgTime', {
                                                time: formatDuration(
                                                    ins.avg_attended_minutes,
                                                    units
                                                ),
                                            })}
                                        </span>
                                        {ins.avg_rating !== null && (
                                            <span className="flex items-center gap-0.5 font-semibold text-neutral-700">
                                                <Star
                                                    size={12}
                                                    weight="fill"
                                                    className="text-warning-500"
                                                />
                                                {formatRating(ins.avg_rating)}
                                                <span className="font-regular text-neutral-400">
                                                    ({ins.feedback_count})
                                                </span>
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </SectionCard>
    );
}

// ─── Batch attendance ───────────────────────────────────────────────────────

type BatchSort = 'lowest' | 'highest' | 'largest';
const BATCH_SORTS: BatchSort[] = ['lowest', 'highest', 'largest'];

export function BatchAttendanceCard({
    batches,
    batchLabel,
    batchesTerm,
    classesTerm,
}: {
    batches: DashboardBatchStats[];
    batchLabel: (id: string) => string;
    batchesTerm: string;
    classesTerm: string;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const [sort, setSort] = useState<BatchSort>('lowest');
    const rows = useMemo(() => {
        // Batches with no finished class yet have no rate — keep them last.
        const rated = batches.filter((b) => b.attendance_rate !== null);
        const unrated = batches.filter((b) => b.attendance_rate === null);
        const sorted = [...rated].sort((a, b) =>
            sort === 'largest'
                ? b.expected - a.expected
                : sort === 'lowest'
                  ? (a.attendance_rate ?? 0) - (b.attendance_rate ?? 0)
                  : (b.attendance_rate ?? 0) - (a.attendance_rate ?? 0)
        );
        return [...sorted, ...unrated];
    }, [batches, sort]);

    return (
        <SectionCard
            icon={UsersFour}
            title={t('batches.title', { term: batchesTerm })}
            subtitle={t('batches.subtitle', { term: classesTerm.toLowerCase() })}
            right={
                <Tabs value={sort} onValueChange={(v) => setSort(v as BatchSort)}>
                    <TabsList className="h-auto">
                        {BATCH_SORTS.map((s) => (
                            <TabsTrigger key={s} value={s} className="text-caption">
                                {t(`batches.sort.${s}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            }
        >
            {rows.length === 0 ? (
                <EmptyChart text={t('empty.noBatches', { term: batchesTerm.toLowerCase() })} />
            ) : (
                <ul className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
                    {rows.map((b) => {
                        const tone = rateTone(b.attendance_rate);
                        return (
                            <li
                                key={b.package_session_id}
                                className="flex flex-col gap-1.5 rounded-lg px-2 py-2.5 hover:bg-neutral-50"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="truncate text-body font-semibold text-neutral-800">
                                        {batchLabel(b.package_session_id)}
                                    </span>
                                    <span
                                        className={cn(
                                            'shrink-0 text-body font-semibold tabular-nums',
                                            TONE_TEXT[tone]
                                        )}
                                    >
                                        {formatRate(b.attendance_rate)}
                                    </span>
                                </div>
                                <Progress
                                    value={(b.attendance_rate ?? 0) * 100}
                                    className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                                    aria-hidden
                                />
                                <span className="text-caption text-neutral-500">
                                    {t('batches.meta', {
                                        n: b.classes,
                                        term: classesTerm.toLowerCase(),
                                        present: formatCount(b.present),
                                        expected: formatCount(b.expected),
                                    })}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}
