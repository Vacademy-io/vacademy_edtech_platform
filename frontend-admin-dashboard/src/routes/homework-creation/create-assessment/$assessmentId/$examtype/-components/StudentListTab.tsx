import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { GetFilterData } from '@/routes/manage-students/students-list/-constants/all-filters';
import { MyTable, TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { useStudentFilters } from '@/routes/manage-students/students-list/-hooks/useStudentFilters';
import { useStudentTable } from '@/routes/manage-students/students-list/-hooks/useStudentTable';
import { StudentTable } from '@/types/student-table-types';
import { myColumns } from '@/components/design-system/utils/constants/table-column-data';
import {
    STUDENT_LIST_ASSESSMENT_COLUMN_WIDTHS,
    STUDENT_LIST_COLUMN_WIDTHS,
} from '@/components/design-system/utils/constants/table-layout';
import { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { useSuspenseQuery } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { SmartErrorPage } from '@/components/core/SmartErrorPage';
import { StudentListHeader } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/student-list-header';
import { StudentFilters } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/student-filters';
import { BulkActions } from '@/routes/manage-students/students-list/-components/students-list/bulk-actions';
import { buildMyAssessmentColumns } from './assessment-columns';
import { UseFormReturn } from 'react-hook-form';
import type { TestAccessFormValues } from '../-utils/add-participants-schema';
import { useTestAccessStore } from '../-utils/zustand-global-states/step3-adding-participants';
import { Route } from '..';
import { Step3ParticipantsListIndiviudalStudentInterface } from '@/types/assessments/student-questionwise-status';
import { getInstituteId } from '@/constants/helper';
import { handleGetIndividualStudentList } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

type TestAccessFormType = TestAccessFormValues;

export const getCurrentSession = (): string => {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    return `${currentYear}-${currentYear + 1}`;
};

export const StudentListTab = ({ form }: { form: UseFormReturn<TestAccessFormType> }) => {
    const { assessmentId } = Route.useParams();
    const storeDataStep3 = useTestAccessStore((state) => state);
    const instituteId = getInstituteId();
    const { data: studentList } = useSuspenseQuery(
        handleGetIndividualStudentList({ instituteId, assessmentId })
    );
    const preExistingStudentIds = useMemo(() => {
        if (assessmentId !== 'defaultId')
            return studentList
                .filter(
                    (user: Step3ParticipantsListIndiviudalStudentInterface) =>
                        user.source === 'ADMIN_PRE_REGISTRATION'
                )
                .map((user: Step3ParticipantsListIndiviudalStudentInterface) => user.userId);
        return (storeDataStep3.select_individually?.student_details || []).map(
            (student) => student.user_id
        );
    }, [storeDataStep3.select_individually?.student_details]);

    const { isError, isLoading } = useSuspenseQuery(useInstituteQuery());
    const { instituteDetails } = useInstituteDetailsStore();
    const sessions =
        instituteDetails?.sessions?.map((session) => ({
            id: session.id,
            name: session.session_name,
        })) || [];
    const { t: tAllFilters } = useTranslation('manageStudentsAllFilters');
    const { t: tAssessmentColumns } = useTranslation('homeworkCreationAssessmentColumns');
    const filters = GetFilterData(tAllFilters, instituteDetails, getCurrentSession());
    const myAssessmentColumns = useMemo(
        () => buildMyAssessmentColumns(tAssessmentColumns),
        [tAssessmentColumns]
    );
    const [isAssessment] = useState(true);
    const { setValue } = form;

    const {
        columnFilters,
        appliedFilters,
        clearFilters,
        searchInput,
        searchFilter,
        currentSession,
        getActiveFiltersState,
        handleFilterChange,
        handleFilterClick,
        handleClearFilters,
        handleSearchInputChange,
        handleSearchEnter,
        handleClearSearch,
        setAppliedFilters,
        handleSessionChange,
        sessionList,
    } = useStudentFilters();

    const {
        studentTableData,
        isLoading: loadingData,
        error: loadingError,
        page,
        handleSort,
        handlePageChange,
    } = useStudentTable(appliedFilters, setAppliedFilters);

    const studentTableFilteredData = isAssessment
        ? {
              ...studentTableData,
              content:
                  studentTableData?.content
                      ?.filter((item) => item.status === 'ACTIVE') // Filter for "ACTIVE" status
                      .map((item) => ({
                          id: item.id,
                          user_id: item.user_id,
                          full_name: item.full_name,
                          package_session_id: item.package_session_id,
                          institute_enrollment_id: item.institute_enrollment_id,
                          linked_institute_name: item.linked_institute_name,
                          gender: item.gender,
                          mobile_number: item.mobile_number,
                          email: item.email,
                          city: item.city,
                          state: item.region,
                      })) || [],
          }
        : studentTableData;

    const [allPagesData, setAllPagesData] = useState<Record<number, StudentTable[]>>({});
    const [rowSelections, setRowSelections] = useState<Record<number, Record<string, boolean>>>({});

    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updaterOrValue) => {
        // Get current page data
        const currentPageData = studentTableFilteredData?.content || [];

        // If we receive a function updater
        if (typeof updaterOrValue === 'function') {
            setRowSelections((prev) => {
                // Get current page selections
                const currentPageSelections = prev[page] || {};
                // Call the updater function with current selections
                const newIndexSelections = updaterOrValue(currentPageSelections);

                // Map row indexes to user_ids
                const newUserIdSelections: Record<string, boolean> = {};

                // Convert index-based selection to user_id-based selection
                Object.entries(newIndexSelections).forEach(([index, isSelected]) => {
                    const rowIndex = parseInt(index);
                    const student = currentPageData[rowIndex];
                    if (student && student.user_id) {
                        newUserIdSelections[student.user_id] = isSelected;
                    }
                });

                return {
                    ...prev,
                    [page]: newUserIdSelections,
                };
            });
        } else {
            // If we receive a direct value (object)
            const newIndexSelections = updaterOrValue;
            const newUserIdSelections: Record<string, boolean> = {};

            // Convert index-based selection to user_id-based selection
            Object.entries(newIndexSelections).forEach(([index, isSelected]) => {
                const rowIndex = parseInt(index);
                const student = currentPageData[rowIndex];
                if (student && student.user_id) {
                    newUserIdSelections[student.user_id] = isSelected;
                }
            });

            setRowSelections((prev) => ({
                ...prev,
                [page]: newUserIdSelections,
            }));
        }
    };

    const handleResetSelections = () => {
        setRowSelections({});
    };

    const mapSelectionsToRowIndices = (): RowSelectionState => {
        const currentPageData = studentTableFilteredData?.content || [];
        const currentPageUserIdSelections = rowSelections[page] || {};
        const indexBasedSelections: RowSelectionState = {};

        // Map user_id selections back to row indexes for the table
        currentPageData.forEach((student, index) => {
            if (student.user_id && currentPageUserIdSelections[student.user_id]) {
                indexBasedSelections[index] = true;
            }
        });

        return indexBasedSelections;
    };

    const getSelectedStudents = (): StudentTable[] => {
        return Object.entries(rowSelections).flatMap(([pageNum, selections]) => {
            const pageData = allPagesData[parseInt(pageNum)];

            if (!pageData) return [];
            const selectedStudents = Object.entries(selections).filter(
                ([, isSelected]) => isSelected
            );

            const filteredStudents = pageData.filter((student) =>
                selectedStudents.some(([id]) => id === student.user_id)
            );

            return filteredStudents;
        });
    };

    const getSelectedStudentIds = (): string[] => {
        // Setting the selected student details
        setValue(
            'select_individually.student_details',
            getSelectedStudents().map((student) => ({
                username: student.username || '',
                user_id: student.user_id,
                email: student.email,
                full_name: student.full_name,
                mobile_number: student.mobile_number,
                guardian_email: student.parents_email,
                guardian_mobile_number: student.parents_mobile_number,
                file_id: '',
                reattempt_count: 0,
            }))
        );

        // Returning the IDs of the selected students
        return getSelectedStudents().map((student) => student.user_id);
    };

    const totalSelectedCount = Object.values(rowSelections).reduce(
        (count, pageSelection) => count + Object.keys(pageSelection).length,
        0
    );

    useEffect(() => {
        if (studentTableData?.content) {
            setAllPagesData((prev) => ({
                ...prev,
                [page]: studentTableData.content,
            }));
        }
    }, [studentTableData?.content, page]);

    useEffect(() => {
        if (preExistingStudentIds.length > 0 && studentTableData?.content) {
            // Create a new selections object based on pre-existing IDs
            const initialSelections: Record<number, Record<string, boolean>> = {};

            // First, initialize current page
            const currentPageData = studentTableFilteredData?.content || [];
            const currentPageSelections: Record<string, boolean> = {};

            currentPageData.forEach((student) => {
                if (student.user_id && preExistingStudentIds.includes(student.user_id)) {
                    currentPageSelections[student.user_id] = true;
                }
            });

            if (Object.keys(currentPageSelections).length > 0) {
                initialSelections[page] = currentPageSelections;
            }

            // Update with initial selections for current page
            setRowSelections((prev) => ({
                ...prev,
                ...initialSelections,
            }));
        }
    }, [studentTableData?.content, page]);

    if (isLoading) return <DashboardLoader />;
    if (isError) return <SmartErrorPage />;

    return (
        <section className="flex max-w-full flex-col gap-8 overflow-visible">
            <div className="flex flex-col gap-5">
                {!isAssessment && <StudentListHeader />}
                <StudentFilters
                    currentSession={currentSession} // Now this will work
                    sessions={sessions}
                    filters={filters}
                    searchInput={searchInput}
                    searchFilter={searchFilter}
                    columnFilters={columnFilters}
                    clearFilters={clearFilters}
                    getActiveFiltersState={getActiveFiltersState}
                    onSessionChange={handleSessionChange}
                    onSearchChange={handleSearchInputChange}
                    onSearchEnter={handleSearchEnter}
                    onClearSearch={handleClearSearch}
                    onFilterChange={handleFilterChange}
                    onFilterClick={handleFilterClick}
                    onClearFilters={handleClearFilters}
                    appliedFilters={appliedFilters}
                    page={page}
                    pageSize={10}
                    isAssessment={isAssessment}
                    sessionList={sessionList}
                />
                <div className="max-w-full">
                    <MyTable<StudentTable>
                        data={studentTableFilteredData as TableData<StudentTable>}
                        columns={isAssessment ? myAssessmentColumns : myColumns}
                        isLoading={loadingData}
                        error={loadingError}
                        onSort={handleSort}
                        columnWidths={
                            isAssessment
                                ? STUDENT_LIST_ASSESSMENT_COLUMN_WIDTHS
                                : STUDENT_LIST_COLUMN_WIDTHS
                        }
                        rowSelection={mapSelectionsToRowIndices()}
                        onRowSelectionChange={handleRowSelectionChange}
                        currentPage={page}
                    />
                </div>
                <div className="flex">
                    <BulkActions
                        selectedCount={totalSelectedCount}
                        selectedStudentIds={getSelectedStudentIds()}
                        selectedStudents={getSelectedStudents()}
                        onReset={handleResetSelections}
                        isAssessment={isAssessment}
                    />
                    <MyPagination
                        currentPage={page}
                        totalPages={studentTableData?.total_pages || 1}
                        onPageChange={handlePageChange}
                    />
                </div>
            </div>
        </section>
    );
};
