// Bulk Content Uploading — wizard state.
//
// Not persisted: items reference zip entries that only live while the picked
// File is around. Resume across reloads goes through the session manifest
// (localStorage) keyed by the zip fingerprint instead.

import { create } from 'zustand';
import type {
    BulkIssue,
    BulkItem,
    BulkNode,
    BulkUploadContext,
    BulkUploadOptions,
    CourseSection,
    CsvChapterIndex,
    ExistingSnapshot,
    ItemStatus,
    NodeMapping,
    NodeStatus,
    ParseResult,
    UploadMode,
} from './types';
import type { CsvResolveResult, CsvRowResult } from './csv-manifest';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export type WizardPhase = 'select' | 'parsing' | 'preview' | 'committing' | 'results';

export interface SectionDefaults {
    subjectId?: string;
    moduleId?: string;
    chapterId?: string;
}

interface BulkContentUploadingStore {
    phase: WizardPhase;
    mode: UploadMode;
    context: BulkUploadContext | null;
    options: BulkUploadOptions;
    nodes: Record<string, BulkNode>;
    items: Record<string, BulkItem>;
    issues: BulkIssue[];
    fatalErrors: string[];
    zipFileName: string;
    zipTotalBytes: number;
    fingerprint: string;
    existingSnapshot: ExistingSnapshot | null;
    /** DEFAULT-chain ids resolved/created during commit preflight (depth < 5). */
    defaults: SectionDefaults;
    // ----- multi-course mode -----
    courseSections: Record<string, CourseSection>;
    sectionSnapshots: Record<string, ExistingSnapshot>;
    sectionDefaults: Record<string, SectionDefaults>;
    // ----- csv-manifest mode -----
    csvRows: CsvRowResult[];
    chapterIndexBySection: Record<string, CsvChapterIndex>;

    setPhase: (phase: WizardPhase) => void;
    setMode: (mode: UploadMode) => void;
    setContext: (context: BulkUploadContext) => void;
    setOptions: (options: Partial<BulkUploadOptions>) => void;
    loadParseResult: (result: ParseResult, snapshot: ExistingSnapshot) => void;
    remapNode: (nodeId: string, mapping: NodeMapping) => void;
    renameNode: (nodeId: string, displayName: string) => void;
    markNode: (nodeId: string, status: NodeStatus, patch?: Partial<BulkNode>) => void;
    markItem: (itemId: string, status: ItemStatus, patch?: Partial<BulkItem>) => void;
    patchItem: (itemId: string, patch: Partial<BulkItem>) => void;
    setDefaults: (defaults: SectionDefaults) => void;
    // ----- multi-course actions -----
    loadMultiParse: (
        sections: CourseSection[],
        zipMeta: { zipFileName: string; zipTotalBytes: number; fingerprint: string },
        zipIssues: BulkIssue[],
        zipFatals: string[]
    ) => void;
    updateSection: (sectionId: string, patch: Partial<CourseSection>) => void;
    loadSectionParse: (sectionId: string, result: ParseResult, snapshot: ExistingSnapshot) => void;
    clearSectionParse: (sectionId: string) => void;
    setSectionDefaults: (sectionId: string, defaults: SectionDefaults) => void;
    // ----- csv-manifest action -----
    loadCsvResolve: (
        result: CsvResolveResult,
        zipMeta: { zipFileName: string; zipTotalBytes: number; fingerprint: string }
    ) => void;
    resetForNewZip: () => void;
    resetStore: () => void;
}

const initialState = {
    phase: 'select' as WizardPhase,
    mode: 'single' as UploadMode,
    context: null,
    options: { publish: true, notify: false, skipDuplicateTitles: false, createMissing: true },
    nodes: {},
    items: {},
    issues: [],
    fatalErrors: [],
    zipFileName: '',
    zipTotalBytes: 0,
    fingerprint: '',
    existingSnapshot: null,
    defaults: {},
    courseSections: {},
    sectionSnapshots: {},
    sectionDefaults: {},
    csvRows: [],
    chapterIndexBySection: {},
};

export const useBulkContentUploadingStore = create<BulkContentUploadingStore>((set) => ({
    ...initialState,

    setPhase: (phase) => set({ phase }),
    setMode: (mode) => set({ mode }),
    setContext: (context) => set({ context }),
    setOptions: (options) => set((state) => ({ options: { ...state.options, ...options } })),

    loadParseResult: (result, snapshot) =>
        set({
            nodes: result.nodes,
            items: result.items,
            issues: result.issues,
            fatalErrors: result.fatalErrors,
            zipFileName: result.zipFileName,
            zipTotalBytes: result.zipTotalBytes,
            fingerprint: result.fingerprint,
            existingSnapshot: snapshot,
            defaults: {},
            phase: 'preview',
        }),

    remapNode: (nodeId, mapping) =>
        set((state) => {
            const node = state.nodes[nodeId];
            if (!node) return state;
            return { nodes: { ...state.nodes, [nodeId]: { ...node, mapping } } };
        }),

    renameNode: (nodeId, displayName) =>
        set((state) => {
            const node = state.nodes[nodeId];
            if (!node) return state;
            return { nodes: { ...state.nodes, [nodeId]: { ...node, displayName } } };
        }),

    markNode: (nodeId, status, patch) =>
        set((state) => {
            const node = state.nodes[nodeId];
            if (!node) return state;
            return { nodes: { ...state.nodes, [nodeId]: { ...node, ...patch, status } } };
        }),

    markItem: (itemId, status, patch) =>
        set((state) => {
            const item = state.items[itemId];
            if (!item) return state;
            return { items: { ...state.items, [itemId]: { ...item, ...patch, status } } };
        }),

    patchItem: (itemId, patch) =>
        set((state) => {
            const item = state.items[itemId];
            if (!item) return state;
            return { items: { ...state.items, [itemId]: { ...item, ...patch } } };
        }),

    setDefaults: (defaults) => set({ defaults }),

    loadMultiParse: (sections, zipMeta, zipIssues, zipFatals) =>
        set({
            courseSections: Object.fromEntries(sections.map((s) => [s.id, s])),
            sectionSnapshots: {},
            sectionDefaults: {},
            nodes: {},
            items: {},
            issues: zipIssues,
            fatalErrors: zipFatals,
            zipFileName: zipMeta.zipFileName,
            zipTotalBytes: zipMeta.zipTotalBytes,
            fingerprint: zipMeta.fingerprint,
            phase: 'preview',
        }),

    updateSection: (sectionId, patch) =>
        set((state) => {
            const section = state.courseSections[sectionId];
            if (!section) return state;
            return {
                courseSections: {
                    ...state.courseSections,
                    [sectionId]: { ...section, ...patch },
                },
            };
        }),

    loadSectionParse: (sectionId, result, snapshot) =>
        set((state) => {
            const section = state.courseSections[sectionId];
            if (!section) return state;
            const nodes = Object.fromEntries(
                Object.entries(state.nodes).filter(([, n]) => n.sectionId !== sectionId)
            );
            const items = Object.fromEntries(
                Object.entries(state.items).filter(([, i]) => i.sectionId !== sectionId)
            );
            Object.values(result.nodes).forEach((n) => {
                nodes[n.id] = n;
            });
            Object.values(result.items).forEach((i) => {
                items[i.id] = i;
            });
            return {
                nodes,
                items,
                sectionSnapshots: { ...state.sectionSnapshots, [sectionId]: snapshot },
                courseSections: {
                    ...state.courseSections,
                    [sectionId]: {
                        ...section,
                        issues: result.issues,
                        fatalErrors: result.fatalErrors,
                        status: 'ready',
                        error: undefined,
                    },
                },
            };
        }),

    clearSectionParse: (sectionId) =>
        set((state) => ({
            nodes: Object.fromEntries(
                Object.entries(state.nodes).filter(([, n]) => n.sectionId !== sectionId)
            ),
            items: Object.fromEntries(
                Object.entries(state.items).filter(([, i]) => i.sectionId !== sectionId)
            ),
        })),

    setSectionDefaults: (sectionId, defaults) =>
        set((state) => ({
            sectionDefaults: { ...state.sectionDefaults, [sectionId]: defaults },
        })),

    loadCsvResolve: (result, zipMeta) =>
        set({
            nodes: result.nodes,
            items: result.items,
            courseSections: Object.fromEntries(result.sections.map((s) => [s.id, s])),
            sectionSnapshots: result.snapshots,
            chapterIndexBySection: result.chapterIndexBySection,
            csvRows: result.rows,
            issues: result.issues,
            fatalErrors: [],
            zipFileName: zipMeta.zipFileName,
            zipTotalBytes: zipMeta.zipTotalBytes,
            fingerprint: zipMeta.fingerprint,
            phase: 'preview',
        }),

    resetForNewZip: () =>
        set((state) => ({
            ...initialState,
            mode: state.mode,
            context: state.context,
            options: state.options,
        })),

    resetStore: () => set({ ...initialState }),
}));

// ----- Derived helpers (plain selectors over getState/snapshots) -----

export const selectProgress = (items: Record<string, BulkItem>) => {
    const all = Object.values(items);
    const countable = all.filter((i) => i.status !== 'skipped');
    const done = countable.filter((i) => i.status === 'done').length;
    const failed = countable.filter((i) => i.status === 'failed' || i.status === 'blocked').length;
    return { total: countable.length, done, failed };
};

/** CSV mode Confirm gate: not over caps + at least one valid (committable) row. */
export const selectCsvReadiness = (state: {
    items: Record<string, BulkItem>;
    fatalErrors: string[];
}): { ready: boolean; reason?: string } => {
    if (state.fatalErrors.length > 0) return { ready: false, reason: state.fatalErrors[0] };
    const validCount = Object.keys(state.items).length;
    if (validCount === 0) {
        return { ready: false, reason: 'No valid rows to upload — fix the errors below.' };
    }
    return { ready: true };
};

/** True when any ancestor of this node is skipped, so the node is moot. */
const isUnderSkippedAncestor = (node: BulkNode, nodes: Record<string, BulkNode>): boolean => {
    let parentId = node.parentId;
    while (parentId) {
        const parent = nodes[parentId];
        if (!parent) break;
        if (parent.mapping.action === 'skip') return true;
        parentId = parent.parentId;
    }
    return false;
};

/**
 * Folders with no existing match that the user hasn't skipped (directly or via
 * an ancestor). These block Confirm only when auto-create is off — with it on
 * they are actionable ("will be created"), not blockers.
 *
 * The synthetic depth-2 root is excluded unconditionally: applyMatching marks it
 * 'create' whenever the batch has no DEFAULT chapter yet, but the preview tree
 * renders no dropdown for it, so blocking on it would be a dead end. Phase 0 of
 * the commit creates that DEFAULT chapter anyway.
 */
export const selectUnresolvedNodes = (
    nodes: Record<string, BulkNode>,
    sectionId?: string,
    createMissing = false
): BulkNode[] => {
    if (createMissing) return [];
    return Object.values(nodes).filter(
        (node) =>
            (sectionId ? node.sectionId === sectionId : true) &&
            node.mapping.action === 'create' &&
            !node.syntheticRoot &&
            !isUnderSkippedAncestor(node, nodes)
    );
};

export const selectSectionsOrdered = (sections: Record<string, CourseSection>): CourseSection[] =>
    Object.values(sections).sort((a, b) => {
        if (a.orderHint !== null || b.orderHint !== null) {
            if (a.orderHint === null) return 1;
            if (b.orderHint === null) return -1;
            if (a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
        }
        return a.topFolderDisplay.localeCompare(b.topFolderDisplay);
    });

/**
 * Folders auto-create will really turn into new subjects/modules/chapters —
 * what the preview promises and the results step reports. Excludes the synthetic
 * depth-2 root (not a real folder) and anything under a skipped ancestor, since
 * Phase 1 never reaches those: counting them would promise work that never runs.
 */
export const selectCreatedNodes = (
    nodes: Record<string, BulkNode>,
    sectionId?: string
): BulkNode[] =>
    Object.values(nodes).filter(
        (node) =>
            (sectionId ? node.sectionId === sectionId : true) &&
            node.mapping.action === 'create' &&
            !node.syntheticRoot &&
            !isUnderSkippedAncestor(node, nodes)
    );

/** Confirm gate for multi mode: every section resolved, batches picked, snapshots loaded. */
export const selectMultiReadiness = (state: {
    courseSections: Record<string, CourseSection>;
    sectionSnapshots: Record<string, ExistingSnapshot>;
    items: Record<string, BulkItem>;
    nodes: Record<string, BulkNode>;
    fatalErrors: string[];
    options: BulkUploadOptions;
}): { ready: boolean; reason?: string } => {
    if (state.fatalErrors.length > 0) {
        return { ready: false, reason: state.fatalErrors[0] };
    }
    const sections = selectSectionsOrdered(state.courseSections);
    if (sections.length === 0)
        return {
            ready: false,
            reason: `No ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} folders found.`,
        };
    for (const section of sections) {
        if (section.status === 'skipped') continue;
        if (section.status === 'unmatched') {
            return {
                ready: false,
                reason: `Match or skip the folder “${section.topFolderDisplay}”.`,
            };
        }
        if (section.status === 'blocked') {
            return {
                ready: false,
                reason: `Skip or remap the folder “${section.topFolderDisplay}” — you can't edit that ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}.`,
            };
        }
        if (section.status === 'needs-batch' || !section.packageSessionId) {
            return {
                ready: false,
                reason: `Select a batch for “${section.topFolderDisplay}”.`,
            };
        }
        if (section.status === 'loading') {
            return {
                ready: false,
                reason: `Still reading the structure for “${section.topFolderDisplay}”…`,
            };
        }
        if (section.status === 'error') {
            return {
                ready: false,
                reason: `Fix or skip “${section.topFolderDisplay}” (failed to load).`,
            };
        }
        if (section.fatalErrors.length > 0) {
            return { ready: false, reason: section.fatalErrors[0] };
        }
        if (!state.sectionSnapshots[section.id]) {
            return {
                ready: false,
                reason: `Still reading the structure for “${section.topFolderDisplay}”…`,
            };
        }
        if (section.status === 'ready') {
            const unresolved = selectUnresolvedNodes(
                state.nodes,
                section.id,
                state.options.createMissing
            );
            if (unresolved.length > 0) {
                return {
                    ready: false,
                    reason: `Match or skip the folder “${unresolved[0]!.displayName}” in “${section.topFolderDisplay}”.`,
                };
            }
        }
    }
    const readySectionIds = new Set(sections.filter((s) => s.status === 'ready').map((s) => s.id));
    const hasItems = Object.values(state.items).some(
        (i) => i.sectionId && readySectionIds.has(i.sectionId)
    );
    if (!hasItems) {
        return { ready: false, reason: 'No uploadable files in the included folders.' };
    }
    return { ready: true };
};

/** Items grouped by chapter node, each list in deterministic creation order. */
export const groupItemsByChapter = (items: Record<string, BulkItem>): Map<string, BulkItem[]> => {
    const byChapter = new Map<string, BulkItem[]>();
    for (const item of Object.values(items)) {
        const list = byChapter.get(item.chapterNodeId) ?? [];
        list.push(item);
        byChapter.set(item.chapterNodeId, list);
    }
    for (const list of byChapter.values()) {
        list.sort((a, b) => {
            if (a.orderHint !== null || b.orderHint !== null) {
                if (a.orderHint === null) return 1;
                if (b.orderHint === null) return -1;
                if (a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
            }
            return a.fileName.localeCompare(b.fileName) || a.title.localeCompare(b.title);
        });
    }
    return byChapter;
};
