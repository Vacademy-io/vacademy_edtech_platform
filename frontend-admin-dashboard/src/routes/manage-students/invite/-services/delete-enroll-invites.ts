import { DELETE_INVITES } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Soft-deletes enroll invites (status → DELETED, short link retired) through
 * `DELETE /enroll-invite/enroll-invites` — the same resource the invite lists
 * are read from, so the row disappears on the next refetch.
 *
 * The Invite page used to send these ids to
 * `learner-invitation/update-learner-invitation-status` instead. That endpoint
 * looks up a different table, matched nothing, returned 200, and the "deleted"
 * invite quietly stayed in the list. Every delete surface should go through here.
 */
export const useDeleteEnrollInvites = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (enrollInviteIds: string[]) => {
            const response = await authenticatedAxiosInstance({
                method: 'DELETE',
                url: DELETE_INVITES,
                data: enrollInviteIds,
            });
            return response?.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_INVITE_LINKS'] });
            queryClient.invalidateQueries({ queryKey: ['inviteList'] });
        },
    });
};
