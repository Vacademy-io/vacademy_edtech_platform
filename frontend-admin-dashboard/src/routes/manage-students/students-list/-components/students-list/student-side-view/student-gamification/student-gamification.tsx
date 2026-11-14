import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import {
    CalendarDots,
    ChartLineUp,
    Coins,
    Crown,
    Fire,
    LockKey,
    Medal,
    Ranking,
    Sparkle,
    Star,
    Trophy,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { HorizontalBars, PeriodChart } from '@/components/common/report-visuals/charts';
import { REPORT_COLORS, minutesLabel, useBrandColor } from '@/components/common/report-visuals/palette';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import { getBadgesRewardsConfig } from '@/routes/settings/-services/badges-settings';
import {
    getCourseLeaderboardAdmin,
    getInstituteLeaderboardAdmin,
    type LeaderboardEntry,
    type LeaderboardMetric,
    type LeaderboardWindow,
} from '@/services/leaderboard';
import { awardSource, getStudentAwardedBadges, type LearnerBadgeAward } from '@/services/student-badges';
import {
    POINTS_PER_LEVEL,
    getLearnerPointsHistoryQuery,
    getLearnerPointsSummaryQuery,
    type LearnerPointsSummary,
} from '@/services/student-gamification';
import { ALL_BATCHES, BatchPicker } from '../BatchPicker';
import { ProfileEmpty, ProfileError, ProfileSectionCard, ProfileSkeleton } from '../profile-ui';

/**
 * The learner's level, points, streak, active days, badges and where they stand on the
 * leaderboard. Read-only; awarding stays on the Badges tab. Shown inside Academic Activity and
 * when a learner is opened from Gamification and Points.
 */

const LEADERBOARD_ROWS = 10;
const CALENDAR_WEEKS = 26;

const niceDate = (iso?: string | null) => {
    if (!iso) return '';
    const d = iso.length === 10 ? parseISO(iso) : new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : format(d, 'd MMM yyyy');
};

const Tile = ({
    value,
    label,
    icon: Icon,
    tone = 'text-neutral-800',
}: {
    value: string | number;
    label: string;
    icon: typeof Star;
    tone?: string;
}) => (
    <div className="flex flex-col gap-1 rounded-lg bg-neutral-50 px-2.5 py-2">
        <span className={cn('text-lg font-bold leading-none', tone)}>{value}</span>
        <span className="flex items-center gap-1 text-2xs text-neutral-500">
            <Icon className="size-3" weight="duotone" />
            {label}
        </span>
    </div>
);

const LevelCard = ({
    summary,
    badges,
    enabled,
    rankLabel,
}: {
    summary: LearnerPointsSummary;
    badges: number;
    enabled: boolean;
    rankLabel: string;
}) => {
    const into = POINTS_PER_LEVEL - summary.pointsToNextLevel;
    return (
        <ProfileSectionCard icon={Star} heading="Level and points">
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                    <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-full bg-primary-50 text-primary-600">
                        <span className="text-2xs font-medium leading-none">Level</span>
                        <span className="text-xl font-bold leading-tight">{summary.level}</span>
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-lg font-bold text-neutral-800">
                            {summary.totalPoints.toLocaleString()} points
                        </span>
                        <div className="h-2 w-full rounded-full bg-neutral-100">
                            <div
                                className="h-full rounded-full bg-primary-500"
                                style={{ width: `${(into / POINTS_PER_LEVEL) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs text-neutral-500">
                            {summary.pointsToNextLevel} to level {summary.level + 1}
                        </span>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <Tile value={summary.todayPoints} label="Today" icon={Sparkle} />
                    <Tile value={summary.weekPoints} label="This week" icon={ChartLineUp} />
                    <Tile value={badges} label="Badges" icon={Medal} tone="text-warning-600" />
                    <Tile value={rankLabel} label="Rank" icon={Ranking} tone="text-primary-600" />
                    <Tile
                        value={summary.currentStreak ?? '—'}
                        label="Day streak"
                        icon={Fire}
                        tone="text-danger-600"
                    />
                    <Tile value={summary.longestStreak ?? '—'} label="Longest streak" icon={Crown} />
                </div>
                {!enabled && (
                    <p className="text-xs text-neutral-500">
                        Points and badges are switched off for this institute.
                    </p>
                )}
            </div>
        </ProfileSectionCard>
    );
};

/** The last seven days and six months of active days. */
const StreakCard = ({
    summary,
    activeDays,
    today,
    brand,
}: {
    summary: LearnerPointsSummary;
    activeDays: string[];
    today: string;
    brand: string;
}) => {
    const weeks = useMemo(() => {
        const set = new Set(activeDays);
        const end = parseISO(today);
        const first = addDays(startOfWeek(end, { weekStartsOn: 1 }), -7 * (CALENDAR_WEEKS - 1));
        const out: { iso: string; active: boolean; future: boolean }[][] = [];
        for (let w = 0; w < CALENDAR_WEEKS; w++) {
            const days = [];
            for (let d = 0; d < 7; d++) {
                const date = addDays(first, w * 7 + d);
                const iso = format(date, 'yyyy-MM-dd');
                days.push({ iso, active: set.has(iso), future: date > end });
            }
            out.push(days);
        }
        return out;
    }, [activeDays, today]);
    return (
        <ProfileSectionCard icon={Fire} heading="Streak and active days">
            <div className="flex flex-col gap-3">
                {summary.last7Days && (
                    <div className="grid grid-cols-7 gap-1">
                        {summary.last7Days.map((d) => (
                            <div key={d.date} className="flex flex-col items-center gap-1">
                                <span
                                    className={cn(
                                        'flex size-7 items-center justify-center rounded-full',
                                        d.active
                                            ? 'bg-warning-100 text-warning-600'
                                            : 'bg-neutral-100 text-neutral-300'
                                    )}
                                    title={niceDate(d.date)}
                                >
                                    <Fire className="size-4" weight={d.active ? 'fill' : 'regular'} />
                                </span>
                                <span className="text-2xs text-neutral-500">
                                    {format(parseISO(d.date), 'EEEEE')}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-neutral-600">
                        <CalendarDots className="size-3.5" weight="duotone" />
                        {activeDays.length} active day{activeDays.length === 1 ? '' : 's'} in six months
                    </span>
                    <div className="flex gap-[3px] overflow-x-auto pb-1">
                        {weeks.map((week) => (
                            <div key={week[0]?.iso} className="flex flex-col gap-[3px]">
                                {week.map((d) => (
                                    <span
                                        key={d.iso}
                                        title={d.future ? undefined : `${niceDate(d.iso)}${d.active ? ', active' : ''}`}
                                        className="size-2.5 rounded-sm"
                                        style={{
                                            background: d.future
                                                ? 'transparent'
                                                : d.active
                                                  ? brand
                                                  : REPORT_COLORS.line,
                                        }}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </ProfileSectionCard>
    );
};

const PointsCard = ({
    summary,
    weeks,
    brand,
}: {
    summary: LearnerPointsSummary;
    weeks: { weekStart: string; points: number }[];
    brand: string;
}) => {
    const max = Math.max(1, ...summary.breakdown.map((b) => b.points));
    return (
        <ProfileSectionCard icon={Coins} heading="Points over time">
            <div className="flex flex-col gap-3">
                <PeriodChart
                    brand={brand}
                    height={140}
                    valueLabel="Points"
                    data={weeks.map((w) => ({
                        key: w.weekStart,
                        label: format(parseISO(w.weekStart), 'd MMM'),
                        title: `Week of ${format(parseISO(w.weekStart), 'd MMM')}`,
                        value: w.points,
                    }))}
                />
                {summary.breakdown.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-neutral-600">Where points came from</span>
                        <HorizontalBars
                            color={brand}
                            max={max}
                            rows={summary.breakdown.map((b) => ({
                                key: b.key,
                                label: b.label,
                                value: b.points,
                                display: b.points.toLocaleString(),
                            }))}
                        />
                    </div>
                )}
            </div>
        </ProfileSectionCard>
    );
};

const BadgeTile = ({ award }: { award: LearnerBadgeAward }) => (
    <li className="flex items-start gap-2.5 rounded-lg border border-neutral-100 p-2">
        <span className="flex size-12 shrink-0 items-center justify-center">
            <BadgeVisual icon={award.badgeIcon ?? 'Trophy'} size={44} className="text-warning-500" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-neutral-800" title={award.badgeName ?? ''}>
                {award.badgeName ?? 'Badge'}
            </span>
            {award.badgeDescription && (
                <span className="text-xs text-neutral-500">{award.badgeDescription}</span>
            )}
            {award.reason && <span className="text-xs italic text-neutral-600">{award.reason}</span>}
            <span className="text-2xs text-neutral-400">
                {[awardSource(award) === 'AUTO' ? 'Earned' : 'Awarded by staff', niceDate(award.awardedAt)]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
        </div>
    </li>
);

const BadgesCard = ({
    awards,
    loading,
    summary,
}: {
    awards: LearnerBadgeAward[];
    loading: boolean;
    summary: LearnerPointsSummary | undefined;
}) => {
    const { data: config } = useQuery({
        queryKey: ['BADGES_REWARDS_CONFIG'],
        queryFn: getBadgesRewardsConfig,
        staleTime: 5 * 60_000,
    });
    const held = new Set(awards.map((a) => a.badgeId));
    const locked = (config?.badges ?? []).filter((b) => b.enabled !== false && !b.hidden && !held.has(b.id));
    const progress = (trigger: string, threshold: number) => {
        const current =
            trigger === 'xp_total'
                ? summary?.totalPoints
                : trigger === 'streak'
                  ? summary?.longestStreak
                  : null;
        if (current == null || threshold <= 0) return null;
        return { current: Math.min(current, threshold), threshold };
    };
    return (
        <ProfileSectionCard icon={Medal} heading={`Badges, ${awards.length} earned`}>
            {loading ? (
                <ProfileSkeleton blocks={2} />
            ) : (
                <div className="flex flex-col gap-3">
                    {awards.length === 0 ? (
                        <ProfileEmpty icon={Medal} title="No badges earned yet" />
                    ) : (
                        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            {awards.map((a) => (
                                <BadgeTile key={a.id} award={a} />
                            ))}
                        </ul>
                    )}
                    {locked.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                            <span className="flex items-center gap-1 text-xs font-medium text-neutral-600">
                                <LockKey className="size-3.5" weight="duotone" />
                                Still to earn
                            </span>
                            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                {locked.map((b) => {
                                    const p = progress(b.trigger, b.threshold);
                                    return (
                                        <li
                                            key={b.id}
                                            className="flex items-center gap-2.5 rounded-lg bg-neutral-50 p-2"
                                        >
                                            <span className="flex size-9 shrink-0 items-center justify-center opacity-40 grayscale">
                                                <BadgeVisual icon={b.icon} size={32} className="text-neutral-500" />
                                            </span>
                                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                <span className="truncate text-xs font-semibold text-neutral-700">
                                                    {b.name}
                                                </span>
                                                <span className="truncate text-2xs text-neutral-500" title={b.description}>
                                                    {b.description}
                                                </span>
                                                {p && (
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="h-1 flex-1 rounded-full bg-neutral-200">
                                                            <div
                                                                className="h-full rounded-full bg-primary-400"
                                                                style={{ width: `${(p.current / p.threshold) * 100}%` }}
                                                            />
                                                        </div>
                                                        <span className="shrink-0 text-2xs text-neutral-500">
                                                            {p.current}/{p.threshold}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </ProfileSectionCard>
    );
};

const Pill = ({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            active ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
        )}
    >
        {children}
    </button>
);

const PLACE_TONE: Record<number, string> = {
    1: 'bg-warning-100 text-warning-700',
    2: 'bg-neutral-200 text-neutral-700',
    3: 'bg-warning-50 text-warning-700',
};

const LeaderRow = ({
    entry,
    isLearner,
    metric,
}: {
    entry: LeaderboardEntry;
    isLearner: boolean;
    metric: LeaderboardMetric;
}) => (
    <li
        className={cn(
            'flex items-center gap-2 rounded-lg px-2 py-1.5',
            isLearner ? 'bg-primary-50 ring-1 ring-primary-200' : ''
        )}
    >
        <span
            className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                PLACE_TONE[entry.rank ?? 0] ?? 'bg-neutral-100 text-neutral-600'
            )}
        >
            {entry.rank ?? '—'}
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-sm', isLearner ? 'font-semibold text-primary-700' : 'text-neutral-700')}>
            {entry.name}
        </span>
        {entry.badgeCount > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-warning-600" title={`${entry.badgeCount} badges`}>
                <Medal className="size-3.5" weight="fill" />
                {entry.badgeCount}
            </span>
        )}
        <span className="shrink-0 text-sm font-semibold text-neutral-800">
            {metric === 'POINTS' ? entry.points.toLocaleString() : minutesLabel(entry.points)}
        </span>
    </li>
);

const LeaderboardCard = ({
    userId,
    packageSessionIds,
    defaultBatch,
    onRank,
}: {
    userId: string;
    packageSessionIds: string[];
    defaultBatch?: string;
    onRank: (label: string) => void;
}) => {
    const [scope, setScope] = useState<string>(defaultBatch ?? packageSessionIds[0] ?? ALL_BATCHES);
    const [metric, setMetric] = useState<LeaderboardMetric>('POINTS');
    const [period, setPeriod] = useState<LeaderboardWindow>('ALL');
    const effectiveWindow = metric === 'POINTS' ? period : 'ALL';
    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['SIDE_VIEW_LEADERBOARD', scope, metric, effectiveWindow],
        queryFn: () =>
            scope === ALL_BATCHES
                ? getInstituteLeaderboardAdmin({ metric, window: effectiveWindow })
                : getCourseLeaderboardAdmin(scope, { metric, window: effectiveWindow }),
        staleTime: 60_000,
    });
    const entries = data?.entries ?? [];
    const mine = entries.find((e) => e.userId === userId);
    const shown = entries.slice(0, LEADERBOARD_ROWS);
    const mineBelow = mine && !shown.includes(mine);
    const rankLabel = mine?.rank ? `#${mine.rank}` : '—';
    useEffect(() => {
        onRank(rankLabel);
    }, [rankLabel, onRank]);
    return (
        <ProfileSectionCard icon={Trophy} heading="Leaderboard">
            <div className="flex flex-col gap-2">
                <BatchPicker
                    packageSessionIds={packageSessionIds}
                    value={scope}
                    onChange={setScope}
                    alwaysShow
                    allLabel="Whole institute"
                    label="Compare within"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                    <Pill active={metric === 'POINTS'} onClick={() => setMetric('POINTS')}>
                        Points
                    </Pill>
                    <Pill active={metric === 'ACTIVITY'} onClick={() => setMetric('ACTIVITY')}>
                        Learning time
                    </Pill>
                    {metric === 'POINTS' && (
                        <>
                            <span className="mx-1 h-4 w-px bg-neutral-200" />
                            <Pill active={period === 'ALL'} onClick={() => setPeriod('ALL')}>
                                All time
                            </Pill>
                            <Pill active={period === 'WEEK'} onClick={() => setPeriod('WEEK')}>
                                This week
                            </Pill>
                        </>
                    )}
                </div>
                {isLoading ? (
                    <ProfileSkeleton blocks={3} />
                ) : isError ? (
                    <ProfileError title="Couldn't load the leaderboard" onRetry={() => refetch()} />
                ) : entries.length === 0 ? (
                    <ProfileEmpty icon={Trophy} title="Nobody on this leaderboard yet" />
                ) : (
                    <>
                        <p className="text-sm font-semibold text-neutral-800">
                            {mine?.rank
                                ? `Ranked #${mine.rank} of ${data?.totalLearners}`
                                : `Outside the top ${entries.length} of ${data?.totalLearners}`}
                        </p>
                        <ul className="flex flex-col gap-1">
                            {shown.map((e) => (
                                <LeaderRow
                                    key={`${e.userId ?? e.name}-${e.rank}`}
                                    entry={e}
                                    isLearner={e === mine}
                                    metric={metric}
                                />
                            ))}
                            {mineBelow && mine && (
                                <>
                                    <li className="text-center text-xs text-neutral-400">···</li>
                                    <LeaderRow entry={mine} isLearner metric={metric} />
                                </>
                            )}
                        </ul>
                    </>
                )}
            </div>
        </ProfileSectionCard>
    );
};

const HistoryCard = ({
    recent,
}: {
    recent: { id: string; label: string; points: number; reason: string | null; awardedAt: string | null }[];
}) => (
    <ProfileSectionCard icon={Coins} heading="Points history">
        {recent.length === 0 ? (
            <ProfileEmpty icon={Coins} title="No points earned yet" />
        ) : (
            <ul className="flex max-h-80 flex-col divide-y divide-neutral-100 overflow-y-auto">
                {recent.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 py-1.5">
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm text-neutral-800" title={a.reason ?? a.label}>
                                {a.reason || a.label}
                            </span>
                            <span className="truncate text-xs text-neutral-500">
                                {[a.reason ? a.label : null, niceDate(a.awardedAt)].filter(Boolean).join(' · ')}
                            </span>
                        </div>
                        <span
                            className={cn(
                                'shrink-0 text-sm font-semibold',
                                a.points < 0 ? 'text-danger-600' : 'text-success-600'
                            )}
                        >
                            {a.points > 0 ? `+${a.points}` : a.points}
                        </span>
                    </li>
                ))}
            </ul>
        )}
    </ProfileSectionCard>
);

export const StudentGamification = ({
    userId,
    instituteId,
    packageSessionIds,
    defaultBatch,
}: {
    userId: string;
    instituteId: string;
    packageSessionIds: string[];
    /** The batch the leaderboard opens on. */
    defaultBatch?: string;
}) => {
    const brand = useBrandColor();
    const [rank, setRank] = useState('—');
    const summary = useQuery(getLearnerPointsSummaryQuery(userId, instituteId));
    const history = useQuery(getLearnerPointsHistoryQuery(userId, instituteId));
    const awards = useQuery({
        queryKey: ['STUDENT_AWARDED_BADGES', userId, instituteId],
        queryFn: () => getStudentAwardedBadges(userId),
        enabled: !!userId,
        staleTime: 60_000,
    });
    const config = useQuery({
        queryKey: ['BADGES_REWARDS_CONFIG'],
        queryFn: getBadgesRewardsConfig,
        staleTime: 5 * 60_000,
    });

    if (summary.isLoading) return <ProfileSkeleton blocks={3} />;
    if (summary.isError || !summary.data) {
        return (
            <ProfileError
                title="Couldn't load points and badges"
                hint="Only staff of this institute can view them."
                onRetry={() => summary.refetch()}
            />
        );
    }
    const today = history.data?.today ?? summary.data.today ?? format(new Date(), 'yyyy-MM-dd');
    return (
        <div className="flex flex-col gap-3">
            <LevelCard
                summary={summary.data}
                badges={awards.data?.length ?? 0}
                enabled={config.data?.enabled ?? true}
                rankLabel={rank}
            />
            <BadgesCard
                awards={awards.data ?? []}
                loading={awards.isLoading}
                summary={summary.data}
            />
            <LeaderboardCard
                key={defaultBatch}
                userId={userId}
                packageSessionIds={packageSessionIds}
                defaultBatch={defaultBatch}
                onRank={setRank}
            />
            <StreakCard
                summary={summary.data}
                activeDays={history.data?.activeDays ?? []}
                today={today}
                brand={brand}
            />
            <PointsCard summary={summary.data} weeks={history.data?.weeks ?? []} brand={brand} />
            <HistoryCard recent={history.data?.recent ?? []} />
        </div>
    );
};
