/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    getAllColumnsForTable,
    getAllColumnsForTableWidth,
    getAssessmentSubmissionsFilteredDataStudentData,
} from '../-utils/helper';
import { Route } from '..';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getInstituteId } from '@/constants/helper';
import {
    getAdminParticipants,
    handleGetAssessmentTotalMarksData,
    handleGetSubmissionsExportCSV,
    handleGetSubmissionsExportPDF,
} from '../-services/assessment-details-services';
import { MyPagination } from '@/components/design-system/pagination';
import { MyButton } from '@/components/design-system/button';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { AssessmentDetailsSearchComponent } from './SearchComponent';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { ScheduleTestFilters } from '@/routes/assessment/assessment-list/-components/ScheduleTestFilters';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import AssessmentSubmissionsFilterButtons from './AssessmentSubmissionsFilterButtons';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ControlledStudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/controlled-student-sidebar-provider';
import { BulkActions } from './bulk-actions/bulk-actions';
import { AssessmentSubmissionsStudentTable } from './AssessmentSubmissionsStudentTable';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import AssessmentGlobalLevelRevaluateAssessment from './assessment-global-level-revaluate/assessment-global-level-revaluate-assessment';
import { AssessmentGlobalLevelRevaluateQuestionWise } from './assessment-global-level-revaluate/assessment-global-level-revaluate-question-wise';
import { AssessmentGlobalLevelReleaseResultAssessment } from './assessment-global-level-revaluate/assessment-global-level-release-result-assessment';
import ExportDialogPDFCSV from '@/components/common/export-dialog-pdf-csv';
import Papa from 'papaparse';

export interface SelectedSubmissionsFilterInterface {
    name: string;
    assessment_type: string;
    attempt_type: string[];
    registration_source: string;
    batches: MyFilterOption[];
    status: string[];
    sort_columns: Record<string, string>;
}

export interface SelectedReleaseResultFilterInterface {
    attempt_ids: string[];
}

const AssessmentSubmissionsTab = ({ type }: { type: string }) => {
    const { t } = useTranslation('homeworkCreationAssessmentSubmissionsTab');
    const { t: tHelper } = useTranslation('homeworkCreationAssessmentDetailsHelper');
    const { t: tStudentColumns } = useTranslation('homeworkCreationStudentColumns');
    const { data: initData } = useSuspenseQuery(useInstituteQuery());
    const { BatchesFilterData } = useFilterDataForAssesment(initData);
    const instituteId = getInstituteId();
    const { assessmentId, examType, assesssmentType, assessmentTab } = Route.useParams();
    const { data: totalMarks } = useSuspenseQuery(
        handleGetAssessmentTotalMarksData({ assessmentId })
    );
    const [selectedParticipantsTab, setSelectedParticipantsTab] = useState('internal');
    const [selectedTab, setSelectedTab] = useState('Attempted');
    const [batchSelectionTab, setBatchSelectionTab] = useState('batch');
    const [page, setPage] = useState(0);
    const [selectedStudent, setSelectedStudent] = useState<StudentTable | null>(null);
    const [selectedFilter, setSelectedFilter] = useState<SelectedSubmissionsFilterInterface>({
        name: '',
        assessment_type: assesssmentType,
        attempt_type: ['ENDED'],
        registration_source: 'BATCH_PREVIEW_REGISTRATION',
        batches: [],
        status: ['ACTIVE'],
        sort_columns: {},
    });

    const [searchText, setSearchText] = useState('');
    const [participantsData, setParticipantsData] = useState({
        content: [],
        total_pages: 0,
        page_no: 0,
        page_size: 10,
        total_elements: 0,
        last: false,
    });
    const [isParticipantsLoading, setIsParticipantsLoading] = useState(false);

    const [rowSelections, setRowSelections] = useState<Record<number, Record<string, boolean>>>({});
    const currentPageSelection = rowSelections[page] || {};
    const totalSelectedCount = Object.values(rowSelections).reduce(
        (count, pageSelection) => count + Object.keys(pageSelection).length,
        0
    );

    const [attemptedCount, setAttemptedCount] = useState(0);
    const [ongoingCount, setOngoingCount] = useState(0);
    const [pendingCount, setPendingCount] = useState(0);

    const getParticipantsListData = useMutation({
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
            selectedFilter: SelectedSubmissionsFilterInterface;
        }) => getAdminParticipants(assessmentId, instituteId, pageNo, pageSize, selectedFilter),
        onSuccess: (data) => {
            setParticipantsData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const [allPagesData, setAllPagesData] = useState<Record<number, StudentTable[]>>({});

    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updaterOrValue) => {
        const newSelection =
            typeof updaterOrValue === 'function'
                ? updaterOrValue(rowSelections[page] || {})
                : updaterOrValue;

        setRowSelections((prev) => ({
            ...prev,
            [page]: newSelection,
        }));
    };

    const handleResetSelections = () => {
        setRowSelections({});
    };

    const getSelectedStudents = (): StudentTable[] => {
        return Object.entries(rowSelections).flatMap(([pageNum, selections]) => {
            const pageData = allPagesData[parseInt(pageNum)];
            if (!pageData) return [];

            return Object.entries(selections)
                .filter(([, isSelected]) => isSelected)
                .map(([index]) => pageData[parseInt(index)])
                .filter((student): student is StudentTable => student !== undefined);
        });
    };

    const getSelectedStudentIds = (): string[] => {
        return getSelectedStudents().map((student) => student.user_id);
    };

    const getAssessmentColumn = {
        Attempted: getAllColumnsForTable(type, selectedParticipantsTab, tStudentColumns).Attempted,
        Pending: getAllColumnsForTable(type, selectedParticipantsTab, tStudentColumns).Pending,
        Ongoing: getAllColumnsForTable(type, selectedParticipantsTab, tStudentColumns).Ongoing,
    };

    const getAssessmentColumnWidth = {
        Attempted: getAllColumnsForTableWidth(type, selectedParticipantsTab).Attempted,
        Pending: getAllColumnsForTableWidth(type, selectedParticipantsTab).Pending,
        Ongoing: getAllColumnsForTableWidth(type, selectedParticipantsTab).Ongoing,
    };

    const handleAttemptedTab = (value: string) => {
        setSelectedTab(value);
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        value === 'Attempted' ? 'ENDED' : value === 'Pending' ? 'PENDING' : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        value === 'Attempted' ? 'ENDED' : value === 'Pending' ? 'PENDING' : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        value === 'Attempted' ? 'ENDED' : value === 'Pending' ? 'PENDING' : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleParticipantsTab = (value: string) => {
        setSelectedParticipantsTab(value);
        if (value === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (value === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (value === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleBatchSeletectionTab = (value: string) => {
        setBatchSelectionTab(value);
        if (selectedParticipantsTab === 'internal' && value === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && value === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: newPage,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: newPage,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: newPage,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleRefreshLeaderboard = () => {
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const clearSearch = () => {
        setSearchText('');
        selectedFilter['name'] = '';
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleSearch = (searchValue: string) => {
        setSearchText(searchValue);
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    name: searchValue,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    name: searchValue,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    name: searchValue,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleFilterChange = (filterKey: string, selectedItems: MyFilterOption[]) => {
        setSelectedFilter((prev) => {
            const updatedFilters = { ...prev, [filterKey]: selectedItems };
            return updatedFilters;
        });
    };

    const handleResetFilters = () => {
        setSelectedFilter((prevFilter) => ({
            ...prevFilter,
            name: '',
            batches: [],
        }));
        setSearchText('');
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    name: '',
                    batches: [],
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    name: '',
                    batches: [],
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize: 10,
                selectedFilter: {
                    ...selectedFilter,
                    name: '',
                    batches: [],
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const getStudentSubmissionsDataPDF = useMutation({
        mutationFn: ({
            instituteId,
            assessmentId,
            selectedFilter,
        }: {
            instituteId: string | undefined;
            assessmentId: string;
            selectedFilter: SelectedSubmissionsFilterInterface;
        }) => handleGetSubmissionsExportPDF(instituteId, assessmentId, selectedFilter),
        onSuccess: async (response) => {
            const date = new Date();
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `pdf_student_submissions_list_${date.toLocaleString()}.pdf`
            );
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success(t('toasts.exportPdfSuccess'));
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const getStudentSubmissionsDataCSV = useMutation({
        mutationFn: ({
            instituteId,
            assessmentId,
            selectedFilter,
        }: {
            instituteId: string | undefined;
            assessmentId: string;
            selectedFilter: SelectedSubmissionsFilterInterface;
        }) => handleGetSubmissionsExportCSV(instituteId, assessmentId, selectedFilter),
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
                `csv_student_submissions_list_${date.toLocaleString()}.csv`
            );
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up the created URL object
            URL.revokeObjectURL(url);
            toast.success(t('toasts.exportCsvSuccess'));
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleExportPDF = () => {
        getStudentSubmissionsDataPDF.mutate({
            instituteId: initData?.id,
            assessmentId,
            selectedFilter,
        });
    };
    const handleExportCSV = () => {
        getStudentSubmissionsDataCSV.mutate({
            instituteId: initData?.id,
            assessmentId,
            selectedFilter,
        });
    };

    console.log(
        getAssessmentSubmissionsFilteredDataStudentData(
            participantsData.content,
            type,
            selectedTab,
            initData?.batches_for_sessions,
            totalMarks.total_achievable_marks,
            tHelper
        )
    );

    useEffect(() => {
        const timer = setTimeout(() => {
            const fetchAllParticipants = async () => {
                setIsParticipantsLoading(true);

                try {
                    const [attemptedData, ongoingData, pendingData] = await Promise.all([
                        getAdminParticipants(assessmentId, instituteId, page, 10, selectedFilter),
                        getAdminParticipants(assessmentId, instituteId, page, 10, {
                            ...selectedFilter,
                            attempt_type: ['LIVE'],
                        }),
                        getAdminParticipants(assessmentId, instituteId, page, 10, {
                            ...selectedFilter,
                            attempt_type: ['Pending'],
                        }),
                    ]);

                    setParticipantsData(attemptedData);
                    setAttemptedCount(attemptedData.content.length);
                    setOngoingCount(ongoingData.content.length);
                    setPendingCount(pendingData.content.length);
                } catch (error) {
                    console.log(error);
                } finally {
                    setIsParticipantsLoading(false);
                }
            };
            fetchAllParticipants();
        }, 300); // Adjust the debounce time as needed

        return () => clearTimeout(timer); // Cleanup the timeout on component unmount
    }, []);

    useEffect(() => {
        if (participantsData?.content) {
            setAllPagesData((prev) => ({
                ...prev,
                [page]: participantsData.content,
            }));
        }
    }, [participantsData?.content, page]);

    if (isParticipantsLoading) return <DashboardLoader />;

    return (
        <ControlledStudentSidebarProvider
            selectedStudent={selectedStudent}
            setSelectedStudent={setSelectedStudent}
        >
            <Tabs
                value={selectedTab}
                onValueChange={handleAttemptedTab}
                className="flex w-full flex-col gap-4"
            >
                <div className="flex items-center justify-between">
                    <TabsList className="mb-2 ml-4 mt-6 inline-flex h-auto justify-start gap-4 rounded-none border-b !bg-transparent p-0">
                        <TabsTrigger
                            value="Attempted"
                            className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                selectedTab === 'Attempted'
                                    ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                    : 'border-none bg-transparent'
                            }`}
                        >
                            <span
                                className={`${
                                    selectedTab === 'Attempted' ? 'text-primary-500' : ''
                                }`}
                            >
                                {t('tabs.attempted')}
                            </span>
                            <Badge
                                className="rounded-full bg-primary-500 p-0 px-2 text-2xs text-white"
                                variant="outline"
                            >
                                {attemptedCount}
                            </Badge>
                        </TabsTrigger>
                        {assessmentTab !== 'previousTests' && (
                            <TabsTrigger
                                value="Ongoing"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'Ongoing'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={`${
                                        selectedTab === 'Ongoing' ? 'text-primary-500' : ''
                                    }`}
                                >
                                    {t('tabs.ongoing')}
                                </span>
                                <Badge
                                    className="rounded-full bg-primary-500 p-0 px-2 text-2xs text-white"
                                    variant="outline"
                                >
                                    {ongoingCount}
                                </Badge>
                            </TabsTrigger>
                        )}
                        <TabsTrigger
                            value="Pending"
                            className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                selectedTab === 'Pending'
                                    ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                    : 'border-none bg-transparent'
                            }`}
                        >
                            <span
                                className={`${selectedTab === 'Pending' ? 'text-primary-500' : ''}`}
                            >
                                {t('tabs.pending')}
                            </span>
                            <Badge
                                className="rounded-full bg-primary-500 p-0 px-2 text-2xs text-white"
                                variant="outline"
                            >
                                {pendingCount}
                            </Badge>
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex items-center gap-6">
                        <ExportDialogPDFCSV
                            handleExportPDF={handleExportPDF}
                            handleExportCSV={handleExportCSV}
                            isPDFLoading={
                                getStudentSubmissionsDataPDF.status === 'pending' ? true : false
                            }
                            isCSVLoading={
                                getStudentSubmissionsDataCSV.status === 'pending' ? true : false
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
                <div className="flex items-center justify-between">
                    {assesssmentType === 'PUBLIC' && (
                        <Tabs
                            value={selectedParticipantsTab}
                            onValueChange={handleParticipantsTab}
                            className={`ml-4 flex justify-start rounded-lg bg-white p-0 pr-4 shadow-none`}
                        >
                            <TabsList className="flex h-auto flex-wrap justify-start border border-gray-500 !bg-transparent p-0">
                                <TabsTrigger
                                    value="internal"
                                    className={`flex gap-1.5 rounded-l-lg rounded-r-none p-2 px-4 ${
                                        selectedParticipantsTab === 'internal'
                                            ? '!bg-primary-100'
                                            : 'bg-transparent'
                                    }`}
                                >
                                    <span
                                        className={`${
                                            selectedParticipantsTab === 'internal'
                                                ? 'text-teal-800 dark:text-teal-400'
                                                : ''
                                        }`}
                                    >
                                        {t('participantsTabs.internal')}
                                    </span>
                                </TabsTrigger>
                                <Separator orientation="vertical" className="h-full bg-gray-500" />
                                <TabsTrigger
                                    value="external"
                                    className={`flex gap-1.5 rounded-l-none rounded-r-lg p-2 px-4 ${
                                        selectedParticipantsTab === 'external'
                                            ? '!bg-primary-100'
                                            : 'bg-transparent'
                                    }`}
                                >
                                    <span
                                        className={`${
                                            selectedParticipantsTab === 'external'
                                                ? 'text-teal-800 dark:text-teal-400'
                                                : ''
                                        }`}
                                    >
                                        {t('participantsTabs.external')}
                                    </span>
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    )}
                    <div className="flex items-center gap-6">
                        <AssessmentDetailsSearchComponent
                            onSearch={handleSearch}
                            searchText={searchText}
                            setSearchText={setSearchText}
                            clearSearch={clearSearch}
                        />
                        <ScheduleTestFilters
                            label={getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}
                            data={BatchesFilterData}
                            selectedItems={selectedFilter['batches'] || []}
                            onSelectionChange={(items) => handleFilterChange('batches', items)}
                        />
                        <AssessmentSubmissionsFilterButtons
                            selectedQuestionPaperFilters={selectedFilter}
                            handleSubmitFilters={handleRefreshLeaderboard}
                            handleResetFilters={handleResetFilters}
                        />
                    </div>
                </div>
                {selectedParticipantsTab === 'internal' && (
                    <div className="flex items-center justify-between">
                        <Tabs
                            value={batchSelectionTab}
                            onValueChange={handleBatchSeletectionTab}
                            className="flex w-fit flex-col gap-4"
                        >
                            <TabsList className="mb-2 ml-4 mt-6 inline-flex h-auto justify-start gap-4 rounded-none border-b !bg-transparent p-0">
                                <TabsTrigger
                                    value="batch"
                                    className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                        batchSelectionTab === 'batch'
                                            ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                            : 'border-none bg-transparent'
                                    }`}
                                >
                                    <span
                                        className={`${
                                            batchSelectionTab === 'batch' ? 'text-primary-500' : ''
                                        }`}
                                    >
                                        {t('batchSelectionTabs.batch')}
                                    </span>
                                </TabsTrigger>
                                <TabsTrigger
                                    value="individual"
                                    className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                        batchSelectionTab === 'individual'
                                            ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                            : 'border-none bg-transparent'
                                    }`}
                                >
                                    <span
                                        className={`${
                                            batchSelectionTab === 'individual'
                                                ? 'text-primary-500'
                                                : ''
                                        }`}
                                    >
                                        {t('batchSelectionTabs.individual')}
                                    </span>
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {selectedTab === 'Attempted' && (
                            <div className="mt-2 flex justify-between gap-6">
                                <Dialog>
                                    <DialogTrigger>
                                        <MyButton
                                            type="button"
                                            scale="large"
                                            buttonType="secondary"
                                            className="font-medium"
                                        >
                                            {t('actions.revaluate')}
                                        </MyButton>
                                    </DialogTrigger>
                                    <DialogContent className="p-0">
                                        <h1 className="rounded-t-lg bg-primary-50 p-4 text-primary-500">
                                            {t('dialogs.revaluateResultTitle')}
                                        </h1>
                                        <div className="flex flex-col items-center justify-center gap-4 p-4">
                                            <AssessmentGlobalLevelRevaluateAssessment />
                                            <AssessmentGlobalLevelRevaluateQuestionWise />
                                        </div>
                                    </DialogContent>
                                </Dialog>
                                <AssessmentGlobalLevelReleaseResultAssessment />
                            </div>
                        )}
                    </div>
                )}
                <div className="flex max-h-[72vh] flex-col gap-6 overflow-y-auto p-4">{/* design-lint-ignore: viewport-relative scroll cap has no spacing token */}
                    <TabsContent value={selectedTab}>
                        <SidebarProvider
                            style={{ ['--sidebar-width' as string]: '565px' }}
                            defaultOpen={false}
                        >
                            <AssessmentSubmissionsStudentTable
                                data={{
                                    content: getAssessmentSubmissionsFilteredDataStudentData(
                                        participantsData.content,
                                        type,
                                        selectedTab,
                                        initData?.batches_for_sessions,
                                        totalMarks.total_achievable_marks,
                                        tHelper
                                    ),
                                    total_pages: participantsData.total_pages,
                                    page_no: page,
                                    page_size: 10,
                                    total_elements: participantsData.total_elements,
                                    last: participantsData.last,
                                }}
                                columns={
                                    getAssessmentColumn[
                                        selectedTab as keyof typeof getAssessmentColumn
                                    ] || []
                                }
                                columnWidths={
                                    getAssessmentColumnWidth[
                                        selectedTab as keyof typeof getAssessmentColumnWidth
                                    ] || []
                                }
                                rowSelection={currentPageSelection}
                                onRowSelectionChange={handleRowSelectionChange}
                                currentPage={page}
                            />
                            <StudentSidebar selectedTab={selectedTab} examType={examType} />
                        </SidebarProvider>
                    </TabsContent>
                    <div className="flex justify-between">
                        <BulkActions
                            selectedCount={totalSelectedCount}
                            selectedStudentIds={getSelectedStudentIds()}
                            selectedStudents={getSelectedStudents()}
                            onReset={handleResetSelections}
                            selectedTab={selectedTab}
                        />
                        <MyPagination
                            currentPage={page}
                            totalPages={participantsData.total_pages}
                            onPageChange={handlePageChange}
                        />
                    </div>
                </div>
            </Tabs>
        </ControlledStudentSidebarProvider>
    );
};

export default AssessmentSubmissionsTab;
