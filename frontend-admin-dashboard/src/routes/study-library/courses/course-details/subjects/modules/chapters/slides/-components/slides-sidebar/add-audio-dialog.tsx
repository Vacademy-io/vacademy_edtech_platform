'use client';

import type React from 'react';

import { useTranslation } from 'react-i18next';
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
import { useState } from 'react';
import { UploadFileInS3 } from '@/services/upload_file';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import { Textarea } from '@/components/ui/textarea';
import { MusicNotes } from '@phosphor-icons/react';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

const formSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    audioFile: z.instanceof(File, { message: 'Audio file is required' }),
    thumbnailFile: z.instanceof(File).optional(),
    transcript: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const INSTITUTE_ID = 'your-institute-id'; // Replace in real usage

export const AddAudioDialog = ({ openState }: { openState?: (open: boolean) => void }) => {
    const { t } = useTranslation('addAudioDialog');
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();
    const { addUpdateAudioSlide, updateSlideOrder } = useSlidesMutations(
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
    const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
    const [selectedThumbnailFile, setSelectedThumbnailFile] = useState<File | null>(null);
    const [audioDuration, setAudioDuration] = useState<number>(0);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            title: '',
            description: '',
            transcript: '',
        },
    });

    const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedAudioFile(file);
            form.setValue('audioFile', file);
            form.setValue('title', file.name.replace(/\.[^/.]+$/, '')); // remove extension

            // Get audio duration
            const audio = new Audio();
            audio.src = URL.createObjectURL(file);
            audio.onloadedmetadata = () => {
                setAudioDuration(Math.floor(audio.duration * 1000)); // Convert to milliseconds
                URL.revokeObjectURL(audio.src);
            };
        }
    };

    const handleThumbnailFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedThumbnailFile(file);
            form.setValue('thumbnailFile', file);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('audio/')) {
            setSelectedAudioFile(file);
            form.setValue('audioFile', file);
            form.setValue('title', file.name.replace(/\.[^/.]+$/, ''));

            // Get audio duration
            const audio = new Audio();
            audio.src = URL.createObjectURL(file);
            audio.onloadedmetadata = () => {
                setAudioDuration(Math.floor(audio.duration * 1000));
                URL.revokeObjectURL(audio.src);
            };
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
        try {
            setIsUploading(true);

            // Upload audio file
            const audioFileId = await UploadFileInS3(
                data.audioFile,
                (progress) => {

                },
                'your-user-id',
                INSTITUTE_ID,
                'ADMIN',
                true
            );

            // Upload thumbnail if provided
            let thumbnailFileId: string | null = null;
            if (data.thumbnailFile) {
                const uploadResult = await UploadFileInS3(
                    data.thumbnailFile,
                    (progress) => {

                    },
                    'your-user-id',
                    INSTITUTE_ID,
                    'ADMIN',
                    true
                );
                thumbnailFileId = uploadResult ?? null;
            }

            const slideId = crypto.randomUUID();
            const slideStatus = getSlideStatusForUser();
            const response = await addUpdateAudioSlide({
                id: slideId,
                title: data.title,
                description: data.description || null,
                image_file_id: thumbnailFileId,
                status: slideStatus as 'DRAFT' | 'PUBLISHED',
                slide_order: getNextSlideOrder(items || []),
                notify: false,
                new_slide: true,
                audio_slide: {
                    id: crypto.randomUUID(),
                    audio_file_id: audioFileId ?? '',
                    thumbnail_file_id: thumbnailFileId,
                    audio_length_in_millis: audioDuration,
                    source_type: 'FILE',
                    external_url: null,
                    transcript: data.transcript || null,
                },
            });

            if (response) {
                await reorderSlidesAfterNewSlide(slideId);
                openState?.(false);
                toast.success(t('toasts.createSuccess'));
            }

            form.reset();
            setSelectedAudioFile(null);
            setSelectedThumbnailFile(null);
            setAudioDuration(0);
        } catch (error) {
            console.error('Error creating audio slide:', error);
            toast.error(t('toasts.createFailed'));
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
                {/* Audio File Upload */}
                <div
                    className="cursor-pointer rounded-lg border-2 border-dashed border-primary-400 p-8 text-center transition-colors hover:border-primary-500 hover:bg-primary-50/30"
                    onClick={() => document.getElementById('audio-file-upload')?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
                    <div className="flex flex-col items-center justify-center">
                        <div className="mb-4 text-primary-500">
                            <MusicNotes size={48} weight="duotone" />
                        </div>
                        <h3 className="text-xl font-medium text-primary-500">
                            {t('dropzone.title')}
                        </h3>
                        <p className="mt-1 text-gray-500">{t('dropzone.hint')}</p>
                        <p className="mt-1 text-xs text-gray-400">
                            {t('dropzone.formats')}
                        </p>
                        {selectedAudioFile && (
                            <div className="mt-3 rounded-md bg-primary-50 p-2">
                                <p className="text-sm font-medium text-primary-700">
                                    {t('dropzone.selected', { fileName: selectedAudioFile.name })}
                                </p>
                                {audioDuration > 0 && (
                                    <p className="text-xs text-primary-600">
                                        {t('dropzone.duration', {
                                            minutes: Math.floor(audioDuration / 60000),
                                            seconds: String(
                                                Math.floor((audioDuration % 60000) / 1000)
                                            ).padStart(2, '0'),
                                        })}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                    <input
                        id="audio-file-upload"
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={handleAudioFileChange}
                    />
                </div>

                {/* Hidden input for Zod validation */}
                <FormField
                    control={form.control}
                    name="audioFile"
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

                {/* Thumbnail Upload */}
                <FormField
                    control={form.control}
                    name="thumbnailFile"
                    render={() => (
                        <FormItem>
                            <FormLabel>{t('fields.coverImage')}</FormLabel>
                            <FormControl>
                                <div className="flex items-center gap-4">
                                    <input
                                        id="thumbnail-file-upload"
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleThumbnailFileChange}
                                    />
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        onClick={() =>
                                            document
                                                .getElementById('thumbnail-file-upload')
                                                ?.click()
                                        }
                                    >
                                        {selectedThumbnailFile ? t('fields.changeImage') : t('fields.uploadImage')}
                                    </MyButton>
                                    {selectedThumbnailFile && (
                                        <span className="text-sm text-gray-600">
                                            {selectedThumbnailFile.name}
                                        </span>
                                    )}
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />

                {/* Transcript Input */}
                <FormField
                    control={form.control}
                    name="transcript"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t('fields.transcript')}</FormLabel>
                            <FormControl>
                                <Textarea
                                    placeholder={t('fields.transcriptPlaceholder')}
                                    className="min-h-[100px] resize-none"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    disabled={isUploading || !selectedAudioFile}
                    className={`
                        w-full transition-all duration-300 ease-in-out
                        ${
                            isUploading || !selectedAudioFile
                                ? 'cursor-not-allowed opacity-50'
                                : 'shadow-lg hover:scale-105 hover:shadow-xl active:scale-95'
                        }
                    `}
                >
                    {isUploading ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            {t('actions.uploading')}
                        </div>
                    ) : (
                        t('actions.submit')
                    )}
                </MyButton>
            </form>
        </Form>
    );
};
