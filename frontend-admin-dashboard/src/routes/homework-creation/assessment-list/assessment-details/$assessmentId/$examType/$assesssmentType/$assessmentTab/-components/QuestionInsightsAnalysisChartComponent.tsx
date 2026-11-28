import { Pie, PieChart } from 'recharts';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import { QuestionInsightsQuestionStatus } from '../-utils/assessment-details-interface';

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

export function QuestionInsightsAnalysisChartComponent({
    questionStatus,
    skipped,
}: {
    questionStatus: QuestionInsightsQuestionStatus;
    skipped: number;
}) {
    const { t } = useTranslation('homeworkCreationQuestionInsightsAnalysisChartComponent');
    const chartConfig = buildChartConfig(t);
    const chartData = [
        {
            responseType: 'correct',
            value: questionStatus?.correctAttempt,
            fill: 'hsl(var(--chart-1))',
        },
        {
            responseType: 'partiallyCorrect',
            value: questionStatus?.partialCorrectAttempt,
            fill: 'hsl(var(--chart-2))',
        },
        {
            responseType: 'wrongResponse',
            value: questionStatus?.incorrectAttempt,
            fill: 'hsl(var(--chart-3))',
        },
        {
            responseType: 'skipped',
            value: skipped,
            fill: 'hsl(var(--chart-4))',
        },
    ];
    return (
        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-44">
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
