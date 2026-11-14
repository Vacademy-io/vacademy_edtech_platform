import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { DoubtAssignmentPatch } from '../-components/board/board-model';
import { updateDoubtAssignment } from './update-doubt-assignment';
import { DOUBT_ACTIVITY_QUERY_KEY } from './use-doubt-activity';

/**
 * Status / remark / assignment update for one doubt, refreshing every consumer afterwards: the
 * inbox + board lists, the by-id deep-link cache and the doubt's activity trail.
 */
export const useUpdateDoubt = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ doubt, patch }: { doubt: Doubt; patch: DoubtAssignmentPatch }) =>
            updateDoubtAssignment(doubt, patch),
        onSuccess: async (_data, { doubt }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['GET_DOUBTS'] }),
                queryClient.invalidateQueries({ queryKey: ['GET_DOUBT_BY_ID', doubt.id] }),
                queryClient.invalidateQueries({ queryKey: [DOUBT_ACTIVITY_QUERY_KEY, doubt.id] }),
            ]);
        },
    });
};
