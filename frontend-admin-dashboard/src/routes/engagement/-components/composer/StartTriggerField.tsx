import { useEffect, useMemo, useState } from 'react';
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
const SOURCE_TYPES: StartSourceType[] = ['SUBJECT', 'MODULE', 'CHAPTER'];

function parsePercent(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : null;
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
    const thresholdError = formState.errors.startThreshold?.message;
    const batchError =
        trigger === 'CONTENT' &&
        formState.errors.packageSessionIds?.message === 'composer.errors.startSourceOneBatch';

    if (!relative) return null;

    const sourceLabel = sourceType ? t(`composer.relative.sourceType.${sourceType}`) : '';

    if (locked) {
        return (
            <p className="flex items-start gap-2 text-caption text-neutral-600">
                <LockSimple size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                    <span className="font-semibold text-neutral-800">
                        {trigger === 'CONTENT'
                            ? t('composer.relative.startLockedContent', {
                                  type: sourceLabel,
                                  name: sourceName || t('composer.relative.sourceUnnamed'),
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
                            onPick={(id, name) => {
                                setValue('startSourceType', sourceType ?? 'CHAPTER', options);
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
                            inputType="number"
                            min={1}
                            max={100}
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
 * Subject, then module, then chapter, as deep as the chosen type needs. A saved choice
 * shows by name with a Change button: only its id is stored, not the path to it.
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
    onPick: (id: string, name: string) => void;
}) {
    const { t } = useTranslation('engagement');
    const [browsing, setBrowsing] = useState(!sourceId);
    const [subjectId, setSubjectId] = useState('');
    const [moduleId, setModuleId] = useState('');

    const { studyLibraryData } = useStudyLibraryStore();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const libraryQuery = useQuery({ ...useStudyLibraryQuery(), enabled: browsing });

    const subjects: SubjectType[] = useMemo(() => {
        const details = getDetailsFromPackageSessionId({ packageSessionId: batchId });
        if (!details) return [];
        const course = studyLibraryData?.find((c) => c.course.id === details.package_dto?.id);
        const session = course?.sessions.find((s) => s.session_dto.id === details.session?.id);
        const level = session?.level_with_details.find((l) => l.id === details.level?.id);
        return level?.subjects ?? [];
    }, [studyLibraryData, getDetailsFromPackageSessionId, batchId]);

    // A different batch means a different course tree.
    useEffect(() => {
        setSubjectId('');
        setModuleId('');
    }, [batchId]);

    useEffect(() => {
        if (browsing && !subjectId && subjects.length === 1 && subjects[0]) {
            setSubjectId(subjects[0].id);
        }
    }, [browsing, subjectId, subjects]);

    const needsModules = sourceType !== 'SUBJECT';
    const modulesQuery = useQuery({
        ...handleFetchModulesWithChapters(subjectId, batchId),
        enabled: browsing && needsModules && Boolean(subjectId),
    });
    const modules: ModuleLike[] = useMemo(
        () =>
            ((modulesQuery.data as ModuleLike[] | undefined) ?? []).map((m) => ({
                ...m,
                chapters: (m.chapters ?? []).filter(isListedChapter),
            })),
        [modulesQuery.data]
    );
    const chapters = modules.find((m) => m.module.id === moduleId)?.chapters ?? [];

    if (!browsing && sourceId) {
        return (
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-body text-neutral-800">
                    <Flag size={16} className="shrink-0 text-primary-500" aria-hidden />
                    <span className="truncate">
                        <span className="font-semibold">
                            {t(`composer.relative.sourceType.${sourceType}`)}:
                        </span>{' '}
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

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <SelectBox
                label={t('composer.relative.sourceTypeLabel')}
                value={sourceType}
                onChange={(value) => {
                    onTypeChange(value as StartSourceType);
                    setModuleId('');
                }}
                options={SOURCE_TYPES.map((type) => ({
                    value: type,
                    label: t(`composer.relative.sourceType.${type}`),
                }))}
            />
            <SelectBox
                label={t('composer.relative.sourceType.SUBJECT')}
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
                        onPick(value, name);
                        setBrowsing(false);
                    }
                }}
                options={subjects.map((s) => ({ value: s.id, label: s.subject_name }))}
            />
            {needsModules && (
                <SelectBox
                    label={t('composer.relative.sourceType.MODULE')}
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
                            onPick(value, name);
                            setBrowsing(false);
                        }
                    }}
                    options={modules.map((m) => ({
                        value: m.module.id,
                        label: m.module.module_name ?? m.module.id,
                    }))}
                />
            )}
            {sourceType === 'CHAPTER' && (
                <SelectBox
                    label={t('composer.relative.sourceType.CHAPTER')}
                    value=""
                    placeholder={
                        !moduleId
                            ? t('composer.relative.moduleFirst')
                            : t('composer.relative.choose')
                    }
                    disabled={!moduleId || chapters.length === 0}
                    onChange={(value) => {
                        const chapter = chapters.find((c) => chapterIdOf(c) === value);
                        onPick(value, chapterNameOf(chapter) ?? '');
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
