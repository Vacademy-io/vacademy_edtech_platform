import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    ArrowLeft,
    BookOpenText,
    CaretRight,
    Check,
    ClipboardText,
    Code,
    File,
    FilePdf,
    FileText,
    GraduationCap,
    Headphones,
    ListChecks,
    Package,
    PresentationChart,
    Question,
    VideoCamera,
    WarningCircle,
    type Icon,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
    useStudyLibraryStore,
    type SubjectType,
} from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { handleFetchModulesWithChapters } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import { handleFetchSlides } from '@/routes/study-library/courses/-services/getAllSlides';

/** What the composer stores (as the task's payloadJson) when a slide is chosen. */
export interface PickedSlide {
    slideId: string;
    slideTitle: string;
    slideType?: string;
    /** Everything the learner app needs to deep-link into the slide. */
    courseId?: string;
    sessionId?: string;
    levelId?: string;
    subjectId: string;
    moduleId: string;
    chapterId: string;
    /** Display only: the path the teacher saw, so the task can show where the lesson lives. */
    subjectName?: string;
    moduleName?: string;
    chapterName?: string;
}

/**
 * One chapter row of the modules-with-chapters response. The API nests it as
 * `{ chapter: {...}, slides_count }`; older shapes carried `chapter_dto` or the fields
 * inline, so all three are read.
 */
export interface ChapterLike {
    id?: string;
    chapter_name?: string;
    status?: string;
    chapter?: { id: string; chapter_name?: string; status?: string };
    chapter_dto?: { id: string; chapter_name?: string; status?: string };
}

interface ModuleLike {
    module: { id: string; module_name?: string };
    chapters: ChapterLike[];
}

interface SlideLike {
    id: string;
    title?: string;
    source_type?: string;
    status?: string;
    document_slide?: { type?: string } | null;
}

/**
 * Statuses a learner can open. UNSYNC is a published slide with unpublished edits: the
 * learner still sees its published version (the slide service counts it as published).
 */
const LEARNER_VISIBLE = new Set(['PUBLISHED', 'UNSYNC']);

export function isLearnerVisibleSlide(slide: Pick<SlideLike, 'status'>): boolean {
    return LEARNER_VISIBLE.has((slide.status ?? '').toUpperCase());
}

type SlideKind =
    | 'VIDEO'
    | 'PDF'
    | 'DOCUMENT'
    | 'PRESENTATION'
    | 'CODE'
    | 'QUESTION'
    | 'ASSIGNMENT'
    | 'QUIZ'
    | 'AUDIO'
    | 'SCORM'
    | 'LESSON';

export function slideKind(slide: Pick<SlideLike, 'source_type' | 'document_slide'>): SlideKind {
    const source = (slide.source_type ?? '').toUpperCase();
    const doc = (slide.document_slide?.type ?? '').toUpperCase();
    switch (source) {
        case 'VIDEO':
        case 'HTML_VIDEO':
            return 'VIDEO';
        case 'QUESTION':
            return 'QUESTION';
        case 'ASSIGNMENT':
            return 'ASSIGNMENT';
        case 'QUIZ':
        case 'ASSESSMENT':
            return 'QUIZ';
        case 'AUDIO':
            return 'AUDIO';
        case 'SCORM':
            return 'SCORM';
        case 'DOCUMENT':
            if (doc === 'PDF') return 'PDF';
            if (doc === 'PRESENTATION' || doc === 'PPT_ANIM') return 'PRESENTATION';
            if (doc === 'CODE' || doc === 'JUPYTER' || doc === 'SCRATCH') return 'CODE';
            return 'DOCUMENT';
        default:
            return 'LESSON';
    }
}

const KIND_ICON: Record<SlideKind, Icon> = {
    VIDEO: VideoCamera,
    PDF: FilePdf,
    DOCUMENT: FileText,
    PRESENTATION: PresentationChart,
    CODE: Code,
    QUESTION: Question,
    ASSIGNMENT: ClipboardText,
    QUIZ: ListChecks,
    AUDIO: Headphones,
    SCORM: Package,
    LESSON: File,
};

export function chapterIdOf(chapter: ChapterLike): string {
    return chapter.chapter?.id ?? chapter.chapter_dto?.id ?? chapter.id ?? '';
}

export function chapterNameOf(chapter: ChapterLike | undefined): string | undefined {
    if (!chapter) return undefined;
    return (
        chapter.chapter?.chapter_name ??
        chapter.chapter_dto?.chapter_name ??
        chapter.chapter_name ??
        undefined
    );
}

/** A chapter that can be opened: it has an id and isn't deleted. */
export function isListedChapter(chapter: ChapterLike): boolean {
    const status = (
        chapter.chapter?.status ??
        chapter.chapter_dto?.status ??
        chapter.status ??
        ''
    ).toUpperCase();
    return Boolean(chapterIdOf(chapter)) && status !== 'DELETED';
}

function SkeletonRows({ rows = 5 }: { rows?: number }) {
    return (
        <div className="flex flex-col gap-2 p-2" aria-hidden>
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-8 shrink-0 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3.5 w-3/5" />
                        <Skeleton className="h-3 w-1/4" />
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Pick a lesson from the batch's own course for a Course content task.
 *
 * Subject (skipped when the course has one), then a searchable list of chapters
 * grouped by module, then a searchable list of that chapter's lessons with type icons.
 * Only lessons learners can open are offered (published, or published with pending
 * edits); drafts are counted but hidden. Opening it for a task that already has a
 * lesson lands on that lesson's chapter with it selected.
 */
export function CourseSlidePicker({
    open,
    onOpenChange,
    packageSessionId,
    onPick,
    currentSlide,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    packageSessionId: string;
    onPick: (slide: PickedSlide) => void;
    /** The task's current lesson: its chapter opens with it selected. */
    currentSlide?: Partial<PickedSlide> | null;
}) {
    const { t } = useTranslation('engagement');
    const [subjectId, setSubjectId] = useState('');
    const [moduleId, setModuleId] = useState('');
    const [chapterId, setChapterId] = useState('');
    const [slideId, setSlideId] = useState('');
    const subjectLabelId = useId();

    const { studyLibraryData } = useStudyLibraryStore();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const studyLibraryQuery = useStudyLibraryQuery();
    const libraryQuery = useQuery({ ...studyLibraryQuery, enabled: open });

    // The batch's course, session and level. A batch missing from the institute's list
    // (archived, or another admin view) falls back to the path saved with the lesson.
    const savedCourseId = currentSlide?.courseId;
    const savedSessionId = currentSlide?.sessionId;
    const savedLevelId = currentSlide?.levelId;
    const context = useMemo(() => {
        const details = getDetailsFromPackageSessionId({ packageSessionId });
        if (!details) {
            return {
                courseId: savedCourseId,
                courseName: undefined,
                sessionId: savedSessionId,
                levelId: savedLevelId,
            };
        }
        return {
            courseId: details.package_dto?.id,
            courseName: details.package_dto?.package_name,
            sessionId: details.session?.id,
            levelId: details.level?.id,
        };
    }, [
        packageSessionId,
        getDetailsFromPackageSessionId,
        savedCourseId,
        savedSessionId,
        savedLevelId,
    ]);

    const subjects: SubjectType[] = useMemo(() => {
        const course = studyLibraryData?.find((c) => c.course.id === context.courseId);
        const session = course?.sessions.find((s) => s.session_dto.id === context.sessionId);
        const level = session?.level_with_details.find((l) => l.id === context.levelId);
        return level?.subjects ?? [];
    }, [studyLibraryData, context]);

    // Each open starts from the task's current lesson, or from the top.
    useEffect(() => {
        if (!open) return;
        const sameCourse = !currentSlide?.courseId || currentSlide.courseId === context.courseId;
        const seed = currentSlide && sameCourse ? currentSlide : null;
        setSubjectId(seed?.subjectId ?? '');
        setModuleId(seed?.moduleId ?? '');
        setChapterId(seed?.chapterId ?? '');
        setSlideId(seed?.slideId ?? '');
        // Only on open: the seed must not overwrite the teacher's browsing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // One subject: nothing to choose.
    useEffect(() => {
        if (open && !subjectId && subjects.length === 1 && subjects[0]) {
            setSubjectId(subjects[0].id);
        }
    }, [open, subjectId, subjects]);

    const modulesQuery = useQuery({
        ...handleFetchModulesWithChapters(subjectId, packageSessionId),
        enabled: open && Boolean(subjectId),
    });
    const modules: ModuleLike[] = useMemo(
        () =>
            ((modulesQuery.data as ModuleLike[] | undefined) ?? []).map((m) => ({
                ...m,
                chapters: (m.chapters ?? []).filter(isListedChapter),
            })),
        [modulesQuery.data]
    );

    const slidesQuery = useQuery({
        ...handleFetchSlides(chapterId),
        enabled: open && Boolean(chapterId),
    });
    const allSlides: SlideLike[] = useMemo(
        () => (slidesQuery.data as SlideLike[] | undefined) ?? [],
        [slidesQuery.data]
    );
    const slides = useMemo(() => allSlides.filter(isLearnerVisibleSlide), [allSlides]);
    const hiddenCount = allSlides.filter(
        (s) => (s.status ?? '').toUpperCase() !== 'DELETED' && !isLearnerVisibleSlide(s)
    ).length;

    const subjectName = subjects.find((s) => s.id === subjectId)?.subject_name;
    const chosenModule = modules.find((m) => m.module.id === moduleId);
    const chosenChapter = chosenModule?.chapters.find((c) => chapterIdOf(c) === chapterId);
    const moduleName = chosenModule?.module.module_name;
    const chapterName = chapterNameOf(chosenChapter);
    const chosen = slides.find((s) => s.id === slideId);

    // The course tree may already be in the store from another page, so a failed
    // library refresh only matters when there is nothing to pick from.
    const libraryFailed = libraryQuery.isError && subjects.length === 0;
    const libraryLoading =
        subjects.length === 0 && (libraryQuery.isLoading || libraryQuery.isFetching);
    const loadFailed = libraryFailed || modulesQuery.isError || slidesQuery.isError;

    function retryFailed() {
        if (libraryFailed) void libraryQuery.refetch();
        if (modulesQuery.isError) void modulesQuery.refetch();
        if (slidesQuery.isError) void slidesQuery.refetch();
    }

    function pickChapter(nextModuleId: string, nextChapterId: string) {
        setModuleId(nextModuleId);
        setChapterId(nextChapterId);
        setSlideId('');
    }

    function backToChapters() {
        setChapterId('');
        setModuleId('');
        setSlideId('');
    }

    function confirm() {
        if (!chosen) return;
        onPick({
            slideId: chosen.id,
            slideTitle: chosen.title?.trim() || t('slidePicker.slide'),
            slideType: chosen.source_type,
            courseId: context.courseId,
            sessionId: context.sessionId,
            levelId: context.levelId,
            subjectId,
            moduleId,
            chapterId,
            subjectName,
            moduleName,
            chapterName,
        });
        onOpenChange(false);
    }

    const path = [subjectName, moduleName, chapterName].filter(Boolean).join(' › ');
    const view: 'chapters' | 'slides' = chapterId ? 'slides' : 'chapters';

    let body: ReactNode;
    if (!subjectId) {
        body = libraryLoading ? (
            <SkeletonRows rows={4} />
        ) : subjects.length === 0 && !libraryFailed ? (
            <EmptyState text={t('slidePicker.noSubjects')} />
        ) : (
            <EmptyState text={t('slidePicker.pickSubjectFirst')} />
        );
    } else if (view === 'chapters') {
        const hasChapters = modules.some((m) => m.chapters.length > 0);
        body = modulesQuery.isLoading ? (
            <SkeletonRows />
        ) : modulesQuery.isSuccess && !hasChapters ? (
            <EmptyState text={t('slidePicker.noModules')} />
        ) : (
            <Command className="rounded-lg border border-neutral-200">
                <CommandInput placeholder={t('slidePicker.searchChapters')} />
                <CommandList className="max-h-80">
                    <CommandEmpty>{t('slidePicker.noMatches')}</CommandEmpty>
                    {modules
                        .filter((m) => m.chapters.length > 0)
                        .map((m) => (
                            <CommandGroup
                                key={m.module.id}
                                heading={m.module.module_name ?? t('slidePicker.module')}
                            >
                                {m.chapters.map((chapter) => {
                                    const id = chapterIdOf(chapter);
                                    const label =
                                        chapterNameOf(chapter) ?? t('slidePicker.chapter');
                                    const isCurrent =
                                        Boolean(currentSlide?.chapterId) &&
                                        currentSlide?.chapterId === id;
                                    return (
                                        <CommandItem
                                            key={id}
                                            value={`${id} ${label}`}
                                            keywords={[label, m.module.module_name ?? '']}
                                            onSelect={() => pickChapter(m.module.id, id)}
                                            className="gap-3 py-2"
                                        >
                                            <BookOpenText
                                                className="text-neutral-500"
                                                aria-hidden
                                            />
                                            <span className="min-w-0 flex-1 truncate text-body text-neutral-800">
                                                {label}
                                            </span>
                                            {isCurrent && (
                                                <span className="text-caption text-primary-500">
                                                    {t('slidePicker.current')}
                                                </span>
                                            )}
                                            <CaretRight className="text-neutral-400" aria-hidden />
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        ))}
                </CommandList>
            </Command>
        );
    } else {
        body = (
            <div className="flex flex-col gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={backToChapters}
                        className="shrink-0 px-1"
                    >
                        <ArrowLeft size={14} aria-hidden className="rtl:rotate-180" />{' '}
                        {t('slidePicker.allChapters')}
                    </MyButton>
                    {chapterName && (
                        <span className="min-w-0 truncate text-caption text-neutral-500">
                            {[moduleName, chapterName].filter(Boolean).join(' › ')}
                        </span>
                    )}
                </div>
                {slidesQuery.isLoading ? (
                    <SkeletonRows />
                ) : slidesQuery.isSuccess && slides.length === 0 ? (
                    <EmptyState
                        text={
                            hiddenCount > 0
                                ? t('slidePicker.onlyDrafts', { count: hiddenCount })
                                : t('slidePicker.noSlides')
                        }
                    />
                ) : (
                    <Command className="rounded-lg border border-neutral-200">
                        <CommandInput placeholder={t('slidePicker.searchLessons')} />
                        <CommandList className="max-h-80" aria-label={t('slidePicker.slide')}>
                            <CommandEmpty>{t('slidePicker.noMatches')}</CommandEmpty>
                            <CommandGroup>
                                {slides.map((slide) => {
                                    const kind = slideKind(slide);
                                    const KindIcon = KIND_ICON[kind];
                                    const isChosen = slide.id === slideId;
                                    const title = slide.title?.trim() || t('slidePicker.slide');
                                    return (
                                        <CommandItem
                                            key={slide.id}
                                            value={`${slide.id} ${title}`}
                                            keywords={[title]}
                                            onSelect={() => setSlideId(slide.id)}
                                            aria-checked={isChosen}
                                            className={cn(
                                                'gap-3 py-2',
                                                isChosen &&
                                                    'bg-primary-50 data-[selected=true]:bg-primary-50'
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'flex size-8 shrink-0 items-center justify-center rounded-md',
                                                    isChosen
                                                        ? 'bg-primary-100 text-primary-600'
                                                        : 'bg-neutral-100 text-neutral-600'
                                                )}
                                            >
                                                <KindIcon aria-hidden />
                                            </span>
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className="line-clamp-2 break-words text-body text-neutral-900">
                                                    {title}
                                                </span>
                                                <span className="text-caption text-neutral-500">
                                                    {t(`slidePicker.kinds.${kind}`)}
                                                </span>
                                            </span>
                                            {isChosen && (
                                                <Check
                                                    weight="bold"
                                                    className="text-primary-500"
                                                    aria-hidden
                                                />
                                            )}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                )}
                {slides.length > 0 && hiddenCount > 0 && (
                    <p className="text-caption text-neutral-500">
                        {t('slidePicker.draftsHidden', { count: hiddenCount })}
                    </p>
                )}
            </div>
        );
    }

    return (
        <MyDialog
            heading={t('slidePicker.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footerLeft={
                chosen ? (
                    <p className="flex min-w-0 items-center gap-2 text-caption text-neutral-600">
                        <GraduationCap
                            size={16}
                            className="shrink-0 text-primary-500"
                            aria-hidden
                        />
                        <span className="truncate">{chosen.title?.trim() || path}</span>
                    </p>
                ) : undefined
            }
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('slidePicker.cancel')}
                    </MyButton>
                    <MyButton type="button" disable={!chosen} onClick={confirm}>
                        {t('slidePicker.use')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="flex items-start gap-2 text-caption text-neutral-600">
                    <GraduationCap
                        size={16}
                        className="mt-0.5 shrink-0 text-primary-500"
                        aria-hidden
                    />
                    <span>
                        {context.courseName
                            ? t('slidePicker.hintCourse', { course: context.courseName })
                            : t('slidePicker.hint')}
                    </span>
                </p>

                {/* Before the empty states: a failed load must not read as "no subjects". */}
                {loadFailed && (
                    <Alert className="border-danger-200 bg-danger-50 text-danger-700">
                        <div className="flex flex-wrap items-center gap-3">
                            <WarningCircle size={18} className="shrink-0" aria-hidden />
                            <AlertDescription className="min-w-0 flex-1">
                                {t('slidePicker.loadError')}
                            </AlertDescription>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={retryFailed}
                            >
                                <ArrowClockwise size={14} aria-hidden /> {t('common.retry')}
                            </MyButton>
                        </div>
                    </Alert>
                )}

                {subjects.length > 1 && (
                    <div className="flex flex-col gap-1.5">
                        <span
                            id={subjectLabelId}
                            className="text-body font-medium text-neutral-700"
                        >
                            {t('slidePicker.subject')}
                        </span>
                        <Select
                            value={subjectId}
                            onValueChange={(v) => {
                                setSubjectId(v);
                                backToChapters();
                            }}
                        >
                            <SelectTrigger aria-labelledby={subjectLabelId}>
                                <SelectValue placeholder={t('slidePicker.selectSubject')} />
                            </SelectTrigger>
                            <SelectContent>
                                {subjects.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                        {s.subject_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {body}
            </div>
        </MyDialog>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center">
            <GraduationCap size={28} className="text-neutral-400" aria-hidden />
            <p className="max-w-xs text-body text-neutral-600">{text}</p>
        </div>
    );
}
