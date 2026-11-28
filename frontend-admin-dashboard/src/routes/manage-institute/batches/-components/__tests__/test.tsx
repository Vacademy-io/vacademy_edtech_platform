/**
 * Create Batch — the three things that made this dialog hard to use.
 *
 * 1. The course picker was a plain dropdown. An institute with fifty courses had
 *    to scroll; now it filters as you type.
 * 2. The session step never loaded the chosen course's sessions. sessionList
 *    started empty and only ever grew when the user added one, so "select
 *    existing" was a dead, disabled control for every course — including courses
 *    that do have sessions.
 * 3. A course with no sessions left the user on that empty picker with nothing
 *    saying why. It now switches to "create new" and says so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';

const COURSES = [
    { id: 'c1', name: 'Advanced Diploma in Cosmetology' },
    { id: 'c2', name: 'Clinical Nutrition And Dietetics' },
    { id: 'c3', name: 'Certificate in BB Glow' },
];
const SESSIONS_BY_COURSE: Record<string, { id: string; name: string }[]> = {
    c1: [
        { id: 's1', name: '2026_01_19_ADCT_OF_PUN' },
        { id: 's2', name: '2026_02_16_ADCT_OF_MUM' },
    ],
    c2: [], // the course-with-no-sessions case
};

const getSessionFromPackage = vi.fn(
    (params?: { courseId?: string }) => SESSIONS_BY_COURSE[params?.courseId ?? ''] ?? []
);

vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        instituteDetails: { batches_for_sessions: [] },
        getCourseFromPackage: () => COURSES,
        getSessionFromPackage,
        getLevelsFromPackage: () => [],
    }),
}));

// The real button opens the whole course wizard; this step only needs it to exist.
vi.mock('@/components/common/study-library/add-course/add-course-button', () => ({
    AddCourseButton: () => <button type="button">Create Course</button>,
}));

import { CreateCourseStep } from '../create-course-step';
import { CreateSessionStep } from '../create-session-step';

function Harness({
    children,
    defaults,
}: {
    children: ReactNode;
    defaults?: Record<string, unknown>;
}) {
    const methods = useForm({
        defaultValues: {
            courseCreationType: 'existing',
            selectedCourse: null,
            sessionCreationType: 'existing',
            selectedSession: null,
            selectedStartDate: null,
            ...defaults,
        },
    });
    return <FormProvider {...methods}>{children}</FormProvider>;
}

beforeEach(() => getSessionFromPackage.mockClear());

describe('course step', () => {
    it('filters the course list as you type instead of making you scroll it', async () => {
        render(
            <Harness>
                <CreateCourseStep />
            </Harness>
        );
        fireEvent.click(screen.getByRole('combobox'));
        // All three before searching.
        expect(screen.getByText('Advanced Diploma in Cosmetology')).toBeTruthy();
        expect(screen.getByText('Certificate in BB Glow')).toBeTruthy();

        fireEvent.change(screen.getByPlaceholderText(/search/i), {
            target: { value: 'nutrition' },
        });
        expect(screen.queryByText('Advanced Diploma in Cosmetology')).toBeNull();
        expect(screen.getByText('Clinical Nutrition And Dietetics')).toBeTruthy();
    });
});

describe('session step', () => {
    it("loads the chosen course's sessions — the bug was that it never did", () => {
        render(
            <Harness defaults={{ selectedCourse: { id: 'c1', name: COURSES[0]!.name } }}>
                <CreateSessionStep />
            </Harness>
        );
        expect(getSessionFromPackage).toHaveBeenCalledWith({ courseId: 'c1' });

        fireEvent.click(screen.getByRole('combobox'));
        const listbox = screen.getByRole('listbox');
        expect(within(listbox).getByText('2026_01_19_ADCT_OF_PUN')).toBeTruthy();
        expect(within(listbox).getByText('2026_02_16_ADCT_OF_MUM')).toBeTruthy();
    });

    it('a course with no sessions switches to "create new" and says why', () => {
        render(
            <Harness defaults={{ selectedCourse: { id: 'c2', name: COURSES[1]!.name } }}>
                <CreateSessionStep />
            </Harness>
        );
        // No dead picker left on screen...
        expect(screen.queryByRole('combobox')).toBeNull();
        // ...and the "create new" radio is the selected one.
        const newRadio = screen.getByRole('radio', { name: /new/i });
        expect(newRadio.getAttribute('data-state')).toBe('checked');
    });
});
