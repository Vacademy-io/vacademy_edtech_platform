import { useMemo } from 'react';
import { format, isToday, isTomorrow, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LeadProfileSummary } from '@/hooks/use-lead-profiles';
import type { LeadCardVM } from '@/components/shared/leads/lead-view-model';
import type { LeadTableExtraColumn } from '@/components/shared/leads/lead-table';
import { LeadAvatar } from '@/components/shared/leads/lead-avatar';
import { LeadEmptyState } from '@/components/shared/leads/lead-empty-state';
import { counsellorDisplayName } from '@/components/shared/leads/counsellor-display';

/** Backend timestamps are UTC without a zone marker. */
const toDate = (iso?: string | null): Date | null => {
    if (!iso) return null;
    const normalized = /Z$|[+-]\d{2}:?\d{2}$/i.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Follow-ups Agenda: the same follow-ups as the list, grouped
 * by when they are due — Overdue, Today, Tomorrow, then by date — with the page's
 * own row actions (e.g. Mark complete) on each row.
 */
export function FollowUpsAgenda({
    vms,
    profiles,
    onOpen,
    rowActions,
}: {
    vms: LeadCardVM[];
    profiles: Record<string, LeadProfileSummary>;
    onOpen: (vm: LeadCardVM) => void;
    rowActions?: LeadTableExtraColumn[];
}) {
    const { t } = useTranslation('crmPages');
    const groups = useMemo(() => {
        const today = startOfDay(new Date()).getTime();
        const map = new Map<
            string,
            {
                label: string;
                tone: 'danger' | 'warning' | 'neutral';
                items: Array<{ vm: LeadCardVM; at: Date | null }>;
            }
        >();
        const sorted = vms
            .map((vm) => ({ vm, at: toDate(vm.followUpDueAt ?? vm.tatDueAt) }))
            .sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));
        for (const row of sorted) {
            let key: string;
            let label: string;
            let tone: 'danger' | 'warning' | 'neutral' = 'neutral';
            if (!row.at) {
                key = 'none';
                label = t('followUps.agenda.noDate');
            } else if (row.at.getTime() < today || row.vm.followUpOverdue || row.vm.tatOverdue) {
                key = 'overdue';
                label = t('followUps.agenda.overdue');
                tone = 'danger';
            } else if (isToday(row.at)) {
                key = 'today';
                label = t('followUps.agenda.today');
                tone = 'warning';
            } else if (isTomorrow(row.at)) {
                key = 'tomorrow';
                label = t('followUps.agenda.tomorrow');
            } else {
                key = format(row.at, 'yyyy-MM-dd');
                label = format(row.at, 'EEE, d MMM');
            }
            if (!map.has(key)) map.set(key, { label, tone, items: [] });
            map.get(key)!.items.push(row);
        }
        return [...map.values()];
    }, [vms, t]);

    if (vms.length === 0) return <LeadEmptyState />;

    return (
        <div className="flex flex-col gap-4">
            {groups.map((g) => (
                <Card
                    key={g.label}
                    className="overflow-hidden rounded-xl border-neutral-200 shadow-sm"
                >
                    <div
                        className={cn(
                            'flex items-center justify-between px-4 py-2.5 font-semibold',
                            g.tone === 'danger' && 'bg-danger-50 text-danger-600',
                            g.tone === 'warning' && 'bg-warning-50 text-warning-700',
                            g.tone === 'neutral' && 'bg-neutral-50 text-neutral-700'
                        )}
                    >
                        <span className="text-body">{g.label}</span>
                        <span className="tabular-nums">
                            <span className="text-caption">{g.items.length}</span>
                        </span>
                    </div>
                    <div className="divide-y divide-neutral-100">
                        {g.items.map(({ vm, at }) => {
                            const profile = vm.userId ? profiles[vm.userId] : undefined;
                            const owner = counsellorDisplayName(profile);
                            return (
                                <div
                                    key={vm.key}
                                    onClick={() => onOpen(vm)}
                                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-neutral-50"
                                >
                                    <span
                                        className={cn(
                                            'w-16 shrink-0 rounded-md py-1 text-center font-semibold tabular-nums',
                                            g.tone === 'danger'
                                                ? 'bg-danger-50 text-danger-600'
                                                : 'bg-neutral-100 text-neutral-700'
                                        )}
                                    >
                                        <span className="text-caption">
                                            {at ? format(at, 'h:mm a') : '—'}
                                        </span>
                                    </span>
                                    <LeadAvatar name={vm.name} size="sm" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium text-neutral-900">
                                            <span className="text-body">{vm.name}</span>
                                        </span>
                                        <span className="block truncate text-neutral-500">
                                            <span className="text-caption">
                                                {[vm.phone !== '-' ? vm.phone : null, vm.audience]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </span>
                                        </span>
                                    </span>
                                    {owner && (
                                        <span className="hidden shrink-0 text-neutral-600 sm:block">
                                            <span className="text-caption">{owner}</span>
                                        </span>
                                    )}
                                    {(rowActions ?? []).map((c) => (
                                        <span
                                            key={c.id}
                                            className="shrink-0"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {c.render(vm, profile)}
                                        </span>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </Card>
            ))}
        </div>
    );
}
