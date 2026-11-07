import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ADD_DOUBT } from '@/constants/urls';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { buildDoubtUpdatePayload, DoubtAssignmentPatch } from '../-components/board/board-model';

/**
 * Persist a board move (assign / reassign / unassign / resolve / reopen) through the same
 * endpoint the inbox's assignee picker and resolve toggle use. Plain promise rather than a
 * react-query mutation so the board can sequence "await save → await refetch → drop the
 * optimistic entry" itself and the card never snaps back between the two.
 */
export const updateDoubtAssignment = async (doubt: Doubt, patch: DoubtAssignmentPatch) => {
    const payload = buildDoubtUpdatePayload(doubt, patch);
    await authenticatedAxiosInstance.post(`${ADD_DOUBT}?doubtId=${doubt.id}`, payload);
};
