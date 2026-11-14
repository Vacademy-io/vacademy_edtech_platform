import { useMemo, useState, type ReactNode } from 'react';
import { Exam, Medal, VideoCamera } from '@phosphor-icons/react';
import { ReportBlock, StatTile } from '@/components/common/report-visuals/blocks';
import { HorizontalBars, PeriodChart } from '@/components/common/report-visuals/charts';
import {
    REPORT_COLORS,
    minutesLabel,
    pct,
    scoreColor,
} from '@/components/common/report-visuals/palette';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import type {
    BatchGamification,
    BatchTimeline,
    BatchTimelinePeriod,
} from '@/services/batch-summary-report';

const RAIL_ROWS = 8;

const short = (iso: string, withYear = false) => {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        ...(withYear ? { year: 'numeric' } : {}),
    });
};

const periodLabel = (p: BatchTimelinePeriod, granularity: string) => {
    if (granularity === 'MONTH') {
        const d = new Date(`${p.start}T00:00:00`);
        return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    }
    return short(p.start);
};

const periodTitle = (p: BatchTimelinePeriod) =>
    p.start === p.end ? short(p.start, true) : `${short(p.start)} to ${short(p.end, true)}`;

const Panel = ({ title, value, children }: { title: string; value: string; children: ReactNode }) => (
    <div className="flex flex-col gap-1 rounded-lg border border-neutral-100 p-3">
        <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-neutral-600">{title}</span>
            <span className="text-sm font-bold text-neutral-800">{value}</span>
        </div>
        {children}
    </div>
);

/** How the report scope moved over the dates: one small chart per measure, then a dated rail. */
export const BatchTimelineBlock = ({ timeline, brand }: { timeline: BatchTimeline; brand: string }) => {
    const [showAll, setShowAll] = useState(false);
    const { periods, granularity, events } = timeline;
    const series = useMemo(() => {
        const row = (p: BatchTimelinePeriod, value: number | null, display?: string) => ({
            key: p.start,
            label: periodLabel(p, granularity),
            title: periodTitle(p),
            value,
            display,
        });
        return {
            active: periods.map((p) => row(p, p.active_learners)),
            hours: periods.map((p) => {
                const minutes = p.total_minutes ?? 0;
                return row(p, Math.round((minutes / 60) * 10) / 10, minutesLabel(minutes));
            }),
            slides: periods.map((p) => row(p, p.slides_opened)),
            score: periods.map((p) => row(p, p.attempts > 0 ? p.avg_score : null)),
            attendance: periods.map((p) => row(p, p.classes_held > 0 ? p.attendance_pct : null)),
            points: periods.map((p) => row(p, p.points)),
        };
    }, [periods, granularity]);

    const totalMinutes = periods.reduce((s, p) => s + (p.total_minutes ?? 0), 0);
    const peakActive = Math.max(0, ...periods.map((p) => p.active_learners));
    const scored = periods.filter((p) => p.attempts > 0 && p.avg_score != null);
    const firstScore = scored[0]?.avg_score ?? null;
    const lastScore = scored[scored.length - 1]?.avg_score ?? null;
    const scoreMove =
        scored.length >= 2 && firstScore != null && lastScore != null
            ? Math.round((lastScore - firstScore) * 10) / 10
            : null;
    const attended = periods.filter((p) => p.classes_held > 0 && p.attendance_pct != null);
    const lastAttendance = attended[attended.length - 1]?.attendance_pct ?? null;
    const totalPoints = periods.reduce((s, p) => s + p.points, 0);
    const unit = granularity === 'DAY' ? 'day' : granularity === 'WEEK' ? 'week' : 'month';
    const rail = [...events].reverse();
    const railShown = showAll ? rail : rail.slice(0, RAIL_ROWS);

    return (
        <ReportBlock
            brand={brand}
            tag="Timeline progress"
            title={
                totalMinutes > 0
                    ? `${minutesLabel(totalMinutes)} of learning across ${periods.length} ${unit}${periods.length === 1 ? '' : 's'}`
                    : 'No learning time recorded in these dates'
            }
            lede={`Each ${unit} in the selected dates.`}
        >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Panel title="Learners active" value={`${peakActive} at peak`}>
                    <PeriodChart data={series.active} brand={brand} valueLabel="Learners active" />
                </Panel>
                <Panel title="Time learning" value={minutesLabel(totalMinutes)}>
                    <PeriodChart data={series.hours} brand={brand} valueLabel="Hours" />
                </Panel>
                <Panel
                    title="Different slides opened"
                    value={`${Math.max(0, ...periods.map((p) => p.slides_opened))} at peak`}
                >
                    <PeriodChart data={series.slides} brand={brand} valueLabel="Slides" />
                </Panel>
                <Panel
                    title="Average score"
                    value={
                        scoreMove != null
                            ? `${scoreMove > 0 ? '+' : ''}${scoreMove} points`
                            : pct(lastScore)
                    }
                >
                    <PeriodChart
                        kind="line"
                        data={series.score}
                        brand={brand}
                        valueLabel="Average score"
                        suffix="%"
                        max={100}
                    />
                </Panel>
                <Panel title="Class attendance" value={pct(lastAttendance)}>
                    <PeriodChart
                        kind="line"
                        data={series.attendance}
                        brand={brand}
                        valueLabel="Attendance"
                        suffix="%"
                        max={100}
                    />
                </Panel>
                <Panel title="Points earned" value={totalPoints.toLocaleString()}>
                    <PeriodChart data={series.points} brand={brand} valueLabel="Points" />
                </Panel>
            </div>

            {rail.length > 0 && (
                <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-neutral-600">Milestones, latest first</span>
                    <ol className="relative flex flex-col gap-2.5 pl-6">
                        <span aria-hidden className="absolute bottom-2 left-2 top-2 w-px bg-neutral-200" />
                        {railShown.map((e) => {
                            const Icon = e.type === 'ASSESSMENT' ? Exam : VideoCamera;
                            return (
                                <li key={`${e.type}-${e.date}-${e.title}`} className="relative flex items-center gap-2">
                                    <span
                                        className="absolute -left-6 flex size-4 items-center justify-center rounded-full text-white"
                                        style={{
                                            background:
                                                e.type === 'ASSESSMENT' ? brand : REPORT_COLORS.classMark,
                                        }}
                                    >
                                        <Icon className="size-2.5" weight="fill" />
                                    </span>
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm text-neutral-800" title={e.title}>
                                            {e.title}
                                        </span>
                                        <span className="truncate text-xs text-neutral-500">
                                            {short(e.date, true)}
                                            {e.detail ? ` · ${e.detail}` : ''}
                                        </span>
                                    </div>
                                    {e.value != null && (
                                        <span
                                            className="shrink-0 text-sm font-bold"
                                            style={{ color: scoreColor(e.value) }}
                                        >
                                            {pct(e.value)}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                    {rail.length > RAIL_ROWS && (
                        <button
                            type="button"
                            onClick={() => setShowAll((v) => !v)}
                            className="self-start text-xs font-medium text-primary-600 hover:underline"
                        >
                            {showAll ? 'Show fewer' : `Show all ${rail.length}`}
                        </button>
                    )}
                </div>
            )}
        </ReportBlock>
    );
};

/** Points and badges earned in the dates: totals, top earners and the badges handed out most. */
export const BatchPointsBlock = ({
    gamification,
    brand,
}: {
    gamification: BatchGamification;
    brand: string;
}) => {
    const earners = gamification.top_earners ?? [];
    const badges = gamification.top_badges ?? [];
    const max = Math.max(1, ...earners.map((e) => e.points));
    return (
        <ReportBlock
            brand={brand}
            tag="Points and badges"
            title={
                gamification.total_points > 0 || gamification.badges_awarded > 0
                    ? `${gamification.total_points.toLocaleString()} points and ${gamification.badges_awarded} badge${gamification.badges_awarded === 1 ? '' : 's'} earned`
                    : 'No points or badges earned in these dates'
            }
            lede="Earned in the selected dates."
        >
            <div className="grid grid-cols-3 gap-3">
                <StatTile value={gamification.total_points.toLocaleString()} label="Points earned" color={brand} />
                <StatTile value={gamification.learners_earning} label="Learners earning" />
                <StatTile
                    value={gamification.badges_awarded}
                    label="Badges earned"
                    icon={<Medal className="size-3.5" />}
                />
            </div>
            {(earners.length > 0 || badges.length > 0) && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {earners.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-semibold text-neutral-600">Top earners</span>
                            <HorizontalBars
                                color={brand}
                                max={max}
                                rows={earners.map((e) => ({
                                    key: e.user_id,
                                    label: e.full_name,
                                    value: e.points,
                                    display: e.points.toLocaleString(),
                                }))}
                            />
                        </div>
                    )}
                    {badges.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-semibold text-neutral-600">Badges earned most</span>
                            <ul className="grid grid-cols-2 gap-2">
                                {badges.map((b) => (
                                    <li
                                        key={`${b.name}-${b.icon}`}
                                        className="flex items-center gap-2 rounded-lg bg-neutral-50 p-2"
                                    >
                                        <BadgeVisual
                                            icon={b.icon ?? 'Trophy'}
                                            size={32}
                                            className="shrink-0 text-warning-500"
                                        />
                                        <div className="flex min-w-0 flex-col">
                                            <span className="truncate text-xs font-semibold text-neutral-800" title={b.name}>
                                                {b.name}
                                            </span>
                                            <span className="text-2xs text-neutral-500">
                                                {b.learners} learner{b.learners === 1 ? '' : 's'}
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </ReportBlock>
    );
};
