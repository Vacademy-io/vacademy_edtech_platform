import { useEffect, useState } from 'react';
import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import { DotOutline } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { QuestionInsightsComponent } from './QuestionInsights';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ArrowCounterClockwise, Export } from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import { Route } from '..';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import {
    getQuestionsInsightsData,
    handleGetQuestionInsightsData,
} from '../-services/assessment-details-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { QuestionInsightResponse } from '../-utils/assessment-details-interface';
import { useTheme } from '@/providers/theme/theme-provider';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const buildChartConfig = (t: TFunction) =>
    ({
        correct: { label: t('legend.correct'), color: 'hsl(var(--success-300))' },
        partiallyCorrect: { label: t('legend.partiallyCorrect'), color: 'hsl(var(--warning-300))' },
        wrongResponses: { label: t('legend.wrongResponses'), color: 'hsl(var(--danger-400))' },
        skip: { label: t('legend.skip'), color: 'hsl(var(--muted))' },
    }) satisfies ChartConfig;

export function AssessmentDetailsQuestionAnalysisChart({
    selectedSectionData,
}: {
    selectedSectionData: QuestionInsightResponse;
}) {
    const { t } = useTranslation('assessmentQuestionAnalysisChart');
    const chartConfig = buildChartConfig(t);

    const [visibleKeys, setVisibleKeys] = useState<string[]>([
        'correct',
        'partiallyCorrect',
        'wrongResponses',
        'skip',
    ]);

    const { getPrimaryColorCode } = useTheme();

    const toggleKey = (key: string) => {
        setVisibleKeys((prev) => {
            // If the key is the last item, prevent toggling
            if (prev.length === 1 && prev.includes(key)) {
                return prev; // No change if it's the last value
            }

            return prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
        });
    };

    // Format data for the chart based on the selected section's questions
    const chartData = selectedSectionData?.question_insight_dto?.map((question, index) => {
        let correctAttempt = 0,
            partialCorrectAttempt = 0,
            incorrectAttempt = 0;
        if (question.question_status) {
            correctAttempt = question.question_status.correctAttempt;
            partialCorrectAttempt = question.question_status.partialCorrectAttempt;
            incorrectAttempt = question.question_status.incorrectAttempt;
        }
        const skipped = question.skipped;

        return {
            questionId: index + 1,
            correct: correctAttempt,
            partiallyCorrect: partialCorrectAttempt,
            wrongResponses: incorrectAttempt,
            skip: skipped,
            total: correctAttempt + partialCorrectAttempt + incorrectAttempt + skipped,
        };
    });

    return (
        <div>
            <div className="flex flex-row items-center justify-end">
                {Object.keys(chartConfig).map((key) => (
                    <div
                        key={key}
                        className="flex cursor-pointer items-center space-x-2"
                        onClick={() => toggleKey(key)}
                    >
                        <DotOutline
                            size={70}
                            weight="fill"
                            style={{
                                color: visibleKeys.includes(key)
                                    ? chartConfig[key as keyof typeof chartConfig].color
                                    : 'hsl(var(--border))',
                                marginRight: '-1.5rem',
                            }}
                        />
                        <p
                            className={`text-body ${
                                visibleKeys.includes(key) ? '' : 'line-through'
                            }`}
                        >
                            {chartConfig[key as keyof typeof chartConfig].label}
                        </p>
                    </div>
                ))}
                <Dialog>
                    <DialogTrigger>
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="secondary"
                            className="ml-6 font-medium"
                        >
                            {t('checkInsightsButton')}
                        </MyButton>
                    </DialogTrigger>
                    <DialogContent className="no-scrollbar [&>button]:z-100 !m-0 flex h-[90vh] !w-full !max-w-[90vw] flex-col !gap-0 overflow-hidden !p-0">{/* design-lint-ignore: vh/vw dialog sizing matches MyDialog primitive */}
                        <h1 className="z-1 sticky top-0 bg-primary-50 p-4 font-semibold text-primary-500">
                            {t('dialogTitle')}
                        </h1>
                        <div className="no-scrollbar flex-1 overflow-y-auto">
                            <QuestionInsightsComponent />
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Chart */}
            <ChartContainer config={chartConfig}>
                <BarChart data={chartData} margin={{ left: 12, right: 12, bottom: 50 }}>
                    <XAxis
                        dataKey="questionId"
                        tickLine={false}
                        tickMargin={10}
                        axisLine={true}
                        label={{
                            value: t('xAxisLabel'),
                            position: 'left',
                            dx: 60,
                            dy: 30,
                            style: { fontSize: '14px', fill: getPrimaryColorCode() },
                        }}
                    />
                    <YAxis
                        dataKey="total"
                        tickLine={false}
                        axisLine={true}
                        tickMargin={8}
                        label={{
                            value: t('yAxisLabel'),
                            angle: -90,
                            position: 'left',
                            dx: 10,
                            dy: 10,
                            style: { fontSize: '14px', fill: getPrimaryColorCode() },
                        }}
                    />
                    {visibleKeys.includes('correct') && (
                        <Bar dataKey="correct" stackId="a" fill={chartConfig.correct.color} />
                    )}
                    {visibleKeys.includes('partiallyCorrect') && (
                        <Bar
                            dataKey="partiallyCorrect"
                            stackId="a"
                            fill={chartConfig.partiallyCorrect.color}
                        />
                    )}
                    {visibleKeys.includes('wrongResponses') && (
                        <Bar
                            dataKey="wrongResponses"
                            stackId="a"
                            fill={chartConfig.wrongResponses.color}
                        />
                    )}
                    {visibleKeys.includes('skip') && (
                        <Bar dataKey="skip" stackId="a" fill={chartConfig.skip.color} />
                    )}
                    <ChartTooltip
                        content={<ChartTooltipContent />}
                        cursor={false}
                        defaultIndex={1}
                    />
                </BarChart>
            </ChartContainer>
        </div>
    );
}

export function QuestionAnalysisChart() {
    const { t } = useTranslation('assessmentQuestionAnalysisChart');
    const instituteId = getInstituteId();
    const { assessmentId, examType } = Route.useParams();
    const { data: assessmentDetails } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteId,
            type: examType,
        })
    );
    const sectionsInfo = assessmentDetails[1]?.saved_data.sections?.map((section) => ({
        name: section.name,
        id: section.id,
    }));

    const [selectedSection, setSelectedSection] = useState(sectionsInfo ? sectionsInfo[0]?.id : '');

    const { data } = useSuspenseQuery(
        handleGetQuestionInsightsData({ instituteId, assessmentId, sectionId: selectedSection })
    );

    const [selectedSectionData, setSelectedSectionData] = useState(data);

    const getQuestionInsightsData = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            sectionId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            sectionId: string | undefined;
        }) => getQuestionsInsightsData(assessmentId, instituteId, sectionId),
        onSuccess: (data) => {
            setSelectedSectionData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleRefreshLeaderboard = () => {
        getQuestionInsightsData.mutate({
            assessmentId: assessmentId ? assessmentId : '',
            instituteId,
            sectionId: selectedSection,
        });
    };

    useEffect(() => {
        setSelectedSectionData(data);
    }, [selectedSection]);

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between">
                <h1>{t('header.title')}</h1>
                <div className="flex items-center gap-6">
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue placeholder={t('header.selectSectionPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {sectionsInfo?.map((section) => (
                                <SelectItem key={section.id} value={section.id}>
                                    {section.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="secondary"
                        className="font-medium"
                    >
                        <Export size={32} />
                        {t('header.exportButton')}
                    </MyButton>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="secondary"
                        className="min-w-8 font-medium"
                        onClick={handleRefreshLeaderboard}
                    >
                        <ArrowCounterClockwise size={32} />
                    </MyButton>
                </div>
            </div>
            {getQuestionInsightsData.status === 'pending' ? (
                <DashboardLoader />
            ) : (
                <AssessmentDetailsQuestionAnalysisChart selectedSectionData={selectedSectionData} />
            )}
        </div>
    );
}
