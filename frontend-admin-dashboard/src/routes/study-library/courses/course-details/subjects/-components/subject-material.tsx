import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
import { EngagementTab } from '../../-components/engagement/EngagementTab';
// class-study-material.tsx
import { useRouter } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { AddSubjectButton } from './add-subject.tsx/add-subject-button';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SubjectType, useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useAddSubject } from '@/routes/study-library/courses/course-details/subjects/-services/addSubject';
import { useUpdateSubject } from '@/routes/study-library/courses/course-details/subjects/-services/updateSubject';
import { useDeleteSubject } from '@/routes/study-library/courses/course-details/subjects/-services/deleteSubject';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getCourseSubjects } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getSubjects';
import { useGetPackageSessionId } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getPackageSessionId';
import { useGetPackageSessionIdFromCourseInit } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getPackageSessionIdFromCourseInit';
import { useUpdateSubjectOrder } from '@/routes/study-library/courses/course-details/subjects/-services/updateSubjectOrder';
// import useIntroJsTour from '@/hooks/use-intro';
// import { StudyLibraryIntroKey } from '@/constants/storage/introKey';
// import { studyLibrarySteps } from '@/constants/intro/steps';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { buildTabs, TabType, DEFAULT_HIDDEN_COURSE_DETAILS_TABS } from '../-constants/constant';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { fetchModulesWithChapters } from '../../../-services/getModulesWithChapters';
import {
    UseSlidesFromModulesInput,
    fetchChaptersWithSlides,
    ChapterWithSlides,
    Slide,
} from '../../../-services/getAllSlides';
import { MyDropdown } from '@/components/common/students/enroll-manually/dropdownForPackageItems';
import { DropdownValueType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { DropdownItemType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { useAddModule } from '@/routes/study-library/courses/course-details/subjects/modules/-services/add-module';
// Assuming AddModulesButton and AddChapterButton handle their own styling including roundness
import { AddModulesButton } from '../modules/-components/add-modules.tsx/add-modules-button';
import { AddChapterButton } from '../modules/chapters/-components/chapter-material/add-chapters/add-chapter-button';
import {
    CaretDown,
    CaretRight,
    Plus,
    ArrowSquareOut,
    Folder,
    FileText,
    PresentationChart,
    CornersOut,
    CornersIn,
} from '@phosphor-icons/react';
import Students from './student-list';
import Assessments from './assessment-list';
import QuizResultsTab from '../../-components/quiz-results/QuizResultsTab';
import LiveSessions from './live-sessions-list';
import BatchReports from '@/routes/study-library/reports/-components/batch/batchReports';
import { CertificatesTab } from '../../-components/certificates/CertificatesTab';
import Planning from './planning';
import Activity from './activity';
import PulseTab from '../../-components/pulse/PulseTab';
import { PackageSettingsPanel } from '../../-components/package-settings/PackageSettingsPanel';
import { TutorModeTab } from '../../-components/tutor-mode/TutorModeTab';
import { AiKnowledgeTab } from '../../-components/ai-knowledge/AiKnowledgeTab';
import { useCourseKnowledgeStatus } from '@/services/course-knowledge-settings';
import { getIcon } from '../modules/chapters/slides/-components/slides-sidebar/slides-sidebar-slides';
import { MyButton } from '@/components/design-system/button';
import { useContentStore } from '../modules/chapters/slides/-stores/chapter-sidebar-store';
import { TeachersList } from './teacher-list';
import AddTeachers from '@/routes/dashboard/-components/AddTeachers';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { ADMIN_DISPLAY_SETTINGS_KEY, TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import { getDisplaySettingsFromCache } from '@/services/display-settings';

// Interfaces (assuming these are unchanged)
export interface Chapter {
    id: string;
    chapter_name: string;
    status: string;
    description: string;
    file_id: string | null;
    chapter_order: number;
}
export interface ChapterMetadata {
    chapter: Chapter;
    slides_count: {
        video_count: number;
        pdf_count: number;
        doc_count: number;
        unknown_count: number;
    };
    chapter_in_package_sessions: string[];
}
export interface Module {
    id: string;
    module_name: string;
    status: string;
    description: string;
    thumbnail_id: string;
}
export interface ModuleWithChapters {
    module: Module;
    chapters: ChapterMetadata[];
}
export type SubjectModulesMap = { [subjectId: string]: ModuleWithChapters[] };

export const SubjectMaterial = () => {
    const { t } = useTranslation('subjectMaterial');
    // The AI knowledge tab shows only when course knowledge is available to the
    // institute; loading or failed counts as not available.
    const { data: courseKnowledgeStatus } = useCourseKnowledgeStatus();
    const isAiKnowledgeAvailable = courseKnowledgeStatus?.available === true;
    // role display for numbering toggle
    const accessToken = document?.cookie || '';
    // Simple check from existing stores would be better; fallback to ADMIN=false
    const isAdminRole = (accessToken.includes('roles=') && accessToken.includes('ADMIN')) || false;
    const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
    const roleKey = getActiveRoleDisplaySettingsKey();
    const roleDisplay = getDisplaySettingsFromCache(roleKey);
    const showNumbering = roleDisplay?.coursePage?.viewContentNumbering !== false;
    const router = useRouter();
    const searchParams = router.state.location.search;
    const { getSessionFromPackage, getPackageSessionId } = useInstituteDetailsStore();
    const { studyLibraryData } = useStudyLibraryStore();
    const { setActiveItem } = useContentStore();

    const courseId: string = searchParams.courseId || '';
    const levelId: string = searchParams.levelId || '';
    const urlSessionId: string = searchParams.sessionId || '';

    const [sessionList, setSessionList] = useState<DropdownItemType[]>(
        searchParams.courseId ? getSessionFromPackage({ courseId: courseId, levelId: levelId }) : []
    );

    const getInitialSession = (sessions: DropdownItemType[]): DropdownItemType | undefined => {
        if (urlSessionId) {
            const matched = sessions.find((s) => s.id === urlSessionId);
            if (matched) return matched;
        }
        return sessions[0] ? { id: sessions[0].id, name: sessions[0].name } : undefined;
    };

    const [currentSession, setCurrentSession] = useState<DropdownItemType | undefined>(
        () => getInitialSession(sessionList)
    );

    useEffect(() => {
        if (!searchParams.courseId) return;
        const newList = getSessionFromPackage({ courseId: courseId, levelId: searchParams.levelId });
        setSessionList((prev) => {
            if (prev.length === newList.length && prev.every((s, i) => s.id === newList[i]?.id)) {
                return prev;
            }
            return newList;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.courseId, searchParams.levelId]);

    useEffect(() => {
        const next = getInitialSession(sessionList);
        setCurrentSession((prev) => {
            if (prev?.id === next?.id) return prev;
            return next;
        });
    }, [sessionList]);

    const handleSessionChange = (value: DropdownValueType) => {
        if (value && typeof value === 'object' && 'id' in value && 'name' in value) {
            setCurrentSession(value as DropdownItemType);
        }
    };

    const [selectedTab, setSelectedTab] = useState<string>(TabType.OUTLINE);
    const handleTabChange = (value: string) => setSelectedTab(value);

    const [subjectModulesMap, setSubjectModulesMap] = useState<SubjectModulesMap>({});
    const [chapterSlidesMap, setChapterSlidesMap] = useState<{ [chapterId: string]: Slide[] }>({});
    const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());
    const [openModules, setOpenModules] = useState<Set<string>>(new Set());
    const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());

    const expandAll = () => {
        const allSubjectIds = new Set(subjects.map((s) => s.id));
        const allModuleIds = new Set<string>();
        const allChapterIds = new Set<string>();

        Object.values(subjectModulesMap)
            .flat()
            .forEach((modWithChapters) => {
                allModuleIds.add(modWithChapters.module.id);
                modWithChapters.chapters.forEach((chapWithMeta) => {
                    allChapterIds.add(chapWithMeta.chapter.id);
                });
            });

        setOpenSubjects(allSubjectIds);
        setOpenModules(allModuleIds);
        setOpenChapters(allChapterIds);
    };

    const collapseAll = () => {
        setOpenSubjects(new Set());
        setOpenModules(new Set());
        setOpenChapters(new Set());
    };

    const addModuleMutation = useAddModule();
    const addSubjectMutation = useAddSubject();
    const updateSubjectMutation = useUpdateSubject();
    const deleteSubjectMutation = useDeleteSubject();
    const updateSubjectOrderMutation = useUpdateSubjectOrder();

    // useIntroJsTour({
    //     key: StudyLibraryIntroKey.addSubjectStep,
    //     steps: studyLibrarySteps.addSubjectStep,
    // });

    const initialSubjects = getCourseSubjects(courseId, currentSession?.id ?? '', levelId);
    const [subjects, setSubjects] = useState(initialSubjects);

    useEffect(() => {
        const newSubjects = getCourseSubjects(courseId, currentSession?.id ?? '', levelId);
        setSubjects(newSubjects);
    }, [currentSession, studyLibraryData, courseId, levelId]);

    // Try to get packageSessionId from course-init API first (new approach)
    const packageSessionIdFromCourseInit = useGetPackageSessionIdFromCourseInit(
        courseId,
        currentSession?.id ?? '',
        levelId
    );
    // Fallback to institute details if course-init doesn't have it
    const packageSessionIdFromInstitute =
        useGetPackageSessionId(courseId, currentSession?.id ?? '', levelId) || '';
    // Prefer course-init data, fallback to institute details
    const packageSessionIds = packageSessionIdFromCourseInit || packageSessionIdFromInstitute;

    const useSlidesByChapterMutation = () => {
        return useMutation({
            mutationFn: async ({ modules, packageSessionId }: UseSlidesFromModulesInput) => {
                const chapterSlidesMapUpdate: { [chapterId: string]: Slide[] } = {};
                await Promise.all(
                    modules.map(async (module) => {
                        const chaptersWithSlides = await fetchChaptersWithSlides(
                            module.id,
                            packageSessionId
                        );
                        chaptersWithSlides.forEach((chapterWithSlides: ChapterWithSlides) => {
                            chapterSlidesMapUpdate[chapterWithSlides.chapter.id] =
                                chapterWithSlides.slides;
                        });
                    })
                );
                return chapterSlidesMapUpdate;
            },
        });
    };
    const { mutateAsync: fetchSlides } = useSlidesByChapterMutation();

    const useModulesMutation = () => {
        return useMutation({
            mutationFn: async ({
                subjects: currentSubjects,
                packageSessionIds: currentPackageSessionIds,
            }: {
                subjects: SubjectType[];
                packageSessionIds: string;
            }) => {
                const results = await Promise.all(
                    currentSubjects.map(async (subject) => {
                        const res = await fetchModulesWithChapters(
                            subject.id,
                            currentPackageSessionIds
                        );
                        return { subjectId: subject.id, modules: res };
                    })
                );
                const modulesMap: SubjectModulesMap = {};
                results.forEach(({ subjectId, modules }) => {
                    modulesMap[subjectId] = modules;
                });
                return modulesMap;
            },
        });
    };
    const { mutateAsync: fetchModules } = useModulesMutation();

    const handleAddModule = (subjectId: string, module: Module) => {
        addModuleMutation.mutate(
            {
                subjectId,
                packageSessionIds:
                    getPackageSessionId({
                        courseId: courseId,
                        levelId: levelId,
                        sessionId: currentSession?.id || '',
                    }) || '',
                module,
            },
            {
                onSuccess: async () => {
                    const updatedSubjects = getCourseSubjects(
                        courseId,
                        currentSession?.id ?? '',
                        levelId
                    );
                    if (updatedSubjects.length > 0 && packageSessionIds) {
                        const updatedModulesMap = await fetchModules({
                            subjects: updatedSubjects,
                            packageSessionIds,
                        });
                        setSubjectModulesMap(updatedModulesMap);
                    }
                    setSubjects(updatedSubjects);
                },
            }
        );
    };

    useEffect(() => {
        const loadModules = async () => {
            if (subjects.length > 0 && packageSessionIds) {
                try {
                    const modulesMap = await fetchModules({ subjects, packageSessionIds });
                    setSubjectModulesMap(modulesMap);

                    // Expand all by default
                    const allSubjectIds = new Set(subjects.map((s) => s.id));
                    const allModuleIds = new Set<string>();
                    const allChapterIds = new Set<string>();

                    Object.values(modulesMap)
                        .flat()
                        .forEach((modWithChapters) => {
                            allModuleIds.add(modWithChapters.module.id);
                            modWithChapters.chapters.forEach((chapWithMeta) => {
                                allChapterIds.add(chapWithMeta.chapter.id);
                            });
                        });
                    setOpenSubjects(allSubjectIds);
                    setOpenModules(allModuleIds);
                    setOpenChapters(allChapterIds);
                } catch (error) {
                    console.error('Failed to fetch modules:', error);
                    setSubjectModulesMap({});
                }
            } else {
                setSubjectModulesMap({});
            }
        };
        loadModules();
    }, [subjects, packageSessionIds, fetchModules]);

    useEffect(() => {
        const loadSlides = async () => {
            const allModules: { id: string }[] = Object.values(subjectModulesMap)
                .flat()
                .map((m) => ({ id: m.module.id }));
            if (allModules.length > 0 && packageSessionIds) {
                try {
                    const slideMap = await fetchSlides({
                        modules: allModules,
                        packageSessionId: packageSessionIds,
                    });
                    setChapterSlidesMap(slideMap);
                } catch (error) {
                    console.error('Failed to fetch slides:', error);
                    setChapterSlidesMap({});
                }
            } else {
                setChapterSlidesMap({});
            }
        };
        if (Object.keys(subjectModulesMap).length > 0 && packageSessionIds) {
            loadSlides();
        } else {
            setChapterSlidesMap({});
        }
    }, [subjectModulesMap, packageSessionIds, fetchSlides]);

    const handleAddSubject = async (newSubject: SubjectType) => {
        if (!packageSessionIds) {
            console.error('No package session IDs found');
            return;
        }
        addSubjectMutation.mutate({ subject: newSubject, packageSessionIds });
    };

    const navigateTo = (pathname: string, searchParamsObj: Record<string, string | undefined>) =>
        router.navigate({ to: pathname, search: searchParamsObj });
    const handleSubjectNavigation = (subjectId: string) =>
        navigateTo(`${router.state.location.pathname}/modules`, {
            courseId,
            levelId,
            subjectId,
            sessionId: currentSession?.id,
        });
    const handleModuleNavigation = (subjectId: string, moduleId: string) =>
        navigateTo(`${router.state.location.pathname}/modules/chapters`, {
            courseId,
            levelId,
            subjectId,
            moduleId,
            sessionId: currentSession?.id,
        });
    const handleChapterNavigation = (subjectId: string, moduleId: string, chapterId: string) =>
        navigateTo(`${router.state.location.pathname}/modules/chapters/slides`, {
            courseId,
            levelId,
            subjectId,
            moduleId,
            chapterId,
            sessionId: currentSession?.id,
        });
    const handleSlideNavigation = (
        subjectId: string,
        moduleId: string,
        chapterId: string,
        slideId: string
    ) => {
        console.log('slideId: ', slideId);

        const slide = chapterSlidesMap[chapterId]?.find((s) => s.id === slideId);

        if (slide) {
            setActiveItem(slide);
        } else {
            // Fallback for safety, though this path should ideally not be taken
            setActiveItem({
                id: slideId,
                source_id: '',
                source_type: '',
                title: '',
                image_file_id: '',
                description: '',
                status: '',
                slide_order: 0,
                video_slide: null,
                document_slide: null,
                question_slide: null,
                assignment_slide: null,
                is_loaded: false,
                new_slide: false,
            });
        }

        navigateTo(`${router.state.location.pathname}/modules/chapters/slides`, {
            courseId,
            levelId,
            subjectId,
            moduleId,
            chapterId,
            sessionId: currentSession?.id,
            slideId,
        });
    };

    const toggleOpenState = (
        id: string,
        setter: React.Dispatch<React.SetStateAction<Set<string>>>
    ) => {
        setter((prev) => {
            const u = new Set(prev);
            u.has(id) ? u.delete(id) : u.add(id);
            return u;
        });
    };
    const toggleSubject = (id: string) => toggleOpenState(id, setOpenSubjects);
    const toggleModule = (id: string) => toggleOpenState(id, setOpenModules);
    const toggleChapter = (id: string) => toggleOpenState(id, setOpenChapters);

    const tabContent: Record<TabType, React.ReactNode> = {
        [TabType.OUTLINE]: (
            <div className="space-y-4">
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="w-full max-w-[280px]">
                        <MyDropdown
                            currentValue={currentSession ?? undefined}
                            dropdownList={sessionList}
                            placeholder={t('selectTerm', { term: getTerminology(ContentTerms.Session, SystemTerms.Session) })}
                            handleChange={handleSessionChange}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <MyButton
                            buttonType="secondary"
                            onClick={expandAll}
                            className="flex items-center gap-1.5"
                        >
                            <CornersOut size={16} />
                            <span>{t('expandAll')}</span>
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            onClick={collapseAll}
                            className="flex items-center gap-1.5"
                        >
                            <CornersIn size={16} />
                            <span>{t('collapseAll')}</span>
                        </MyButton>
                    </div>
                </div>

                <div className="max-w-3xl space-y-1 rounded-lg border border-gray-200 p-2">
                    <AddSubjectButton isTextButton onAddSubject={handleAddSubject} />

                    {subjects.map((subject, idx) => {
                        const isSubjectOpen = openSubjects.has(subject.id);

                        return (
                            <Collapsible
                                key={subject.id}
                                open={isSubjectOpen}
                                onOpenChange={() => toggleSubject(subject.id)}
                                className="group"
                            >
                                <CollapsibleTrigger className="flex w-full items-center rounded-md p-2 text-left text-sm font-semibold text-gray-800 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                                    <div className="flex flex-1 items-center gap-2.5">
                                        {isSubjectOpen ? (
                                            <CaretDown
                                                size={18}
                                                weight="bold"
                                                className="shrink-0 text-gray-500"
                                            />
                                        ) : (
                                            <CaretRight
                                                size={18}
                                                weight="bold"
                                                className="shrink-0 text-gray-500"
                                            />
                                        )}
                                        <Folder
                                            size={20}
                                            weight="duotone"
                                            className="shrink-0 text-primary-500"
                                        />
                                        {showNumbering && (
                                            <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs font-medium text-gray-600 group-hover:bg-white">
                                                S{idx + 1}
                                            </span>
                                        )}
                                        <span className="truncate" title={subject.subject_name}>
                                            {subject.subject_name}
                                        </span>
                                    </div>
                                    <ArrowSquareOut
                                        size={18}
                                        className="ml-2 shrink-0 cursor-pointer text-gray-400 opacity-0 transition-opacity duration-200 hover:text-primary-500 group-hover:opacity-100"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSubjectNavigation(subject.id);
                                        }}
                                    />
                                </CollapsibleTrigger>
                                <CollapsibleContent className="py-1 pl-8">
                                    <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-6">
                                        <div className="absolute -left-[13px] top-0 h-full">
                                            <div className="sticky top-0 flex h-full flex-col items-center" />
                                        </div>

                                        <AddModulesButton
                                            isTextButton
                                            subjectId={subject.id}
                                            onAddModuleBySubjectId={handleAddModule}
                                        />
                                        {(subjectModulesMap[subject.id] ?? []).map(
                                            (mod, modIdx) => {
                                                const isModuleOpen = openModules.has(mod.module.id);

                                                return (
                                                    <Collapsible
                                                        key={mod.module.id}
                                                        open={isModuleOpen}
                                                        onOpenChange={() =>
                                                            toggleModule(mod.module.id)
                                                        }
                                                        className="group/module"
                                                    >
                                                        <CollapsibleTrigger className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                                                            <div className="flex flex-1 items-center gap-2.5">
                                                                {isModuleOpen ? (
                                                                    <CaretDown
                                                                        size={16}
                                                                        className="shrink-0 text-gray-500"
                                                                    />
                                                                ) : (
                                                                    <CaretRight
                                                                        size={16}
                                                                        className="shrink-0 text-gray-500"
                                                                    />
                                                                )}
                                                                <FileText
                                                                    size={18}
                                                                    weight="duotone"
                                                                    className="shrink-0 text-blue-600"
                                                                />
                                                                {showNumbering && (
                                                                    <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs font-medium text-gray-500 group-hover/module:bg-white">
                                                                        M{modIdx + 1}
                                                                    </span>
                                                                )}
                                                                <span
                                                                    className="truncate"
                                                                    title={mod.module.module_name}
                                                                >
                                                                    {mod.module.module_name}
                                                                </span>
                                                            </div>
                                                            <ArrowSquareOut
                                                                size={16}
                                                                className="ml-2 shrink-0 cursor-pointer text-gray-400 opacity-0 transition-opacity duration-200 hover:text-primary-500 group-hover/module:opacity-100"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleModuleNavigation(
                                                                        subject.id,
                                                                        mod.module.id
                                                                    );
                                                                }}
                                                            />
                                                        </CollapsibleTrigger>
                                                        <CollapsibleContent className="py-1 pl-8">
                                                            <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-6">
                                                                <AddChapterButton
                                                                    moduleId={mod.module.id}
                                                                    sessionId={currentSession?.id}
                                                                    isTextButton
                                                                />
                                                                {(mod.chapters ?? []).map(
                                                                    (ch, chIdx) => {
                                                                        const isChapterOpen =
                                                                            openChapters.has(
                                                                                ch.chapter.id
                                                                            );
                                                                        return (
                                                                            <Collapsible
                                                                                key={ch.chapter.id}
                                                                                open={isChapterOpen}
                                                                                onOpenChange={() =>
                                                                                    toggleChapter(
                                                                                        ch.chapter
                                                                                            .id
                                                                                    )
                                                                                }
                                                                                className="group/chapter"
                                                                            >
                                                                                <CollapsibleTrigger className="flex w-full items-center rounded-md px-2 py-1 text-left text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                                                                                    <div className="flex flex-1 items-center gap-2">
                                                                                        {isChapterOpen ? (
                                                                                            <CaretDown
                                                                                                size={
                                                                                                    14
                                                                                                }
                                                                                                className="shrink-0 text-gray-500"
                                                                                            />
                                                                                        ) : (
                                                                                            <CaretRight
                                                                                                size={
                                                                                                    14
                                                                                                }
                                                                                                className="shrink-0 text-gray-500"
                                                                                            />
                                                                                        )}
                                                                                        <PresentationChart
                                                                                            size={
                                                                                                16
                                                                                            }
                                                                                            weight="duotone"
                                                                                            className="shrink-0 text-green-600"
                                                                                        />
                                                                                        <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs text-gray-500 group-hover/chapter:bg-white">
                                                                                            C
                                                                                            {chIdx +
                                                                                                1}
                                                                                        </span>
                                                                                        <span
                                                                                            className="truncate"
                                                                                            title={
                                                                                                ch
                                                                                                    .chapter
                                                                                                    .chapter_name
                                                                                            }
                                                                                        >
                                                                                            {
                                                                                                ch
                                                                                                    .chapter
                                                                                                    .chapter_name
                                                                                            }
                                                                                        </span>
                                                                                    </div>
                                                                                    <ArrowSquareOut
                                                                                        size={14}
                                                                                        className="ml-1.5 shrink-0 cursor-pointer text-gray-400 opacity-0 transition-opacity duration-200 hover:text-primary-500 group-hover/chapter:opacity-100"
                                                                                        onClick={(
                                                                                            e
                                                                                        ) => {
                                                                                            e.stopPropagation();
                                                                                            handleChapterNavigation(
                                                                                                subject.id,
                                                                                                mod
                                                                                                    .module
                                                                                                    .id,
                                                                                                ch
                                                                                                    .chapter
                                                                                                    .id
                                                                                            );
                                                                                        }}
                                                                                    />
                                                                                </CollapsibleTrigger>
                                                                                <CollapsibleContent className="py-1 pl-8">
                                                                                    <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-6">
                                                                                        <MyButton
                                                                                            buttonType="text"
                                                                                            onClick={(
                                                                                                e
                                                                                            ) => {
                                                                                                e.stopPropagation();
                                                                                                handleChapterNavigation(
                                                                                                    subject.id,
                                                                                                    mod
                                                                                                        .module
                                                                                                        .id,
                                                                                                    ch
                                                                                                        .chapter
                                                                                                        .id
                                                                                                );
                                                                                            }}
                                                                                            className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
                                                                                        >
                                                                                            <Plus
                                                                                                size={
                                                                                                    14
                                                                                                }
                                                                                                weight="bold"
                                                                                                className="text-primary-400 group-hover:text-primary-500"
                                                                                            />
                                                                                            <span className="font-medium">
                                                                                                {t('addSlide')}
                                                                                            </span>
                                                                                        </MyButton>

                                                                                        {(
                                                                                            chapterSlidesMap[
                                                                                                ch
                                                                                                    .chapter
                                                                                                    .id
                                                                                            ] ?? []
                                                                                        ).length ===
                                                                                        0 ? (
                                                                                            <div className="px-2 py-1 text-xs text-gray-400">
                                                                                                {t('noSlidesInChapter')}
                                                                                            </div>
                                                                                        ) : (
                                                                                            (
                                                                                                chapterSlidesMap[
                                                                                                    ch
                                                                                                        .chapter
                                                                                                        .id
                                                                                                ] ??
                                                                                                []
                                                                                            ).map(
                                                                                                (
                                                                                                    slide,
                                                                                                    sIdx
                                                                                                ) => (
                                                                                                    <div
                                                                                                        key={
                                                                                                            slide.id
                                                                                                        }
                                                                                                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                                                                                                        onClick={() => {
                                                                                                            handleSlideNavigation(
                                                                                                                subject.id,
                                                                                                                mod
                                                                                                                    .module
                                                                                                                    .id,
                                                                                                                ch
                                                                                                                    .chapter
                                                                                                                    .id,
                                                                                                                slide.id
                                                                                                            );
                                                                                                        }}
                                                                                                    >
                                                                                                        {showNumbering && (
                                                                                                            <span className="w-7 shrink-0 text-center font-mono text-xs text-gray-400">
                                                                                                                S
                                                                                                                {sIdx +
                                                                                                                    1}
                                                                                                            </span>
                                                                                                        )}
                                                                                                        {getIcon(
                                                                                                            slide.source_type,
                                                                                                            slide
                                                                                                                .document_slide
                                                                                                                ?.type,
                                                                                                            '3',
                                                                                                            slide
                                                                                                        )}
                                                                                                        <span
                                                                                                            className="truncate"
                                                                                                            title={
                                                                                                                slide.title
                                                                                                            }
                                                                                                        >
                                                                                                            {
                                                                                                                slide.title
                                                                                                            }
                                                                                                        </span>
                                                                                                    </div>
                                                                                                )
                                                                                            )
                                                                                        )}
                                                                                    </div>
                                                                                </CollapsibleContent>
                                                                            </Collapsible>
                                                                        );
                                                                    }
                                                                )}
                                                            </div>
                                                        </CollapsibleContent>
                                                    </Collapsible>
                                                );
                                            }
                                        )}
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        );
                    })}
                    {subjects.length === 0 && (
                        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 py-6 text-center text-sm text-gray-500">
                            {t('noSubjectsAvailable')}
                        </div>
                    )}
                </div>
            </div>
        ),
        [TabType.STUDENT]: (
            <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                {currentSession && (
                    <Students
                        packageSessionId={packageSessionIds ?? ''}
                        currentSession={currentSession}
                    />
                )}
            </div>
        ),
        [TabType.TEACHERS]: (
            <div className="space-y-3">
                <div className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
                    <div className="flex-1">
                        <h2 className="text-base font-semibold text-gray-800">{t('manageTeachers')}</h2>
                        <p className="mt-0.5 text-xs text-gray-500">
                            {t('viewAndManageTeachers')}
                        </p>
                    </div>
                    <AddTeachers packageSessionId={packageSessionIds} />
                </div>
                <TeachersList packageSessionId={packageSessionIds ?? ''} />
            </div>
        ),
        [TabType.ASSESSMENT]: (
            <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                <Assessments packageSessionId={packageSessionIds ?? ''} />
            </div>
        ),
        [TabType.QUIZ_RESULTS]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <QuizResultsTab packageSessionId={packageSessionIds ?? ''} />
            </div>
        ),
        [TabType.LIVE_SESSION]: packageSessionIds ? (
            <div className="rounded-md bg-white text-sm text-gray-600 shadow-sm">
                <LiveSessions packageSessionId={packageSessionIds} />
            </div>
        ) : (
            <div className="rounded-md bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
                {t('selectBatchLiveSessions')}
            </div>
        ),
        [TabType.REPORTS]: packageSessionIds ? (
            <div className="rounded-md bg-white text-sm text-gray-600 shadow-sm">
                <BatchReports packageSessionId={packageSessionIds} courseId={courseId} />
            </div>
        ) : (
            <div className="rounded-md bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
                {t('selectBatchReports')}
            </div>
        ),
        [TabType.CERTIFICATES]: (
            <CertificatesTab packageId={courseId} packageSessionId={packageSessionIds ?? ''} />
        ),
        [TabType.CONTENT_STRUCTURE]: (
            <div className="p-6 py-2">
                <div className="mb-4">
                    <h3 className="mb-2 text-lg font-semibold text-gray-800">{t('contentStructureHeading')}</h3>
                    <p className="text-sm text-gray-600">
                        {t('navigateContentStructure')}
                    </p>
                </div>
                <div className="rounded-md bg-gray-50 p-6 text-center">
                    <p className="text-sm text-gray-500">
                        {t('contentStructureAvailableElsewhere')}
                    </p>
                </div>
            </div>
        ),
        [TabType.PLANNING]: (
            <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                <Planning packageSessionId={packageSessionIds ?? ''} />
            </div>
        ),
        [TabType.ACTIVITY]: (
            <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                <Activity packageSessionId={packageSessionIds ?? ''} />
            </div>
        ),
        [TabType.ENGAGEMENT]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <EngagementTab packageSessionId={packageSessionIds ?? ''} />
            </div>
        ),
        [TabType.PULSE]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <PulseTab packageSessionId={packageSessionIds ?? ''} />
            </div>
        ),
        [TabType.SETTINGS]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <PackageSettingsPanel packageId={courseId} />
            </div>
        ),
        [TabType.TUTOR_MODE]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <TutorModeTab key={courseId} packageId={courseId} />
            </div>
        ),
        [TabType.AI_KNOWLEDGE]: isAiKnowledgeAvailable ? (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <AiKnowledgeTab key={courseId} packageId={courseId} />
            </div>
        ) : null,
        // The Discussion (batch chat) and Downloads (offline telemetry) tabs are
        // rendered only from course-details — Downloads needs the institute
        // OFFLINE_ACCESS_SETTING gate that lives there, so surfacing it here would
        // show it even when offline access is off. This view filters both out of
        // its tab strip below. Map entries kept so the exhaustive
        // Record<TabType, ReactNode> type still compiles.
        [TabType.DISCUSSION]: null,
        [TabType.DOWNLOADS]: null,
    };

    if (courseId === '' || levelId === '') {
        console.log('courseId: ', courseId);
        console.log('levelId: ', levelId);
        return (
            <div className="flex h-full items-center justify-center p-4">
                <div className="max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
                    <h2 className="mb-1.5 text-lg font-semibold text-red-600">
                        {t('missingInformation')}
                    </h2>
                    <p className="text-sm text-gray-600">
                        {t('missingIdsBody', {
                            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                            level: getTerminology(ContentTerms.Level, SystemTerms.Level),
                        })}
                    </p>
                </div>
            </div>
        );
    }

    const isLoading =
        addSubjectMutation.isPending ||
        deleteSubjectMutation.isPending ||
        updateSubjectMutation.isPending ||
        updateSubjectOrderMutation.isPending;

    return isLoading ? (
        <DashboardLoader />
    ) : (
        <div className="flex size-full flex-col gap-3 rounded-lg bg-white p-2 text-neutral-700 md:p-3">
            <Tabs value={selectedTab} onValueChange={handleTabChange} className="w-full">
                <div className="overflow-x-auto border-b border-gray-200">
                    <TabsList
                        className="h-auto min-w-max flex-nowrap bg-transparent p-0"
                        style={{ display: 'flex', justifyContent: 'left' }}
                    >
                        {buildTabs(t)
                            .filter(
                                (tab) =>
                                    tab.value !== TabType.DISCUSSION &&
                                    tab.value !== TabType.DOWNLOADS &&
                                    (tab.value !== TabType.AI_KNOWLEDGE || isAiKnowledgeAvailable)
                            )
                            // Hidden-by-default tabs (e.g. Live Session) only show
                            // when a role's display settings explicitly enable them.
                            .filter(
                                (tab) =>
                                    !DEFAULT_HIDDEN_COURSE_DETAILS_TABS.has(tab.value) ||
                                    (roleDisplay?.courseDetails?.tabs?.some(
                                        (t) => t.id === tab.value && t.visible !== false
                                    ) ??
                                        false)
                            )
                            .map((tab) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className={`relative flex rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium !shadow-none transition-colors duration-200 hover:bg-gray-100 data-[state=active]:border-primary-500 data-[state=active]:bg-primary-50 data-[state=active]:text-primary-600`}
                            >
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                <TabsContent
                    key={selectedTab}
                    value={selectedTab}
                    className="mt-4 overflow-hidden rounded-r-md"
                >
                    {tabContent[selectedTab as TabType]}
                </TabsContent>
            </Tabs>
        </div>
    );
};
