import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowCounterClockwise, Clock } from '@phosphor-icons/react';
import { Crown, Person } from '@/svgs';
import { MyPagination } from '@/components/design-system/pagination';
import { AssessmentDetailsSearchComponent } from './SearchComponent';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import { Route } from '..';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import {
    getStudentLeaderboardDetails,
    handleGetAssessmentTotalMarksData,
    handleGetLeaderboardData,
    handleGetStudentLeaderboardExportCSV,
    handleGetStudentLeaderboardExportPDF,
} from '../-services/assessment-details-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { getBatchNameById } from '../-utils/helper';
import { StudentLeaderboard } from '@/types/assessment-overview';
import ExportDialogPDFCSV from '@/components/common/export-dialog-pdf-csv';
import { toast } from 'sonner';
import Papa from 'papaparse';

export interface AssessmentStudentLeaderboardInterface {
    name: string;
    status: string[];
    sort_columns: Record<string, string>;
}

const AssessmentStudentLeaderboard = () => {
    const { t } = useTranslation('homeworkCreationAssessmentStudentLeaderboard');
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { batches_for_sessions } = instituteDetails || {};
    const instituteId = getInstituteId();
    const { assessmentId } = Route.useParams();
    const { data: totalMarks } = useSuspenseQuery(
        handleGetAssessmentTotalMarksData({ assessmentId })
    );
    const [selectedFilter] = useState<AssessmentStudentLeaderboardInterface>({
        name: '',
        status: [],
        sort_columns: {},
    });
    const [searchText, setSearchText] = useState('');
    const [pageNo, setPageNo] = useState(0);
    const { data, isLoading } = useSuspenseQuery(
        handleGetLeaderboardData({
            assessmentId,
            instituteId,
            pageNo,
            pageSize: 10,
            selectedFilter,
        })
    );

    const [studentLeaderboardData, setStudentLeaderboardData] = useState(data);

    const getStudentLeaderboardData = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            pageNo,
            pageSize,
            selectedFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            pageNo: number;
            pageSize: number;
            selectedFilter: AssessmentStudentLeaderboardInterface;
        }) =>
            getStudentLeaderboardDetails(
                assessmentId,
                instituteId,
                pageNo,
                pageSize,
                selectedFilter
            ),
        onSuccess: (data) => {
            setStudentLeaderboardData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const clearSearch = () => {
        setSearchText('');
        selectedFilter['name'] = '';
        getStudentLeaderboardData.mutate({
            assessmentId,
            instituteId,
            pageNo,
            pageSize: 10,
            selectedFilter,
        });
    };

    const handleSearch = (searchValue: string) => {
        setSearchText(searchValue);
        getStudentLeaderboardData.mutate({
            assessmentId,
            instituteId,
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                name: searchValue,
            },
        });
    };

    const handleRefreshLeaderboard = () => {
        getStudentLeaderboardData.mutate({
            assessmentId,
            instituteId,
            pageNo,
            pageSize: 10,
            selectedFilter,
        });
    };

    const handlePageChange = (newPage: number) => {
        setPageNo(newPage);
        getStudentLeaderboardData.mutate({
            assessmentId,
            instituteId,
            pageNo: newPage,
            pageSize: 10,
            selectedFilter,
        });
    };

    const getExportLeaderboardDataPDF = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
        }) => handleGetStudentLeaderboardExportPDF(assessmentId, instituteId),
        onSuccess: async (response) => {
            const date = new Date();
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `pdf_student_leaderboard_report_${date.toLocaleString()}.pdf`
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

    const getExportLeaderboardDataCSV = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
        }) => handleGetStudentLeaderboardExportCSV(assessmentId, instituteId),
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
                `csv_student_leaderboard_report_${date.toLocaleString()}.csv`
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
        getExportLeaderboardDataPDF.mutate({
            assessmentId,
            instituteId,
        });
    };
    const handleExportCSV = () => {
        getExportLeaderboardDataCSV.mutate({
            assessmentId,
            instituteId,
        });
    };

    if (isLoading) return <DashboardLoader />;

    return (
        <div className="flex w-1/2 flex-col gap-4 rounded-xl border bg-neutral-50 p-4">
            <div className="flex items-center justify-between">
                <h1>{t('heading')}</h1>
                <div className="flex items-center gap-6">
                    <ExportDialogPDFCSV
                        handleExportPDF={handleExportPDF}
                        handleExportCSV={handleExportCSV}
                        isPDFLoading={
                            getExportLeaderboardDataPDF.status === 'pending' ? true : false
                        }
                        isCSVLoading={
                            getExportLeaderboardDataCSV.status === 'pending' ? true : false
                        }
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
            <AssessmentDetailsSearchComponent
                onSearch={handleSearch}
                searchText={searchText}
                setSearchText={setSearchText}
                clearSearch={clearSearch}
            />
            {getStudentLeaderboardData.status === 'pending' ? (
                <DashboardLoader />
            ) : (
                <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">{/* design-lint-ignore: viewport-relative scroll cap has no spacing token */}
                    {studentLeaderboardData.content?.map(
                        (student: StudentLeaderboard, idx: number) => {
                            return (
                                <div
                                    key={idx}
                                    className={`flex items-center justify-between rounded-xl border ${
                                        student.rank === 1 ? 'bg-primary-50' : 'bg-white'
                                    } p-4`}
                                >
                                    <div className="flex items-center gap-4">
                                        <span>{student.rank}</span>
                                        {student.rank === 1 ? (
                                            <div>
                                                <Crown />
                                                <Person />
                                            </div>
                                        ) : (
                                            <Person />
                                        )}
                                        <div className="flex flex-col">
                                            <span>{student.student_name}</span>
                                            <span className="text-caption">
                                                {getBatchNameById(
                                                    batches_for_sessions,
                                                    student.batch_id
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            <Clock size={18} className="text-neutral-600" />
                                            <span className="text-sm text-neutral-500">
                                                {t('table.duration', {
                                                    minutes: Math.floor(
                                                        student.completion_time_in_seconds / 60
                                                    ),
                                                    seconds:
                                                        student.completion_time_in_seconds % 60,
                                                })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col text-neutral-500">
                                                <span className="text-caption">
                                                    {t('table.percentileLabel')}
                                                </span>
                                                <span>{student.percentile.toFixed(2)}</span>
                                            </div>
                                            <div className="flex flex-col text-center text-neutral-500">
                                                <span className="text-caption">
                                                    {t('table.marksLabel')}
                                                </span>
                                                <span>
                                                    {student.achieved_marks
                                                        ? student.achieved_marks.toFixed(2)
                                                        : 0}
                                                    /{totalMarks.total_achievable_marks}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }
                    )}
                    <MyPagination
                        currentPage={pageNo}
                        totalPages={studentLeaderboardData.total_pages}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}
        </div>
    );
};

export default AssessmentStudentLeaderboard;
