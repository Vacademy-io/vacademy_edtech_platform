import { useState } from 'react';
import { format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ChartLineUp, Clock, Star, UsersThree, VideoCamera } from '@phosphor-icons/react';
import { ReportBlock, StatTile } from '@/components/common/report-visuals/blocks';
import { PeriodChart } from '@/components/common/report-visuals/charts';
import { minutesLabel, pct, scoreColor } from '@/components/common/report-visuals/palette';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { LiveClassDashboardData } from '@/routes/study-library/live-session/-services/live-class-dashboard';

const RECENT_CLASSES = 5;

const asPct = (rate: number | null | undefined) => (rate == null ? null : rate * 100);

/**
 * Attendance per day, week or month, depending on how long the dates run. Every class in a
 * period counts: present over expected, summed across them.
 */
const attendanceSeries = (daily: LiveClassDashboardData['daily'], classesTerm: string) => {
    const finished = daily.filter((d) => d.completed > 0);
    const unit = daily.length <= 14 ? 'DAY' : daily.length <= 120 ? 'WEEK' : 'MONTH';
    const buckets = new Map<string, { expected: number; present: number; classes: number }>();
    for (const d of finished) {
        const day = parseISO(d.date);
        const start =
            unit === 'DAY' ? day : unit === 'WEEK' ? startOfWeek(day, { weekStartsOn: 1 }) : startOfMonth(day);
        const key = format(start, 'yyyy-MM-dd');
        const b = buckets.get(key) ?? { expected: 0, present: 0, classes: 0 };
        b.expected += d.expected;
        b.classes += d.completed;
        b.present += d.present_in_audience;
        buckets.set(key, b);
    }
    return [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, b]) => {
            const when =
                unit === 'DAY'
                    ? format(parseISO(key), 'd MMM yyyy')
                    : unit === 'WEEK'
                      ? `Week of ${format(parseISO(key), 'd MMM yyyy')}`
                      : format(parseISO(key), 'MMMM yyyy');
            const value = b.expected > 0 ? Math.round((b.present / b.expected) * 1000) / 10 : null;
            return {
                key,
                label: format(parseISO(key), unit === 'MONTH' ? 'MMM yy' : 'd MMM'),
                title: `${when} · ${b.classes} ${classesTerm.toLowerCase()}`,
                value,
                display: value == null ? '—' : `${value}% (${b.present}/${b.expected} present)`,
            };
        });
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
    const [showAll, setShowAll] = useState(false);
    const series = attendanceSeries(data.daily, classesTerm);
    const finished = data.classes.filter((c) => c.status === 'COMPLETED');
    const recent = showAll ? finished : finished.slice(0, RECENT_CLASSES);
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
                        {s.avg_attended_minutes != null ? (
                            <StatTile
                                value={minutesLabel(s.avg_attended_minutes)}
                                label="Average time in class"
                                icon={<Clock className="size-3.5" />}
                            />
                        ) : (
                            <StatTile
                                value={s.avg_joined_per_class != null ? Math.round(s.avg_joined_per_class) : '—'}
                                label="Joined per class"
                                icon={<UsersThree className="size-3.5" />}
                            />
                        )}
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
                            <ul
                                className={`flex flex-col divide-y divide-neutral-100 ${showAll ? 'max-h-96 overflow-y-auto pr-1' : ''}`}
                            >
                                {recent.map((c) => {
                                    // Present among the learners expected, matching the rate; joins from outside the batch are left out.
                                    const present =
                                        c.attendance_rate != null
                                            ? Math.round(c.attendance_rate * c.expected)
                                            : c.present;
                                    return (
                                    <li key={c.schedule_id} className="flex items-center gap-2 py-1.5">
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-sm text-neutral-800" title={c.title ?? ''}>
                                                {c.title ?? classesTerm}
                                            </span>
                                            <span className="truncate text-xs text-neutral-500">
                                                {format(parseISO(c.meeting_date), 'd MMM yyyy')}
                                                {` · ${present}/${c.expected} present`}
                                            </span>
                                        </div>
                                        <span
                                            className="shrink-0 text-sm font-bold"
                                            style={{ color: scoreColor(asPct(c.attendance_rate)) }}
                                        >
                                            {pct(asPct(c.attendance_rate))}
                                        </span>
                                    </li>
                                    );
                                })}
                            </ul>
                            {finished.length > RECENT_CLASSES && (
                                <button
                                    type="button"
                                    onClick={() => setShowAll((v) => !v)}
                                    className="self-start text-xs font-medium text-primary-600 hover:underline"
                                >
                                    {showAll ? 'Show fewer' : `Show all ${finished.length}`}
                                </button>
                            )}

                        </div>
                    </div>
                </>
            )}
        </ReportBlock>
    );
};
