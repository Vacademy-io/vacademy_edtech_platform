'use client';

import type React from 'react';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { useSlidesMutations } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { toast } from 'sonner';
import { Route } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/index';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useMemo, useState } from 'react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import { Textarea } from '@/components/ui/textarea';
import { Package } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { SCORM_UPLOAD } from '@/constants/urls';
import {
    formatBytes,
    MAX_SCORM_BYTES,
} from '@/components/common/study-library/bulk-content-uploading/conventions';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';
import axios from 'axios';
import { WarningCircle } from '@phosphor-icons/react';

// Backend returns a Vacademy exception body ({ ex, responseCode, ... }) rather
// than a generic message, so surface that instead of a one-size-fits-all
// "upload failed" toast the admin then has to dig out of devtools.
const getScormUploadErrorMessage = (err: unknown, t: TFunction): string => {
    if (axios.isAxiosError(err)) {
        const data = err.response?.data as
            | { ex?: string; responseCode?: string; detail?: string }
            | undefined;
        return data?.ex || data?.responseCode || data?.detail || err.message;
    }
    return err instanceof Error ? err.message : t('toasts.uploadFailed');
};

const buildFormSchema = (t: TFunction) =>
    z.object({
        title: z.string().min(1, t('validation.titleRequired')),
        description: z.string().optional(),
        scormFile: z.instanceof(File, { message: t('validation.scormFileRequired') }),
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface ScormUploadResponse {
    id: string;
    launch_path: string;
    original_file_id: string;
    scorm_version: string;
}

export const AddScormDialog = ({ openState }: { openState?: (open: boolean) => void }) => {
    const { t } = useTranslation('studyLibraryAddScormDialog');
    const formSchema = useMemo(() => buildFormSchema(t), [t]);
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();
    const { addUpdateScormSlide, updateSlideOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );

    const { setActiveItem, getSlideById, items } = useContentStore();
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadProgress, setUploadProgress] = useState<string>('');
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [scormUploadResult, setScormUploadResult] = useState<ScormUploadResponse | null>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            title: '',
            description: '',
        },
    });

    /**
     * The zip is POSTed whole to admin_core_service, which caps multipart bodies at
     * MAX_SCORM_BYTES. Past that, Tomcat rejects on Content-Length and commits its response
     * while the browser is still uploading, so the connection is reset and the reason never
     * reaches JS — axios surfaces a bare "Network Error" after a long, pointless upload.
     * Refuse it here instead, naming both the file's size and the limit.
     */
    const rejectIfTooLarge = (file: File) => {
        if (file.size <= MAX_SCORM_BYTES) return false;
        const message = t('toasts.fileTooLarge', {
            size: formatBytes(file.size),
            max: formatBytes(MAX_SCORM_BYTES),
        });
        setSelectedFile(file);
        setScormUploadResult(null);
        setUploadProgress('');
        setUploadError(message);
        toast.error(message, { duration: 8000 });
        return true;
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.endsWith('.zip')) {
                toast.error(t('toasts.selectZipFile'));
                return;
            }
            if (rejectIfTooLarge(file)) return;
            setUploadError(null);
            setSelectedFile(file);
            form.setValue('scormFile', file);
            form.setValue('title', file.name.replace(/\.zip$/i, ''));

            // Immediately upload the SCORM package
            await uploadScormPackage(file);
        }
    };

    const uploadScormPackage = async (file: File) => {
        try {
            setUploadError(null);
            setUploadProgress(t('toasts.uploading'));
            const formData = new FormData();
            formData.append('file', file);

            const response = await authenticatedAxiosInstance.post(SCORM_UPLOAD, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const result: ScormUploadResponse = response.data;
            setScormUploadResult(result);
            setUploadProgress(
                t('toasts.uploadSuccessDetected', { version: result.scorm_version })
            );
            toast.success(t('toasts.uploadParseSuccess'));
        } catch (err) {
            console.error('SCORM upload failed:', err);
            const message = getScormUploadErrorMessage(err, t);
            setUploadProgress('');
            setScormUploadResult(null);
            setUploadError(message);
            toast.error(message, { duration: 8000 });
        }
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && file.name.endsWith('.zip')) {
            if (rejectIfTooLarge(file)) return;
            setUploadError(null);
            setSelectedFile(file);
            form.setValue('scormFile', file);
            form.setValue('title', file.name.replace(/\.zip$/i, ''));
            await uploadScormPackage(file);
        } else {
            toast.error(t('toasts.dropZipFile'));
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const reorderSlidesAfterNewSlide = async (newSlideId: string) => {
        try {
            const currentSlides = items || [];
            const newSlide = currentSlides.find((slide) => slide.id === newSlideId);
            if (!newSlide) return;

            const reorderedSlides = buildAppendReorderPayload(newSlideId, currentSlides);

            await updateSlideOrder({
                chapterId: chapterId || '',
                slideOrderPayload: reorderedSlides,
            });

            setTimeout(() => {
                setActiveItem(getSlideById(newSlideId));
            }, 500);
        } catch (error) {
            toast.error(t('toasts.reorderFailed'));
        }
    };

    const handleSubmit = async (data: FormValues) => {
        if (!scormUploadResult) {
            toast.error(t('toasts.waitForUpload'));
            return;
        }

        try {
            setIsUploading(true);

            const slideId = crypto.randomUUID();
            const slideStatus = getSlideStatusForUser();
            const response = await addUpdateScormSlide({
                id: slideId,
                title: data.title,
                description: data.description || null,
                status: slideStatus as 'DRAFT' | 'PUBLISHED',
                slide_order: getNextSlideOrder(items || []),
                new_slide: true,
                scorm_slide: {
                    id: scormUploadResult.id,
                },
            });

            if (response) {
                await reorderSlidesAfterNewSlide(slideId);
                openState?.(false);
                toast.success(t('toasts.createSuccess'));
            }

            form.reset();
            setSelectedFile(null);
            setScormUploadResult(null);
            setUploadProgress('');
            setUploadError(null);
        } catch (error) {
            console.error('Error creating SCORM slide:', error);
            toast.error(getScormUploadErrorMessage(error, t) || t('toasts.createFailed'));
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="flex w-full flex-col gap-6 text-neutral-600"
            >
                {/* SCORM File Upload */}
                <div
                    className="cursor-pointer rounded-lg border-2 border-dashed border-primary-400 p-8 text-center transition-colors hover:border-primary-500 hover:bg-primary-50/30"
                    onClick={() => document.getElementById('scorm-file-upload')?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
                    <div className="flex flex-col items-center justify-center">
                        <div className="mb-4 text-primary-500">
                            <Package size={48} weight="duotone" />
                        </div>
                        <h3 className="text-xl font-medium text-primary-500">
                            {t('dropzone.title')}
                        </h3>
                        <p className="mt-1 text-gray-500">{t('dropzone.hint')}</p>
                        <p className="mt-1 text-xs text-gray-400">
                            {t('dropzone.formats')}
                        </p>
                        {selectedFile && (
                            <div
                                className={`mt-3 rounded-md p-2 ${uploadError ? 'bg-danger-50' : 'bg-primary-50'}`}
                            >
                                <p
                                    className={`text-sm font-medium ${uploadError ? 'text-danger-700' : 'text-primary-700'}`}
                                >
                                    {t('dropzone.selected', { fileName: selectedFile.name })}
                                </p>
                                {uploadProgress && (
                                    <p className="mt-1 text-xs text-primary-600">{uploadProgress}</p>
                                )}
                            </div>
                        )}
                    </div>
                    <input
                        id="scorm-file-upload"
                        type="file"
                        accept=".zip"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                </div>

                {/* Upload error (raw backend reason, so the admin isn't left guessing) */}
                {uploadError && (
                    <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3">
                        <WarningCircle
                            size={18}
                            weight="fill"
                            className="mt-0.5 shrink-0 text-danger-600"
                        />
                        <div className="text-xs text-danger-700">
                            <p className="font-medium">{uploadError}</p>
                            {uploadError.toLowerCase().includes('imsmanifest') && (
                                <p className="mt-1 text-danger-600">
                                    {t('errors.imsManifestHintPrefix')} <code>imsmanifest.xml</code>{' '}
                                    {t('errors.imsManifestHintSuffix')}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Hidden input for Zod validation */}
                <FormField
                    control={form.control}
                    name="scormFile"
                    render={() => (
                        <FormItem className="hidden">
                            <FormControl>
                                <input type="file" />
                            </FormControl>
                        </FormItem>
                    )}
                />

                {/* Title Input */}
                <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t('fields.title')}</FormLabel>
                            <FormControl>
                                <MyInput
                                    inputType="text"
                                    inputPlaceholder={t('fields.titlePlaceholder')}
                                    input={field.value}
                                    onChangeFunction={field.onChange}
                                    size="large"
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {/* Description Input */}
                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t('fields.description')}</FormLabel>
                            <FormControl>
                                <Textarea
                                    placeholder={t('fields.descriptionPlaceholder')}
                                    className="min-h-[80px] resize-none"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {/* SCORM Details (if uploaded) */}
                {scormUploadResult && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                        <h4 className="mb-2 text-sm font-medium text-green-800">
                            {t('details.title')}
                        </h4>
                        <div className="space-y-1 text-xs text-green-700">
                            <p>
                                <span className="font-medium">{t('details.versionLabel')}</span>{' '}
                                {t('details.versionValue', { version: scormUploadResult.scorm_version })}
                            </p>
                            <p>
                                <span className="font-medium">{t('details.launchFileLabel')}</span>{' '}
                                {scormUploadResult.launch_path?.split('/').pop() || 'index.html'}
                            </p>
                        </div>
                    </div>
                )}

                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    disabled={isUploading || !selectedFile || !scormUploadResult}
                    className={`
                        w-full transition-all duration-300 ease-in-out
                        ${
                            isUploading || !selectedFile || !scormUploadResult
                                ? 'cursor-not-allowed opacity-50'
                                : 'shadow-lg hover:scale-105 hover:shadow-xl active:scale-95'
                        }
                    `}
                >
                    {isUploading ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            {t('actions.creatingSlide')}
                        </div>
                    ) : (
                        t('actions.createSlide')
                    )}
                </MyButton>
            </form>
        </Form>
    );
};
