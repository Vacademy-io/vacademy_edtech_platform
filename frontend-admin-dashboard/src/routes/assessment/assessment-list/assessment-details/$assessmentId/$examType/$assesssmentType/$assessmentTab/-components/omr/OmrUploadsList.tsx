import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/formatters';
import { useQuery } from '@tanstack/react-query';
import { CircleNotch } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { listOmrBatches, type OmrBatch, type OmrBatchStatus } from '../../-services/omr-services';
import { OmrCard } from './OmrCard';

export const OMR_POLL_MS = 5000;

export const OMR_BATCH_TONE: Record<OmrBatchStatus, StatusType> = {
    RUNNING: 'INFO',
    NEEDS_REVIEW: 'WARNING',
    COMPLETED: 'SUCCESS',
};

/** Every upload of filled sheets on this assessment, newest first; polls while one is being read. */
export const OmrUploadsList = ({
    assessmentId,
    instituteId,
    onOpen,
}: {
    assessmentId: string;
    instituteId: string;
    onOpen: (batchId: string) => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const { data: batches = [], isLoading } = useQuery({
        queryKey: ['OMR_BATCHES', assessmentId, instituteId],
        queryFn: () => listOmrBatches(assessmentId, instituteId),
        refetchInterval: (query) =>
            (query.state.data ?? []).some((b) => b.status === 'RUNNING') ? OMR_POLL_MS : false,
    });

    return (
        <OmrCard title={t('uploads.title')} subtitle={t('uploads.subtitle')}>
            {isLoading ? (
                <p className="text-sm text-neutral-500">{t('common.loading')}</p>
            ) : batches.length === 0 ? (
                <p className="text-sm text-neutral-500">{t('uploads.empty')}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {batches.map((b) => (
                        <BatchRow key={b.id} batch={b} onOpen={() => onOpen(b.id)} />
                    ))}
                </ul>
            )}
        </OmrCard>
    );
};

const BatchRow = ({ batch, onOpen }: { batch: OmrBatch; onOpen: () => void }) => {
    const { t } = useTranslation('assessmentOmr');
    const c = batch.counts;
    const tone = OMR_BATCH_TONE[batch.status] ?? 'INFO';
    return (
        <li className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 p-3">
            <span className="font-semibold text-neutral-800">
                {t('sets.setLabel', { code: batch.set_code ?? '?' })}
            </span>
            <div className="flex items-center gap-1.5">
                {batch.status === 'RUNNING' && (
                    <CircleNotch size={14} className="shrink-0 animate-spin text-primary-500" />
                )}
                <StatusChip
                    text={t(`batchStatus.${batch.status}`, { defaultValue: batch.status })}
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
            <span className="text-caption text-neutral-700">
                {[
                    t('counts.graded', { count: c?.graded ?? 0 }),
                    t('counts.needsReview', { count: c?.needs_review ?? 0 }),
                    t('counts.flagged', { count: c?.flagged ?? 0 }),
                    t('counts.failed', { count: c?.failed ?? 0 }),
                    t('counts.reading', { count: c?.reading ?? 0 }),
                ].join(' · ')}
            </span>
            {batch.error_message && (
                <span className="basis-full text-caption text-warning-700">
                    {batch.error_message}
                </span>
            )}
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                className="ml-auto"
                onClick={onOpen}
            >
                {t('uploads.review')}
            </MyButton>
        </li>
    );
};

export default OmrUploadsList;
