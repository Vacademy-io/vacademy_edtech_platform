/**
 * Save the board as a PNG with the scene embedded (exportEmbedScene), so the
 * picture can be dropped back into Excalidraw later. APK: PanelDevice.saveImage
 * (Pictures/Vacademy Classroom); web: a browser download.
 *
 * Never exportToSvg here: it loads the font-subset wasm chunk.
 */
import { exportToBlob, MIME_TYPES } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { saveImage, type SaveImageOutcome } from '../lib/native';

/**
 * Old panel WebViews cap canvas size (often 4096 px a side / ~16 MP); larger
 * boards are scaled down to fit instead of failing to export.
 */
const MAX_EXPORT_SIDE = 4096;

function pad(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

export function whiteboardFileName(now: Date = new Date()): string {
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `whiteboard-${date}-${time}.png`;
}

export class EmptyBoardError extends Error {
    constructor() {
        super('The board is empty');
        this.name = 'EmptyBoardError';
    }
}

export async function exportPng(api: ExcalidrawImperativeAPI): Promise<SaveImageOutcome> {
    const elements = api.getSceneElements();
    if (elements.length === 0) throw new EmptyBoardError();
    const appState = api.getAppState();
    const blob = await exportToBlob({
        elements,
        appState: {
            ...appState,
            exportBackground: true,
            exportEmbedScene: true,
            exportScale: Math.min(2, window.devicePixelRatio || 1),
        },
        files: api.getFiles(),
        mimeType: MIME_TYPES.png,
        maxWidthOrHeight: MAX_EXPORT_SIDE,
        exportPadding: 32,
    });
    return saveImage(blob, whiteboardFileName());
}
