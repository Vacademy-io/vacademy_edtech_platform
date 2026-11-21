import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import { MyButton } from '@/components/design-system/button';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import AssessmentDetailsRankMarkTable from './QuestionsRankMarkTable';
import { getInstituteId } from '@/constants/helper';
import { Route } from '..';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import {
    getOverviewDetials,
    handleGetOverviewData,
    handleGetStudentRankMarkExportCSV,
    handleGetStudentRankMarkExportPDF,
} from '../-services/assessment-details-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { AssessmentOverviewMarksRankInterface } from '@/types/assessment-overview';
import { useState } from 'react';
import ExportDialogPDFCSV from '@/components/common/export-dialog-pdf-csv';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { useTheme } from '@/providers/theme/theme-provider';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

function buildChartConfig(t: TFunction) {
    return {
        mark: {
            label: t('chart.markSeriesLabel'),
            color: 'hsl(var(--chart-1))',
        },
    } satisfies ChartConfig;
}

export function AssessmentDetailsMarkRankGraph({
    marksRanksData,
}: {
    marksRanksData: AssessmentOverviewMarksRankInterface[];
}) {
    const { t } = useTranslation('homeworkCreationQuestionsMarkRankGraph');
    const { getPrimaryColorCode } = useTheme();
    const chartConfig = buildChartConfig(t);
    const chartData = marksRanksData?.map(({ rank, marks }) => ({
        rank,
        mark: marks,
    }));
    return (
        <ChartContainer config={chartConfig}>
            <LineChart
                accessibilityLayer
                data={chartData}
                margin={{
                    left: 12,
                    right: 12,
                    bottom: 50,
                    top: 12,
                }}
            >
                <CartesianGrid vertical={false} />
                <XAxis
                    dataKey="rank"
                    tickLine={false}
                    axisLine={true}
                    tickMargin={8}
                    label={{
                        value: t('chart.rankAxisLabel'),
                        position: 'left',
                        dx: 35,
                        dy: 30,
                        style: { fontSize: '14px', fill: getPrimaryColorCode() },
                    }}
                />
                <YAxis
                    dataKey="mark"
                    tickLine={false}
                    axisLine={true}
                    tickMargin={8}
                    label={{
                        value: t('chart.marksAxisLabel'),
                        angle: -90,
                        position: 'left',
                        dx: 10,
                        dy: 10,
                        style: { fontSize: '14px', fill: getPrimaryColorCode() },
                    }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Line
                    dataKey="mark"
                    type="natural"
                    stroke="var(--color-mark)"
                    strokeWidth={2}
                    activeDot={{
                        r: 6,
                    }}
                />
            </LineChart>
        </ChartContainer>
    );
}

export function QuestionsMarkRankGraph() {
    const { t } = useTranslation('homeworkCreationQuestionsMarkRankGraph');
    const instituteId = getInstituteId();
    const { assessmentId } = Route.useParams();
    const { data, isLoading } = useSuspenseQuery(
        handleGetOverviewData({ assessmentId, instituteId })
    );
    const [studentRankMarkData, setStudentRankMarkData] = useState(data);

    const getQuestionMarkRankData = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
        }) => getOverviewDetials(assessmentId, instituteId),
        onSuccess: (data) => {
            setStudentRankMarkData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleRefreshLeaderboard = () => {
        getQuestionMarkRankData.mutate({
            assessmentId,
            instituteId,
        });
    };

    const getExportRankMarkDataPDF = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
        }) => handleGetStudentRankMarkExportPDF(assessmentId, instituteId),
        onSuccess: async (response) => {
            const date = new Date();
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `pdf_student_rank_mark_report_${date.toLocaleString()}.pdf`
            );
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success(t('export.pdfSuccess'));
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const getExportRankMarkDataCSV = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
        }) => handleGetStudentRankMarkExportCSV(assessmentId, instituteId),
        onSuccess: (data) => {
            const date = new Date();
            const parsedData = Papa.parse(data, {
                download: false,
                header: true,
                skipEmptyLines: true,
            }).data;

            const csv = Papa.unparse(parsedData);

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `csv_student_rank_mark_report_${date.toLocaleString()}.csv`
            );
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up the created URL object
            URL.revokeObjectURL(url);
            toast.success(t('export.csvSuccess'));
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleExportPDF = () => {
        getExportRankMarkDataPDF.mutate({
            assessmentId,
            instituteId,
        });
    };
    const handleExportCSV = () => {
        getExportRankMarkDataCSV.mutate({
            assessmentId,
            instituteId,
        });
    };

    if (isLoading) return <DashboardLoader />;
    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between">
                <h1>{t('title')}</h1>
                <div className="flex items-center gap-6">
                    <ExportDialogPDFCSV
                        handleExportPDF={handleExportPDF}
                        handleExportCSV={handleExportCSV}
                        isPDFLoading={getExportRankMarkDataPDF.status === 'pending' ? true : false}
                        isCSVLoading={getExportRankMarkDataCSV.status === 'pending' ? true : false}
                    />
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
            {getQuestionMarkRankData.status === 'pending' ? (
                <DashboardLoader />
            ) : (
                <div className="mt-6 flex items-start gap-16">
                    <div className="w-1/2">
                        <AssessmentDetailsMarkRankGraph
                            marksRanksData={studentRankMarkData.marks_rank_dto}
                        />
                    </div>
                    <div className="w-1/2">
                        <AssessmentDetailsRankMarkTable
                            marksRanksData={studentRankMarkData.marks_rank_dto}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
