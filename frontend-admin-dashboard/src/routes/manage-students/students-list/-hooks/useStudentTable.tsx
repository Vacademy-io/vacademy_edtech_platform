import { useState, useEffect, useCallback } from 'react';
import { StudentFilterRequest, StudentTable } from '@/types/student-table-types';
import {
    fetchStudents,
    useStudentList,
} from '@/routes/manage-students/students-list/-services/getStudentTable';
import { useStudentSidebar } from '../-context/selected-student-sidebar-context';

export const useStudentTable = (
    appliedFilters: StudentFilterRequest,
    onFiltersUpdate: (newFilters: StudentFilterRequest) => void,
    package_session_id?: string[] | null
) => {
    // The page is remembered together with the filters it was picked for. When a search,
    // filter, sort or session change produces a different filter set, the page falls back
    // to 0 in the same render -- otherwise searching from page 3 asked the backend for
    // page 3 of the search results, which is usually empty.
    const [pageState, setPageState] = useState<{ filtersKey: string; page: number }>({
        filtersKey: '',
        page: 0,
    });
    const pageSize = 10;
    const [sortColumns, setSortColumns] = useState<Record<string, string>>({});
    const { selectedStudent, setSelectedStudent, setLearnerList } = useStudentSidebar();

    let localAppliedFilters = appliedFilters;

    // If the URL pinned a specific package_session_id, honour it. Otherwise leave
    // package_session_ids empty — the backend's combined query returns institute users
    // + audience-only respondents by default, and a synthetic all-batches filter would
    // gate audience-only users out.
    if (
        appliedFilters.package_session_ids?.length == 0 &&
        package_session_id &&
        package_session_id.length > 0
    ) {
        localAppliedFilters = {
            ...appliedFilters,
            package_session_ids: package_session_id,
        };
    }

    const filtersKey = JSON.stringify(localAppliedFilters);
    const page = pageState.filtersKey === filtersKey ? pageState.page : 0;

    const {
        data: studentTableData,
        isLoading,
        error,
        refetch,
    } = useStudentList(localAppliedFilters, page, pageSize);

    // Update selected student when data changes
    useEffect(() => {
        if (selectedStudent && studentTableData?.content) {
            const student = studentTableData.content.find(
                (student) => student.user_id === selectedStudent.user_id
            );
            if (student) {
                setSelectedStudent(student);
            }
        }
    }, [studentTableData?.content]);

    // Publish the current page's learners to the sidebar context so the
    // fullscreen overlay's Prev/Next chevron group can walk across them
    // without closing.
    useEffect(() => {
        setLearnerList(studentTableData?.content ?? []);
    }, [studentTableData?.content, setLearnerList]);

    // NOTE: We removed the useEffect that called refetch() on filter changes
    // React Query's queryKey already handles this - when the key changes, 
    // it automatically fetches new data. The extra refetch() was causing duplicate API calls.

    const handleSort = async (columnId: string, direction: string) => {
        const newSortColumns = {
            [columnId]: direction,
        };
        setSortColumns(newSortColumns);
        onFiltersUpdate({
            ...appliedFilters,
            sort_columns: newSortColumns,
        });
    };

    const handlePageChange = async (newPage: number) => {
        setPageState({ filtersKey, page: newPage });
        // No need to call refetch() - changing page will change the queryKey
        // which automatically triggers a new fetch
    };

    const totalElements = studentTableData?.total_elements ?? 0;

    /**
     * Every learner matching the current filters, in one request — what "Select all" needs.
     * Lives here rather than at the call site so it uses exactly the filters the table is showing
     * (including the pinned package_session_id), and can never drift from them.
     */
    const fetchAllMatching = useCallback(async (): Promise<StudentTable[]> => {
        if (!totalElements) return [];
        const response = await fetchStudents({
            pageNo: 0,
            pageSize: totalElements,
            filters: localAppliedFilters,
        });
        return response.content ?? [];
        // localAppliedFilters is derived from appliedFilters each render; depending on the
        // serialised form keeps this stable without re-creating on every unrelated render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [totalElements, filtersKey]);

    return {
        studentTableData,
        isLoading,
        error,
        page,
        sortColumns,
        refetch,
        handleSort,
        handlePageChange,
        totalElements,
        fetchAllMatching,
    };
};
