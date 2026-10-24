import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    assignMentees,
    bulkRoundRobin,
    createMentor,
    createMentorNote,
    deleteMentor,
    fetchDashboard,
    fetchMenteeCalls,
    fetchMentors,
    fetchMentorsPaged,
    fetchMyBookingPage,
    fetchMyMentees,
    fetchMyMenteesPaged,
    fetchMyMentorProfile,
    fetchMySchedule,
    fetchStudentTimeline,
    provisionMentorBookingPage,
    unassignMentee,
    updateMentor,
    updateMyBookingPage,
    fetchMentorRequests,
    approveMentorRequest,
    declineMentorRequest,
    fetchMentorFeedback,
    fetchMentorSessions,
    fetchMyAwaitingReview,
    recordSession,
    cancelMentorSession,
    rescheduleMentorSession,
    fetchMentorMentees,
    fetchMentorAvailability,
    fetchMentorSlots,
    scheduleSession,
    scheduleMySession,
} from '../-services/mentorship-service';
import type {
    AssignMentorRequest,
    BulkRoundRobinRequest,
    CreateMentorRequest,
    CreateNoteRequest,
    MentorAvailabilityRequest,
    MentorRequestDecision,
    RecordSessionRequest,
    ScheduleSessionRequest,
    UpdateMentorRequest,
} from '../-types/mentorship-types';

export const MENTORSHIP_KEYS = {
    mentors: 'mentorship-mentors',
    dashboard: 'mentorship-dashboard',
    myMentees: 'mentorship-my-mentees',
    timeline: 'mentorship-timeline',
    calls: 'mentorship-calls',
    requests: 'mentorship-requests',
    feedback: 'mentorship-feedback',
    sessions: 'mentorship-sessions',
} as const;

export const useStudentTimeline = (studentUserId: string | undefined) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.timeline, studentUserId],
        queryFn: () => fetchStudentTimeline(studentUserId ?? ''),
        enabled: !!studentUserId,
        staleTime: 15 * 1000,
    });

export const useMenteeCalls = (instituteId: string | undefined, studentUserId: string | undefined) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.calls, instituteId, studentUserId],
        queryFn: () => fetchMenteeCalls(instituteId ?? '', studentUserId ?? ''),
        enabled: !!instituteId && !!studentUserId,
        staleTime: 30 * 1000,
    });

export const useCreateNote = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (req: CreateNoteRequest) => createMentorNote(req),
        onSuccess: (_data, req) =>
            queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.timeline, req.studentUserId] }),
    });
};

/**
 * @param enabled Pass false where the answer isn't needed — the dashboard KPI card uses this so an
 * institute that has Mentorship switched off never calls mentorship from its home page.
 */
export const useMentorDashboard = (instituteId: string | undefined, enabled = true) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.dashboard, instituteId],
        queryFn: () => fetchDashboard(instituteId ?? ''),
        enabled: !!instituteId && enabled,
        staleTime: 30 * 1000,
    });

export const useMentors = (instituteId: string | undefined) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.mentors, instituteId],
        queryFn: () => fetchMentors(instituteId ?? ''),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useMentorsPaged = (instituteId: string | undefined, pageNo: number, pageSize: number) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.mentors, instituteId, 'paged', pageNo, pageSize],
        queryFn: () => fetchMentorsPaged(instituteId ?? '', pageNo, pageSize),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useMyMentees = (instituteId: string | undefined) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.myMentees, instituteId],
        queryFn: () => fetchMyMentees(instituteId ?? ''),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useMyMenteesPaged = (
    instituteId: string | undefined,
    pageNo: number,
    pageSize: number
) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.myMentees, instituteId, 'paged', pageNo, pageSize],
        queryFn: () => fetchMyMenteesPaged(instituteId ?? '', pageNo, pageSize),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useMyMentorProfile = (instituteId: string | undefined) =>
    useQuery({
        queryKey: ['mentorship-my-mentor-profile', instituteId],
        queryFn: () => fetchMyMentorProfile(instituteId ?? ''),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
        retry: false,
    });

export const useMySchedule = (
    instituteId: string | undefined,
    startDate: string,
    endDate: string
) =>
    useQuery({
        queryKey: ['mentorship-my-schedule', instituteId, startDate, endDate],
        queryFn: () => fetchMySchedule(instituteId ?? '', startDate, endDate),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

export const useMyBookingPage = (instituteId: string | undefined) =>
    useQuery({
        queryKey: ['mentorship-my-booking-page', instituteId],
        queryFn: () => fetchMyBookingPage(instituteId ?? ''),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
        retry: false,
    });

export const useUpdateMyBookingPage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (v: { instituteId: string; data: MentorAvailabilityRequest }) =>
            updateMyBookingPage(v.instituteId, v.data),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ['mentorship-my-booking-page'] }),
    });
};

const useInvalidateMentorship = () => {
    const queryClient = useQueryClient();
    return () => {
        queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.mentors] });
        queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.dashboard] });
    };
};

export const useCreateMentor = () => {
    const invalidate = useInvalidateMentorship();
    return useMutation({ mutationFn: (data: CreateMentorRequest) => createMentor(data), onSuccess: invalidate });
};

export const useUpdateMentor = () => {
    const invalidate = useInvalidateMentorship();
    return useMutation({
        mutationFn: (v: { id: string; instituteId: string; data: UpdateMentorRequest }) =>
            updateMentor(v.id, v.instituteId, v.data),
        onSuccess: invalidate,
    });
};

export const useDeleteMentor = () => {
    const invalidate = useInvalidateMentorship();
    return useMutation({
        mutationFn: (v: { id: string; instituteId: string }) => deleteMentor(v.id, v.instituteId),
        onSuccess: invalidate,
    });
};

export const useProvisionBookingPage = () => {
    const invalidate = useInvalidateMentorship();
    return useMutation({
        mutationFn: (v: { id: string; instituteId: string }) => provisionMentorBookingPage(v.id, v.instituteId),
        onSuccess: invalidate,
    });
};

/**
 * Assignment changes a mentor's roster, so the mentee lists have to go too — not
 * just the counts on the mentor rows. The mentor detail screen shows that roster
 * on the same page as the assign action, where a stale table reads as "the
 * assignment didn't work".
 */
const useInvalidateAfterAssignment = () => {
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMentorship();
    return () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.myMentees] });
    };
};

export const useAssignMentees = () => {
    const invalidate = useInvalidateAfterAssignment();
    return useMutation({ mutationFn: (data: AssignMentorRequest) => assignMentees(data), onSuccess: invalidate });
};

export const useBulkRoundRobin = () => {
    const invalidate = useInvalidateAfterAssignment();
    return useMutation({ mutationFn: (data: BulkRoundRobinRequest) => bulkRoundRobin(data), onSuccess: invalidate });
};

export const useUnassignMentee = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (v: { id: string; instituteId: string }) => unassignMentee(v.id, v.instituteId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.myMentees] }),
    });
};

/**
 * The admin review queue. Kept fresher than the mentor lists (10s) because an
 * admin sitting on this screen is watching for requests as they land.
 */
export const useMentorRequests = (
    instituteId: string | undefined,
    status: string,
    pageNo: number,
    pageSize: number
) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.requests, instituteId, status, pageNo, pageSize],
        queryFn: () => fetchMentorRequests(instituteId ?? '', status, pageNo, pageSize),
        enabled: !!instituteId,
        staleTime: 10 * 1000,
    });

/**
 * Approving creates an assignment, so the mentor lists and dashboard counts move
 * too — both caches are invalidated, not just the queue.
 */
export const useDecideMentorRequest = () => {
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMentorship();
    return useMutation({
        mutationFn: (v: {
            id: string;
            instituteId: string;
            approve: boolean;
            decision?: MentorRequestDecision;
        }) =>
            v.approve
                ? approveMentorRequest(v.id, v.instituteId, v.decision)
                : declineMentorRequest(v.id, v.instituteId, v.decision),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.requests] });
            invalidate();
        },
    });
};

/** One mentor's ratings — only fetched while the feedback dialog is open. */
export const useMentorFeedback = (mentorId: string | undefined, instituteId: string | undefined) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.feedback, mentorId, instituteId],
        queryFn: () => fetchMentorFeedback(mentorId ?? '', instituteId ?? ''),
        enabled: !!mentorId && !!instituteId,
        staleTime: 30 * 1000,
    });

/** Mentorship sessions for the admin session view. */
export const useMentorSessions = (
    instituteId: string | undefined,
    filters: { mentorId?: string; studentUserId?: string; lifecycle?: string } = {}
) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.sessions, instituteId, filters],
        queryFn: () => fetchMentorSessions({ instituteId: instituteId ?? '', ...filters }),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

/** Sessions the calling mentor hasn't recorded an outcome for yet. */
export const useMyAwaitingReview = (instituteId: string | undefined) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.sessions, 'awaiting', instituteId],
        queryFn: () => fetchMyAwaitingReview(instituteId ?? ''),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
    });

/**
 * Recording an outcome moves the dashboard counts too, so both the session views
 * and the mentor lists are invalidated.
 */
export const useRecordSession = () => {
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMentorship();
    return useMutation({
        mutationFn: (v: { instituteId: string; data: RecordSessionRequest }) =>
            recordSession(v.instituteId, v.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.sessions] });
            invalidate();
        },
    });
};

/** One mentor's assigned students — only fetched while the detail view is open. */
export const useMentorMentees = (mentorId: string | undefined, instituteId: string | undefined) =>
    useQuery({
        queryKey: [MENTORSHIP_KEYS.myMentees, 'of-mentor', mentorId, instituteId],
        queryFn: () => fetchMentorMentees(mentorId ?? '', instituteId ?? ''),
        enabled: !!mentorId && !!instituteId,
        staleTime: 30 * 1000,
    });

/** One mentor's availability. Errors when they haven't set booking up — that's shown as a hint. */
export const useMentorAvailability = (
    mentorId: string | undefined,
    instituteId: string | undefined
) =>
    useQuery({
        queryKey: ['mentorship-availability', mentorId, instituteId],
        queryFn: () => fetchMentorAvailability(mentorId ?? '', instituteId ?? ''),
        enabled: !!mentorId && !!instituteId,
        retry: false,
        staleTime: 60 * 1000,
    });

/**
 * Cancel or move a session. Both invalidate the session views and the mentor lists,
 * because either action changes the dashboard counts too.
 */
export const useSessionAction = () => {
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMentorship();
    return useMutation({
        mutationFn: (v: {
            instituteId: string;
            bookingInstanceId: string;
            action: 'cancel' | 'reschedule';
            reason?: string;
            startTime?: string;
            inviteeTimezone?: string;
            asAdmin?: boolean;
        }) =>
            v.action === 'cancel'
                ? cancelMentorSession(v.instituteId, v.bookingInstanceId, v.reason, v.asAdmin ?? true)
                : rescheduleMentorSession(
                      v.instituteId,
                      v.bookingInstanceId,
                      v.startTime ?? '',
                      v.inviteeTimezone,
                      v.asAdmin ?? true
                  ),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.sessions] });
            // The mentor's own schedule card and the mentee call lists read from the
            // booking module, not the session view, so they need invalidating too —
            // otherwise a cancelled session sits on screen looking fine.
            queryClient.invalidateQueries({ queryKey: ['mentorship-my-schedule'] });
            queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.calls] });
            queryClient.invalidateQueries({ queryKey: ['mentorship-slots'] });
            invalidate();
        },
    });
};

/**
 * Free slots on one mentor's booking page for a date window.
 *
 * Disabled until a slug is known: a mentor without a booking page has no availability
 * to show, and the scheduling dialog says so rather than firing a doomed request.
 */
export const useMentorSlots = (params: {
    instituteId: string | undefined;
    slug: string | undefined | null;
    from: string;
    to: string;
    tz: string;
    duration?: number;
}) =>
    useQuery({
        queryKey: [
            'mentorship-slots',
            params.instituteId,
            params.slug,
            params.from,
            params.to,
            params.tz,
            params.duration ?? null,
        ],
        queryFn: () =>
            fetchMentorSlots({
                instituteId: params.instituteId ?? '',
                slug: params.slug ?? '',
                from: params.from,
                to: params.to,
                tz: params.tz,
                duration: params.duration,
            }),
        enabled: !!params.instituteId && !!params.slug,
        // Slots go stale the moment anyone else books one, so this is kept short.
        staleTime: 15 * 1000,
    });

/**
 * Book a 1:1 for a learner. `asMentor` switches to the mentor's own endpoint, which
 * refuses any learner who isn't one of their mentees.
 */
export const useScheduleSession = () => {
    const queryClient = useQueryClient();
    const invalidate = useInvalidateMentorship();
    return useMutation({
        mutationFn: (v: { instituteId: string; asMentor?: boolean; data: ScheduleSessionRequest }) =>
            v.asMentor ? scheduleMySession(v.instituteId, v.data) : scheduleSession(v.instituteId, v.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.sessions] });
            queryClient.invalidateQueries({ queryKey: [MENTORSHIP_KEYS.calls] });
            queryClient.invalidateQueries({ queryKey: ['mentorship-slots'] });
            queryClient.invalidateQueries({ queryKey: ['mentorship-my-schedule'] });
            invalidate();
        },
    });
};
