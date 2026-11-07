// Destination picker for "Copy to" / "Move to" (slides and chapters).
//
// Replaces the old StudyMaterialDetailsForm cascade, which asked for
// Course → Session → Level → Subject → Module → Chapter unconditionally. That is
// wrong for shallow courses: a `course_depth` 4 course has no real Subject (only
// a hidden "DEFAULT" one), depth 3 has neither Subject nor Module, and depth 2 is
// flat. The old form also read subjects from the global study-library store,
// which on a course-details route holds ONLY the currently-open course — so
// picking any other course left Subject (and everything under it) empty.
//
// This picker fetches the institute-wide study library itself and reveals only
// the levels the target course's depth actually exposes, auto-resolving the
// hidden DEFAULT entities. It also supports multiple destinations: the leaf
// (Chapter, or Module when moving a chapter) is multi-select, and
// "Add another course" stacks destinations across courses.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleNotch, Plus, Trash } from '@phosphor-icons/react';

import { MyButton } from '@/components/design-system/button';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { MultiSelect } from '@/components/design-system/multi-select';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    useStudyLibraryStore,
    type CourseWithSessionsType,
} from '@/stores/study-library/use-study-library-store';
import { fetchStudyLibraryDetails } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { fetchModulesWithChapters } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import type { ModulesWithChapters } from '@/stores/study-library/use-modules-with-chapters-store';

/** One resolved place to copy/move into. */
export interface CopyMoveDestination {
    /** Unique per (leaf entity, batch) — used for dedupe and list keys. */
    key: string;
    packageSessionId: string;
    courseId: string;
    courseName: string;
    subjectId: string;
    moduleId: string;
    /** Empty when the picker's leaf is a module (chapter copy/move). */
    chapterId: string;
    /** Human-readable trail, e.g. "Physics › Kinematics › Chapter 1". */
    label: string;
}

/** Where the copy lands in the destination chapter, and whether learners see it. */
export interface CopyMovePlacement {
    position: 'TOP' | 'BOTTOM';
    slideStatus: 'PUBLISHED' | 'DRAFT';
}

const DEFAULT_PLACEMENT: CopyMovePlacement = { position: 'BOTTOM', slideStatus: 'PUBLISHED' };

interface Props {
    /** Deepest level the caller needs: a chapter for slides, a module for chapters. */
    leaf: 'chapter' | 'module';
    /** Show the position / published-or-draft controls (slide flows only). */
    showPlacementOptions?: boolean;
    submitLabel: string;
    /** Label while the mutations run, e.g. "Copying…". */
    busyLabel?: string;
    isSubmitting?: boolean;
    /**
     * Runs the copy/move. Resolving with an array narrows the picker down to
     * exactly those destinations — callers return the ones that failed so a
     * retry can't duplicate content into the places that already succeeded.
     * Resolve with nothing when the dialog is about to close.
     */
    onSubmit: (
        destinations: CopyMoveDestination[],
        placement: CopyMovePlacement
    ) => void | Promise<void | CopyMoveDestination[]>;
    /** Extra caption under the destination list (e.g. what "move" to many places means). */
    multiHint?: string;
}

interface Cascade {
    courseId: string;
    sessionId: string;
    levelId: string;
    subjectId: string;
    moduleId: string;
}

const EMPTY_CASCADE: Cascade = {
    courseId: '',
    sessionId: '',
    levelId: '',
    subjectId: '',
    moduleId: '',
};

/** Shallow courses collapse the levels they skip into a placeholder named "DEFAULT". */
const isDefaultName = (name: string | undefined) => (name ?? '').trim().toUpperCase() === 'DEFAULT';

const toOptions = <T,>(
    items: T[],
    value: (t: T) => string,
    label: (t: T) => string
): SearchableSelectOption[] => items.map((t) => ({ value: value(t), label: label(t) }));

/**
 * Picks the entity for a level the user should not have to choose:
 * the only option, or — when the course's depth hides this level — the DEFAULT one.
 * Returns undefined when the choice is genuinely ambiguous, so the caller shows the field.
 */
const resolveHidden = <T,>(
    hiddenByDepth: boolean,
    items: T[],
    name: (t: T) => string
): T | undefined => {
    if (items.length === 1) return items[0];
    if (!hiddenByDepth) return undefined;
    return items.find((item) => isDefaultName(name(item)));
};

/** Names of levels the course doesn't expose are noise in the destination trail. */
const buildLabel = (parts: Array<string | undefined>) =>
    parts.filter((p) => p && !isDefaultName(p)).join(' › ');

export const CopyMoveDestinationPicker = ({
    leaf,
    showPlacementOptions,
    submitLabel,
    busyLabel,
    isSubmitting,
    onSubmit,
    multiHint,
}: Props) => {
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);
    const subjectTerm = getTerminology(ContentTerms.Subject, SystemTerms.Subject);
    const moduleTerm = getTerminology(ContentTerms.Module, SystemTerms.Module);
    const chapterTerm = getTerminology(ContentTerms.Chapter, SystemTerms.Chapter);
    const leafTerm = leaf === 'chapter' ? chapterTerm : moduleTerm;

    const getPackageSessionId = useInstituteDetailsStore((s) => s.getPackageSessionId);
    const storeLibrary = useStudyLibraryStore((s) => s.studyLibraryData);

    const [sel, setSel] = useState<Cascade>(EMPTY_CASCADE);
    const [leafIds, setLeafIds] = useState<string[]>([]);
    const [added, setAdded] = useState<CopyMoveDestination[]>([]);
    const [placement, setPlacement] = useState<CopyMovePlacement>(DEFAULT_PLACEMENT);

    // Institute-wide library, fetched under its own key so the page's
    // course-scoped `studyLibraryData` (and the breadcrumbs reading it) is left
    // untouched while this dialog is open.
    const libraryQuery = useQuery<CourseWithSessionsType[]>({
        queryKey: ['COPY_MOVE_STUDY_LIBRARY'],
        queryFn: fetchStudyLibraryDetails,
        staleTime: 5 * 60 * 1000,
    });
    const courses = useMemo<CourseWithSessionsType[]>(
        () => (libraryQuery.data?.length ? libraryQuery.data : (storeLibrary ?? [])),
        [libraryQuery.data, storeLibrary]
    );

    const selectedCourse = courses.find((c) => c.course.id === sel.courseId) ?? null;
    const depth = selectedCourse?.course.course_depth ?? null;
    const sessions = selectedCourse?.sessions ?? [];
    const selectedSession = sessions.find((s) => s.session_dto.id === sel.sessionId) ?? null;
    const levels = selectedSession?.level_with_details ?? [];
    const selectedLevel = levels.find((l) => l.id === sel.levelId) ?? null;
    const subjects = selectedLevel?.subjects ?? [];

    const packageSessionId = useMemo(() => {
        if (!sel.courseId || !sel.sessionId || !sel.levelId) return null;
        const fromInstitute = getPackageSessionId({
            courseId: sel.courseId,
            sessionId: sel.sessionId,
            levelId: sel.levelId,
        });
        if (fromInstitute) return fromInstitute;
        return (
            selectedCourse?.package_sessions?.find(
                (ps) => ps.level.id === sel.levelId && ps.session.id === sel.sessionId
            )?.id ?? null
        );
    }, [sel.courseId, sel.sessionId, sel.levelId, getPackageSessionId, selectedCourse]);

    const modulesQuery = useQuery<ModulesWithChapters[]>({
        queryKey: ['COPY_MOVE_MODULES_WITH_CHAPTERS', sel.subjectId, packageSessionId],
        queryFn: () => fetchModulesWithChapters(sel.subjectId, packageSessionId ?? ''),
        enabled: !!sel.subjectId && !!packageSessionId,
        staleTime: 5 * 60 * 1000,
    });
    const modules = useMemo(() => modulesQuery.data ?? [], [modulesQuery.data]);
    const selectedModule = modules.find((m) => m.module.id === sel.moduleId) ?? null;
    const chapters = selectedModule?.chapters ?? [];

    // Which structural levels this course actually exposes. depth 5 = the full
    // Subject → Module → Chapter tree, 4 drops Subject, 3 also drops Module,
    // 2 is flat (slides sit in a DEFAULT chapter).
    const subjectHiddenByDepth = depth != null && depth < 5;
    const moduleHiddenByDepth = depth != null && depth < 4;
    const chapterHiddenByDepth = depth != null && depth < 3;

    const resolvedSubject = useMemo(
        () => resolveHidden(subjectHiddenByDepth, subjects, (s) => s.subject_name),
        [subjectHiddenByDepth, subjects]
    );
    // As an ancestor (slide flows) a single module is auto-picked; as the leaf
    // (chapter flows) it stays visible unless the course's depth hides it.
    const resolvedModule = useMemo(
        () =>
            leaf === 'chapter'
                ? resolveHidden(moduleHiddenByDepth, modules, (m) => m.module.module_name)
                : moduleHiddenByDepth
                  ? (modules.find((m) => isDefaultName(m.module.module_name)) ??
                    (modules.length === 1 ? modules[0] : undefined))
                  : undefined,
        [leaf, moduleHiddenByDepth, modules]
    );
    const resolvedChapter = useMemo(
        () =>
            leaf === 'chapter' && chapterHiddenByDepth
                ? (chapters.find((c) => isDefaultName(c.chapter.chapter_name)) ??
                  (chapters.length === 1 ? chapters[0] : undefined))
                : undefined,
        [leaf, chapterHiddenByDepth, chapters]
    );

    // Hidden only when there is exactly one option (auto-picked below). A course
    // with none stays visible and empty rather than dead-ending the cascade.
    const showSession = !!sel.courseId && sessions.length !== 1;
    const showLevel = !!sel.sessionId && levels.length !== 1;
    // Gated on the level: until a batch is picked there is no subject list to
    // judge, and a field that appears only to vanish once it resolves is noise.
    const showSubject = !!sel.levelId && !resolvedSubject;
    const showModuleField = leaf === 'chapter' && !!sel.subjectId && !resolvedModule;
    const showLeafField = leaf === 'chapter' ? !resolvedChapter : !resolvedModule;

    // A level with exactly one option is auto-picked rather than asked for — but
    // it still gets a read-only row so the destination is never a mystery (a
    // subject with a single module used to jump straight to Chapter with no sign
    // of which module was chosen). Only the DEFAULT placeholders that shallow
    // courses collapse into stay hidden: naming them would confuse, not inform.
    const fixedSubjectName =
        !showSubject && resolvedSubject && !isDefaultName(resolvedSubject.subject_name)
            ? resolvedSubject.subject_name
            : null;
    const fixedModuleName =
        leaf === 'chapter' &&
        !showModuleField &&
        resolvedModule &&
        !isDefaultName(resolvedModule.module.module_name)
            ? resolvedModule.module.module_name
            : null;

    // Auto-advance through every level the user doesn't need to choose.
    useEffect(() => {
        if (!sel.courseId) return;
        if (!sel.sessionId) {
            const only = sessions.length === 1 ? sessions[0] : undefined;
            if (only)
                setSel((s) => ({
                    ...s,
                    sessionId: only.session_dto.id,
                    levelId: '',
                    subjectId: '',
                    moduleId: '',
                }));
            return;
        }
        if (!sel.levelId) {
            const only = levels.length === 1 ? levels[0] : undefined;
            if (only) setSel((s) => ({ ...s, levelId: only.id, subjectId: '', moduleId: '' }));
            return;
        }
        if (!sel.subjectId) {
            if (resolvedSubject)
                setSel((s) => ({ ...s, subjectId: resolvedSubject.id, moduleId: '' }));
            return;
        }
        if (leaf === 'chapter' && !sel.moduleId && resolvedModule) {
            setSel((s) => ({ ...s, moduleId: resolvedModule.module.id }));
        }
    }, [sel, sessions, levels, resolvedSubject, resolvedModule, leaf]);

    // Leaf levels the course's depth hides (a flat course's DEFAULT chapter, a
    // depth-3 course's DEFAULT module) are selected for the user.
    useEffect(() => {
        if (leaf === 'chapter' && resolvedChapter) {
            setLeafIds([resolvedChapter.chapter.id]);
        } else if (leaf === 'module' && resolvedModule) {
            setLeafIds([resolvedModule.module.id]);
        }
    }, [leaf, resolvedChapter, resolvedModule]);

    const setCourse = (courseId: string) => {
        setSel({ ...EMPTY_CASCADE, courseId });
        setLeafIds([]);
    };
    const setSession = (sessionId: string) => {
        setSel((s) => ({ ...s, sessionId, levelId: '', subjectId: '', moduleId: '' }));
        setLeafIds([]);
    };
    const setLevel = (levelId: string) => {
        setSel((s) => ({ ...s, levelId, subjectId: '', moduleId: '' }));
        setLeafIds([]);
    };
    const setSubject = (subjectId: string) => {
        setSel((s) => ({ ...s, subjectId, moduleId: '' }));
        setLeafIds([]);
    };
    const setModule = (moduleId: string) => {
        setSel((s) => ({ ...s, moduleId }));
        setLeafIds([]);
    };

    const currentDestinations = useMemo<CopyMoveDestination[]>(() => {
        if (!packageSessionId || !sel.subjectId || leafIds.length === 0) return [];
        const courseName = selectedCourse?.course.package_name ?? courseTerm;
        const batchTrail = [
            showSession ? selectedSession?.session_dto.session_name : undefined,
            showLevel ? selectedLevel?.name : undefined,
        ];
        const subjectName = subjects.find((s) => s.id === sel.subjectId)?.subject_name;

        if (leaf === 'module') {
            return leafIds.flatMap((moduleId) => {
                const moduleEntry = modules.find((m) => m.module.id === moduleId);
                if (!moduleEntry) return [];
                return [
                    {
                        key: `${moduleId}::${packageSessionId}`,
                        packageSessionId,
                        courseId: sel.courseId,
                        courseName,
                        subjectId: sel.subjectId,
                        moduleId,
                        chapterId: '',
                        label: buildLabel([
                            courseName,
                            ...batchTrail,
                            subjectName,
                            moduleEntry.module.module_name,
                        ]),
                    },
                ];
            });
        }

        if (!sel.moduleId) return [];
        return leafIds.flatMap((chapterId) => {
            const chapterEntry = chapters.find((c) => c.chapter.id === chapterId);
            if (!chapterEntry) return [];
            return [
                {
                    key: `${chapterId}::${packageSessionId}`,
                    packageSessionId,
                    courseId: sel.courseId,
                    courseName,
                    subjectId: sel.subjectId,
                    moduleId: sel.moduleId,
                    chapterId,
                    label: buildLabel([
                        courseName,
                        ...batchTrail,
                        subjectName,
                        selectedModule?.module.module_name,
                        chapterEntry.chapter.chapter_name,
                    ]),
                },
            ];
        });
    }, [
        packageSessionId,
        sel,
        leafIds,
        leaf,
        selectedCourse,
        selectedSession,
        selectedLevel,
        showSession,
        showLevel,
        subjects,
        modules,
        chapters,
        selectedModule,
        courseTerm,
    ]);

    const combined = useMemo<CopyMoveDestination[]>(() => {
        const all = [...currentDestinations, ...added];
        return all.filter((d, i) => all.findIndex((x) => x.key === d.key) === i);
    }, [currentDestinations, added]);

    const addCurrentAndReset = () => {
        if (currentDestinations.length === 0) return;
        setAdded((prev) => {
            const next = [...prev];
            currentDestinations.forEach((d) => {
                if (!next.some((x) => x.key === d.key)) next.push(d);
            });
            return next;
        });
        setSel(EMPTY_CASCADE);
        setLeafIds([]);
    };

    const removeDestination = (key: string) =>
        setAdded((prev) => prev.filter((d) => d.key !== key));

    const canSubmit = combined.length > 0 && !isSubmitting;

    const handleSubmit = async () => {
        const retryable = await onSubmit(combined, placement);
        // Partial failure: keep only what didn't land, so pressing the button
        // again doesn't copy a second time into the destinations that worked.
        if (Array.isArray(retryable) && retryable.length > 0) {
            setAdded(retryable);
            setSel(EMPTY_CASCADE);
            setLeafIds([]);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            {/* Two columns from sm up so the cascade stays short enough to fit
                without scrolling; single column on phones. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CascadeField
                    label={courseTerm}
                    placeholder={
                        libraryQuery.isLoading ? 'Loading…' : `Select ${courseTerm.toLowerCase()}`
                    }
                    value={sel.courseId}
                    onChange={setCourse}
                    disabled={libraryQuery.isLoading || courses.length === 0}
                    options={toOptions(
                        courses,
                        (c) => c.course.id,
                        (c) => c.course.package_name
                    )}
                />

                {!libraryQuery.isLoading && courses.length === 0 && (
                    <p className="text-caption text-danger-600 sm:col-span-2">
                        Couldn&apos;t load {courseTerm.toLowerCase()}s. Close this dialog and try
                        again.
                    </p>
                )}

                {showSession && (
                    <CascadeField
                        label={sessionTerm}
                        placeholder={`Select ${sessionTerm.toLowerCase()}`}
                        value={sel.sessionId}
                        onChange={setSession}
                        options={toOptions(
                            sessions,
                            (s) => s.session_dto.id,
                            (s) => s.session_dto.session_name
                        )}
                    />
                )}

                {showLevel && (
                    <CascadeField
                        label={levelTerm}
                        placeholder={`Select ${levelTerm.toLowerCase()}`}
                        value={sel.levelId}
                        onChange={setLevel}
                        disabled={!sel.sessionId}
                        options={toOptions(
                            levels,
                            (l) => l.id,
                            (l) => l.name
                        )}
                    />
                )}

                {showSubject && (
                    <CascadeField
                        label={subjectTerm}
                        placeholder={`Select ${subjectTerm.toLowerCase()}`}
                        value={sel.subjectId}
                        onChange={setSubject}
                        disabled={!sel.levelId}
                        options={toOptions(
                            subjects,
                            (s) => s.id,
                            (s) => s.subject_name
                        )}
                    />
                )}

                {fixedSubjectName && <FixedField label={subjectTerm} value={fixedSubjectName} />}

                {fixedModuleName && <FixedField label={moduleTerm} value={fixedModuleName} />}

                {showModuleField && (
                    <CascadeField
                        label={moduleTerm}
                        placeholder={
                            modulesQuery.isLoading
                                ? 'Loading…'
                                : `Select ${moduleTerm.toLowerCase()}`
                        }
                        value={sel.moduleId}
                        onChange={setModule}
                        disabled={!sel.subjectId || modulesQuery.isLoading}
                        options={toOptions(
                            modules,
                            (m) => m.module.id,
                            (m) => m.module.module_name
                        )}
                    />
                )}

                {showLeafField && (
                    <div className="flex w-full flex-col gap-1.5 sm:col-span-2">
                        <label className="text-body font-medium text-neutral-600">
                            {leafTerm}
                            <span className="text-danger-600">*</span>
                            <span className="ml-1 text-caption font-normal text-neutral-400">
                                (select one or more)
                            </span>
                        </label>
                        {modulesQuery.isLoading && sel.subjectId ? (
                            <span className="flex h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-body text-neutral-400">
                                <CircleNotch className="size-4 animate-spin" />
                                Loading {leafTerm.toLowerCase()}s…
                            </span>
                        ) : (
                            <MultiSelect
                                options={
                                    leaf === 'chapter'
                                        ? chapters.map((c) => ({
                                              value: c.chapter.id,
                                              label: c.chapter.chapter_name,
                                          }))
                                        : modules.map((m) => ({
                                              value: m.module.id,
                                              label: m.module.module_name,
                                          }))
                                }
                                selected={leafIds}
                                onChange={setLeafIds}
                                placeholder={`Select ${leafTerm.toLowerCase()}(s)`}
                                disabled={leaf === 'chapter' ? !sel.moduleId : !sel.subjectId}
                                // See CascadeField: inline so the list scrolls inside the dialog.
                                portal={false}
                            />
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-body font-semibold text-neutral-700">
                        {combined.length > 0
                            ? `${submitLabel} to ${combined.length} ${
                                  combined.length === 1 ? 'location' : 'locations'
                              }`
                            : `Select a ${leafTerm.toLowerCase()} above`}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={currentDestinations.length === 0}
                        onClick={addCurrentAndReset}
                    >
                        <Plus className="mr-1 size-3.5" />
                        Add another {courseTerm.toLowerCase()}
                    </MyButton>
                </div>

                {combined.length > 0 && (
                    <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                        {combined.map((d) => {
                            const isAdded = added.some((x) => x.key === d.key);
                            return (
                                <div
                                    key={d.key}
                                    className="flex items-center justify-between gap-2 rounded-md border border-primary-100 bg-primary-50/40 px-3 py-1.5"
                                >
                                    <span className="min-w-0 truncate text-body text-neutral-700">
                                        {d.label}
                                    </span>
                                    {isAdded ? (
                                        <button
                                            type="button"
                                            onClick={() => removeDestination(d.key)}
                                            className="shrink-0 text-neutral-400 transition-colors hover:text-danger-600"
                                            aria-label="Remove destination"
                                        >
                                            <Trash className="size-4" />
                                        </button>
                                    ) : (
                                        <span className="shrink-0 text-caption text-neutral-400">
                                            from selection
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {multiHint && combined.length > 1 && (
                    <p className="text-caption text-neutral-500">{multiHint}</p>
                )}
            </div>

            {showPlacementOptions && (
                <div className="flex flex-col gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:flex-wrap sm:gap-6">
                    <ChoiceRow
                        label="Position"
                        value={placement.position}
                        options={[
                            {
                                value: 'BOTTOM',
                                label: `End of ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()}`,
                            },
                            { value: 'TOP', label: 'Beginning' },
                        ]}
                        onChange={(position) =>
                            setPlacement((p) => ({
                                ...p,
                                position: position as CopyMovePlacement['position'],
                            }))
                        }
                    />
                    <ChoiceRow
                        label="Save as"
                        value={placement.slideStatus}
                        options={[
                            { value: 'PUBLISHED', label: 'Published' },
                            { value: 'DRAFT', label: 'Draft' },
                        ]}
                        onChange={(slideStatus) =>
                            setPlacement((p) => ({
                                ...p,
                                slideStatus: slideStatus as CopyMovePlacement['slideStatus'],
                            }))
                        }
                    />
                </div>
            )}

            <MyButton
                type="button"
                buttonType="primary"
                layoutVariant="default"
                scale="large"
                className="w-full"
                disable={!canSubmit}
                onClick={() => void handleSubmit()}
            >
                {isSubmitting ? (busyLabel ?? 'Working…') : submitLabel}
            </MyButton>
        </div>
    );
};

function CascadeField({
    label,
    placeholder,
    options,
    value,
    onChange,
    disabled,
}: {
    label: string;
    placeholder: string;
    options: SearchableSelectOption[];
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex w-full flex-col gap-1.5">
            <label className="text-body font-medium text-neutral-600">
                {label}
                <span className="text-danger-600">*</span>
            </label>
            <SearchableSelect
                options={options}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                searchPlaceholder={`Search ${label.toLowerCase()}…`}
                emptyText="No matches"
                disabled={disabled}
                // Inline, not portalled: this lives inside a modal dialog, where
                // react-remove-scroll would otherwise block scrolling the list.
                portal={false}
            />
        </div>
    );
}

/** A level that had only one option: shown, not asked for. */
function FixedField({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex w-full flex-col gap-1.5">
            <label className="text-body font-medium text-neutral-600">{label}</label>
            <span className="flex h-10 items-center truncate rounded-md border border-neutral-200 bg-neutral-50 px-3 text-body text-neutral-600">
                {value}
            </span>
        </div>
    );
}

/** Two-option segmented choice built from the canonical button. */
function ChoiceRow({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-neutral-600">{label}</span>
            <div className="flex flex-wrap items-center gap-2">
                {options.map((option) => (
                    <MyButton
                        key={option.value}
                        type="button"
                        buttonType={value === option.value ? 'primary' : 'secondary'}
                        scale="medium"
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </MyButton>
                ))}
            </div>
        </div>
    );
}
