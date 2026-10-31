// Bulk Content Uploading — wizard shell (select → preview → committing → results).
//
// Route-agnostic and mode-aware: single-course (context required — used by the
// standalone page after the pickers resolve AND the course-page dialog) or
// multi-course (top-level zip folders matched to courses).

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useReplaceBase64ImagesWithNetworkUrls } from '@/utils/helpers/study-library-helpers.ts/slides/replaceBase64ToNetworkUrl';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { DisplaySettingsData } from '@/types/display-settings';
import { buildTree, formatBytes, isJunkPath, MAX_FILE_COUNT, MAX_ZIP_BYTES } from './conventions';
import { runCommit } from './commit-engine';
import { annotateSlideCollisions, applyMatching, buildExistingSnapshot } from './matching';
import { isManifestEntry, resolveManifest } from './csv-manifest';
import {
    clearDirectFiles,
    currentDirectFingerprint,
    directFileEntries,
    directTotalBytes,
} from './file-source';
import { openZipFile, setCurrentZipHandle, zipFingerprint } from './zip-parser';
import {
    clearMultiParseCaches,
    deriveCourseSections,
    prepareSection,
    resolveSectionForCourse,
} from './multi-course-parse';
import { loadRoleDisplayForBulk } from './course-edit-gate';
import { useBulkContentUploadingStore } from './use-bulk-content-uploading-store';
import { UploadStep } from './steps/upload-step';
import { PreviewStep } from './steps/preview-step';
import { ProgressStep } from './steps/progress-step';
import { ResultsStep } from './steps/results-step';
import type { BulkUploadContext, UploadMode } from './types';

interface BulkContentUploadingWizardProps {
    /** Required in single mode; ignored in multi mode. */
    context?: BulkUploadContext;
    mode?: UploadMode;
    /** Required in multi mode (single mode reads it from context). */
    instituteId?: string;
    /** Called once a commit run finishes (used by the course page to refresh its tree). */
    onCompleted?: () => void;
}

export interface SectionCallbacks {
    onCourseChange: (sectionId: string, courseId: string) => void;
    onBatchChange: (sectionId: string, sessionId: string, levelId: string) => void;
    onToggleSkip: (sectionId: string) => void;
    onRetrySection: (sectionId: string) => void;
}

export const BulkContentUploadingWizard = ({
    context,
    mode = 'single',
    instituteId,
    onCompleted,
}: BulkContentUploadingWizardProps) => {
    const queryClient = useQueryClient();
    const phase = useBulkContentUploadingStore((state) => state.phase);
    const {
        setContext,
        setMode,
        setPhase,
        loadParseResult,
        loadMultiParse,
        loadCsvResolve,
        resetStore,
    } = useBulkContentUploadingStore();
    const replaceBase64ImagesWithNetworkUrls = useReplaceBase64ImagesWithNetworkUrls();
    const roleDisplayRef = useRef<DisplaySettingsData | null>(null);

    const effectiveInstituteId = mode === 'single' ? context?.instituteId ?? '' : instituteId ?? '';
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);

    useEffect(() => {
        setMode(mode);
        if (mode === 'single' && context) setContext(context);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        mode,
        context?.courseId,
        context?.packageSessionId,
        context?.sessionId,
        context?.levelId,
        context?.courseDepth,
    ]);

    useEffect(
        () => () => {
            void setCurrentZipHandle(null);
            clearDirectFiles();
            clearMultiParseCaches();
            resetStore();
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    // CSV "select files directly" flow: the user picked files + uploaded a filled
    // bulkcontent.csv. Resolve it against the in-memory selection (not a zip).
    const handleManifestCsvSelected = async (csvText: string) => {
        setPhase('parsing');
        try {
            void setCurrentZipHandle(null); // direct files take precedence over any prior zip
            const studyLibraryData = useStudyLibraryStore.getState().studyLibraryData ?? [];
            const result = await resolveManifest({
                csvText,
                zipEntries: directFileEntries(),
                studyLibraryData,
                instituteId: effectiveInstituteId,
            });
            loadCsvResolve(result, {
                zipFileName: `${directFileEntries().length} selected file(s)`,
                zipTotalBytes: directTotalBytes(),
                fingerprint: currentDirectFingerprint(),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not read the CSV';
            toast.error(message);
            setPhase('select');
        }
    };

    const handleZipSelected = async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.zip')) {
            toast.error('Please select a .zip file');
            return;
        }
        setPhase('parsing');
        try {
            clearDirectFiles(); // a zip upload supersedes any prior direct-file selection
            const handle = await openZipFile(file);
            await setCurrentZipHandle(handle);
            clearMultiParseCaches();

            if (mode === 'csv') {
                // Zip-level guards (sections skip them).
                const usableCount = handle.entries.filter(
                    (e) => !e.isDirectory && !isJunkPath(e.path)
                ).length;
                if (file.size > MAX_ZIP_BYTES) {
                    throw new Error(
                        `Zip is ${formatBytes(file.size)} — larger than the ${formatBytes(MAX_ZIP_BYTES)} limit.`
                    );
                }
                if (usableCount > MAX_FILE_COUNT) {
                    throw new Error(
                        `Zip contains ${usableCount} files — more than the ${MAX_FILE_COUNT} limit.`
                    );
                }
                const manifestEntry = handle.entries.find(
                    (e) => !e.isDirectory && isManifestEntry(e.path)
                );
                if (!manifestEntry) {
                    throw new Error('No bulkcontent.csv found at the root of the zip.');
                }
                const csvText = await handle.readText(manifestEntry.path);
                const studyLibraryData = useStudyLibraryStore.getState().studyLibraryData ?? [];
                const result = await resolveManifest({
                    csvText,
                    zipEntries: handle.entries,
                    studyLibraryData,
                    instituteId: effectiveInstituteId,
                });
                loadCsvResolve(result, {
                    zipFileName: file.name,
                    zipTotalBytes: file.size,
                    fingerprint: zipFingerprint(file),
                });
                return;
            }

            if (mode === 'multi') {
                const studyLibraryData = useStudyLibraryStore.getState().studyLibraryData ?? [];
                if (roleDisplayRef.current === null) {
                    roleDisplayRef.current = await loadRoleDisplayForBulk();
                }
                const derived = deriveCourseSections({
                    entries: handle.entries,
                    studyLibraryData,
                    roleDisplay: roleDisplayRef.current,
                    courseTerm,
                    zipFileName: file.name,
                    zipTotalBytes: file.size,
                });
                loadMultiParse(
                    derived.sections,
                    {
                        zipFileName: file.name,
                        zipTotalBytes: file.size,
                        fingerprint: zipFingerprint(file),
                    },
                    derived.zipIssues,
                    derived.zipFatals
                );
                // Kick off parsing for every section that already resolved a batch
                // (pointless when the zip itself is rejected).
                if (derived.zipFatals.length === 0) {
                    derived.sections
                        .filter((s) => s.status === 'loading')
                        .forEach((s) => void prepareSection(s.id, effectiveInstituteId));
                }
                return;
            }

            if (!context) throw new Error('Bulk upload context is not initialized');
            const result = await buildTree({
                entries: handle.entries,
                courseDepth: context.courseDepth,
                zipFileName: file.name,
                zipTotalBytes: file.size,
                fingerprint: zipFingerprint(file),
                readText: handle.readText,
            });
            const snapshot = await buildExistingSnapshot(context);
            applyMatching(result.nodes, snapshot, context.courseDepth);
            annotateSlideCollisions(result.items, result.nodes, snapshot, context.courseDepth);
            loadParseResult(result, snapshot);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not read this zip file';
            toast.error(message);
            await setCurrentZipHandle(null);
            setPhase('select');
        }
    };

    // ----- Multi-mode section callbacks (preview step) -----
    const isDuplicateTarget = (
        sectionId: string,
        courseId?: string,
        packageSessionId?: string
    ): boolean => {
        if (!courseId || !packageSessionId) return false;
        const sections = useBulkContentUploadingStore.getState().courseSections;
        return Object.values(sections).some(
            (other) =>
                other.id !== sectionId &&
                other.status !== 'skipped' &&
                other.courseId === courseId &&
                other.packageSessionId === packageSessionId
        );
    };
    const DUPLICATE_TARGET_MESSAGE = `Another folder in this zip already targets the same ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} and batch.`;

    const sectionCallbacks: SectionCallbacks = {
        onCourseChange: (sectionId, courseId) => {
            const state = useBulkContentUploadingStore.getState();
            const section = state.courseSections[sectionId];
            const entry = (useStudyLibraryStore.getState().studyLibraryData ?? []).find(
                (e) => e.course.id === courseId
            );
            if (!section || !entry) return;
            state.clearSectionParse(sectionId);
            const resolved = resolveSectionForCourse(
                { ...section, issues: [], fatalErrors: [] },
                entry,
                roleDisplayRef.current,
                courseTerm
            );
            if (isDuplicateTarget(sectionId, resolved.courseId, resolved.packageSessionId)) {
                state.updateSection(sectionId, {
                    ...resolved,
                    status: 'error',
                    error: DUPLICATE_TARGET_MESSAGE,
                });
                return;
            }
            state.updateSection(sectionId, resolved);
            if (resolved.status === 'loading') {
                void prepareSection(sectionId, effectiveInstituteId);
            }
        },
        onBatchChange: (sectionId, sessionId, levelId) => {
            const state = useBulkContentUploadingStore.getState();
            const section = state.courseSections[sectionId];
            if (!section?.courseId) return;
            const packageSessionId =
                useStudyLibraryStore
                    .getState()
                    .getPackageSessionId({ courseId: section.courseId, sessionId, levelId }) || '';
            if (
                packageSessionId &&
                isDuplicateTarget(sectionId, section.courseId, packageSessionId)
            ) {
                state.updateSection(sectionId, {
                    sessionId,
                    levelId,
                    packageSessionId,
                    status: 'error',
                    error: DUPLICATE_TARGET_MESSAGE,
                });
                return;
            }
            state.updateSection(sectionId, {
                sessionId,
                levelId,
                packageSessionId: packageSessionId || undefined,
                status: packageSessionId ? 'loading' : 'needs-batch',
                error: packageSessionId ? undefined : 'No batch found for this session and level.',
            });
            if (packageSessionId) void prepareSection(sectionId, effectiveInstituteId);
        },
        onToggleSkip: (sectionId) => {
            const state = useBulkContentUploadingStore.getState();
            const section = state.courseSections[sectionId];
            if (!section) return;
            if (section.status === 'skipped') {
                // Un-skip: back to whatever the section can resolve to.
                if (section.courseId && section.packageSessionId) {
                    state.updateSection(sectionId, { status: 'loading' });
                    void prepareSection(sectionId, effectiveInstituteId);
                } else if (section.courseId) {
                    state.updateSection(sectionId, { status: 'needs-batch' });
                } else {
                    state.updateSection(sectionId, { status: 'unmatched' });
                }
            } else {
                state.clearSectionParse(sectionId);
                state.updateSection(sectionId, { status: 'skipped' });
            }
        },
        onRetrySection: (sectionId) => {
            void prepareSection(sectionId, effectiveInstituteId);
        },
    };

    const refreshCourseQueries = () => {
        queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
        queryClient.invalidateQueries({ queryKey: ['GET_CHAPTERS_WITH_SLIDES'] });
        queryClient.invalidateQueries({ queryKey: ['GET_INIT_STUDY_LIBRARY'] });
        queryClient.invalidateQueries({ queryKey: ['slides'] });
    };

    const commit = async (failureToast: string) => {
        try {
            await runCommit({
                replaceBase64ImagesWithNetworkUrls,
                instituteId: effectiveInstituteId,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : failureToast;
            toast.error(message);
            setPhase('preview');
            return;
        }
        // Commit changes course structures — section snapshots are stale now.
        clearMultiParseCaches();
        refreshCourseQueries();
        onCompleted?.();
    };

    switch (phase) {
        case 'select':
            return (
                <UploadStep
                    onZipSelected={handleZipSelected}
                    onManifestCsvSelected={handleManifestCsvSelected}
                />
            );
        case 'parsing':
            return (
                <div className="flex min-h-64 flex-col items-center justify-center gap-2">
                    <DashboardLoader />
                    <p className="text-subtitle text-neutral-500">
                        Reading zip and matching it against the {courseTerm.toLowerCase()}…
                    </p>
                </div>
            );
        case 'preview':
            return (
                <PreviewStep
                    onConfirm={() => void commit('Upload failed')}
                    sectionCallbacks={sectionCallbacks}
                />
            );
        case 'committing':
            return <ProgressStep />;
        case 'results':
            return <ResultsStep onRetryFailed={() => void commit('Retry failed')} />;
        default:
            return null;
    }
};
