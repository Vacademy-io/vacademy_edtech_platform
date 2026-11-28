import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormContext, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Flag, LockSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
    useStudyLibraryStore,
    type SubjectType,
} from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { handleFetchModulesWithChapters } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import type { StartSourceType, StartTrigger } from '../../-types/types';
import type { ComposerForm } from '../forms/composer-schema';
import { sourceTypeLabel, startSourceText } from '../../-utils/start-source';
import { parsePercent } from '../../-utils/format';
import {
    chapterIdOf,
    chapterNameOf,
    isListedChapter,
    type ChapterLike,
} from '../CourseSlidePicker';

interface ModuleLike {
    module: { id: string; module_name?: string };
    chapters: ChapterLike[];
}

const TRIGGERS: StartTrigger[] = ['JOIN', 'CONTENT'];

/** Shallow courses keep their skipped levels as one placeholder named DEFAULT. */
function onlyDefault(names: (string | undefined)[]): boolean {
    return names.length === 1 && (names[0] ?? '').trim().toUpperCase() === 'DEFAULT';
}

/**
 * For "days after joining" plans: what each learner's Day 1 counts from. Joining the
 * batch, or completing a subject, module or chapter of the batch's course. Learners who
 * haven't completed it don't see the plan until they do. Fixed once the plan has been
 * published (the server refuses a change).
 */
export function StartTriggerField({
    control,
    batchId,
}: {
    control: Control<ComposerForm>;
    /** The one batch the plan is for; undefined while none or several are picked. */
    batchId?: string;
}) {
    const { t } = useTranslation('engagement');
    const { setValue, formState } = useFormContext<ComposerForm>();
    const relative = useWatch({ control, name: 'scheduleMode' }) === 'RELATIVE';
    const trigger = useWatch({ control, name: 'startTrigger' }) ?? 'JOIN';
    const sourceType = useWatch({ control, name: 'startSourceType' }) ?? null;
    const sourceId = useWatch({ control, name: 'startSourceId' }) ?? null;
    const sourceName = useWatch({ control, name: 'startSourceName' }) ?? null;
    const threshold = useWatch({ control, name: 'startThreshold' }) ?? null;
    const publishedAt = useWatch({ control, name: 'publishedAt' }) ?? null;
    const locked = Boolean(publishedAt);

    const options = { shouldDirty: true, shouldValidate: formState.isSubmitted };
    const sourceError = formState.errors.startSourceId?.message;
    // Shown as soon as the box holds 0, not only after a save attempt.
    const thresholdError =
        formState.errors.startThreshold?.message ??
        (threshold != null && (threshold < 1 || threshold > 100)
            ? 'composer.errors.startThreshold'
            : undefined);
    const batchError =
        trigger === 'CONTENT' &&
        formState.errors.packageSessionIds?.message === 'composer.errors.startSourceOneBatch';

    // The chosen content belongs to one batch's course: switching to another batch drops it.
    const lastBatch = useRef(batchId);
    useEffect(() => {
        const previous = lastBatch.current;
        lastBatch.current = batchId ?? previous;
        if (!previous || !batchId || previous === batchId || !sourceId) return;
        setValue('startSourceId', null, { shouldDirty: true });
        setValue('startSourceName', null, { shouldDirty: true });
    }, [batchId, sourceId, setValue]);

    if (!relative) return null;

    if (locked) {
        return (
            <p className="flex items-start gap-2 text-caption text-neutral-600">
                <LockSimple size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                    <span className="font-semibold text-neutral-800">
                        {trigger === 'CONTENT'
                            ? t('composer.relative.startLockedContent', {
                                  source: startSourceText(
                                      {
                                          scheduleMode: 'RELATIVE',
                                          startTrigger: 'CONTENT',
                                          startSourceType: sourceType ?? undefined,
                                          startSourceName: sourceName,
                                      },
                                      t
                                  ),
                                  percent: threshold ?? 100,
                              })
                            : t('composer.relative.start.JOIN')}
                    </span>
                    {' · '}
                    {t('composer.relative.startLocked')}
                </span>
            </p>
        );
    }

    function changeTrigger(next: StartTrigger) {
        setValue('startTrigger', next, options);
        if (next === 'JOIN') {
            setValue('startSourceType', null, options);
            setValue('startSourceId', null, options);
            setValue('startSourceName', null, options);
            setValue('startThreshold', null, options);
        } else if (!sourceType) {
            setValue('startSourceType', 'CHAPTER', options);
        }
    }

    return (
        <div className="space-y-2" data-composer-path="startSourceId">
            <p id="plan-start-trigger" className="text-subtitle font-regular text-neutral-900">
                {t('composer.relative.startLabel')}
            </p>
            <RadioGroup
                value={trigger}
                onValueChange={(value) => changeTrigger(value as StartTrigger)}
                aria-labelledby="plan-start-trigger"
                className="grid gap-2 sm:grid-cols-2"
            >
                {TRIGGERS.map((option) => {
                    const id = `plan-start-trigger-${option}`;
                    const checked = trigger === option;
                    return (
                        <label
                            key={option}
                            htmlFor={id}
                            className={cn(
                                'flex cursor-pointer items-start gap-2 rounded-lg border p-3',
                                checked
                                    ? 'border-primary-300 bg-primary-50'
                                    : 'border-neutral-200 hover:border-neutral-300'
                            )}
                        >
                            <RadioGroupItem id={id} value={option} className="mt-0.5" />
                            <span className="min-w-0">
                                <span className="block text-body font-semibold text-neutral-900">
                                    {t(`composer.relative.start.${option}`)}
                                </span>
                                <span className="block text-caption text-neutral-500">
                                    {t(`composer.relative.start.${option}_hint`)}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </RadioGroup>

            {trigger === 'CONTENT' && (
                <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    {!batchId ? (
                        <p
                            className={cn(
                                'text-caption',
                                batchError ? 'text-danger-600' : 'text-neutral-600'
                            )}
                        >
                            {t('composer.relative.pickOneBatch')}
                        </p>
                    ) : (
                        <ContentSourcePicker
                            batchId={batchId}
                            sourceType={sourceType ?? 'CHAPTER'}
                            sourceId={sourceId}
                            sourceName={sourceName}
                            onTypeChange={(type) => {
                                setValue('startSourceType', type, options);
                                setValue('startSourceId', null, options);
                                setValue('startSourceName', null, options);
                            }}
                            onPick={(type, id, name) => {
                                setValue('startSourceType', type, options);
                                setValue('startSourceId', id, options);
                                setValue('startSourceName', name, options);
                            }}
                        />
                    )}
                    {sourceError && (
                        <p className="text-caption text-danger-600">{t(sourceError)}</p>
                    )}
                    <div className="max-w-xs">
                        <MyInput
                            inputType="text"
                            inputMode="numeric"
                            maxLength={3}
                            label={t('composer.relative.threshold')}
                            aria-label={t('composer.relative.threshold')}
                            inputPlaceholder="100"
                            input={threshold == null ? '' : String(threshold)}
                            onChangeFunction={(e) =>
                                setValue('startThreshold', parsePercent(e.target.value), options)
                            }
                            error={thresholdError ? t(thresholdError) : undefined}
                            className="sm:w-full"
                        />
                        <p className="mt-1 text-caption text-neutral-500">
                            {t('composer.relative.thresholdHint')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * The whole course, or a subject, module or chapter of it, following the course's depth:
 * levels a shallow course skips (kept as one DEFAULT placeholder) are neither shown nor
 * offered, so a depth-3 course offers chapters only and a depth-2 course the whole course.
 * A saved choice shows by name with a Change button: only its id is stored, not the path.
 */
function ContentSourcePicker({
    batchId,
    sourceType,
    sourceId,
    sourceName,
    onTypeChange,
    onPick,
}: {
    batchId: string;
    sourceType: StartSourceType;
    sourceId: string | null;
    sourceName: string | null;
    onTypeChange: (type: StartSourceType) => void;
    onPick: (type: StartSourceType, id: string, name: string) => void;
}) {
    const { t } = useTranslation('engagement');
    const [browsing, setBrowsing] = useState(!sourceId);
    const [subjectId, setSubjectId] = useState('');
    const [moduleId, setModuleId] = useState('');
    // Browsing whenever nothing is chosen (also after a batch switch cleared the choice).
    const open = browsing || !sourceId;

    const { studyLibraryData } = useStudyLibraryStore();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const libraryQuery = useQuery({ ...useStudyLibraryQuery(), enabled: open });

    const { subjects, depth, courseName } = useMemo(() => {
        const details = getDetailsFromPackageSessionId({ packageSessionId: batchId });
        const course = details
            ? studyLibraryData?.find((c) => c.course.id === details.package_dto?.id)
            : undefined;
        const session = course?.sessions.find((s) => s.session_dto.id === details?.session?.id);
        const level = session?.level_with_details.find((l) => l.id === details?.level?.id);
        return {
            subjects: (level?.subjects ?? []) as SubjectType[],
            depth: course?.course.course_depth ?? null,
            courseName: course?.course.package_name || details?.package_dto?.package_name || '',
        };
    }, [studyLibraryData, getDetailsFromPackageSessionId, batchId]);

    // A different batch means a different course tree.
    useEffect(() => {
        setSubjectId('');
        setModuleId('');
    }, [batchId]);

    useEffect(() => {
        if (open && !subjectId && subjects.length === 1 && subjects[0]) {
            setSubjectId(subjects[0].id);
        }
    }, [open, subjectId, subjects]);

    const modulesQuery = useQuery({
        ...handleFetchModulesWithChapters(subjectId, batchId),
        enabled: open && sourceType !== 'COURSE' && sourceType !== 'SUBJECT' && Boolean(subjectId),
    });
    const modules: ModuleLike[] = useMemo(
        () =>
            ((modulesQuery.data as ModuleLike[] | undefined) ?? []).map((m) => ({
                ...m,
                chapters: (m.chapters ?? []).filter(isListedChapter),
            })),
        [modulesQuery.data]
    );

    useEffect(() => {
        if (open && !moduleId && modules.length === 1 && modules[0]) {
            setModuleId(modules[0].module.id);
        }
    }, [open, moduleId, modules]);
    const chapters = modules.find((m) => m.module.id === moduleId)?.chapters ?? [];

    // course_depth: 5 = subject/module/chapter, 4 = module/chapter, 3 = chapter, 2 = slides
    // only. Older courses without a depth fall back to spotting the DEFAULT placeholder.
    const subjectHidden =
        subjects.length === 1 &&
        ((depth != null && depth < 5) || onlyDefault(subjects.map((s) => s.subject_name)));
    const moduleHidden =
        (depth != null && depth < 4 && modules.length <= 1) ||
        (modules.length === 1 && onlyDefault(modules.map((m) => m.module.module_name)));
    const chapterHidden =
        (depth != null && depth < 3) ||
        (moduleHidden && chapters.length === 1 && onlyDefault(chapters.map(chapterNameOf)));
    const types: StartSourceType[] = [
        'COURSE',
        ...(subjectHidden ? [] : (['SUBJECT'] as const)),
        ...(moduleHidden ? [] : (['MODULE'] as const)),
        ...(chapterHidden ? [] : (['CHAPTER'] as const)),
    ];
    // Wait for the course before deciding a type isn't offered.
    const courseKnown = depth != null || subjects.length > 0;

    function pickCourse() {
        onPick('COURSE', batchId, courseName);
        setBrowsing(false);
    }

    // A type this course doesn't have (e.g. Chapter on a slides-only course) moves to the
    // deepest one it does; the whole course is picked straight away.
    const lastTypeFix = useRef('');
    useEffect(() => {
        if (!open || !courseKnown || types.includes(sourceType)) return;
        const next = types[types.length - 1] ?? 'COURSE';
        const key = `${batchId}:${sourceType}:${next}`;
        if (lastTypeFix.current === key) return;
        lastTypeFix.current = key;
        onTypeChange(next);
        if (next === 'COURSE' && !sourceId) pickCourse();
    });

    if (!browsing && sourceId) {
        return (
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-body text-neutral-800">
                    <Flag size={16} className="shrink-0 text-primary-500" aria-hidden />
                    <span className="truncate">
                        <span className="font-semibold">{sourceTypeLabel(sourceType, t)}:</span>{' '}
                        {sourceName || t('composer.relative.sourceUnnamed')}
                    </span>
                </p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setBrowsing(true)}
                >
                    {t('composer.relative.change')}
                </MyButton>
            </div>
        );
    }

    const loadingSubjects =
        subjects.length === 0 && (libraryQuery.isLoading || libraryQuery.isFetching);
    const showSubject = sourceType !== 'COURSE' && !subjectHidden;
    const showModule = (sourceType === 'MODULE' || sourceType === 'CHAPTER') && !moduleHidden;
    const showChapter = sourceType === 'CHAPTER';

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {types.length > 1 && (
                <SelectBox
                    label={t('composer.relative.sourceTypeLabel')}
                    value={sourceType}
                    onChange={(value) => {
                        const next = value as StartSourceType;
                        onTypeChange(next);
                        setModuleId('');
                        if (next === 'COURSE') pickCourse();
                    }}
                    options={types.map((type) => ({
                        value: type,
                        label: sourceTypeLabel(type, t),
                    }))}
                />
            )}
            {types.length === 1 && courseKnown && (
                <p className="text-caption text-neutral-600 sm:col-span-2">
                    {t('composer.relative.courseOnly')}
                </p>
            )}
            {showSubject && (
                <SelectBox
                    label={sourceTypeLabel('SUBJECT', t)}
                    value={subjectId}
                    placeholder={
                        loadingSubjects
                            ? t('composer.relative.loading')
                            : subjects.length === 0
                              ? t('composer.relative.noSubjects')
                              : t('composer.relative.choose')
                    }
                    disabled={subjects.length === 0}
                    onChange={(value) => {
                        setSubjectId(value);
                        setModuleId('');
                        if (sourceType === 'SUBJECT') {
                            const name = subjects.find((s) => s.id === value)?.subject_name ?? '';
                            onPick('SUBJECT', value, name);
                            setBrowsing(false);
                        }
                    }}
                    options={subjects.map((s) => ({ value: s.id, label: s.subject_name }))}
                />
            )}
            {showModule && (
                <SelectBox
                    label={sourceTypeLabel('MODULE', t)}
                    value={moduleId}
                    placeholder={
                        !subjectId
                            ? t('composer.relative.subjectFirst')
                            : modulesQuery.isLoading
                              ? t('composer.relative.loading')
                              : t('composer.relative.choose')
                    }
                    disabled={!subjectId || modules.length === 0}
                    onChange={(value) => {
                        setModuleId(value);
                        if (sourceType === 'MODULE') {
                            const name =
                                modules.find((m) => m.module.id === value)?.module.module_name ??
                                '';
                            onPick('MODULE', value, name);
                            setBrowsing(false);
                        }
                    }}
                    options={modules.map((m) => ({
                        value: m.module.id,
                        label: m.module.module_name ?? m.module.id,
                    }))}
                />
            )}
            {showChapter && (
                <SelectBox
                    label={sourceTypeLabel('CHAPTER', t)}
                    value=""
                    placeholder={
                        !moduleId
                            ? modulesQuery.isLoading
                                ? t('composer.relative.loading')
                                : t('composer.relative.moduleFirst')
                            : chapters.length === 0
                              ? t('composer.relative.noChapters')
                              : t('composer.relative.choose')
                    }
                    disabled={!moduleId || chapters.length === 0}
                    onChange={(value) => {
                        const chapter = chapters.find((c) => chapterIdOf(c) === value);
                        onPick('CHAPTER', value, chapterNameOf(chapter) ?? '');
                        setBrowsing(false);
                    }}
                    options={chapters.map((c) => ({
                        value: chapterIdOf(c),
                        label: chapterNameOf(c) ?? chapterIdOf(c),
                    }))}
                />
            )}
            {sourceId && (
                <div className="flex items-end sm:col-span-2">
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        className="px-0"
                        onClick={() => setBrowsing(false)}
                    >
                        {t('composer.relative.keepCurrent', {
                            name: sourceName || t('composer.relative.sourceUnnamed'),
                        })}
                    </MyButton>
                </div>
            )}
        </div>
    );
}

function SelectBox({
    label,
    value,
    placeholder,
    disabled,
    onChange,
    options,
}: {
    label: string;
    value: string;
    placeholder?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <div className="min-w-0 space-y-1">
            <p className="text-caption font-semibold text-neutral-700">{label}</p>
            <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
                <SelectTrigger aria-label={label} className="w-full bg-white">
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
