/**
 * Static Excalidraw scene renderer shared by Volt and the lesson PRESENTATION
 * player. The scene is drawn once with exportToCanvas (@excalidraw/utils/export
 * → scene/export.ts, which awaits the element fonts first), contain-fitted to
 * the container at device-pixel resolution, encoded to PNG and shown as an <img>.
 *
 * Why an <img> and not the canvas itself:
 *   - on the Android 9 / Chrome 66 emulator a GPU-accelerated 2D canvas larger
 *     than 256x256 never composites (blank), while images always do; weak panel
 *     GPUs are the same family of risk;
 *   - a cached PNG is ~100-300 KB instead of a 5-30 MB RGBA canvas, which
 *     matters on 2 GB panels.
 *
 * No interactive Excalidraw instance: nothing to pan or zoom by accident while
 * presenting. Rendered slides are cached (current ± neighbours) by `cacheKey` +
 * size, so stepping back and forth is instant. Re-renders on container resize.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleNotch, ImageBroken } from '@phosphor-icons/react';
import { exportToCanvas } from '@excalidraw/utils/export';
import { restoreElements } from '@excalidraw/excalidraw/data/restore';
import { Fonts, getLineHeight } from '@excalidraw/excalidraw/fonts';
import {
    getContainerElement,
    redrawTextBoundingBox,
} from '@excalidraw/excalidraw/element/textElement';
import { isTextElement } from '@excalidraw/excalidraw/element/typeChecks';
import { arrayToMap } from '@excalidraw/excalidraw/utils';
import type { ExcalidrawElement, NonDeleted } from '@excalidraw/excalidraw/element/types';
import { cn } from '@/lib/utils';
import type { PanelSceneData } from './types';

/** Longest bitmap side in device pixels (4K panels at DPR 1 stay sharp). */
const MAX_BITMAP_SIDE = 3840;
const CACHE_LIMIT = 6;
const EXPORT_PADDING = 24;

interface RenderedScene {
    url: string;
    width: number;
    height: number;
}
type RenderResult = RenderedScene | null;
const cache = new Map<string, Promise<RenderResult>>();

/**
 * Elements ready for export:
 *  1. the restore the editor/viewer runs on load (App.tsx:2338, `repairBindings`):
 *     stored decks (AI-generated ones especially) have bound text whose
 *     container does not list it in boundElements, and exportToCanvas would
 *     drop that text;
 *  2. fonts loaded, then every bound text re-wrapped and re-positioned inside
 *     its container (redrawTextBoundingBox, what the editor does when text is
 *     edited). Stored AI text is often one unwrapped line that the canvas
 *     clips to the container width; a classroom needs it readable.
 */
async function prepareElements(scene: PanelSceneData): Promise<NonDeleted<ExcalidrawElement>[]> {
    const live = scene.elements
        .filter((element) => element && !element.isDeleted)
        .map((element) =>
            // No stored lineHeight: restore would derive it from the stored box
            // height (a legacy single-line heuristic), giving multi-line wraps a
            // huge line spacing. Use the font's default instead.
            isTextElement(element) && element.containerId && !element.lineHeight
                ? { ...element, lineHeight: getLineHeight(element.fontFamily) }
                : element
        );
    const restored = restoreElements(live, null, { repairBindings: true });
    await Fonts.loadElementsFonts(restored);
    const elementsMap = arrayToMap(restored);
    restored.forEach((element) => {
        if (!isTextElement(element) || !element.containerId || element.isDeleted) return;
        const container = getContainerElement(element, elementsMap);
        if (!container) return;
        try {
            redrawTextBoundingBox(element, container, elementsMap, false);
        } catch (error) {
            console.warn('[panel/volt] could not re-wrap bound text', error);
        }
    });
    return restored.filter((element) => !element.isDeleted) as NonDeleted<ExcalidrawElement>[];
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))),
            'image/png'
        );
    });
}

async function renderScene(
    scene: PanelSceneData,
    widthPx: number,
    heightPx: number
): Promise<RenderResult> {
    const elements = await prepareElements(scene);
    if (elements.length === 0) return null;
    const canvas = await exportToCanvas({
        elements,
        appState: { ...scene.appState, exportBackground: true },
        files: scene.files,
        exportPadding: EXPORT_PADDING,
        getDimensions: (width: number, height: number) => {
            const fit = Math.min(widthPx / width, heightPx / height);
            const cap = MAX_BITMAP_SIDE / Math.max(width, height);
            const scale = Math.max(0.05, Math.min(fit, cap));
            return {
                width: Math.max(1, Math.round(width * scale)),
                height: Math.max(1, Math.round(height * scale)),
                scale,
            };
        },
    });
    const blob = await canvasToPng(canvas);
    const result = { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
    // Release the bitmap now rather than at GC time.
    canvas.width = 0;
    canvas.height = 0;
    return result;
}

function release(job: Promise<RenderResult>): void {
    job.then((result) => {
        if (result) URL.revokeObjectURL(result.url);
    }).catch(() => undefined);
}

function getOrRender(
    key: string,
    scene: PanelSceneData,
    widthPx: number,
    heightPx: number
): Promise<RenderResult> {
    const cacheKey = `${key}|${widthPx}x${heightPx}`;
    const hit = cache.get(cacheKey);
    if (hit) {
        // Refresh LRU position.
        cache.delete(cacheKey);
        cache.set(cacheKey, hit);
        return hit;
    }
    const job = renderScene(scene, widthPx, heightPx);
    job.catch(() => cache.delete(cacheKey));
    cache.set(cacheKey, job);
    while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        const evicted = cache.get(oldest);
        cache.delete(oldest);
        if (evicted) release(evicted);
    }
    return job;
}

/** Drop every cached slide image (e.g. when leaving Volt). */
export function clearSceneCache(): void {
    cache.forEach((job) => release(job));
    cache.clear();
}

export interface PanelSceneViewProps {
    scene: PanelSceneData;
    /** Stable id for caching (slide id). Without it nothing is cached across mounts. */
    cacheKey?: string;
    /** Scenes to render into the cache after this one (next / previous slide). */
    prefetch?: { cacheKey: string; scene: PanelSceneData }[];
    className?: string;
}

type ViewState = 'loading' | 'ready' | 'blank' | 'error';

export function PanelSceneView({ scene, cacheKey, prefetch, className }: PanelSceneViewProps) {
    const { t } = useTranslation('volt');
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    const [state, setState] = useState<ViewState>('loading');
    const [image, setImage] = useState<{ url: string; w: number; h: number } | null>(null);
    const fallbackKey = useRef(`scene-${Math.random().toString(36).slice(2)}`);

    // Container size (ResizeObserver: Chrome 64), debounced.
    useEffect(() => {
        const element = containerRef.current;
        if (!element) return undefined;
        let timer: number | undefined;
        const measure = () => {
            const rect = element.getBoundingClientRect();
            const w = Math.floor(rect.width);
            const h = Math.floor(rect.height);
            if (w > 0 && h > 0) {
                setSize((previous) =>
                    previous && previous.w === w && previous.h === h ? previous : { w, h }
                );
            }
        };
        measure();
        const observer = new ResizeObserver(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(measure, 120);
        });
        observer.observe(element);
        return () => {
            window.clearTimeout(timer);
            observer.disconnect();
        };
    }, []);

    const key = cacheKey ?? fallbackKey.current;

    useEffect(() => {
        if (!size) return undefined;
        let cancelled = false;
        const dpr = window.devicePixelRatio || 1;
        const widthPx = Math.round(size.w * dpr);
        const heightPx = Math.round(size.h * dpr);
        setState('loading');
        getOrRender(key, scene, widthPx, heightPx)
            .then((result) => {
                if (cancelled) return;
                if (!result) {
                    setImage(null);
                    setState('blank');
                    return;
                }
                setImage({ url: result.url, w: result.width / dpr, h: result.height / dpr });
                setState('ready');
                // Warm the neighbours once the visible slide is on screen.
                (prefetch || []).forEach((item) => {
                    getOrRender(item.cacheKey, item.scene, widthPx, heightPx).catch(
                        () => undefined
                    );
                });
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                console.error('[panel/volt] scene render failed', error);
                setState('error');
            });
        return () => {
            cancelled = true;
        };
        // `prefetch` is intentionally not a dependency: it changes identity every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, scene, size]);

    return (
        <div
            ref={containerRef}
            className={cn('relative flex size-full items-center justify-center', className)}
        >
            {state === 'ready' && image && (
                <img
                    src={image.url}
                    alt=""
                    draggable={false}
                    className="block rounded-md shadow-sm"
                    // Computed bitmap size: device pixels / DPR (contain-fit), not a design value.
                    style={{ width: image.w, height: image.h }} // design-lint-ignore: computed size
                />
            )}
            {state === 'loading' && (
                <CircleNotch size={48} className="animate-spin text-neutral-400" aria-hidden />
            )}
            {state === 'blank' && <div className="size-full rounded-md bg-card" />}
            {state === 'error' && (
                <div className="flex flex-col items-center space-y-3 text-center">
                    <ImageBroken size={64} className="text-neutral-400" aria-hidden />
                    <p className="text-title text-neutral-500">{t('slide.drawFailed')}</p>
                </div>
            )}
        </div>
    );
}

export default PanelSceneView;
