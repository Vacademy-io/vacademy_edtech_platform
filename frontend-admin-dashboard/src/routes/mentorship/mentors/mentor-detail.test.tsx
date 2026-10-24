import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { MentorDTO } from '@/routes/mentorship/-types/mentorship-types';

const useMentorMenteesMock = vi.fn();
const useMentorDashboardMock = vi.fn();
const useMentorAvailabilityMock = vi.fn();
const useMentorFeedbackMock = vi.fn();

vi.mock('@/routes/mentorship/-hooks/use-mentorship', () => ({
    useMentorMentees: (...a: unknown[]) => useMentorMenteesMock(...a),
    useMentorAvailability: (...a: unknown[]) => useMentorAvailabilityMock(...a),
    useMentorFeedback: (...a: unknown[]) => useMentorFeedbackMock(...a),
    useMentorSessions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
    useSessionAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useMentorDashboard: (...a: unknown[]) => useMentorDashboardMock(...a),
    // Reached through the student side sheet and the schedule dialog the Students tab opens.
    useMyMentorProfile: () => ({ data: null }),
    useStudentTimeline: () => ({ data: [], isLoading: false }),
    useMenteeCalls: () => ({ data: [], isLoading: false }),
    useCreateNote: () => ({ mutateAsync: vi.fn() }),
    useScheduleSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useMentorSlots: () => ({ data: { slots: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
    // The Students tab now carries its own "Assign students" dialog.
    useAssignMentees: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The view links back to the list and the student rows open a chat; the test has no
// router around it.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, ...rest }: { children?: React.ReactNode; to?: string }) => (
        <a {...rest}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    // MyTable mounts the shared student-menu dialogs, which reach for the router.
    useRouter: () => ({ navigate: vi.fn(), invalidate: vi.fn() }),
}));
vi.mock('@/routes/manage-students/students-list/-services/getLearnerPackages', () => ({
    useLearnerPackagesQuery: () => ({ data: { content: [] }, isLoading: false }),
}));
vi.mock('@/routes/mentorship/-components/MentorAvatar', () => ({
    MentorAvatar: () => <span data-testid="avatar" />,
}));

const chatEnabledMock = vi.fn();
vi.mock('@/hooks/use-chat-enabled', () => ({
    useChatEnabled: () => chatEnabledMock(),
}));

import { useState } from 'react';
import {
    MentorDetailView,
    type MentorDetailTab,
} from '@/routes/mentorship/-components/MentorDetailView';

const mentor = (over: Partial<MentorDTO> = {}): MentorDTO => ({
    id: 'm1',
    institute_id: 'inst-1',
    user_id: 'u1',
    display_name: 'Asha Nair',
    title: 'Senior Physics Mentor',
    email: 'asha@example.com',
    status: 'ACTIVE',
    assigned_student_count: 3,
    ...over,
});

const idle = { data: undefined, isLoading: false, isError: false };

/** MyTable mounts shared dialogs that expect a QueryClient, so every render needs one. */
const render = (ui: ReactElement) =>
    rtlRender(
        <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
            {ui}
        </QueryClientProvider>
    );

/** Real tab state, so clicking a tab behaves as it does behind the router. */
function Harness({ mentorId = 'm1' }: { mentorId?: string }) {
    const [tab, setTab] = useState<MentorDetailTab>('overview');
    return (
        <MentorDetailView mentorId={mentorId} instituteId="inst-1" tab={tab} onTabChange={setTab} />
    );
}

describe('MentorDetailView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useMentorMenteesMock.mockReturnValue({ ...idle, data: [] });
        useMentorAvailabilityMock.mockReturnValue({ ...idle, data: null });
        useMentorFeedbackMock.mockReturnValue({ ...idle, data: [] });
        useMentorDashboardMock.mockReturnValue({ ...idle, data: { mentors: [mentor()] } });
        // Chat is off by default institute-wide; individual tests opt in.
        chatEnabledMock.mockReturnValue({ enabled: false, isLoading: false });
    });

    const open = (m: MentorDTO = mentor()) => {
        useMentorDashboardMock.mockReturnValue({ ...idle, data: { mentors: [m] } });
        return render(<Harness mentorId={m.id} />);
    };

    it('shows the profile and email the admin brief asks for', () => {
        open();
        expect(screen.getByText('Senior Physics Mentor')).toBeInTheDocument();
        expect(screen.getByText('asha@example.com')).toBeInTheDocument();
    });

    it('shows load against capacity when a cap is set', () => {
        open(mentor({ assigned_student_count: 3, max_mentees: 10 }));
        expect(screen.getByText('3/10')).toBeInTheDocument();
        expect(screen.getByText('Maximum capacity')).toBeInTheDocument();
    });

    it('says "unlimited" rather than inventing a cap the mentor does not have', () => {
        open(mentor({ assigned_student_count: 4, max_mentees: null }));
        expect(screen.getByText('Unlimited')).toBeInTheDocument();
        expect(screen.getByText('∞')).toBeInTheDocument();
    });

    it('shows the rating only when someone has actually rated them', () => {
        open(mentor({ average_rating: 4.6, rating_count: 9 }));
        expect(screen.getByText('4.6')).toBeInTheDocument();
        expect(screen.getByText('Rated sessions')).toBeInTheDocument();
    });

    it('hides the rating when the count is zero, rather than implying a score', () => {
        open(mentor({ average_rating: 4.6, rating_count: 0 }));
        expect(screen.queryByText(/4\.6/)).not.toBeInTheDocument();
    });

    it('summarises weekly availability in day order', () => {
        useMentorAvailabilityMock.mockReturnValue({
            ...idle,
            data: {
                duration_minutes: 30,
                timezone: 'Asia/Kolkata',
                availability: {
                    weekly_windows: [
                        { day_of_week: 'WEDNESDAY', start_time: '14:00', end_time: '17:00' },
                        { day_of_week: 'MONDAY', start_time: '09:00', end_time: '12:00' },
                    ],
                },
            },
        });
        open();
        const rows = screen.getAllByText(/monday|wednesday/i);
        expect(rows[0]?.textContent?.toLowerCase()).toContain('monday');
        expect(screen.getByText('09:00–12:00')).toBeInTheDocument();
        expect(screen.getByText(/30-minute sessions/)).toBeInTheDocument();
    });

    it('says plainly when a mentor has no booking set up', () => {
        useMentorAvailabilityMock.mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
        });
        open();
        expect(screen.getByText(/hasn't set up booking yet/)).toBeInTheDocument();
    });

    it('lists assigned students on the Students tab', () => {
        useMentorMenteesMock.mockReturnValue({
            ...idle,
            data: [
                {
                    assignment_id: 'a1',
                    mentor_id: 'm1',
                    student_user_id: 'stu-1',
                    name: 'Riya Sharma',
                    email: 'riya@example.com',
                    assignment_method: 'ROUND_ROBIN',
                },
            ],
        });
        open();
        fireEvent.click(screen.getByRole('button', { name: /^Students/ }));
        expect(screen.getByText('Riya Sharma')).toBeInTheDocument();
        expect(screen.getByText('Auto-assigned')).toBeInTheDocument();
    });

    it('offers an assign action from the empty Students tab', () => {
        // It used to say "assign students from the mentor list" and give no way to
        // get there — a dead end on the screen an admin lands on.
        useMentorMenteesMock.mockReturnValue({ ...idle, data: [] });
        open();
        fireEvent.click(screen.getByRole('button', { name: /^Students/ }));
        expect(screen.getByRole('button', { name: /Assign students/ })).toBeInTheDocument();
    });

    it('keeps the assign action once the mentor has a roster', () => {
        useMentorMenteesMock.mockReturnValue({
            ...idle,
            data: [
                {
                    assignment_id: 'a1',
                    mentor_id: 'm1',
                    student_user_id: 'stu-1',
                    name: 'Riya Sharma',
                    assignment_method: 'MANUAL',
                },
            ],
        });
        open();
        fireEvent.click(screen.getByRole('button', { name: /^Students/ }));
        expect(screen.getByRole('button', { name: /Assign students/ })).toBeInTheDocument();
    });

    const withOneMentee = () => {
        useMentorMenteesMock.mockReturnValue({
            ...idle,
            data: [
                {
                    assignment_id: 'a1',
                    mentor_id: 'm1',
                    student_user_id: 'stu-1',
                    name: 'Riya Sharma',
                    email: 'riya@example.com',
                    mobile_number: '9998887776',
                    assignment_method: 'MANUAL',
                },
            ],
        });
        open();
        fireEvent.click(screen.getByRole('button', { name: /^Students/ }));
    };

    it('shows the student table as a table, with the contact details an admin scans for', () => {
        withOneMentee();
        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getByText('riya@example.com')).toBeInTheDocument();
        expect(screen.getByText('9998887776')).toBeInTheDocument();
    });

    it('opens the student side sheet — not a new page — when their name is clicked', () => {
        withOneMentee();
        // Nothing from the sheet is on screen until the row is opened.
        expect(screen.queryByText('Learning')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Riya Sharma' }));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Learning')).toBeInTheDocument();
        expect(screen.getByText('Scheduled calls')).toBeInTheDocument();
        // The table stays mounted behind the sheet, so closing it puts the admin back
        // where they were. It is aria-hidden while the sheet is modal, so this asks the
        // DOM directly rather than the accessibility tree.
        expect(document.querySelector('table')).not.toBeNull();
    });

    it('offers a 1:1 with that student, without asking which mentor', () => {
        withOneMentee();
        fireEvent.click(screen.getByRole('button', { name: /Schedule a 1:1 with Riya Sharma/ }));

        expect(screen.getByText('Schedule a 1:1')).toBeInTheDocument();
        // The learner is fixed by the row it was opened from, and the mentor by the
        // detail view — so neither picker appears.
        expect(screen.getByText('Learner')).toBeInTheDocument();
        expect(screen.queryByText('Choose a mentor')).not.toBeInTheDocument();
    });

    it('disables Message and names the blocker when In-App Messages is off', () => {
        withOneMentee();
        // In-App Messages is off until an institute switches it on, and the backend
        // refuses every conversation call with 403 CHAT_DISABLED until then. The action
        // stays VISIBLE for staff — an admin is who can turn it on, so hiding it would
        // read as "mentorship messaging doesn't exist".
        const button = screen.getByRole('button', { name: /Message Riya Sharma/ });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', expect.stringContaining('In-App Messages'));
        // The actions that DO work are untouched.
        expect(screen.getByRole('button', { name: /View Riya Sharma/ })).toBeEnabled();
    });

    it('enables Message once the institute has In-App Messages on', () => {
        chatEnabledMock.mockReturnValue({ enabled: true, isLoading: false });
        withOneMentee();
        const button = screen.getByRole('button', { name: /Message Riya Sharma/ });
        expect(button).toBeEnabled();
        expect(button).toHaveAttribute('title', 'Send this student a direct message');
    });

    it('search narrows the student table', () => {
        useMentorMenteesMock.mockReturnValue({
            ...idle,
            data: [
                { assignment_id: 'a1', mentor_id: 'm1', student_user_id: 's1', name: 'Riya Sharma' },
                { assignment_id: 'a2', mentor_id: 'm1', student_user_id: 's2', name: 'Ravi Kumar' },
            ],
        });
        open();
        fireEvent.click(screen.getByRole('button', { name: /^Students/ }));
        expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText(/Search by name/), {
            target: { value: 'riya' },
        });

        expect(screen.getByText('Riya Sharma')).toBeInTheDocument();
        expect(screen.queryByText('Ravi Kumar')).not.toBeInTheDocument();
    });

    it('feedback is only fetched once that tab is opened', () => {
        open();
        // Overview is showing: the feedback hook must be told not to fetch.
        expect(useMentorFeedbackMock).toHaveBeenLastCalledWith(undefined, 'inst-1');

        fireEvent.click(screen.getByRole('button', { name: /^Feedback/ }));
        expect(useMentorFeedbackMock).toHaveBeenLastCalledWith('m1', 'inst-1');
    });

    it('the sessions tab reuses the shared panel scoped to this mentor', () => {
        open();
        fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
        // The panel's own filter row proves it rendered rather than a bespoke list.
        expect(screen.getByRole('button', { name: 'Awaiting review' })).toBeInTheDocument();
    });

    it('says so plainly when the id does not match a mentor on the team', () => {
        useMentorDashboardMock.mockReturnValue({ ...idle, data: { mentors: [] } });
        render(<Harness mentorId="gone" />);
        expect(screen.getByText(/no longer on your team/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Back to mentors' })).toBeInTheDocument();
    });
});
