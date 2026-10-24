import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { FileDoc, UploadSimple, X } from '@phosphor-icons/react';
import { uploadDocsFile } from '@/routes/assessment/question-papers/-services/question-paper-services';
import { transformResponseDataToMyQuestionsSchema } from '@/routes/assessment/question-papers/-utils/helper';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { Progress } from '@/components/ui/progress';

// Fixed identifiers — document must use exactly these section headers
const QUESTION_IDENTIFIER = 'Questions*';
const OPTION_IDENTIFIER = 'Options*';
const ANSWER_IDENTIFIER = 'Ans:';
const EXPLANATION_IDENTIFIER = 'Exp:';

interface QuizAddViaDocumentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onQuestionsReady: (questions: UploadQuestionPaperFormType['questions']) => void;
}

const QuizAddViaDocumentDialog = ({
    open,
    onOpenChange,
    onQuestionsReady,
}: QuizAddViaDocumentDialogProps) => {
    const { t } = useTranslation('studyLibraryQuizAddViaDocumentDialog');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setError(null);
            setUploadProgress(0);
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) {
            setError(t('errors.noFileSelected'));
            return;
        }
        setIsUploading(true);
        setError(null);
        try {
            const rawData = await uploadDocsFile(
                QUESTION_IDENTIFIER,
                OPTION_IDENTIFIER,
                ANSWER_IDENTIFIER,
                EXPLANATION_IDENTIFIER,
                selectedFile,
                setUploadProgress
            );

            const questions: UploadQuestionPaperFormType['questions'] =
                transformResponseDataToMyQuestionsSchema(rawData);

            if (!questions || questions.length === 0) {
                setError(t('errors.noQuestionsFound'));
                return;
            }

            onQuestionsReady(questions);
            handleReset();
            onOpenChange(false);
        } catch (err: any) {
            setError(err?.message || t('errors.parseFailed'));
        } finally {
            setIsUploading(false);
        }
    };

    const handleReset = () => {
        setSelectedFile(null);
        setUploadProgress(0);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen) handleReset();
        onOpenChange(nextOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="no-scrollbar !m-0 flex h-auto !w-full !max-w-lg flex-col !gap-0 overflow-y-auto !rounded-lg !p-0">
                {/* Header */}
                <div className="flex items-center justify-between bg-primary-50 px-5 py-4">
                    <h1 className="font-semibold text-primary-500">{t('title')}</h1>
                    <button
                        type="button"
                        className="text-neutral-500 hover:text-neutral-700"
                        onClick={() => onOpenChange(false)}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex flex-col gap-5 p-5">
                    {/* Required format reference */}
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                        <p className="mb-2 text-xs font-semibold text-neutral-700">
                            {t('requiredFormat.heading')}
                        </p>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-neutral-600">
                            {/* Section markers below (Questions*, Options*, Ans:, Exp:) are
                                literal identifiers the uploaded document must contain verbatim —
                                not translated UI copy. */}
                            <div>
                                <span className="font-semibold text-primary-600">Questions*</span>
                                <span className="ml-2 text-neutral-400">
                                    {t('requiredFormat.sectionHeader')}
                                </span>
                            </div>
                            <div>
                                <span className="font-semibold text-primary-600">Options*</span>
                                <span className="ml-2 text-neutral-400">
                                    {t('requiredFormat.sectionHeader')}
                                </span>
                            </div>
                            <div className="text-neutral-500">{t('requiredFormat.questionSample')}</div>
                            <div className="text-neutral-500">{t('requiredFormat.optionSample')}</div>
                            <div>
                                <span className="font-semibold text-primary-600">Ans:</span>
                                <span className="ml-2 text-neutral-400">
                                    {t('requiredFormat.correctAnswer')}
                                </span>
                            </div>
                            <div>
                                <span className="font-semibold text-primary-600">Exp:</span>
                                <span className="ml-2 text-neutral-400">
                                    {t('requiredFormat.explanation')}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* File drop zone */}
                    <div
                        className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-8 transition-colors hover:border-primary-400 hover:bg-primary-50"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <FileDoc size={40} className="text-primary-400" />
                        {selectedFile ? (
                            <div className="text-center">
                                <p className="text-sm font-medium text-primary-600">
                                    {selectedFile.name}
                                </p>
                                <p className="text-xs text-neutral-500">
                                    {(selectedFile.size / 1024).toFixed(1)} KB
                                </p>
                            </div>
                        ) : (
                            <div className="text-center">
                                <p className="text-sm font-medium text-neutral-700">
                                    {t('dropZone.clickToSelect')}
                                </p>
                                <p className="text-xs text-neutral-400">
                                    {t('dropZone.supportedFormats')}
                                </p>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".docx,.html,.doc"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </div>

                    {/* Progress */}
                    {isUploading && (
                        <div className="flex flex-col gap-2">
                            <Progress value={uploadProgress} className="h-2" />
                            <p className="text-center text-xs text-neutral-500">
                                {t('parsingProgress', { progress: uploadProgress })}
                            </p>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                            {error}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 border-t border-neutral-200 px-5 py-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={() => onOpenChange(false)}
                        disabled={isUploading}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={handleUpload}
                        disabled={!selectedFile || isUploading}
                    >
                        <UploadSimple size={16} />
                        {isUploading ? t('processing') : t('parseAndPreview')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default QuizAddViaDocumentDialog;
