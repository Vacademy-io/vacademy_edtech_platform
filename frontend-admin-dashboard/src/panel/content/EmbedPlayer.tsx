/**
 * YouTube / Vimeo lesson embed: a plain iframe. No iframe_api script injection
 * (youtube-player.tsx injects www.youtube.com/iframe_api and pulls the admin
 * editor; not reusable).
 *
 * Measured on panel_api28 (WebView 66): YouTube's embed script throws
 * "ReferenceError: queueMicrotask is not defined" (Chrome 71+) and the frame
 * stays black. So:
 * - below YOUTUBE_MIN_CHROME the fallback card shows at once;
 * - otherwise readiness comes from the players' postMessage protocol (no CDN
 *   script): YouTube (enablejsapi=1) answers a {"event":"listening"} handshake
 *   with initialDelivery/onReady and reports {"event":"onError"}; Vimeo posts
 *   {"event":"ready"} and reports {"event":"error"} after addEventListener.
 *   An error, or no player message within 15 s of loading, shows the card.
 * The card carries a QR code of the video link so the class can still watch
 * it from a phone.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { Desktop } from '@phosphor-icons/react';
import { PanelEmpty } from '../components/PanelScreenState';

const READY_TIMEOUT_MS = 15000;
/** YouTube's embed player needs queueMicrotask (Chrome 71). */
const YOUTUBE_MIN_CHROME = 71;

export interface EmbedPlayerProps {
    provider: 'youtube' | 'vimeo';
    videoId: string;
}

function embedUrl(provider: EmbedPlayerProps['provider'], videoId: string): string {
    const id = encodeURIComponent(videoId);
    if (provider === 'vimeo') {
        return `https://player.vimeo.com/video/${id}?badge=0&autopause=0&playsinline=1`;
    }
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${origin}`;
}

function watchUrl(provider: EmbedPlayerProps['provider'], videoId: string): string {
    const id = encodeURIComponent(videoId);
    return provider === 'vimeo' ? `https://vimeo.com/${id}` : `https://youtu.be/${id}`;
}

function isProviderOrigin(provider: EmbedPlayerProps['provider'], origin: string): boolean {
    return provider === 'vimeo'
        ? /^https:\/\/player\.vimeo\.com$/.test(origin)
        : /^https:\/\/www\.youtube(-nocookie)?\.com$/.test(origin);
}

function parseMessage(data: unknown): Record<string, unknown> | null {
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    if (typeof data !== 'string') return null;
    try {
        const parsed: unknown = JSON.parse(data);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function tooOldFor(provider: EmbedPlayerProps['provider']): boolean {
    const major = window.__PANEL_ENV__?.chromeMajor;
    return provider === 'youtube' && typeof major === 'number' && major < YOUTUBE_MIN_CHROME;
}

export function EmbedPlayer({ provider, videoId }: EmbedPlayerProps) {
    const { t } = useTranslation('content');
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [loaded, setLoaded] = useState(false);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState<string | null>(() =>
        tooOldFor(provider) ? 'webview-too-old' : null
    );
    const src = embedUrl(provider, videoId);
    const host = provider === 'vimeo' ? 'Vimeo' : 'YouTube';

    useEffect(() => {
        setLoaded(false);
        setReady(false);
        setFailed(tooOldFor(provider) ? 'webview-too-old' : null);
    }, [src, provider]);

    // No load at all, or loaded but the player never spoke: show the card.
    useEffect(() => {
        if (ready || failed) return undefined;
        const timer = window.setTimeout(
            () => setFailed(loaded ? 'no-player' : 'timeout'),
            READY_TIMEOUT_MS
        );
        return () => window.clearTimeout(timer);
    }, [loaded, ready, failed, src]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!isProviderOrigin(provider, event.origin)) return;
            const message = parseMessage(event.data);
            if (!message) return;
            if (provider === 'youtube' && message.event === 'onError') {
                setFailed(`youtube:${String(message.info ?? '')}`);
            } else if (provider === 'vimeo' && message.event === 'error') {
                setFailed('vimeo:error');
            } else {
                setReady(true);
            }
            window.__PANEL_DEBUG__ = {
                ...(window.__PANEL_DEBUG__ || {}),
                lessonEmbedLastEvent: String(message.event ?? message.method ?? ''),
            };
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [provider]);

    const onLoad = () => {
        setLoaded(true);
        const target = frameRef.current?.contentWindow;
        if (!target) return;
        const handshake =
            provider === 'youtube'
                ? { event: 'listening', id: 'panel-embed', channel: 'widget' }
                : { method: 'addEventListener', value: 'error' };
        try {
            target.postMessage(JSON.stringify(handshake), '*');
        } catch {
            // The handshake only improves error reporting; playback does not need it.
        }
    };

    if (failed) {
        return (
            <div className="flex size-full items-center justify-center overflow-auto bg-background p-8">
                <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
                    <PanelEmpty
                        icon={Desktop}
                        title={t('player.embedErrorTitle')}
                        description={t('player.embedErrorBody', { host })}
                    />
                    <div className="mx-auto space-y-3 text-center">
                        <div className="size-64 rounded-lg border border-border bg-card p-4 shadow-sm">
                            <QRCode
                                value={watchUrl(provider, videoId)}
                                size={256}
                                level="M"
                                className="size-full"
                            />
                        </div>
                        <p className="text-subtitle text-neutral-600">
                            {t('player.embedScan', { host })}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <iframe
            key={src}
            ref={frameRef}
            src={src}
            title={provider === 'vimeo' ? t('types.vimeo') : t('types.youtube')}
            className="absolute inset-0 size-full border-0 bg-neutral-900"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={onLoad}
        />
    );
}

export default EmbedPlayer;
