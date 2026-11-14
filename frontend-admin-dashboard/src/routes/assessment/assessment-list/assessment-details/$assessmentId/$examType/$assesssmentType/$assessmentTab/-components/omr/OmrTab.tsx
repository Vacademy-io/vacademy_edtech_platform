import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    getOmrOverview,
    getOmrRollCheck,
    omrErrorMessage,
    type OmrSet,
} from '../../-services/omr-services';
import { OmrSettingsCard } from './OmrSettingsCard';
import { OmrRollCheckCard } from './OmrRollCheckCard';
import { OmrSetsCard } from './OmrSetsCard';
import { OmrUploadsList } from './OmrUploadsList';
import { OmrUploadDialog } from './OmrUploadDialog';
import { OmrBatchReviewDialog } from './OmrBatchReviewDialog';

/**
 * "OMR & Sets": everything a pen-and-paper MCQ exam needs on the dashboard —
 * sets and their shuffle, the roll-number pre-check, the three printables per
 * set, and the upload + review of the filled sheets. Marks stay held until the
 * admin releases them from the Submissions tab.
 */
export const OmrTab = ({
    assessmentId,
    instituteId,
}: {
    assessmentId: string;
    instituteId: string;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const queryClient = useQueryClient();
    const [uploadSet, setUploadSet] = useState<OmrSet | null>(null);
    const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);

    const overviewQuery = useQuery({
        queryKey: ['OMR_OVERVIEW', assessmentId, instituteId],
        queryFn: () => getOmrOverview(assessmentId, instituteId),
        enabled: !!instituteId,
    });
    const rollQuery = useQuery({
        queryKey: ['OMR_ROLL_CHECK', assessmentId, instituteId],
        queryFn: () => getOmrRollCheck(assessmentId, instituteId),
        enabled: !!instituteId,
    });

    if (overviewQuery.isLoading) return <DashboardLoader />;
    if (overviewQuery.error || !overviewQuery.data) {
        return (
            <p className="mt-6 text-sm text-danger-600">
                {omrErrorMessage(overviewQuery.error, t('errors.loadFailed'))}
            </p>
        );
    }
    const overview = overviewQuery.data;
    if (!overview.omr_mode) {
        return <p className="mt-6 text-sm text-neutral-500">{t('omrOff')}</p>;
    }
    const rollOk = rollQuery.data?.ok === true;

    return (
        <div className="mt-6 flex flex-col gap-4">
            <p className="flex items-start gap-2 rounded-md border border-primary-100 bg-primary-50 p-3 text-sm text-neutral-700">
                <Info size={18} className="mt-px shrink-0 text-primary-500" />
                {t('releaseNote')}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
                <OmrSettingsCard
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    overview={overview}
                />
                <OmrRollCheckCard
                    rollCheck={rollQuery.data}
                    isLoading={rollQuery.isLoading}
                    isFetching={rollQuery.isFetching}
                    error={
                        rollQuery.error
                            ? omrErrorMessage(rollQuery.error, t('errors.rollFailed'))
                            : null
                    }
                    onRecheck={() => void rollQuery.refetch()}
                />
            </div>
            <OmrSetsCard
                assessmentId={assessmentId}
                instituteId={instituteId}
                overview={overview}
                rollOk={rollOk}
                onUpload={setUploadSet}
            />
            <OmrUploadsList
                assessmentId={assessmentId}
                instituteId={instituteId}
                onOpen={setReviewBatchId}
            />

            {uploadSet && (
                <OmrUploadDialog
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    set={uploadSet}
                    onOpenChange={(open) => !open && setUploadSet(null)}
                    onStarted={(batch) => {
                        setUploadSet(null);
                        // The first upload locks the sets; the overview shows it.
                        queryClient.invalidateQueries({
                            queryKey: ['OMR_OVERVIEW', assessmentId, instituteId],
                        });
                        queryClient.invalidateQueries({ queryKey: ['OMR_BATCHES', assessmentId] });
                        setReviewBatchId(batch.id);
                    }}
                />
            )}
            {reviewBatchId && (
                <OmrBatchReviewDialog
                    batchId={reviewBatchId}
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    onClose={() => setReviewBatchId(null)}
                />
            )}
        </div>
    );
};

export default OmrTab;
