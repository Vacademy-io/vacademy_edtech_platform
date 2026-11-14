import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CaretRight, Users } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import {
    formatDuration,
    LiveStatusLine,
    PulseMessage,
    slideIconFor,
    useSecondsTicker,
} from '@/routes/study-library/courses/course-details/-components/pulse/pulse-shared';
import { instituteContentMapQueryOptions } from '../-services/institute-pulse-services';
import type {
    ContentMapCourseNode,
    InstituteContentMapResponse,
} from '../-types/institute-pulse-types';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * Open/closed state is held centrally as a Set of node keys rather than per-node useState,
 * because "expand this whole course" has to open descendants the parent never renders while
 * collapsed. Keys are path-based so the same subject id under two courses stays distinct.
 */
const courseKey = (courseId: string) => `c:${courseId}`;
const subjectKey = (courseId: string, subjectId: string) => `c:${courseId}|s:${subjectId}`;
const moduleKey = (courseId: string, subjectId: string, moduleId: string) =>
    `c:${courseId}|s:${subjectId}|m:${moduleId}`;
const chapterKey = (courseId: string, subjectId: string, moduleId: string, chapterId: string) =>
    `c:${courseId}|s:${subjectId}|m:${moduleId}|ch:${chapterId}`;

/** Every key in one course's subtree, including the course itself. */
function subtreeKeys(course: ContentMapCourseNode): string[] {
    const keys = [courseKey(course.id)];
    for (const subject of course.subjects) {
        keys.push(subjectKey(course.id, subject.id));
        for (const module of subject.modules) {
            keys.push(moduleKey(course.id, subject.id, module.id));
            for (const chapter of module.chapters) {
                keys.push(chapterKey(course.id, subject.id, module.id, chapter.id));
            }
        }
    }
    return keys;
}

function HeadCount({ value }: { value: number }) {
    return (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-600">
            <Users size={12} weight="fill" />
            {value}
        </span>
    );
}

/**
 * A tree row. The caret area and the expand-all control are sibling buttons inside a div, not
 * nested buttons — nesting is invalid HTML and breaks keyboard activation.
 */
function TreeRow({
    depth,
    label,
    heads,
    open,
    onToggle,
    trailing,
}: {
    depth: number;
    label: string;
    heads: number;
    open: boolean;
    onToggle: () => void;
    trailing?: React.ReactNode;
}) {
    const indent = ['pl-4', 'pl-8', 'pl-12', 'pl-16'][depth] ?? 'pl-4';

    return (
        <div
            className={cn(
                'flex items-center gap-2 border-b border-neutral-100 pr-4 hover:bg-neutral-50',
                indent
            )}
        >
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
            >
                {open ? (
                    <CaretDown size={14} className="shrink-0 text-neutral-400" />
                ) : (
                    <CaretRight size={14} className="shrink-0 text-neutral-400" />
                )}
                <span
                    className={cn(
                        'min-w-0 flex-1 truncate',
                        depth === 0
                            ? 'text-sm font-semibold text-neutral-700'
                            : 'text-sm text-neutral-600'
                    )}
                >
                    {label}
                </span>
            </button>
            {trailing}
            <HeadCount value={heads} />
        </div>
    );
}

export default function ContentMapView({
    instituteId,
    scope,
}: {
    instituteId: string;
    scope: string;
}) {
    const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useQuery(
        instituteContentMapQueryOptions(instituteId, true, scope)
    );

    const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

    const toggle = useCallback((key: string) => {
        setOpenKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const setMany = useCallback((keys: string[], open: boolean) => {
        setOpenKeys((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => (open ? next.add(k) : next.delete(k)));
            return next;
        });
    }, []);

    const now = useSecondsTicker();
    const secondsSinceFetch = dataUpdatedAt
        ? Math.max(0, Math.floor((now - dataUpdatedAt) / 1000))
        : 0;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center rounded-md bg-white p-10 shadow-sm">
                <DashboardLoader />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                <PulseMessage
                    tone="danger"
                    title="Couldn't load the content map."
                    subtitle="Check your connection and try again."
                    action={
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            Retry
                        </MyButton>
                    }
                />
            </div>
        );
    }

    const courses: InstituteContentMapResponse['courses'] = data?.courses ?? [];

    return (
        <div className="flex flex-col gap-4">
            <LiveStatusLine secondsSinceFetch={secondsSinceFetch} isFetching={isFetching} />

            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Where the institute is right now
                    </p>
                    <p className="text-xs text-neutral-400">{data?.totalHeads ?? 0} in content</p>
                </div>

                {courses.length === 0 ? (
                    <PulseMessage
                        title="No active content right now"
                        subtitle={`${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)} appear here the moment a learner opens a slide.`}
                    />
                ) : (
                    courses.map((course) => {
                        const cKey = courseKey(course.id);
                        const allKeys = subtreeKeys(course);
                        const fullyExpanded = allKeys.every((k) => openKeys.has(k));

                        return (
                            <div key={course.id}>
                                <TreeRow
                                    depth={0}
                                    label={
                                        course.name ??
                                        `Untitled ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`
                                    }
                                    heads={course.headsNow}
                                    open={openKeys.has(cKey)}
                                    onToggle={() => toggle(cKey)}
                                    trailing={
                                        <button
                                            type="button"
                                            onClick={() => setMany(allKeys, !fullyExpanded)}
                                            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary-500 hover:bg-primary-50"
                                        >
                                            {fullyExpanded ? 'Collapse all' : 'Expand all'}
                                        </button>
                                    }
                                />

                                {openKeys.has(cKey) &&
                                    course.subjects.map((subject) => {
                                        const sKey = subjectKey(course.id, subject.id);
                                        return (
                                            <div key={subject.id}>
                                                <TreeRow
                                                    depth={1}
                                                    label={subject.name ?? 'Untitled subject'}
                                                    heads={subject.headsNow}
                                                    open={openKeys.has(sKey)}
                                                    onToggle={() => toggle(sKey)}
                                                />

                                                {openKeys.has(sKey) &&
                                                    subject.modules.map((module) => {
                                                        const mKey = moduleKey(
                                                            course.id,
                                                            subject.id,
                                                            module.id
                                                        );
                                                        return (
                                                            <div key={module.id}>
                                                                <TreeRow
                                                                    depth={2}
                                                                    label={
                                                                        module.name ??
                                                                        'Untitled module'
                                                                    }
                                                                    heads={module.headsNow}
                                                                    open={openKeys.has(mKey)}
                                                                    onToggle={() => toggle(mKey)}
                                                                />

                                                                {openKeys.has(mKey) &&
                                                                    module.chapters.map(
                                                                        (chapter) => {
                                                                            const chKey =
                                                                                chapterKey(
                                                                                    course.id,
                                                                                    subject.id,
                                                                                    module.id,
                                                                                    chapter.id
                                                                                );
                                                                            return (
                                                                                <div
                                                                                    key={chapter.id}
                                                                                >
                                                                                    <TreeRow
                                                                                        depth={3}
                                                                                        label={
                                                                                            chapter.name ??
                                                                                            `Untitled ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()}`
                                                                                        }
                                                                                        heads={
                                                                                            chapter.headsNow
                                                                                        }
                                                                                        open={openKeys.has(
                                                                                            chKey
                                                                                        )}
                                                                                        onToggle={() =>
                                                                                            toggle(
                                                                                                chKey
                                                                                            )
                                                                                        }
                                                                                    />

                                                                                    {openKeys.has(
                                                                                        chKey
                                                                                    ) &&
                                                                                        chapter.slides.map(
                                                                                            (
                                                                                                slide
                                                                                            ) => {
                                                                                                const Icon =
                                                                                                    slideIconFor(
                                                                                                        slide.slideType
                                                                                                    );
                                                                                                return (
                                                                                                    <div
                                                                                                        key={
                                                                                                            slide.id
                                                                                                        }
                                                                                                        className="flex items-center gap-2 border-b border-neutral-100 py-2 pl-16 pr-4"
                                                                                                    >
                                                                                                        <Icon
                                                                                                            size={
                                                                                                                14
                                                                                                            }
                                                                                                            className="shrink-0 text-neutral-400"
                                                                                                        />
                                                                                                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-600">
                                                                                                            {slide.title ??
                                                                                                                'Untitled slide'}
                                                                                                        </span>
                                                                                                        <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                                                                                                            avg{' '}
                                                                                                            {formatDuration(
                                                                                                                slide.avgOnSlideSeconds
                                                                                                            )}
                                                                                                        </span>
                                                                                                        <HeadCount
                                                                                                            value={
                                                                                                                slide.headsNow
                                                                                                            }
                                                                                                        />
                                                                                                    </div>
                                                                                                );
                                                                                            }
                                                                                        )}
                                                                                </div>
                                                                            );
                                                                        }
                                                                    )}
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        );
                                    })}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
