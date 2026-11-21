import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Eye } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { getInstituteId } from '@/constants/helper';
import { getPublicUrl } from '@/services/upload_file';
import { UploadAnswerSheetDialog } from '@/routes/evaluation/evaluate/$assessmentId/$attemptId/$examType/-components/UploadAnswerSheetDialog';
import { FilePreviewDialog } from './FilePreviewDialog';
import { getAttemptData } from '../-services/assessment-details-services';

// Submissions-table cell for MANUAL evaluation assessments: shows whether the
// attempt has a submitted answer-sheet file. "Submitted" is clickable and opens
// the file; otherwise the admin can upload one on the student's behalf.
// Shares the ['GET_ATTEMPT_SUBMISSION_FILE', attemptId] cache with the row
// dropdown; AssessmentSubmissionsTab batch-seeds it per page so this cell
// normally never fires its own request.
export const SubmissionFileCell = ({
    attemptId,
    studentName,
}: {
    attemptId: string;
    studentName?: string;
}) => {
    const { t } = useTranslation('assessmentSubmissionFileCell');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const [uploadOpen, setUploadOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const fileQuery = useQuery({
        queryKey: ['GET_ATTEMPT_SUBMISSION_FILE', attemptId],
        queryFn: async () => ((await getAttemptData(attemptId)) as string | null) ?? null,
        enabled: !!attemptId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });

    // Preview in an in-app dialog instead of a new tab — stored files often lack
    // an extension, so a browser tab would download an unopenable file instead
    // of rendering it. The dialog also offers a correct-extension download.
    const handleViewSubmission = async () => {
        try {
            const url = await getPublicUrl(fileQuery.data as string);
            if (!url) throw new Error('No file URL');
            setPreviewUrl(url);
            setPreviewOpen(true);
        } catch (error) {
            console.error('Failed to load submission:', error);
            toast.error(t('loadFailedError'));
        }
    };

    if (fileQuery.isLoading) {
        return <span className="text-caption text-neutral-400">{t('checking')}</span>;
    }

    if (fileQuery.data) {
        return (
            <div className="flex items-center gap-2">
                <StatusChip text={t('submitted')} textSize="text-caption" status="SUCCESS" />
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="w-8 !min-w-8"
                    title={t('viewSubmission')}
                    onClick={handleViewSubmission}
                >
                    <Eye size={16} />
                </MyButton>
                <FilePreviewDialog
                    open={previewOpen}
                    onOpenChange={setPreviewOpen}
                    fileUrl={previewUrl}
                    heading={t('submissionHeading')}
                    downloadName={`${t('fileNamePrefix')}-${studentName || attemptId}`}
                />
            </div>
        );
    }

    // No file (or the attempt data couldn't be read) — offer an on-behalf upload.
    return (
        <div className="flex items-center gap-2">
            <StatusChip text={t('notSubmitted')} textSize="text-caption" status="WARNING" />
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                onClick={() => setUploadOpen(true)}
            >
                {t('upload')}
            </MyButton>
            <UploadAnswerSheetDialog
                attemptId={attemptId}
                instituteId={instituteId}
                open={uploadOpen}
                onOpenChange={setUploadOpen}
                onUploaded={(fileId) =>
                    // Flip the shared cache so this badge and the row dropdown
                    // immediately show the submission.
                    queryClient.setQueryData(['GET_ATTEMPT_SUBMISSION_FILE', attemptId], fileId)
                }
            />
        </div>
    );
};
