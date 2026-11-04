/**
 * Full-screen touch whiteboard for classroom panels (works signed out).
 *
 * The vendored Excalidraw fork (via the @excalidraw/* aliases) does the
 * drawing: one finger draws, two fingers pinch-zoom / pan (built in), and an
 * active stylus (pointerType 'pen') auto-enables Excalidraw's pen mode, where
 * touches only pan — the built-in palm rejection. penMode stays OFF by default
 * because IR/capacitive panels report fingers AND passive styluses as 'touch'
 * (forcing it on would block all drawing).
 *
 * Excalidraw's own small chrome is hidden (whiteboard.css); the panel drives it
 * through the imperative API from a 10-foot toolbar. Undo/redo use the fork's
 * additive api.undo()/api.redo() (owner decision 8).
 *
 * Autosave: device-local (whiteboardStorage.ts), debounced 2 s after the scene
 * version changes, flushed on pagehide / hidden / unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, DownloadSimple, FrameCorners, Trash } from '@phosphor-icons/react';
import {
    CaptureUpdateAction,
    Excalidraw,
    getSceneVersion,
    newElementWith,
} from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
    AppState,
    BinaryFiles,
    ExcalidrawImperativeAPI,
    ExcalidrawInitialDataState,
    ExcalidrawProps,
} from '@excalidraw/excalidraw/types';
import { MyButton } from '@/components/design-system/button';
import { PanelConfirmDialog } from '../components/PanelConfirmDialog';
import { PanelFullscreenButton, PanelStage } from '../components/PanelStage';
import { goBack } from '../router';
import { PanelWhiteboardToolbar } from './PanelWhiteboardToolbar';
import { EmptyBoardError, exportPng } from './whiteboardExport';
import { discardStoredBoard, loadBoard, saveBoard, type LoadResult } from './whiteboardStorage';
import {
    BOARD_BACKGROUND,
    DEFAULT_INK,
    applyTool,
    panelToolFromExcalidraw,
    strokeStyleFor,
    type InkColourKey,
    type InkSelection,
    type WhiteboardTool,
} from './whiteboardTools';
import './whiteboard.css';

const AUTOSAVE_DELAY_MS = 2000;

// Module constant so Excalidraw's memo comparison sees the same object every render.
const UI_OPTIONS: ExcalidrawProps['UIOptions'] = {
    canvasActions: {
        loadScene: false,
        export: false,
        saveToActiveFile: false,
        saveAsImage: false,
        toggleTheme: false,
        changeViewBackgroundColor: false,
        clearCanvas: true,
    },
    tools: { image: false },
};

const ICON_ACTION_CLASS = 'size-16 shrink-0 bg-card shadow-md [&_svg]:size-8';
// sm:min-w-0 drops MyButton's large-scale sm:min-w-60 (labelled actions size to content).
const LABEL_ACTION_CLASS = 'h-16 shrink-0 bg-card px-6 shadow-md sm:min-w-0 [&_svg]:size-7';

function buildInitialData(result: LoadResult): ExcalidrawInitialDataState {
    const board = result.status === 'restored' ? result.board : null;
    const elements = board ? board.elements : [];
    return {
        elements,
        files: board ? board.files : {},
        appState: {
            viewBackgroundColor: board?.viewBackgroundColor ?? BOARD_BACKGROUND,
            ...strokeStyleFor('pen', DEFAULT_INK),
            activeTool: {
                type: 'freedraw',
                customType: null,
                locked: false,
                lastActiveTool: null,
            },
            penMode: false,
            gridModeEnabled: false,
        },
        scrollToContent: elements.length > 0,
    };
}

function countLive(elements: readonly ExcalidrawElement[]): number {
    let count = 0;
    for (const element of elements) if (!element.isDeleted) count += 1;
    return count;
}

interface LatestScene {
    elements: readonly ExcalidrawElement[];
    appState: Pick<AppState, 'viewBackgroundColor'>;
    files: BinaryFiles;
    version: number;
}

export function PanelWhiteboard() {
    const { t } = useTranslation('whiteboard');
    const { t: tPanel } = useTranslation('panel');

    const [loadResult] = useState(loadBoard);
    const [initialData] = useState(() => buildInitialData(loadResult));

    const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
    const [tool, setTool] = useState<WhiteboardTool>('pen');
    const [ink, setInk] = useState<InkSelection>(DEFAULT_INK);
    const [liveCount, setLiveCount] = useState(() =>
        loadResult.status === 'restored' ? countLive(loadResult.board.elements) : 0
    );
    const [clearOpen, setClearOpen] = useState(false);

    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const toolRef = useRef<WhiteboardTool>('pen');
    const liveCountRef = useRef(liveCount);
    const latestRef = useRef<LatestScene | null>(null);
    // Version of what is already in storage: the restored scene needs no re-save.
    const savedVersionRef = useRef<number>(getSceneVersion(initialData.elements ?? []));
    const savedCharsRef = useRef(0);
    const saveTimerRef = useRef<number | null>(null);
    const tooBigWarnedRef = useRef(false);
    const surfaceRef = useRef<HTMLDivElement | null>(null);

    // A stored board that cannot be parsed is dropped (the next save overwrites it anyway).
    useEffect(() => {
        if (loadResult.status === 'corrupt') {
            console.warn('[panel/whiteboard] stored board unreadable:', loadResult.error);
            discardStoredBoard();
            toast.error(t('toasts.restoreFailed'));
        }
    }, [loadResult, t]);

    const flushSave = useCallback(() => {
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const latest = latestRef.current;
        if (!latest || latest.version === savedVersionRef.current) return;
        const result = saveBoard(latest.elements, latest.appState, latest.files);
        if (result.ok) {
            savedVersionRef.current = latest.version;
            savedCharsRef.current = result.chars;
            tooBigWarnedRef.current = false;
        } else if (result.reason === 'too-big' && !tooBigWarnedRef.current) {
            tooBigWarnedRef.current = true;
            toast.warning(t('toasts.tooBigToKeep'));
        }
    }, [t]);

    const handleApi = useCallback((instance: ExcalidrawImperativeAPI) => {
        apiRef.current = instance;
        // Excalidraw calls this from its constructor (mid-render): defer the state update.
        window.setTimeout(() => setApi(instance), 0);
    }, []);

    const handleChange = useCallback(
        (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
            const nextTool = panelToolFromExcalidraw(appState.activeTool.type, toolRef.current);
            if (nextTool && nextTool !== toolRef.current) {
                toolRef.current = nextTool;
                setTool(nextTool);
            }

            const version = getSceneVersion(elements);
            latestRef.current = {
                elements,
                appState: { viewBackgroundColor: appState.viewBackgroundColor },
                files,
                version,
            };
            if (version === savedVersionRef.current) return;

            const count = countLive(elements);
            if (count !== liveCountRef.current) {
                liveCountRef.current = count;
                setLiveCount(count);
            }
            if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = window.setTimeout(flushSave, AUTOSAVE_DELAY_MS);
        },
        [flushSave]
    );

    // Flush on app background / page unload / leaving the screen.
    useEffect(() => {
        const onHidden = () => {
            if (document.visibilityState === 'hidden') flushSave();
        };
        window.addEventListener('pagehide', flushSave);
        document.addEventListener('visibilitychange', onHidden);
        return () => {
            window.removeEventListener('pagehide', flushSave);
            document.removeEventListener('visibilitychange', onHidden);
            flushSave();
        };
    }, [flushSave]);

    // Long-press on a touch panel fires `contextmenu`; on Chrome < 92 it is a
    // MouseEvent without pointerType, so Excalidraw's touch guard misses it and
    // opens its tiny desktop menu mid-lesson. Swallow it before React sees it.
    useEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return undefined;
        const block = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        surface.addEventListener('contextmenu', block, true);
        return () => surface.removeEventListener('contextmenu', block, true);
    }, []);

    // Debug hooks for emulator checks (inspect.sh).
    useEffect(() => {
        window.__PANEL_DEBUG__ = {
            ...(window.__PANEL_DEBUG__ || {}),
            whiteboardElementCount: () => liveCountRef.current,
            whiteboardState: () => ({
                ready: !!apiRef.current,
                tool: toolRef.current,
                activeTool: apiRef.current?.getAppState().activeTool.type ?? null,
                strokeColor: apiRef.current?.getAppState().currentItemStrokeColor ?? null,
                penMode: apiRef.current?.getAppState().penMode ?? null,
                elementCount: liveCountRef.current,
                savedChars: savedCharsRef.current,
            }),
            whiteboardApi: () => apiRef.current,
        };
        return () => {
            const debug = window.__PANEL_DEBUG__;
            if (!debug) return;
            delete debug.whiteboardElementCount;
            delete debug.whiteboardState;
            delete debug.whiteboardApi;
        };
    }, []);

    const changeTool = (next: WhiteboardTool) => {
        toolRef.current = next;
        setTool(next);
        if (api) applyTool(api, next, ink);
    };

    const changeColour = (colour: InkColourKey) => {
        // A colour tap always means "write with this": keep the highlighter, else use the pen.
        const next: WhiteboardTool = tool === 'highlighter' ? 'highlighter' : 'pen';
        const nextInk: InkSelection =
            next === 'highlighter' ? { ...ink, highlighter: colour } : { ...ink, pen: colour };
        setInk(nextInk);
        toolRef.current = next;
        setTool(next);
        if (api) applyTool(api, next, nextInk);
    };

    const clearBoard = () => {
        if (!api) return;
        const elements = api.getSceneElementsIncludingDeleted();
        // Mark deleted (not resetScene) so Undo can bring the board back.
        api.updateScene({
            elements: elements.map((element) =>
                element.isDeleted ? element : newElementWith(element, { isDeleted: true })
            ),
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
    };

    const fitToContent = () => {
        if (!api) return;
        api.scrollToContent(undefined, {
            fitToViewport: true,
            viewportZoomFactor: 0.9,
            animate: true,
        });
    };

    const savePicture = async () => {
        if (!api) return;
        try {
            const outcome = await exportPng(api);
            if (outcome.where === 'device') {
                // break-all: the device path is one long token and overflowed the
                // toast card on panel_api28 (it only breaks at the space in the folder name).
                toast.success(t('toasts.savedDevice', { path: outcome.displayPath }), {
                    className: 'break-all',
                });
            } else {
                toast.success(t('toasts.savedDownload', { name: outcome.fileName }));
            }
        } catch (error) {
            if (error instanceof EmptyBoardError) {
                toast.info(t('toasts.nothingToSave'));
                return;
            }
            console.error('[panel/whiteboard] save picture failed', error);
            toast.error(t('toasts.saveFailed'));
        }
    };

    const ready = api !== null;
    const empty = liveCount === 0;

    return (
        <PanelStage className="panel-whiteboard">
            <div ref={surfaceRef} className="relative min-h-0 flex-1">
                <div className="panel-whiteboard-canvas panel-touch-surface">
                    <Excalidraw
                        excalidrawAPI={handleApi}
                        initialData={initialData}
                        onChange={handleChange}
                        UIOptions={UI_OPTIONS}
                        zenModeEnabled
                        langCode="en"
                        theme="light"
                        handleKeyboardGlobally={false}
                        autoFocus={false}
                    />
                </div>

                {ready && empty && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center space-y-2 p-8 text-center">
                        <p className="text-h2 text-neutral-400">{t('emptyHint.title')}</p>
                        <p className="text-title text-neutral-400">{t('emptyHint.body')}</p>
                    </div>
                )}

                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
                    <div className="pointer-events-auto">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="large"
                            className={ICON_ACTION_CLASS}
                            aria-label={tPanel('common.back')}
                            title={tPanel('common.back')}
                            onClick={goBack}
                        >
                            <ArrowLeft size={32} />
                        </MyButton>
                    </div>
                    <div className="pointer-events-auto flex items-center space-x-3">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="large"
                            className={ICON_ACTION_CLASS}
                            aria-label={t('actions.fit')}
                            title={t('actions.fit')}
                            disable={!ready || empty}
                            onClick={fitToContent}
                        >
                            <FrameCorners size={32} />
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large"
                            className={LABEL_ACTION_CLASS}
                            disable={!ready || empty}
                            onClick={() => setClearOpen(true)}
                        >
                            <span className="flex items-center space-x-2">
                                <Trash size={28} aria-hidden />
                                <span>{t('actions.clear')}</span>
                            </span>
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="large"
                            className="h-16 shrink-0 px-6 shadow-md sm:min-w-0 [&_svg]:size-7"
                            disable={!ready}
                            onAsyncClick={savePicture}
                        >
                            <span className="flex items-center space-x-2">
                                <DownloadSimple size={28} aria-hidden />
                                <span>{t('actions.save')}</span>
                            </span>
                        </MyButton>
                        <PanelFullscreenButton className="bg-card shadow-md [&_svg]:size-8" />
                    </div>
                </div>

                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-4">
                    <PanelWhiteboardToolbar
                        tool={tool}
                        ink={ink}
                        disabled={!ready}
                        onToolChange={changeTool}
                        onColourChange={changeColour}
                        onUndo={() => api?.undo()}
                        onRedo={() => api?.redo()}
                    />
                </div>
            </div>

            <PanelConfirmDialog
                open={clearOpen}
                onOpenChange={setClearOpen}
                title={t('clearDialog.title')}
                description={t('clearDialog.body')}
                confirmLabel={t('clearDialog.confirm')}
                onConfirm={clearBoard}
            />
        </PanelStage>
    );
}

export default PanelWhiteboard;
