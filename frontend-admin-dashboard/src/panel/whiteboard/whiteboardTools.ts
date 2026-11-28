/**
 * Whiteboard tool presets and ink palettes.
 *
 * The hex values below are CANVAS CONTENT (the colour of the ink written into
 * the Excalidraw scene and the exported PNG), not UI styling, so they are not
 * design tokens. They are Excalidraw's own open-color picks so boards look the
 * same when opened in the admin slide editor.
 */
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

export type WhiteboardTool = 'pen' | 'highlighter' | 'eraser' | 'pan' | 'select';

export const WHITEBOARD_TOOLS: readonly WhiteboardTool[] = [
    'pen',
    'highlighter',
    'eraser',
    'pan',
    'select',
];

export type InkColourKey =
    | 'black'
    | 'red'
    | 'blue'
    | 'green'
    | 'orange'
    | 'violet'
    | 'yellow'
    | 'pink';

export interface InkColour {
    key: InkColourKey;
    hex: string;
}

export const PEN_COLOURS: readonly InkColour[] = [
    { key: 'black', hex: '#1e1e1e' }, // design-lint-ignore: canvas ink colour
    { key: 'red', hex: '#e03131' }, // design-lint-ignore: canvas ink colour
    { key: 'blue', hex: '#1971c2' }, // design-lint-ignore: canvas ink colour
    { key: 'green', hex: '#2f9e44' }, // design-lint-ignore: canvas ink colour
    { key: 'orange', hex: '#f08c00' }, // design-lint-ignore: canvas ink colour
    { key: 'violet', hex: '#6741d9' }, // design-lint-ignore: canvas ink colour
];

export const HIGHLIGHTER_COLOURS: readonly InkColour[] = [
    { key: 'yellow', hex: '#fab005' }, // design-lint-ignore: canvas ink colour
    { key: 'green', hex: '#40c057' }, // design-lint-ignore: canvas ink colour
    { key: 'pink', hex: '#f06595' }, // design-lint-ignore: canvas ink colour
    { key: 'blue', hex: '#339af0' }, // design-lint-ignore: canvas ink colour
    { key: 'orange', hex: '#fd7e14' }, // design-lint-ignore: canvas ink colour
    { key: 'violet', hex: '#845ef7' }, // design-lint-ignore: canvas ink colour
];

/** Board background (scene content). */
export const BOARD_BACKGROUND = '#ffffff'; // design-lint-ignore: canvas background colour

/** Excalidraw freedraw widths: 1 thin, 2 bold, 4 extra bold (rendered at width × 4.25 px). */
export const PEN_STROKE_WIDTH = 2;
export const HIGHLIGHTER_STROKE_WIDTH = 4;
export const HIGHLIGHTER_OPACITY = 40;

export interface InkSelection {
    pen: InkColourKey;
    highlighter: InkColourKey;
}

export const DEFAULT_INK: InkSelection = { pen: 'black', highlighter: 'yellow' };

export function paletteFor(tool: WhiteboardTool): readonly InkColour[] {
    return tool === 'highlighter' ? HIGHLIGHTER_COLOURS : PEN_COLOURS;
}

export function colourHex(palette: readonly InkColour[], key: InkColourKey): string {
    const found = palette.find((colour) => colour.key === key) ?? palette[0];
    return found ? found.hex : BOARD_BACKGROUND;
}

type ExcalidrawToolType = 'freedraw' | 'eraser' | 'hand' | 'selection';

export function excalidrawToolFor(tool: WhiteboardTool): ExcalidrawToolType {
    switch (tool) {
        case 'pen':
        case 'highlighter':
            return 'freedraw';
        case 'eraser':
            return 'eraser';
        case 'pan':
            return 'hand';
        default:
            return 'selection';
    }
}

/** The "current item" style Excalidraw applies to the next stroke. */
export function strokeStyleFor(tool: WhiteboardTool, ink: InkSelection) {
    if (tool === 'highlighter') {
        return {
            currentItemStrokeColor: colourHex(HIGHLIGHTER_COLOURS, ink.highlighter),
            currentItemStrokeWidth: HIGHLIGHTER_STROKE_WIDTH,
            currentItemOpacity: HIGHLIGHTER_OPACITY,
        };
    }
    return {
        currentItemStrokeColor: colourHex(PEN_COLOURS, ink.pen),
        currentItemStrokeWidth: PEN_STROKE_WIDTH,
        currentItemOpacity: 100,
    };
}

/** Switch Excalidraw to the panel tool and set the ink style for the next stroke. */
export function applyTool(
    api: ExcalidrawImperativeAPI,
    tool: WhiteboardTool,
    ink: InkSelection
): void {
    api.updateScene({ appState: strokeStyleFor(tool, ink) });
    api.setActiveTool({ type: excalidrawToolFor(tool) });
}

/** Map Excalidraw's active tool back to the panel tool (null = leave the toolbar as is). */
export function panelToolFromExcalidraw(
    type: string,
    current: WhiteboardTool
): WhiteboardTool | null {
    switch (type) {
        case 'freedraw':
            return current === 'pen' || current === 'highlighter' ? current : 'pen';
        case 'eraser':
            return 'eraser';
        case 'hand':
            return 'pan';
        case 'selection':
            return 'select';
        default:
            return null;
    }
}
