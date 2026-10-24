'use client';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import {
    useSlidesMutations,
    type Slide,
    type VideoSlide,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { toast } from 'sonner';
import { Route } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/index';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { YoutubeLogo, CheckCircle, PlayCircle } from '@phosphor-icons/react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

const buildFormSchema = (t: TFunction) =>
    z.object({
        videoUrl: z
            .string()
            .min(1, t('validation.urlRequired'))
            .url(t('validation.urlInvalid'))
            .refine((url) => url.includes('youtube.com') || url.includes('youtu.be'), {
                message: t('validation.youtubeUrlInvalid'),
            }),
        videoName: z.string().optional(),
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

export const AddVideoDialog = ({
    openState,
    editSlide,
}: {
    openState?: (open: boolean) => void;
    // When provided, the dialog edits this slide's link instead of creating a new slide.
    editSlide?: Slide;
}) => {
    const { t } = useTranslation('studyLibraryAddVideoDialog');
    const formSchema = useMemo(() => buildFormSchema(t), [t]);
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
    const initialUrl =
        editSlide?.video_slide?.url || editSlide?.video_slide?.published_url || '';
    const [isAPIReady, setIsAPIReady] = useState(false);
    const [isValidUrl, setIsValidUrl] = useState(
        !!initialUrl && (initialUrl.includes('youtube.com') || initialUrl.includes('youtu.be'))
    );
    const [videoPreview, setVideoPreview] = useState<{ title: string; thumbnail: string } | null>(
        null
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVideoUploading, setIsVideoUploading] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            videoUrl: initialUrl,
            videoName: editSlide?.video_slide?.title || editSlide?.title || '',
        },
    });

    const extractVideoId = (url: string): string => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return match && match[2]?.length === 11 ? match[2] : '';
    };

    const loadYouTubeAPI = () => {
        if (window.YT) {
            setIsAPIReady(true);
            return;
        }
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        window.onYouTubeIframeAPIReady = () => {
            setIsAPIReady(true);
        };
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    };

    useEffect(() => {
        loadYouTubeAPI();
    }, []);

    const handleUrlChange = (url: string) => {
        const videoId = extractVideoId(url);
        if (videoId) {
            setIsValidUrl(true);
            fetch(`https://www.youtube.com/oembed?url=${url}&format=json`)
                .then((response) => response.json())
                .then((data) => {
                    form.setValue('videoName', data.title || t('defaults.videoName'));
                    setVideoPreview({ title: data.title, thumbnail: data.thumbnail_url });
                })
                .catch(() => {
                    form.setValue('videoName', t('defaults.videoName'));
                    setVideoPreview(null);
                });
        } else {
            setIsValidUrl(false);
            setVideoPreview(null);
        }
    };

    // In edit mode, hydrate the thumbnail preview from the current link on open.
    useEffect(() => {
        if (editSlide && initialUrl) {
            handleUrlChange(initialUrl);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = async (data: FormValues) => {
        const videoId = extractVideoId(data.videoUrl);
        if (!videoId) {
            toast.error(t('toasts.invalidYoutubeUrl'));
            return;
        }

        if (containerRef.current && isAPIReady) {
            const playerContainer = document.createElement('div');
            containerRef.current.innerHTML = '';
            containerRef.current.appendChild(playerContainer);

            new window.YT.Player(playerContainer, {
                height: '0',
                width: '0',
                videoId: videoId,
                playerVars: { autoplay: 0, controls: 0 },
                events: {
                    onReady: (event) => {
                        const durationSeconds = event.target.getDuration();
                        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
                            toast.error(t('toasts.durationReadFailed'));
                            event.target.destroy();
                            return;
                        }
                        submitFormWithDuration(data, Math.round(durationSeconds * 1000));
                        event.target.destroy();
                    },
                },
            });
        } else {
            // YouTube IFrame API hasn't finished loading yet. Don't submit with
            // length=0 — that would break learner-side progress tracking on
            // this slide forever. Ask the user to retry.
            toast.error(t('toasts.youtubeLoading'));
        }
    };

    const submitFormWithDuration = async (data: FormValues, duration: number) => {
        setIsVideoUploading(true);
        try {
            // Edit mode: update the existing slide's link in place (no reorder, keep id/questions).
            if (editSlide) {
                const slideStatus = editSlide.status;
                const response: string = await addUpdateVideoSlide({
                    id: editSlide.id,
                    title: data.videoName || editSlide.title || t('defaults.videoName'),
                    description: editSlide.description ?? null,
                    image_file_id: editSlide.image_file_id ?? null,
                    slide_order: editSlide.slide_order ?? null,
                    video_slide: {
                        id: editSlide.video_slide?.id || crypto.randomUUID(),
                        description: editSlide.video_slide?.description || '',
                        url: data.videoUrl,
                        title: data.videoName || t('defaults.videoName'),
                        video_length_in_millis: duration,
                        published_url:
                            slideStatus === 'PUBLISHED'
                                ? data.videoUrl
                                : editSlide.video_slide?.published_url ?? null,
                        published_video_length_in_millis:
                            slideStatus === 'PUBLISHED'
                                ? duration
                                : editSlide.video_slide?.published_video_length_in_millis || 0,
                        source_type: 'VIDEO',
                        embedded_type: editSlide.video_slide?.embedded_type,
                        embedded_data: editSlide.video_slide?.embedded_data,
                        questions: editSlide.video_slide?.questions || [],
                    },
                    status: slideStatus,
                    new_slide: false,
                    notify: false,
                });

                if (response) {
                    refreshActiveSlideAfterEdit(data.videoUrl, duration);
                    openState?.(false);
                    toast.success(t('toasts.updateSuccess'));
                }
                return;
            }

            const slideId = crypto.randomUUID();
            const slideStatus = getSlideStatusForUser();
            const response: string = await addUpdateVideoSlide({
                id: slideId,
                title: data.videoName || t('defaults.videoName'),
                description: null,
                image_file_id: null,
                slide_order: getNextSlideOrder(items || []),
                video_slide: {
                    id: crypto.randomUUID(),
                    description: '',
                    url: data.videoUrl,
                    title: data.videoName || t('defaults.videoName'),
                    video_length_in_millis: duration,
                    published_url: slideStatus === 'PUBLISHED' ? data.videoUrl : null,
                    published_video_length_in_millis: slideStatus === 'PUBLISHED' ? duration : 0,
                    source_type: 'VIDEO',
                },
                status: slideStatus,
                new_slide: true,
                notify: false,
            });

            if (response) {
                await reorderSlidesAfterNewSlide(response);
                openState?.(false);
                toast.success(t('toasts.addSuccess'));
            }
        } catch (error) {
            toast.error(editSlide ? t('toasts.updateFailed') : t('toasts.addFailed'));
        } finally {
            setIsVideoUploading(false);
        }
    };

    // Optimistically reflect the new link in the open preview, then reconcile
    // with the server copy once the slides query has refetched.
    const refreshActiveSlideAfterEdit = (newUrl: string, duration: number) => {
        if (!editSlide) return;
        const slideStatus = editSlide.status;
        const updatedSlide: Slide = {
            ...editSlide,
            title: form.getValues('videoName') || editSlide.title,
            video_slide: {
                ...(editSlide.video_slide as VideoSlide),
                url: newUrl,
                title: form.getValues('videoName') || editSlide.video_slide?.title || '',
                video_length_in_millis: duration,
                published_url:
                    slideStatus === 'PUBLISHED'
                        ? newUrl
                        : editSlide.video_slide?.published_url || '',
                published_video_length_in_millis:
                    slideStatus === 'PUBLISHED'
                        ? duration
                        : editSlide.video_slide?.published_video_length_in_millis || 0,
            },
        };
        setActiveItem(updatedSlide);
        setTimeout(() => {
            const fresh = getSlideById(editSlide.id);
            if (fresh) setActiveItem(fresh);
        }, 800);
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

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="flex w-full flex-col gap-6 p-6 text-neutral-600"
            >
                <div className="space-y-4">
                    <FormField
                        control={form.control}
                        name="videoUrl"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={field.value}
                                            onChange={(e) => {
                                                field.onChange(e);
                                                handleUrlChange(e.target.value);
                                            }}
                                            placeholder={t('fields.urlPlaceholder')}
                                            className="w-full rounded-lg border border-neutral-300 px-4 py-3 pr-10 text-sm"
                                            required
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                            {isValidUrl ? (
                                                <CheckCircle className="size-5 text-green-500" />
                                            ) : (
                                                <YoutubeLogo className="size-5 text-neutral-400" />
                                            )}
                                        </div>
                                    </div>
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    {videoPreview && (
                        <div className="rounded-xl border bg-neutral-50 p-4 duration-500 animate-in fade-in slide-in-from-bottom-2">
                            <div className="flex items-center gap-3">
                                <div className="relative shrink-0">
                                    <img
                                        src={videoPreview.thumbnail}
                                        alt={t('preview.thumbnailAlt')}
                                        className="h-12 w-16 rounded-lg object-cover"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <PlayCircle className="size-6 text-white drop-shadow-lg" />
                                    </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-neutral-700">
                                        {videoPreview.title}
                                    </p>
                                    <p className="text-xs text-neutral-500">{t('defaults.videoName')}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div ref={containerRef} className="hidden" />

                <div className="flex justify-end border-t border-neutral-100 pt-4">
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        scale="large"
                        layoutVariant="default"
                        disabled={!form.getValues('videoUrl') || !isValidUrl || isVideoUploading}
                        className={`
              w-full transition-all duration-300 ease-in-out
              ${
                  !form.getValues('videoUrl') || !isValidUrl || isVideoUploading
                      ? 'cursor-not-allowed opacity-50'
                      : 'shadow-lg hover:scale-105 hover:shadow-xl active:scale-95'
              }
            `}
                    >
                        {isVideoUploading ? (
                            <div className="flex items-center justify-center gap-2">
                                <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                {editSlide ? t('actions.updatingLink') : t('actions.addingVideo')}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center gap-2">
                                <YoutubeLogo className="size-4" />
                                {editSlide ? t('actions.updateLink') : t('actions.addVideo')}
                            </div>
                        )}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
};
