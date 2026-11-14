/**
 * "View Batch" on a batch card.
 *
 * It used to hand the learner list a display label — `${levelName} ${packageName}` —
 * as the `batch` search param. The learner list reads that param as a
 * package_session id and matches it against batches_for_sessions to hydrate its
 * Batch filter chip, so the label matched nothing: the list was silently pinned
 * to the batch with no filter shown for it, and the Batch filter looked empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BatchType } from '@/routes/manage-institute/batches/-types/manage-batches-types';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({ instituteDetails: { learner_portal_base_url: 'x' } }),
}));

vi.mock('@/routes/manage-institute/batches/-services/delete-batches', () => ({
    useDeleteBatches: () => ({ mutate: vi.fn() }),
}));

// The enroll wizard itself is not under test; record what the card opens it with.
const enrollDialog = vi.fn();
vi.mock(
    '@/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/BulkAssignDialog',
    () => ({
        BulkAssignDialog: (props: { open: boolean; initialPackageSessionId?: string }) => {
            enrollDialog(props);
            return props.open ? <div>enroll wizard</div> : null;
        },
    })
);

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Learner',
    getTerminologyPlural: () => 'Learners',
}));

import { BatchSection } from '../batch-section';

const batch: BatchType = {
    batch_name: '2026_05_11_ADCT_OF_PUN',
    batch_status: 'ACTIVE',
    count_students: 3,
    start_date: '2026-05-11',
    package_session_id: 'ps-adct-pun',
    invite_code: '1uq33p',
};

const course = {
    package_dto: { id: 'p1', package_name: 'Adv Diploma In Cosmetology', thumbnail_file_id: '' },
    batches: [batch],
};

const renderCard = () =>
    render(
        <BatchSection
            course={course}
            totalBatches={1}
            totalLearners={3}
            view="grid"
            onCreateBatch={() => {}}
        />
    );

describe('View Batch', () => {
    beforeEach(() => navigate.mockClear());

    it('pins the learner list to this batch by id, not by display label', () => {
        renderCard();
        screen.getByText('batchCard.viewBatchButton').click();

        expect(navigate).toHaveBeenCalledWith({
            to: '/manage-students/students-list',
            search: {
                batch: 'ps-adct-pun',
                package_session_id: 'ps-adct-pun',
            },
        });
    });

    it('shows the batch its own name, so two batches of one course differ', () => {
        renderCard();
        expect(screen.getByText('2026_05_11_ADCT_OF_PUN')).toBeInTheDocument();
    });

    it('shows the invite code the backend returned', () => {
        renderCard();
        expect(screen.getByText('1uq33p')).toBeInTheDocument();
    });
});

describe('Enroll on a batch card', () => {
    it('opens the current enroll wizard with this batch picked', () => {
        renderCard();
        expect(screen.queryByText('enroll wizard')).toBeNull();

        fireEvent.click(screen.getByText('batchCard.enrollButton'));

        expect(screen.getByText('enroll wizard')).toBeInTheDocument();
        expect(enrollDialog).toHaveBeenLastCalledWith(
            expect.objectContaining({ open: true, initialPackageSessionId: 'ps-adct-pun' })
        );
    });
});
