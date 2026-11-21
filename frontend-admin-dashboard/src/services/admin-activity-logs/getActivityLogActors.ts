import { useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import {
    fetchEligibleOrgUsers,
    type InstituteUser,
} from '@/routes/manage-institute/teams/-services/institute-users-service';

export interface ActivityLogActor {
    id: string;
    fullName: string;
    email: string | null;
    roles: string[];
}

/**
 * The institute's team — the people who can appear as an actor in the audit
 * log — for the "Performed by" filter.
 *
 * <p>Deliberately the same roster the Teams page shows (every non-student
 * member, custom roles included) rather than a DISTINCT over the log table:
 * an admin picks the person they have in mind, and the query stays a cheap,
 * cached read instead of an aggregate over every audit row the institute has
 * ever written.
 *
 * <p>A person who has since left the institute is therefore not offered here.
 * The URL still carries raw actor ids, so an old filtered link keeps resolving
 * — it simply shows the id rather than a name.
 */
export const useActivityLogActors = (enabled = true) => {
    const instituteId = getInstituteId();

    return useQuery({
        queryKey: ['admin-activity-logs', 'actors', instituteId],
        enabled: enabled && !!instituteId,
        queryFn: async (): Promise<ActivityLogActor[]> => {
            const users: InstituteUser[] = await fetchEligibleOrgUsers(instituteId as string);
            return users
                .filter((user) => !!user.id)
                .map((user) => ({
                    id: user.id,
                    fullName: user.full_name?.trim() || user.email || user.id,
                    email: user.email ?? null,
                    roles: user.roles ?? [],
                }))
                .sort((a, b) => a.fullName.localeCompare(b.fullName));
        },
        // The team roster changes rarely; the log page re-reads it far more
        // often than it changes.
        staleTime: 5 * 60_000,
    });
};
