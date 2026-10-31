import { UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getInstituteId } from '@/constants/helper';
import { toast } from 'sonner';
import { handleStartProcessUploadedFile } from '../-services/ai-center-service';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

const UploadFileMyResourcesComponent = () => {
    const { t } = useTranslation('aiCenterUploadFileMyResourcesComponent');
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { uploadFile } = useFileUpload();
    const instituteId = getInstituteId();
    const [fileUploading, setFileUploading] = useState(false);
    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const fileId = await uploadFile({
                file,
                setIsUploading: setFileUploading,
                userId: 'your-user-id',
                source: instituteId,
                sourceId: 'STUDENTS',
            });
            if (fileId) {
                await handleStartProcessUploadedFile(fileId);
                toast.success(t('toast.success'));
                setTimeout(() => {
                    queryClient.invalidateQueries({ queryKey: ['GET_INDIVIDUAL_AI_LIST_DATA'] });
                }, 100);
            }
            event.target.value = '';
        }
    };

    return (
        <Dialog>
            <DialogTrigger>
                <MyButton type="button" scale="large" buttonType="primary" className="font-medium">
                    <UploadSimple size={32} />
                    {t('trigger.uploadButton')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="flex flex-col p-0">
                <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                    {t('dialog.title')}
                </h1>
                <div className="flex flex-col items-center justify-center gap-4 p-4">
                    {fileUploading ? (
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            className="!bg-white font-medium !text-white"
                        >
                            <DashboardLoader />
                        </MyButton>
                    ) : (
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            className="font-medium"
                            onClick={handleUploadClick}
                        >
                            {t('dialog.uploadButton')}
                        </MyButton>
                    )}
                    <Input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.html"
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default UploadFileMyResourcesComponent;
