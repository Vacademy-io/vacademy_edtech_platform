// add-modules-form.tsx
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { CONTENT_DESCRIPTION_MAX_LENGTH } from '@/constants/study-library/content-description';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { ImageCropperDialog } from '@/components/design-system/image-cropper-dialog';
import { Module } from '@/stores/study-library/use-modules-with-chapters-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useState, useRef, useEffect } from 'react';
import { Image, X } from '@phosphor-icons/react';
import { getUserId } from '@/utils/userDetails';
import { useInstitute } from '@/hooks/auth/useInstitute';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const buildFormSchema = (t: TFunction) =>
    z.object({
        moduleName: z.string().min(1, t('validation.moduleNameRequired')),
        description: z
            .string()
            .max(
                CONTENT_DESCRIPTION_MAX_LENGTH,
                t('validation.descriptionMaxLength', { max: CONTENT_DESCRIPTION_MAX_LENGTH })
            )
            .optional(),
        thumbnailFile: z.any().optional(),
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface AddModulesFormProps {
    initialValues?: Module;
    onSubmitSuccess: (module: Module) => void;
}

export const AddModulesForm = ({ initialValues, onSubmitSuccess }: AddModulesFormProps) => {
    const { t } = useTranslation('studyLibraryAddModulesForm');
    const formSchema = buildFormSchema(t);
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');
    const [cropperOpen, setCropperOpen] = useState(false);
    const [croppedImage, setCroppedImage] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isLoadingExistingImage, setIsLoadingExistingImage] = useState(false);
    const [thumbnailRemoved, setThumbnailRemoved] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const initialThumbnailLoadedRef = useRef(false);
    const { uploadFile, getPublicUrl } = useFileUpload();
    const { currentInstituteId } = useInstitute();

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            moduleName: initialValues?.module_name || '',
            description: initialValues?.description || '',
            thumbnailFile: null,
        },
    });

    // Load existing thumbnail when editing
    useEffect(() => {
        const loadExistingThumbnail = async () => {
            if (
                initialValues?.thumbnail_id &&
                !initialThumbnailLoadedRef.current &&
                !thumbnailRemoved
            ) {
                try {
                    setIsLoadingExistingImage(true);
                    const thumbnailUrl = await getPublicUrl(initialValues.thumbnail_id);
                    if (thumbnailUrl && !thumbnailRemoved) {
                        setImagePreviewUrl(thumbnailUrl);
                        initialThumbnailLoadedRef.current = true;
                    }
                } catch (error) {
                    console.error('Failed to load existing thumbnail:', error);
                } finally {
                    setIsLoadingExistingImage(false);
                }
            }
        };

        loadExistingThumbnail();
    }, [initialValues?.thumbnail_id, getPublicUrl, thumbnailRemoved]);

    const handleImageSelect = (file: File) => {
        if (file.type.startsWith('image/')) {
            setSelectedImage(file);
            const previewUrl = URL.createObjectURL(file);
            setImagePreviewUrl(previewUrl);
            setCropperOpen(true);
            setThumbnailRemoved(false); // Reset removal flag when new image is selected
            initialThumbnailLoadedRef.current = true; // Mark as loaded to prevent useEffect from overriding
        }
    };

    const handleImageCropped = (croppedFile: File) => {
        setCroppedImage(croppedFile);
        const previewUrl = URL.createObjectURL(croppedFile);
        setImagePreviewUrl(previewUrl);
        setCropperOpen(false);
    };

    const handleRemoveImage = () => {
        setSelectedImage(null);
        setCroppedImage(null);
        setImagePreviewUrl('');
        setCropperOpen(false);
        setThumbnailRemoved(true);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        // Clean up any object URLs to prevent memory leaks
        if (imagePreviewUrl && imagePreviewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(imagePreviewUrl);
        }
    };

    const onSubmit = async (data: FormValues) => {
        let thumbnailId = initialValues?.thumbnail_id || '';

        // Handle thumbnail logic
        if (thumbnailRemoved) {
            // User explicitly removed the thumbnail
            thumbnailId = '';
        } else if (croppedImage) {
            // User selected and cropped a new image
            try {
                setIsUploading(true);
                const uploadedId = await uploadFile({
                    file: croppedImage,
                    setIsUploading: () => {},
                    userId: getUserId(),
                    source: currentInstituteId || 'DEFAULT',
                    sourceId: 'MODULE_THUMBNAILS',
                    publicUrl: true,
                });
                thumbnailId = uploadedId || '';
            } catch (error) {
                console.error('Failed to upload thumbnail:', error);
            } finally {
                setIsUploading(false);
            }
        }
        // If neither thumbnailRemoved nor croppedImage, keep existing thumbnailId

        const newModule = {
            id: initialValues?.id || '',
            module_name: data.moduleName,
            description: data.description?.trim() || '',
            status: initialValues?.status || '',
            thumbnail_id: thumbnailId,
        };
        onSubmitSuccess(newModule);
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex w-full flex-col gap-6 text-neutral-600"
            >
                <FormField
                    control={form.control}
                    name="moduleName"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    label={t('moduleNameLabel', {
                                        term: getTerminology(
                                            ContentTerms.Modules,
                                            SystemTerms.Modules
                                        ),
                                    })}
                                    required={true}
                                    inputType="text"
                                    inputPlaceholder={t('moduleNamePlaceholder', {
                                        term: getTerminology(
                                            ContentTerms.Modules,
                                            SystemTerms.Modules
                                        ),
                                    })}
                                    className="w-[352px]"
                                    input={field.value}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    label={t('descriptionLabel')}
                                    inputType="text"
                                    inputPlaceholder={t('descriptionPlaceholder')}
                                    className="w-[352px]"
                                    input={field.value || ''}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                    maxLength={CONTENT_DESCRIPTION_MAX_LENGTH}
                                />
                            </FormControl>
                            <p className="text-caption text-neutral-400">
                                {t('descriptionHint', {
                                    term: getTerminology(
                                        ContentTerms.Modules,
                                        SystemTerms.Modules
                                    ).toLowerCase(),
                                    count: (field.value || '').length,
                                    max: CONTENT_DESCRIPTION_MAX_LENGTH,
                                })}
                            </p>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {/* Thumbnail Image Upload Section */}
                <div className="flex flex-col gap-2">
                    <label className="text-subtitle font-regular text-neutral-600">
                        {t('thumbnailImage')}
                    </label>
                    {isLoadingExistingImage ? (
                        <div className="flex h-[120px] w-[200px] items-center justify-center rounded-lg border border-neutral-300 bg-neutral-50">
                            <div className="text-sm text-neutral-500">
                                {t('loadingThumbnail')}
                            </div>
                        </div>
                    ) : imagePreviewUrl && !thumbnailRemoved ? (
                        <div className="relative h-[120px] w-[200px] overflow-hidden rounded-lg border border-neutral-300">
                            <img
                                src={imagePreviewUrl}
                                alt={t('thumbnailPreviewAlt')}
                                className="size-full object-cover"
                            />
                            <button
                                type="button"
                                onClick={handleRemoveImage}
                                className="absolute right-2 top-2 rounded-full bg-white p-1 shadow-md hover:bg-gray-50"
                            >
                                <X className="size-4 text-gray-600" />
                            </button>
                        </div>
                    ) : (
                        <FileUploadComponent
                            fileInputRef={fileInputRef}
                            onFileSubmit={handleImageSelect}
                            control={form.control}
                            name="thumbnailFile"
                            acceptedFileTypes={['image/jpeg', 'image/png']}
                            isUploading={isUploading}
                            className="h-[120px] w-[200px] rounded-lg border-2 border-dashed border-neutral-300 transition-colors hover:border-primary-300"
                        >
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
                                <Image className="size-8" />
                                <span className="text-sm font-medium">
                                    {t('uploadThumbnail')}
                                </span>
                                <span className="text-xs text-neutral-400">
                                    {t('uploadThumbnailHint')}
                                </span>
                            </div>
                        </FileUploadComponent>
                    )}
                </div>

                <div className="flex items-start">
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        scale="large"
                        layoutVariant="default"
                        disabled={isUploading}
                    >
                        {isUploading ? t('uploading') : initialValues ? t('saveChanges') : t('add')}
                    </MyButton>
                </div>
            </form>

            {/* Image Cropper Dialog */}
            {selectedImage && (
                <ImageCropperDialog
                    open={cropperOpen}
                    onOpenChange={setCropperOpen}
                    src={imagePreviewUrl}
                    aspectRatio={16 / 9} // 16:9 ratio to match the display tile (no crop on display)
                    title={t('cropModuleThumbnail')}
                    outputMimeType="image/jpeg"
                    outputQuality={0.9}
                    onCropped={handleImageCropped}
                />
            )}
        </Form>
    );
};
