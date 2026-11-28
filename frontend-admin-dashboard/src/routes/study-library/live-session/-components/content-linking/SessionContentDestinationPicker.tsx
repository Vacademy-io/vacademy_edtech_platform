// Track B — Teacher flow: "pick destination chapter(s) → Add" widget.
//
// A simplified sibling of AddToCourseDialog's cascade: course/session/level
// are already fixed per row (they come from the live class's linked batches),
// so only Subject → Module → Chapter remains — one row per batch. See
// docs/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md, "Track B".

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CircleNotch, MagicWand } from '@phosphor-icons/react';

import { MyButton } from '@/components/design-system/button';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { useStudyLibraryStore, type SubjectType } from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import {
    fetchModulesWithChapters,
    useModulesWithChaptersQuery,
} from '@/routes/study-library/courses/-services/getModulesWithChapters';
import type { ModulesWithChapters } from '@/stores/study-library/use-modules-with-chapters-store';

import type {
    ContentLinkDestination,
    ContentLinkPosition,
    SessionContentLink,
    SlideStatus,
} from '../../-services/content-link-service';

export interface DestinationBatch {
    packageSessionId: string;
    displayName: string;
}

export interface DestinationPickerSubmitPayload {
    destinations: ContentLinkDestination[];
    position: ContentLinkPosition;
    slideStatus: SlideStatus;
    notify: boolean;
}

interface Props {
    batches: DestinationBatch[];
    /** Prior links (any content type) — used only to preselect the most-recently-used chapter per batch. */
    existingLinks?: SessionContentLink[];
    /**
     * Seeds row state directly (subject/module/chapter per batch) instead of
     * relying on `existingLinks` inference — used for edit-mode prefill of a
     * previously-saved config (e.g. recording auto-link). Rows for batches
     * not present here start empty as usual.
     */
    initialDestinations?: ContentLinkDestination[];
    initialSlideStatus?: SlideStatus;
    initialNotify?: boolean;
    onSubmit?: (payload: DestinationPickerSubmitPayload) => void | Promise<void>;
    isSubmitting?: boolean;
    submitLabel?: string;
    /** Extra gate from the caller (e.g. an empty title) on top of "at least one destination chosen". */
    submitDisabled?: boolean;
    /** Hides the submit button — for callers that lift picker state via `onDestinationsChange` instead of an immediate "Add" action. */
    hideSubmit?: boolean;
    /** Hides the Position ("End of chapter"/"Beginning of chapter") control — irrelevant to callers whose backend hardcodes position. */
    hidePosition?: boolean;
    /** Hides the "Notify learners" switch — for the auto-upload flow, where notification is governed by the institute-level Live Session setting instead of per session. */
    hideNotify?: boolean;
    /** Hides the Published/Draft switch — for callers whose slides are always Published (e.g. the bulk auto-upload map). */
    hideStatus?: boolean;
    /** Fired whenever the selection (destinations/status/notify) changes — for callers lifting state into a parent form instead of using the built-in submit button. */
    onDestinationsChange?: (payload: DestinationPickerSubmitPayload) => void;
}

interface RowState {
    included: boolean;
    subjectId: string;
    moduleId: string;
    chapterId: string;
}

const emptyRow = (): RowState => ({ included: true, subjectId: '', moduleId: '', chapterId: '' });

const toOptions = <T,>(
    items: T[],
    value: (t: T) => string,
    label: (t: T) => string
): SearchableSelectOption[] => items.map((t) => ({ value: value(t), label: label(t) }));

/** Searches each subject's module tree (cached via React Query) for the module that owns `chapterId`. */
async function findSubjectModuleForChapter(
    queryClient: QueryClient,
    subjects: SubjectType[],
    packageSessionId: string,
    chapterId: string
): Promise<{ subjectId: string; moduleId: string } | null> {
    for (const subject of subjects) {
        try {
            const modules = await queryClient.fetchQuery<ModulesWithChapters[]>({
                queryKey: ['GET_MODULES_WITH_CHAPTERS', subject.id, packageSessionId],
                queryFn: () => fetchModulesWithChapters(subject.id, packageSessionId),
                staleTime: 3_600_000,
            });
            const owner = (modules ?? []).find((m) =>
                m.chapters?.some((c) => c.chapter.id === chapterId)
            );
            if (owner) return { subjectId: subject.id, moduleId: owner.module.id };
        } catch {
            // This subject's tree failed to load — try the next one.
        }
    }
    return null;
}

export function SessionContentDestinationPicker({
    batches,
    existingLinks,
    initialDestinations,
    initialSlideStatus,
    initialNotify,
    onSubmit,
    isSubmitting,
    submitLabel,
    submitDisabled,
    hideSubmit,
    hidePosition,
    hideNotify,
    hideStatus,
    onDestinationsChange,
}: Props) {
    const { t } = useTranslation('studyLibrarySessionContentDestinationPicker');
    const queryClient = useQueryClient();
    const studyLibraryData = useStudyLibraryStore((s) => s.studyLibraryData);
    const getDetailsFromPackageSessionId = useInstituteDetailsStore(
        (s) => s.getDetailsFromPackageSessionId
    );

    // Ensure the institute's course tree is loaded (no-op if already cached).
    const studyLibraryQueryConfig = useStudyLibraryQuery();
    const studyLibraryQuery = useQuery(studyLibraryQueryConfig);
    const subjectsLoading = studyLibraryQuery.isLoading;

    const [rows, setRows] = useState<Record<string, RowState>>({});
    const [position, setPosition] = useState<ContentLinkPosition>('BOTTOM');
    const [slideStatus, setSlideStatus] = useState<SlideStatus>(initialSlideStatus ?? 'PUBLISHED');
    const [notify, setNotify] = useState(initialNotify ?? false);

    // Keep a row per batch, preserving any state a batch already has. New
    // batches seed from `initialDestinations` (edit-mode prefill) when present.
    useEffect(() => {
        setRows((prev) => {
            const next: Record<string, RowState> = {};
            for (const b of batches) {
                if (prev[b.packageSessionId]) {
                    next[b.packageSessionId] = prev[b.packageSessionId]!;
                    continue;
                }
                const seed = initialDestinations?.find(
                    (d) => d.package_session_id === b.packageSessionId
                );
                next[b.packageSessionId] = seed
                    ? {
                          included: true,
                          subjectId: seed.subject_id ?? '',
                          moduleId: seed.module_id ?? '',
                          chapterId: seed.chapter_id,
                      }
                    : emptyRow();
            }
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batches]);

    // Subjects available for each batch's fixed course/session/level.
    const subjectsByBatch = useMemo(() => {
        const map = new Map<string, SubjectType[]>();
        for (const b of batches) {
            const details = getDetailsFromPackageSessionId({ packageSessionId: b.packageSessionId });
            const courseId = details?.package_dto?.id;
            const sessionId = details?.session?.id;
            const levelId = details?.level?.id;
            const course = studyLibraryData?.find((c) => c.course.id === courseId);
            const session = course?.sessions.find((s) => s.session_dto.id === sessionId);
            const level = session?.level_with_details.find((l) => l.id === levelId);
            map.set(b.packageSessionId, level?.subjects ?? []);
        }
        return map;
    }, [batches, studyLibraryData, getDetailsFromPackageSessionId]);

    const updateRow = useCallback((packageSessionId: string, patch: Partial<RowState>) => {
        setRows((prev) => ({
            ...prev,
            [packageSessionId]: { ...(prev[packageSessionId] ?? emptyRow()), ...patch },
        }));
    }, []);

    // Preselect the most-recently-used chapter per batch, resolved from existingLinks.
    const preselectAttempted = useRef<Set<string>>(new Set());
    useEffect(() => {
        batches.forEach((b) => {
            if (preselectAttempted.current.has(b.packageSessionId)) return;
            const subjects = subjectsByBatch.get(b.packageSessionId) ?? [];
            if (subjects.length === 0) return; // wait until the subject tree resolves
            const row = rows[b.packageSessionId];
            if (!row || row.chapterId) return; // nothing to do, or already resolved/user-picked

            const linksForBatch = (existingLinks ?? []).filter(
                (l) => l.package_session_id === b.packageSessionId
            );
            const mostRecent = [...linksForBatch].sort(
                (a, c) => new Date(c.created_at).getTime() - new Date(a.created_at).getTime()
            )[0];
            preselectAttempted.current.add(b.packageSessionId);
            if (!mostRecent) return;

            findSubjectModuleForChapter(queryClient, subjects, b.packageSessionId, mostRecent.chapter_id)
                .then((found) => {
                    if (!found) return;
                    setRows((prev) => {
                        const current = prev[b.packageSessionId];
                        if (!current || current.chapterId) return prev;
                        return {
                            ...prev,
                            [b.packageSessionId]: {
                                ...current,
                                subjectId: found.subjectId,
                                moduleId: found.moduleId,
                                chapterId: mostRecent.chapter_id,
                            },
                        };
                    });
                })
                .catch(() => {});
        });
    }, [batches, subjectsByBatch, existingLinks, rows, queryClient]);

    // "Apply to all batches" — best-effort name-match copy from the first configured row.
    const applyToAll = async () => {
        const sourceBatch = batches.find((b) => rows[b.packageSessionId]?.chapterId);
        if (!sourceBatch) return;
        const sourceRow = rows[sourceBatch.packageSessionId]!;
        const sourceSubjects = subjectsByBatch.get(sourceBatch.packageSessionId) ?? [];
        const sourceSubject = sourceSubjects.find((s) => s.id === sourceRow.subjectId);
        if (!sourceSubject) return;
        const sourceModules =
            queryClient.getQueryData<ModulesWithChapters[]>([
                'GET_MODULES_WITH_CHAPTERS',
                sourceRow.subjectId,
                sourceBatch.packageSessionId,
            ]) ?? [];
        const sourceModule = sourceModules.find((m) => m.module.id === sourceRow.moduleId);
        if (!sourceModule) return;
        const sourceChapter = sourceModule.chapters.find(
            (c) => c.chapter.id === sourceRow.chapterId
        );
        if (!sourceChapter) return;

        for (const target of batches) {
            if (target.packageSessionId === sourceBatch.packageSessionId) continue;
            const targetSubjects = subjectsByBatch.get(target.packageSessionId) ?? [];
            const targetSubject = targetSubjects.find(
                (s) => s.subject_name === sourceSubject.subject_name
            );
            if (!targetSubject) continue; // no matching subject name — skip silently
            try {
                const targetModules = await queryClient.fetchQuery<ModulesWithChapters[]>({
                    queryKey: ['GET_MODULES_WITH_CHAPTERS', targetSubject.id, target.packageSessionId],
                    queryFn: () => fetchModulesWithChapters(targetSubject.id, target.packageSessionId),
                    staleTime: 3_600_000,
                });
                const targetModule = targetModules.find(
                    (m) => m.module.module_name === sourceModule.module.module_name
                );
                if (!targetModule) continue;
                const targetChapter = targetModule.chapters.find(
                    (c) => c.chapter.chapter_name === sourceChapter.chapter.chapter_name
                );
                if (!targetChapter) continue;
                updateRow(target.packageSessionId, {
                    subjectId: targetSubject.id,
                    moduleId: targetModule.module.id,
                    chapterId: targetChapter.chapter.id,
                });
            } catch {
                // Skip this batch — no matching tree loaded.
            }
        }
    };

    const destinations = useMemo<ContentLinkDestination[]>(
        () =>
            batches
                .filter((b) => rows[b.packageSessionId]?.included && rows[b.packageSessionId]?.chapterId)
                .map((b) => {
                    const row = rows[b.packageSessionId]!;
                    return {
                        package_session_id: b.packageSessionId,
                        chapter_id: row.chapterId,
                        module_id: row.moduleId,
                        subject_id: row.subjectId,
                    };
                }),
        [batches, rows]
    );

    const canSubmit = destinations.length > 0 && !submitDisabled && !isSubmitting;

    const handleSubmit = async () => {
        if (!canSubmit || !onSubmit) return;
        await onSubmit({ destinations, position, slideStatus, notify });
    };

    // Lifted-state mode: report every selection change to the parent instead
    // of (or in addition to) an explicit submit action.
    useEffect(() => {
        onDestinationsChange?.({ destinations, position, slideStatus, notify });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [destinations, position, slideStatus, notify]);

    return (
        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
                <span className="text-body font-semibold text-neutral-700">
                    {t('addToBatches', { count: destinations.length })}
                </span>
                {batches.length > 1 && (
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={applyToAll}
                        disable={!batches.some((b) => rows[b.packageSessionId]?.chapterId)}
                    >
                        <MagicWand className="mr-1 size-3.5" />
                        {t('applyToAllBatches')}
                    </MyButton>
                )}
            </div>

            <div className="flex flex-col gap-3">
                {batches.map((b) => (
                    <DestinationRow
                        key={b.packageSessionId}
                        batch={b}
                        subjects={subjectsByBatch.get(b.packageSessionId) ?? []}
                        subjectsLoading={subjectsLoading}
                        row={rows[b.packageSessionId] ?? emptyRow()}
                        onPatch={(patch) => updateRow(b.packageSessionId, patch)}
                    />
                ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-neutral-100 pt-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                <div className="flex flex-wrap items-end gap-4">
                    {!hidePosition && (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-caption font-medium text-neutral-600">
                                {t('position.label')}
                            </span>
                            <Select
                                value={position}
                                onValueChange={(v) => setPosition(v as ContentLinkPosition)}
                            >
                                <SelectTrigger className="w-44">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="BOTTOM">{t('position.endOfChapter')}</SelectItem>
                                    <SelectItem value="TOP">{t('position.beginningOfChapter')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {!hideStatus && (
                        <label className="flex flex-col gap-1.5">
                            <span className="text-caption font-medium text-neutral-600">
                                {t('status.label')}
                            </span>
                            <span className="flex items-center gap-2">
                                <Switch
                                    checked={slideStatus === 'PUBLISHED'}
                                    onCheckedChange={(v) =>
                                        setSlideStatus(v ? 'PUBLISHED' : 'DRAFT')
                                    }
                                />
                                <span className="text-body text-neutral-700">
                                    {slideStatus === 'PUBLISHED'
                                        ? t('status.published')
                                        : t('status.draft')}
                                </span>
                            </span>
                        </label>
                    )}

                    {!hideNotify && (
                        <label className="flex flex-col gap-1.5">
                            <span className="text-caption font-medium text-neutral-600">
                                {t('notifyLearners.label')}
                            </span>
                            <span className="flex items-center gap-2">
                                <Switch checked={notify} onCheckedChange={setNotify} />
                                <span className="text-body text-neutral-700">
                                    {notify ? t('notifyLearners.on') : t('notifyLearners.off')}
                                </span>
                            </span>
                        </label>
                    )}
                </div>

                {!hideSubmit && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!canSubmit}
                        onClick={handleSubmit}
                    >
                        {isSubmitting ? t('actions.adding') : submitLabel ?? t('actions.add')}
                    </MyButton>
                )}
            </div>
        </div>
    );
}

function DestinationRow({
    batch,
    subjects,
    subjectsLoading,
    row,
    onPatch,
}: {
    batch: DestinationBatch;
    subjects: SubjectType[];
    subjectsLoading?: boolean;
    row: RowState;
    onPatch: (patch: Partial<RowState>) => void;
}) {
    const { t } = useTranslation('studyLibrarySessionContentDestinationPicker');
    const modulesQuery = useModulesWithChaptersQuery(row.subjectId, batch.packageSessionId);
    const modules = (modulesQuery.data as ModulesWithChapters[] | undefined) ?? [];
    const selectedModule = modules.find((m) => m.module.id === row.moduleId) ?? null;
    const chapters = selectedModule?.chapters ?? [];

    // Auto-pick a level once it has exactly one option (single-option levels are
    // shown as a fixed label below rather than a dropdown).
    useEffect(() => {
        if (!row.subjectId && subjects.length === 1) {
            onPatch({ subjectId: subjects[0]!.id, moduleId: '', chapterId: '' });
            return;
        }
        if (row.subjectId && !row.moduleId && modules.length === 1) {
            onPatch({ moduleId: modules[0]!.module.id, chapterId: '' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subjects.length, modules.length, row.subjectId, row.moduleId]);

    const showSubjectSelect = subjects.length > 1;
    const showModuleSelect = modules.length > 1;
    // Shallow (non-5-depth) courses collapse skipped levels into a single
    // "DEFAULT" placeholder — hide those cells entirely (as AddToCourseDialog
    // does) instead of showing a fixed label reading "DEFAULT".
    const hideSubjectCell =
        subjects.length === 1 && subjects[0]!.subject_name.trim().toUpperCase() === 'DEFAULT';
    const hideModuleCell =
        modules.length === 1 &&
        modules[0]!.module.module_name.trim().toUpperCase() === 'DEFAULT';

    return (
        <div
            className={cn(
                'flex flex-col gap-2 rounded-md border border-neutral-100 bg-neutral-50/50 p-3 transition-opacity',
                !row.included && 'opacity-50'
            )}
        >
            <label className="flex items-center gap-2">
                <Checkbox
                    checked={row.included}
                    onCheckedChange={(v) => onPatch({ included: v === true })}
                />
                <span className="min-w-0 truncate text-body font-medium text-neutral-700">
                    {batch.displayName}
                </span>
            </label>

            {row.included && (
                <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-3">
                    {!hideSubjectCell && (
                        <FixedOrSelect
                            label={t('fields.subject')}
                            show={showSubjectSelect}
                            fixedLabel={subjects.length === 1 ? subjects[0]!.subject_name : '—'}
                            value={row.subjectId}
                            onChange={(v) => onPatch({ subjectId: v, moduleId: '', chapterId: '' })}
                            options={toOptions(
                                subjects,
                                (s) => s.id,
                                (s) => s.subject_name
                            )}
                            disabled={subjects.length === 0}
                            loading={subjectsLoading && subjects.length === 0}
                        />
                    )}
                    {!hideModuleCell && (
                        <FixedOrSelect
                            label={t('fields.module')}
                            show={showModuleSelect}
                            fixedLabel={modules.length === 1 ? modules[0]!.module.module_name : '—'}
                            value={row.moduleId}
                            onChange={(v) => onPatch({ moduleId: v, chapterId: '' })}
                            options={toOptions(
                                modules,
                                (m) => m.module.id,
                                (m) => m.module.module_name
                            )}
                            disabled={!row.subjectId || modulesQuery.isLoading}
                            loading={!!row.subjectId && modulesQuery.isLoading}
                        />
                    )}
                    <FixedOrSelect
                        label={t('fields.chapter')}
                        show
                        fixedLabel="—"
                        value={row.chapterId}
                        onChange={(v) => onPatch({ chapterId: v })}
                        options={toOptions(
                            chapters,
                            (c) => c.chapter.id,
                            (c) => c.chapter.chapter_name
                        )}
                        disabled={!row.moduleId}
                        loading={!!row.moduleId && modulesQuery.isLoading}
                    />
                </div>
            )}
        </div>
    );
}

/** Renders a static label when there's ≤1 option, else a searchable dropdown. */
function FixedOrSelect({
    label,
    show,
    fixedLabel,
    value,
    onChange,
    options,
    disabled,
    loading,
}: {
    label: string;
    show: boolean;
    fixedLabel: string;
    value: string;
    onChange: (v: string) => void;
    options: SearchableSelectOption[];
    disabled?: boolean;
    /** Options are being fetched — show a spinner placeholder instead of an empty control. */
    loading?: boolean;
}) {
    const { t } = useTranslation('studyLibrarySessionContentDestinationPicker');
    if (loading) {
        return (
            <div className="flex flex-col gap-1">
                <span className="text-caption text-neutral-500">{label}</span>
                <span className="flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-body text-neutral-400">
                    <CircleNotch className="size-4 animate-spin" />
                    {t('fixedOrSelect.loading', { label })}
                </span>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-1">
            <span className="text-caption text-neutral-500">{label}</span>
            {show ? (
                <SearchableSelect
                    options={options}
                    value={value}
                    onChange={onChange}
                    placeholder={t('fixedOrSelect.select', { label })}
                    searchPlaceholder={t('fixedOrSelect.search', { label })}
                    emptyText={t('fixedOrSelect.noMatches')}
                    disabled={disabled}
                />
            ) : (
                <span className="flex h-9 items-center truncate rounded-md border border-neutral-200 bg-white px-3 text-body text-neutral-600">
                    {options.find((o) => o.value === value)?.label ?? fixedLabel}
                </span>
            )}
        </div>
    );
}
