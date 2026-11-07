// add-subject-form.tsx
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import * as z from 'zod';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
    FormLabel,
} from '@/components/ui/form';
import { SubjectType } from '@/stores/study-library/use-study-library-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useState, useRef } from 'react';
import { getInstituteId } from '@/constants/helper';
import { Input } from '@/components/ui/input';
import { ImageSquare, X } from '@phosphor-icons/react';
import { ImageCropperDialog } from '@/components/design-system/image-cropper-dialog';
import type { TFunction } from 'i18next';

const buildFormSchema = (t: TFunction) =>
    z.object({
        subjectName: z.string().min(1, t('validation.subjectNameRequired')),
        imageFile: z.any().optional(),
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface AddSubjectFormProps {
    onSubmitSuccess: (subject: SubjectType) => void;
    initialValues?: SubjectType;
}

export const AddSubjectForm = ({ onSubmitSuccess, initialValues }: AddSubjectFormProps) => {
    const { t } = useTranslation('studyLibraryAddSubjectForm');
    const { uploadFile } = useFileUpload();
    const instituteId = getInstituteId();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadedImageId, setUploadedImageId] = useState<string>(
        initialValues?.thumbnail_id || ''
    );
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string>('');
    const [cropperOpen, setCropperOpen] = useState(false);
    const [cropSrc, setCropSrc] = useState<string>('');

    const form = useForm<FormValues>({
        resolver: zodResolver(buildFormSchema(t)),
        defaultValues: {
            subjectName: initialValues?.subject_name || '',
            imageFile: null,
        },
    });

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            // Open the cropper on the raw image; the cropped result becomes the upload
            const url = URL.createObjectURL(file);
            setCropSrc(url);
            setCropperOpen(true);
        }
    };

    const handleImageCropped = (croppedFile: File) => {
        setSelectedFile(croppedFile);
        const url = URL.createObjectURL(croppedFile);
        setPreviewUrl(url);
        setCropperOpen(false);
    };

    const clearSelectedFile = () => {
        setSelectedFile(null);
        setPreviewUrl('');
        setCropSrc('');
        setUploadedImageId('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const onSubmit = async (data: FormValues) => {
        let thumbnailId = uploadedImageId;

        // Upload image if a new file is selected
        if (selectedFile) {
            try {
                setIsUploading(true);
                const fileId = await uploadFile({
                    file: selectedFile,
                    setIsUploading: setIsUploading,
                    userId: 'user-id',
                    source: instituteId,
                    sourceId: 'SUBJECT_IMAGE',
                });
                thumbnailId = fileId || '';
            } catch (error) {
                console.error('Failed to upload image:', error);
                setIsUploading(false);
                return;
            }
        }

        const newSubject: SubjectType = {
            id: initialValues?.id || crypto.randomUUID(),
            subject_name: data.subjectName,
            subject_code: '',
            credit: 0,
            thumbnail_id: thumbnailId || null,
            created_at: initialValues?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        onSubmitSuccess(newSubject);
        setIsUploading(false);
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex w-full flex-col gap-6 text-neutral-600"
            >
                <FormField
                    control={form.control}
                    name="subjectName"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    label={t('nameLabel', {
                                        subject: getTerminology(
                                            ContentTerms.Subjects,
                                            SystemTerms.Subjects
                                        ),
                                    })}
                                    required={true}
                                    inputType="text"
                                    inputPlaceholder={t('namePlaceholder', {
                                        subject: getTerminology(
                                            ContentTerms.Subjects,
                                            SystemTerms.Subjects
                                        ),
                                    })}
                                    className="w-[352px]"
                                    input={field.value}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {/* Image Upload Section */}
                <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">
                        {t('imageLabel', {
                            subject: getTerminology(ContentTerms.Subjects, SystemTerms.Subjects),
                        })}
                    </FormLabel>
                    <div className="space-y-3">
                        {/* File Input */}
                        <Input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileSelect}
                            className="hidden"
                        />

                        {/* Upload Button or Preview */}
                        {!previewUrl ? (
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition-colors hover:border-primary-400 hover:bg-primary-50"
                            >
                                <ImageSquare size={32} className="mx-auto mb-2 text-gray-400" />
                                <p className="mb-1 text-sm text-gray-600">
                                    {t('clickToUpload')}
                                </p>
                                <p className="text-xs text-gray-400">{t('uploadHint')}</p>
                            </div>
                        ) : (
                            <div className="relative">
                                <img
                                    src={previewUrl}
                                    alt={t('previewAlt')}
                                    className="aspect-video w-full rounded-lg border object-cover"
                                />
                                <button
                                    type="button"
                                    onClick={clearSelectedFile}
                                    className="absolute right-2 top-2 rounded-full bg-red-100 p-1 transition-colors hover:bg-red-200"
                                >
                                    <X size={16} className="text-red-600" />
                                </button>
                            </div>
                        )}
                    </div>
                </FormItem>

                <div className="flex items-start gap-6">
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        layoutVariant="default"
                        scale="large"
                        disabled={isUploading}
                    >
                        {isUploading
                            ? t('uploading')
                            : initialValues
                              ? t('saveChanges')
                              : t('add')}
                    </MyButton>
                </div>
            </form>

            {/* Image Cropper Dialog */}
            {cropSrc && (
                <ImageCropperDialog
                    open={cropperOpen}
                    onOpenChange={setCropperOpen}
                    src={cropSrc}
                    aspectRatio={16 / 9} // 16:9 ratio to match the display tile (no crop on display)
                    title={t('cropTitle')}
                    outputMimeType="image/jpeg"
                    outputQuality={0.9}
                    onCropped={handleImageCropped}
                />
            )}
        </Form>
    );
};
