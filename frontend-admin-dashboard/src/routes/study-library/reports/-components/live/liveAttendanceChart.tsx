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
import { useTranslation } from 'react-i18next';
import { AttendancePoint } from './-utils/liveCompute';

export function LiveAttendanceChart({ data }: { data: AttendancePoint[] }) {
    const { t } = useTranslation('studyLibraryLiveAttendanceChart');

    const chartConfig = {
        attendancePct: {
            label: t('attendancePercent'),
            color: 'hsl(var(--chart-1))',
        },
    } satisfies ChartConfig;

    const chartData = data.map((d) => ({
        date: d.date,
        attendancePct: Math.round(d.attendancePct),
    }));

    return (
        <Card className="w-full border-none shadow-none">
            <ChartContainer className="h-96 w-full py-6" config={chartConfig}>
                <LineChart
                    accessibilityLayer
                    data={chartData}
                    margin={{ left: 10, right: 20, bottom: 20 }}
                >
                    <CartesianGrid vertical={false} />
                    <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={(value) => dayjs(value).format('DD MMM')}
                    />
                    <YAxis
                        dataKey="attendancePct"
                        domain={[0, 100]}
                        tickLine={false}
                        axisLine={true}
                        tickMargin={8}
                        width={40}
                        tickFormatter={(value) => `${value}%`}
                    />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Line
                        dataKey="attendancePct"
                        type="monotone"
                        stroke="var(--color-attendancePct)"
                        strokeWidth={2}
                        dot={{ fill: 'var(--color-attendancePct)' }}
                        activeDot={{ r: 6 }}
                    />
                </LineChart>
            </ChartContainer>
        </Card>
    );
}
