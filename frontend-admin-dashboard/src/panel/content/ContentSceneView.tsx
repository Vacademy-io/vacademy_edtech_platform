/**
 * Excalidraw PRESENTATION lesson slide.
 *
 * Loads the scene JSON (document_slide.published_data is a media file id →
 * signed URL → {elements, appState, files}, as slides/-components/
 * SlideEditor.tsx:101 does) and draws it with Volt's shared static renderer
 * (../volt/PanelSceneView: exportToCanvas from '@excalidraw/utils/export',
 * contain-fitted at device pixels, re-drawn on resize). No interactive
 * Excalidraw instance, so an accidental touch cannot pan or edit the slide.
 *
 * This wrapper owns the fetch's loading / error / empty states; the renderer
 * owns the draw (and its own "could not draw" state).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChalkboardSimple } from '@phosphor-icons/react';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import { PanelEmpty, PanelError, PanelLoading } from '../components/PanelScreenState';
import { PanelSceneView } from '../volt/PanelSceneView';
import type { PanelSceneData } from '../volt/types';

function parseScene(raw: unknown): PanelSceneData {
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const elements = (Array.isArray(data.elements) ? data.elements : []).filter(
        (element: unknown) =>
            !!element &&
            typeof element === 'object' &&
            !(element as { isDeleted?: boolean }).isDeleted
    ) as ExcalidrawElement[];
    const appState = (
        data.appState && typeof data.appState === 'object' ? data.appState : {}
    ) as Partial<AppState>;
    const files = (data.files && typeof data.files === 'object' ? data.files : {}) as BinaryFiles;
    return { elements, appState, files };
}

export interface ContentSceneViewProps {
    /** Signed URL of the scene JSON. */
    url: string;
    /** Stable render-cache key (the scene's file id). */
    cacheKey: string;
    onRetry: () => void;
}

export default function ContentSceneView({ url, cacheKey, onRetry }: ContentSceneViewProps) {
    const { t } = useTranslation('content');
    const [scene, setScene] = useState<PanelSceneData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setScene(null);
        setError(null);
        fetch(url)
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((raw: unknown) => {
                if (cancelled) return;
                const parsed = parseScene(raw);
                setScene(parsed);
                window.__PANEL_DEBUG__ = {
                    ...(window.__PANEL_DEBUG__ || {}),
                    lessonSceneElements: parsed.elements.length,
                };
            })
            .catch((reason: unknown) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
            });
        return () => {
            cancelled = true;
        };
    }, [url]);

    if (error) {
        return (
            <div className="flex size-full items-center justify-center">
                <PanelError
                    title={t('player.sceneErrorTitle')}
                    description={t('player.sceneErrorBody')}
                    detail={error}
                    onRetry={onRetry}
                />
            </div>
        );
    }
    if (!scene) return <PanelLoading className="size-full" label={t('player.opening')} />;
    if (scene.elements.length === 0) {
        return (
            <div className="flex size-full items-center justify-center">
                <PanelEmpty icon={ChalkboardSimple} title={t('player.sceneEmpty')} />
            </div>
        );
    }
    return (
        <div className="size-full p-6">
            <PanelSceneView scene={scene} cacheKey={`lesson:${cacheKey}`} />
        </div>
    );
}
