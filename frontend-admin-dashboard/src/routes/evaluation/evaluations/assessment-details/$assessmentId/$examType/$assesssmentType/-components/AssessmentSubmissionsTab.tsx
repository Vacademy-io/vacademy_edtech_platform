/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Route } from '..';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { MyPagination } from '@/components/design-system/pagination';
import { AssessmentDetailsSearchComponent } from './SearchComponent';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { ScheduleTestFilters } from '@/routes/assessment/assessment-list/-components/ScheduleTestFilters';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import AssessmentSubmissionsFilterButtons from './AssessmentSubmissionsFilterButtons';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StudentSidebarContext } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { ParticipantSidebar } from '@/routes/evaluation/evaluations/-components/ParticipantSidebar';
import { StudentTable } from '@/types/student-table-types';
import {
    getAllColumnsForTable,
    getAllColumnsForTableWidth,
    getAssessmentSubmissionsFilteredDataStudentData,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-utils/helper';
import {
    getAdminParticipants,
    handleGetAssessmentTotalMarksData,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { BulkActions } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/bulk-actions/bulk-actions';
import { AssessmentSubmissionsStudentTable } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/AssessmentSubmissionsStudentTable';

export interface SelectedSubmissionsFilterInterface {
    name: string;
    assessment_type: string;
    attempt_type: string[];
    registration_source: string;
    batches: MyFilterOption[];
    status: string[];
    sort_columns: Record<string, string>;
}

const AssessmentSubmissionsTab = ({ type }: { type: string }) => {
    const { t } = useTranslation('evaluationAssessmentSubmissionsTab');
    const { data: initData } = useSuspenseQuery(useInstituteQuery());
    const { BatchesFilterData } = useFilterDataForAssesment(initData);
    const instituteId = getInstituteId();
    const { assessmentId, examType, assesssmentType } = Route.useParams();
    const { data: totalMarks } = useSuspenseQuery(
        handleGetAssessmentTotalMarksData({ assessmentId })
    );
    const [selectedParticipantsTab, setSelectedParticipantsTab] = useState('internal');
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
        Attempted: getAllColumnsForTable(type, selectedParticipantsTab).Attempted,
        Pending: getAllColumnsForTable(type, selectedParticipantsTab).Pending,
        Ongoing: getAllColumnsForTable(type, selectedParticipantsTab).Ongoing,
    };

    const getAssessmentColumnWidth = {
        Attempted: getAllColumnsForTableWidth(type, selectedParticipantsTab).Attempted,
        Pending: getAllColumnsForTableWidth(type, selectedParticipantsTab).Pending,
        Ongoing: getAllColumnsForTableWidth(type, selectedParticipantsTab).Ongoing,
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: ['ENDED'],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
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
                    attempt_type: [],
                },
            });
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            const fetchAllParticipants = async () => {
                setIsParticipantsLoading(true);

                try {
                    const [attemptedData] = await Promise.all([
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
        <StudentSidebarContext.Provider value={{ selectedStudent, setSelectedStudent }}>
            <div className="flex w-full flex-col gap-4">
                <div className="flex items-center justify-between">
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
                                    {t('internalParticipants')}
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
                                    {t('externalParticipants')}
                                </span>
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
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
                                        {t('batchSelection')}
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
                                        {t('individualSelection')}
                                    </span>
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>
                )}
                <div className="flex max-h-[72vh] flex-col gap-6 overflow-y-auto p-4">
                    <SidebarProvider style={{ ['--sidebar-width' as string]: '565px' }}>
                        <AssessmentSubmissionsStudentTable
                            data={{
                                // @ts-expect-error : //TODO: Fix this type error
                                content: getAssessmentSubmissionsFilteredDataStudentData(
                                    participantsData.content,
                                    type,
                                    'Attempted',
                                    // @ts-expect-error : //TODO: Fix this type error
                                    initData?.batches_for_sessions,
                                    totalMarks.total_achievable_marks
                                ),
                                total_pages: participantsData.total_pages,
                                page_no: page,
                                page_size: 10,
                                total_elements: participantsData.total_elements,
                                last: participantsData.last,
                            }}
                            // @ts-expect-error : //TODO: Fix this type error
                            columns={
                                getAssessmentColumn[
                                    'Attempted' as keyof typeof getAssessmentColumn
                                ] || []
                            }
                            columnWidths={
                                getAssessmentColumnWidth[
                                    'Attempted' as keyof typeof getAssessmentColumnWidth
                                ] || []
                            }
                            rowSelection={currentPageSelection}
                            onRowSelectionChange={handleRowSelectionChange}
                            currentPage={page}
                        />
                        {selectedStudent && (
                            <ParticipantSidebar assessmentId={assessmentId} examType={examType} />
                        )}
                    </SidebarProvider>

                    <div className="flex justify-between">
                        <BulkActions
                            selectedCount={totalSelectedCount}
                            selectedStudentIds={getSelectedStudentIds()}
                            // @ts-expect-error : //TODO: Fix this type error
                            selectedStudents={getSelectedStudents()}
                            onReset={handleResetSelections}
                            selectedTab={'Attempted'}
                        />
                        <MyPagination
                            currentPage={page}
                            totalPages={participantsData.total_pages}
                            onPageChange={handlePageChange}
                        />
                    </div>
                </div>
            </div>
        </StudentSidebarContext.Provider>
    );
};

export default AssessmentSubmissionsTab;
