import {
    Sidebar,
    SidebarContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/sidebar';
import { X } from '@phosphor-icons/react';
import { useState, useEffect, useRef } from 'react';
import { StatusChips } from '@/components/design-system/chips';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useMutation } from '@tanstack/react-query';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { MyButton } from '@/components/design-system/button';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { handleUpdateAttempt } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import DummyProfile from '@/assets/svgs/dummy_profile_photo.svg';
import { MyDialog } from '@/components/design-system/dialog';
import { useTranslation } from 'react-i18next';

interface FormData {
    file: FileList | null;
    fileId: string;
}
export const ParticipantSidebar = ({
    assessmentId,
    examType,
}: {
    assessmentId: string;
    examType: string;
}) => {
    const { t } = useTranslation('evaluationParticipantSidebar');
    const [isUploading, setIsUploading] = useState(false);
    const { state } = useSidebar();
    const [openUploadConfirm, setOpenUploadConfirm] = useState(false);
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const [error, setError] = useState<string | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [faceLoader, setFaceLoader] = useState(false);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    const { toggleSidebar } = useSidebar();
    const { uploadFile, getPublicUrl, isUploading: isUploadingFile } = useFileUpload();
    const [fileId, setFileId] = useState<string | undefined>(undefined);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { selectedStudent } = useStudentSidebar();
    const navigate = useNavigate();

    const form = useForm<FormData>({
        defaultValues: {
            file: null,
            fileId: '',
        },
    });

    useEffect(() => {
        if (state == 'expanded') {
            document.body.classList.add('sidebar-open');
        } else {
            document.body.classList.remove('sidebar-open');
        }

        // Cleanup on unmount
        return () => {
            document.body.classList.remove('sidebar-open');
        };
    }, [state]);

    useEffect(() => {
        const fetchImageUrl = async () => {
            if (selectedStudent?.face_file_id) {
                try {
                    setFaceLoader(true);
                    const url = await getPublicUrl(selectedStudent.face_file_id);
                    setImageUrl(url || '');
                    setFaceLoader(false);
                } catch (error) {
                    console.error('Failed to fetch image URL:', error);
                }
            } else setImageUrl(null);
        };

        fetchImageUrl();
    }, [selectedStudent?.face_file_id, selectedStudent]);

    const uploadAttempt = useMutation({
        mutationFn: async (payload: { attemptId: string; fileId: string }) => {
            const data = await handleUpdateAttempt(payload.attemptId, payload.fileId);
            return data;
        },
        onSuccess: () => {
            toast.success(t('attemptUploadSuccess'));
            setFileId(undefined);
        },
    });

    const handleFileSubmit = async (file: File) => {
        try {
            setIsUploading(true);
            const uploadedFileId = await uploadFile({
                file,
                setIsUploading,
                userId: 'your-user-id',
                source: INSTITUTE_ID,
                sourceId: 'SUBJECTS',
            });

            if (uploadedFileId) {
                setFileId(uploadedFileId);
                form.setValue('fileId', uploadedFileId);
                toast.success(t('fileUploadSuccess'));
            }
        } catch (error) {
            console.error('Upload failed:', error);
        } finally {
            setIsUploading(false);
        }
    };

    const handleUpload = async (data: FormData) => {
        setIsUploading(true);
        setError(null);
        console.log(data);
        try {
            if (fileId) {
                form.setValue('fileId', fileId);
                form.reset();
                if (selectedStudent?.attempt_id)
                    await uploadAttempt.mutateAsync({
                        attemptId: selectedStudent?.attempt_id,
                        fileId,
                    });
            }
        } catch (err) {
            // Backend errors carry the admin-facing message in `ex` (ErrorInfo shape),
            // e.g. "The student's attempt is still in progress (LIVE)…".
            const backendMessage = (err as { response?: { data?: { ex?: string } } })?.response
                ?.data?.ex;
            const errorMessage =
                backendMessage ?? (err instanceof Error ? err.message : t('uploadFailedRetry'));
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Sidebar side="right">
            <SidebarContent
                className={`sidebar-content flex flex-col gap-10 border-r-2 border-r-neutral-300 bg-primary-50 p-6 text-neutral-600`}
            >
                <SidebarHeader>
                    <div className={`flex flex-col items-center justify-center gap-10`}>
                        <div className={`flex w-full items-center justify-between`}>
                            <div className="text-h3 font-semibold text-primary-500">
                                {t('participantDetails')}
                            </div>
                            <X
                                className="size-6 cursor-pointer text-neutral-500"
                                onClick={() => {
                                    toggleSidebar();
                                }}
                            />
                        </div>
                    </div>
                </SidebarHeader>

                <SidebarMenu className="no-scrollbar flex size-full flex-col gap-10 overflow-y-scroll">
                    <SidebarMenuItem className="flex w-full flex-col gap-6">
                        <div className="size-60 w-full items-center justify-center">
                            <div className="size-full rounded-full object-cover">
                                {faceLoader ? (
                                    <DashboardLoader />
                                ) : imageUrl == null ? (
                                    <DummyProfile className="size-full" />
                                ) : (
                                    <div className="flex w-full items-center justify-center">
                                        <img
                                            src={imageUrl}
                                            alt={t('faceProfileAlt')}
                                            className={`size-60 rounded-full object-cover`}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex w-full items-center justify-center gap-4">
                            <div className="text-h3 font-semibold text-neutral-600">
                                {selectedStudent?.full_name}
                            </div>
                            <StatusChips status={selectedStudent?.status || 'ACTIVE'} />
                        </div>
                    </SidebarMenuItem>

                    <SidebarMenuItem className="mt-auto flex justify-between">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(handleUpload)}>
                                <FileUploadComponent
                                    fileInputRef={fileInputRef}
                                    onFileSubmit={handleFileSubmit}
                                    control={form.control}
                                    name="file"
                                    isUploading={isUploading}
                                    error={error}
                                    className=""
                                />

                                <MyButton
                                    onClick={() => {
                                        setOpenUploadConfirm(true);
                                    }}
                                    disabled={isUploading || isUploadingFile}
                                    buttonType="secondary"
                                    scale="large"
                                    layoutVariant="default"
                                    type="button"
                                    className={cn('block', fileId && 'hidden')}
                                >
                                    {isUploading ? t('uploading') : t('uploadAttempt')}
                                </MyButton>

                                <MyButton
                                    buttonType="primary"
                                    scale="large"
                                    layoutVariant="default"
                                    type="submit"
                                    disabled={isUploading}
                                    className={cn('block', !fileId && 'hidden')}
                                >
                                    {t('submit')}
                                </MyButton>
                            </form>
                        </Form>
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            layoutVariant="default"
                            type="submit"
                            disabled={isUploading}
                            onClick={() => {
                                if (selectedStudent?.attempt_id)
                                    navigate({
                                        to: '/evaluation/evaluate/$assessmentId/$attemptId/$examType',
                                        params: {
                                            attemptId: selectedStudent?.attempt_id,
                                            assessmentId: assessmentId,
                                            examType: examType,
                                        },
                                    });
                            }}
                        >
                            {t('evaluate')}
                        </MyButton>
                    </SidebarMenuItem>
                    <MyDialog open={openUploadConfirm} heading={t('confirmUploadHeading')}>
                        <div className="flex flex-col gap-y-4">
                            <p>{t('confirmUploadBody')}</p>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="default"
                                type="submit"
                                onClick={() => {
                                    fileInputRef.current?.click();
                                    setOpenUploadConfirm(false);
                                }}
                                className="ms-auto"
                            >
                                {t('upload')}
                            </MyButton>
                        </div>
                    </MyDialog>
                </SidebarMenu>
            </SidebarContent>
        </Sidebar>
    );
};
