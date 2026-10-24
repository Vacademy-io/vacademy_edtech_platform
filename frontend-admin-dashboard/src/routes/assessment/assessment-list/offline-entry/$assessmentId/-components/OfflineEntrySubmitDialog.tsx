import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { ScoringMode } from '../-utils/types';

interface OfflineEntrySubmitDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    answeredCount: number;
    unansweredCount: number;
    scoringMode: ScoringMode;
    studentName: string;
    isSubmitting: boolean;
    // Names of the PDFs that will be uploaded along with the marks.
    attachmentNames?: string[];
    onConfirm: () => void;
}

export const OfflineEntrySubmitDialog = ({
    open,
    onOpenChange,
    answeredCount,
    unansweredCount,
    scoringMode,
    studentName,
    isSubmitting,
    attachmentNames = [],
    onConfirm,
}: OfflineEntrySubmitDialogProps) => {
    const { t } = useTranslation('assessmentOfflineEntrySubmitDialog');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3 py-4 text-sm">
                    <p>
                        <span className="font-medium">{t('studentLabel')}</span> {studentName}
                    </p>
                    <p>
                        <span className="font-medium">{t('scoringModeLabel')}</span>{' '}
                        {scoringMode === 'AUTO_CALCULATE'
                            ? t('scoringModeAutoCalculate')
                            : t('scoringModeDirectMarks')}
                    </p>
                    <div className="flex gap-4">
                        <span className="rounded-md bg-green-50 px-2 py-1 text-green-700">
                            {t('answeredCount', { count: answeredCount })}
                        </span>
                        <span className="rounded-md bg-gray-50 px-2 py-1 text-gray-500">
                            {t('unansweredCount', { count: unansweredCount })}
                        </span>
                    </div>
                    {unansweredCount > 0 && (
                        <p className="text-xs text-amber-600">{t('unansweredWarning')}</p>
                    )}
                    {attachmentNames.length > 0 && (
                        <div>
                            <p className="font-medium">
                                {t('attachmentsHeading', { count: attachmentNames.length })}
                            </p>
                            <ul className="mt-1 list-inside list-disc text-xs text-neutral-500">
                                {attachmentNames.map((name) => (
                                    <li key={name} className="truncate">
                                        {name}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <button
                        onClick={() => onOpenChange(false)}
                        className="rounded-md border px-4 py-2 text-sm"
                        disabled={isSubmitting}
                    >
                        {t('cancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isSubmitting}
                        className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                        {isSubmitting ? t('submitting') : t('submit')}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
