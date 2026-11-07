/**
 * Stepwise lesson picker: Course → Batch → Subject → Module → Chapter → Lesson.
 *
 * Every step is a hash route on #/lessons (query params courseId, psId,
 * subjectId, moduleId, chapterId; `direct=1` for course_depth 2, where slides
 * hang off the batch), so the Android back button walks the steps. A step with
 * exactly one choice (the usual "DEFAULT" subject/module of shallow courses, or
 * a course with one batch) is skipped with a history REPLACE, so Back never
 * lands on a step that would bounce forward again. The crumbs above the list
 * re-open a step with `noskip=1` so the teacher can still change it.
 *
 * Every step has loading, empty and error states.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Books,
    BookOpenText,
    Folder,
    GraduationCap,
    Stack,
    UsersThree,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Badge } from '@/components/ui/badge';
import { PanelTopBar } from '../components/PanelTopBar';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelEmpty, PanelError, PanelLoading } from '../components/PanelScreenState';
import { usePanelSession } from '../lib/session';
import { goBack, navigate } from '../router';
import {
    batchLabel,
    batchSubjects,
    courseBatches,
    courseName,
    displayName,
    useModulesWithChapters,
    useSlides,
    useStudyLibrary,
    type ModulesWithChapters,
} from './lessonApi';
import { LessonCard, LessonGrid } from './LessonParts';
import { SLIDE_TYPE_ICONS } from './slideIcons';
import { isDraftSlide, resolveSlideSource } from './slideSource';
import {
    isListed,
    lessonPathFrom,
    levelOf,
    slideScopeOf,
    toParams,
    type LessonPath,
    type PickerLevel,
} from './lessonPath';

function goTo(path: LessonPath, opts?: { replace?: boolean; noskip?: boolean }) {
    navigate('lessons', toParams(path, opts?.noskip ? { noskip: '1' } : undefined), {
        replace: opts?.replace,
    });
}

function sumCounts(counts: object | null | undefined): number {
    if (!counts) return 0;
    return Object.values(counts as Record<string, unknown>).reduce<number>(
        (total, value) => total + (typeof value === 'number' ? value : 0),
        0
    );
}

function useModuleList(modules: ModulesWithChapters[] | undefined) {
    return useMemo(
        () => (modules || []).filter((item) => isListed(item.module?.status)),
        [modules]
    );
}

interface Crumb {
    level: PickerLevel;
    name: string;
    path: LessonPath;
}

export function LessonPicker({ params }: { params: Record<string, string> }) {
    const { t } = useTranslation('content');
    const { instituteId } = usePanelSession();
    const path = lessonPathFrom(params);
    const noskip = params.noskip === '1';
    const level = levelOf(path);
    const [search, setSearch] = useState('');

    const library = useStudyLibrary(instituteId);
    const courses = useMemo(
        () => (library.data || []).filter((item) => isListed(item.course?.status)),
        [library.data]
    );
    const course = path.courseId
        ? courses.find((item) => item.course.id === path.courseId)
        : undefined;
    const batches = useMemo(() => (course ? courseBatches(course) : []), [course]);
    const batch = path.psId ? batches.find((item) => item.id === path.psId) : undefined;
    const subjects = useMemo(
        () => (course && batch ? batchSubjects(course, batch) : []),
        [course, batch]
    );
    const subject = path.subjectId
        ? subjects.find((item) => item.id === path.subjectId)
        : undefined;
    const depth = course?.course.course_depth ?? 5;

    const modulesQuery = useModulesWithChapters(
        path.direct ? undefined : path.subjectId,
        path.direct ? undefined : path.psId
    );
    const modules = useModuleList(modulesQuery.data);
    const moduleEntry = path.moduleId
        ? modules.find((item) => item.module.id === path.moduleId)
        : undefined;
    const chapters = useMemo(
        () =>
            (moduleEntry?.chapters || [])
                .filter((item) => isListed(item.chapter?.status))
                .sort((a, b) => (a.chapter.chapter_order ?? 0) - (b.chapter.chapter_order ?? 0)),
        [moduleEntry]
    );
    const chapterEntry = path.chapterId
        ? chapters.find((item) => item.chapter.id === path.chapterId)
        : undefined;

    const slidesQuery = useSlides(level === 'slide' ? slideScopeOf(path) : null);

    // ---- single-choice auto-skip (history replace) --------------------------
    let skipTo: LessonPath | null = null;
    if (!noskip) {
        if (level === 'batch' && batches.length === 1 && batches[0]) {
            skipTo = { ...path, psId: batches[0].id };
        } else if (level === 'subject' && course && batch) {
            if (depth <= 2) skipTo = { ...path, direct: '1' };
            else if (subjects.length === 1 && subjects[0]) {
                skipTo = { ...path, subjectId: subjects[0].id };
            }
        } else if (
            level === 'module' &&
            modulesQuery.isSuccess &&
            modules.length === 1 &&
            modules[0]
        ) {
            skipTo = { ...path, moduleId: modules[0].module.id };
        } else if (level === 'chapter' && moduleEntry && chapters.length === 1 && chapters[0]) {
            skipTo = { ...path, chapterId: chapters[0].chapter.id };
        }
    }
    const skipKey = skipTo ? JSON.stringify(toParams(skipTo)) : '';
    useEffect(() => {
        if (skipKey) navigate('lessons', JSON.parse(skipKey), { replace: true });
    }, [skipKey]);

    // ---- crumbs ---------------------------------------------------------------
    const crumbs: Crumb[] = [];
    if (course) {
        crumbs.push({ level: 'course', name: courseName(course), path: {} });
    }
    if (course && batch) {
        crumbs.push({ level: 'batch', name: batchLabel(batch), path: { courseId: path.courseId } });
    }
    if (subject && !path.direct && displayName(subject.subject_name, '')) {
        crumbs.push({
            level: 'subject',
            name: subject.subject_name,
            path: { courseId: path.courseId, psId: path.psId },
        });
    }
    if (moduleEntry && displayName(moduleEntry.module.module_name, '')) {
        crumbs.push({
            level: 'module',
            name: moduleEntry.module.module_name,
            path: { courseId: path.courseId, psId: path.psId, subjectId: path.subjectId },
        });
    }
    if (chapterEntry && level === 'slide') {
        crumbs.push({
            level: 'chapter',
            name: chapterEntry.chapter.chapter_name,
            path: {
                courseId: path.courseId,
                psId: path.psId,
                subjectId: path.subjectId,
                moduleId: path.moduleId,
            },
        });
    }

    const errorState = (onRetry: () => void, detail?: string) => (
        <PanelError
            title={t('errors.load')}
            description={t('errors.loadHint')}
            detail={detail}
            onRetry={onRetry}
        />
    );
    const notFoundState = (back: LessonPath) => (
        <PanelError
            title={t('errors.notFound')}
            description={t('errors.notFoundHint')}
            action={
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-8"
                    onClick={() => goTo(back, { replace: true, noskip: true })}
                >
                    {t('errors.backToList')}
                </MyButton>
            }
        />
    );
    const errorDetail = (error: unknown) => (error instanceof Error ? error.message : undefined);

    let body: ReactNode;
    if (skipTo) {
        body = <PanelLoading />;
    } else if (library.isLoading) {
        body = <PanelLoading />;
    } else if (library.isError) {
        body = errorState(() => void library.refetch(), errorDetail(library.error));
    } else if (path.courseId && !course) {
        body = notFoundState({});
    } else if (path.psId && !batch) {
        body = notFoundState({ courseId: path.courseId });
    } else if (level === 'course') {
        const query = search.trim().toLowerCase();
        const visible = query
            ? courses.filter((item) => courseName(item).toLowerCase().indexOf(query) >= 0)
            : courses;
        body = (
            <div className="space-y-6">
                {courses.length > 6 && (
                    <div className="max-w-2xl">
                        <MyInput
                            inputType="search"
                            size="large"
                            label={t('picker.searchCourses')}
                            labelStyle="text-h3"
                            inputPlaceholder={t('picker.searchPlaceholder')}
                            input={search}
                            onChangeFunction={(event) => setSearch(event.target.value)}
                            className="h-16 text-h3 sm:w-full"
                        />
                    </div>
                )}
                {courses.length === 0 ? (
                    <PanelEmpty
                        icon={Books}
                        title={t('empty.course')}
                        description={t('empty.courseHint')}
                    />
                ) : visible.length === 0 ? (
                    <PanelEmpty
                        title={t('empty.search', { query: search.trim() })}
                        description={t('empty.searchHint')}
                        action={
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-8"
                                onClick={() => setSearch('')}
                            >
                                {t('picker.clearSearch')}
                            </MyButton>
                        }
                    />
                ) : (
                    <LessonGrid>
                        {visible.map((item) => {
                            const count = courseBatches(item).length;
                            const draft = (item.course.status || '').toUpperCase() === 'DRAFT';
                            return (
                                <LessonCard
                                    key={item.course.id}
                                    icon={GraduationCap}
                                    title={courseName(item)}
                                    meta={t('picker.batchCount', { count })}
                                    aside={
                                        draft ? (
                                            <Badge variant="outline" className="text-subtitle">
                                                {t('picker.draftCourse')}
                                            </Badge>
                                        ) : undefined
                                    }
                                    onClick={() => goTo({ courseId: item.course.id })}
                                />
                            );
                        })}
                    </LessonGrid>
                )}
            </div>
        );
    } else if (level === 'batch') {
        body =
            batches.length === 0 ? (
                <PanelEmpty
                    icon={UsersThree}
                    title={t('empty.batch')}
                    description={t('empty.hint')}
                />
            ) : (
                <LessonGrid>
                    {batches.map((item) => (
                        <LessonCard
                            key={item.id}
                            icon={UsersThree}
                            title={batchLabel(item)}
                            meta={
                                item.name
                                    ? `${item.level?.level_name ?? ''} · ${item.session?.session_name ?? ''}`
                                    : undefined
                            }
                            onClick={() => goTo({ courseId: path.courseId, psId: item.id })}
                        />
                    ))}
                </LessonGrid>
            );
    } else if (level === 'subject') {
        body =
            subjects.length === 0 ? (
                <PanelEmpty
                    icon={BookOpenText}
                    title={t('empty.subject')}
                    description={t('empty.hint')}
                />
            ) : (
                <LessonGrid>
                    {subjects.map((item) => (
                        <LessonCard
                            key={item.id}
                            icon={BookOpenText}
                            title={displayName(item.subject_name, t('levels.subject'))}
                            onClick={() =>
                                goTo({
                                    courseId: path.courseId,
                                    psId: path.psId,
                                    subjectId: item.id,
                                })
                            }
                        />
                    ))}
                </LessonGrid>
            );
    } else if (level === 'module' || level === 'chapter') {
        if (modulesQuery.isLoading) {
            body = <PanelLoading />;
        } else if (modulesQuery.isError) {
            body = errorState(() => void modulesQuery.refetch(), errorDetail(modulesQuery.error));
        } else if (level === 'module') {
            body =
                modules.length === 0 ? (
                    <PanelEmpty
                        icon={Stack}
                        title={t('empty.module')}
                        description={t('empty.hint')}
                    />
                ) : (
                    <LessonGrid>
                        {modules.map((item) => (
                            <LessonCard
                                key={item.module.id}
                                icon={Stack}
                                title={displayName(item.module.module_name, t('levels.module'))}
                                meta={t('picker.chapterCount', {
                                    count: (item.chapters || []).filter((ch) =>
                                        isListed(ch.chapter?.status)
                                    ).length,
                                })}
                                onClick={() => goTo({ ...path, moduleId: item.module.id })}
                            />
                        ))}
                    </LessonGrid>
                );
        } else if (!moduleEntry) {
            body = notFoundState({
                courseId: path.courseId,
                psId: path.psId,
                subjectId: path.subjectId,
            });
        } else {
            body =
                chapters.length === 0 ? (
                    <PanelEmpty
                        icon={Folder}
                        title={t('empty.chapter')}
                        description={t('empty.hint')}
                    />
                ) : (
                    <LessonGrid>
                        {chapters.map((item) => (
                            <LessonCard
                                key={item.chapter.id}
                                icon={Folder}
                                title={displayName(item.chapter.chapter_name, t('levels.chapter'))}
                                meta={t('picker.slideCount', {
                                    count: sumCounts(item.slides_count),
                                })}
                                onClick={() => goTo({ ...path, chapterId: item.chapter.id })}
                            />
                        ))}
                    </LessonGrid>
                );
        }
    } else {
        // level === 'slide'
        const slides = slidesQuery.data || [];
        if (slidesQuery.isLoading) {
            body = <PanelLoading />;
        } else if (slidesQuery.isError) {
            body = errorState(() => void slidesQuery.refetch(), errorDetail(slidesQuery.error));
        } else if (slides.length === 0) {
            body = (
                <PanelEmpty icon={Folder} title={t('empty.slide')} description={t('empty.hint')} />
            );
        } else {
            body = (
                <LessonGrid>
                    {slides.map((slide) => {
                        const source = resolveSlideSource(slide);
                        const typeLabel = t(`types.${source.type}`);
                        const playable = source.kind !== 'unsupported' && source.kind !== 'missing';
                        return (
                            <LessonCard
                                key={slide.id}
                                icon={SLIDE_TYPE_ICONS[source.type]}
                                title={slide.title || typeLabel}
                                meta={typeLabel}
                                muted={!playable}
                                aside={
                                    isDraftSlide(slide) ? (
                                        <Badge variant="outline" className="text-subtitle">
                                            {t('picker.draft')}
                                        </Badge>
                                    ) : undefined
                                }
                                onClick={() =>
                                    navigate(
                                        'lessons',
                                        toParams(path, { view: 'player', slideId: slide.id })
                                    )
                                }
                            />
                        );
                    })}
                </LessonGrid>
            );
        }
    }

    return (
        <PanelStage>
            <PanelTopBar title={t('title')} onBack={goBack} />
            <PanelStageBody className="p-8">
                <div className="mx-auto max-w-screen-2xl space-y-6">
                    {crumbs.length > 0 && (
                        <nav aria-label={t('title')} className="-mb-3 flex flex-wrap items-center">
                            {crumbs.map((crumb) => (
                                <MyButton
                                    key={crumb.level}
                                    buttonType="secondary"
                                    scale="large"
                                    className="mb-3 mr-3 h-14 max-w-full px-5"
                                    aria-label={t('picker.changeLevel', {
                                        level: t(`levels.${crumb.level}`),
                                    })}
                                    onClick={() => goTo(crumb.path, { noskip: true })}
                                >
                                    <span className="truncate">
                                        <span className="text-neutral-500">
                                            {t(`levels.${crumb.level}`)}:{' '}
                                        </span>
                                        {crumb.name}
                                    </span>
                                </MyButton>
                            ))}
                        </nav>
                    )}
                    <h2 className="text-h1 font-semibold text-neutral-800">
                        {t(`picker.${level}`)}
                    </h2>
                    {body}
                </div>
            </PanelStageBody>
        </PanelStage>
    );
}
