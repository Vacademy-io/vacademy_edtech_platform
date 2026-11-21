import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useEffect, useMemo, useState, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { CaretDown, CheckCircle, MagnifyingGlass, X } from '@phosphor-icons/react';
import { addParticipantsSchema } from '../-schema/schema';
import { LiveSessionStudentListTab } from './LiveSessionStudentListTab';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type FormData = z.infer<typeof addParticipantsSchema>;

interface Course {
    courseName: string;
    courseId: string;
    sessionId: string;
    levels: Array<{
        name: string;
        id: string;
    }>;
}

type SelectedLevel = {
    courseId: string;
    sessionId: string;
    levelId: string;
};

const sameLevel = (a: SelectedLevel, b: SelectedLevel) =>
    a.courseId === b.courseId && a.sessionId === b.sessionId && a.levelId === b.levelId;

export function LiveSessionParticipantsTab({
    form,
    courses,
    currentSession,
}: {
    form: UseFormReturn<FormData>;
    courses: Course[] | undefined;
    currentSession: { id: string; name: string } | undefined;
}) {
    const { t } = useTranslation('studyLibraryLiveSessionParticipantsTab');
    const [selectedTab, setSelectedTab] = useState(
        form.getValues('batchSelectionType') === 'individual' ? 'Individually' : 'Batch'
    );

    const handleChange = (value: string) => {
        setSelectedTab(value);
    };

    useEffect(() => {
        if (selectedTab === 'Batch') {
            form.setValue('batchSelectionType', 'batch');
        } else {
            form.setValue('batchSelectionType', 'individual');
        }
    }, [selectedTab, form]);

    return (
        <Tabs value={selectedTab} onValueChange={handleChange}>
            <TabsList className="mt-4 flex h-auto w-full flex-wrap justify-start border border-neutral-500 !bg-transparent p-0 sm:w-fit">
                <TabsTrigger
                    value="Batch"
                    className={`flex gap-1.5 rounded-l-lg rounded-r-none p-2 pr-4 ${
                        selectedTab === 'Batch'
                            ? '!bg-primary-100 !text-neutral-500'
                            : 'bg-transparent px-4'
                    }`}
                >
                    {selectedTab === 'Batch' && (
                        <CheckCircle size={18} className="text-teal-800 dark:text-teal-400" />
                    )}
                    <span className={`${selectedTab === 'Batch' ? 'text-neutral-600' : ''}`}>
                        {t('tabs.selectBatch')}
                    </span>
                </TabsTrigger>
                <Separator className="!h-9 bg-neutral-600" orientation="vertical" />
                <TabsTrigger
                    value="Individually"
                    className={`flex gap-1.5 rounded-l-none rounded-r-lg p-2 ${
                        selectedTab === 'Individually'
                            ? '!bg-primary-100 pr-4'
                            : 'bg-transparent px-4'
                    }`}
                >
                    {selectedTab === 'Individually' && (
                        <CheckCircle size={18} className="text-teal-800 dark:text-teal-400" />
                    )}
                    <span
                        className={`${selectedTab === 'Individually' ? 'text-neutral-600' : ''}`}
                    >
                        {t('tabs.selectIndividually')}
                    </span>
                </TabsTrigger>
            </TabsList>
            <TabsContent value="Batch" className="mt-6">
                <LiveSessionBatchList
                    courses={courses}
                    form={form}
                    currentSession={currentSession}
                />
            </TabsContent>
            <TabsContent value="Individually">
                <Suspense fallback={<DashboardLoader />}>
                    <LiveSessionStudentListTab form={form} />
                </Suspense>
            </TabsContent>
        </Tabs>
    );
}

const LiveSessionBatchList = ({
    courses,
    form,
    currentSession,
}: {
    courses: Course[] | undefined;
    form: UseFormReturn<FormData>;
    currentSession: { id: string; name: string } | undefined;
}) => {
    const { t } = useTranslation('studyLibraryLiveSessionParticipantsTab');
    const { setValue, watch } = form;
    const selectedLevels = watch('selectedLevels') ?? [];

    const [search, setSearch] = useState('');
    const [openCourseIds, setOpenCourseIds] = useState<Set<string>>(new Set());

    const sessionCourses = useMemo(
        () => (courses ?? []).filter((c) => c.sessionId === currentSession?.id),
        [courses, currentSession?.id]
    );

    const filteredCourses = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return sessionCourses;
        return sessionCourses
            .map((course) => {
                const courseMatches = course.courseName.toLowerCase().includes(q);
                const matchedLevels = courseMatches
                    ? course.levels
                    : course.levels.filter((l) => l.name.toLowerCase().includes(q));
                if (matchedLevels.length === 0) return null;
                return { ...course, levels: matchedLevels };
            })
            .filter(Boolean) as Course[];
    }, [sessionCourses, search]);

    // Auto-open courses that match search or have selections
    useEffect(() => {
        if (search.trim()) {
            setOpenCourseIds(new Set(filteredCourses.map((c) => c.courseId)));
        }
    }, [search, filteredCourses]);

    useEffect(() => {
        if (selectedLevels.length === 0) return;
        setOpenCourseIds((prev) => {
            const next = new Set(prev);
            for (const lvl of selectedLevels) {
                if (lvl.sessionId === currentSession?.id) next.add(lvl.courseId);
            }
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSession?.id]);

    const toggleCourseOpen = (courseId: string) => {
        setOpenCourseIds((prev) => {
            const next = new Set(prev);
            if (next.has(courseId)) next.delete(courseId);
            else next.add(courseId);
            return next;
        });
    };

    const allCourseLevelKeys = (course: Course): SelectedLevel[] =>
        course.levels.map((l) => ({
            courseId: course.courseId,
            sessionId: course.sessionId,
            levelId: l.id,
        }));

    const courseSelectedCount = (course: Course) => {
        const keys = allCourseLevelKeys(course);
        return keys.filter((k) => selectedLevels.some((s) => sameLevel(s, k))).length;
    };

    const setCourseAllSelected = (course: Course, checked: boolean) => {
        const keys = allCourseLevelKeys(course);
        let next = [...selectedLevels];
        if (checked) {
            for (const k of keys) {
                if (!next.some((s) => sameLevel(s, k))) next.push(k);
            }
        } else {
            next = next.filter((s) => !keys.some((k) => sameLevel(s, k)));
        }
        setValue('selectedLevels', next, { shouldDirty: true, shouldValidate: true });
    };

    const toggleLevel = (level: SelectedLevel, checked: boolean) => {
        let next = [...selectedLevels];
        if (checked) {
            if (!next.some((s) => sameLevel(s, level))) next.push(level);
        } else {
            next = next.filter((s) => !sameLevel(s, level));
        }
        setValue('selectedLevels', next, { shouldDirty: true, shouldValidate: true });
    };

    const sessionSelectedLevels = useMemo(
        () => selectedLevels.filter((s) => s.sessionId === currentSession?.id),
        [selectedLevels, currentSession?.id]
    );

    const sessionSelectedCourseCount = useMemo(
        () => new Set(sessionSelectedLevels.map((s) => s.courseId)).size,
        [sessionSelectedLevels]
    );

    const totalLevelsInSession = useMemo(
        () => sessionCourses.reduce((sum, c) => sum + c.levels.length, 0),
        [sessionCourses]
    );

    const allSessionSelected =
        totalLevelsInSession > 0 && sessionSelectedLevels.length === totalLevelsInSession;

    const selectAllInSession = (checked: boolean) => {
        const keys = sessionCourses.flatMap(allCourseLevelKeys);
        let next = selectedLevels.filter((s) => s.sessionId !== currentSession?.id);
        if (checked) next = next.concat(keys);
        setValue('selectedLevels', next, { shouldDirty: true, shouldValidate: true });
    };

    const clearSearch = () => setSearch('');

    if (!currentSession) {
        return (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
                {t('emptyStates.selectSessionFirst')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Top toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-sm">
                    <MagnifyingGlass
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('search.placeholder')}
                        className="h-9 pl-9 pr-9"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={clearSearch}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-600"
                            aria-label={t('search.clearAriaLabel')}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-xs">
                        {t('summary.selectedOfTotalBatches', {
                            selected: sessionSelectedLevels.length,
                            total: totalLevelsInSession,
                        })}
                    </Badge>
                    {sessionSelectedLevels.length > 0 && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => selectAllInSession(false)}
                        >
                            {t('actions.clear')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Master select-all row */}
            {sessionCourses.length > 0 && (
                <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-700">
                        <Checkbox
                            checked={
                                allSessionSelected
                                    ? true
                                    : sessionSelectedLevels.length > 0
                                    ? 'indeterminate'
                                    : false
                            }
                            onCheckedChange={(c) => selectAllInSession(c === true)}
                            className={cn(
                                'size-4 rounded-sm border-2 shadow-none',
                                allSessionSelected || sessionSelectedLevels.length > 0
                                    ? 'border-none bg-primary-500 text-white'
                                    : ''
                            )}
                        />
                        {t('actions.selectAllInSession')}
                    </label>
                    <span className="text-xs text-neutral-500">
                        {t('summary.courseCount', { count: filteredCourses.length })}
                        {sessionSelectedCourseCount > 0
                            ? ` · ${t('summary.withSelections', { count: sessionSelectedCourseCount })}`
                            : ''}
                    </span>
                </div>
            )}

            {/* Course list */}
            <ScrollArea className="h-[420px] rounded-md border border-neutral-200">
                <div className="divide-y divide-neutral-100">
                    {filteredCourses.length === 0 && (
                        <div className="p-8 text-center text-sm text-neutral-500">
                            {search.trim()
                                ? t('emptyStates.noSearchMatches')
                                : t('emptyStates.noCoursesAvailable')}
                        </div>
                    )}
                    {filteredCourses.map((course) => {
                        const total = course.levels.length;
                        const selected = courseSelectedCount(course);
                        const isOpen = openCourseIds.has(course.courseId);
                        const allSelected = total > 0 && selected === total;
                        const indeterminate = selected > 0 && !allSelected;

                        return (
                            <Collapsible
                                key={course.courseId}
                                open={isOpen}
                                onOpenChange={() => toggleCourseOpen(course.courseId)}
                            >
                                <div
                                    className={cn(
                                        'flex items-center gap-3 px-3 py-2.5 transition-colors',
                                        selected > 0 ? 'bg-primary-50/40' : 'hover:bg-neutral-50'
                                    )}
                                >
                                    <Checkbox
                                        checked={
                                            allSelected
                                                ? true
                                                : indeterminate
                                                ? 'indeterminate'
                                                : false
                                        }
                                        onCheckedChange={(c) =>
                                            setCourseAllSelected(course, c === true)
                                        }
                                        className={cn(
                                            'size-4 rounded-sm border-2 shadow-none',
                                            allSelected || indeterminate
                                                ? 'border-none bg-primary-500 text-white'
                                                : ''
                                        )}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <CollapsibleTrigger asChild>
                                        <button
                                            type="button"
                                            className="flex flex-1 items-center justify-between gap-3 text-left"
                                        >
                                            <span className="truncate text-sm font-medium text-neutral-800">
                                                {course.courseName}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <Badge
                                                    variant={selected > 0 ? 'default' : 'outline'}
                                                    className={cn(
                                                        'rounded-full px-2 py-0.5 text-[11px] font-normal',
                                                        selected > 0
                                                            ? 'bg-primary-500 hover:bg-primary-500'
                                                            : 'text-neutral-500'
                                                    )}
                                                >
                                                    {selected}/{total}
                                                </Badge>
                                                <CaretDown
                                                    size={14}
                                                    className={cn(
                                                        'text-neutral-400 transition-transform',
                                                        isOpen && 'rotate-180'
                                                    )}
                                                />
                                            </div>
                                        </button>
                                    </CollapsibleTrigger>
                                </div>

                                <CollapsibleContent>
                                    <div className="grid gap-1 bg-white px-3 pb-3 pl-10 pt-1 sm:grid-cols-2">
                                        {course.levels.map((level) => {
                                            const key: SelectedLevel = {
                                                courseId: course.courseId,
                                                sessionId: course.sessionId,
                                                levelId: level.id,
                                            };
                                            const isChecked = selectedLevels.some((s) =>
                                                sameLevel(s, key)
                                            );
                                            return (
                                                <label
                                                    key={level.id}
                                                    className={cn(
                                                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                                                        isChecked
                                                            ? 'bg-primary-50 text-neutral-800'
                                                            : 'text-neutral-700 hover:bg-neutral-50'
                                                    )}
                                                >
                                                    <Checkbox
                                                        checked={isChecked}
                                                        onCheckedChange={(c) =>
                                                            toggleLevel(key, c === true)
                                                        }
                                                        className={cn(
                                                            'size-4 rounded-sm border-2 shadow-none',
                                                            isChecked
                                                                ? 'border-none bg-primary-500 text-white'
                                                                : ''
                                                        )}
                                                    />
                                                    <span className="truncate">{level.name}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        );
                    })}
                </div>
            </ScrollArea>

            {/* Sticky footer summary */}
            {sessionSelectedLevels.length > 0 && (
                <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-md border border-primary-200 bg-primary-50/60 px-3 py-2 text-xs text-neutral-700">
                    <span className="font-medium">
                        {t('summary.footerSelected', {
                            batchPart: t('summary.batchCount', {
                                count: sessionSelectedLevels.length,
                            }),
                            coursePart: t('summary.courseCount', {
                                count: sessionSelectedCourseCount,
                            }),
                        })}
                    </span>
                </div>
            )}
        </div>
    );
};
