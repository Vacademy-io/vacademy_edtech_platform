import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Phone, ArrowsClockwise, ArrowSquareOut, CaretDown, CaretRight } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { fetchCounsellorLeads, type WorkbenchLead } from '../-services/counsellor-workbench-services';
import { LeadTransferChain } from './LeadTransferChain';

interface Props {
    instituteId: string;
    counsellorUserId: string;
    onReassign: (lead: WorkbenchLead) => void;
}

const PAGE_SIZE = 20;

/**
 * Tab body — list of leads currently assigned to the selected counsellor.
 * Reuses the workbench /me/leads endpoint with a filter on user when viewing
 * someone other than self (admin path). For self, the auth context makes
 * /me/leads return the same data.
 */
export function CounsellorLeadsTab({ instituteId, counsellorUserId, onReassign }: Props) {
    const { t, i18n } = useTranslation('counsellorsLeadsTab');
    // Reset to first page whenever the drawer switches to a different
    // counsellor — otherwise opening person B inherits person A's page index.
    const [page, setPage] = useState(0);
    // Expanded-row state keyed by lead_id so multiple rows can be open at
    // once. Resets on counsellor switch so person B doesn't inherit person
    // A's expansions.
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    useEffect(() => {
        setPage(0);
        setExpanded(new Set());
    }, [counsellorUserId]);

    function toggleExpanded(leadId: string) {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(leadId)) next.delete(leadId);
            else next.add(leadId);
            return next;
        });
    }

    // Per-counsellor endpoint — /me/leads only returns the caller's leads,
    // which makes the CSO / manager drawer look empty for everyone else.
    // Status undefined = show everything currently assigned to them; the
    // count chip on the parent card uses the canonical "open" filter
    // separately, so the two surfaces serve different intents.
    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['workbench-leads', instituteId, counsellorUserId, page],
        enabled: !!instituteId && !!counsellorUserId,
        queryFn: () =>
            fetchCounsellorLeads(instituteId, counsellorUserId, undefined, page, PAGE_SIZE),
        placeholderData: (prev) => prev,
    });

    const leads = data?.content ?? [];
    const totalElements = data?.totalElements ?? 0;
    const totalPages = Math.max(1, data?.totalPages ?? 1);

    if (isLoading) {
        return <div className="p-4 text-subtitle text-neutral-500">{t('loading')}</div>;
    }
    if (leads.length === 0 && page === 0) {
        return (
            <div className="rounded border border-dashed border-neutral-300 p-6 text-center text-subtitle text-neutral-500">
                {t('empty')}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="overflow-auto rounded border border-neutral-200">
                <table className="w-full text-body">
                    <thead className="bg-neutral-50 text-caption uppercase tracking-wide text-neutral-500">
                        <tr>
                            <th className="w-8 px-2 py-2" aria-label={t('table.expandRow')} />
                            <th className="px-3 py-2 text-left">{t('table.lead')}</th>
                            <th className="px-3 py-2 text-left">{t('table.status')}</th>
                            <th className="px-3 py-2 text-left">{t('table.score')}</th>
                            <th className="px-3 py-2 text-left">{t('table.campaign')}</th>
                            <th className="px-3 py-2 text-left">{t('table.assigned')}</th>
                            <th className="px-3 py-2 text-right">{t('table.actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.map((l) => {
                            const isOpen = expanded.has(l.lead_id);
                            return (
                                <Fragment key={l.lead_id}>
                                    <tr className="border-t border-neutral-100">
                                        <td className="px-2 py-2.5 align-top">
                                            <button
                                                type="button"
                                                onClick={() => toggleExpanded(l.lead_id)}
                                                className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                                                aria-expanded={isOpen}
                                                aria-label={isOpen ? t('table.hideTransferHistory') : t('table.showTransferHistory')}
                                                title={t('table.transferHistory')}
                                            >
                                                {isOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="text-body font-medium text-neutral-900">
                                                {l.lead_name ?? l.user_id.slice(0, 8)}
                                            </div>
                                            <div className="text-caption text-neutral-500">{l.lead_email}</div>
                                        </td>
                                        <td className="px-3 py-2.5 text-neutral-700">
                                            {l.lead_status_label ?? l.conversion_status}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className="rounded bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-700">
                                                {l.best_score ?? 0}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-neutral-700">{l.campaign_name ?? '—'}</td>
                                        <td className="px-3 py-2.5 text-caption text-neutral-500">
                                            {l.assigned_at
                                                ? new Date(l.assigned_at).toLocaleDateString(i18n.language)
                                                : '—'}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="flex justify-end gap-1">
                                                <button
                                                    type="button"
                                                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                                                    aria-label={t('table.openLead')}
                                                >
                                                    <ArrowSquareOut size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="rounded p-1 text-success-600 hover:bg-success-50"
                                                    aria-label={t('table.call')}
                                                >
                                                    <Phone size={16} />
                                                </button>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() => onReassign(l)}
                                                >
                                                    <ArrowsClockwise size={14} className="mr-1" /> {t('table.reassign')}
                                                </MyButton>
                                            </div>
                                        </td>
                                    </tr>
                                    {isOpen && (
                                        <tr className="border-t border-neutral-100 bg-neutral-50/50">
                                            <td />
                                            <td colSpan={6} className="px-2 py-2">
                                                <LeadTransferChain
                                                    instituteId={instituteId}
                                                    leadUserId={l.user_id}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {totalElements > PAGE_SIZE && (
                <div className="flex items-center justify-between">
                    <span className="text-caption text-neutral-500">
                        {t('pagination.showingRange', {
                            from: page * PAGE_SIZE + 1,
                            to: Math.min((page + 1) * PAGE_SIZE, totalElements),
                            total: totalElements,
                        })}
                        {isFetching ? t('pagination.loadingSuffix') : ''}
                    </span>
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                    />
                </div>
            )}
        </div>
    );
}
