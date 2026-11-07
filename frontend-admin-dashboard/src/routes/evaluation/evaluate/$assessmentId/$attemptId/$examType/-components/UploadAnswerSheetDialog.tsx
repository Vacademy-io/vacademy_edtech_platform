import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FileArrowUp, UploadSimple } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { Form } from '@/components/ui/form';
import { useFileUpload } from '@/hooks/use-file-upload';
import { ensureFileHasExtension } from '@/lib/file-download';
import { handleUpdateAttempt } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { FileType } from '@/types/common/file-upload';
import { useTranslation } from 'react-i18next';

const ACCEPTED_FILE_TYPES: FileType[] = ['application/pdf'];

interface UploadAnswerSheetDialogProps {
    attemptId: string;
    instituteId?: string;
    // Called once the file is uploaded and attached to the attempt, with the new
    // file id so the caller can immediately load the answer sheet.
    onUploaded: (fileId: string) => void;
    trigger?: React.ReactNode;
    // Controlled mode — for callers that open the dialog from a menu item
    // instead of a trigger node (a trigger inside a dropdown unmounts with it).
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

interface UploadForm {
    file: FileList | null;
}

// Lets an admin upload a student's answer sheet on their behalf — for when the
// learner couldn't submit in-app and instead shared it over email/WhatsApp.
export const UploadAnswerSheetDialog = ({
    attemptId,
    instituteId,
    onUploaded,
    trigger,
    open: controlledOpen,
    onOpenChange,
}: UploadAnswerSheetDialogProps) => {
    const { t } = useTranslation('evaluationUploadAnswerSheetDialog');
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = (next: boolean) => {
        if (isControlled) onOpenChange?.(next);
        else setInternalOpen(next);
    };
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile } = useFileUpload();
    const form = useForm<UploadForm>({ defaultValues: { file: null } });

    const userId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';

    const reset = () => {
        setSelectedFile(null);
        setIsProcessing(false);
        form.reset();
    };

    const handleOpenChange = (next: boolean) => {
        if (isProcessing) return; // don't let the dialog close mid-upload
        setOpen(next);
        if (!next) reset();
    };

    const handleSubmit = async () => {
        if (!selectedFile) return;
        setIsProcessing(true);
        try {
            const newFileId = await uploadFile({
                // Ensure the answer sheet carries a correct extension so it later
                // downloads/opens as e.g. `.pdf` rather than an extension-less file.
                file: ensureFileHasExtension(selectedFile),
                setIsUploading: setIsProcessing,
                userId,
                source: instituteId,
                sourceId: 'ASSESSMENT_MANUAL_EVALUATION',
            });
            if (!newFileId) throw new Error(t('uploadFailedTryAgain'));

            await handleUpdateAttempt(attemptId, newFileId);
            toast.success(t('answerSheetUploaded'));
            onUploaded(newFileId);
            setOpen(false);
            reset();
        } catch (error) {
            console.error('Failed to upload answer sheet:', error);
            // Backend errors carry the admin-facing message in `ex` (ErrorInfo shape),
            // e.g. "The student's attempt is still in progress (LIVE)…".
            const backendMessage = (error as { response?: { data?: { ex?: string } } })?.response
                ?.data?.ex;
            toast.error(
                backendMessage ??
                    (error instanceof Error ? error.message : t('couldNotUploadAnswerSheet'))
            );
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={handleOpenChange}
            heading={t('uploadStudentAnswerSheetHeading')}
            trigger={trigger}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        disable={isProcessing}
                        onClick={() => handleOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        disable={!selectedFile}
                        onAsyncClick={handleSubmit}
                        loadingText={t('uploadingEllipsis')}
                    >
                        {t('uploadAndView')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm text-neutral-500">{t('uploadOnBehalfHint')}</p>

                <Form {...form}>
                    <FileUploadComponent
                        fileInputRef={fileInputRef}
                        onFileSubmit={(file) => setSelectedFile(file)}
                        control={form.control}
                        name="file"
                        acceptedFileTypes={ACCEPTED_FILE_TYPES}
                        isUploading={isProcessing}
                    >
                        {selectedFile ? (
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-4">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <FileArrowUp className="size-6 shrink-0 text-primary-500" />
                                    <span className="truncate text-sm text-neutral-700">
                                        {selectedFile.name}
                                    </span>
                                </div>
                                <span className="shrink-0 text-xs font-medium text-primary-500">
                                    {t('change')}
                                </span>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 p-8 text-center hover:border-primary-300">
                                <UploadSimple className="size-8 text-neutral-400" />
                                <p className="text-sm font-medium text-neutral-700">
                                    {t('clickToUploadOrDrag')}
                                </p>
                                <p className="text-xs text-neutral-400">{t('pdfOnly')}</p>
                            </div>
                        )}
                    </FileUploadComponent>
                </Form>
            </div>
        </MyDialog>
    );
};
