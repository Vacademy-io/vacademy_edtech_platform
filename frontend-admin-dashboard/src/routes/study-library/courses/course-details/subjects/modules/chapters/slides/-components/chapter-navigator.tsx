/**
 * Course navigator for the slide editor sidebar.
 *
 * One popover covering the WHOLE subject: every module as a collapsible group
 * with its chapters underneath, each chapter expandable to its SLIDES for a
 * direct jump; search across all chapters; and (when the course has more than
 * one subject) a subject switcher row. Chapters/slides with local unsaved
 * drafts get an amber dot; module headers show a rollup count. Prev/next walks
 * chapters ACROSS module boundaries.
 *
 * The CURRENT subject's modules/chapters come from the store; picking another
 * subject browses it IN PLACE (fetch its tree, repaint the list) instead of
 * navigating away — see selectSubject. Slides are lazy-fetched per chapter on
 * first expand and cached in component state — a separate lightweight fetch,
 * NOT the ['slides', chapterId] react-query cache, whose entries flow through
 * use-slides' cleaning pipeline.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_SLIDES } from '@/constants/urls';
import { fetchModulesWithChapters } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import { getIcon } from './slides-sidebar/slides-sidebar-slides';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    useModulesWithChaptersStore,
    type ModulesWithChapters,
} from '@/stores/study-library/use-modules-with-chapters-store';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import {
    CaretDown,
    CaretLeft,
    CaretRight,
    Check,
    File,
    FolderSimple,
    MagnifyingGlass,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getDraftUserId, useSlideDrafts } from '../-hooks/use-slide-drafts';
import { useContentStore } from '../-stores/chapter-sidebar-store';

interface ChapterNavigatorProps {
    currentChapterId: string;
    currentModuleId: string;
    courseId: string;
    levelId: string;
    subjectId: string;
    sessionId: string;
}

/** Minimal slide row for the navigator tree (full Slide type not needed). */
interface NavSlide {
    id: string;
    title: string;
    sourceType: string;
    docType?: string;
}
type ChapterSlidesState = NavSlide[] | 'loading' | 'error';

/** Live modules → ordered chapters, dropping deleted rows and empty modules. */
const toModuleGroups = (data: ModulesWithChapters[] | null | undefined) =>
    (data ?? [])
        .filter((m) => m.module.status !== 'DELETED')
        .map((m) => ({
            module: m.module,
            chapters: m.chapters
                .filter((ch) => ch.chapter.status !== 'DELETED')
                .sort((a, b) => a.chapter.chapter_order - b.chapter.chapter_order),
        }))
        .filter((g) => g.chapters.length > 0);

export const ChapterNavigator = ({
    currentChapterId,
    currentModuleId,
    courseId,
    levelId,
    subjectId,
    sessionId,
}: ChapterNavigatorProps) => {
    const { t } = useTranslation('studyLibraryChapterNavigator');
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSubjectListOpen, setIsSubjectListOpen] = useState(false);
    const { modulesWithChaptersData } = useModulesWithChaptersStore();
    const { studyLibraryData, getPackageSessionId } = useStudyLibraryStore();

    // Subject whose tree is listed below. Starts as the one you're in; picking
    // another browses it without leaving the editor. Follows the URL again
    // whenever you actually land in a new subject.
    const [browsingSubjectId, setBrowsingSubjectId] = useState(subjectId);
    useEffect(() => {
        setBrowsingSubjectId(subjectId);
    }, [subjectId]);
    const isBrowsingOtherSubject = browsingSubjectId !== subjectId;

    // Local unsaved drafts of this course — amber dot per chapter/slide, rollup per module.
    const [draftUserId] = useState<string>(() => getDraftUserId());
    const { drafts: courseDrafts, dirtySlideIds } = useSlideDrafts(draftUserId, courseId);

    // Highlight the slide currently open in the editor.
    const router = useRouter();
    const currentSlideId: string = router.state.location.search.slideId || '';

    // ---- browsed subject's tree (fetched, never stored) -------------------
    // Deliberately component-local and under its own query key: the shared
    // ['GET_MODULES_WITH_CHAPTERS', …] entries are written into
    // useModulesWithChaptersStore by ModulesWithChaptersProvider, and that
    // store is what the editor you HAVEN'T left yet reads. Browsing must not
    // touch it.
    const packageSessionId = getPackageSessionId({ courseId, sessionId, levelId }) ?? '';
    const browsedTreeQuery = useQuery({
        queryKey: ['NAVIGATOR_SUBJECT_MODULES', browsingSubjectId, packageSessionId],
        queryFn: () => fetchModulesWithChapters(browsingSubjectId, packageSessionId),
        staleTime: 60 * 60 * 1000,
        enabled: isOpen && isBrowsingOtherSubject && !!browsingSubjectId && !!packageSessionId,
    });

    // ---- per-chapter slides (lazy) ---------------------------------------
    const [expandedChapterIds, setExpandedChapterIds] = useState<Set<string>>(
        () => new Set([currentChapterId])
    );
    const [slidesByChapter, setSlidesByChapter] = useState<Record<string, ChapterSlidesState>>({});

    const loadChapterSlides = (chapterId: string) => {
        setSlidesByChapter((prev) => {
            // Already loaded or in flight — nothing to do (retry only after error).
            if (prev[chapterId] && prev[chapterId] !== 'error') return prev;
            return { ...prev, [chapterId]: 'loading' };
        });
        authenticatedAxiosInstance
            .get(`${GET_SLIDES}?chapterId=${chapterId}`)
            .then((res) => {
                const slides: NavSlide[] = (Array.isArray(res.data) ? res.data : [])
                    .filter((s: { status?: string }) => s.status !== 'DELETED')
                    .map(
                        (s: {
                            id: string;
                            title?: string;
                            source_type?: string;
                            document_slide?: { title?: string; type?: string };
                            video_slide?: { title?: string };
                        }) => ({
                            id: s.id,
                            title:
                                s.document_slide?.title ||
                                s.video_slide?.title ||
                                s.title ||
                                t('untitledSlide'),
                            sourceType: s.source_type ?? '',
                            docType: s.document_slide?.type,
                        })
                    );
                setSlidesByChapter((prev) => ({ ...prev, [chapterId]: slides }));
            })
            .catch(() => {
                setSlidesByChapter((prev) => ({ ...prev, [chapterId]: 'error' }));
            });
    };

    const toggleChapterSlides = (chapterId: string) => {
        setExpandedChapterIds((prev) => {
            const next = new Set(prev);
            if (next.has(chapterId)) {
                next.delete(chapterId);
            } else {
                next.add(chapterId);
                loadChapterSlides(chapterId);
            }
            return next;
        });
    };

    // Keep the chapter you're in expanded (and its slides loaded) when the
    // popover opens — one fetch, cached for the popover's lifetime.
    useEffect(() => {
        if (!isOpen) return;
        setExpandedChapterIds((prev) => {
            if (prev.has(currentChapterId)) return prev;
            const next = new Set(prev);
            next.add(currentChapterId);
            return next;
        });
        loadChapterSlides(currentChapterId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, currentChapterId]);

    // ---- data shaping -----------------------------------------------------
    // The header (chapter name, N/M badge) and the prev/next arrows always
    // describe WHERE YOU ARE — browsing another subject's tree is just looking,
    // so they stay bound to the subject in the URL. Only the list below swaps.
    const homeGroups = useMemo(
        () => toModuleGroups(modulesWithChaptersData),
        [modulesWithChaptersData]
    );
    const browsedGroups = useMemo(
        () => toModuleGroups(browsedTreeQuery.data),
        [browsedTreeQuery.data]
    );
    const moduleGroups = isBrowsingOtherSubject ? browsedGroups : homeGroups;

    // Flat chapter list across ALL modules — prev/next walks module boundaries.
    const flatChapters = useMemo(
        () =>
            homeGroups.flatMap((g) =>
                g.chapters.map((ch) => ({ moduleId: g.module.id, entry: ch }))
            ),
        [homeGroups]
    );
    const currentFlatIndex = useMemo(
        () => flatChapters.findIndex((f) => f.entry.chapter.id === currentChapterId),
        [flatChapters, currentChapterId]
    );
    const currentChapter = currentFlatIndex >= 0 ? flatChapters[currentFlatIndex] : undefined;

    const dirtyCountByChapter = useMemo(() => {
        const counts = new Map<string, number>();
        for (const draft of courseDrafts) {
            const chapterKey = draft.context?.chapterId;
            if (chapterKey) counts.set(chapterKey, (counts.get(chapterKey) ?? 0) + 1);
        }
        return counts;
    }, [courseDrafts]);
    const dirtyCountByModule = useMemo(() => {
        const counts = new Map<string, number>();
        for (const draft of courseDrafts) {
            const moduleKey = draft.context?.moduleId;
            if (moduleKey) counts.set(moduleKey, (counts.get(moduleKey) ?? 0) + 1);
        }
        return counts;
    }, [courseDrafts]);

    // ---- expand / collapse ------------------------------------------------
    const [expandedModuleIds, setExpandedModuleIds] = useState<Set<string>>(
        () => new Set([currentModuleId])
    );
    useEffect(() => {
        // Keep the module you're in expanded when you land in a new one.
        setExpandedModuleIds((prev) => {
            if (prev.has(currentModuleId)) return prev;
            const next = new Set(prev);
            next.add(currentModuleId);
            return next;
        });
    }, [currentModuleId]);
    // A browsed subject has no "module you're in" to anchor on — open its
    // modules once when the tree arrives so its chapters are visible straight
    // away. Collapsing afterwards still works normally.
    useEffect(() => {
        if (!isBrowsingOtherSubject || browsedGroups.length === 0) return;
        setExpandedModuleIds((prev) => {
            const next = new Set(prev);
            browsedGroups.forEach((g) => next.add(g.module.id));
            return next;
        });
    }, [isBrowsingOtherSubject, browsedGroups]);
    const toggleModule = (moduleId: string) => {
        setExpandedModuleIds((prev) => {
            const next = new Set(prev);
            if (next.has(moduleId)) next.delete(moduleId);
            else next.add(moduleId);
            return next;
        });
    };

    // ---- search (whole subject) ------------------------------------------
    const query = searchQuery.trim().toLowerCase();
    const visibleGroups = useMemo(() => {
        if (!query) return moduleGroups;
        return moduleGroups
            .map((g) => ({
                ...g,
                chapters: g.chapters.filter((ch) =>
                    (ch.chapter.chapter_name ?? '').toLowerCase().includes(query)
                ),
            }))
            .filter((g) => g.chapters.length > 0);
    }, [moduleGroups, query]);

    // ---- subjects (row only when the course has more than one) -----------
    const subjects = useMemo(() => {
        const course = studyLibraryData?.find((c) => c.course.id === courseId);
        const session =
            course?.sessions.find((s) => s.session_dto.id === sessionId) ?? course?.sessions[0];
        const level =
            session?.level_with_details.find((l) => l.id === levelId) ??
            session?.level_with_details[0];
        return level?.subjects ?? [];
    }, [studyLibraryData, courseId, sessionId, levelId]);
    const showSubjectRow = subjects.length > 1;
    // The collapsed row names the subject listed BELOW it, not the one you're in.
    const browsingSubjectName = subjects.find((s) => s.id === browsingSubjectId)?.subject_name;

    // ---- navigation -------------------------------------------------------
    const closePopover = () => {
        setIsOpen(false);
        setSearchQuery('');
        setIsSubjectListOpen(false);
        // Snap back, so reopening always starts from the subject you're in.
        setBrowsingSubjectId(subjectId);
    };

    const navigateToChapter = (targetModuleId: string, chapterId: string) => {
        closePopover();
        navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: {
                courseId,
                levelId,
                // Committing to the browsed subject — this is the only place a
                // subject change reaches the URL.
                subjectId: browsingSubjectId,
                moduleId: targetModuleId,
                chapterId,
                slideId: '',
                sessionId,
            },
        });
    };

    // Direct jump to a specific slide, anywhere in the browsed subject.
    const navigateToSlide = (targetModuleId: string, chapterId: string, slideId: string) => {
        closePopover();
        navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: {
                courseId,
                levelId,
                subjectId: browsingSubjectId,
                moduleId: targetModuleId,
                chapterId,
                slideId,
                sessionId,
            },
        });
        // Same-chapter jump: the sidebar's URL→active sync early-returns while the
        // current slide still exists, so a slideId-only change won't switch. Set
        // the target active directly (cross-chapter resolves via the fresh list).
        const target = useContentStore.getState().items.find((s) => s.id === slideId);
        if (target) useContentStore.getState().setActiveItem(target);
    };

    // Picking a subject BROWSES it — fetch its tree and repaint the list below.
    // No navigation: nothing about where you are has changed until you click one
    // of its chapters or slides. (It used to route to that subject's module
    // listing, which threw you out of the editor.)
    const selectSubject = (targetSubjectId: string) => {
        setBrowsingSubjectId(targetSubjectId);
        setIsSubjectListOpen(false);
        setSearchQuery('');
    };

    const previous = currentFlatIndex > 0 ? flatChapters[currentFlatIndex - 1] : undefined;
    const next =
        currentFlatIndex >= 0 && currentFlatIndex < flatChapters.length - 1
            ? flatChapters[currentFlatIndex + 1]
            : undefined;

    const chapterTermPlural = getTerminologyPlural(ContentTerms.Chapter, SystemTerms.Chapter);
    const subjectTerm = getTerminology(ContentTerms.Subject, SystemTerms.Subject);

    // Slide count badge per chapter row (unchanged from previous behaviour).
    const getSlideCount = (entry: (typeof flatChapters)[number]['entry']) => {
        const counts = entry.slides_count;
        return counts.video_count + counts.pdf_count + counts.doc_count + counts.unknown_count;
    };

    // Guard on the subject you're IN — a browsed subject with no chapters must
    // not unmount the navigator you're standing in.
    if (homeGroups.length === 0) {
        return null;
    }

    return (
        <div className="flex w-full max-w-full items-center gap-1 overflow-hidden px-1">
            {/* Previous chapter (crosses module boundaries) */}
            <button
                onClick={() => previous && navigateToChapter(previous.moduleId, previous.entry.chapter.id)}
                disabled={!previous}
                className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md transition-all duration-200',
                    previous
                        ? 'bg-white/80 text-neutral-600 hover:bg-primary-100 hover:text-primary-600 active:scale-95'
                        : 'cursor-not-allowed bg-neutral-100/50 text-neutral-300'
                )}
                title={
                    previous
                        ? t('previousChapterTitle', { name: previous.entry.chapter.chapter_name })
                        : t('noPreviousChapter', {
                              term: getTerminology(
                                  ContentTerms.Chapter,
                                  SystemTerms.Chapter
                              ).toLowerCase(),
                          })
                }
            >
                <CaretLeft className="size-4" weight="bold" />
            </button>

            {/* Navigator popover */}
            <Popover
                open={isOpen}
                onOpenChange={(open) => {
                    setIsOpen(open);
                    if (!open) {
                        setSearchQuery('');
                        setIsSubjectListOpen(false);
                        setBrowsingSubjectId(subjectId);
                    }
                }}
            >
                <PopoverTrigger asChild>
                    <button
                        className={cn(
                            'group flex min-w-0 flex-1 items-center justify-between gap-1 rounded-lg px-2 py-1.5',
                            'bg-white/80 backdrop-blur-sm transition-all duration-200',
                            'border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50',
                            'text-xs font-medium text-neutral-700 hover:text-primary-700',
                            'overflow-hidden',
                            isOpen && 'border-primary-400 bg-primary-50 text-primary-700'
                        )}
                    >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                            <File className="size-3.5 shrink-0 text-primary-500" weight="duotone" />
                            <span className="truncate text-xs">
                                {currentChapter?.entry.chapter.chapter_name ||
                                    t('selectChapter', {
                                        term: getTerminology(
                                            ContentTerms.Chapter,
                                            SystemTerms.Chapter
                                        ),
                                    })}
                            </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded-full bg-neutral-100 px-1 py-0.5 text-2xs text-neutral-500 group-hover:bg-primary-100 group-hover:text-primary-600">
                                {currentFlatIndex >= 0 ? currentFlatIndex + 1 : '–'}/
                                {flatChapters.length}
                            </span>
                            <CaretDown
                                className={cn(
                                    'size-3 text-neutral-400 transition-transform duration-200',
                                    isOpen && 'rotate-180 text-primary-500'
                                )}
                                weight="bold"
                            />
                        </div>
                    </button>
                </PopoverTrigger>

                <PopoverContent className="w-80 p-0" align="center" side="bottom" sideOffset={8}>
                    <div className="flex flex-col">
                        {/* Search — spans every module of the subject */}
                        <div className="border-b border-neutral-100 p-2">
                            <div className="relative">
                                <MagnifyingGlass className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                                <Input
                                    placeholder={t('searchAllPlaceholder', {
                                        term: chapterTermPlural.toLowerCase(),
                                    })}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="h-8 pl-8 text-sm"
                                    autoFocus
                                />
                            </div>
                        </div>

                        {/* Subject switcher — only when the course has >1 subject */}
                        {showSubjectRow && (
                            <div className="border-b border-neutral-100 bg-neutral-50/50">
                                <button
                                    onClick={() => setIsSubjectListOpen((v) => !v)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                                >
                                    <span className="text-xs text-neutral-400">{subjectTerm}</span>
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary-600">
                                        {browsingSubjectName || '—'}
                                    </span>
                                    <CaretDown
                                        className={cn(
                                            'size-3 shrink-0 text-neutral-400 transition-transform duration-200',
                                            isSubjectListOpen && 'rotate-180'
                                        )}
                                        weight="bold"
                                    />
                                </button>
                                {isSubjectListOpen && (
                                    <div className="flex flex-col gap-0.5 px-2 pb-2">
                                        {/* Highlight = the tree shown below.
                                            Check = the subject your open slide
                                            belongs to, so you can find your way
                                            back after browsing. */}
                                        {subjects.map((subject) => (
                                            <button
                                                key={subject.id}
                                                onClick={() => selectSubject(subject.id)}
                                                className={cn(
                                                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                                    subject.id === browsingSubjectId
                                                        ? 'bg-primary-100 font-semibold text-primary-700'
                                                        : 'text-neutral-600 hover:bg-neutral-100'
                                                )}
                                            >
                                                <span className="min-w-0 flex-1 truncate">
                                                    {subject.subject_name}
                                                </span>
                                                {subject.id === subjectId && (
                                                    <Check
                                                        className="size-3.5 shrink-0 text-primary-500"
                                                        weight="bold"
                                                    />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Module groups with chapters. Plain overflow container —
                            NOT Radix ScrollArea, whose 100%-height viewport never
                            becomes scrollable under a max-height root (the old
                            "popover doesn't scroll, page behind does" bug). */}
                        <div className="max-h-72 overflow-y-auto overscroll-contain p-1">
                            {isBrowsingOtherSubject && browsedTreeQuery.isLoading ? (
                                <div className="px-3 py-6 text-center text-sm text-neutral-400">
                                    {t('loading')}
                                </div>
                            ) : isBrowsingOtherSubject &&
                              (browsedTreeQuery.isError || !packageSessionId) ? (
                                <div className="flex flex-col items-center gap-1 px-3 py-6">
                                    <p className="text-sm text-neutral-400">
                                        {t('couldNotLoadSubject', {
                                            term: subjectTerm.toLowerCase(),
                                        })}
                                    </p>
                                    {/* Retry only helps a failed request — a missing
                                        packageSessionId won't resolve on a refetch. */}
                                    {browsedTreeQuery.isError && (
                                        <button
                                            onClick={() => browsedTreeQuery.refetch()}
                                            className="text-xs font-medium text-primary-600 hover:underline"
                                        >
                                            {t('retry')}
                                        </button>
                                    )}
                                </div>
                            ) : visibleGroups.length === 0 ? (
                                <div className="px-3 py-6 text-center text-sm text-neutral-400">
                                    {t('noChaptersFound', { term: chapterTermPlural.toLowerCase() })}
                                </div>
                            ) : (
                                visibleGroups.map((group) => {
                                    // While searching, every matching group is open.
                                    const isExpanded =
                                        !!query || expandedModuleIds.has(group.module.id);
                                    const moduleDirtyCount =
                                        dirtyCountByModule.get(group.module.id) ?? 0;
                                    return (
                                        <div key={group.module.id}>
                                            <button
                                                onClick={() => toggleModule(group.module.id)}
                                                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-neutral-100"
                                            >
                                                <CaretDown
                                                    className={cn(
                                                        'size-3 shrink-0 text-neutral-400 transition-transform duration-200',
                                                        !isExpanded && '-rotate-90'
                                                    )}
                                                    weight="bold"
                                                />
                                                <FolderSimple
                                                    className={cn(
                                                        'size-4 shrink-0',
                                                        group.module.id === currentModuleId
                                                            ? 'text-primary-500'
                                                            : 'text-neutral-400'
                                                    )}
                                                    weight="duotone"
                                                />
                                                <span
                                                    className={cn(
                                                        'min-w-0 flex-1 truncate text-xs font-semibold',
                                                        group.module.id === currentModuleId
                                                            ? 'text-primary-700'
                                                            : 'text-neutral-600'
                                                    )}
                                                >
                                                    {group.module.module_name}
                                                </span>
                                                {moduleDirtyCount > 0 && (
                                                    <span className="shrink-0 rounded-full border border-warning-300 bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-600">
                                                        {t('unsavedCount', { count: moduleDirtyCount })}
                                                    </span>
                                                )}
                                                <span className="shrink-0 text-2xs text-neutral-400">
                                                    {group.chapters.length}
                                                </span>
                                            </button>

                                            {isExpanded && (
                                                <div className="flex flex-col pb-1 pl-4">
                                                    {group.chapters.map((entry, index) => {
                                                        const isActive =
                                                            entry.chapter.id === currentChapterId;
                                                        const chapterDirtyCount =
                                                            dirtyCountByChapter.get(
                                                                entry.chapter.id
                                                            ) ?? 0;
                                                        const slideCount = getSlideCount(entry);
                                                        // Slides sub-list collapses while searching
                                                        // (search is chapter-level).
                                                        const isChapterExpanded =
                                                            !query &&
                                                            expandedChapterIds.has(entry.chapter.id);
                                                        const chapterSlides =
                                                            slidesByChapter[entry.chapter.id];
                                                        return (
                                                            <div key={entry.chapter.id}>
                                                                <div
                                                                    className={cn(
                                                                        'flex w-full items-center rounded-md transition-all duration-150',
                                                                        isActive
                                                                            ? 'bg-primary-100'
                                                                            : 'hover:bg-neutral-100'
                                                                    )}
                                                                >
                                                                    {/* Expand slides — separate hit
                                                                        target so the name still
                                                                        navigates to the chapter */}
                                                                    <button
                                                                        onClick={() =>
                                                                            toggleChapterSlides(
                                                                                entry.chapter.id
                                                                            )
                                                                        }
                                                                        title={t('showSlidesTitle', {
                                                                            term: getTerminologyPlural(
                                                                                ContentTerms.Slide,
                                                                                SystemTerms.Slide
                                                                            ).toLowerCase(),
                                                                        })}
                                                                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:text-primary-600"
                                                                    >
                                                                        <CaretDown
                                                                            className={cn(
                                                                                'size-3 transition-transform duration-200',
                                                                                !isChapterExpanded &&
                                                                                    '-rotate-90'
                                                                            )}
                                                                            weight="bold"
                                                                        />
                                                                    </button>
                                                                    <button
                                                                        onClick={() =>
                                                                            navigateToChapter(
                                                                                group.module.id,
                                                                                entry.chapter.id
                                                                            )
                                                                        }
                                                                        className={cn(
                                                                            'flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left',
                                                                            isActive
                                                                                ? 'text-primary-700'
                                                                                : 'text-neutral-600'
                                                                        )}
                                                                    >
                                                                        <div
                                                                            className={cn(
                                                                                'flex size-6 shrink-0 items-center justify-center rounded text-xs font-semibold',
                                                                                isActive
                                                                                    ? 'bg-primary-500 text-white'
                                                                                    : 'bg-neutral-200 text-neutral-500'
                                                                            )}
                                                                        >
                                                                            {index + 1}
                                                                        </div>
                                                                        <div className="min-w-0 flex-1">
                                                                            <p
                                                                                className={cn(
                                                                                    'truncate text-sm font-medium',
                                                                                    isActive
                                                                                        ? 'text-primary-700'
                                                                                        : 'text-neutral-700'
                                                                                )}
                                                                            >
                                                                                {
                                                                                    entry.chapter
                                                                                        .chapter_name
                                                                                }
                                                                            </p>
                                                                            <p className="text-xs text-neutral-400">
                                                                                {slideCount}{' '}
                                                                                {slideCount === 1
                                                                                    ? getTerminology(
                                                                                          ContentTerms.Slide,
                                                                                          SystemTerms.Slide
                                                                                      ).toLowerCase()
                                                                                    : getTerminologyPlural(
                                                                                          ContentTerms.Slide,
                                                                                          SystemTerms.Slide
                                                                                      ).toLowerCase()}
                                                                                {chapterDirtyCount >
                                                                                    0 &&
                                                                                    ` · ${t('unsavedCount', { count: chapterDirtyCount })}`}
                                                                            </p>
                                                                        </div>
                                                                        {chapterDirtyCount > 0 && (
                                                                            <span
                                                                                className="size-2 shrink-0 rounded-full bg-warning-500 ring-2 ring-warning-100"
                                                                                title={t('unsavedChangesTitle')}
                                                                            />
                                                                        )}
                                                                        {isActive && (
                                                                            <Check
                                                                                className="size-4 shrink-0 text-primary-500"
                                                                                weight="bold"
                                                                            />
                                                                        )}
                                                                    </button>
                                                                </div>

                                                                {/* Slides of this chapter — direct jump */}
                                                                {isChapterExpanded && (
                                                                    <div className="flex flex-col pb-1 pl-9">
                                                                        {chapterSlides ===
                                                                            'loading' && (
                                                                            <p className="px-2 py-1.5 text-xs text-neutral-400">
                                                                                {t('loading')}
                                                                            </p>
                                                                        )}
                                                                        {chapterSlides ===
                                                                            'error' && (
                                                                            <button
                                                                                onClick={() =>
                                                                                    loadChapterSlides(
                                                                                        entry.chapter
                                                                                            .id
                                                                                    )
                                                                                }
                                                                                className="px-2 py-1.5 text-left text-xs text-danger-600 hover:underline"
                                                                            >
                                                                                {t('couldNotLoadRetry')}
                                                                            </button>
                                                                        )}
                                                                        {Array.isArray(
                                                                            chapterSlides
                                                                        ) &&
                                                                            chapterSlides.length ===
                                                                                0 && (
                                                                                <p className="px-2 py-1.5 text-xs text-neutral-400">
                                                                                    {t('noSlidesYet', {
                                                                                        term: getTerminologyPlural(
                                                                                            ContentTerms.Slide,
                                                                                            SystemTerms.Slide
                                                                                        ).toLowerCase(),
                                                                                    })}
                                                                                </p>
                                                                            )}
                                                                        {Array.isArray(
                                                                            chapterSlides
                                                                        ) &&
                                                                            chapterSlides.map(
                                                                                (slide) => {
                                                                                    const isSlideActive =
                                                                                        slide.id ===
                                                                                        currentSlideId;
                                                                                    return (
                                                                                        <button
                                                                                            key={
                                                                                                slide.id
                                                                                            }
                                                                                            onClick={() =>
                                                                                                navigateToSlide(
                                                                                                    group
                                                                                                        .module
                                                                                                        .id,
                                                                                                    entry
                                                                                                        .chapter
                                                                                                        .id,
                                                                                                    slide.id
                                                                                                )
                                                                                            }
                                                                                            className={cn(
                                                                                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                                                                                                isSlideActive
                                                                                                    ? 'bg-primary-50 text-primary-700'
                                                                                                    : 'text-neutral-600 hover:bg-neutral-100'
                                                                                            )}
                                                                                        >
                                                                                            <span className="shrink-0">
                                                                                                {getIcon(
                                                                                                    slide.sourceType,
                                                                                                    slide.docType,
                                                                                                    '4'
                                                                                                )}
                                                                                            </span>
                                                                                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                                                                                {
                                                                                                    slide.title
                                                                                                }
                                                                                            </span>
                                                                                            {dirtySlideIds.has(
                                                                                                slide.id
                                                                                            ) && (
                                                                                                <span
                                                                                                    className="size-1.5 shrink-0 rounded-full bg-warning-500 ring-2 ring-warning-100"
                                                                                                    title={t('unsavedChangesTitle')}
                                                                                                />
                                                                                            )}
                                                                                            {isSlideActive && (
                                                                                                <Check
                                                                                                    className="size-3.5 shrink-0 text-primary-500"
                                                                                                    weight="bold"
                                                                                                />
                                                                                            )}
                                                                                        </button>
                                                                                    );
                                                                                }
                                                                            )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {/* Next chapter (crosses module boundaries) */}
            <button
                onClick={() => next && navigateToChapter(next.moduleId, next.entry.chapter.id)}
                disabled={!next}
                className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md transition-all duration-200',
                    next
                        ? 'bg-white/80 text-neutral-600 hover:bg-primary-100 hover:text-primary-600 active:scale-95'
                        : 'cursor-not-allowed bg-neutral-100/50 text-neutral-300'
                )}
                title={
                    next
                        ? t('nextChapterTitle', { name: next.entry.chapter.chapter_name })
                        : t('noNextChapter', {
                              term: getTerminology(
                                  ContentTerms.Chapter,
                                  SystemTerms.Chapter
                              ).toLowerCase(),
                          })
                }
            >
                <CaretRight className="size-4" weight="bold" />
            </button>
        </div>
    );
};
