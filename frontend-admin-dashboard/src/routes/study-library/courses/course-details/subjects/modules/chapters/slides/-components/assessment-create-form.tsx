import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Coins, FilePdf, ListChecks, Sparkle, Spinner, WarningCircle } from '@phosphor-icons/react';

import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { MyDropdown } from '@/components/design-system/dropdown';
import { Switch } from '@/components/ui/switch';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { cn } from '@/lib/utils';
import {
    estimatePaperDigitise,
    findPdfAttachments,
    hasNonPdfAttachment,
    paperDigitiseErrorMessage,
    type PaperDigitiseEstimate,
} from '@/services/paper-digitise';
import { usePaperDigitise } from '../-hooks/use-paper-digitise';
import {
    STEP1_ASSESSMENT_URL,
    STEP2_ASSESSMENT_URL,
    STEP3_ASSESSMENT_URL,
    PRIVATE_ADD_QUESTIONS,
    PUBLISH_ASSESSMENT_URL,
} from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    useSlidesMutations,
    type AssessmentSlidePayload,
    type Slide,
} from '../-hooks/use-slides';
import { useContentStore } from '../-stores/chapter-sidebar-store';
import { useModulesWithChaptersStore } from '@/stores/study-library/use-modules-with-chapters-store';
import {
    useStudyLibraryStore,
    type SubjectType,
} from '@/stores/study-library/use-study-library-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getSlideStatusForUser } from '../non-admin/hooks/useNonAdminSlides';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../-helper/slide-naming-utils';

// In-slide "create assessment" form — the assessment analog of a manual-upload
// assignment. The admin writes a task description (and embeds the question PDF)
// in the rich-text editor; we append a standard "download → start → you have N
// minutes" note, set the per-attempt duration, and auto-provision a complete
// MANUAL assessment so it's ready to publish without the wizard. The learner
// uploads a PDF answer sheet.
//
// Two shapes of assessment come out of here:
//  * AI checking OFF — 1 section + 1 placeholder question carrying every mark;
//    the admin grades the sheet by hand (quick evaluate on the slide).
//  * AI checking ON — the PDF attached in the description is read into the
//    paper's real questions with their marks (paper-digitise), the section is
//    built from those, and ai_evaluation_enabled queues a per-question AI check
//    of every uploaded sheet. The checker has nothing to grade against without
//    this — a placeholder question would be graded as a confident guess.


const AssessmentCreateForm = () => {
    const { t } = useTranslation('studyLibraryAssessmentCreateForm');
    const router = useRouter();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } =
        router.state.location.search;
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { items, setActiveItem, setAssessmentCreateMode } = useContentStore();
    const { modulesWithChaptersData } = useModulesWithChaptersStore();
    const { studyLibraryData } = useStudyLibraryStore();
    const instituteId = getInstituteId();

    // Course depth (2–5): only a depth-5 course actually has a subject level.
    // Shallower courses carry a synthetic 'DEFAULT' subject, so there's nothing
    // meaningful for the admin to pick — keep the field hidden and pass the
    // route's subject id through untouched.
    const courseStructure =
        studyLibraryData?.find((item) => item.course.id === courseId)?.course?.course_depth ?? 0;

    // Every (non-DEFAULT) subject in this course, deduped across sessions/levels.
    const subjectOptions = useMemo(() => {
        const course = studyLibraryData?.find((item) => item.course.id === courseId);
        const byId = new Map<string, SubjectType>();
        course?.sessions?.forEach((session) =>
            session.level_with_details?.forEach((level) =>
                level.subjects?.forEach((subject) => {
                    if (subject.subject_name?.trim().toUpperCase() === 'DEFAULT') return;
                    byId.set(subject.id, subject);
                })
            )
        );
        return Array.from(byId.values()).map((subject) => ({
            value: subject.id,
            label: subject.subject_name,
        }));
    }, [studyLibraryData, courseId]);

    const showSubjectField = courseStructure === 5 && subjectOptions.length > 0;

    const packageSessionId =
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || '';

    // A chapter can be shared across many batches (package_sessions), so the
    // assessment must be registered to ALL of them — otherwise learners in the
    // other batches see the slide but the assessment never shows in their
    // assessment list. `chapter_in_package_sessions` carries every (non-deleted)
    // batch the chapter is mapped to; fall back to the current batch if the
    // study-library mapping hasn't loaded.
    const chapterBatchIds = useMemo(() => {
        const mapped = modulesWithChaptersData
            ?.flatMap((m) => m.chapters)
            .find((c) => c.chapter.id === chapterId)?.chapter_in_package_sessions;
        const ids = new Set<string>(mapped ?? []);
        if (packageSessionId) ids.add(packageSessionId);
        return Array.from(ids);
    }, [modulesWithChaptersData, chapterId, packageSessionId]);

    const { addUpdateAssessmentSlide, updateSlideOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        packageSessionId
    );

    const [name, setName] = useState('');
    // Prefilled with the subject this slide already lives under; the admin can
    // retag the assessment to another subject of the same course.
    const [selectedSubjectId, setSelectedSubjectId] = useState(subjectId || '');
    const [description, setDescription] = useState('');
    // Max marks — applied to the single placeholder question so manual
    // evaluation can award up to this and the learner's score reads "X / total".
    const [totalMarks, setTotalMarks] = useState('100');
    // Per-attempt time limit (minutes). The standard note reflects this value.
    const [duration, setDuration] = useState('15');
    const [hasDateRange, setHasDateRange] = useState(false);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reattemptCount, setReattemptCount] = useState('2');
    const [isCreating, setIsCreating] = useState(false);

    // ---- AI checking: the paper PDF in the description → real questions ----
    const pdfAttachments = useMemo(() => findPdfAttachments(description), [description]);
    const nonPdfAttached = useMemo(() => hasNonPdfAttachment(description), [description]);
    const [aiCheck, setAiCheck] = useState(false);
    const [selectedPdfUrl, setSelectedPdfUrl] = useState('');
    const [estimate, setEstimate] = useState<
        | { status: 'idle' }
        | { status: 'loading' }
        | { status: 'ready'; data: PaperDigitiseEstimate }
        | { status: 'error'; message: string }
    >({ status: 'idle' });
    const { starting, start: startRead } = usePaperDigitise();
    // Why AI checking switched itself off (unreadable PDF, AI service down…). Kept
    // apart from `estimate` so the reason stays on screen after the switch is off.
    const [aiCheckDisabledReason, setAiCheckDisabledReason] = useState<string | null>(null);

    // Keep the selected paper pointing at something that is still attached, and
    // switch AI checking on the first time a paper appears: it is the reason the
    // paper is attached, and the cost is on screen before Create is pressed. A
    // teacher who turns it off is not overruled when they attach another file.
    const aiAutoEnabled = useRef(false);
    useEffect(() => {
        if (pdfAttachments.length === 0) {
            if (selectedPdfUrl) setSelectedPdfUrl('');
            if (aiCheck) setAiCheck(false);
            return;
        }
        if (!pdfAttachments.some((a) => a.url === selectedPdfUrl)) {
            setSelectedPdfUrl(pdfAttachments[0]!.url);
            setAiCheckDisabledReason(null);
        }
        if (!aiAutoEnabled.current) {
            aiAutoEnabled.current = true;
            setAiCheck(true);
        }
    }, [pdfAttachments, selectedPdfUrl, aiCheck]);

    // Price the read as soon as there is a paper to price — the teacher should
    // know the number before pressing Create, not be told after.
    useEffect(() => {
        if (!aiCheck || !selectedPdfUrl) {
            setEstimate({ status: 'idle' });
            return;
        }
        let cancelled = false;
        setEstimate({ status: 'loading' });
        const handle = setTimeout(() => {
            estimatePaperDigitise(selectedPdfUrl)
                .then((data) => {
                    if (cancelled) return;
                    setEstimate({ status: 'ready', data });
                    setAiCheckDisabledReason(null);
                })
                .catch((error: unknown) => {
                    if (cancelled) return;
                    // The read cannot happen (bad PDF, AI service unreachable). Switch AI
                    // checking off rather than hold the whole form hostage — creating the
                    // test by hand is the teacher's daily path and must never be blocked by
                    // this feature. The reason stays on the card so they can fix and re-enable.
                    const message = paperDigitiseErrorMessage(error, t('aiCheck.estimateFailed'));
                    setEstimate({ status: 'error', message });
                    setAiCheckDisabledReason(message);
                    setAiCheck(false);
                });
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [aiCheck, selectedPdfUrl, t]);

    // Only a deliberate decision blocks Create: not enough credits for the read the
    // teacher has switched on (turn it off, or top up). A pending estimate merely
    // waits; a failed one has already switched AI checking off above.
    const estimateBlocksCreate =
        aiCheck &&
        (estimate.status === 'loading' ||
            (estimate.status === 'ready' && estimate.data.estimate.sufficient === false));

    const linkAssessmentAsSlide = async (
        assessmentId: string,
        assessmentName: string,
        allowReattempt: boolean
    ) => {
        const slideId = crypto.randomUUID();
        const assessmentSlideId = crypto.randomUUID();
        const title = `Assessment: ${assessmentName}`;

        const payload: AssessmentSlidePayload = {
            id: slideId,
            source_id: assessmentSlideId,
            source_type: 'ASSESSMENT',
            title,
            description: '',
            image_file_id: '',
            slide_order: getNextSlideOrder((items as Slide[]) || []),
            status: getSlideStatusForUser(),
            new_slide: true,
            notify: false,
            assessment_slide: {
                id: assessmentSlideId,
                assessment_id: assessmentId,
                allow_reattempt: allowReattempt,
                show_result: true,
            },
        };

        const response = await addUpdateAssessmentSlide(payload);
        if (!response) throw new Error(t('errors.failedToLinkAssessment'));

        const currentSlides = (items as Slide[]) || [];
        const reordered = buildAppendReorderPayload(slideId, currentSlides);
        await updateSlideOrder({
            chapterId: chapterId || '',
            slideOrderPayload: reordered,
        });

        const newSlide: Slide = {
            id: slideId,
            source_id: assessmentSlideId,
            source_type: 'ASSESSMENT',
            title,
            image_file_id: '',
            description: '',
            status: payload.status,
            slide_order: payload.slide_order ?? 0,
            video_slide: null,
            document_slide: null,
            question_slide: null,
            assignment_slide: null,
            quiz_slide: null,
            audio_slide: null,
            scorm_slide: null,
            assessment_slide: {
                id: assessmentSlideId,
                assessment_id: assessmentId,
                allow_reattempt: allowReattempt,
                show_result: true,
            },
            is_loaded: true,
            new_slide: true,
        };
        setActiveItem(newSlide);
    };

    const validateForm = (): boolean => {
        if (hasDateRange && (!startDate || !endDate)) {
            toast.error(t('errors.enterBothDates'));
            return false;
        }
        if (hasDateRange && new Date(endDate) <= new Date(startDate)) {
            toast.error(t('errors.endDateAfterStart'));
            return false;
        }
        return true;
    };

    type ProvisionedQuestion = { id: string; type: string; marks: number; criteria: string | null };

    const createPlaceholderQuestion = async (): Promise<ProvisionedQuestion[]> => {
        const questionRes = await authenticatedAxiosInstance({
            method: 'POST',
            url: PRIVATE_ADD_QUESTIONS,
            data: {
                questions: [
                    {
                        question_type: 'LONG_ANSWER',
                        text: { type: 'HTML', content: 'Upload your answer sheet.' },
                        auto_evaluation_json:
                            '{"type":"LONG_ANSWER","data":{"answer":{"type":"HTML","content":""}}}',
                        explanation_text: { type: 'HTML', content: '' },
                    },
                ],
            },
        });
        const questionId = questionRes?.data?.questions?.[0]?.id;
        if (!questionId) throw new Error('Could not create the question');
        const marks = Math.max(1, parseInt(totalMarks, 10) || 1);
        return [{ id: questionId, type: 'LONG_ANSWER', marks, criteria: null }];
    };

    /**
     * Create the test with the placeholder question, publish it and link it as a
     * slide. Returns the new assessment id. AI checking is switched on later, by
     * the read + review on the test's card — the read takes minutes and must not
     * hold the teacher here.
     */
    const provision = async (): Promise<string | null> => {
        const trimmed = name.trim();
        if (!trimmed || isCreating) return null;
        if (!validateForm()) return null;

        setIsCreating(true);
        try {
            const examtype = 'EXAM';
            const durationMin = Math.max(1, parseInt(duration, 10) || 15);
            const reattempts = Math.max(0, parseInt(reattemptCount, 10) || 0);
            const startIso = hasDateRange
                ? new Date(startDate).toISOString()
                : new Date().toISOString();
            const endIso = hasDateRange
                ? new Date(endDate).toISOString()
                : new Date('9999-12-31T23:59:59.999Z').toISOString();
            // Standard learner-facing note appended after the admin's description.
            const noteHtml = t('createLogic.noteHtml', { count: durationMin });
            const instructionsHtml = `${description || ''}${noteHtml}`;

            // Question first: if it cannot be created, no half-made assessment
            // is left behind in DRAFT.
            const questions = await createPlaceholderQuestion();
            const sectionMarks = questions.reduce((sum, q) => sum + q.marks, 0);

            // Step 1 — basic info (DRAFT / INCOMPLETE), always MANUAL.
            const step1Res = await authenticatedAxiosInstance({
                method: 'POST',
                url: STEP1_ASSESSMENT_URL,
                params: { assessmentId: null, instituteId, type: examtype },
                data: {
                    status: 'INCOMPLETE',
                    assessment_type: 'ASSESSMENT',
                    test_creation: {
                        assessment_name: trimmed,
                        subject_id: selectedSubjectId || subjectId || '',
                        assessment_instructions_html: instructionsHtml,
                    },
                    test_boundation: {
                        start_date: startIso,
                        end_date: endIso,
                    },
                    assessment_preview_time: 0,
                    default_reattempt_count: reattempts,
                    switch_sections: true,
                    evaluation_type: 'MANUAL',
                    // Blank as the manual path always was; adopt-questions sets
                    // PDF when AI checking is switched on.
                    submission_type: '',
                    result_type: 'MANUAL',
                    // The attempt count is the hard cap — students can't request
                    // extra re-attempts beyond it.
                    raise_reattempt_request: false,
                    raise_time_increase_request: false,
                    // Off until the paper has been read and reviewed (adopt-questions).
                    ai_evaluation_enabled: false,
                },
            });

            const newAssessmentId = step1Res?.data?.assessment_id;
            if (!newAssessmentId) throw new Error('Could not create assessment');

            // Step 2 — one section with the question(s) + the duration.
            await authenticatedAxiosInstance({
                method: 'POST',
                url: STEP2_ASSESSMENT_URL,
                params: { assessmentId: newAssessmentId, instituteId, type: examtype },
                data: {
                    test_duration: {
                        entire_test_duration: durationMin,
                        distribution_duration: 'ASSESSMENT',
                    },
                    added_sections: [
                        {
                            section_name: 'Section 1',
                            section_id: '',
                            section_description_html: '',
                            section_duration: durationMin,
                            section_order: 1,
                            total_marks: sectionMarks,
                            cutoff_marks: 0,
                            problem_randomization: false,
                            question_and_marking: questions.map((q, order) => ({
                                question_id: q.id,
                                // Same shape the wizard writes (convertStep2Data): the
                                // type must match the question's, or MCQ marks read wrong.
                                marking_json: JSON.stringify({
                                    type: q.type,
                                    data: {
                                        totalMark: String(q.marks),
                                        negativeMark: '0',
                                        negativeMarkingPercentage: '',
                                    },
                                }),
                                question_duration_in_min: 0,
                                question_order: order + 1,
                                evaluation_criteria_json: q.criteria,
                                criteria_template_id: null,
                                is_added: true,
                                is_deleted: false,
                                is_updated: false,
                            })),
                        },
                    ],
                    updated_sections: [],
                    deleted_sections: [],
                },
            });

            // Step 3 — scope to every batch that shares this chapter (closed / PRIVATE)
            await authenticatedAxiosInstance({
                method: 'POST',
                url: STEP3_ASSESSMENT_URL,
                params: { assessmentId: newAssessmentId, instituteId, type: examtype },
                data: {
                    closed_test: true,
                    open_test_details: {},
                    added_pre_register_batches_details: chapterBatchIds,
                    deleted_pre_register_batches_details: [],
                    added_pre_register_students_details: [],
                    deleted_pre_register_students_details: [],
                    updated_join_link: '',
                    notify_student: {
                        when_assessment_created: false,
                        show_leaderboard: false,
                        before_assessment_goes_live: 0,
                        when_assessment_live: false,
                        when_assessment_report_generated: false,
                    },
                    notify_parent: {
                        when_assessment_created: false,
                        before_assessment_goes_live: 0,
                        show_leaderboard: false,
                        when_assessment_live: false,
                        when_student_appears: false,
                        when_student_finishes_test: false,
                        when_assessment_report_generated: false,
                    },
                },
            });

            // Publish immediately — the assessment is complete (section + question
            // + duration), so there's nothing left for the admin to set up.
            await authenticatedAxiosInstance({
                method: 'POST',
                url: PUBLISH_ASSESSMENT_URL,
                params: { assessmentId: newAssessmentId, instituteId, type: examtype },
                data: {},
            });

            // Re-attempt is driven solely by the attempt count: only allow it
            // when more than one attempt is permitted.
            await linkAssessmentAsSlide(newAssessmentId, trimmed, reattempts > 1);
            return newAssessmentId as string;
        } catch (err) {
            console.error('Failed to create assessment from slide', err);
            toast.error((err as Error)?.message || t('errors.failedToCreate'));
            return null;
        } finally {
            setIsCreating(false);
        }
    };

    // ---- Create now; read the paper in the background ------------------------
    const handleCreate = async () => {
        const trimmed = name.trim();
        const withAi = aiCheck && Boolean(selectedPdfUrl);
        const newAssessmentId = await provision();
        if (!newAssessmentId) return;
        if (!withAi) {
            toast.success(t('toasts.createdAndPublished'));
            return;
        }
        const expected = parseInt(totalMarks, 10);
        const started = await startRead({
            pdfUrl: selectedPdfUrl,
            expectedTotalMarks: Number.isFinite(expected) && expected > 0 ? expected : undefined,
            title: trimmed,
            assessmentId: newAssessmentId,
            name: trimmed,
            returnPath: `${window.location.pathname}${window.location.search}`,
        });
        if (started) {
            toast.success(t('toasts.createdReading', { credits: started.estimate.estimated_credits }), {
                duration: 10_000,
            });
        } else {
            // The test exists; the read did not start (credits, bad PDF…). The
            // card on the new slide offers to try again.
            toast.warning(t('toasts.createdReadNotStarted'), { duration: 10_000 });
        }
    };

    const estimateData = estimate.status === 'ready' ? estimate.data : null;
    const expectedTotalNumber = (() => {
        const n = parseInt(totalMarks, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    })();

    return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
                <div className="rounded-md bg-rose-50 p-2 text-rose-500">
                    <ListChecks className="size-5" />
                </div>
                <div className="flex flex-col">
                    <h3 className="text-base font-semibold text-neutral-900">
                        {t('header.heading')}
                    </h3>
                    <p className="text-sm text-neutral-500">
                        {t('header.description')}
                    </p>
                </div>
            </div>

            <MyInput
                inputType="text"
                label={t('form.nameLabel')}
                required
                inputPlaceholder={t('form.namePlaceholder')}
                input={name}
                onChangeFunction={(e) => setName(e.target.value)}
                size="large"
                className="w-full"
            />

            {showSubjectField && (
                <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-neutral-700">
                        {getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}
                    </span>
                    <SearchableSelect
                        options={subjectOptions}
                        value={selectedSubjectId}
                        onChange={setSelectedSubjectId}
                        placeholder={t('form.subjectPlaceholder', {
                            subject: getTerminology(
                                ContentTerms.Subjects,
                                SystemTerms.Subjects
                            ).toLowerCase(),
                        })}
                        className="w-full"
                        triggerClassName="w-full"
                    />
                    <span className="text-xs text-neutral-500">
                        {t('form.subjectDefaultHint', {
                            subject: getTerminology(
                                ContentTerms.Subjects,
                                SystemTerms.Subjects
                            ).toLowerCase(),
                        })}
                    </span>
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-neutral-700">{t('form.taskDescriptionLabel')}</span>
                <RichTextEditor
                    value={description}
                    onChange={setDescription}
                    placeholder={t('form.taskDescriptionPlaceholder')}
                    minHeight={180}
                />
                <span className="text-xs text-neutral-500">
                    {t('form.taskDescriptionHint', {
                        count: Math.max(1, parseInt(duration, 10) || 15),
                    })}
                </span>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <MyInput
                    inputType="number"
                    label={t('form.totalMarksLabel')}
                    inputPlaceholder="100"
                    input={totalMarks}
                    onChangeFunction={(e) => setTotalMarks(e.target.value)}
                    size="large"
                    className="w-full"
                    min={1}
                    onKeyDown={(e) => {
                        if (['e', 'E', '-', '+'].includes(e.key)) e.preventDefault();
                    }}
                    onWheel={(e) => e.currentTarget.blur()}
                />
                <div className="flex w-full flex-col gap-1.5">
                    <MyInput
                        inputType="number"
                        label={t('form.durationLabel')}
                        inputPlaceholder="15"
                        input={duration}
                        onChangeFunction={(e) => setDuration(e.target.value)}
                        size="large"
                        className="w-full"
                        min={1}
                        onKeyDown={(e) => {
                            if (['e', 'E', '-', '+'].includes(e.key)) e.preventDefault();
                        }}
                        onWheel={(e) => e.currentTarget.blur()}
                    />
                    <span className="text-xs text-neutral-500">
                        {t('form.durationHintBefore')} <strong>{t('form.durationHintBold')}</strong>{' '}
                        {t('form.durationHintAfter')}
                    </span>
                </div>
            </div>

            {/* AI checking — the paper attached above becomes the questions */}
            <div
                className={cn(
                    'flex flex-col gap-3 rounded-lg border p-4',
                    aiCheck ? 'border-primary-200 bg-primary-50/40' : 'border-neutral-200 bg-white'
                )}
            >
                <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <Sparkle className="size-4" weight="bold" />
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5">
                        <span className="text-sm font-semibold text-neutral-800">
                            {t('aiCheck.title')}
                        </span>
                        <span className="text-xs text-neutral-500">{t('aiCheck.description')}</span>
                    </div>
                    <Switch
                        checked={aiCheck}
                        disabled={pdfAttachments.length === 0 || isCreating}
                        onCheckedChange={(checked) => {
                            if (checked) setAiCheckDisabledReason(null);
                            setAiCheck(checked);
                        }}
                    />
                </div>

                {pdfAttachments.length === 0 && (
                    <p className="flex items-start gap-2 text-xs text-neutral-600">
                        <FilePdf className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                        {nonPdfAttached ? t('aiCheck.attachIsNotPdf') : t('aiCheck.attachPdfFirst')}
                    </p>
                )}

                {aiCheck && pdfAttachments.length > 1 && (
                    <div className="flex flex-col gap-1">
                        <span className="text-xs text-neutral-600">{t('aiCheck.whichPaper')}</span>
                        <MyDropdown
                            currentValue={
                                pdfAttachments.find((a) => a.url === selectedPdfUrl)?.name ?? ''
                            }
                            dropdownList={pdfAttachments.map((a) => ({ label: a.name, value: a.url }))}
                            placeholder={t('aiCheck.whichPaper')}
                            handleChange={(value) => setSelectedPdfUrl(value)}
                            className="w-full"
                        />
                    </div>
                )}

                {aiCheck && pdfAttachments.length === 1 && (
                    <p className="flex items-center gap-2 text-xs text-neutral-700">
                        <FilePdf className="size-4 shrink-0 text-danger-500" />
                        <span className="truncate">{pdfAttachments[0]!.name}</span>
                    </p>
                )}

                {aiCheck && estimate.status === 'loading' && (
                    <p className="flex items-center gap-2 text-xs text-neutral-500">
                        <Spinner className="size-4 animate-spin" />
                        {t('aiCheck.estimating')}
                    </p>
                )}
                {!aiCheck && pdfAttachments.length > 0 && aiCheckDisabledReason && (
                    <p className="flex items-start gap-2 text-xs text-danger-600">
                        <WarningCircle className="mt-0.5 size-4 shrink-0" />
                        {t('aiCheck.turnedOffBecause', { reason: aiCheckDisabledReason })}
                    </p>
                )}
                {aiCheck && estimateData && (
                    <div className="flex flex-col gap-1 text-xs text-neutral-700">
                        <p className="flex items-center gap-2 font-medium">
                            <Coins className="size-4 text-primary-500" weight="bold" />
                            {t('aiCheck.estimateLine', {
                                credits: estimateData.estimate.estimated_credits,
                                count: estimateData.pages,
                            })}
                            {estimateData.estimate.current_balance != null && (
                                <span className="font-normal text-neutral-500">
                                    · {t('aiCheck.balance', { balance: estimateData.estimate.current_balance })}
                                </span>
                            )}
                        </p>
                        {estimateData.estimate.sufficient === false ? (
                            <p className="text-danger-600">
                                {t('aiCheck.insufficientCredits')}
                            </p>
                        ) : (
                            <p className="text-neutral-500">{t('aiCheck.perSheetNote')}</p>
                        )}
                    </div>
                )}
            </div>

            {/* Live Date Range */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-neutral-800">
                        {t('form.liveDateRangeHeading')}
                    </span>
                    <Switch
                        checked={hasDateRange}
                        onCheckedChange={(checked) => {
                            setHasDateRange(checked);
                            if (!checked) {
                                setStartDate('');
                                setEndDate('');
                            }
                        }}
                    />
                </div>
                {hasDateRange ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-4 sm:flex-row">
                            <MyInput
                                inputType="datetime-local"
                                label={t('form.startDateLabel')}
                                required
                                input={startDate}
                                onChangeFunction={(e) => setStartDate(e.target.value)}
                                size="large"
                                className="w-full"
                            />
                            <MyInput
                                inputType="datetime-local"
                                label={t('form.endDateLabel')}
                                required
                                input={endDate}
                                onChangeFunction={(e) => setEndDate(e.target.value)}
                                size="large"
                                className="w-full"
                            />
                        </div>
                        <p className="text-xs text-neutral-500">
                            {t('form.dateRangeLockedHint')}
                        </p>
                    </div>
                ) : (
                    <p className="text-xs text-neutral-500">
                        {t('form.alwaysAvailableHint')}
                    </p>
                )}
            </div>

            {/* Attempts */}
            <MyInput
                inputType="number"
                label={t('form.attemptsLabel')}
                inputPlaceholder="2"
                input={reattemptCount}
                onChangeFunction={(e) => setReattemptCount(e.target.value)}
                size="large"
                className="w-48"
                min={0}
                onKeyDown={(e) => {
                    if (['e', 'E', '-', '+'].includes(e.key)) e.preventDefault();
                }}
                onWheel={(e) => e.currentTarget.blur()}
            />

            <div className="flex justify-end gap-2">
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => setAssessmentCreateMode(false)}
                    disable={isCreating || starting}
                >
                    {t('form.cancel')}
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => void handleCreate()}
                    disable={
                        !name.trim() ||
                        isCreating ||
                        starting ||
                        estimateBlocksCreate
                    }
                >
                    {isCreating
                        ? t('form.creating')
                        : aiCheck && selectedPdfUrl
                          ? estimateData
                              ? t('form.createAndReadPaper', {
                                    credits: estimateData.estimate.estimated_credits,
                                })
                              : t('form.createAndReadPaperNoEstimate')
                          : t('form.createAssessment')}
                </MyButton>
            </div>

        </div>
    );
};

export default AssessmentCreateForm;
