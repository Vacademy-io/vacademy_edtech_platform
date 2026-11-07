import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchInstituteDashboardUsers } from '../-services/dashboard-services';

interface InstituteUserRole {
    role_name?: string;
    role_id?: string;
    institute_id?: string;
    status?: string;
}

interface InstituteUserContent {
    id: string;
    full_name?: string;
    username?: string;
    email?: string;
    roles?: InstituteUserRole[];
}

export interface AssigneeOption {
    id: string;
    name: string;
    subtitle?: string;
    role?: string;
}

const DEFAULT_ASSIGNEE_ROLES: { id: string; name: string }[] = [
    { id: '1', name: 'ADMIN' },
    { id: '2', name: 'CONTENT CREATOR' },
    { id: '3', name: 'ASSESSMENT CREATOR' },
    { id: '4', name: 'EVALUATOR' },
    { id: '5', name: 'TEACHER' },
];

const ROLE_PRIORITY: Record<string, number> = {
    TEACHER: 0,
    EVALUATOR: 1,
    'CONTENT CREATOR': 2,
    'ASSESSMENT CREATOR': 3,
    ADMIN: 4,
};

const toDisplayRole = (raw?: string): string => {
    if (!raw) return '';
    return raw
        .split(/[_\s]+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

/**
 * Returns the list of ACTIVE institute users who can be assigned to a doubt — staff-level roles
 * (TEACHER, EVALUATOR, CONTENT_CREATOR, ASSESSMENT_CREATOR, ADMIN). Each option carries a role
 * subtitle so the picker can show "Jane · Teacher" / "Ravi · Evaluator".
 *
 * Backed by the same institute-users endpoint the Teams page uses; role-agnostic at the API layer,
 * so the choice of which roles to include lives in this hook.
 */
export const useInstituteAssignees = (
    instituteId: string | undefined,
    roles: { id: string; name: string }[] = DEFAULT_ASSIGNEE_ROLES
) => {
    const { t } = useTranslation('dashboardUseInstituteAssignees');

    const query = useQuery({
        queryKey: ['INSTITUTE_ASSIGNEES', instituteId, roles.map((r) => r.name).join(',')],
        queryFn: () =>
            fetchInstituteDashboardUsers(
                instituteId,
                { roles, status: [{ id: '1', name: 'ACTIVE' }] },
                0,
                200
            ),
        enabled: Boolean(instituteId),
        staleTime: 5 * 60 * 1000,
    });

    const assignees = useMemo<AssigneeOption[]>(() => {
        const content = (query.data?.content ?? []) as InstituteUserContent[];
        const options = content.map((user) => {
            const instituteRoles = (user.roles ?? []).filter((r) => !!r.role_name);
            const primary = instituteRoles.sort(
                (a, b) =>
                    (ROLE_PRIORITY[(a.role_name ?? '').toUpperCase()] ?? 99) -
                    (ROLE_PRIORITY[(b.role_name ?? '').toUpperCase()] ?? 99)
            )[0]?.role_name;
            const role = toDisplayRole(primary);
            const name =
                user.full_name?.trim() ||
                user.username?.trim() ||
                user.email?.trim() ||
                t('unnamed');
            return {
                id: user.id,
                name,
                role,
                subtitle: role || undefined,
            } satisfies AssigneeOption;
        });
        // Stable sort by name for predictable UI
        options.sort((a, b) => a.name.localeCompare(b.name));
        return options;
    }, [query.data?.content, t]);

    return { assignees, ...query };
};
