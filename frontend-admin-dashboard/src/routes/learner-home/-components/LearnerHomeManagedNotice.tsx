import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { HouseLine } from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import { LEARNER_HOME_ROUTE } from '@/lib/learner-home/learner-home-access';
import { useLearnerHomeAccess } from '@/lib/learner-home/use-learner-home-access';
import { learnerHomeApi } from '../-services/learner-home-service';

/**
 * True while a learner home is published (spec 8.1): the Student Display
 * widget list then no longer drives the learner dashboard. Only asked when the
 * module is on and the viewer is an admin (the endpoint refuses anyone else).
 */
export function useLearnerHomeIsLive(): boolean {
    const access = useLearnerHomeAccess();
    const instituteId = getInstituteId() ?? '';
    const q = useQuery({
        queryKey: ['learner-home', 'draft', instituteId],
        queryFn: () => learnerHomeApi.getDraft(instituteId),
        enabled: access.isResolved && access.moduleOn && access.isAdmin && !!instituteId,
        staleTime: 60 * 1000,
        retry: false,
    });
    return !!q.data?.module_enabled && !!q.data.published;
}

/** Replaces the Dashboard widgets list in Student Display while a learner home is live. */
export function LearnerHomeManagedNotice() {
    const { t } = useTranslation('learnerHome');
    return (
        <div className="flex flex-wrap items-start gap-3 rounded-md border border-primary-200 bg-primary-50 p-4">
            <HouseLine
                className="mt-0.5 size-5 shrink-0 text-primary-500"
                weight="duotone"
                aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-1">
                <p className="text-body font-semibold text-neutral-800">
                    {t('studentDisplay.managed')}
                </p>
                <p className="text-caption text-neutral-600">{t('studentDisplay.managedBody')}</p>
                <Link
                    to={LEARNER_HOME_ROUTE}
                    className="inline-block text-body font-semibold text-primary-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {t('studentDisplay.open')}
                </Link>
            </div>
        </div>
    );
}
