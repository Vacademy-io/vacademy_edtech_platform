import { LIVE_SESSION_ALL_ATTENDANCE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useInfiniteQuery } from '@tanstack/react-query';

interface AttendanceFilterRequest {
    institute_id: string;
    name: string;
    start_date: string;
    end_date: string;
    batch_ids: string[] | null;
    live_session_ids: string[] | null;
}

interface AttendanceRequestParamType {
    pageNo: number;
    pageSize: number;
    filterRequest: AttendanceFilterRequest;
}

export interface SessionType {
    scheduleId: string;
    sessionId: string;
    title: string;
    meetingDate: string;
    startTime: string;
    lastEntryTime: string;
    attendanceStatus: string | null;
    attendanceDetails: string | null;
    attendanceTimestamp: string | null;
    durationMinutes: number | null;
}

export interface ContentType {
    attendancePercentage: number;
    fullName: string;
    attendanceDetails: string | null;
    attendanceTimestamp: string | null;
    attendanceStatus: string | null;
    dateOfBirth: string | null;
    mobileNumber: string;
    email: string;
    enrollmentStatus: string;
    gender: string;
    studentId: string;
    instituteEnrollmentNumber: string;
    sessions: SessionType[];
    packageSessionId?: string;
}

export interface AttendanceResponseType {
    content: ContentType[];
    totalPages: number;
    totalElements: number;
    pageable: {
        pageNumber: number;
        pageSize: number;
        paged: boolean;
        unpaged: boolean;
        offset: number;
        sort: {
            unsorted: boolean;
            sorted: boolean;
            empty: boolean;
        };
    };
    numberOfElements: number;
    size: number;
    number: number;
    sort: {
        unsorted: boolean;
        sorted: boolean;
        empty: boolean;
    };
    first: boolean;
    last: boolean;
    empty: boolean;
}

export const useGetAttendance = ({
    pageNo,
    pageSize,
    filterRequest,
}: AttendanceRequestParamType) => {
    return useInfiniteQuery<AttendanceResponseType | null>({
        // The API rejects a missing institute_id (it is what scopes the report to one
        // institute), so don't fire until the token has resolved one.
        enabled: !!filterRequest.institute_id,
        queryKey: ['attendanceList', pageNo, pageSize, filterRequest],
        queryFn: async ({ pageParam }) => {
            const response = await authenticatedAxiosInstance.post(
                `${LIVE_SESSION_ALL_ATTENDANCE}?page=${pageParam}&size=${pageSize}`,
                filterRequest
            );
            return response.data;
        },
        initialPageParam: pageNo,
        getNextPageParam: (lastPage) => {
            // If lastPage is null or undefined, or if we're on the last page or there's no content, don't get another page
            if (!lastPage || lastPage.last || lastPage.empty) return undefined;

            // Return the next page number, with a fallback to current page + 1 if pageable structure is missing
            return lastPage.pageable?.pageNumber !== undefined
                ? lastPage.pageable.pageNumber + 1
                : pageNo + 1;
        },
    });
};
