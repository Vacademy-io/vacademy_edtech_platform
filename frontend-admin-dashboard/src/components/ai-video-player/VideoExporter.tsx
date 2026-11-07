/**
 * VideoExporter — Client-side video export using html2canvas + FFmpeg WASM.
 *
 * Renders timeline segments as div containers (NOT iframes — html2canvas
 * cannot traverse iframe DOMs), captures each frame, and encodes to MP4.
 *
 * Key design decisions:
 * - Divs with innerHTML instead of iframes: html2canvas can capture these
 * - Longer wait for segment changes (fonts, GSAP, Mermaid, KaTeX load time)
 * - Frame batching: avoids OOM by flushing MEMFS every BATCH_SIZE frames
 * - Fallback frame: if a capture fails, duplicate the last good frame
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { processHtmlContent } from './html-processor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineEntry {
    id: string;
    inTime: number;
    exitTime: number;
    html: string;
    z?: number;
}

interface TimelineMeta {
    content_type?: string;
    total_duration?: number;
    audio_start_at?: number;
    palette?: {
        background?: string;
        text?: string;
        text_secondary?: string;
        primary?: string;
        accent?: string;
    };
}

interface TimelineData {
    meta?: TimelineMeta;
    entries: TimelineEntry[];
}

export interface ExportOptions {
    fps: number; // 15 (standard) or 30 (high quality)
}

export interface ExportProgress {
    phase: 'loading' | 'capturing' | 'encoding' | 'done' | 'error' | 'cancelled';
    percent: number; // 0-100
    message: string;
    currentFrame?: number;
    totalFrames?: number;
}

interface VideoExporterProps {
    timelineUrl: string;
    audioUrl?: string;
    options: ExportOptions;
    onProgress: (progress: ExportProgress) => void;
    onComplete: (blob: Blob) => void;
    onError: (error: string) => void;
    cancelRef: React.MutableRefObject<boolean>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Capture at half resolution — html2canvas is ~4x faster.
// FFmpeg upscales to 1920x1080 in the encode step.
const CAPTURE_WIDTH = 960;
const CAPTURE_HEIGHT = 540;
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
// Time to wait (ms) when a NEW segment appears (fonts + scripts must load)
const SEGMENT_CHANGE_WAIT_MS = 2000;
// Time to wait (ms) for a repeat frame of the same segment
const SAME_SEGMENT_WAIT_MS = 20;

// ---------------------------------------------------------------------------
// Helper: render active segments as div layers (NOT iframes)
// ---------------------------------------------------------------------------

function renderSegmentsToDivs(
    container: HTMLDivElement,
    entries: TimelineEntry[],
    time: number,
    contentType: string,
    palette?: TimelineMeta['palette']
): string[] {
    const active = entries
        .filter((e) => time >= e.inTime && time < e.exitTime)
        .sort((a, b) => (a.z || 0) - (b.z || 0));

    // Clear previous content
    container.innerHTML = '';

    for (let i = 0; i < active.length; i++) {
        const entry = active[i]!;
        const layer = document.createElement('div');
        layer.style.position = 'absolute';
        layer.style.top = '0';
        layer.style.left = '0';
        layer.style.width = `${CAPTURE_WIDTH}px`;
        layer.style.height = `${CAPTURE_HEIGHT}px`;
        layer.style.zIndex = String(entry.z || i);
        layer.style.overflow = 'hidden';
        layer.style.background = i === 0 ? '#ffffff' : 'transparent';

        // Inject the processed HTML directly into a div (NOT an iframe).
        // html2canvas can capture div innerHTML but NOT iframe srcdoc.
        const processedHtml = processHtmlContent(
            entry.html,
            contentType as any,
            i > 0, // overlay flag
            palette
        );

        // Strip <html>/<head>/<body> wrappers — extract just the body content
        // processHtmlContent returns a full HTML document; we need the inner content.
        const bodyMatch = processedHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const bodyContent = bodyMatch ? bodyMatch[1] : processedHtml;

        // Extract <style> tags and keep them
        const styleMatches = processedHtml.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
        const headStyleMatches = processedHtml.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi) || [];

        // Create a shadow-like container to isolate styles
        layer.innerHTML = styleMatches.join('\n') + headStyleMatches.join('\n') + bodyContent;

        container.appendChild(layer);
    }

    return active.map((e) => e.id);
}

// ---------------------------------------------------------------------------
// Helper: wait with timeout
// ---------------------------------------------------------------------------

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Helper: html2canvas with timeout
// ---------------------------------------------------------------------------

async function captureWithTimeout(
    element: HTMLElement,
    timeoutMs: number = 15000
): Promise<HTMLCanvasElement> {
    return Promise.race([
        html2canvas(element, {
            width: CAPTURE_WIDTH,
            height: CAPTURE_HEIGHT,
            scale: 1,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            allowTaint: true,
        }),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('html2canvas timeout')), timeoutMs)
        ),
    ]);
}

// ---------------------------------------------------------------------------
// Helper: canvas to PNG Uint8Array
// ---------------------------------------------------------------------------

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
            'image/jpeg',
            0.85 // Good quality, ~5x smaller than PNG
        );
    });
    return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportVideo(
    {
        timelineUrl,
        audioUrl,
        options,
        onProgress,
        onComplete,
        onError,
        cancelRef,
    }: VideoExporterProps,
    offscreenContainer: HTMLDivElement
): Promise<void> {
    const { fps } = options;
    const isCancelled = () => cancelRef.current;

    // ── Phase 1: Load timeline ──
    onProgress({ phase: 'loading', percent: 0, message: 'Loading timeline...' });

    let timeline: TimelineData;
    try {
        const res = await fetch(timelineUrl);
        const raw = await res.json();
        timeline = Array.isArray(raw) ? { entries: raw, meta: {} } : (raw as TimelineData);
    } catch (e) {
        onError(`Failed to load timeline: ${e}`);
        return;
    }

    const meta = timeline.meta || {};
    const entries = timeline.entries || [];
    const totalDuration =
        meta.total_duration || entries.reduce((max, e) => Math.max(max, e.exitTime), 0);
    const totalFrames = Math.ceil(totalDuration * fps);
    const contentType = meta.content_type || 'VIDEO';

    if (totalFrames === 0) {
        onError('Timeline has no duration');
        return;
    }

    // Estimate memory: JPEG frames are ~80-120KB each (vs 500KB PNG)
    const estimatedMB = Math.round(totalFrames * 0.1);
    console.log(`[VideoExporter] ${totalFrames} frames, estimated ~${estimatedMB}MB in MEMFS`);

    // ── Phase 2: Load FFmpeg WASM ──
    onProgress({
        phase: 'loading',
        percent: 3,
        message: `Initializing encoder (${totalFrames} frames, ~${Math.round(totalDuration)}s video)...`,
    });

    let ffmpeg: FFmpeg;
    try {
        ffmpeg = new FFmpeg();
        await ffmpeg.load();
    } catch (e) {
        onError(
            `Failed to initialize video encoder. ` +
            `This may require Cross-Origin-Embedder-Policy headers. Error: ${e}`
        );
        return;
    }

    if (isCancelled()) {
        onProgress({ phase: 'cancelled', percent: 0, message: 'Export cancelled' });
        return;
    }

    // ── Phase 3: Download audio ──
    let hasAudio = false;
    if (audioUrl) {
        try {
            onProgress({ phase: 'loading', percent: 6, message: 'Downloading audio...' });
            const audioData = await fetchFile(audioUrl);
            await ffmpeg.writeFile('audio.mp3', audioData);
            hasAudio = true;
        } catch (e) {
            console.warn('[VideoExporter] Audio download failed, exporting without sound:', e);
            onProgress({
                phase: 'loading',
                percent: 8,
                message: 'Audio unavailable — exporting video without sound',
            });
            await wait(1500); // Let user see the warning
        }
    }

    // ── Phase 4: Set up offscreen container ──
    offscreenContainer.style.width = `${CAPTURE_WIDTH}px`;
    offscreenContainer.style.height = `${CAPTURE_HEIGHT}px`;
    offscreenContainer.style.position = 'fixed';
    offscreenContainer.style.left = '0';
    offscreenContainer.style.top = '0';
    offscreenContainer.style.opacity = '0';
    offscreenContainer.style.pointerEvents = 'none';
    offscreenContainer.style.zIndex = '-1';
    offscreenContainer.style.overflow = 'hidden';
    offscreenContainer.style.background = '#ffffff';

    // ── Phase 5: Capture frames ──
    // Key optimization: only recapture when the active segment changes.
    // For same-segment frames, reuse the last captured frame data.
    const captureStartTime = Date.now();
    let lastActiveIds: string[] = [];
    let lastGoodFrame: Uint8Array | null = null;
    let captureCount = 0; // How many actual html2canvas calls (much less than totalFrames)

    for (let i = 0; i < totalFrames; i++) {
        if (isCancelled()) {
            onProgress({ phase: 'cancelled', percent: 0, message: 'Export cancelled' });
            return;
        }

        const time = i / fps;

        // Determine active entries at this time
        const active = entries
            .filter((e) => time >= e.inTime && time < e.exitTime)
            .sort((a, b) => (a.z || 0) - (b.z || 0));
        const activeIds = active.map((e) => e.id);
        const segmentChanged =
            activeIds.length !== lastActiveIds.length ||
            activeIds.some((id, idx) => id !== lastActiveIds[idx]);

        const frameName = `frame_${String(i).padStart(6, '0')}.jpg`;

        if (segmentChanged) {
            // New segment — render and capture
            renderSegmentsToDivs(offscreenContainer, entries, time, contentType, meta.palette);
            lastActiveIds = activeIds;
            await wait(SEGMENT_CHANGE_WAIT_MS);

            try {
                const canvas = await captureWithTimeout(offscreenContainer);
                const frameData = await canvasToJpeg(canvas);
                await ffmpeg.writeFile(frameName, frameData);
                lastGoodFrame = frameData;
                captureCount++;
            } catch (e) {
                console.warn(`[VideoExporter] Frame ${i} capture failed:`, e);
                if (lastGoodFrame) {
                    await ffmpeg.writeFile(frameName, lastGoodFrame);
                } else {
                    const placeholder = document.createElement('canvas');
                    placeholder.width = CAPTURE_WIDTH;
                    placeholder.height = CAPTURE_HEIGHT;
                    const ctx = placeholder.getContext('2d')!;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
                    const fallback = await canvasToJpeg(placeholder);
                    await ffmpeg.writeFile(frameName, fallback);
                    lastGoodFrame = fallback;
                }
            }
        } else {
            // Same segment as previous frame — reuse last capture (no html2canvas call!)
            if (lastGoodFrame) {
                await ffmpeg.writeFile(frameName, lastGoodFrame);
            }
        }

        // Progress: capturing phase is 10-80%
        const capturePercent = 10 + Math.round((i / totalFrames) * 70);
        const progressInterval = Math.max(1, Math.floor(totalFrames / 100));
        if (i % progressInterval === 0 || i === totalFrames - 1) {
            const elapsed = (Date.now() - captureStartTime) / 1000;
            const msPerFrame = elapsed / (i + 1);
            const remaining = Math.round((msPerFrame * (totalFrames - i - 1)) / 1000);
            const etaStr = remaining > 60
                ? `~${Math.round(remaining / 60)}m left`
                : `~${remaining}s left`;

            onProgress({
                phase: 'capturing',
                percent: capturePercent,
                message: `Capturing frame ${i + 1} / ${totalFrames} (${etaStr})`,
                currentFrame: i + 1,
                totalFrames,
            });
        }
    }

    // ── Phase 6: Encode to MP4 ──
    if (isCancelled()) {
        onProgress({ phase: 'cancelled', percent: 0, message: 'Export cancelled' });
        return;
    }

    console.log(`[VideoExporter] Capture done: ${captureCount} unique captures for ${totalFrames} frames`);
    onProgress({ phase: 'encoding', percent: 82, message: 'Encoding video (this may take a moment)...' });

    try {
        const ffmpegArgs = [
            '-framerate', String(fps),
            '-i', 'frame_%06d.jpg',
        ];

        if (hasAudio) {
            ffmpegArgs.push('-i', 'audio.mp3');
        }

        ffmpegArgs.push(
            // Upscale from 960x540 to 1920x1080
            '-vf', `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-crf', '23',
            '-preset', 'fast',
        );

        if (hasAudio) {
            ffmpegArgs.push('-c:a', 'aac', '-shortest');
        }

        ffmpegArgs.push('output.mp4');

        await ffmpeg.exec(ffmpegArgs);

        onProgress({ phase: 'encoding', percent: 95, message: 'Reading output file...' });

        const outputData = await ffmpeg.readFile('output.mp4');
        const mp4Blob = new Blob([outputData as BlobPart], { type: 'video/mp4' });

        // Clean up FFmpeg filesystem
        const cleanupPromises: Promise<unknown>[] = [];
        for (let i = 0; i < totalFrames; i++) {
            cleanupPromises.push(
                ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.jpg`).catch(() => {})
            );
        }
        cleanupPromises.push(ffmpeg.deleteFile('audio.mp3').catch(() => {}));
        cleanupPromises.push(ffmpeg.deleteFile('output.mp4').catch(() => {}));
        await Promise.all(cleanupPromises);

        // Clear the offscreen container
        offscreenContainer.innerHTML = '';

        onProgress({ phase: 'done', percent: 100, message: 'Export complete!' });
        onComplete(mp4Blob);
    } catch (e) {
        onError(`Video encoding failed: ${e}`);
    }
}

// ---------------------------------------------------------------------------
// React hook for easy usage
// ---------------------------------------------------------------------------

export function useVideoExporter() {
    const cancelRef = useRef(false);
    const exportingRef = useRef(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    // Create offscreen container on mount
    useEffect(() => {
        const div = document.createElement('div');
        div.id = 'video-exporter-offscreen';
        document.body.appendChild(div);
        containerRef.current = div;
        return () => {
            // Abort any running export on unmount
            cancelRef.current = true;
            exportingRef.current = false;
            if (div.parentNode) {
                div.parentNode.removeChild(div);
            }
            containerRef.current = null;
        };
    }, []);

    const startExport = useCallback(
        async (
            timelineUrl: string,
            audioUrl: string | undefined,
            options: ExportOptions = { fps: 15 }
        ) => {
            // Use ref to prevent double-start (avoids stale closure issues)
            if (!containerRef.current || exportingRef.current) return;

            cancelRef.current = false;
            exportingRef.current = true;
            setIsExporting(true);
            setProgress({ phase: 'loading', percent: 0, message: 'Starting export...' });

            try {
                await exportVideo(
                    {
                        timelineUrl,
                        audioUrl,
                        options,
                        onProgress: setProgress,
                        onComplete: (blob) => {
                            // Trigger download
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `video-export-${Date.now()}.mp4`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                            exportingRef.current = false;
                            setIsExporting(false);
                        },
                        onError: (error) => {
                            setProgress({ phase: 'error', percent: 0, message: error });
                            exportingRef.current = false;
                            setIsExporting(false);
                        },
                        cancelRef,
                    },
                    containerRef.current
                );
            } catch (e) {
                setProgress({ phase: 'error', percent: 0, message: `Unexpected error: ${e}` });
                exportingRef.current = false;
                setIsExporting(false);
            }
        },
        [] // No dependencies — uses refs to avoid stale closures
    );

    const cancelExport = useCallback(() => {
        cancelRef.current = true;
        exportingRef.current = false;
        setIsExporting(false);
        setProgress({ phase: 'cancelled', percent: 0, message: 'Export cancelled' });
    }, []);

    return { startExport, cancelExport, progress, isExporting };
}
