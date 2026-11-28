import { Pie, PieChart } from 'recharts';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import { QuestionInsightsQuestionStatus } from '../-utils/assessment-details-interface';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const buildChartConfig = (t: TFunction) =>
    ({
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
    }) satisfies ChartConfig;

export function QuestionInsightsAnalysisChartComponent({
    questionStatus,
    skipped,
}: {
    questionStatus: QuestionInsightsQuestionStatus;
    skipped: number;
}) {
    const { t } = useTranslation('assessmentQuestionInsightsAnalysisChart');
    const chartConfig = buildChartConfig(t);
    const chartData = [
        {
            responseType: 'correct',
            value: questionStatus?.correctAttempt,
            fill: 'hsl(var(--success-300))',
        },
        {
            responseType: 'partiallyCorrect',
            value: questionStatus?.partialCorrectAttempt,
            fill: 'hsl(var(--warning-300))',
        },
        {
            responseType: 'wrongResponse',
            value: questionStatus?.incorrectAttempt,
            fill: 'hsl(var(--danger-400))',
        },
        {
            responseType: 'skipped',
            value: skipped,
            fill: 'hsl(var(--muted))',
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
