import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Trophy } from '@phosphor-icons/react';
import {
    getSubOrgsWithDetails,
    type SubOrgListItem,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';

const nfmt = (n: number) => n.toLocaleString('en-IN');

const buildPlanChip =
    (t: TFunction) =>
    (raw: string | null | undefined): { label: string; cls: string } => {
        const k = (raw ?? '').toUpperCase().trim();
        if (k === 'ACTIVE')
            return {
                label: t('planStatus.active'),
                cls: 'bg-success-50 text-success-700 ring-success-200',
            };
        if (k === 'PENDING')
            return {
                label: t('planStatus.pending'),
                cls: 'bg-warning-50 text-warning-700 ring-warning-200',
            };
        if (k === 'EXPIRED')
            return {
                label: t('planStatus.expired'),
                cls: 'bg-danger-50 text-danger-700 ring-danger-200',
            };
        if (!k)
            return {
                label: t('planStatus.none'),
                cls: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
            };
        return {
            label: k.charAt(0) + k.slice(1).toLowerCase(),
            cls: 'bg-info-50 text-info-700 ring-info-200',
        };
    };

/**
 * PARENT-admin ranked list of the largest VLEs by seats used. Shares the
 * getSubOrgsWithDetails cache with the other VLE widgets. Hides when there are
 * no VLEs (or none with any seat usage yet).
 */
export default function TopVlesWidget() {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardTopVlesWidget');
    const instituteId = getCurrentInstituteId();

    const { data, isLoading, isError } = useQuery({
        queryKey: ['sub-orgs-with-details', instituteId],
        queryFn: () => getSubOrgsWithDetails(instituteId || undefined),
        enabled: !!instituteId,
        staleTime: 5 * 60_000,
        retry: false,
    });
    const items = useMemo<SubOrgListItem[]>(() => data?.content ?? [], [data]);

    const top = useMemo(() => {
        const ranked = items
            .map((it) => ({
                id: it.suborg_id ?? it.name ?? '',
                name: (it.name ?? '').trim() || t('unnamedName'),
                used: it.used_seats ?? 0,
                total: it.total_seats ?? 0,
                plan: it.plan_status,
            }))
            .sort((a, b) => b.used - a.used || b.total - a.total)
            .slice(0, 6);
        const maxUsed = Math.max(1, ...ranked.map((r) => r.used));
        return { ranked, maxUsed };
    }, [items, t]);

    const plural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const planChip = useMemo(() => buildPlanChip(t), [t]);

    if (isError || (!isLoading && items.length === 0)) return null;

    return (
        <Card className="p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        <Trophy size={14} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="line-clamp-1 text-sm font-semibold text-neutral-900">
                            {t('heading', { plural })}
                        </h3>
                        <p className="line-clamp-1 text-xs text-neutral-500">{t('subtitle')}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => navigate({ to: '/manage-custom-teams' })}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                    {t('viewAll')}
                    <ArrowRight size={12} weight="bold" />
                </button>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="h-9 w-full rounded-md" />
                    ))}
                </div>
            ) : (
                <div className="space-y-2.5">
                    {top.ranked.map((r, idx) => {
                        const chip = planChip(r.plan);
                        return (
                            <div key={r.id || idx} className="flex items-center gap-2.5">
                                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold tabular-nums text-neutral-600">
                                    {idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="line-clamp-1 text-xs font-medium text-neutral-800">
                                            {r.name}
                                        </span>
                                        <span
                                            className={cn(
                                                'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ring-1',
                                                chip.cls
                                            )}
                                        >
                                            {chip.label}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                                            <div
                                                className="h-full rounded-full bg-primary-400"
                                                style={{ width: `${(r.used / top.maxUsed) * 100}%` }}
                                            />
                                        </div>
                                        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                                            {r.total > 0 ? `${nfmt(r.used)}/${nfmt(r.total)}` : nfmt(r.used)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}
