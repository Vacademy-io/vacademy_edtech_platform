'use client';

import type React from 'react';

import { MyButton } from '@/components/design-system/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { useSlidesMutations } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { toast } from 'sonner';
import { Route } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/index';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useState } from 'react';
import { UploadFileInS3 } from '@/services/upload_file';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

const buildFormSchema = (t: TFunction) =>
    z.object({
        videoName: z.string().min(1, t('validation.fileNameRequired')),
        videoFile: z.instanceof(File, { message: t('validation.videoFileRequired') }),
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

const INSTITUTE_ID = 'your-institute-id'; // Replace this in real usage

// Read the video file's intrinsic duration in milliseconds. Without this,
// the slide is created with length=0 and the learner-side cascade can never
// compute PERCENTAGE_VIDEO_WATCHED (the `length > 0` guard in
// LearnerTrackingAsyncService skips the write), so the slide stays at 0%
// forever for every learner.
const readVideoDurationMillis = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        const objectUrl = URL.createObjectURL(file);
        const cleanup = () => URL.revokeObjectURL(objectUrl);
        video.onloadedmetadata = () => {
            cleanup();
            const seconds = video.duration;
            if (!Number.isFinite(seconds) || seconds <= 0) {
                reject(new Error('Could not determine video duration'));
                return;
            }
            resolve(Math.round(seconds * 1000));
        };
        video.onerror = () => {
            cleanup();
            reject(new Error('Failed to read video metadata'));
        };
        video.src = objectUrl;
    });
};

export const AddVideoFileDialog = ({ openState }: { openState?: (open: boolean) => void }) => {
    const { t } = useTranslation('studyLibraryAddVideoFileDialog');
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();
    const { addUpdateVideoSlide, updateSlideOrder } = useSlidesMutations(
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

    const form = useForm<FormValues>({
        resolver: zodResolver(buildFormSchema(t)),
        defaultValues: {
            videoName: '',
        },
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            form.setValue('videoFile', file);
            form.setValue('videoName', file.name.replace(/\.[^/.]+$/, '')); // remove extension
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) {
            setSelectedFile(file);
            form.setValue('videoFile', file);
            form.setValue('videoName', file.name.replace(/\.[^/.]+$/, ''));
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
            toast.error(t('toast.reorderFailed'));
        }
    };

    const handleSubmit = async (data: FormValues) => {
        try {
            setIsUploading(true);

            // Read duration from the file before upload. If we can't read it,
            // refuse to create the slide rather than silently storing length=0,
            // which would break learner progress tracking on this slide.
            let durationMillis: number;
            try {
                durationMillis = await readVideoDurationMillis(data.videoFile);
            } catch {
                toast.error(t('toast.durationReadFailed'));
                return;
            }

            const fileId = await UploadFileInS3(
                data.videoFile,
                (progress) => {

                },
                'your-user-id',
                INSTITUTE_ID,
                'ADMIN',
                true
            );

            const slideId = crypto.randomUUID();
            const slideStatus = getSlideStatusForUser();
            const response = await addUpdateVideoSlide({
                id: slideId,
                title: data.videoName,
                description: null,
                image_file_id: null,
                slide_order: getNextSlideOrder(items || []),
                video_slide: {
                    id: crypto.randomUUID(),
                    description: '',
                    url: fileId ?? null,
                    title: data.videoName,
                    video_length_in_millis: durationMillis,
                    published_url: slideStatus === 'PUBLISHED' ? (fileId ?? null) : null,
                    published_video_length_in_millis:
                        slideStatus === 'PUBLISHED' ? durationMillis : 0,
                    source_type: 'FILE_ID',
                },
                status: slideStatus,
                new_slide: true,
                notify: false,
            });

            if (response) {
                await reorderSlidesAfterNewSlide(response);
                openState?.(false);
                toast.success(t('toast.uploadSuccess'));
            }

            form.reset();
            setSelectedFile(null);
        } catch (error) {
            toast.error(t('toast.uploadFailed'));
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
                <div
                    className="cursor-pointer rounded-lg border-2 border-dashed border-orange-400 p-8 text-center"
                    onClick={() => document.getElementById('video-file-upload')?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
                    <div className="flex flex-col items-center justify-center">
                        <div className="mb-4 text-orange-500">
                            <svg
                                width="48"
                                height="48"
                                viewBox="0 0 48 48"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <path
                                    d="M24 12V24M24 24V36M24 24H36M24 24H12"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </div>
                        <h3 className="text-xl font-medium text-orange-500">
                            {t('importYourFile')}
                        </h3>
                        <p className="mt-1 text-gray-500">{t('dragOrClickToUpload')}</p>
                        {selectedFile && (
                            <p className="mt-2 text-sm font-medium text-gray-700">
                                {t('selected', { name: selectedFile.name })}
                            </p>
                        )}
                    </div>
                    <input
                        id="video-file-upload"
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                </div>

                {/* Hidden input for Zod validation */}
                <FormField
                    control={form.control}
                    name="videoFile"
                    render={() => (
                        <FormItem className="hidden">
                            <FormControl>
                                <input type="file" />
                            </FormControl>
                        </FormItem>
                    )}
                />

                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    disabled={isUploading || !selectedFile}
                    className={`
            w-full transition-all duration-300 ease-in-out
            ${
                isUploading || !selectedFile
                    ? 'cursor-not-allowed opacity-50'
                    : 'shadow-lg hover:scale-105 hover:shadow-xl active:scale-95'
            }
          `}
                >
                    {isUploading ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            {t('uploading')}
                        </div>
                    ) : (
                        t('uploadVideo')
                    )}
                </MyButton>
            </form>
        </Form>
    );
};
