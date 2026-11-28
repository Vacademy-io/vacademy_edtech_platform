import axios from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    CREATE_TIMELINE_EVENT,
    GET_CROSS_STAGE_TIMELINE,
    GET_STUDENTS,
    MEETINGS_BY_LEAD,
    MENTORSHIP_ASSIGNMENTS,
    MENTORSHIP_ASSIGNMENTS_BULK,
    MENTORSHIP_ASSIGNMENT_BY_ID,
    MENTORSHIP_DASHBOARD,
    MENTORSHIP_MENTORS,
    MENTORSHIP_MENTOR_BOOKING_PAGE,
    MEETINGS_MY_CALENDAR,
    MENTORSHIP_MENTOR_BY_ID,
    MENTORSHIP_MY_BOOKING_PAGE,
    MENTORSHIP_MY_GOOGLE_INITIATE,
    MENTORSHIP_MY_MENTEES,
    MENTORSHIP_MY_MENTOR_PROFILE,
    MENTORSHIP_REQUESTS,
    MENTORSHIP_REQUEST_APPROVE,
    MENTORSHIP_REQUEST_DECLINE,
    MENTORSHIP_MENTOR_FEEDBACK,
    MENTORSHIP_SESSIONS,
    MENTORSHIP_MY_SESSIONS_AWAITING,
    MENTORSHIP_MY_SESSION_RECORD,
    MENTORSHIP_SESSION_CANCEL,
    MENTORSHIP_SESSION_RESCHEDULE,
    MENTORSHIP_MY_SESSION_CANCEL,
    MENTORSHIP_MY_SESSION_RESCHEDULE,
    MENTORSHIP_MENTOR_MENTEES,
    MENTORSHIP_MENTOR_AVAILABILITY,
    MENTORSHIP_SESSION_SCHEDULE,
    MENTORSHIP_MY_SESSION_SCHEDULE,
    OPEN_BOOKING_SLOTS,
} from '@/constants/urls';
import type {
    AssignMentorRequest,
    AssignmentResult,
    BookingInstance,
    BulkRoundRobinRequest,
    CreateMentorRequest,
    CreateNoteRequest,
    MenteeDTO,
    MentorAvailabilityRequest,
    MentorBookingPage,
    MentorDTO,
    MentorDashboard,
    MentorFeedbackDTO,
    MentorRequestDTO,
    MentorSessionDTO,
    BookingSlots,
    ScheduleSessionRequest,
    RecordSessionRequest,
    MentorRequestDecision,
    PageResponse,
    StudentRow,
    TimelineEvent,
    UpdateMentorRequest,
} from '../-types/mentorship-types';
import { normalizePage } from '../-utils/page-response';

export const fetchMentors = async (instituteId: string): Promise<MentorDTO[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MENTORS,
        params: { instituteId },
    });
    return res.data as MentorDTO[];
};

export const fetchMentorsPaged = async (
    instituteId: string,
    pageNo: number,
    pageSize: number
): Promise<PageResponse<MentorDTO>> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MENTORS,
        params: { instituteId, pageNo, pageSize },
    });
    return normalizePage<MentorDTO>(res.data);
};

export const fetchDashboard = async (instituteId: string): Promise<MentorDashboard> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_DASHBOARD,
        params: { instituteId },
    });
    return res.data as MentorDashboard;
};

export const createMentor = async (data: CreateMentorRequest): Promise<MentorDTO> => {
    const res = await authenticatedAxiosInstance({ method: 'POST', url: MENTORSHIP_MENTORS, data });
    return res.data as MentorDTO;
};

export const updateMentor = async (
    id: string,
    instituteId: string,
    data: UpdateMentorRequest
): Promise<MentorDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'PUT',
        url: MENTORSHIP_MENTOR_BY_ID(id),
        params: { instituteId },
        data,
    });
    return res.data as MentorDTO;
};

export const deleteMentor = async (id: string, instituteId: string): Promise<string> => {
    const res = await authenticatedAxiosInstance({
        method: 'DELETE',
        url: MENTORSHIP_MENTOR_BY_ID(id),
        params: { instituteId },
    });
    return res.data as string;
};

export const assignMentees = async (data: AssignMentorRequest): Promise<AssignmentResult> => {
    const res = await authenticatedAxiosInstance({ method: 'POST', url: MENTORSHIP_ASSIGNMENTS, data });
    return res.data as AssignmentResult;
};

export const bulkRoundRobin = async (data: BulkRoundRobinRequest): Promise<AssignmentResult> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_ASSIGNMENTS_BULK,
        data,
    });
    return res.data as AssignmentResult;
};

export const unassignMentee = async (id: string, instituteId: string): Promise<string> => {
    const res = await authenticatedAxiosInstance({
        method: 'DELETE',
        url: MENTORSHIP_ASSIGNMENT_BY_ID(id),
        params: { instituteId },
    });
    return res.data as string;
};

export const provisionMentorBookingPage = async (
    id: string,
    instituteId: string
): Promise<MentorDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_MENTOR_BOOKING_PAGE(id),
        params: { instituteId },
    });
    return res.data as MentorDTO;
};

/**
 * The admin review queue for learner mentor requests. Defaults to PENDING;
 * pass a status for the decided history.
 */
export const fetchMentorRequests = async (
    instituteId: string,
    status: string,
    pageNo: number,
    pageSize: number
): Promise<PageResponse<MentorRequestDTO>> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_REQUESTS,
        params: { instituteId, status, pageNo, pageSize },
    });
    return normalizePage<MentorRequestDTO>(res.data);
};

/** Approve a request — creates the mentor↔student assignment server-side. */
export const approveMentorRequest = async (
    id: string,
    instituteId: string,
    decision?: MentorRequestDecision
): Promise<MentorRequestDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_REQUEST_APPROVE(id),
        params: { instituteId },
        data: decision ?? {},
    });
    return res.data as MentorRequestDTO;
};

/** Decline a request, optionally with a reason the learner sees. */
export const declineMentorRequest = async (
    id: string,
    instituteId: string,
    decision?: MentorRequestDecision
): Promise<MentorRequestDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_REQUEST_DECLINE(id),
        params: { instituteId },
        data: decision ?? {},
    });
    return res.data as MentorRequestDTO;
};

/** One mentor's session ratings, newest first. The average itself rides on the mentor DTO. */
export const fetchMentorFeedback = async (
    id: string,
    instituteId: string
): Promise<MentorFeedbackDTO[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MENTOR_FEEDBACK(id),
        params: { instituteId },
    });
    return (res.data ?? []) as MentorFeedbackDTO[];
};

/**
 * Mentorship sessions for the admin session view. Optionally narrowed to one
 * mentor, one learner, or one lifecycle state.
 */
export const fetchMentorSessions = async (params: {
    instituteId: string;
    mentorId?: string;
    studentUserId?: string;
    lifecycle?: string;
    historyDays?: number;
}): Promise<MentorSessionDTO[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_SESSIONS,
        params: {
            instituteId: params.instituteId,
            ...(params.mentorId ? { mentorId: params.mentorId } : {}),
            ...(params.studentUserId ? { studentUserId: params.studentUserId } : {}),
            ...(params.lifecycle ? { lifecycle: params.lifecycle } : {}),
            ...(params.historyDays ? { historyDays: params.historyDays } : {}),
        },
    });
    return (res.data ?? []) as MentorSessionDTO[];
};

/** Sessions the calling mentor still has to record an outcome for. */
export const fetchMyAwaitingReview = async (instituteId: string): Promise<MentorSessionDTO[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MY_SESSIONS_AWAITING,
        params: { instituteId },
    });
    return (res.data ?? []) as MentorSessionDTO[];
};

/** The mentor records what happened in a session. */
export const recordSession = async (
    instituteId: string,
    data: RecordSessionRequest
): Promise<MentorSessionDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_MY_SESSION_RECORD,
        params: { instituteId },
        data,
    });
    return res.data as MentorSessionDTO;
};

/**
 * Cancel a mentorship session. `asAdmin` picks the endpoint: admins may cancel any
 * session in the institute, a mentor only their own — the server enforces both.
 */
export const cancelMentorSession = async (
    instituteId: string,
    bookingInstanceId: string,
    reason?: string,
    asAdmin = true
): Promise<MentorSessionDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: asAdmin ? MENTORSHIP_SESSION_CANCEL : MENTORSHIP_MY_SESSION_CANCEL,
        params: { instituteId },
        data: { booking_instance_id: bookingInstanceId, reason },
    });
    return res.data as MentorSessionDTO;
};

/** Move a session to a new time. Returns the REPLACEMENT booking, not the retired one. */
export const rescheduleMentorSession = async (
    instituteId: string,
    bookingInstanceId: string,
    startTime: string,
    inviteeTimezone?: string,
    asAdmin = true
): Promise<MentorSessionDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: asAdmin ? MENTORSHIP_SESSION_RESCHEDULE : MENTORSHIP_MY_SESSION_RESCHEDULE,
        params: { instituteId },
        data: {
            booking_instance_id: bookingInstanceId,
            start_time: startTime,
            invitee_timezone: inviteeTimezone,
        },
    });
    return res.data as MentorSessionDTO;
};

/** One mentor's assigned students, for the admin mentor detail view. */
export const fetchMentorMentees = async (
    id: string,
    instituteId: string
): Promise<MenteeDTO[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MENTOR_MENTEES(id),
        params: { instituteId },
    });
    return (res.data ?? []) as MenteeDTO[];
};

/** One mentor's bookable availability, read-only for admins. */
export const fetchMentorAvailability = async (
    id: string,
    instituteId: string
): Promise<MentorBookingPage> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MENTOR_AVAILABILITY(id),
        params: { instituteId },
    });
    return res.data as MentorBookingPage;
};

/** The caller's own mentor profile (incl. Google-connected status). */
export const fetchMyMentorProfile = async (instituteId: string): Promise<MentorDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MY_MENTOR_PROFILE,
        params: { instituteId },
    });
    return res.data as MentorDTO;
};

/** Start the mentor's own Google connect — returns the consent URL to redirect to. */
export const initiateMyGoogle = async (
    instituteId: string
): Promise<{ oauth_url: string; session_key: string }> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_MY_GOOGLE_INITIATE,
        params: { instituteId },
    });
    return res.data as { oauth_url: string; session_key: string };
};

/** The caller's own booking page (availability, duration, buffers) — auto-provisions if missing. */
export const fetchMyBookingPage = async (instituteId: string): Promise<MentorBookingPage> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MY_BOOKING_PAGE,
        params: { instituteId },
    });
    return res.data as MentorBookingPage;
};

/** Mentor updates their own availability / duration / buffers. */
export const updateMyBookingPage = async (
    instituteId: string,
    data: MentorAvailabilityRequest
): Promise<MentorBookingPage> => {
    const res = await authenticatedAxiosInstance({
        method: 'PUT',
        url: MENTORSHIP_MY_BOOKING_PAGE,
        params: { instituteId },
        data,
    });
    return res.data as MentorBookingPage;
};

/**
 * The mentor's own sessions (as host) in [startDate, endDate] (yyyy-MM-dd). Reuses
 * the meetings /my-calendar endpoint — a mentor IS the host on their booking page.
 */
export const fetchMySchedule = async (
    instituteId: string,
    startDate: string,
    endDate: string
): Promise<BookingInstance[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_MY_CALENDAR,
        params: { instituteId, startDate, endDate },
    });
    return (res.data as BookingInstance[]) ?? [];
};

export const fetchMyMentees = async (instituteId: string): Promise<MenteeDTO[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MY_MENTEES,
        params: { instituteId },
    });
    return res.data as MenteeDTO[];
};

export const fetchMyMenteesPaged = async (
    instituteId: string,
    pageNo: number,
    pageSize: number
): Promise<PageResponse<MenteeDTO>> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MENTORSHIP_MY_MENTEES,
        params: { instituteId, pageNo, pageSize },
    });
    return normalizePage<MenteeDTO>(res.data);
};

/** A mentee's notes/activity from the shared timeline system (pinned first). */
export const fetchStudentTimeline = async (studentUserId: string): Promise<TimelineEvent[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${GET_CROSS_STAGE_TIMELINE}/${studentUserId}`,
        params: { page: 0, size: 20 },
    });
    return (res.data?.content ?? []) as TimelineEvent[];
};

/** Add a mentorship note against a mentee (writes to timeline_event, category ACTIVITY). */
export const createMentorNote = async (req: CreateNoteRequest): Promise<TimelineEvent> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: CREATE_TIMELINE_EVENT,
        data: {
            type: 'MENTORSHIP',
            type_id: req.studentUserId,
            action_type: 'NOTE',
            title: req.title,
            description: req.description,
            student_user_id: req.studentUserId,
            category: 'ACTIVITY',
        },
    });
    return res.data as TimelineEvent;
};

/** A mentee's scheduled calls (booking instances matched by invitee user id). */
export const fetchMenteeCalls = async (
    instituteId: string,
    studentUserId: string
): Promise<BookingInstance[]> => {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: MEETINGS_BY_LEAD,
        params: { instituteId, inviteeUserId: studentUserId },
    });
    return (res.data ?? []) as BookingInstance[];
};

/**
 * Enrolled-student search for the mentee picker — reuses the learner-list
 * filter-search endpoint (ACTIVE students, scoped to the institute).
 *
 * `packageSessionIds` narrows to specific batches. An empty array is sent as
 * omitted rather than as `[]`, because the backend treats an empty list the same
 * as "no filter" on some paths and as "match nothing" on others.
 */
export const searchStudents = async (params: {
    instituteId: string;
    name: string;
    packageSessionIds?: string[];
    pageNo?: number;
    pageSize?: number;
}): Promise<PageResponse<StudentRow>> => {
    const { instituteId, name, packageSessionIds, pageNo = 0, pageSize = 15 } = params;
    const res = await authenticatedAxiosInstance.post(
        `${GET_STUDENTS}?pageNo=${pageNo}&pageSize=${pageSize}`,
        {
            name,
            statuses: ['ACTIVE'],
            institute_ids: [instituteId],
            ...(packageSessionIds?.length ? { package_session_ids: packageSessionIds } : {}),
        }
    );
    return normalizePage<StudentRow>(res.data);
};

/**
 * Every student matching the picker's current filter, for "select all".
 *
 * Swept page by page rather than asked for in one huge page: the learner list
 * endpoint builds a heavy per-row projection, and a 1,000-row page of it is a
 * request that times out under load. `limit` stops the sweep so a mis-click on an
 * unfiltered institute can't pull the whole roster into a single assignment.
 */
export const fetchAllMatchingStudents = async (params: {
    instituteId: string;
    name: string;
    packageSessionIds?: string[];
    limit: number;
    pageSize?: number;
}): Promise<StudentRow[]> => {
    const { instituteId, name, packageSessionIds, limit, pageSize = 200 } = params;
    const collected: StudentRow[] = [];
    for (let pageNo = 0; collected.length < limit; pageNo++) {
        const page = await searchStudents({
            instituteId,
            name,
            packageSessionIds,
            pageNo,
            pageSize,
        });
        collected.push(...page.content);
        const noMorePages = page.last === true || pageNo + 1 >= page.total_pages;
        if (page.content.length === 0 || noMorePages) break;
    }
    return collected.slice(0, limit);
};

/**
 * Free slots on a mentor's booking page.
 *
 * Read through the PUBLIC booking endpoint on purpose: it is the same availability the
 * learner's own booking page shows, so an admin can never place a session somewhere a
 * learner couldn't have booked it themselves. It takes no auth, so plain axios is used —
 * the authenticated instance would attach a token the endpoint has no use for.
 */
export const fetchMentorSlots = async (params: {
    instituteId: string;
    slug: string;
    from: string;
    to: string;
    tz: string;
    duration?: number;
}): Promise<BookingSlots> => {
    const { instituteId, slug, from, to, tz, duration } = params;
    const res = await axios({
        method: 'GET',
        url: OPEN_BOOKING_SLOTS(instituteId, slug),
        params: { from, to, tz, ...(duration ? { duration } : {}) },
    });
    return (res.data ?? { slots: [] }) as BookingSlots;
};

/** Admin books a 1:1 between a mentor and a learner. */
export const scheduleSession = async (
    instituteId: string,
    data: ScheduleSessionRequest
): Promise<MentorSessionDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_SESSION_SCHEDULE,
        params: { instituteId },
        data,
    });
    return res.data as MentorSessionDTO;
};

/** A mentor books a 1:1 with one of their own mentees. */
export const scheduleMySession = async (
    instituteId: string,
    data: ScheduleSessionRequest
): Promise<MentorSessionDTO> => {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: MENTORSHIP_MY_SESSION_SCHEDULE,
        params: { instituteId },
        data,
    });
    return res.data as MentorSessionDTO;
};
