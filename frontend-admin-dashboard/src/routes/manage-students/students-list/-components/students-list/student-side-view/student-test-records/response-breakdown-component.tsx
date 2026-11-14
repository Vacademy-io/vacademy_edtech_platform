import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import type { TFunction } from 'i18next';
import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
const PieChart = React.lazy(() => import('recharts').then(module => ({ default: module.PieChart as unknown as React.ComponentType<any> })));
const Pie = React.lazy(() => import('recharts').then(module => ({ default: module.Pie as unknown as React.ComponentType<any> })));

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
            <Suspense fallback={<div className="h-full w-full animate-pulse rounded-full bg-neutral-100 opacity-20" />}>
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
            </Suspense>
        </ChartContainer>
    );
}
