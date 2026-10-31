/**
 * Create Batch popup: session and level are optional.
 *
 * Both used to be mandatory, and the level step hid the level this course and
 * session already used — an institute with one level ("default") had nothing to
 * pick and was forced to type a new one. Skipping now lands on the shared
 * DEFAULT session/level, and the shared level is sent without a name because the
 * backend renames an existing level to whatever name it receives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: (_term: string, fallback: string) => fallback,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mutate = vi.fn();
vi.mock('@/services/study-library/course-operations/add-course', () => ({
    useAddCourse: () => ({ mutate, isPending: false }),
}));

vi.mock('../../../../manage-students/students-list/-services/copyStudyMaterialFromSession', () => ({
    useCopyStudyMaterialFromSession: () => ({ mutate: vi.fn() }),
}));

// One course, one session, one level, already combined in a batch.
const batches = [
    {
        id: 'ps-1',
        package_dto: { id: 'c1', package_name: 'Course' },
        session: { id: 'DEFAULT', session_name: 'DEFAULT' },
        level: { id: 'DEFAULT', level_name: 'default' },
    },
];
// What the chosen course itself runs; each test sets it.
let courseSessions: Array<{ id: string; name: string }> = [];
let courseLevels: Array<{ id: string; name: string }> = [];
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        instituteDetails: { batches_for_sessions: batches },
        getSessionFromPackage: () => courseSessions,
        getLevelsFromPackage: (params?: { courseId?: string }) =>
            params?.courseId ? courseLevels : [{ id: 'DEFAULT', name: 'default' }],
        getPackageSessionId: ({ courseId, sessionId, levelId }: Record<string, string>) =>
            courseId === 'c1' && sessionId === 'DEFAULT' && levelId === 'DEFAULT' ? 'ps-1' : null,
    }),
}));

// The course is passed in; its picker is not under test.
vi.mock('../create-course-step', () => ({ CreateCourseStep: () => <div>course step</div> }));

import { CreateBatchDialog } from '../create-batch-dialog';

const next = () => fireEvent.click(screen.getByText('button.nextStep'));

const renderDialog = () =>
    render(
        <CreateBatchDialog
            open
            onOpenChange={vi.fn()}
            initialCourse={{ id: 'c1', name: 'Course' }}
        />
    );

const sentLevelAndSession = () => {
    const payload = mutate.mock.calls[0]![0].requestData;
    return { session: payload.sessions[0], level: payload.sessions[0].levels[0] };
};

describe('CreateBatchDialog — optional session and level', () => {
    beforeEach(() => {
        mutate.mockClear();
        courseSessions = [];
        courseLevels = [];
    });

    it('creates on the default session and level when both are skipped', async () => {
        renderDialog();
        next(); // course → session
        await screen.findByText('optionalHint');
        next(); // session → level, nothing picked
        await screen.findByText('form.optionalHint');
        next(); // level → review, nothing picked
        await screen.findByText('review.title');

        expect(screen.getAllByText('review.defaultValue')).toHaveLength(2);
        fireEvent.click(screen.getByText('trigger.createBatch'));
        await vi.waitFor(() => expect(mutate).toHaveBeenCalled());

        const { session, level } = sentLevelAndSession();
        expect(session).toMatchObject({ id: 'DEFAULT', new_session: false, session_name: '' });
        expect(level).toMatchObject({ id: 'DEFAULT', new_level: false, level_name: '' });
    });

    it('offers the level the course already uses in this session', async () => {
        renderDialog();
        next();
        await screen.findByText('optionalHint');
        next();
        await screen.findByText('form.optionalHint');

        // "Select existing" is enabled, not forced over to "Create new".
        expect(screen.getByRole('radio', { name: /form.selectExisting/ })).not.toBeDisabled();
    });

    it('starts with the default session and level picked when the course uses them', async () => {
        courseSessions = [{ id: 'DEFAULT', name: 'DEFAULT' }];
        courseLevels = [{ id: 'DEFAULT', name: 'default' }];
        renderDialog();
        next();
        await screen.findByText('optionalHint');
        expect(screen.getByText('DEFAULT')).toBeInTheDocument();
        next();
        await screen.findByText('form.optionalHint');
        expect(screen.getByText('default')).toBeInTheDocument();
        next();
        await screen.findByText('review.title');

        expect(screen.queryByText('review.defaultValue')).toBeNull();
        fireEvent.click(screen.getByText('trigger.createBatch'));
        await vi.waitFor(() => expect(mutate).toHaveBeenCalled());

        const { session, level } = sentLevelAndSession();
        expect(session).toMatchObject({ id: 'DEFAULT', new_session: false });
        // Picked, but still sent without a name so the shared level is never renamed.
        expect(level).toMatchObject({ id: 'DEFAULT', new_level: false, level_name: '' });
    });
});
