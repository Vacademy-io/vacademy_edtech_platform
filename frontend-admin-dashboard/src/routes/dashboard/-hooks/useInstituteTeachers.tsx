import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchInstituteDashboardUsers } from '../-services/dashboard-services';

interface InstituteUserContent {
    id: string;
    full_name?: string;
    username?: string;
    email?: string;
}

/**
 * Returns the list of ACTIVE institute users with the TEACHER role, shaped for dropdowns that
 * expect { id, name } options. Backed by the same endpoint the Teams page uses — not by
 * faculty_subject_package_session_mapping — so it surfaces teachers regardless of whether they
 * have batch/subject FSPSSM rows yet.
 */
export const useInstituteTeachers = (instituteId: string | undefined) => {
    const { t } = useTranslation('dashboardUseInstituteTeachers');

    const query = useQuery({
        queryKey: ['INSTITUTE_TEACHERS', instituteId],
        queryFn: () =>
            fetchInstituteDashboardUsers(
                instituteId,
                {
                    roles: [{ id: '5', name: 'TEACHER' }],
                    status: [{ id: '1', name: 'ACTIVE' }],
                },
                0,
                100
            ),
        enabled: Boolean(instituteId),
        staleTime: 5 * 60 * 1000,
    });

    const teachers = useMemo(() => {
        const content = (query.data?.content ?? []) as InstituteUserContent[];
        return content.map((user) => ({
            id: user.id,
            name: user.full_name || user.username || user.email || t('unnamed'),
        }));
    }, [query.data?.content, t]);

    return { teachers, ...query };
};
