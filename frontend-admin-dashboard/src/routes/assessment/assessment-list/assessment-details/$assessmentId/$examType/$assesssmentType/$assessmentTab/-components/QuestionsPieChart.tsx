import { Pie, PieChart } from 'recharts';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
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
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { Card, CardContent } from '@/components/ui/card';
import {
    CalendarPlus,
    PlayCircle,
    StopCircle,
    BookOpen,
    Timer,
    Users,
    Gauge,
    Trophy,
    Warning,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const buildChartConfig = (t: TFunction) =>
    ({
        ongoing: {
            label: t('chart.ongoing'),
            color: 'hsl(var(--chart-2))',
        },
        pending: {
            label: t('chart.pending'),
            color: 'hsl(var(--chart-3))',
        },
        attempted: {
            label: t('chart.attempted'),
            color: 'hsl(var(--chart-4))',
        },
    }) satisfies ChartConfig;

export function AssessmentDetailsPieChart({
    assessmentOverviewData,
}: {
    assessmentOverviewData: AssessmentOverviewDataInterface;
}) {
    const { t } = useTranslation('assessmentQuestionsPieChart');
    const chartConfig = buildChartConfig(t);
    const chartData = [
        {
            browser: 'ongoing',
            visitors: assessmentOverviewData.total_ongoing,
            fill: 'hsl(var(--success-300))',
        },
        {
            browser: 'pending',
            visitors:
                assessmentOverviewData.total_participants -
                (assessmentOverviewData.total_ongoing + assessmentOverviewData.total_attempted),
            fill: 'hsl(var(--warning-200))',
        },
        {
            browser: 'attempted',
            visitors: assessmentOverviewData.total_attempted,
            fill: 'hsl(var(--success-50))',
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
    const { t } = useTranslation('assessmentQuestionsPieChart');
    const instituteId = getInstituteId();
    const { assessmentId, examType } = Route.useParams();
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

    const overview = data.assessment_overview_dto;
    // The backend answers with a null overview when the institute it was asked
    // for has no mapping to this assessment. That happens in practice: the
    // selected institute lives in localStorage shared by every tab, so a
    // switch in another tab sends this page's queries out under the wrong
    // institute. Say so instead of crashing the whole app on
    // `null.total_participants`.
    if (!overview) {
        return (
            <Card className="mt-6 border-warning-200 bg-warning-50 shadow-sm">
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
    const subjectLabel = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
    const subjectName =
        resolveSubjectName(instituteDetails?.subjects, subjectNamesById, overviewSubjectId) ||
        t('info.subjectFallback');
    const pendingCount =
        overview.total_participants - (overview.total_ongoing + overview.total_attempted);
    const avgDurationMin = (Math.floor(overview.average_duration) / 60).toFixed(2);
    const durationHours = Math.floor(overview.duration_in_min / 60);
    const durationMinutesRemainder = overview.duration_in_min % 60;
    const durationLabel =
        overview.duration_in_min >= 60
            ? durationMinutesRemainder > 0
                ? t('durationLabel.hoursMinutes', {
                      hours: durationHours,
                      minutes: durationMinutesRemainder,
                  })
                : t('durationLabel.hoursOnly', { hours: durationHours })
            : t('durationLabel.minutesOnly', { minutes: overview.duration_in_min });

    const infoItems = [
        {
            icon: CalendarPlus,
            label: t('info.createdOn'),
            value: convertToLocalDateTime(overview.created_on),
            show: true,
        },
        {
            icon: PlayCircle,
            label: t('info.startDateTime'),
            value: convertToLocalDateTime(overview.start_date_and_time),
            show: examType === 'EXAM' || examType === 'SURVEY',
        },
        {
            icon: StopCircle,
            label: t('info.endDateTime'),
            value: convertToLocalDateTime(overview.end_date_and_time),
            show: examType === 'EXAM' || examType === 'SURVEY',
        },
        {
            icon: BookOpen,
            label: subjectLabel,
            value: subjectName,
            show: true,
        },
        {
            icon: Timer,
            label: t('info.duration'),
            value: durationLabel,
            show: examType === 'EXAM' || examType === 'MOCK',
        },
        {
            icon: Users,
            label: t('info.totalParticipants'),
            value: String(overview.total_participants),
            show: true,
        },
    ].filter((item) => item.show);

    return (
        <div className="mt-6 flex w-full flex-col gap-6 lg:flex-row lg:gap-8">
            <div className="flex w-full flex-col gap-6 lg:w-1/2">
                {/* Assessment metadata grid */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {infoItems.map((item) => {
                        const Icon = item.icon;
                        return (
                            <Card
                                key={item.label}
                                className="border-slate-200 shadow-sm transition-shadow hover:shadow-md"
                            >
                                <CardContent className="flex items-start gap-3 p-4">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                        <Icon className="h-4 w-4" />
                                    </div>
                                    <div className="flex min-w-0 flex-col">
                                        <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">
                                            {item.label}
                                        </p>
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {item.value}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                {/* Key stat tiles */}
                <div className="grid grid-cols-2 gap-3">
                    <Card className="border-0 bg-gradient-to-br from-primary-50 to-white shadow-sm">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 text-slate-500">
                                <Gauge className="h-4 w-4" />
                                <p className="text-xs font-medium uppercase tracking-wider">
                                    {t('stats.avgDuration')}
                                </p>
                            </div>
                            <p className="mt-2 text-3xl font-bold tabular-nums text-primary-600">
                                {avgDurationMin}
                                <span className="ml-1 text-base font-medium text-slate-500">
                                    {t('stats.avgDurationUnit')}
                                </span>
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="border-0 bg-gradient-to-br from-amber-50 to-white shadow-sm">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 text-slate-500">
                                <Trophy className="h-4 w-4" />
                                <p className="text-xs font-medium uppercase tracking-wider">
                                    {t('stats.avgMarks')}
                                </p>
                            </div>
                            <p className="mt-2 text-3xl font-bold tabular-nums text-amber-600">
                                {overview.average_marks.toFixed(2)}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Participation breakdown */}
                <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-6">
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                                {t('breakdown.title')}
                            </h3>
                            <span className="text-xs text-slate-500">
                                {t('breakdown.total', { count: overview.total_participants })}
                            </span>
                        </div>
                        <div className="flex items-center gap-6">
                            <AssessmentDetailsPieChart assessmentOverviewData={overview} />
                            <div className="flex flex-col gap-3">
                                <LegendItem
                                    color="bg-success-300"
                                    label={t('chart.ongoing')}
                                    count={overview.total_ongoing}
                                />
                                <LegendItem
                                    color="bg-warning-200"
                                    label={t('chart.pending')}
                                    count={pendingCount}
                                />
                                <LegendItem
                                    color="bg-success-50"
                                    label={t('chart.attempted')}
                                    count={overview.total_attempted}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            {/* Assessment Student Leaderboard */}
            <AssessmentStudentLeaderboard />
        </div>
    );
}

function LegendItem({ color, label, count }: { color: string; label: string; count: number }) {
    return (
        <div className="flex items-center gap-2.5">
            <span className={`h-3 w-3 rounded-sm ${color}`} />
            <span className="text-sm text-slate-700">{label}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700">
                {count}
            </span>
        </div>
    );
}
