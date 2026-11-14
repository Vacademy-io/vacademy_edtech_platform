import {
    Canvas,
    Textbox,
    IText,
    Rect,
    Circle,
    PencilBrush,
    Path,
    FabricObject,
    TPointerEventInfo,
} from 'fabric';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export type EvaluationTool = 'select' | 'pen' | 'tick' | 'cross' | 'text' | 'box' | 'circle';

const DEFAULT_STROKE_WIDTH = 3;

const useFabric = (fabricCanvas: Canvas | null) => {
    const { t } = useTranslation('evaluationCanvas');
    const [isDrawingMode, setIsDrawingMode] = useState(false);
    // Default pen colour is green (the common "tick / correct" annotation colour).
    const [penColor, setPenColorState] = useState('green');
    const [strokeWidth, setStrokeWidthState] = useState(DEFAULT_STROKE_WIDTH);
    const [activeTool, setActiveTool] = useState<EvaluationTool>('select');

    // Stamp tools (Tick/Cross/Box/Circle/Text) read the *live* colour/width via
    // refs, not the state values above — their placement handler is registered
    // once per tool-arm and reused for every click while the tool stays armed, so
    // a stale closure would keep stamping with whatever value was current when the
    // tool was picked, ignoring later slider/colour changes.
    const penColorRef = useRef(penColor);
    const strokeWidthRef = useRef(strokeWidth);

    // The currently-registered "click canvas to stamp a shape" handler, so
    // switching tools always tears down the previous one instead of stacking
    // multiple mouse:down listeners on the canvas.
    const placementHandlerRef = useRef<((opt: TPointerEventInfo) => void) | null>(null);

    const clearPlacementMode = (): void => {
        if (!fabricCanvas) return;
        if (placementHandlerRef.current) {
            fabricCanvas.off('mouse:down', placementHandlerRef.current);
            placementHandlerRef.current = null;
        }
        fabricCanvas.skipTargetFind = false;
    };

    const setPenColor = (color: string): void => {
        penColorRef.current = color;
        setPenColorState(color);
        if (fabricCanvas?.freeDrawingBrush) {
            fabricCanvas.freeDrawingBrush.color = color;
        }
    };

    const setStrokeWidth = (width: number): void => {
        strokeWidthRef.current = width;
        setStrokeWidthState(width);
        if (fabricCanvas?.freeDrawingBrush) {
            fabricCanvas.freeDrawingBrush.width = width;
        }
    };

    // Re-colour / re-weight whatever is currently selected — lets an evaluator
    // lighten or recolour a mark they already placed, not just future ones.
    const applyColorToSelection = (color: string): void => {
        if (!fabricCanvas) return;
        const targets = fabricCanvas.getActiveObjects();
        if (!targets.length) return;
        targets.forEach((obj) => {
            if (obj.type === 'i-text' || obj.type === 'textbox') {
                obj.set('fill', color);
            } else if (obj.stroke) {
                obj.set('stroke', color);
            }
        });
        fabricCanvas.requestRenderAll();
    };

    const updateSelectedStrokeWidth = (width: number): void => {
        if (!fabricCanvas) return;
        const targets = fabricCanvas.getActiveObjects();
        if (!targets.length) return;
        targets.forEach((obj) => {
            if (obj.stroke) obj.set('strokeWidth', width);
        });
        fabricCanvas.requestRenderAll();
    };

    const addTextBox = (): void => {
        armStamp(
            'text',
            (point) =>
                new Textbox('Add Comment', {
                    left: point.x,
                    top: point.y,
                    width: 160,
                    fontSize: 20,
                    fill: 'black',
                    backgroundColor: '#f2eeed', // design-lint-ignore: fabric.js textbox fill — a canvas color value, not a CSS token
                    selectable: true,
                }),
            {
                // One comment at a time: after placing it, drop back to Select so the
                // evaluator can click elsewhere (e.g. to position their cursor in the
                // text) without stamping a second box.
                sticky: false,
                afterPlace: (obj) => {
                    const textbox = obj as Textbox;
                    textbox.enterEditing();
                    textbox.selectAll();
                    fabricCanvas?.requestRenderAll();
                },
            }
        );
    };

    const addPenTool = async (color: string = penColorRef.current): Promise<void> => {
        if (!fabricCanvas) return;
        clearPlacementMode();
        setIsDrawingMode(true);
        fabricCanvas.isDrawingMode = true;
        fabricCanvas.selection = true;
        fabricCanvas.defaultCursor = 'crosshair';
        fabricCanvas.freeDrawingBrush = new PencilBrush(fabricCanvas);
        fabricCanvas.freeDrawingBrush.color = color;
        fabricCanvas.freeDrawingBrush.width = strokeWidthRef.current;
        fabricCanvas.requestRenderAll();
        setPenColor(color);
        setActiveTool('pen');
    };

    // Selection / cursor mode — exit drawing so the evaluator can click, move and
    // resize any annotation that's already on the page.
    const enableSelection = (): void => {
        if (!fabricCanvas) return;
        clearPlacementMode();
        fabricCanvas.isDrawingMode = false;
        setIsDrawingMode(false);
        fabricCanvas.selection = true;
        fabricCanvas.defaultCursor = 'default';
        fabricCanvas.forEachObject((obj) => {
            obj.selectable = true;
            obj.evented = true;
        });
        fabricCanvas.requestRenderAll();
        setActiveTool('select');
    };

    const clearCanvas = (): void => {
        if (!fabricCanvas) return;
        fabricCanvas.clear();
        fabricCanvas.requestRenderAll();
    };

    // Arms a "click the page to stamp a shape at that exact point" tool — used by
    // Tick / Cross / Text / Box / Circle. Replaces the old behaviour of dropping
    // every new mark at a fixed (100, 100) regardless of scroll/zoom/where the
    // evaluator actually clicked.
    const armStamp = (
        tool: EvaluationTool,
        createAt: (point: { x: number; y: number }) => FabricObject,
        opts: { sticky: boolean; afterPlace?: (obj: FabricObject) => void }
    ): void => {
        if (!fabricCanvas) return;
        clearPlacementMode();
        fabricCanvas.isDrawingMode = false;
        setIsDrawingMode(false);
        fabricCanvas.selection = false;
        // Ignore whatever's already on the page while armed, so every click
        // stamps a new shape instead of trying to select/drag an existing one.
        fabricCanvas.skipTargetFind = true;
        fabricCanvas.defaultCursor = 'crosshair';
        setActiveTool(tool);

        const handler = (opt: TPointerEventInfo) => {
            const point = opt.scenePoint;
            const obj = createAt(point);
            fabricCanvas.add(obj);
            fabricCanvas.setActiveObject(obj);
            fabricCanvas.requestRenderAll();
            opts.afterPlace?.(obj);
            if (!opts.sticky) {
                enableSelection();
            }
        };
        placementHandlerRef.current = handler;
        fabricCanvas.on('mouse:down', handler);
    };

    // Crisp vector tick — drawn as a stroked path so it looks like a real mark
    // (and scales/resizes cleanly) instead of a flat text glyph.
    const addTick = (): void => {
        armStamp(
            'tick',
            (point) =>
                new Path('M 4 18 L 14 30 L 34 4', {
                    left: point.x - 17,
                    top: point.y - 15,
                    stroke: 'green',
                    strokeWidth: strokeWidthRef.current,
                    fill: '',
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    selectable: true,
                }),
            { sticky: true }
        );
    };

    // Crisp vector cross (two stroked strokes in one path).
    const addCross = (): void => {
        armStamp(
            'cross',
            (point) =>
                new Path('M 4 4 L 30 30 M 30 4 L 4 30', {
                    left: point.x - 17,
                    top: point.y - 17,
                    stroke: 'red',
                    strokeWidth: strokeWidthRef.current,
                    fill: '',
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    selectable: true,
                }),
            { sticky: true }
        );
    };

    const addNumber = async (num: string): Promise<void> => {
        if (!fabricCanvas) return;
        const text = new IText(num, {
            left: 100,
            top: window.scrollY ?? 100,
            fontSize: 50,
            fill: 'blue',
            selectable: true,
            editable: false,
        });
        fabricCanvas.add(text);
        fabricCanvas.requestRenderAll();
    };

    const addRectangle = (): void => {
        armStamp(
            'box',
            (point) =>
                new Rect({
                    left: point.x - 50,
                    top: point.y - 30,
                    width: 100,
                    height: 60,
                    angle: 0,
                    fill: 'transparent',
                    stroke: penColorRef.current,
                    strokeWidth: strokeWidthRef.current,
                    selectable: true,
                }),
            { sticky: true }
        );
    };

    const addCircle = (): void => {
        armStamp(
            'circle',
            (point) => {
                const radius = 40;
                return new Circle({
                    left: point.x - radius,
                    top: point.y - radius,
                    radius,
                    fill: 'transparent',
                    stroke: penColorRef.current,
                    strokeWidth: strokeWidthRef.current,
                    selectable: true,
                });
            },
            { sticky: true }
        );
    };

    function deleteSelectedShape() {
        // getActiveObjects() returns every selected object, so multi-select
        // (an ActiveSelection) is handled too — removing the wrapper alone leaves
        // the underlying objects on the canvas.
        const activeObjects = fabricCanvas?.getActiveObjects();
        if (fabricCanvas && activeObjects && activeObjects.length > 0) {
            activeObjects.forEach((obj) => fabricCanvas.remove(obj));
            fabricCanvas.discardActiveObject();
            fabricCanvas.requestRenderAll();
        } else {
            toast.error(t('deleteNoSelection'));
        }
    }

    return {
        isDrawingMode,
        setIsDrawingMode,
        penColor,
        setPenColor,
        strokeWidth,
        setStrokeWidth,
        activeTool,
        applyColorToSelection,
        updateSelectedStrokeWidth,
        addTextBox,
        addPenTool,
        enableSelection,
        addTick,
        addCross,
        clearCanvas,
        addNumber,
        addRectangle,
        addCircle,
        deleteSelectedShape,
    };
};

export default useFabric;
