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
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import React, { useEffect, useRef, useState, useMemo, useCallback, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveDraftProvider } from '../-context/saveDraftContext';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useModulesWithChaptersStore } from '@/stores/study-library/use-modules-with-chapters-store';
import { SidebarProvider } from '@/components/ui/sidebar';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useLearnerViewStore } from '../-stores/learner-view-store';
import { useContentStore } from '../-stores/chapter-sidebar-store';
import { Eye, UserGear } from '@phosphor-icons/react';

const SlideMaterial = React.lazy(() =>
    import(
        '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/slide-material'
    ).then((module) => ({ default: module.SlideMaterial }))
);

interface AdminSlidesViewProps {
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

export function AdminSlidesView({
    chapterId,
    courseId,
    levelId,
    subjectId,
    moduleId,
    sessionId,
}: AdminSlidesViewProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('studyLibraryAdminSlidesView');
    const { studyLibraryData } = useStudyLibraryStore();
    const { modulesWithChaptersData } = useModulesWithChaptersStore();
    const [subjectName, setSubjectName] = useState('');
    const [moduleName, setModuleName] = useState('');
    const chapterName = useChapterName(chapterId);
    const { updateSlideOrder } = useSlidesMutations(chapterId);
    const { setNavHeading } = useNavHeadingStore();
    const { resetChapterSidebarStore } = useContentStore();

    useEffect(() => {
        return () => {
            resetChapterSidebarStore();
        };
    }, [resetChapterSidebarStore]);

    // useIntroJsTour({
    //     key: StudyLibraryIntroKey.addSlidesStep,
    //     steps: studyLibrarySteps.addSlidesStep,
    // });

    // Course depth (2–5) decides which Content Structure level a breadcrumb crumb
    // maps to. Only structure 5 has a separate modules grid under each subject.
    const courseStructure =
        studyLibraryData?.find((item) => item.course.id === courseId)?.course?.course_depth ?? 0;

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
            try {
                await updateSlideOrder({
                    chapterId: chapterId,
                    slideOrderPayload: slideOrderPayload,
                });
            } catch (error) {
                console.error('Error updating slide order: ', error);
            }
        },
        [chapterId, updateSlideOrder]
    );

    useEffect(() => {
        setSubjectName(getSubjectName(subjectId || ''));
        setModuleName(getModuleName(moduleId || ''));
    }, [studyLibraryData, modulesWithChaptersData, subjectId, moduleId]);

    const heading = useMemo(
        () => (
            <div className="flex items-center gap-4">
                <CaretLeft onClick={() => window.history.back()} className="cursor-pointer" />
                <div>{`${chapterName || ''} ${getTerminology(
                    ContentTerms.Slides,
                    SystemTerms.Slides
                )}s`}</div>
            </div>
        ),
        [chapterName]
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
                            ? t('toggle.switchToInstructorView')
                            : t('toggle.switchToLearnerView')
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
                {/* Footer docked to the panel, not the viewport. The old
                    fixed 280px-wide bar guessed a width that never matched the
                    307px panel and sat outside the flow, so it floated over the
                    last row on short lists. */}
                {!isLearnerView && (
                    <div className="sticky bottom-0 z-10 mt-auto w-full border-t border-primary-100 bg-primary-50/95 px-2 py-3 backdrop-blur-sm">
                        <ChapterSidebarAddButton />
                    </div>
                )}
            </div>
        ),
        [
            subjectName,
            moduleName,
            chapterName,
            handleSubjectRoute,
            handleModuleRoute,
            handleSlideOrderChange,
            isLearnerView,
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
    const saveDraftRef = useRef(async (_slide: Slide) => {
        // Default stub — overridden by SlideMaterial via ref callback
    });

    return (
        <SaveDraftProvider
            getCurrentEditorHTMLContent={() => getCurrentEditorHTMLContentRef.current()}
            saveDraft={(slide) => saveDraftRef.current(slide)}
        >
            <LayoutContainer
                internalSidebarComponent={SidebarComponent}
                hasInternalSidebarComponent={true}
            >
                <InitStudyLibraryProvider courseId={courseId}>
                    <ModulesWithChaptersProvider>
                        <SidebarProvider defaultOpen={false}>
                            <Suspense
                                fallback={<div className="size-full animate-pulse bg-gray-100" />}
                            >
                                <SlideMaterial
                                    setGetCurrentEditorHTMLContent={(fn) =>
                                        (getCurrentEditorHTMLContentRef.current = fn)
                                    }
                                    setSaveDraft={(fn) => (saveDraftRef.current = fn)}
                                    isLearnerView={isLearnerView}
                                    hidePublishButtons={false}
                                    // No customSaveFunction - use default admin behavior
                                />
                            </Suspense>
                        </SidebarProvider>
                    </ModulesWithChaptersProvider>
                </InitStudyLibraryProvider>
            </LayoutContainer>
        </SaveDraftProvider>
    );
}
