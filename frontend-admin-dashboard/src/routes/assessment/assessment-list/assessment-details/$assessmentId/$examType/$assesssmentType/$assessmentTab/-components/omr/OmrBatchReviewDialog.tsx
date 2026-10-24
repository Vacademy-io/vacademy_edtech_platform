import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/formatters';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowsClockwise, CircleNotch, Info } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip } from '@/components/design-system/status-chips';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import {
    getOmrBatch,
    getOmrSetPaper,
    isOmrSheetFlagged,
    type OmrSheet,
} from '../../-services/omr-services';
import { OMR_BATCH_TONE, OMR_POLL_MS } from './OmrUploadsList';
import { OmrStat } from './OmrCard';
import { OmrSheetRow } from './OmrSheetRow';

type Filter = 'NEEDS_REVIEW' | 'FLAGGED' | 'GRADED' | 'FAILED' | 'SKIPPED';
const FILTERS: Filter[] = ['NEEDS_REVIEW', 'FLAGGED', 'GRADED', 'FAILED', 'SKIPPED'];

const matches = (sheet: OmrSheet, filter: Filter) => {
    switch (filter) {
        case 'FLAGGED':
            return isOmrSheetFlagged(sheet);
        case 'GRADED':
            return sheet.status === 'GRADED';
        default:
            return sheet.status === filter;
    }
};

/**
 * One upload of filled sheets: what was read off each page, who it went to,
 * and the sheets waiting for a person. Polls while the upload is being read
 * and toasts once when it settles.
 */
export const OmrBatchReviewDialog = ({
    batchId,
    assessmentId,
    instituteId,
    onClose,
}: {
    batchId: string;
    assessmentId: string;
    instituteId: string;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const queryClient = useQueryClient();
    const [filter, setFilter] = useState<Filter>('NEEDS_REVIEW');

    const { data: batch, isLoading } = useQuery({
        queryKey: ['OMR_BATCH', batchId, instituteId],
        queryFn: () => getOmrBatch(batchId, instituteId),
        refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? OMR_POLL_MS : false),
    });

    // Options printed per question, for the "fix flagged answers" radios.
    const { data: paper } = useQuery({
        queryKey: ['OMR_SET_PAPER', assessmentId, batch?.set_id, instituteId],
        queryFn: () => getOmrSetPaper(assessmentId, instituteId, batch?.set_id ?? ''),
        enabled: !!batch?.set_id,
        staleTime: 5 * 60 * 1000,
    });
    const optionCountByNo = useMemo(() => {
        const out: Record<string, number> = {};
        for (const item of paper?.items ?? []) out[String(item.no)] = item.option_ids.length;
        return out;
    }, [paper]);

    // One toast per settle, on the transition only.
    const lastStatus = useRef<string | null>(null);
    useEffect(() => {
        if (!batch) return;
        const prev = lastStatus.current;
        lastStatus.current = batch.status;
        if (prev === 'RUNNING' && batch.status !== 'RUNNING') {
            if (batch.status === 'NEEDS_REVIEW') {
                toast.warning(t('toasts.needsReview', { count: batch.counts.needs_review }));
            } else {
                toast.success(t('toasts.completed', { count: batch.counts.graded }));
            }
            queryClient.invalidateQueries({ queryKey: ['OMR_BATCHES', assessmentId] });
        }
    }, [batch, assessmentId, queryClient, t]);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['OMR_BATCH', batchId] });
        queryClient.invalidateQueries({ queryKey: ['OMR_BATCHES', assessmentId] });
        queryClient.invalidateQueries({ queryKey: ['OMR_PARTICIPANTS', assessmentId] });
    };

    const sheets = useMemo(() => batch?.sheets ?? [], [batch]);
    const countOf = (f: Filter) => sheets.filter((s) => matches(s, f)).length;
    const shown = sheets.filter((s) => matches(s, filter));
    const reading = sheets.filter((s) => s.status === 'PENDING' || s.status === 'READING').length;
    const c = batch?.counts;
    const tone = batch ? OMR_BATCH_TONE[batch.status] ?? 'INFO' : 'INFO';

    return (
        <MyDialog
            heading={t('review.title', { code: batch?.set_code ?? '' })}
            open
            onOpenChange={(o) => !o && onClose()}
            dialogWidth="max-w-5xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                {isLoading || !batch ? (
                    <DashboardLoader />
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                {batch.status === 'RUNNING' && (
                                    <CircleNotch
                                        size={14}
                                        className="shrink-0 animate-spin text-primary-500"
                                    />
                                )}
                                <StatusChip
                                    text={t(`batchStatus.${batch.status}`, {
                                        defaultValue: batch.status,
                                    })}
                                    textSize="text-caption"
                                    status={tone}
                                    showIcon={tone !== 'INFO'}
                                />
                            </div>
                            <span className="text-caption text-neutral-500">
                                {t('uploads.startedBy', {
                                    name: batch.created_by_name || '—',
                                    when: formatDateTime(batch.created_at),
                                    count: batch.total_files,
                                })}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                className="ml-auto"
                                onClick={refresh}
                            >
                                <ArrowsClockwise size={14} />
                                {t('review.refresh')}
                            </MyButton>
                        </div>
                        {batch.error_message && (
                            <p className="text-caption text-warning-700">{batch.error_message}</p>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                            <OmrStat label={t('stats.sheets')} value={c?.sheets ?? 0} />
                            <OmrStat
                                label={t('stats.graded')}
                                value={c?.graded ?? 0}
                                tone="text-success-600"
                            />
                            <OmrStat
                                label={t('stats.needsReview')}
                                value={c?.needs_review ?? 0}
                                tone="text-warning-600"
                            />
                            <OmrStat
                                label={t('stats.flagged')}
                                value={c?.flagged ?? 0}
                                tone="text-warning-600"
                            />
                            <OmrStat
                                label={t('stats.failed')}
                                value={c?.failed ?? 0}
                                tone="text-danger-600"
                            />
                        </div>
                        {reading > 0 && (
                            <p className="flex items-center gap-2 text-caption text-neutral-500">
                                <CircleNotch size={14} className="animate-spin text-primary-500" />
                                {t('review.reading', { count: reading })}
                            </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            {FILTERS.map((f) => (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setFilter(f)}
                                    className={cn(
                                        'rounded-full border px-3 py-1 text-caption font-medium',
                                        f === filter
                                            ? 'border-primary-500 bg-primary-50 text-primary-600'
                                            : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-300'
                                    )}
                                >
                                    {t(`review.filter.${f}`)} ({countOf(f)})
                                </button>
                            ))}
                        </div>

                        {shown.length === 0 ? (
                            <p className="text-sm text-neutral-500">{t('review.emptyFilter')}</p>
                        ) : (
                            <ul className="flex flex-col gap-2">
                                {shown.map((sheet) => (
                                    <OmrSheetRow
                                        key={sheet.id}
                                        sheet={sheet}
                                        assessmentId={assessmentId}
                                        instituteId={instituteId}
                                        optionCountByNo={optionCountByNo}
                                        onChanged={refresh}
                                    />
                                ))}
                            </ul>
                        )}

                        <p className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-caption text-neutral-600">
                            <Info size={16} className="mt-px shrink-0" />
                            {t('releaseNote')}
                        </p>
                    </>
                )}
            </div>
        </MyDialog>
    );
};

export default OmrBatchReviewDialog;
