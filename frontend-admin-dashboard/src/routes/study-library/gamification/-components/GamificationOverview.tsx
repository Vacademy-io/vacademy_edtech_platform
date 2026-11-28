import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { LockKey, Medal, Trophy, UsersThree } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MultiSelect } from '@/components/design-system/multi-select';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { ReportBlock, StatTile } from '@/components/common/report-visuals/blocks';
import { HorizontalBars, PeriodChart } from '@/components/common/report-visuals/charts';
import { minutesLabel, useBrandColor } from '@/components/common/report-visuals/palette';
import {
    DEFAULT_TIMELINE,
    ReportTimelineFilter,
    resolveTimeline,
    type TimelineValue,
} from '@/components/common/report-timeline-filter';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { StudentGamification } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-gamification/student-gamification';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import { getBadgesRewardsConfig } from '@/routes/settings/-services/badges-settings';
import { useBatchOptions } from '@/routes/study-library/reports/-components/batchMultiSelect';
import {
    BadgeIcons,
    RankCell,
} from '@/routes/study-library/reports/-components/leaderboard/LeaderboardReports';
import {
    getGamificationOverviewQuery,
    type GamificationOverview as Overview,
} from '@/services/gamification-overview';
import {
    getCourseLeaderboardAdmin,
    getInstituteLeaderboardAdmin,
    type LeaderboardEntry,
    type LeaderboardMetric,
    type LeaderboardWindow,
} from '@/services/leaderboard';

const WHOLE_INSTITUTE = '__institute__';

const niceDate = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : format(d, 'd MMM yyyy');
};

const periodLabel = (start: string, granularity: Overview['granularity']) =>
    format(parseISO(start), granularity === 'MONTH' ? 'MMM yy' : 'd MMM');

const periodTitle = (start: string, end: string) =>
    start === end
        ? format(parseISO(start), 'd MMM yyyy')
        : `${format(parseISO(start), 'd MMM')} to ${format(parseISO(end), 'd MMM yyyy')}`;

const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-100 p-3">
        <span className="text-xs font-semibold text-neutral-600">{title}</span>
        {children}
    </div>
);

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
            'rounded-full px-3 py-1 text-xs font-medium',
            active ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
        )}
    >
        {children}
    </button>
);

const LearnerRow = ({
    label,
    value,
    onOpen,
    children,
}: {
    label: string;
    value: string;
    onOpen?: () => void;
    children?: ReactNode;
}) => (
    <li>
        <button
            type="button"
            disabled={!onOpen}
            onClick={onOpen}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left enabled:hover:bg-neutral-50"
        >
            {children}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-700">{label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-800">{value}</span>
        </button>
    </li>
);

const TrendsBlock = ({ data, brand }: { data: Overview; brand: string }) => {
    const series = (pick: (p: Overview['periods'][number]) => number) =>
        data.periods.map((p) => ({
            key: p.start,
            label: periodLabel(p.start, data.granularity),
            title: periodTitle(p.start, p.end),
            value: pick(p),
        }));
    const maxSource = Math.max(1, ...data.sources.map((s) => s.points));
    const maxEarner = Math.max(1, ...data.topEarners.map((e) => e.points));
    return (
        <ReportBlock
            brand={brand}
            tag="Points"
            title={
                data.totalPoints > 0
                    ? `${data.totalPoints.toLocaleString()} points earned by ${data.learnersEarning.toLocaleString()} learner${data.learnersEarning === 1 ? '' : 's'}`
                    : 'No points earned in these dates'
            }
        >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Panel title="Points earned">
                    <PeriodChart data={series((p) => p.points)} brand={brand} valueLabel="Points" />
                </Panel>
                <Panel title="Badges earned">
                    <PeriodChart data={series((p) => p.badges)} brand={brand} valueLabel="Badges" />
                </Panel>
                {data.topEarners.length > 0 && (
                    <Panel title="Top earners">
                        <HorizontalBars
                            color={brand}
                            max={maxEarner}
                            rows={data.topEarners.map((e) => ({
                                key: e.userId,
                                label: e.fullName,
                                value: e.points,
                                display: e.points.toLocaleString(),
                            }))}
                        />
                    </Panel>
                )}
                {data.sources.length > 0 && (
                    <Panel title="Where points come from">
                        <HorizontalBars
                            color={brand}
                            max={maxSource}
                            rows={data.sources.map((s) => ({
                                key: s.key,
                                label: s.label,
                                value: s.points,
                                display: s.points.toLocaleString(),
                            }))}
                        />
                    </Panel>
                )}
            </div>
        </ReportBlock>
    );
};

const BadgesBlock = ({
    data,
    brand,
    onOpenLearner,
}: {
    data: Overview;
    brand: string;
    onOpenLearner: (learner: { userId: string; name: string }) => void;
}) => {
    const { data: config } = useQuery({
        queryKey: ['BADGES_REWARDS_CONFIG'],
        queryFn: getBadgesRewardsConfig,
        staleTime: 5 * 60_000,
    });
    const earned = new Set(data.badges.map((b) => b.name));
    const descriptions = new Map((config?.badges ?? []).map((b) => [b.name, b.description]));
    const notEarned = (config?.badges ?? []).filter(
        (b) => b.enabled !== false && !b.hidden && !earned.has(b.name)
    );
    return (
        <ReportBlock
            brand={brand}
            tag="Badges"
            title={
                data.badgesAwarded > 0
                    ? `${data.badgesAwarded.toLocaleString()} badge${data.badgesAwarded === 1 ? '' : 's'} earned by ${data.learnersWithBadge.toLocaleString()} learner${data.learnersWithBadge === 1 ? '' : 's'}`
                    : 'No badges earned in these dates'
            }
        >
            {data.badges.length > 0 && (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {data.badges.map((b) => (
                        <li
                            key={`${b.name}-${b.icon}`}
                            className="flex items-center gap-3 rounded-lg border border-neutral-100 p-3"
                        >
                            <BadgeVisual icon={b.icon ?? 'Trophy'} size={56} className="shrink-0 text-warning-500" />
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate text-sm font-semibold text-neutral-800" title={b.name}>
                                    {b.name}
                                </span>
                                {descriptions.get(b.name) && (
                                    <span className="line-clamp-2 text-xs text-neutral-500">
                                        {descriptions.get(b.name)}
                                    </span>
                                )}
                                <span className="text-xs font-medium text-neutral-600">
                                    {b.learners.toLocaleString()} learner{b.learners === 1 ? '' : 's'}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {notEarned.length > 0 && (
                <div className="flex flex-col gap-2">
                    <span className="flex items-center gap-1 text-xs font-semibold text-neutral-600">
                        <LockKey className="size-3.5" weight="duotone" />
                        Not earned in these dates
                    </span>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {notEarned.map((b) => (
                            <li key={b.id} className="flex items-center gap-2 rounded-lg bg-neutral-50 p-2">
                                <span className="shrink-0 opacity-40 grayscale">
                                    <BadgeVisual icon={b.icon} size={32} className="text-neutral-500" />
                                </span>
                                <div className="flex min-w-0 flex-col">
                                    <span className="truncate text-xs font-semibold text-neutral-700">{b.name}</span>
                                    <span className="truncate text-2xs text-neutral-500" title={b.description}>
                                        {b.description}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {data.recentBadges.length > 0 && (
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-neutral-600">Latest badges</span>
                    <ul className="grid grid-cols-1 gap-x-4 lg:grid-cols-2">
                        {data.recentBadges.map((r) => (
                            <LearnerRow
                                key={`${r.userId}-${r.badgeName}-${r.awardedAt}`}
                                label={r.fullName}
                                value={niceDate(r.awardedAt)}
                                onOpen={() => onOpenLearner({ userId: r.userId, name: r.fullName })}
                            >
                                <BadgeVisual
                                    icon={r.badgeIcon ?? 'Trophy'}
                                    size={28}
                                    className="shrink-0 text-warning-500"
                                />
                                <span className="w-32 shrink-0 truncate text-xs text-neutral-500" title={r.badgeName}>
                                    {r.badgeName}
                                </span>
                            </LearnerRow>
                        ))}
                    </ul>
                </div>
            )}
        </ReportBlock>
    );
};

const LeaderboardBlock = ({
    brand,
    batchOptions,
    batchTerm,
    picked,
    onOpenLearner,
}: {
    brand: string;
    batchOptions: { value: string; label: string }[];
    batchTerm: string;
    picked: string[];
    onOpenLearner: (learner: { userId: string; name: string }) => void;
}) => {
    const [scope, setScope] = useState(WHOLE_INSTITUTE);
    const [metric, setMetric] = useState<LeaderboardMetric>('POINTS');
    const [period, setPeriod] = useState<LeaderboardWindow>('ALL');
    const [firstPicked] = picked;
    const onlyPicked = picked.length === 1 ? firstPicked : undefined;

    // The leaderboard ranks one batch or the institute, so it follows a single picked batch.
    useEffect(() => {
        if (onlyPicked) setScope(onlyPicked);
    }, [onlyPicked]);

    const effectiveWindow = metric === 'POINTS' ? period : 'ALL';
    const { data, isLoading, isError } = useQuery({
        queryKey: ['GAMIFICATION_LEADERBOARD', scope, metric, effectiveWindow],
        queryFn: () =>
            scope === WHOLE_INSTITUTE
                ? getInstituteLeaderboardAdmin({ metric, window: effectiveWindow })
                : getCourseLeaderboardAdmin(scope, { metric, window: effectiveWindow }),
        staleTime: 60_000,
    });
    const entries = data?.entries ?? [];
    const score = (e: LeaderboardEntry) =>
        metric === 'POINTS' ? e.points.toLocaleString() : minutesLabel(e.points);
    return (
        <ReportBlock
            brand={brand}
            tag="Leaderboard"
            title={
                data && data.totalLearners > 0
                    ? `${data.totalLearners.toLocaleString()} learner${data.totalLearners === 1 ? '' : 's'} ranked`
                    : 'Leaderboard'
            }
        >
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-col gap-1 text-xs font-medium text-neutral-600 md:w-96">
                    {batchTerm}
                    <SearchableSelect
                        options={[{ label: 'Whole institute', value: WHOLE_INSTITUTE }, ...batchOptions]}
                        value={scope}
                        onChange={setScope}
                        placeholder="Whole institute"
                        searchPlaceholder={`Search ${batchTerm.toLowerCase()}`}
                        triggerClassName="h-9 text-sm"
                    />
                </div>
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
            </div>
            {isLoading ? (
                <DashboardLoader />
            ) : isError ? (
                <p className="py-6 text-center text-sm text-danger-600">Couldn&apos;t load the leaderboard.</p>
            ) : entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-500">Nobody on this leaderboard yet.</p>
            ) : (
                <ul className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto">
                    {entries.map((e) => (
                        <LearnerRow
                            key={`${e.userId ?? e.name}-${e.rank}`}
                            label={e.name}
                            value={score(e)}
                            onOpen={e.userId ? () => onOpenLearner({ userId: e.userId as string, name: e.name }) : undefined}
                        >
                            <span className="flex w-6 shrink-0 justify-center">
                                <RankCell rank={e.rank} />
                            </span>
                            <span className="order-last shrink-0">
                                <BadgeIcons entry={e} />
                            </span>
                        </LearnerRow>
                    ))}
                </ul>
            )}
        </ReportBlock>
    );
};

/** LMS → Gamification and Points: points, badges and the leaderboard across the institute. */
export const GamificationOverview = () => {
    const brand = useBrandColor();
    const instituteId = getCurrentInstituteId() ?? '';
    const batchOptions = useBatchOptions();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const [picked, setPicked] = useState<string[]>([]);
    const [timeline, setTimeline] = useState<TimelineValue>(DEFAULT_TIMELINE);
    const [learner, setLearner] = useState<{ userId: string; name: string } | null>(null);
    const range = resolveTimeline(timeline);
    const sortedPicked = useMemo(() => [...picked].sort(), [picked]);

    const { data: config, isLoading: configLoading } = useQuery({
        queryKey: ['BADGES_REWARDS_CONFIG'],
        queryFn: getBadgesRewardsConfig,
        staleTime: 5 * 60_000,
    });
    const { data, isLoading, isError, refetch } = useQuery({
        ...getGamificationOverviewQuery({
            instituteId,
            packageSessionIds: sortedPicked,
            startDate: range?.start ?? '',
            endDate: range?.end ?? '',
        }),
        enabled: !!instituteId && !!range,
    });

    if (configLoading) return <DashboardLoader />;
    if (config && !config.enabled) {
        return (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Trophy className="size-10 text-neutral-300" weight="duotone" />
                <p className="text-sm font-medium text-neutral-600">
                    Badges and leaderboard are switched off for this institute.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 md:flex-row md:items-end">
                <div className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                    {batchTerm}
                    <MultiSelect
                        options={batchOptions}
                        selected={picked}
                        onChange={setPicked}
                        checkboxes
                        placeholder={`All ${batchesTerm.toLowerCase()}`}
                        className="h-auto min-h-9 py-1 text-sm"
                    />
                </div>
                <div className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                    Timeline
                    <ReportTimelineFilter value={timeline} onChange={setTimeline} />
                </div>
            </div>

            {!range ? null : isLoading ? (
                <DashboardLoader />
            ) : isError || !data ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <p className="text-sm text-danger-600">Couldn&apos;t load points and badges.</p>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="text-xs font-medium text-primary-600 hover:underline"
                    >
                        Try again
                    </button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatTile value={data.totalPoints.toLocaleString()} label="Points earned" color={brand} />
                        <StatTile
                            value={data.learnersEarning.toLocaleString()}
                            label="Learners earning"
                            icon={<UsersThree className="size-3.5" />}
                        />
                        <StatTile
                            value={data.badgesAwarded.toLocaleString()}
                            label="Badges earned"
                            icon={<Medal className="size-3.5" />}
                        />
                        <StatTile
                            value={data.learnersWithBadge.toLocaleString()}
                            label="Learners with a badge"
                            icon={<Trophy className="size-3.5" />}
                        />
                    </div>
                    <TrendsBlock data={data} brand={brand} />
                    <BadgesBlock data={data} brand={brand} onOpenLearner={setLearner} />
                </>
            )}

            <LeaderboardBlock
                brand={brand}
                batchOptions={batchOptions}
                batchTerm={batchTerm}
                picked={picked}
                onOpenLearner={setLearner}
            />

            <Dialog open={!!learner} onOpenChange={(open) => !open && setLearner(null)}>
                <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{learner?.name}</DialogTitle>
                    </DialogHeader>
                    {learner && (
                        <StudentGamification
                            userId={learner.userId}
                            instituteId={instituteId}
                            packageSessionIds={[]}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};
