/**
 * The draft being edited (spec 8.3 useLearnerHomeDraft): blocks, settings,
 * the server revision, the selection and the save state. Every edit bumps
 * `editSeq`; useDraftAutosave saves 1.5 s after the last edit with the
 * revision it holds, and a 409 turns into the conflict banner.
 */
import { create } from 'zustand';
import type {
    CheckIssue,
    HomeBlock,
    Layout,
    LayoutSettings,
    TemplateKey,
} from '../-types/learner-home-types';
import { DEFAULT_SETTINGS } from '../-utils/block-factory';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface DraftConflict {
    updatedBy: string | null;
    updatedAt: string | null;
}

interface DraftState {
    layoutId: string | null;
    revision: number;
    baseVersion: number | null;
    templateKey: TemplateKey | null;
    settings: LayoutSettings;
    blocks: HomeBlock[];
    selectedKey: string | null;
    /** Incremented on every edit; the save that covers `editSeq` makes it "saved". */
    editSeq: number;
    savedSeq: number;
    status: SaveStatus;
    conflict: DraftConflict | null;
    /** Errors the server returned on the last save or publish (spec 6.6). */
    serverIssues: CheckIssue[];
    lastError: string | null;

    load: (layout: Layout) => void;
    clear: () => void;
    select: (key: string | null) => void;
    setSettings: (patch: Partial<LayoutSettings>) => void;
    updateBlock: (key: string, update: (block: HomeBlock) => HomeBlock) => void;
    addBlock: (block: HomeBlock, index?: number) => void;
    removeBlock: (key: string) => void;
    moveBlock: (from: number, to: number) => void;
    replaceBlocks: (blocks: HomeBlock[]) => void;

    markSaving: () => void;
    markSaved: (revision: number, coveredSeq: number) => void;
    markError: (message: string, issues?: CheckIssue[]) => void;
    markConflict: (conflict: DraftConflict) => void;
    setRevision: (revision: number) => void;
    setServerIssues: (issues: CheckIssue[]) => void;
}

const EMPTY = {
    layoutId: null,
    revision: 0,
    baseVersion: null,
    templateKey: null,
    settings: DEFAULT_SETTINGS,
    blocks: [] as HomeBlock[],
    selectedKey: null,
    editSeq: 0,
    savedSeq: 0,
    status: 'saved' as SaveStatus,
    conflict: null,
    serverIssues: [] as CheckIssue[],
    lastError: null,
};

/** Every edit: bump the sequence and drop server issues of the edited block. */
function edited(
    state: DraftState,
    patch: Partial<DraftState>,
    touchedKey?: string
): Partial<DraftState> {
    return {
        ...patch,
        editSeq: state.editSeq + 1,
        status: state.status === 'conflict' ? 'conflict' : 'dirty',
        serverIssues: touchedKey
            ? state.serverIssues.filter((i) => i.block_key !== touchedKey)
            : state.serverIssues,
    };
}

export const useLearnerHomeDraft = create<DraftState>((set) => ({
    ...EMPTY,

    load: (layout) =>
        set((state) => ({
            layoutId: layout.id,
            revision: layout.revision,
            baseVersion: layout.base_version,
            templateKey: layout.template_key,
            settings: layout.settings,
            blocks: layout.blocks,
            selectedKey: layout.blocks.some((b) => b.block_key === state.selectedKey)
                ? state.selectedKey
                : layout.blocks[0]?.block_key ?? null,
            editSeq: 0,
            savedSeq: 0,
            status: 'saved',
            conflict: null,
            serverIssues: [],
            lastError: null,
        })),

    clear: () => set({ ...EMPTY }),

    select: (key) => set({ selectedKey: key }),

    setSettings: (patch) => set((s) => edited(s, { settings: { ...s.settings, ...patch } })),

    updateBlock: (key, update) =>
        set((s) =>
            edited(s, { blocks: s.blocks.map((b) => (b.block_key === key ? update(b) : b)) }, key)
        ),

    addBlock: (block, index) =>
        set((s) => {
            const blocks = [...s.blocks];
            blocks.splice(index ?? blocks.length, 0, block);
            return edited(s, { blocks, selectedKey: block.block_key });
        }),

    removeBlock: (key) =>
        set((s) => {
            const idx = s.blocks.findIndex((b) => b.block_key === key);
            const blocks = s.blocks.filter((b) => b.block_key !== key);
            const next = blocks[Math.min(idx, blocks.length - 1)]?.block_key ?? null;
            return edited(
                s,
                {
                    blocks,
                    selectedKey: s.selectedKey === key ? next : s.selectedKey,
                },
                key
            );
        }),

    moveBlock: (from, to) =>
        set((s) => {
            if (
                from === to ||
                from < 0 ||
                to < 0 ||
                from >= s.blocks.length ||
                to >= s.blocks.length
            ) {
                return {};
            }
            const blocks = [...s.blocks];
            const [moved] = blocks.splice(from, 1);
            blocks.splice(to, 0, moved!);
            return edited(s, { blocks });
        }),

    replaceBlocks: (blocks) => set((s) => edited(s, { blocks })),

    markSaving: () => set({ status: 'saving' }),

    markSaved: (revision, coveredSeq) =>
        set((s) => ({
            revision,
            savedSeq: coveredSeq,
            status: s.editSeq > coveredSeq ? 'dirty' : 'saved',
            lastError: null,
            conflict: null,
        })),

    markError: (message, issues) =>
        set((s) => ({
            status: 'error',
            lastError: message,
            serverIssues: issues ?? s.serverIssues,
        })),

    markConflict: (conflict) => set({ status: 'conflict', conflict }),

    setRevision: (revision) => set({ revision }),

    setServerIssues: (issues) => set({ serverIssues: issues }),
}));

/** Unsaved edits exist (or a save is running). */
export const hasUnsavedEdits = (s: Pick<DraftState, 'editSeq' | 'savedSeq'>) =>
    s.editSeq > s.savedSeq;
