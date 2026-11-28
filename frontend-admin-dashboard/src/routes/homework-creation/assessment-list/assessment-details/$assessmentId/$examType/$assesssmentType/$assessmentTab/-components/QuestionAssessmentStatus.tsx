/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StudentSidebarContext } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { StudentTable } from '@/types/student-table-types';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getAllColumnsForTableQuestionWise,
    getAllColumnsForTableWidthQuestionWise,
    getQuestionWiseFilteredDataStudentData,
} from '../-utils/helper';
import { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import {
    getParticipantsListQuestionwise,
    handleGetRespondentExportCSV,
    handleGetRespondentExportPDF,
} from '../-services/assessment-details-services';
import { ScheduleTestFilters } from '@/routes/assessment/assessment-list/-components/ScheduleTestFilters';
import { AssessmentDetailsSearchComponent } from './SearchComponent';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { MyFilterOption } from '@/types/assessments/my-filter';
import StudentQuestionwiseFilterButtons from './StudentQuestionwiseFilterButtons';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    QuestionAssessmentStatusProps,
    SelectedFilterQuestionWise,
    StudentQuestionwiseContent,
} from '@/types/assessments/student-questionwise-status';
import ExportDialogPDFCSV from '@/components/common/export-dialog-pdf-csv';
import Papa from 'papaparse';

const QuestionAssessmentStatus = ({
    assessmentId,
    sectionId,
    questionId,
    assesssmentType,
    questionStatus,
}: QuestionAssessmentStatusProps) => {
    const { t: tHelper } = useTranslation('homeworkCreationAssessmentDetailsHelper');
    const { t: tStudentColumns } = useTranslation('homeworkCreationStudentColumns');
    const [isLoading, setIsLoading] = useState(false);
    const { data: initData } = useSuspenseQuery(useInstituteQuery());
    const { BatchesFilterData } = useFilterDataForAssesment(initData);
    const [selectedParticipantsTab, setSelectedParticipantsTab] = useState('internal');
    const [selectedFilter, setSelectedFilter] = useState<SelectedFilterQuestionWise>({
        name: '',
        status: [questionStatus],
        assessment_visibility: [assesssmentType], // Fixed typo
        registration_source:
            assesssmentType === 'PRIVATE'
                ? ['BATCH_PREVIEW_REGISTRATION', 'ADMIN_PRE_REGISTRATION']
                : selectedParticipantsTab === 'internal'
                  ? ['ADMIN_REGISTRATION']
                  : ['OPEN_REGISTRATION'],
        registration_source_id: [],
        sort_columns: {},
    });

    const [pageNo, setPageNo] = useState(0);
    const [selectedStudent, setSelectedStudent] = useState<StudentTable | null>(null);
    const [rowSelections, setRowSelections] = useState<Record<number, Record<string, boolean>>>({});
    const currentPageSelection = rowSelections[pageNo] || {};
    const [participantsData, setParticipantsData] = useState<StudentQuestionwiseContent>({
        content: [],
        total_pages: 0,
        page_no: pageNo,
        page_size: 10,
        total_elements: 0,
        last: false,
    });
    const [searchText, setSearchText] = useState('');
    const handleRefreshList = () => {
        getParticipantsListData.mutate({
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize: 10,
            selectedFilter,
        });
    };
    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updaterOrValue) => {
        const newSelection =
            typeof updaterOrValue === 'function'
                ? updaterOrValue(rowSelections[pageNo] || {})
                : updaterOrValue;

        setRowSelections((prev) => ({
            ...prev,
            [pageNo]: newSelection,
        }));
    };

    const getParticipantsListData = useMutation({
        mutationFn: ({
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize,
            selectedFilter,
        }: {
            assessmentId: string;
            sectionId: string | undefined;
            questionId: string | undefined;
            pageNo: number;
            pageSize: number;
            selectedFilter: SelectedFilterQuestionWise;
        }) =>
            getParticipantsListQuestionwise(
                assessmentId,
                sectionId,
                questionId,
                pageNo,
                pageSize,
                selectedFilter
            ),
        onSuccess: (data) => {
            setParticipantsData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleParticipantsTab = (value: string) => {
        setSelectedParticipantsTab(value);
        getParticipantsListData.mutate({
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                registration_source:
                    assesssmentType === 'PRIVATE'
                        ? ['BATCH_PREVIEW_REGISTRATION', 'ADMIN_PRE_REGISTRATION']
                        : value === 'internal'
                          ? ['ADMIN_REGISTRATION']
                          : ['OPEN_REGISTRATION'],
            },
        });
    };

    const handlePageChange = (newPage: number) => {
        setPageNo(newPage);
        getParticipantsListData.mutate({
            assessmentId,
            sectionId,
            questionId,
            pageNo: newPage,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                registration_source:
                    assesssmentType === 'PRIVATE'
                        ? ['BATCH_PREVIEW_REGISTRATION', 'ADMIN_PRE_REGISTRATION']
                        : selectedParticipantsTab === 'internal'
                          ? ['ADMIN_REGISTRATION']
                          : ['OPEN_REGISTRATION'],
            },
        });
    };

    const handleSearch = (searchValue: string) => {
        setSearchText(searchValue);
        getParticipantsListData.mutate({
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                name: searchValue,
                registration_source:
                    assesssmentType === 'PRIVATE'
                        ? ['BATCH_PREVIEW_REGISTRATION', 'ADMIN_PRE_REGISTRATION']
                        : selectedParticipantsTab === 'internal'
                          ? ['ADMIN_REGISTRATION']
                          : ['OPEN_REGISTRATION'],
            },
        });
    };

    const clearSearch = () => {
        setSearchText('');
        selectedFilter['name'] = '';
        getParticipantsListData.mutate({
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                registration_source:
                    assesssmentType === 'PRIVATE'
                        ? ['BATCH_PREVIEW_REGISTRATION', 'ADMIN_PRE_REGISTRATION']
                        : selectedParticipantsTab === 'internal'
                          ? ['ADMIN_REGISTRATION']
                          : ['OPEN_REGISTRATION'],
            },
        });
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
            registration_source_id: [],
        }));
        setSearchText('');
        getParticipantsListData.mutate({
            assessmentId,
            sectionId,
            questionId,
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                name: '',
                registration_source_id: [],
                registration_source:
                    assesssmentType === 'PRIVATE'
                        ? ['BATCH_PREVIEW_REGISTRATION', 'ADMIN_PRE_REGISTRATION']
                        : selectedParticipantsTab === 'internal'
                          ? ['ADMIN_REGISTRATION']
                          : ['OPEN_REGISTRATION'],
            },
        });
    };

    const getRespondentDataPDF = useMutation({
        mutationFn: ({
            instituteId,
            sectionId,
            questionId,
            assessmentId,
            selectedFilter,
        }: {
            instituteId: string | undefined;
            sectionId: string;
            questionId: string;
            assessmentId: string;
            selectedFilter: SelectedFilterQuestionWise;
        }) =>
            handleGetRespondentExportPDF(
                instituteId,
                sectionId,
                questionId,
                assessmentId,
                selectedFilter
            ),
        onSuccess: async (response) => {
            const date = new Date();
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `pdf_student_respondent_list_${date.toLocaleString()}.pdf`
            );
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success('Student respondent list data for PDF exported successfully');
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const getRespondentDataCSV = useMutation({
        mutationFn: ({
            instituteId,
            sectionId,
            questionId,
            assessmentId,
            selectedFilter,
        }: {
            instituteId: string | undefined;
            sectionId: string;
            questionId: string;
            assessmentId: string;
            selectedFilter: SelectedFilterQuestionWise;
        }) =>
            handleGetRespondentExportCSV(
                instituteId,
                sectionId,
                questionId,
                assessmentId,
                selectedFilter
            ),
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
                `csv_student_respondent_list_${date.toLocaleString()}.csv`
            );
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up the created URL object
            URL.revokeObjectURL(url);
            toast.success('Student respondent list data for CSV exported successfully');
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleExportPDF = () => {
        getRespondentDataPDF.mutate({
            instituteId: initData?.id,
            sectionId,
            questionId,
            assessmentId,
            selectedFilter,
        });
    };
    const handleExportCSV = () => {
        getRespondentDataCSV.mutate({
            instituteId: initData?.id,
            sectionId,
            questionId,
            assessmentId,
            selectedFilter,
        });
    };

    useEffect(() => {
        setIsLoading(true);
        const timer = setTimeout(() => {
            const fetchQuestionWiseParticipants = async () => {
                try {
                    const response = await getParticipantsListQuestionwise(
                        assessmentId,
                        sectionId,
                        questionId,
                        pageNo,
                        10,
                        selectedFilter
                    );
                    setParticipantsData(response);
                } catch (err) {
                    console.log(err);
                } finally {
                    setIsLoading(false);
                }
            };
            fetchQuestionWiseParticipants();
        }, 300); // Adjust the debounce time as needed

        return () => clearTimeout(timer); // Cleanup the timeout on component unmount
    }, []);

    if (isLoading || getParticipantsListData.status === 'pending')
        return (
            <div className="w-screen">
                <DashboardLoader />
            </div>
        );

    return (
        <StudentSidebarContext.Provider value={{ selectedStudent, setSelectedStudent }}>
            <Tabs
                value={selectedParticipantsTab}
                onValueChange={handleParticipantsTab}
                className="flex w-full flex-col gap-4"
            >
                <div className="mt-4 flex w-full flex-col items-start justify-between gap-4 px-4">
                    <div className="flex w-full justify-between">
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
                                selectedItems={selectedFilter['registration_source_id'] || []}
                                onSelectionChange={(items) =>
                                    handleFilterChange('registration_source_id', items)
                                }
                            />
                            <StudentQuestionwiseFilterButtons
                                selectedQuestionPaperFilters={selectedFilter}
                                handleSubmitFilters={handleRefreshList}
                                handleResetFilters={handleResetFilters}
                            />
                        </div>
                        <div className="flex items-center gap-6">
                            <ExportDialogPDFCSV
                                handleExportPDF={handleExportPDF}
                                handleExportCSV={handleExportCSV}
                                isPDFLoading={
                                    getRespondentDataPDF.status === 'pending' ? true : false
                                }
                                isCSVLoading={
                                    getRespondentDataCSV.status === 'pending' ? true : false
                                }
                            />
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                className="min-w-8 font-medium"
                                onClick={handleRefreshList}
                            >
                                <ArrowCounterClockwise size={32} />
                            </MyButton>
                        </div>
                    </div>
                    {assesssmentType === 'PUBLIC' && (
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
                                    Internal Participants
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
                                    External Participants
                                </span>
                            </TabsTrigger>
                        </TabsList>
                    )}
                </div>
                <div className="flex max-h-dialog-tall flex-col gap-6 overflow-y-auto px-4">
                    <TabsContent value={selectedParticipantsTab}>
                        <MyTable
                            data={{
                                content: getQuestionWiseFilteredDataStudentData(
                                    participantsData.content,
                                    assesssmentType,
                                    selectedParticipantsTab,
                                    initData?.batches_for_sessions,
                                    tHelper
                                ),
                                total_pages: participantsData.total_pages,
                                page_no: pageNo,
                                page_size: 10,
                                total_elements: participantsData.total_elements,
                                last: participantsData.last,
                            }}
                            columns={
                                assesssmentType === 'PRIVATE' ||
                                selectedParticipantsTab === 'internal'
                                    ? getAllColumnsForTableQuestionWise(
                                          assesssmentType,
                                          selectedParticipantsTab,
                                          tStudentColumns
                                      ).studentInternalOrCloseQuestionWise
                                    : getAllColumnsForTableQuestionWise(
                                          assesssmentType,
                                          selectedParticipantsTab,
                                          tStudentColumns
                                      ).studentExternalQuestionWise || []
                            }
                            columnWidths={
                                assesssmentType === 'PRIVATE' ||
                                selectedParticipantsTab === 'internal'
                                    ? getAllColumnsForTableWidthQuestionWise(
                                          assesssmentType,
                                          selectedParticipantsTab
                                      ).QUESTION_WISE_COLUMNS_INTERNAL_OR_CLOSE_WIDTH
                                    : getAllColumnsForTableWidthQuestionWise(
                                          assesssmentType,
                                          selectedParticipantsTab
                                      ).QUESTION_WISE_COLUMNS_EXTERNAL_WIDTH || []
                            }
                            rowSelection={currentPageSelection}
                            onRowSelectionChange={handleRowSelectionChange}
                            currentPage={pageNo}
                        />
                    </TabsContent>
                    <MyPagination
                        currentPage={pageNo}
                        totalPages={participantsData.total_pages}
                        onPageChange={handlePageChange}
                    />
                </div>
            </Tabs>
        </StudentSidebarContext.Provider>
    );
};

export default QuestionAssessmentStatus;
