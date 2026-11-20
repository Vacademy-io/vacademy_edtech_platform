import { format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ChartLineUp, Clock, Star, VideoCamera } from '@phosphor-icons/react';
import { ReportBlock, StatTile } from '@/components/common/report-visuals/blocks';
import { PeriodChart } from '@/components/common/report-visuals/charts';
import { minutesLabel, pct, scoreColor } from '@/components/common/report-visuals/palette';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { LiveClassDashboardData } from '@/routes/study-library/live-session/-services/live-class-dashboard';

const RECENT_CLASSES = 5;

const asPct = (rate: number | null | undefined) => (rate == null ? null : rate * 100);

/** Attendance per day, week or month, depending on how long the dates run. */
const attendanceSeries = (daily: LiveClassDashboardData['daily']) => {
    const finished = daily.filter((d) => d.completed > 0);
    const unit = daily.length <= 14 ? 'DAY' : daily.length <= 120 ? 'WEEK' : 'MONTH';
    const buckets = new Map<string, { expected: number; present: number }>();
    for (const d of finished) {
        const day = parseISO(d.date);
        const start =
            unit === 'DAY' ? day : unit === 'WEEK' ? startOfWeek(day, { weekStartsOn: 1 }) : startOfMonth(day);
        const key = format(start, 'yyyy-MM-dd');
        const b = buckets.get(key) ?? { expected: 0, present: 0 };
        b.expected += d.expected;
        b.present += d.present_in_audience;
        buckets.set(key, b);
    }
    return [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, b]) => ({
            key,
            label: format(parseISO(key), unit === 'MONTH' ? 'MMM yy' : 'd MMM'),
            title: unit === 'WEEK' ? `Week of ${format(parseISO(key), 'd MMM yyyy')}` : undefined,
            value: b.expected > 0 ? Math.round((b.present / b.expected) * 1000) / 10 : null,
        }));
};

/** Overview widget: live sessions held for the picked batches and dates, and how they went. */
export const BatchLiveSessionsBlock = ({
    data,
    brand,
}: {
    data: LiveClassDashboardData;
    brand: string;
}) => {
    const s = data.summary;
    const classesTerm = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const series = attendanceSeries(data.daily);
    const recent = data.classes
        .filter((c) => c.status === 'COMPLETED')
        .slice(0, RECENT_CLASSES);
    return (
        <ReportBlock
            brand={brand}
            tag={classesTerm}
            title={
                s.completed_classes > 0
                    ? `${s.completed_classes} held, ${pct(asPct(s.attendance_rate))} attendance`
                    : `No ${classesTerm.toLowerCase()} held in these dates`
            }
        >
            {s.completed_classes > 0 && (
                <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <StatTile
                            value={s.completed_classes}
                            label="Held"
                            icon={<VideoCamera className="size-3.5" />}
                        />
                        <StatTile
                            value={pct(asPct(s.attendance_rate))}
                            label="Attendance"
                            color={brand}
                            icon={<ChartLineUp className="size-3.5" />}
                        />
                        <StatTile
                            value={minutesLabel(s.avg_attended_minutes)}
                            label="Average time in class"
                            icon={<Clock className="size-3.5" />}
                        />
                        <StatTile
                            value={s.avg_rating != null ? s.avg_rating.toFixed(1) : pct(asPct(s.engagement_rate))}
                            label={s.avg_rating != null ? 'Average rating' : 'Engaged'}
                            icon={<Star className="size-3.5" />}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-semibold text-neutral-600">Attendance</span>
                            <PeriodChart
                                kind="line"
                                data={series}
                                brand={brand}
                                valueLabel="Attendance"
                                suffix="%"
                                max={100}
                                height={150}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-semibold text-neutral-600">Latest</span>
                            <ul className="flex flex-col divide-y divide-neutral-100">
                                {recent.map((c) => (
                                    <li key={c.schedule_id} className="flex items-center gap-2 py-1.5">
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-sm text-neutral-800" title={c.title ?? ''}>
                                                {c.title ?? classesTerm}
                                            </span>
                                            <span className="truncate text-xs text-neutral-500">
                                                {format(parseISO(c.meeting_date), 'd MMM yyyy')}
                                                {` · ${c.present}/${c.expected} present`}
                                            </span>
                                        </div>
                                        <span
                                            className="shrink-0 text-sm font-bold"
                                            style={{ color: scoreColor(asPct(c.attendance_rate)) }}
                                        >
                                            {pct(asPct(c.attendance_rate))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </>
            )}
        </ReportBlock>
    );
};
