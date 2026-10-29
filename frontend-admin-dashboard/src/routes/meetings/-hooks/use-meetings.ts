import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    createBookingPage,
    createMeetingBooking,
    deleteBookingPage,
    disconnectMyGoogle,
    fetchBookingPages,
    fetchBookingsByLead,
    fetchMeetingsScope,
    fetchMyCalendar,
    fetchTeamCalendar,
    getMyGoogle,
    updateBookingPage,
} from '../-services/meetings-services';
import {
    BookingPageDTO,
    BookingsByLeadFilters,
    CreateMeetingBookingRequest,
} from '../-types/meetings-types';

// Query keys — kept flat so mutations can invalidate whole families.
export const MEETINGS_KEYS = {
    myCalendar: 'meetings-my-calendar',
    teamCalendar: 'meetings-team-calendar',
    scope: 'meetings-scope',
    bookingPages: 'meetings-booking-pages',
    byLead: 'meetings-by-lead',
    myGoogle: 'meetings-my-google',
} as const;

export const useMyCalendar = (
    instituteId: string | undefined,
    startDate: string,
    endDate: string
) =>
    useQuery({
        queryKey: [MEETINGS_KEYS.myCalendar, instituteId, startDate, endDate],
        queryFn: () => fetchMyCalendar({ instituteId: instituteId ?? '', startDate, endDate }),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useTeamCalendar = (
    instituteId: string | undefined,
    startDate: string,
    endDate: string,
    enabled: boolean = true
) =>
    useQuery({
        queryKey: [MEETINGS_KEYS.teamCalendar, instituteId, startDate, endDate],
        queryFn: () => fetchTeamCalendar({ instituteId: instituteId ?? '', startDate, endDate }),
        enabled: !!instituteId && enabled,
        staleTime: 30 * 1000,
    });

export const useMeetingsScope = (instituteId: string | undefined) =>
    useQuery({
        queryKey: [MEETINGS_KEYS.scope, instituteId],
        queryFn: () => fetchMeetingsScope(instituteId ?? ''),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

export const useBookingPages = (params: {
    instituteId: string | undefined;
    audienceId?: string;
    hostUserId?: string;
    enabled?: boolean;
}) =>
    useQuery({
        queryKey: [
            MEETINGS_KEYS.bookingPages,
            params.instituteId,
            params.audienceId ?? null,
            params.hostUserId ?? null,
        ],
        queryFn: () =>
            fetchBookingPages({
                instituteId: params.instituteId ?? '',
                audienceId: params.audienceId,
                hostUserId: params.hostUserId,
            }),
        enabled: !!params.instituteId && (params.enabled ?? true),
    });

/** Meetings linked to a CRM lead. Disabled until we have an institute + at least one identifier. */
export const useBookingsByLead = (
    instituteId: string | undefined,
    filters: BookingsByLeadFilters
) =>
    useQuery({
        queryKey: [
            MEETINGS_KEYS.byLead,
            instituteId,
            filters.audienceResponseId ?? null,
            filters.inviteeUserId ?? null,
            filters.inviteeEmail ?? null,
        ],
        queryFn: () => fetchBookingsByLead(instituteId ?? '', filters),
        enabled:
            !!instituteId &&
            !!(filters.audienceResponseId || filters.inviteeUserId || filters.inviteeEmail),
        staleTime: 30 * 1000,
    });

const useInvalidateBookingPages = () => {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: [MEETINGS_KEYS.bookingPages] });
};

export const useCreateBookingPage = () => {
    const invalidate = useInvalidateBookingPages();
    return useMutation({
        mutationFn: (data: BookingPageDTO) => createBookingPage(data),
        onSuccess: invalidate,
    });
};

export const useUpdateBookingPage = () => {
    const invalidate = useInvalidateBookingPages();
    return useMutation({
        mutationFn: ({
            id,
            instituteId,
            data,
        }: {
            id: string;
            instituteId: string;
            data: Partial<BookingPageDTO>;
        }) => updateBookingPage(id, instituteId, data),
        onSuccess: invalidate,
    });
};

export const useDeleteBookingPage = () => {
    const invalidate = useInvalidateBookingPages();
    return useMutation({
        mutationFn: ({ id, instituteId }: { id: string; instituteId: string }) =>
            deleteBookingPage(id, instituteId),
        onSuccess: invalidate,
    });
};

export const useCreateMeetingBooking = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateMeetingBookingRequest) => createMeetingBooking(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MEETINGS_KEYS.myCalendar] });
            queryClient.invalidateQueries({ queryKey: [MEETINGS_KEYS.teamCalendar] });
            queryClient.invalidateQueries({ queryKey: [MEETINGS_KEYS.byLead] });
        },
    });
};

export const useMyGoogle = (instituteId: string | undefined) =>
    useQuery({
        queryKey: [MEETINGS_KEYS.myGoogle, instituteId],
        queryFn: () => getMyGoogle(instituteId as string),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useDisconnectMyGoogle = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (instituteId: string) => disconnectMyGoogle(instituteId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [MEETINGS_KEYS.myGoogle] }),
    });
};
