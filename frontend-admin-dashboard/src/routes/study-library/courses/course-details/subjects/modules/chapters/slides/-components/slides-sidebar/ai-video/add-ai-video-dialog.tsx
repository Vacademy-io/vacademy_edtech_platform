'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Sparkle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Route } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/index';
import {
    useSlidesMutations,
    type HtmlVideoSlideCreatePayload,
    type Slide,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useChapterName } from '@/utils/helpers/study-library-helpers.ts/get-name-by-id/getChapterNameById';
import { getTutorOptions } from '@/services/tutor';
import {
    estimateLmsVideo,
    generateLmsVideo,
    parseLmsVideoError,
    type LmsVideoContext,
    type LmsVideoPolicy,
} from '@/services/lms-ai-video';
import { buildAppendReorderPayload, getNextSlideOrder } from '../../../-helper/slide-naming-utils';
import {
    buildHtmlVideoSlidePayload,
    buildLmsVideoRequest,
    createInitialFormState,
    getSourceSlideOptions,
    selectFormat,
    validateFormat,
    validateWhatToTeach,
    type AiVideoFormState,
    type FieldError,
    type FormatError,
    type WhatToTeachField,
} from './ai-video-form';
import { StepIndicator } from './ai-video-ui';
import { StepWhatToTeach } from './step-what-to-teach';
import { StepFormat } from './step-format';
import { StepReview } from './step-review';

const NS = 'studyLibraryAddAiVideoDialog';
const ESTIMATE_DEBOUNCE_MS = 500;

type Step = 0 | 1 | 2;

function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return debounced;
}

/** The slides query refetches after the add; wait briefly for the new slide to land in the store. */
async function waitForSlide(slideId: string, timeoutMs = 4000): Promise<Slide | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const slide = useContentStore.getState().getSlideById(slideId);
        if (slide) return slide;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return null;
}

/** What the sidebar can show for the new slide until the refetched copy arrives. */
const localSlideFrom = (payload: HtmlVideoSlideCreatePayload): Slide => ({
    id: payload.id,
    source_id: '',
    source_type: 'HTML_VIDEO',
    title: payload.title,
    image_file_id: '',
    description: payload.description || '',
    status: payload.status,
    slide_order: payload.slide_order,
    html_video_slide: { ...payload.html_video_slide },
    is_loaded: true,
    new_slide: true,
});

/**
 * "Add Slide → AI Video": a three-step flow (what to teach → format → review &
 * create). Create starts the generation on ai_service and immediately adds a
 * DRAFT HTML_VIDEO slide linked by ai_gen_video_id; the slide shows live
 * progress (video-slide-preview) and plays once the video is ready.
 *
 * Mounted only while open, so every open starts from a fresh form.
 */
export function AddAiVideoDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    if (!open) return null;
    return <AddAiVideoDialogBody onOpenChange={onOpenChange} />;
}

function AddAiVideoDialogBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation(NS);
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const packageSessionId =
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || '';
    const { addUpdateHtmlVideoSlide, updateSlideOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        packageSessionId
    );
    const { items, setActiveItem } = useContentStore();
    const chapterName = useChapterName(chapterId || '');

    const [step, setStep] = useState<Step>(0);
    const [state, setState] = useState<AiVideoFormState>(() => createInitialFormState(chapterName));
    const [teachErrors, setTeachErrors] = useState<Partial<Record<WhatToTeachField, FieldError>>>(
        {}
    );
    const [formatError, setFormatError] = useState<FormatError | null>(null);
    const [uploading, setUploading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    /** Set once /generate succeeded, so a failed slide-add retries without starting a second video. */
    const [startedVideo, setStartedVideo] = useState<{
        videoId: string;
        codeEditor: boolean;
    } | null>(null);
    const [policy, setPolicy] = useState<LmsVideoPolicy | null>(null);

    // The chapter list can arrive after the dialog opens — prefill the topic then,
    // unless the teacher has already typed one.
    const topicTouched = useRef(false);
    useEffect(() => {
        if (topicTouched.current || state.topic) return;
        const prefill = createInitialFormState(chapterName).topic;
        if (prefill) setState((s) => (s.topic ? s : { ...s, topic: prefill }));
    }, [chapterName, state.topic]);

    const { options: sources, draftCount } = useMemo(() => getSourceSlideOptions(items), [items]);

    const tutorOptions = useQuery({
        queryKey: ['tutor-options-ai-video'],
        queryFn: getTutorOptions,
        staleTime: 10 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
    });
    const avatars = useMemo(() => {
        if (tutorOptions.isError) return [];
        if (!tutorOptions.data) return null;
        if (tutorOptions.data.avatar_available === false) return [];
        return (tutorOptions.data.avatars || []).filter(
            (a) => a.provider === 'spatius' && a.status === 'ready' && !!a.external_id
        );
    }, [tutorOptions.data, tutorOptions.isError]);

    // Once the teachers are known, make the default format work out of the box:
    // pre-pick the first ready teacher, or — when the institute has none — fall
    // back to the board explainer instead of a format that can't be created.
    const formatTouched = useRef(false);
    const defaultsApplied = useRef(false);
    useEffect(() => {
        if (avatars === null || defaultsApplied.current) return;
        defaultsApplied.current = true;
        setState((s) => {
            if (s.teacher || formatTouched.current) return s;
            const first = avatars[0];
            if (first?.external_id) {
                const gender = (first.gender || '').toLowerCase();
                return {
                    ...s,
                    teacher: { avatar_id: first.external_id, name: first.display_name },
                    ...(gender === 'male' || gender === 'female' ? { voiceGender: gender } : {}),
                };
            }
            return s.format === 'lesson_teacher' ? selectFormat(s, 'board_explainer') : s;
        });
    }, [avatars]);

    const context: LmsVideoContext = useMemo(
        () => ({
            course_id: courseId || undefined,
            subject_id: subjectId || undefined,
            module_id: moduleId || undefined,
            chapter_id: chapterId || undefined,
            chapter_name: chapterName || undefined,
            package_session_id: packageSessionId || undefined,
        }),
        [courseId, subjectId, moduleId, chapterId, chapterName, packageSessionId]
    );
    const request = useMemo(() => buildLmsVideoRequest(state, context), [state, context]);
    const requestKey = useMemo(() => JSON.stringify(request), [request]);
    const debouncedKey = useDebouncedValue(requestKey, ESTIMATE_DEBOUNCE_MS);

    const estimateQuery = useQuery({
        queryKey: ['lms-ai-video-estimate', debouncedKey],
        queryFn: ({ signal }) => estimateLmsVideo(JSON.parse(debouncedKey), signal),
        enabled: step === 2 && !startedVideo,
        staleTime: 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
    });
    useEffect(() => {
        if (estimateQuery.data?.policy) setPolicy(estimateQuery.data.policy);
    }, [estimateQuery.data]);

    const estimateIsCurrent = debouncedKey === requestKey && !estimateQuery.isFetching;
    const estimateError = estimateQuery.isError
        ? parseLmsVideoError(estimateQuery.error, t('review.cost.failed')).detail
        : null;

    const update = useCallback((patch: Partial<AiVideoFormState>) => {
        if ('topic' in patch) topicTouched.current = true;
        setState((s) => ({ ...s, ...patch }));
    }, []);

    const steps = [t('steps.teach'), t('steps.format'), t('steps.review')];

    const goNext = () => {
        if (step === 0) {
            const errors = validateWhatToTeach(state);
            setTeachErrors(errors);
            if (Object.keys(errors).length > 0) return;
            setStep(1);
            return;
        }
        if (step === 1) {
            const error = validateFormat(state);
            setFormatError(error);
            if (error) return;
            setSubmitError(null);
            setStep(2);
        }
    };

    const goBack = () => {
        setSubmitError(null);
        setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
    };

    const placeNewSlideAtEnd = async (payload: HtmlVideoSlideCreatePayload) => {
        const fresh = await waitForSlide(payload.id);
        if (!fresh) {
            // Show it right away; setItems swaps in the server copy once it arrives.
            setActiveItem(localSlideFrom(payload));
            return;
        }
        try {
            await updateSlideOrder({
                chapterId: chapterId || '',
                slideOrderPayload: buildAppendReorderPayload(
                    payload.id,
                    useContentStore.getState().items || []
                ),
            });
        } catch {
            toast.error(t('toasts.reorderFailed'));
        }
        setActiveItem(useContentStore.getState().getSlideById(payload.id) ?? fresh);
    };

    const handleCreate = async () => {
        setSubmitError(null);
        setCreating(true);
        try {
            let video = startedVideo;
            if (!video) {
                try {
                    const res = await generateLmsVideo(request);
                    video = { videoId: res.video_id, codeEditor: !!res.code_editor };
                    setStartedVideo(video);
                } catch (err) {
                    setSubmitError(parseLmsVideoError(err, t('errors.generateFailed')).detail);
                    return;
                }
            }

            const payload = buildHtmlVideoSlidePayload({
                slideId: crypto.randomUUID(),
                htmlVideoSlideId: crypto.randomUUID(),
                videoId: video.videoId,
                topic: state.topic,
                objectives: state.objectives,
                slideOrder: getNextSlideOrder(useContentStore.getState().items || []),
                codeEditor: video.codeEditor,
            });
            try {
                await addUpdateHtmlVideoSlide(payload);
            } catch (err) {
                const { detail } = parseLmsVideoError(err, '');
                setSubmitError(
                    detail ? t('errors.slideFailed', { detail }) : t('errors.slideFailedGeneric')
                );
                return;
            }

            await placeNewSlideAtEnd(payload);
            toast.success(t('toasts.generating'));
            onOpenChange(false);
        } finally {
            setCreating(false);
        }
    };

    const canCreate =
        !creating &&
        (startedVideo !== null ||
            (estimateIsCurrent && !estimateQuery.isError && estimateQuery.data?.allowed === true));

    const footer = (
        <>
            {step === 0 ? (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => onOpenChange(false)}
                    disable={creating}
                >
                    {t('actions.cancel')}
                </MyButton>
            ) : (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={goBack}
                    disable={creating || !!startedVideo}
                    className="gap-1.5"
                >
                    <ArrowLeft className="size-4 rtl:rotate-180" />
                    {t('actions.back')}
                </MyButton>
            )}
            {step < 2 ? (
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    onClick={goNext}
                    disable={uploading}
                    className="gap-1.5"
                >
                    {t('actions.next')}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                </MyButton>
            ) : (
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    onAsyncClick={handleCreate}
                    loadingText={t('actions.creating')}
                    disable={!canCreate}
                    className="gap-1.5"
                >
                    <Sparkle className="size-4" weight="fill" />
                    {startedVideo ? t('actions.retrySlide') : t('actions.create')}
                </MyButton>
            )}
        </>
    );

    return (
        <MyDialog
            trigger={<></>}
            heading={t('heading')}
            dialogWidth="w-dialog-lg"
            open
            onOpenChange={(next) => {
                // Closing mid-create would hide where the new slide went.
                if (!next && creating) return;
                onOpenChange(next);
            }}
            footer={footer}
            footerLeft={
                <span className="text-xs text-muted-foreground">
                    {t('steps.progress', { current: step + 1, total: steps.length })}
                </span>
            }
        >
            <div className="flex flex-col gap-5">
                <StepIndicator steps={steps} current={step} />
                {step === 0 && (
                    <StepWhatToTeach
                        state={state}
                        onChange={update}
                        errors={teachErrors}
                        sources={sources}
                        draftCount={draftCount}
                        uploading={uploading}
                        onUploadingChange={setUploading}
                    />
                )}
                {step === 1 && (
                    <StepFormat
                        state={state}
                        onChange={(next) => {
                            if (next.format !== state.format) formatTouched.current = true;
                            setFormatError(null);
                            setState(next);
                        }}
                        error={formatError}
                        avatars={avatars}
                        avatarsFailed={tutorOptions.isError}
                        policy={policy}
                    />
                )}
                {step === 2 && (
                    <StepReview
                        state={state}
                        estimate={estimateQuery.data}
                        estimateLoading={!estimateIsCurrent || estimateQuery.isLoading}
                        estimateError={estimateError}
                        onRetryEstimate={() => void estimateQuery.refetch()}
                        submitError={submitError}
                        canEdit={!startedVideo && !creating}
                        onEdit={(target) => {
                            setSubmitError(null);
                            setStep(target);
                        }}
                    />
                )}
            </div>
        </MyDialog>
    );
}
