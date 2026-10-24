import { useQuery } from '@tanstack/react-query';
import { StudentFilterRequest, StudentListResponse } from '@/types/student-table-types';
import { GET_STUDENTS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useMemo } from 'react';

interface FetchStudentsParams {
    pageNo?: number;
    pageSize?: number;
    filters: StudentFilterRequest;
}

export const fetchStudents = async ({
    pageNo = 0,
    pageSize = 10,
    filters,
}: FetchStudentsParams): Promise<StudentListResponse> => {
    const response = await authenticatedAxiosInstance.post<StudentListResponse>(
        `${GET_STUDENTS}?pageNo=${pageNo}&pageSize=${pageSize}`,
        filters
    );
    return response.data;
};

// React Query hook with stabilized query key
export const useStudentList = (
    filters: StudentFilterRequest,
    pageNo?: number,
    pageSize?: number
) => {
    // Stabilize the filters object by creating a consistent string representation
    // This prevents React Query from treating each render's filter object as a new key
    const stableFiltersKey = useMemo(() => {
        return JSON.stringify({
            name: filters.name || '',
            institute_ids: filters.institute_ids?.sort() || [],
            package_session_ids: filters.package_session_ids?.sort() || [],
            destination_package_session_ids: filters.destination_package_session_ids?.sort() || [],
            group_ids: filters.group_ids?.sort() || [],
            gender: filters.gender?.sort() || [],
            statuses: filters.statuses?.sort() || [],
            payment_statuses: filters.payment_statuses?.sort() || [],
            membership_types: filters.membership_types?.sort() || [],
            start_date: filters.start_date || '',
            end_date: filters.end_date || '',
            sort_columns: filters.sort_columns || {},
            session_expiry_days: filters.session_expiry_days?.sort((a, b) => a - b) || [],
            sub_org_user_types: filters.sub_org_user_types?.sort() || [],
            sub_org_ids: filters.sub_org_ids?.sort() || [],
            type: filters.type || '',
            enroll_invite_ids: filters.enroll_invite_ids?.sort() || [],
            audience_ids: filters.audience_ids?.sort() || [],
            // Dropdown custom-field filters — sort both the field-id keys and each
            // field's selected values so the cache key is stable regardless of
            // selection order.
            custom_field_filters: filters.custom_field_filters
                ? Object.keys(filters.custom_field_filters)
                      .sort()
                      .reduce(
                          (obj, key) => {
                              obj[key] = [...(filters.custom_field_filters?.[key] ?? [])].sort();
                              return obj;
                          },
                          {} as Record<string, string[]>
                      )
                : {},
            // Typed (operator-aware) custom-field filters — stable ordering by
            // field, operator, then values.
            custom_field_typed_filters: (filters.custom_field_typed_filters ?? [])
                .map((f) => ({ ...f, values: [...f.values].sort() }))
                .sort((a, b) =>
                    `${a.field_id}:${a.operator ?? 'IN'}`.localeCompare(
                        `${b.field_id}:${b.operator ?? 'IN'}`
                    )
                ),
            // Campaign (UTM) filters — sorted per dimension so selection order
            // never splits the cache.
            utm_filters: filters.utm_filters
                ? Object.fromEntries(
                      Object.entries(filters.utm_filters)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])
                  )
                : undefined,
        });
    }, [filters]);

    return useQuery({
        queryKey: ['students', pageNo, pageSize, stableFiltersKey],
        queryFn: () => fetchStudents({ pageNo, pageSize, filters }),
        // Prevent refetching when window regains focus
        refetchOnWindowFocus: false,
        // Don't refetch when component remounts
        refetchOnMount: false,
        // Keep data fresh for 30 seconds to prevent duplicate fetches
        staleTime: 1000 * 30,
        // Keep data in cache for 5 minutes
        gcTime: 1000 * 60 * 5,
    });
};
