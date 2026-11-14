import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Exam, Fire, Medal, Star, VideoCamera, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ReportBlock, StatTile } from '@/components/common/report-visuals/blocks';
import { REPORT_COLORS, pct, scoreColor } from '@/components/common/report-visuals/palette';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import { getLearnerLiveSessionsQuery } from '@/services/learner-live-sessions';
import { getStudentAwardedBadges } from '@/services/student-badges';
import { getLearnerPointsSummaryQuery } from '@/services/student-gamification';
import type { StudentReportSnapshot } from '@/services/student-report-snapshot';

interface JourneyRow {
    id: string;
    date: string;
    title: string;
    detail: string;
    icon: PhosphorIcon;
    value?: string;
    valueColor?: string;
    color: string;
}

const RAIL_ROWS = 12;

const dateLabel = (iso: string) => {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Assessments, classes attended and badges earned in the dates, latest first. */
export const LearnerJourneyBlock = ({
    userId,
    brand,
    range,
    snapshot,
}: {
    userId: string;
    brand: string;
    range: { start: string; end: string };
    snapshot: StudentReportSnapshot;
}) => {
    const live = useQuery(getLearnerLiveSessionsQuery(userId, range.start, range.end));
    const badges = useQuery({
        queryKey: ['STUDENT_AWARDED_BADGES_REPORT', userId],
        queryFn: () => getStudentAwardedBadges(userId),
        enabled: !!userId,
        staleTime: 60_000,
    });
    const rows = useMemo(() => {
        const out: JourneyRow[] = [];
        for (const a of snapshot.academics?.assessments ?? []) {
            if (!a.date) continue;
            out.push({
                id: `a-${a.assessment_id}`,
                date: a.date,
                title: a.name ?? 'Assessment',
                detail: [a.subject, a.rank != null ? `Rank ${a.rank}` : null].filter(Boolean).join(' · ') || 'Assessment',
                icon: Exam,
                color: brand,
                value: a.percentage != null ? pct(a.percentage) : undefined,
                valueColor: scoreColor(a.percentage),
            });
        }
        for (const c of live.data?.classes ?? []) {
            if (c.attendance_status !== 'PRESENT') continue;
            out.push({
                id: `c-${c.schedule_id}`,
                date: c.meeting_date,
                title: c.title ?? 'Live class',
                detail: c.duration_minutes != null ? `Attended, ${c.duration_minutes} min` : 'Attended',
                icon: VideoCamera,
                color: REPORT_COLORS.classMark,
            });
        }
        for (const b of badges.data ?? []) {
            const day = b.awardedAt?.slice(0, 10);
            if (!day || day < range.start || day > range.end) continue;
            out.push({
                id: `b-${b.id}`,
                date: b.awardedAt as string,
                title: b.badgeName ?? 'Badge',
                detail: 'Badge earned',
                icon: Medal,
                color: REPORT_COLORS.warn,
            });
        }
        return out.sort((x, y) => y.date.localeCompare(x.date));
    }, [snapshot, live.data, badges.data, range, brand]);

    return (
        <ReportBlock
            brand={brand}
            tag="Journey"
            title={rows.length > 0 ? `${rows.length} milestone${rows.length === 1 ? '' : 's'} in these dates` : 'No milestones in these dates'}
        >
            {rows.length === 0 ? (
                <p className="text-xs text-neutral-500">
                    Assessments, classes and badges appear here as they happen.
                </p>
            ) : (
                <ol className="relative flex flex-col gap-2.5 pl-6">
                    <span aria-hidden className="absolute bottom-2 left-2 top-2 w-px bg-neutral-200" />
                    {rows.slice(0, RAIL_ROWS).map((r) => {
                        const Icon = r.icon;
                        return (
                            <li key={r.id} className="relative flex items-center gap-2">
                                <span
                                    className="absolute -left-6 flex size-4 items-center justify-center rounded-full text-white"
                                    style={{ background: r.color }}
                                >
                                    <Icon className="size-2.5" weight="fill" />
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm text-neutral-800" title={r.title}>
                                        {r.title}
                                    </span>
                                    <span className="truncate text-xs text-neutral-500">
                                        {dateLabel(r.date)} · {r.detail}
                                    </span>
                                </div>
                                {r.value && (
                                    <span className="shrink-0 text-sm font-bold" style={{ color: r.valueColor }}>
                                        {r.value}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
        </ReportBlock>
    );
};

/** Level, points, streak and badges at a glance. */
export const LearnerPointsBlock = ({
    userId,
    instituteId,
    brand,
}: {
    userId: string;
    instituteId: string;
    brand: string;
}) => {
    const summary = useQuery(getLearnerPointsSummaryQuery(userId, instituteId));
    const badges = useQuery({
        queryKey: ['STUDENT_AWARDED_BADGES_REPORT', userId],
        queryFn: () => getStudentAwardedBadges(userId),
        enabled: !!userId,
        staleTime: 60_000,
    });
    if (!summary.data) return null;
    const held = badges.data ?? [];
    return (
        <ReportBlock
            brand={brand}
            tag="Points and badges"
            title={`Level ${summary.data.level}, ${summary.data.totalPoints.toLocaleString()} points`}
        >
            <div className="grid grid-cols-3 gap-2">
                <StatTile value={summary.data.weekPoints} label="This week" color={brand} icon={<Star className="size-3.5" />} />
                <StatTile
                    value={summary.data.currentStreak ?? '—'}
                    label="Day streak"
                    icon={<Fire className="size-3.5" />}
                />
                <StatTile value={held.length} label="Badges" icon={<Medal className="size-3.5" />} />
            </div>
            {held.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {held.slice(0, 8).map((b) => (
                        <span key={b.id} title={b.badgeName ?? ''} className="flex size-11 items-center justify-center">
                            <BadgeVisual icon={b.badgeIcon ?? 'Trophy'} size={40} className="text-warning-500" />
                        </span>
                    ))}
                </div>
            )}
        </ReportBlock>
    );
};
