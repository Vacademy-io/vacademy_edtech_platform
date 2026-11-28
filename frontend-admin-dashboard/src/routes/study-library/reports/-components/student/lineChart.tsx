'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui/card';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import dayjs from 'dayjs';
import { useTheme } from '@/providers/theme/theme-provider';
import { useTranslation } from 'react-i18next';

export interface ChartDataType {
    activity_date: string;
    avg_daily_time_minutes: number;
    avg_daily_time_minutes_batch: number;
}
export function LineChartComponent({ chartData }: { chartData: ChartDataType[] }) {
    const { t } = useTranslation('studyLibraryLineChart');
    // Brand colour for the chart axis labels — driven by the existing
    // institute-level ThemeProvider so that white-label tenants automatically
    // get their own brand colour without touching this chart.
    const { getPrimaryColorCode } = useTheme();
    const brandColor = getPrimaryColorCode();

    const chartConfig = {
        avg_daily_time_minutes: {
            label: t('timeSpent'),
            color: 'hsl(var(--chart-1))',
        },
        avg_daily_time_minutes_batch: {
            label: t('timeSpentByBatch'),
            color: 'hsl(var(--chart-6))',
        },
    } satisfies ChartConfig;
    return (
        <Card className="w-full">
            <ChartContainer
                className="w-full py-6"
                config={chartConfig}
                // Fixed 530px chart canvas matches the surrounding container —
                // no Tailwind height token equivalent. Isolated inline style
                // with comment per the design-system rules.
                // design-lint-ignore: chart canvas height
                style={{ height: 530 }}
            >
                <LineChart
                    accessibilityLayer
                    data={chartData}
                    margin={{
                        left: 35,
                        right: 25,
                        bottom: 25, // Add more space at the bottom for the X-axis label
                    }}
                    className="!h-fit !max-h-screen"
                >
                    <CartesianGrid vertical={false} />
                    <XAxis
                        dataKey="activity_date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={(value) => dayjs(value).format('DD MMMM').slice(0, 6)}
                        label={{
                            value: t('date'),
                            position: 'left',
                            dx: 55,
                            dy: 30,
                            // Axis label fill follows the active tenant brand.
                            style: { fontSize: '14px', fill: brandColor },
                        }}
                    />
                    <YAxis
                        dataKey="avg_daily_time_minutes"
                        tickLine={false}
                        axisLine={true}
                        tickMargin={8}
                        width={40}
                        label={{
                            value: t('hours'),
                            position: 'insideLeft',
                            angle: -90, // Rotates the text to be vertical
                            dx: -10, // Adjusts the horizontal position
                            dy: 200, // Adjusts the vertical position
                            style: { fontSize: '14px', fill: brandColor },
                        }}
                    />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Line
                        dataKey="avg_daily_time_minutes"
                        type="monotone"
                        stroke="var(--color-avg_daily_time_minutes)"
                        strokeWidth={2}
                        dot={{
                            fill: 'var(--color-avg_daily_time_minutes)',
                        }}
                        activeDot={{
                            r: 6,
                        }}
                    />
                    <Line
                        dataKey="avg_daily_time_minutes_batch"
                        type="monotone"
                        stroke="var(--color-avg_daily_time_minutes_batch)"
                        strokeWidth={2}
                        dot={{
                            fill: 'var(--color-avg_daily_time_minutes_batch)',
                        }}
                        activeDot={{
                            r: 6,
                        }}
                    />
                </LineChart>
            </ChartContainer>
            {/* </CardContent> */}
        </Card>
    );
}
