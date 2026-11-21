import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    type TooltipProps,
} from 'recharts';
import type { PanelUsageDay } from '@/classroom-shared/apiTypes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatNumber } from '@/lib/formatters';
import { dayLabel } from './RangeControls';
import { formatHours } from './UsageKpis';
import { datesInRange, parseDay, type UsageRange } from './usageApi';

// Theme tokens (CSS variables), so the chart follows the institute theme and dark mode.
const BAR_FILL = 'hsl(var(--primary-500))';
const GRID_STROKE = 'hsl(var(--border))';
const TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 12 };

interface ChartRow {
    date: string;
    label: string;
    panel_hours: number;
    sessions: number;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
    const { t } = useTranslation('settingsClassroomPanels');
    const row = payload?.[0]?.payload as ChartRow | undefined;
    if (!active || !row) return null;
    return (
        <div className="rounded-md border border-neutral-200 bg-card px-3 py-2 text-caption shadow-md">
            <p className="font-medium text-neutral-700">{dayLabel(row.date)}</p>
            <p className="text-neutral-600">
                {t('usage.chart.hours', { value: formatHours(row.panel_hours) })}
            </p>
            <p className="text-neutral-600">
                {t('usage.chart.sessions', { value: formatNumber(row.sessions) })}
            </p>
        </div>
    );
}

/** Panel hours per local day. Days the server left out are drawn as zero. */
export function UsageChart({ days, range }: { days: PanelUsageDay[]; range: UsageRange }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const rows = useMemo<ChartRow[]>(() => {
        const byDate = new Map(days.map((row) => [row.date, row]));
        return datesInRange(range).map((date) => {
            const found = byDate.get(date);
            const parsed = parseDay(date);
            return {
                date,
                label: parsed ? formatDate(parsed, { year: undefined }) : date,
                panel_hours: found?.panel_hours ?? 0,
                sessions: found?.sessions ?? 0,
            };
        });
    }, [days, range]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <h3 className="text-h3 font-medium">{t('usage.chart.title')}</h3>
                </CardTitle>
                <CardDescription>{t('usage.chart.description')}</CardDescription>
            </CardHeader>
            <CardContent>
                <div
                    role="img"
                    aria-label={t('usage.chart.aria', {
                        from: dayLabel(range.from),
                        to: dayLabel(range.to),
                    })}
                    className="h-64 w-full"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                            <XAxis
                                dataKey="label"
                                tick={TICK}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={12}
                            />
                            <YAxis
                                tick={TICK}
                                tickLine={false}
                                axisLine={false}
                                width={40}
                                allowDecimals={false}
                            />
                            <Tooltip
                                cursor={{ fill: 'hsl(var(--muted))' }}
                                content={<ChartTooltip />}
                            />
                            <Bar
                                dataKey="panel_hours"
                                fill={BAR_FILL}
                                radius={[4, 4, 0, 0]}
                                maxBarSize={32}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
