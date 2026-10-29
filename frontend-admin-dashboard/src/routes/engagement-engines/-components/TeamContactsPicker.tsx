import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchEligibleOrgUsers } from '@/routes/manage-institute/teams/-services/institute-users-service';
import { CheckList, type CheckOption } from './CheckList';

/** Matches the backend cap (EngagementEngineService.MAX_NOTIFY_USERS). */
export const MAX_TEAM_CONTACTS = 10;

/**
 * Pick the team members an engine alerts (bell alert and email) whenever it needs a person: an
 * escalated reply, or a request for an asset it does not hold. The lead's own counsellor is told
 * as well, so this list is for the extra people (a sales head, a back-office owner).
 */
export function TeamContactsPicker({
    instituteId,
    selected,
    onChange,
}: {
    instituteId: string;
    selected: string[];
    onChange: (next: string[]) => void;
}) {
    const { t } = useTranslation('engagementEnginesCreateIndex');
    const {
        data: members = [],
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['engagement-team-members', instituteId],
        queryFn: () => fetchEligibleOrgUsers(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    const options: CheckOption[] = members.map((u) => ({
        value: u.id,
        label: u.full_name || u.email || u.username || u.id,
        sub: [u.email, u.roles?.join(', ')].filter(Boolean).join(' · ') || undefined,
    }));

    return (
        <div className="flex flex-col gap-2">
            <CheckList
                options={options}
                selected={selected}
                onChange={(next) => onChange(next.slice(0, MAX_TEAM_CONTACTS))}
                searchPlaceholder={t('team.searchPlaceholder')}
                emptyText={t('team.empty')}
                loading={isLoading}
                note={t('team.note', { max: MAX_TEAM_CONTACTS })}
            />
            {isError && (
                <p className="text-caption text-danger-600" role="alert">
                    {t('team.loadFailed')}
                </p>
            )}
        </div>
    );
}
