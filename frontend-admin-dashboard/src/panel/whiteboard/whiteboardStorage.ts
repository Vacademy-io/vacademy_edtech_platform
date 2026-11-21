/**
 * Device-local autosave for the panel whiteboard (localStorage key
 * PANEL_STORAGE_KEYS.whiteboardScene). There is no backend whiteboard API yet
 * (Phase 0 is device-only).
 *
 * The stored value is a COMPACT Excalidraw scene document
 * ({type:'excalidraw', version:2, elements, appState, files}). We do not use
 * serializeAsJSON: it pretty-prints with 2-space indents, which puts every
 * freedraw point on four lines and roughly triples the size against the
 * ~5 MB WebView quota. restore() repairs/migrates whatever we read back.
 */
import { restore } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import { PANEL_STORAGE_KEYS } from '../config';
import { readString, removeKey, writeString } from '../lib/storage';

/** lib/storage skips writes above this; mirrored here to report "too big" honestly. */
export const WHITEBOARD_MAX_CHARS = 2 * 1024 * 1024;

export interface StoredBoard {
    elements: readonly ExcalidrawElement[];
    viewBackgroundColor: string | null;
    files: BinaryFiles;
}

export type LoadResult =
    | { status: 'empty' }
    | { status: 'restored'; board: StoredBoard }
    | { status: 'corrupt'; error: string };

export function loadBoard(): LoadResult {
    const raw = readString(PANEL_STORAGE_KEYS.whiteboardScene);
    if (!raw) return { status: 'empty' };
    try {
        const parsed = JSON.parse(raw) as {
            elements?: unknown;
            appState?: { viewBackgroundColor?: unknown } | null;
            files?: unknown;
        };
        if (!parsed || !Array.isArray(parsed.elements)) {
            throw new Error('Stored whiteboard has no elements array');
        }
        const restored = restore(
            {
                elements: parsed.elements as ExcalidrawElement[],
                appState: null,
                files: (parsed.files as BinaryFiles | undefined) ?? {},
            },
            null,
            null
        );
        const background = parsed.appState?.viewBackgroundColor;
        return {
            status: 'restored',
            board: {
                elements: restored.elements,
                viewBackgroundColor: typeof background === 'string' ? background : null,
                files: restored.files,
            },
        };
    } catch (error) {
        return { status: 'corrupt', error: error instanceof Error ? error.message : String(error) };
    }
}

export type SaveResult = { ok: true; chars: number } | { ok: false; reason: 'too-big' | 'failed' };

export function saveBoard(
    elements: readonly ExcalidrawElement[],
    appState: Pick<AppState, 'viewBackgroundColor'>,
    files: BinaryFiles
): SaveResult {
    const live = elements.filter((element) => !element.isDeleted);
    if (live.length === 0) {
        removeKey(PANEL_STORAGE_KEYS.whiteboardScene);
        return { ok: true, chars: 0 };
    }
    // Only keep files referenced by live elements (images are off on panels, so usually none).
    const keptFiles: BinaryFiles = {};
    live.forEach((element) => {
        const fileId = 'fileId' in element ? element.fileId : null;
        if (fileId && files[fileId]) keptFiles[fileId] = files[fileId];
    });
    let raw: string;
    try {
        raw = JSON.stringify({
            type: 'excalidraw',
            version: 2,
            source: 'vacademy-classroom',
            elements: live,
            appState: { viewBackgroundColor: appState.viewBackgroundColor },
            files: keptFiles,
        });
    } catch {
        return { ok: false, reason: 'failed' };
    }
    if (raw.length > WHITEBOARD_MAX_CHARS) return { ok: false, reason: 'too-big' };
    return writeString(PANEL_STORAGE_KEYS.whiteboardScene, raw)
        ? { ok: true, chars: raw.length }
        : { ok: false, reason: 'failed' };
}

export function discardStoredBoard(): void {
    removeKey(PANEL_STORAGE_KEYS.whiteboardScene);
}
