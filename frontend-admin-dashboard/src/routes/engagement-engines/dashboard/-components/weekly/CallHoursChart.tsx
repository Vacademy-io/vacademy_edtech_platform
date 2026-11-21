import { useTranslation } from 'react-i18next';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    type TooltipProps,
} from 'recharts';
import type { DiagnosisCallHour } from '@/services/engagement-diagnosis';
import { hourLabel } from '../../-utils/diagnosis-problems';
import { needsDataText } from '../../-utils/diagnosis-verdict';
import { formatNumber, formatRate } from '../../-utils/report-format';

// Recharts takes SVG paint values, so tokens go in as hsl(var(--token)), as in ReportCharts.
const PRIMARY = 'hsl(var(--primary-500))';
const MUTED = 'hsl(var(--muted-foreground))';
const GRID = 'hsl(var(--border))';
const CURSOR = 'hsl(var(--primary-50))';
const AXIS_TICK = { fill: MUTED, fontSize: 12 };

interface CallHoursChartProps {
    rows: DiagnosisCallHour[];
    /** The calls an hour needs before it is compared (`minimums.callsPerHour`). */
    minimum: number | null;
}

/**
 * Share of calls answered, per hour of the day. An hour without enough calls is drawn pale, so
 * a rate from a handful of calls is never read as a result; the table beside it carries the
 * same figures and says what each hour needs.
 */
export function CallHoursChart({ rows, minimum }: CallHoursChartProps) {
    const { t } = useTranslation('engagementDailyReport');
    const data = rows.map((r) => ({
        label: String(r.hour).padStart(2, '0'),
        rate: r.connectRate === null ? 0 : r.connectRate * 100,
        enough: r.enough && (minimum === null || r.placed >= minimum),
        row: r,
    }));

    const renderTooltip = ({ active, payload }: TooltipProps<number, string>) => {
        const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
        if (!active || !point) return null;
        const { row } = point;
        return (
            <div className="min-w-36 rounded-lg border border-neutral-200 bg-popover px-3 py-2 shadow-lg">
                <p className="text-caption font-semibold text-neutral-800">{hourLabel(row.hour)}</p>
                <p className="text-caption text-neutral-600">
                    {t('diagnosis.weekly.hours.tooltip', {
                        connected: formatNumber(row.connected),
                        placed: formatNumber(row.placed),
                        rate: formatRate(row.connectRate),
                    })}
                </p>
                {!point.enough && (
                    <p className="text-caption text-neutral-500">
                        {needsDataText('calls', minimum, t)}
                    </p>
                )}
            </div>
        );
    };

    return (
        <div role="img" aria-label={t('diagnosis.weekly.hours.chartAria')} className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
                    <XAxis
                        dataKey="label"
                        tick={AXIS_TICK}
                        tickLine={false}
                        axisLine={false}
                        dy={6}
                    />
                    <YAxis
                        tick={AXIS_TICK}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        domain={[0, 100]}
                        tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip cursor={{ fill: CURSOR }} content={renderTooltip} />
                    <Bar dataKey="rate" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {data.map((d) => (
                            <Cell
                                key={d.label}
                                fill={d.enough ? PRIMARY : MUTED}
                                fillOpacity={d.enough ? 1 : 0.35}
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
