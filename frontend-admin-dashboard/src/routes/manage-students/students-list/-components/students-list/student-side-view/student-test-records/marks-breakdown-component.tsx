import React, { Suspense } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
const PieChart = React.lazy(() => import('recharts').then(module => ({ default: module.PieChart })));
const Pie = React.lazy(() => import('recharts').then(module => ({ default: module.Pie as unknown as React.ComponentType<any> })));
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';

interface MarksResponseDataInterface {
    correct: number;
    partiallyCorrect: number;
    wrongResponse: number;
    skipped: number;
}

function buildChartConfig(t: TFunction) {
    return {
        correct: {
            label: t('legend.correct'),
            color: 'hsl(var(--chart-1))',
        },
        partiallyCorrect: {
            label: t('legend.partiallyCorrect'),
            color: 'hsl(var(--chart-2))',
        },
        wrongResponse: {
            label: t('legend.wrongResponse'),
            color: 'hsl(var(--chart-3))',
        },
        skipped: {
            label: t('legend.skipped'),
            color: 'hsl(var(--chart-4))',
        },
    } satisfies ChartConfig;
}

// Recharts fill values use CSS variables so hex is not needed in JSX class strings.
const MARKS_CHART_FILLS = {
    correct: 'var(--color-correct)',       // --chart-1 (green tint)
    partiallyCorrect: 'var(--color-partiallyCorrect)', // --chart-2 (amber tint)
    wrongResponse: 'var(--color-wrongResponse)',        // --chart-3 (red tint)
    skipped: 'var(--color-skipped)',       // --chart-4 (neutral)
} as const;

export function MarksBreakdownComponent({ marksData }: { marksData: MarksResponseDataInterface }) {
    const { t } = useTranslation('manageStudentsMarksBreakdownComponent');
    const chartConfig = buildChartConfig(t);
    const chartData = [
        {
            responseType: 'correct',
            value: marksData.correct,
            fill: MARKS_CHART_FILLS.correct,
        },
        {
            responseType: 'partiallyCorrect',
            value: marksData.partiallyCorrect,
            fill: MARKS_CHART_FILLS.partiallyCorrect,
        },
        {
            responseType: 'wrongResponse',
            value: marksData.wrongResponse,
            fill: MARKS_CHART_FILLS.wrongResponse,
        },
        {
            responseType: 'skipped',
            value: marksData.skipped,
            fill: MARKS_CHART_FILLS.skipped,
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
