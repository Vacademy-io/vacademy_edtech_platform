import {
    MEETINGS_BOOK,
    MEETINGS_BOOKING_PAGE_BY_ID,
    MEETINGS_BOOKING_PAGE_CREATE,
    MEETINGS_BOOKING_PAGES_LIST,
    MEETINGS_BY_LEAD,
    MEETINGS_MY_CALENDAR,
    MEETINGS_MY_GOOGLE,
    MEETINGS_MY_GOOGLE_INITIATE,
    MEETINGS_SCOPE,
    MEETINGS_TEAM_CALENDAR,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    BookingInstanceDTO,
    BookingPageDTO,
    BookingsByLeadFilters,
    CreateMeetingBookingRequest,
    MeetingsScope,
} from '../-types/meetings-types';

export const createBookingPage = async (data: BookingPageDTO) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: MEETINGS_BOOKING_PAGE_CREATE,
        data,
    });
    return response.data as BookingPageDTO;
};

export const updateBookingPage = async (
    id: string,
    instituteId: string,
    data: Partial<BookingPageDTO>
) => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: MEETINGS_BOOKING_PAGE_BY_ID(id),
        params: { instituteId },
        data,
    });
    return response.data as BookingPageDTO;
};

export const fetchBookingPage = async (id: string, instituteId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_BOOKING_PAGE_BY_ID(id),
        params: { instituteId },
    });
    return response.data as BookingPageDTO;
};

export const fetchBookingPages = async (params: {
    instituteId: string;
    audienceId?: string;
    hostUserId?: string;
}) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_BOOKING_PAGES_LIST,
        params: {
            instituteId: params.instituteId,
            audienceId: params.audienceId,
            hostUserId: params.hostUserId,
        },
    });
    return response.data as BookingPageDTO[];
};

export const deleteBookingPage = async (id: string, instituteId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'DELETE',
        url: MEETINGS_BOOKING_PAGE_BY_ID(id),
        params: { instituteId },
    });
    return response.data;
};

export const createMeetingBooking = async (data: CreateMeetingBookingRequest) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: MEETINGS_BOOK,
        data,
    });
    return response.data as BookingInstanceDTO;
};

export const fetchMyCalendar = async (params: {
    instituteId: string;
    startDate: string;
    endDate: string;
}) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_MY_CALENDAR,
        params,
    });
    return response.data as BookingInstanceDTO[];
};

export const fetchTeamCalendar = async (params: {
    instituteId: string;
    startDate: string;
    endDate: string;
}) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_TEAM_CALENDAR,
        params,
    });
    return response.data as BookingInstanceDTO[];
};

/** Meetings linked to a CRM lead — at least one filter identifier should be sent. */
export const fetchBookingsByLead = async (instituteId: string, filters: BookingsByLeadFilters) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_BY_LEAD,
        params: {
            instituteId,
            audienceResponseId: filters.audienceResponseId,
            inviteeUserId: filters.inviteeUserId,
            inviteeEmail: filters.inviteeEmail,
        },
    });
    return response.data as BookingInstanceDTO[];
};

export const fetchMeetingsScope = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_SCOPE,
        params: { instituteId },
    });
    return response.data as MeetingsScope;
};

export interface MyGoogleStatus {
    connected: boolean;
    email?: string | null;
    /** ACTIVE | RECONNECT_NEEDED */
    status?: string | null;
}

/** The caller's own Google connection — each host sees and uses only their own calendar. */
export const getMyGoogle = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_MY_GOOGLE,
        params: { instituteId },
    });
    return response.data as MyGoogleStatus;
};

/** Returns the Google consent URL; the callback lands back on My Schedule. */
export const initiateMyGoogle = async (instituteId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: MEETINGS_MY_GOOGLE_INITIATE,
        params: { instituteId },
    });
    return response.data as { oauth_url: string; session_key: string };
};

export const disconnectMyGoogle = async (instituteId: string) => {
    await authenticatedAxiosInstance({
        method: 'DELETE',
        url: MEETINGS_MY_GOOGLE,
        params: { instituteId },
    });
};
