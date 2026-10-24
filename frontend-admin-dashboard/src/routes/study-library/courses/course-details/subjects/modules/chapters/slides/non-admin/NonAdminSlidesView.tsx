import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ChapterSidebarAddButton } from '../-components/slides-sidebar/slides-sidebar-add-button';
import { ChapterSidebarSlides } from '../-components/slides-sidebar/slides-sidebar-slides';
import { ChapterNavigator } from '../-components/chapter-navigator';
import { CourseUnsavedBanner } from '../-components/course-unsaved-banner';
import '../slides-sidebar-scrollbar.css';
// import { studyLibrarySteps } from '@/constants/intro/steps';
// import { StudyLibraryIntroKey } from '@/constants/storage/introKey';
import {
    Slide,
    slideOrderPayloadType,
    useSlidesMutations,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
// import useIntroJsTour from '@/hooks/use-intro';
import { InitStudyLibraryProvider } from '@/providers/study-library/init-study-library-provider';
import { ModulesWithChaptersProvider } from '@/providers/study-library/modules-with-chapters-provider';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useChapterName } from '@/utils/helpers/study-library-helpers.ts/get-name-by-id/getChapterNameById';
import { getModuleName } from '@/utils/helpers/study-library-helpers.ts/get-name-by-id/getModuleNameById';
import { getSubjectName } from '@/utils/helpers/study-library-helpers.ts/get-name-by-id/getSubjectNameById';
import { useNavigate } from '@tanstack/react-router';
import { CaretLeft, CaretRight, Eye, UserGear, Lock } from '@phosphor-icons/react';
import React, { useEffect, useRef, useState, useMemo, useCallback, Suspense } from 'react';
import { SaveDraftProvider } from '../-context/saveDraftContext';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useModulesWithChaptersStore } from '@/stores/study-library/use-modules-with-chapters-store';
import { SidebarProvider } from '@/components/ui/sidebar';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useLearnerViewStore } from '../-stores/learner-view-store';
import { useNonAdminSlides } from './hooks/useNonAdminSlides';
import { SendForApprovalButton } from '@/components/study-library/approval-workflow/SendForApprovalButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PreviewChangesButton } from '@/components/study-library/course-comparison/PreviewChangesButton';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { useTranslation } from 'react-i18next';

const SlideMaterial = React.lazy(() =>
    import(
        '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/slide-material'
    ).then((module) => ({ default: module.SlideMaterial }))
);

interface NonAdminSlidesViewProps {
    courseId: string;
    levelId: string;
    subjectId: string;
    moduleId: string;
    chapterId: string;
    slideId: string;
    sessionId: string;
    timestamp?: number;
    currentPage?: number;
}

export function NonAdminSlidesView({
    chapterId,
    courseId,
    levelId,
    subjectId,
    moduleId,
    sessionId,
}: NonAdminSlidesViewProps) {
    const { t } = useTranslation('studyLibraryNonAdminSlidesView');
    const navigate = useNavigate();
    const { studyLibraryData } = useStudyLibraryStore();
    const { modulesWithChaptersData } = useModulesWithChaptersStore();
    const [subjectName, setSubjectName] = useState('');
    const [moduleName, setModuleName] = useState('');
    const chapterName = useChapterName(chapterId);
    const { updateSlideOrder } = useSlidesMutations(chapterId);
    const { setNavHeading } = useNavHeadingStore();

    // Get course data and status
    const courseData = studyLibraryData?.find((item) => item.course.id === courseId);
    const courseStatus = courseData?.course?.status;
    const originalCourseId = courseData?.course?.originalCourseId || null;
    const isDraftCourse = courseStatus === 'DRAFT';

    // When the role's display settings allow direct edit of published courses,
    // bypass the read-only lock and surface the manual Publish/Unpublish UI by
    // forwarding hidePublishButtons={false} to SlideMaterial.
    const allowDirectEditPublished =
        getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey())?.coursePage
            ?.directEditPublishedCourse === true;
    const isReadOnlyMode = !isDraftCourse && !allowDirectEditPublished;

    // Non-admin slides management
    const { unsavedChanges, showApprovalButton, saveSlideAsPublished } =
        useNonAdminSlides(chapterId);

    // useIntroJsTour({
    //     key: StudyLibraryIntroKey.addSlidesStep,
    //     steps: studyLibrarySteps.addSlidesStep,
    // });

    // Course depth (2–5) decides which Content Structure level a breadcrumb crumb
    // maps to. Only structure 5 has a separate modules grid under each subject.
    const courseStructure = courseData?.course?.course_depth ?? 0;

    const handleSubjectRoute = useCallback(() => {
        navigate({
            to: '/study-library/courses/course-details',
            search: {
                courseId: courseId,
                sessionId: sessionId,
                levelId: levelId,
                navLevel: courseStructure === 5 ? ('modules' as const) : undefined,
                navSubjectId: courseStructure === 5 ? subjectId : undefined,
            },
            hash: '',
        });
    }, [courseId, levelId, subjectId, sessionId, courseStructure, navigate]);

    const handleModuleRoute = useCallback(() => {
        navigate({
            to: '/study-library/courses/course-details',
            search: {
                courseId: courseId,
                sessionId: sessionId,
                levelId: levelId,
                navLevel: 'chapters' as const,
                navSubjectId: subjectId,
                navModuleId: moduleId,
            },
            hash: '',
        });
    }, [courseId, levelId, subjectId, moduleId, sessionId, navigate]);

    const handleSlideOrderChange = useCallback(
        async (slideOrderPayload: slideOrderPayloadType) => {
            if (isReadOnlyMode) {
                return; // Don't allow reordering in read-only mode
            }

            try {
                await updateSlideOrder({
                    chapterId: chapterId,
                    slideOrderPayload: slideOrderPayload,
                });
            } catch (error) {
                // Silently handle error
            }
        },
        [chapterId, updateSlideOrder, isReadOnlyMode]
    );

    useEffect(() => {
        setSubjectName(getSubjectName(subjectId || ''));
        setModuleName(getModuleName(moduleId || ''));
    }, [studyLibraryData, modulesWithChaptersData, subjectId, moduleId]);

    const heading = useMemo(
        () => (
            <div className="flex items-center gap-4">
                <CaretLeft onClick={() => window.history.back()} className="cursor-pointer" />
                <div className="flex items-center gap-2">
                    <span>{`${chapterName || ''} ${getTerminology(
                        ContentTerms.Slides,
                        SystemTerms.Slides
                    )}s`}</span>
                    {isReadOnlyMode && <Lock size={16} className="text-gray-500" />}
                </div>
            </div>
        ),
        [chapterName, isReadOnlyMode]
    );

    // Learner View Toggle Switch Component
    const LearnerViewToggle = () => {
        const { isLearnerView, toggleLearnerView } = useLearnerViewStore();

        return (
            <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-neutral-600">
                    <UserGear className="size-4" />
                </span>

                <button
                    onClick={toggleLearnerView}
                    className={`
                        relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
                        ${isLearnerView ? 'bg-primary-500' : 'bg-neutral-300'}
                    `}
                    title={
                        isLearnerView
                            ? t('switchToInstructorView')
                            : t('switchToLearnerView')
                    }
                >
                    <span
                        className={`
                            flex size-4 items-center justify-center rounded-full bg-white shadow-lg transition-transform duration-200 ease-in-out
                            ${isLearnerView ? 'translate-x-6' : 'translate-x-1'}
                        `}
                    >
                        {isLearnerView ? (
                            <Eye className="size-2.5 text-primary-600" />
                        ) : (
                            <UserGear className="size-2.5 text-neutral-600" />
                        )}
                    </span>
                </button>

                <span className="text-xs font-medium text-neutral-600">
                    <Eye className="size-4" />
                </span>
            </div>
        );
    };

    const { isLearnerView } = useLearnerViewStore();

    const SidebarComponent = useMemo(
        () => (
            // min-h-full (not h-full) resolves against the h-screen panel and lets
            // the column grow past it, which is what makes the footer's
            // `sticky bottom-0` pin correctly whether the list is short or long.
            <div className="flex min-h-full w-full flex-col">
                {/* Course Status Alert for Read-Only Mode */}
                {isReadOnlyMode && (
                    <div className="w-full p-3">
                        <Alert className="border-orange-200 bg-orange-50">
                            <Lock className="size-4 text-orange-600" />
                            <AlertDescription className="text-sm text-orange-800">
                                {t('readOnlyCourseBanner', {
                                    status: courseStatus?.toLowerCase(),
                                })}
                            </AlertDescription>
                        </Alert>
                    </div>
                )}

                {/* Unified Header Section with Learner View Toggle and Breadcrumb */}
                <div className="to-primary-25 sticky top-0 z-20 flex w-full flex-col border-b border-primary-100 bg-gradient-to-b from-primary-50 shadow-sm">
                    {/* Learner View Toggle */}
                    <div className="flex w-full justify-center px-3 pb-2 pt-3">
                        <LearnerViewToggle />
                    </div>

                    {/* Breadcrumb — subject › module as a muted path line, the
                        current chapter as its own chip beneath it. Every text node
                        is min-w-0 + truncate: subject names here run to 60+ chars
                        ("Introduction to International Classification of
                        Functioning…") and a `truncate` span with no min-w-0
                        ancestor refuses to shrink, which is what used to widen the
                        panel and scroll the whole sidebar sideways. */}
                    {(() => {
                        const isSubjectDefault =
                            subjectName?.toLowerCase() === 'default' || !subjectName;
                        const isModuleDefault =
                            moduleName?.toLowerCase() === 'default' || !moduleName;
                        const isChapterDefault =
                            chapterName?.toLowerCase() === 'default' || !chapterName;

                        // Don't show breadcrumb if all three are default
                        if (isSubjectDefault && isModuleDefault && isChapterDefault) {
                            return null;
                        }

                        const pathLinkClass =
                            'min-w-0 cursor-pointer truncate text-xs font-medium text-neutral-500 transition-colors duration-200 hover:text-primary-600';

                        return (
                            <div className="flex w-full min-w-0 flex-col gap-1.5 px-3 pb-3">
                                {(!isSubjectDefault || !isModuleDefault) && (
                                    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                                        {!isSubjectDefault && (
                                            <span
                                                onClick={handleSubjectRoute}
                                                title={subjectName}
                                                className={pathLinkClass}
                                            >
                                                {subjectName}
                                            </span>
                                        )}
                                        {!isSubjectDefault && !isModuleDefault && (
                                            <CaretRight className="size-3 shrink-0 text-neutral-400" />
                                        )}
                                        {!isModuleDefault && (
                                            <span
                                                onClick={handleModuleRoute}
                                                title={moduleName}
                                                className={pathLinkClass}
                                            >
                                                {moduleName}
                                            </span>
                                        )}
                                    </div>
                                )}
                                {!isChapterDefault && (
                                    <span
                                        title={chapterName}
                                        className="w-fit max-w-full truncate rounded-md bg-primary-100/50 px-2 py-1 text-sm font-semibold text-primary-700"
                                    >
                                        {chapterName}
                                    </span>
                                )}
                            </div>
                        );
                    })()}
                </div>

                {/* Course-level unsaved-changes banner (only while drafts exist) */}
                <CourseUnsavedBanner courseId={courseId} />

                {/* Chapter Navigator */}
                <div className="w-full border-b border-primary-100 bg-white/50 p-2">
                    <ChapterNavigator
                        currentChapterId={chapterId}
                        currentModuleId={moduleId}
                        courseId={courseId}
                        levelId={levelId}
                        subjectId={subjectId}
                        sessionId={sessionId}
                    />
                </div>

                <div className={`flex w-full flex-1 flex-col gap-4 px-3 pb-3 pt-4`}>
                    <div className="flex w-full flex-col items-center gap-6 pb-2">
                        <ChapterSidebarSlides handleSlideOrderChange={handleSlideOrderChange} />
                    </div>
                </div>

                {/* Footer docked to the panel, not the viewport. Both of these
                    used to be `fixed`: the add bar guessed a 280px width that
                    never matched the 307px panel, and the unsaved reminder spanned
                    the whole screen (inset-x-4) across the slide editor. They now
                    share one dock at the bottom of the sidebar column.

                    Add button shows for DRAFT courses or when the role's
                    `directEditPublishedCourse` flag lets the teacher edit published
                    courses in place. Hidden in learner view. */}
                {(unsavedChanges.hasChanges ||
                    (!isLearnerView && (isDraftCourse || allowDirectEditPublished))) && (
                    <div className="sticky bottom-0 z-10 mt-auto flex w-full flex-col gap-2 border-t border-primary-100 bg-primary-50/95 px-2 py-3 backdrop-blur-sm">
                        {unsavedChanges.hasChanges && (
                            <Alert className="border-amber-200 bg-amber-50 py-2">
                                <AlertDescription className="text-xs text-amber-800">
                                    {t('unsavedChangesBanner', {
                                        slideTitle: unsavedChanges.slideTitle,
                                    })}
                                </AlertDescription>
                            </Alert>
                        )}
                        {!isLearnerView && (isDraftCourse || allowDirectEditPublished) && (
                            <ChapterSidebarAddButton />
                        )}
                    </div>
                )}
            </div>
        ),
        [
            isReadOnlyMode,
            courseStatus,
            subjectName,
            moduleName,
            chapterName,
            handleSubjectRoute,
            handleModuleRoute,
            handleSlideOrderChange,
            isLearnerView,
            isDraftCourse,
            unsavedChanges,
            chapterId,
            moduleId,
            courseId,
            levelId,
            subjectId,
            sessionId,
        ]
    );

    useEffect(() => {
        setNavHeading(heading);
    }, [heading, setNavHeading]);

    const getCurrentEditorHTMLContentRef = useRef<() => string>(() => '');

    // Create our custom save function for non-admin users. Triggers on DRAFT
    // courses (the approval-flow path) AND when the role's
    // `directEditPublishedCourse` flag is on (in-place edit on published
    // courses). Without the second branch, teachers in direct-edit mode would
    // see their slide edits silently dropped on save.
    const customSaveDraft = useCallback(
        async (slide: Slide) => {
            if (isDraftCourse || allowDirectEditPublished) {
                const currentEditorContent = getCurrentEditorHTMLContentRef.current();
                await saveSlideAsPublished(slide, true, currentEditorContent);
            }
        },
        [isDraftCourse, allowDirectEditPublished, saveSlideAsPublished]
    );

    return (
        <SaveDraftProvider
            getCurrentEditorHTMLContent={() => getCurrentEditorHTMLContentRef.current()}
            saveDraft={customSaveDraft}
        >
            <LayoutContainer
                internalSidebarComponent={SidebarComponent}
                hasInternalSidebarComponent={true}
            >
                <InitStudyLibraryProvider courseId={courseId}>
                    <ModulesWithChaptersProvider>
                        <SidebarProvider defaultOpen={false}>
                            <SidebarProvider defaultOpen={false}>
                                <Suspense
                                    fallback={
                                        <div className="size-full animate-pulse bg-gray-100" />
                                    }
                                >
                                    <SlideMaterial
                                        setGetCurrentEditorHTMLContent={(fn) =>
                                            (getCurrentEditorHTMLContentRef.current = fn)
                                        }
                                        setSaveDraft={() => {}} // Not used when customSaveFunction is provided
                                        isLearnerView={isLearnerView}
                                        hidePublishButtons={!allowDirectEditPublished}
                                        customSaveFunction={customSaveDraft}
                                    />
                                </Suspense>
                            </SidebarProvider>
                        </SidebarProvider>
                    </ModulesWithChaptersProvider>
                </InitStudyLibraryProvider>
            </LayoutContainer>

            {/* Action Buttons Container */}
            <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
                {/* Preview / View Content button — only relevant in the
                    Copy-to-Edit / approval flow. In direct-edit mode the
                    teacher is editing the live course in place, so there's
                    no separate "original" to preview. */}
                {!allowDirectEditPublished && (
                    <PreviewChangesButton
                        currentCourseId={courseId}
                        originalCourseId={originalCourseId}
                        subjectId={subjectId}
                        packageSessionId={sessionId}
                        chapterId={chapterId}
                        disabled={unsavedChanges.hasChanges}
                    />
                )}

                {/* Send for Approval Button - Only show for draft courses with changes */}
                {isDraftCourse && (
                    <SendForApprovalButton
                        courseId={courseId}
                        hasChanges={showApprovalButton}
                        disabled={unsavedChanges.hasChanges}
                    />
                )}
            </div>
        </SaveDraftProvider>
    );
}
