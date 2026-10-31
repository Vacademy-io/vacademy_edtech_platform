import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FilePdf, DownloadSimple, FileText } from '@phosphor-icons/react';
import { generateQuizPDF, type QuizPDFOptions } from '../-utils/pdf';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface QuizDownloadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    quizContent: string;
}

export const QuizDownloadDialog = ({
    open,
    onOpenChange,
    quizContent,
}: QuizDownloadDialogProps) => {
    const { t: tPdf } = useTranslation('instructorCopilotQuizGenerator');
    const { t } = useTranslation('instructorCopilotQuizDownloadDialog');
    const [showAnswers, setShowAnswers] = useState(true);
    const [showExplanations, setShowExplanations] = useState(true);

    const handleDownload = () => {
        try {
            const options: QuizPDFOptions = {
                showAnswers,
                showExplanations: showAnswers && showExplanations, // Only show explanations if showing answers
            };

            generateQuizPDF(quizContent, options, tPdf);
            toast.success(t('toast.success'));
            onOpenChange(false);
        } catch (error) {
            console.error('Error generating quiz PDF:', error);
            toast.error(t('toast.error'));
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FilePdf size={24} className="text-red-500" />
                        {t('title')}
                    </DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Mode Selection */}
                    <div className="space-y-4">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                            <h4 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
                                {t('pdfType')}
                            </h4>
                            <div className="space-y-3">
                                <div className="flex items-start space-x-3">
                                    <Checkbox
                                        id="show-answers"
                                        checked={showAnswers}
                                        onCheckedChange={(checked) => {
                                            setShowAnswers(checked as boolean);
                                            // If hiding answers, also hide explanations
                                            if (!checked) {
                                                setShowExplanations(false);
                                            }
                                        }}
                                    />
                                    <div className="grid gap-1.5 leading-none">
                                        <Label
                                            htmlFor="show-answers"
                                            className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                        >
                                            {t('showAnswers')}
                                        </Label>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            {t('showAnswersHint')}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start space-x-3">
                                    <Checkbox
                                        id="show-explanations"
                                        checked={showExplanations}
                                        disabled={!showAnswers}
                                        onCheckedChange={(checked) =>
                                            setShowExplanations(checked as boolean)
                                        }
                                    />
                                    <div className="grid gap-1.5 leading-none">
                                        <Label
                                            htmlFor="show-explanations"
                                            className={`cursor-pointer text-sm font-medium leading-none ${!showAnswers ? 'opacity-50' : ''}`}
                                        >
                                            {t('showExplanations')}
                                        </Label>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            {t('showExplanationsHint')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Preview Info */}
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                            <div className="flex items-start gap-3">
                                <FileText size={20} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                                <div>
                                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                        {showAnswers ? t('answerKeyMode') : t('assessmentPaperMode')}
                                    </p>
                                    <p className="mt-1 text-sm text-blue-700 dark:text-blue-200">
                                        {showAnswers
                                            ? t('answerKeyModeDescription')
                                            : t('assessmentPaperModeDescription')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('cancel')}
                    </Button>
                    <Button onClick={handleDownload} className="gap-2">
                        <DownloadSimple size={16} />
                        {t('downloadPdf')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
