import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BellRinging, Envelope, Phone, UserCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchEligibleOrgUsers } from '@/routes/manage-institute/teams/-services/institute-users-service';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { safeParse } from '../-utils';
import type { EngagementEngine } from '../-types';

/**
 * Who this engine tells when it needs a person (an escalated reply, a missing asset, a failed
 * auto-send): the team members picked on the engine, plus each lead's own counsellor. With nobody
 * picked and no counsellor, the engine's creator is told. Edit the pick in the engine settings.
 */
export function EngineContactsCard({
    engine,
    instituteId,
    onEdit,
}: {
    engine: EngagementEngine;
    instituteId: string;
    onEdit?: () => void;
}) {
    const { t } = useTranslation('engagementEnginesEngineIdIndex');
    const { data: members = [], isLoading } = useQuery({
        queryKey: ['engagement-team-members', instituteId],
        queryFn: () => fetchEligibleOrgUsers(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    const pickedIds = safeParse<string[]>(engine.notifyUserIds, []);
    const byId = new Map(members.map((u) => [u.id, u]));
    const picked = pickedIds.map((id) => byId.get(id)).filter((u) => !!u);
    const creator = engine.createdBy ? byId.get(engine.createdBy) : undefined;

    return (
        <SectionCard
            title={t('contacts.title')}
            subtitle={t('contacts.subtitle')}
            icon={BellRinging}
            right={
                onEdit && (
                    <MyButton buttonType="secondary" scale="small" onClick={onEdit}>
                        {t('contacts.change')}
                    </MyButton>
                )
            }
        >
            {isLoading ? (
                <Skeleton className="h-10 w-full rounded-lg" />
            ) : (
                <div className="flex flex-col gap-2">
                    {picked.length > 0 ? (
                        <ul className="flex flex-col gap-2">
                            {picked.map((u) => (
                                <li
                                    key={u.id}
                                    className="flex flex-wrap items-center gap-x-4 gap-y-1"
                                >
                                    <span className="flex items-center gap-2 font-semibold text-neutral-900">
                                        <UserCircle size={18} className="text-neutral-400" />
                                        <span className="text-body">
                                            {u.full_name || u.email || u.username}
                                        </span>
                                    </span>
                                    {u.roles?.length ? (
                                        <span className="text-neutral-500">
                                            <span className="text-caption">
                                                {u.roles.join(', ')}
                                            </span>
                                        </span>
                                    ) : null}
                                    {u.email && (
                                        <a
                                            href={`mailto:${u.email}`}
                                            className="flex items-center gap-1 text-primary-600 hover:underline"
                                        >
                                            <Envelope size={14} />
                                            <span className="text-caption">{u.email}</span>
                                        </a>
                                    )}
                                    {u.mobile_number && (
                                        <a
                                            href={`tel:${u.mobile_number}`}
                                            className="flex items-center gap-1 text-primary-600 hover:underline"
                                        >
                                            <Phone size={14} />
                                            <span className="text-caption">{u.mobile_number}</span>
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-neutral-700">
                            <span className="text-body">
                                {creator
                                    ? t('contacts.fallbackCreator', {
                                          name: creator.full_name || creator.email,
                                      })
                                    : t('contacts.fallback')}
                            </span>
                        </p>
                    )}
                    <p className="text-neutral-500">
                        <span className="text-caption">{t('contacts.counsellorNote')}</span>
                    </p>
                </div>
            )}
        </SectionCard>
    );
}
