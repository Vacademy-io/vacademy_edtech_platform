import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getLeadFreebies } from '@/components/shared/freebies/freebie-downloads-service';
import { FreebieKindIcon } from '@/components/shared/freebies/freebie-kind';

/**
 * Freebies (website resource cards) this lead opened — what they are
 * interested in, before the counsellor calls. Read from the downloads table,
 * not the timeline: a timeline ACTIVITY row would count as a counsellor
 * response for TAT/SLA. Renders nothing for leads who never took one.
 */
export function LeadFreebiesWidget({ userId }: { userId: string }) {
    const { t, i18n } = useTranslation('freebieDownloads');
    const instituteId = getCurrentInstituteId();
    const { data } = useQuery({
        queryKey: ['lead-freebies', instituteId, userId],
        queryFn: () => getLeadFreebies(instituteId!, userId),
        enabled: !!instituteId && !!userId,
        staleTime: 60_000,
        retry: 1,
    });

    if (!data?.length) return null;

    const formatDate = (iso: string | null) =>
        iso
            ? new Date(iso).toLocaleString(i18n.language || 'en', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
              })
            : '';

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <div className="h-3.5 w-1 rounded-full bg-primary-500" />
                <h4 className="text-sm font-semibold text-neutral-700">{t('leadCard.title')}</h4>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-neutral-500">
                    {data.length}
                </span>
            </div>
            <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-100 bg-white shadow-sm">
                {data.map((d, i) => (
                    <li key={`${d.url}-${i}`} className="flex items-center gap-2 px-3 py-2">
                        <FreebieKindIcon url={d.url} />
                        <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 truncate text-sm text-neutral-700 hover:text-primary-500 hover:underline"
                            title={d.url}
                        >
                            {d.title || d.url}
                        </a>
                        <span className="shrink-0 text-caption text-neutral-400">{formatDate(d.downloadedAt)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
