import i18next from 'i18next';
import { createBlockNode, setAttrs } from './block-node-factory';
import {
    ImageBlockEditor,
    VideoBlockEditor,
    FileBlockEditor,
    EmbedBlockEditor,
    CalloutBlockEditor,
} from '../blocks/media-block-editors';

/**
 * Media + callout blocks. Serialized shapes keep media URLs in real
 * src/href attributes (never data-* payloads) so formatHTMLString's
 * AWS-query-param stripping and the backend's structural-loss guard see them,
 * matching how the legacy editor persisted media.
 */

// These builders run outside React (invoked by the Yoopta/Lexical export
// pipeline, not rendered from a component), so useTranslation isn't
// available — read the current locale off the shared i18next instance
// instead, matching the module-scope-function pattern used elsewhere
// (e.g. Payment/utils/utils.ts, simple-attr-nodes.tsx).
const t = (key: string, options?: Record<string, unknown>): string =>
    i18next.t(`studyLibraryMediaNodes:${key}`, options) as string;

// ---------- Image ----------
export interface ImagePayload {
    src: string;
    alt: string;
}

export const ImageBlock = createBlockNode<ImagePayload>({
    nodeType: 'docImage',
    defaultPayload: { src: '', alt: '' },
    importTags: ['img'],
    importMatch: (el) => {
        const src = el.getAttribute('src') || '';
        // Empty/null images are dropped (formatHTMLString would remove them anyway)
        if (!src || src === 'null' || src === 'undefined') return null;
        return { src, alt: el.getAttribute('alt') || '' };
    },
    buildExportDom: (p) => {
        const el = document.createElement('img');
        setAttrs(el, [
            ['src', p.src],
            ['alt', p.alt],
            ['style', 'max-width: 100%; height: auto; display: block; margin: 10px auto;'],
        ]);
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <ImageBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Video (uploaded file) ----------
export interface VideoPayload {
    src: string;
}

export const VideoBlock = createBlockNode<VideoPayload>({
    nodeType: 'docVideo',
    defaultPayload: { src: '' },
    importTags: ['video'],
    importMatch: (el) => {
        const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
        if (!src) return null;
        return { src };
    },
    buildExportDom: (p) => {
        const el = document.createElement('video');
        setAttrs(el, [
            ['controls', ''],
            ['src', p.src],
            ['style', 'width: 100%; max-height: 480px; margin: 10px 0;'],
            ['preload', 'metadata'],
        ]);
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <VideoBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- File attachment ----------
export interface FilePayload {
    href: string;
    name: string;
}

export const FileBlock = createBlockNode<FilePayload>({
    nodeType: 'docFile',
    defaultPayload: { href: '', name: '' },
    importTags: ['a'],
    importMatch: (el) => {
        if (!el.hasAttribute('download')) return null;
        const href = el.getAttribute('href') || '';
        if (!href) return null;
        return { href, name: el.textContent?.trim() || t('downloadFile') };
    },
    buildExportDom: (p) => {
        const el = document.createElement('a');
        setAttrs(el, [
            ['href', p.href],
            ['download', ''],
            ['target', '_blank'],
            ['rel', 'noreferrer noopener'],
            [
                'style',
                'display: inline-block; padding: 8px 12px; margin: 8px 0; border: 1px solid #e0e0e0; border-radius: 6px; color: #3366cc; text-decoration: none; font-size: 14px;', // design-lint-ignore: serialized learner HTML needs literal colours
            ],
        ]);
        el.textContent = p.name || t('downloadFile');
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <FileBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Embed (iframe: YouTube/Vimeo/Figma/any URL) ----------
export interface EmbedPayload {
    src: string;
    height: number;
}

/** Normalize common share URLs to embeddable iframe URLs. */
export function toEmbedUrl(raw: string): string {
    const url = raw.trim();
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^?&#]+)/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    const vimeo = url.match(/vimeo\.com(?:\/video)?\/(\d+)/);
    if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
    const loom = url.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/);
    if (loom) return `https://www.loom.com/embed/${loom[1]}`;
    return url;
}

export const EmbedBlock = createBlockNode<EmbedPayload>({
    nodeType: 'docEmbed',
    defaultPayload: { src: '', height: 400 },
    importTags: ['iframe'],
    importMatch: (el) => {
        const src = el.getAttribute('src') || '';
        if (!src) return null;
        const height = parseInt(el.getAttribute('height') || '', 10);
        return { src, height: Number.isFinite(height) && height > 0 ? height : 400 };
    },
    buildExportDom: (p) => {
        const el = document.createElement('iframe');
        setAttrs(el, [
            ['src', p.src],
            ['width', '100%'],
            ['height', String(p.height)],
            ['style', 'border: none; border-radius: 6px; margin: 8px 0;'],
            ['allowfullscreen', ''],
            ['title', t('embeddedContent')],
        ]);
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <EmbedBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Callout ----------
export interface CalloutPayload {
    theme: 'default' | 'info' | 'success' | 'warning' | 'error';
    text: string;
}

export const CALLOUT_THEMES: Record<
    CalloutPayload['theme'],
    { bg: string; border: string; color: string }
> = {
    default: { bg: '#f5f5f5', border: '#e0e0e0', color: '#333333' }, // design-lint-ignore: serialized learner HTML needs literal colours
    info: { bg: '#e7f3fe', border: '#2196f3', color: '#0b5394' }, // design-lint-ignore: serialized learner HTML needs literal colours
    success: { bg: '#e8f5e9', border: '#4caf50', color: '#1b5e20' }, // design-lint-ignore: serialized learner HTML needs literal colours
    warning: { bg: '#fff8e1', border: '#ff9800', color: '#e65100' }, // design-lint-ignore: serialized learner HTML needs literal colours
    error: { bg: '#fdecea', border: '#f44336', color: '#b71c1c' }, // design-lint-ignore: serialized learner HTML needs literal colours
};

export const CalloutBlock = createBlockNode<CalloutPayload>({
    nodeType: 'docCallout',
    defaultPayload: { theme: 'info', text: '' },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'callout') return null;
        const theme = (el.getAttribute('data-theme') || 'info') as CalloutPayload['theme'];
        return {
            theme: CALLOUT_THEMES[theme] ? theme : 'info',
            text: el.textContent?.trim() || '',
        };
    },
    buildExportDom: (p) => {
        const t = CALLOUT_THEMES[p.theme] ?? CALLOUT_THEMES.info;
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'callout'],
            ['data-editor-type', 'calloutEditor'],
            ['data-theme', p.theme],
            [
                'style',
                `background: ${t.bg}; border-left: 4px solid ${t.border}; color: ${t.color}; border-radius: 6px; padding: 12px 16px; margin: 8px 0;`,
            ],
        ]);
        el.textContent = p.text;
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <CalloutBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

export const mediaNodeClasses = [
    ImageBlock.NodeClass,
    VideoBlock.NodeClass,
    FileBlock.NodeClass,
    EmbedBlock.NodeClass,
    CalloutBlock.NodeClass,
];
