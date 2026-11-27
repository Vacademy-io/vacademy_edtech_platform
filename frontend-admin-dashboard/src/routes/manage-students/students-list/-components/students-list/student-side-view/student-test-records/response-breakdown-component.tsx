import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
// recharts is imported directly: React.lazy behind <Suspense> left the chart without a
// size (ChartContainer's ResponsiveContainer sizes its direct child), so it drew nothing.
// ChartContainer imports recharts statically, so the lazy import saved nothing.
import { Pie, PieChart } from 'recharts';

interface ResponseData {
    attempted: number;
    skipped: number;
}

const buildChartConfig = (t: TFunction) =>
    ({
        correct: {
            label: t('legend.correct'),
            color: 'hsl(var(--chart-1))',
        },
        skipped: {
            label: t('legend.skipped'),
            color: 'hsl(var(--chart-4))',
        },
    }) satisfies ChartConfig;

// Recharts fill values resolved from CSS chart variables — no raw hex in JSX.
const RESPONSE_CHART_FILLS = {
    attempted: 'var(--color-correct)',  // --chart-1 (green tint)
    skipped: 'var(--color-skipped)',    // --chart-4 (neutral)
} as const;

export function ResponseBreakdownComponent({ responseData }: { responseData: ResponseData }) {
    const { t } = useTranslation('manageStudentsResponseBreakdownComponent');
    const chartConfig = buildChartConfig(t);
    const chartData = [
        {
            responseType: 'correct',
            value: responseData.attempted,
            fill: RESPONSE_CHART_FILLS.attempted,
        },
        {
            responseType: 'skipped',
            value: responseData.skipped,
            fill: RESPONSE_CHART_FILLS.skipped,
        },
    ];
    return (
        <ChartContainer config={chartConfig} className="mx-auto aspect-square size-44">
            <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="responseType"
                    innerRadius={42}
                    strokeWidth={2}
                />
            </PieChart>
        </ChartContainer>
    );
}
