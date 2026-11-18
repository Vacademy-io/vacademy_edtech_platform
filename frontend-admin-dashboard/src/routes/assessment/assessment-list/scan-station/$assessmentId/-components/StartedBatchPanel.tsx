import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { CopyIntakeBatchPanel } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/copy-intake/CopyIntakeBatchPanel';

/**
 * Once the copies are handed over: the existing Bulk checks panel on the batch
 * this session started, where names that could not be matched are mapped.
 */
export const StartedBatchPanel = ({
    assessmentId,
    instituteId,
    examType,
    batchId,
}: {
    assessmentId: string;
    instituteId: string;
    examType: string;
    batchId: string;
}) => {
    const { t } = useTranslation('scanStation');
    const [open, setOpen] = useState(false);
    const { data: details } = useQuery(
        getAssessmentDetails({ assessmentId, instituteId, type: 'EXAM' })
    );
    // Linked batches live on step 3 (index 2) of the details payload, as on the Submissions tab.
    const packageSessionIds: string[] = useMemo(
        () =>
            (details?.[2]?.saved_data?.pre_batch_registrations ?? [])
                .map((b) => b.batchId)
                .filter(Boolean),
        [details]
    );

    return (
        <section className="flex flex-col gap-3 rounded-lg border border-success-200 bg-success-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
                <CheckCircle size={20} className="shrink-0 text-success-600" />
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body font-semibold text-success-700">
                        {t('started.title')}
                    </span>
                    <span className="text-caption text-neutral-700">{t('started.body')}</span>
                </span>
                {!open && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setOpen(true)}
                    >
                        {t('started.show')}
                    </MyButton>
                )}
            </div>
            {open && (
                <div className="rounded-md bg-white">
                    <CopyIntakeBatchPanel
                        assessmentId={assessmentId}
                        instituteId={instituteId}
                        examType={examType}
                        packageSessionIds={packageSessionIds}
                        initialBatchId={batchId}
                        onClose={() => setOpen(false)}
                    />
                </div>
            )}
        </section>
    );
};

export default StartedBatchPanel;
