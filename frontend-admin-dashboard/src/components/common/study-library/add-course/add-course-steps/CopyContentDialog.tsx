import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, MagnifyingGlass } from '@phosphor-icons/react';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export type CopyContentMode = 'VALUE' | 'REFERENCE';

export interface CopyContentSelection {
    sourcePackageSessionId: string;
    sourceLabel: string;
    mode: CopyContentMode;
}

interface CopyContentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Depth of the course currently being created. Only batches that belong to
     * a course of the same depth are selectable; the rest are shown disabled.
     * Pass `null` if depth is not yet known (the dialog will then disable
     * everything and show a hint).
     */
    targetCourseDepth: number | null | undefined;
    /**
     * If true, the target batch already has real content (slides). REFERENCE
     * mode is locked off (it would mix shared and existing content) — only
     * VALUE (deep clone) is allowed. The radio shows REFERENCE disabled with
     * an explanatory tooltip, and a notice banner explains why.
     */
    targetBatchHasContent?: boolean;
    /** Pre-selected source (if user re-opens the dialog after picking). */
    initialSelection?: CopyContentSelection | null;
    onConfirm: (selection: CopyContentSelection) => void;
}

interface BatchOption {
    packageSessionId: string;
    courseId: string;
    courseName: string;
    sessionName: string;
    levelName: string;
    courseDepth: number | null;
    isSameDepth: boolean;
    isDepthUnknown: boolean;
    label: string;
}

/**
 * Dialog for picking a source institute batch (package_session) whose content
 * should be deep-cloned into the freshly-created course's batches.
 *
 * Data sources:
 * - `instituteDetails.batches_for_sessions` is the authoritative batch list
 *   (always loaded once the admin dashboard mounts).
 * - `studyLibraryData` carries `course_depth`, which `batches_for_sessions`
 *   does not. We trigger the study-library query here so depth lookups work
 *   even when the user opens the dialog from the Add Course flow before ever
 *   visiting the Study Library route.
 *
 * Only same-depth source courses are selectable — the backend rejects mixed
 * depth and the UI surfaces this up-front.
 */
export const CopyContentDialog = ({
    open,
    onOpenChange,
    targetCourseDepth,
    targetBatchHasContent,
    initialSelection,
    onConfirm,
}: CopyContentDialogProps) => {
    const { studyLibraryData } = useStudyLibraryStore();
    const { instituteDetails } = useInstituteDetailsStore();
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const courseLower = courseTerm.toLocaleLowerCase();
    const coursesLower = getTerminologyPlural(
        ContentTerms.Course,
        SystemTerms.Course
    ).toLocaleLowerCase();
    const chaptersLower = getTerminologyPlural(
        ContentTerms.Chapters,
        SystemTerms.Chapters
    ).toLocaleLowerCase();
    const [search, setSearch] = useState('');
    const [picked, setPicked] = useState<string>(initialSelection?.sourcePackageSessionId ?? '');
    const [mode, setMode] = useState<CopyContentMode>(initialSelection?.mode ?? 'VALUE');

    // Reset the selection whenever the dialog reopens with a different initial.
    useEffect(() => {
        if (open) {
            setPicked(initialSelection?.sourcePackageSessionId ?? '');
            setMode(initialSelection?.mode ?? 'VALUE');
        }
    }, [open, initialSelection?.sourcePackageSessionId, initialSelection?.mode]);

    // If the target batch already has content, force VALUE mode regardless of
    // what's currently selected (defense for late-arriving slide-count data).
    useEffect(() => {
        if (targetBatchHasContent && mode === 'REFERENCE') {
            setMode('VALUE');
        }
    }, [targetBatchHasContent, mode]);

    // Fire the study-library query so depth info is populated even when the
    // user hasn't visited /study-library yet. Disabled when the dialog is
    // closed to avoid unnecessary fetches; staleTime in the query (1h) keeps
    // it cheap on reopen.
    const studyLibraryQueryConfig = useStudyLibraryQuery();
    const { isLoading: isDepthLoading } = useQuery({
        ...studyLibraryQueryConfig,
        enabled: open,
    });

    /** courseId -> course_depth, populated from studyLibraryData when available. */
    const courseDepthByCourseId = useMemo(() => {
        const map = new Map<string, number>();
        if (!studyLibraryData) return map;
        for (const item of studyLibraryData) {
            const id = item.course?.id;
            const depth = item.course?.course_depth;
            if (id && typeof depth === 'number') map.set(id, depth);
        }
        return map;
    }, [studyLibraryData]);

    const allBatches: BatchOption[] = useMemo(() => {
        const out: BatchOption[] = [];
        const batches = instituteDetails?.batches_for_sessions ?? [];
        for (const batch of batches) {
            if (batch.status === 'DELETED') continue;
            const courseId = batch.package_dto?.id ?? '';
            const courseName = batch.package_dto?.package_name ?? 'Untitled';
            const sessionName = batch.session?.session_name ?? '';
            const levelName = batch.level?.level_name ?? '';
            const depth = courseId ? (courseDepthByCourseId.get(courseId) ?? null) : null;
            const isDepthUnknown = depth == null;
            const isSameDepth =
                targetCourseDepth != null && depth != null && depth === targetCourseDepth;

            out.push({
                packageSessionId: batch.id,
                courseId,
                courseName,
                sessionName,
                levelName,
                courseDepth: depth,
                isSameDepth,
                isDepthUnknown,
                label: `${courseName} · ${sessionName} · ${levelName}`,
            });
        }
        // Stable order: same-depth first, then depth-unknown, then mismatched depth.
        out.sort((a, b) => {
            const score = (o: BatchOption) =>
                o.isSameDepth ? 0 : o.isDepthUnknown ? 1 : 2;
            return score(a) - score(b) || a.label.localeCompare(b.label);
        });
        return out;
    }, [instituteDetails?.batches_for_sessions, courseDepthByCourseId, targetCourseDepth]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return allBatches;
        return allBatches.filter((b) => b.label.toLowerCase().includes(q));
    }, [allBatches, search]);

    const sameDepthCount = allBatches.filter((b) => b.isSameDepth).length;
    const unknownDepthCount = allBatches.filter((b) => b.isDepthUnknown).length;
    const targetDepthLabel = targetCourseDepth == null ? '—' : String(targetCourseDepth);

    const selectedOption = filtered.find((b) => b.packageSessionId === picked);
    const canConfirm = !!selectedOption && selectedOption.isSameDepth;

    const handleConfirm = () => {
        if (!selectedOption) return;
        onConfirm({
            sourcePackageSessionId: selectedOption.packageSessionId,
            sourceLabel: selectedOption.label,
            mode,
        });
    };

    const footer = (
        <div className="flex w-full items-center justify-end gap-2 border-t bg-white px-6 py-3">
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                layoutVariant="default"
                onClick={() => onOpenChange(false)}
            >
                Cancel
            </MyButton>
            <MyButton
                type="button"
                buttonType="primary"
                scale="medium"
                layoutVariant="default"
                onClick={handleConfirm}
                disable={!canConfirm}
            >
                Use this content
            </MyButton>
        </div>
    );

    const emptyStateMessage = () => {
        if (!instituteDetails) return 'Loading institute batches…';
        if (allBatches.length === 0) return 'No batches found in this institute yet.';
        return 'No matches for your search.';
    };

    const referenceLockedReason = targetBatchHasContent
        ? 'This batch already has its own content. Linking it to another batch would mix linked and existing lessons. Choose "Make a separate copy" instead.'
        : undefined;
    const referenceDisabled = !!targetBatchHasContent;

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading="Import content from existing batch"
            dialogWidth="max-w-xl"
            footer={footer}
        >
            <div className="flex flex-col gap-3 px-6 py-4">
                {/* Mode toggle */}
                <div className="rounded-md border border-neutral-200 p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                        How would you like to bring the content in?
                    </div>
                    <div className="flex flex-col gap-2">
                        <label
                            className={[
                                'flex cursor-pointer items-start gap-3 rounded-md border p-2',
                                mode === 'VALUE'
                                    ? 'border-primary-300 bg-primary-50'
                                    : 'border-neutral-200 hover:bg-neutral-50',
                            ].join(' ')}
                        >
                            <input
                                type="radio"
                                name="copy-mode"
                                value="VALUE"
                                checked={mode === 'VALUE'}
                                onChange={() => setMode('VALUE')}
                                className="mt-1 size-3.5 accent-primary-500"
                            />
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">
                                    Make a separate copy
                                </span>
                                <span className="text-xs text-neutral-500">
                                    Subjects, modules, {chaptersLower} and slides are duplicated for
                                    this {courseLower}. Editing them here will not affect the
                                    original {courseLower}.
                                </span>
                            </div>
                        </label>

                        <label
                            className={[
                                'flex items-start gap-3 rounded-md border p-2',
                                referenceDisabled
                                    ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-60'
                                    : mode === 'REFERENCE'
                                      ? 'cursor-pointer border-primary-300 bg-primary-50'
                                      : 'cursor-pointer border-neutral-200 hover:bg-neutral-50',
                            ].join(' ')}
                            title={referenceLockedReason}
                        >
                            <input
                                type="radio"
                                name="copy-mode"
                                value="REFERENCE"
                                checked={mode === 'REFERENCE'}
                                disabled={referenceDisabled}
                                onChange={() => setMode('REFERENCE')}
                                className="mt-1 size-3.5 accent-primary-500"
                            />
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">
                                    Keep linked to the original
                                </span>
                                <span className="text-xs text-neutral-500">
                                    Both {coursesLower} use the same lessons behind a different{' '}
                                    {courseLower} title, description and banner. Any edit in either{' '}
                                    {courseLower} is reflected in both.
                                </span>
                                {referenceDisabled && (
                                    <span className="mt-1 text-xs font-medium text-amber-700">
                                        Unavailable — {referenceLockedReason}
                                    </span>
                                )}
                            </div>
                        </label>
                    </div>
                </div>

                <Alert
                    className={
                        mode === 'REFERENCE'
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-blue-200 bg-blue-50'
                    }
                >
                    <Info
                        className={
                            mode === 'REFERENCE'
                                ? 'size-4 text-amber-600'
                                : 'size-4 text-blue-600'
                        }
                    />
                    <AlertDescription
                        className={
                            mode === 'REFERENCE'
                                ? 'text-sm text-amber-900'
                                : 'text-sm text-blue-900'
                        }
                    >
                        {mode === 'VALUE' ? (
                            <>
                                After your {courseLower} is created, the chosen batch&apos;s
                                subjects, modules, {chaptersLower} and slides will be duplicated
                                into every batch of this new {courseLower}. The copies are
                                independent — editing content here will not affect the original{' '}
                                {courseLower}.
                            </>
                        ) : (
                            <>
                                The new {courseLower}&apos;s batches will stay{' '}
                                <strong>linked</strong> to the source batch&apos;s subjects,
                                modules, {chaptersLower} and slides. Editing content in either{' '}
                                {courseLower} is reflected in the other. Only the {courseLower}
                                &apos;s own details (title, description, banner, tags) stay
                                independent.
                            </>
                        )}
                        <div
                            className={
                                mode === 'REFERENCE'
                                    ? 'mt-1 text-xs text-amber-700'
                                    : 'mt-1 text-xs text-blue-700'
                            }
                        >
                            Only batches whose {courseLower} depth matches your new {courseLower}{' '}
                            (depth <strong>{targetDepthLabel}</strong>) can be selected.
                        </div>
                    </AlertDescription>
                </Alert>

                <div className="relative">
                    <MagnifyingGlass
                        size={16}
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <Input
                        type="text"
                        placeholder={`Search by ${courseLower}, session or level…`}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-9 pl-7"
                    />
                </div>

                <div className="max-h-[40vh] overflow-y-auto rounded-md border border-neutral-200">
                    {filtered.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-neutral-500">
                            {emptyStateMessage()}
                        </div>
                    ) : (
                        <ul className="divide-y divide-neutral-100">
                            {filtered.map((option) => {
                                const disabled = !option.isSameDepth;
                                const isPicked = picked === option.packageSessionId;
                                const tooltip = option.isDepthUnknown
                                    ? `${courseTerm} depth is still loading — try again in a moment.`
                                    : disabled
                                      ? `${courseTerm} depth is ${option.courseDepth}, expected ${targetDepthLabel}`
                                      : undefined;
                                return (
                                    <li key={option.packageSessionId}>
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => setPicked(option.packageSessionId)}
                                            className={[
                                                'flex w-full items-start gap-3 px-3 py-2 text-left text-sm',
                                                disabled
                                                    ? 'cursor-not-allowed bg-neutral-50 text-neutral-400'
                                                    : 'cursor-pointer hover:bg-primary-50',
                                                isPicked
                                                    ? 'bg-primary-50 ring-1 ring-inset ring-primary-300'
                                                    : '',
                                            ].join(' ')}
                                            title={tooltip}
                                        >
                                            <input
                                                type="radio"
                                                checked={isPicked}
                                                readOnly
                                                disabled={disabled}
                                                className="mt-1 size-3.5 accent-primary-500"
                                            />
                                            <div className="flex flex-1 flex-col">
                                                <span className="font-medium">
                                                    {option.courseName}
                                                </span>
                                                <span className="text-xs text-neutral-500">
                                                    {option.sessionName} · {option.levelName}
                                                </span>
                                            </div>
                                            <span
                                                className={[
                                                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                                                    option.isSameDepth
                                                        ? 'bg-primary-100 text-primary-700'
                                                        : option.isDepthUnknown
                                                          ? 'bg-amber-100 text-amber-700'
                                                          : 'bg-neutral-200 text-neutral-600',
                                                ].join(' ')}
                                            >
                                                {option.isDepthUnknown
                                                    ? 'Depth ?'
                                                    : `Depth ${option.courseDepth}`}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                <div className="text-xs text-neutral-500">
                    {sameDepthCount} batch{sameDepthCount === 1 ? '' : 'es'} match the depth of your
                    new {courseLower}
                    {unknownDepthCount > 0 && isDepthLoading
                        ? `; ${unknownDepthCount} still resolving depth…`
                        : unknownDepthCount > 0
                          ? `; ${unknownDepthCount} have unknown depth.`
                          : '.'}
                </div>
            </div>
        </MyDialog>
    );
};
