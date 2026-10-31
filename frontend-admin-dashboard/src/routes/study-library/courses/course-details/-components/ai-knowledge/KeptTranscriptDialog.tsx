import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Microphone } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    courseKnowledgeErrorMessage,
    formatCredits,
    useKeptTranscript,
    useUseKeptTranscript,
} from '@/services/course-knowledge';

const NAMESPACE = 'courseAiKnowledge';

interface KeptTranscriptDialogProps {
    packageId: string;
    slideId: string | null;
    title: string | null;
    onOpenChange: (open: boolean) => void;
}

/**
 * A recording the speech check called "no clear speech" (chanting, a talk over
 * music). Its transcript was kept and nothing was charged; the admin reads the
 * start of it and can use it anyway for the usual transcription price.
 */
export const KeptTranscriptDialog = ({
    packageId,
    slideId,
    title,
    onOpenChange,
}: KeptTranscriptDialogProps) => {
    const { t } = useTranslation(NAMESPACE);
    const { data: kept, isLoading, error } = useKeptTranscript(packageId, slideId);
    const { mutateAsync } = useUseKeptTranscript(packageId);

    const useIt = async () => {
        if (!slideId || !kept) return;
        try {
            await mutateAsync({ slideId, expectedCredits: kept.credits });
            toast.success(t('kept.queued'));
            onOpenChange(false);
        } catch (err) {
            toast.error(courseKnowledgeErrorMessage(err) ?? t('kept.failed'));
        }
    };

    const footer = (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                {t('dialog.close')}
            </MyButton>
            {kept && (
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onAsyncClick={useIt}
                    loadingText={t('kept.using')}
                >
                    {t('kept.use', { credits: formatCredits(kept.credits) })}
                </MyButton>
            )}
        </div>
    );

    return (
        <MyDialog
            open={!!slideId}
            onOpenChange={onOpenChange}
            heading={t('kept.title')}
            footer={footer}
            dialogWidth="max-w-xl"
        >
            <div className="flex flex-col gap-4 p-4">
                <p className="text-body text-neutral-600">
                    {t('kept.body', { title: title || t('table.untitled') })}
                </p>
                {isLoading && <p className="text-body text-neutral-500">{t('kept.loading')}</p>}
                {!!error && !isLoading && (
                    <p className="text-body text-danger-600">
                        {courseKnowledgeErrorMessage(error) ?? t('kept.failed')}
                    </p>
                )}
                {kept && (
                    <>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-neutral-500">
                            <span className="inline-flex items-center gap-1">
                                <Microphone className="size-3.5" />
                                {t('kept.minutes', { count: kept.minutes })}
                            </span>
                            <span>{t('kept.words', { count: kept.words })}</span>
                        </div>
                        <blockquote className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-3 text-body text-neutral-700">
                            {kept.preview}
                            {kept.preview.length >= 600 ? '…' : ''}
                        </blockquote>
                        <p className="text-caption text-neutral-500">{t('kept.price')}</p>
                    </>
                )}
            </div>
        </MyDialog>
    );
};
