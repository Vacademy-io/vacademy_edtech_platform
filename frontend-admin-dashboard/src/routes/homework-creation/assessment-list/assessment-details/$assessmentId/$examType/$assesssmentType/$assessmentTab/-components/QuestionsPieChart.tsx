import { Pie, PieChart } from 'recharts';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import { DotOutline, Warning } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { useSuspenseQuery } from '@tanstack/react-query';
import { handleGetOverviewData } from '../-services/assessment-details-services';
import { Route } from '..';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { convertToLocalDateTime, getInstituteId } from '@/constants/helper';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import {
    resolveSubjectName,
    unresolvedSubjectIds,
    useSubjectNamesByIds,
} from '@/services/subject-names';
import { AssessmentOverviewDataInterface } from '@/types/assessment-overview';
import AssessmentStudentLeaderboard from './AssessmentStudentLeaderboard';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const buildChartConfig = (t: TFunction) =>
    ({
        ongoing: {
            label: t('legend.ongoing'),
            color: 'hsl(var(--chart-2))',
        },
        pending: {
            label: t('legend.pending'),
            color: 'hsl(var(--chart-3))',
        },
        attempted: {
            label: t('legend.attempted'),
            color: 'hsl(var(--chart-4))',
        },
    }) satisfies ChartConfig;

export function AssessmentDetailsPieChart({
    assessmentOverviewData,
}: {
    assessmentOverviewData: AssessmentOverviewDataInterface;
}) {
    const { t } = useTranslation('homeworkCreationQuestionsPieChart');
    const chartConfig = buildChartConfig(t);
    const chartData = [
        {
            browser: 'ongoing',
            visitors: assessmentOverviewData.total_ongoing,
            fill: 'hsl(var(--chart-2))',
        },
        {
            browser: 'pending',
            visitors:
                assessmentOverviewData.total_participants -
                (assessmentOverviewData.total_ongoing + assessmentOverviewData.total_attempted),
            fill: 'hsl(var(--chart-3))',
        },
        {
            browser: 'attempted',
            visitors: assessmentOverviewData.total_attempted,
            fill: 'hsl(var(--chart-4))',
        },
    ];
    return (
        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-64">
            <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={chartData} dataKey="visitors" nameKey="browser" />
            </PieChart>
        </ChartContainer>
    );
}

export function QuestionsPieChart() {
    const { t } = useTranslation('homeworkCreationQuestionsPieChart');
    const instituteId = getInstituteId();
    const { assessmentId } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data, isLoading } = useSuspenseQuery(
        handleGetOverviewData({ assessmentId, instituteId })
    );

    // Before the early return. The institute list keeps one subject per distinct name and
    // drops subjects whose course was deleted, so most stored ids need the direct lookup.
    const overviewSubjectId = data.assessment_overview_dto?.subject_id;
    const subjectNamesById = useSubjectNamesByIds(
        unresolvedSubjectIds(instituteDetails?.subjects, [overviewSubjectId])
    );
    if (isLoading) return <DashboardLoader />;
    // Null overview = the selected institute has no mapping to this homework
    // (the selection lives in localStorage shared across tabs). Same guard as
    // the assessment twin: explain, don't crash the app.
    if (!data.assessment_overview_dto) {
        return (
            <Card className="mt-8 border-warning-200 bg-warning-50 shadow-sm">
                <CardContent className="flex items-start gap-3 p-5">
                    <Warning className="mt-0.5 size-5 shrink-0 text-warning-600" />
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold text-neutral-700">
                            {t('unavailable.title')}
                        </p>
                        <p className="text-sm text-neutral-600">{t('unavailable.body')}</p>
                    </div>
                </CardContent>
            </Card>
        );
    }
    return (
        <div className="mt-8 flex w-full gap-16">
            {/* Assessment Overview Pie Chart Graph */}
            <div className="flex w-1/2 flex-col gap-8">
                <div className="flex justify-between text-body">
                    <div className="flex flex-col gap-6">
                        <p>
                            <span className="font-normal text-black">
                                {t('labels.createdOn')}{' '}
                            </span>
                            <span>
                                {convertToLocalDateTime(data.assessment_overview_dto.created_on)}
                            </span>
                        </p>
                        <p>
                            <span className="font-normal text-black">
                                {t('labels.startDateAndTime')}{' '}
                            </span>
                            <span>
                                {convertToLocalDateTime(
                                    data.assessment_overview_dto.start_date_and_time
                                )}
                            </span>
                        </p>
                        <p>
                            <span className="font-normal text-black">
                                {t('labels.endDateAndTime')}{' '}
                            </span>
                            <span>
                                {convertToLocalDateTime(
                                    data.assessment_overview_dto.end_date_and_time
                                )}
                            </span>
                        </p>
                    </div>
                    <div className="flex flex-col gap-6">
                        <p>
                            <span className="font-normal text-black">
                                {getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}:{' '}
                            </span>
                            <span>
                                {resolveSubjectName(
                                    instituteDetails?.subjects,
                                    subjectNamesById,
                                    overviewSubjectId
                                )}
                            </span>
                        </p>
                        <p>
                            <span className="font-normal text-black">
                                {t('labels.duration')}{' '}
                            </span>
                            <span>
                                {t('stats.minutesValue', {
                                    value: data.assessment_overview_dto.duration_in_min,
                                })}
                            </span>
                        </p>
                        <p>
                            <span className="font-normal text-black">
                                {t('labels.totalParticipants')}{' '}
                            </span>
                            <span>{data.assessment_overview_dto.total_participants}</span>
                        </p>
                    </div>
                </div>
                <div className="flex justify-evenly">
                    <div className="flex flex-col text-center">
                        <p className="text-neutral-500">{t('stats.avgDuration')}</p>
                        <p className="text-center text-3xl font-semibold text-primary-500">
                            {t('stats.minutesValue', {
                                value: (
                                    Math.floor(data.assessment_overview_dto.average_duration) / 60
                                ).toFixed(2),
                            })}
                        </p>
                    </div>
                    <div className="flex flex-col">
                        <p className="text-neutral-500">{t('stats.avgMarks')}</p>
                        <p className="text-center text-3xl font-semibold text-primary-500">
                            {data.assessment_overview_dto.average_marks.toFixed(2)}
                        </p>
                    </div>
                </div>
                <div className="flex items-center">
                    <AssessmentDetailsPieChart
                        assessmentOverviewData={data.assessment_overview_dto}
                    />
                    <div className="flex flex-col">
                        <div className="flex items-center">
                            <DotOutline size={40} weight="fill" className="text-success-400" />
                            <p className="text-body">
                                {t('legend.ongoingWithCount', {
                                    value: data.assessment_overview_dto.total_ongoing,
                                })}
                            </p>
                        </div>
                        <div className="flex items-center">
                            <DotOutline size={40} weight="fill" className="text-primary-200" />
                            <p className="text-body">
                                {t('legend.pendingWithCount', {
                                    value:
                                        data.assessment_overview_dto.total_participants -
                                        (data.assessment_overview_dto.total_ongoing +
                                            data.assessment_overview_dto.total_attempted),
                                })}
                            </p>
                        </div>
                        <div className="flex items-center">
                            <DotOutline size={40} weight="fill" className="text-success-100" />
                            <p className="text-body">
                                {t('legend.attemptedWithCount', {
                                    value: data.assessment_overview_dto.total_attempted,
                                })}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            {/* Assessment Student Leaderboard */}
            <AssessmentStudentLeaderboard />
        </div>
    );
}
