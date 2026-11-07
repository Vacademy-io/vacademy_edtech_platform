import i18next from 'i18next';
import { createBlockNode, setAttrs } from './block-node-factory';
import {
    MathBlockEditor,
    MermaidBlockEditor,
    AudioBlockEditor,
    PdfBlockEditor,
    FillBlanksBlockEditor,
    JupyterBlockEditor,
    ScratchBlockEditor,
    TocBlockEditor,
} from '../blocks/simple-block-editors';

/**
 * "Plain-attribute" custom blocks — state carried in individual data-*
 * attributes (or the element body), matching the legacy Yoopta serializers so
 * the learner app's DocumentWithMermaid hydration keeps working unchanged.
 *
 * Export shapes intentionally keep the learner-contract essentials (selector,
 * data-* attrs, state-carrying child elements like <audio src>) plus a static
 * fallback body styled inline — serialized HTML renders outside Tailwind, so
 * literal colours are required there.
 */

const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;');

// These builders run outside React (invoked by the Yoopta/Lexical export
// pipeline, not rendered from a component), so useTranslation isn't
// available — read the current locale off the shared i18next instance
// instead, matching the module-scope-function pattern used elsewhere
// (e.g. Payment/utils/utils.ts).
const t = (key: string, options?: Record<string, unknown>): string =>
    i18next.t(`studyLibrarySimpleAttrNodes:${key}`, options) as string;

const CARD_STYLE =
    'border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa;'; // design-lint-ignore: serialized learner HTML needs literal colours

// ---------- Math ----------
export interface MathPayload {
    latex: string;
    displayMode: boolean;
}

export const MathBlock = createBlockNode<MathPayload>({
    nodeType: 'mathBlock',
    defaultPayload: { latex: '', displayMode: true },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'mathBlock') return null;
        const displayMode = el.getAttribute('data-display-mode') !== 'false';
        let latex = el.textContent?.trim() || '';
        if (latex.startsWith('$$') && latex.endsWith('$$')) latex = latex.slice(2, -2).trim();
        else if (latex.startsWith('$') && latex.endsWith('$')) latex = latex.slice(1, -1).trim();
        return { latex, displayMode };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'mathBlock'],
            ['data-editor-type', 'mathEditor'],
            ['data-display-mode', String(p.displayMode)],
            [
                'style',
                `text-align: ${p.displayMode ? 'center' : 'left'}; padding: 16px; margin: 8px 0;`,
            ],
        ]);
        const delim = p.displayMode ? '$$' : '$';
        el.textContent = `${delim}${p.latex}${delim}`;
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <MathBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Mermaid (class-keyed, NOT data-yoopta-type) ----------
export interface MermaidPayload {
    code: string;
}

export const MermaidBlock = createBlockNode<MermaidPayload>({
    nodeType: 'mermaid',
    defaultPayload: { code: '' },
    importTags: ['div'],
    importMatch: (el) => {
        if (!el.classList.contains('mermaid')) return null;
        return { code: el.textContent?.trim() || '' };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        el.setAttribute('class', 'mermaid');
        el.textContent = p.code;
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <MermaidBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Audio ----------
export interface AudioPayload {
    audioUrl: string;
    title: string;
}

export const AudioBlock = createBlockNode<AudioPayload>({
    nodeType: 'audioPlayer',
    defaultPayload: { audioUrl: '', title: '' },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'audioPlayer') return null;
        return {
            title: el.getAttribute('data-title') || '',
            audioUrl: el.querySelector('audio')?.getAttribute('src') || '',
        };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'audioPlayer'],
            ['data-editor-type', 'audioPlayer'],
            ['data-title', p.title],
            ['style', CARD_STYLE + (p.audioUrl ? '' : ' text-align: center; color: #999;')], // design-lint-ignore: serialized learner HTML needs literal colours
        ]);
        if (!p.audioUrl) {
            el.textContent = t('audio.noAudio');
            return el;
        }
        el.innerHTML =
            (p.title
                ? `<div style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #333;">${esc(p.title)}</div>` // design-lint-ignore: serialized learner HTML needs literal colours
                : '') +
            `<audio controls src="${escAttr(p.audioUrl)}" style="width: 100%;" preload="metadata"></audio>`;
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <AudioBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- PDF viewer ----------
export interface PdfPayload {
    pdfUrl: string;
    title: string;
}

export const PdfBlock = createBlockNode<PdfPayload>({
    nodeType: 'pdfViewer',
    defaultPayload: { pdfUrl: '', title: '' },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'pdfViewer') return null;
        let pdfUrl = el.getAttribute('data-pdf-url') || '';
        if (!pdfUrl) {
            // Legacy fallback: unwrap iframe src (incl. docs.google.com/gview ?url=)
            const iframeSrc = el.querySelector('iframe')?.getAttribute('src') || '';
            if (iframeSrc.includes('docs.google.com/gview')) {
                try {
                    pdfUrl = new URL(iframeSrc).searchParams.get('url') || '';
                } catch {
                    pdfUrl = '';
                }
            } else {
                pdfUrl = iframeSrc;
            }
        }
        return { pdfUrl, title: el.getAttribute('data-title') || '' };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        if (!p.pdfUrl) {
            setAttrs(el, [
                ['data-yoopta-type', 'pdfViewer'],
                ['data-editor-type', 'pdfViewer'],
                ['data-title', p.title],
                ['style', CARD_STYLE + ' text-align: center; color: #999;'], // design-lint-ignore: serialized learner HTML needs literal colours
            ]);
            el.textContent = t('pdf.noPdf');
            return el;
        }
        setAttrs(el, [
            ['data-yoopta-type', 'pdfViewer'],
            ['data-editor-type', 'pdfViewer'],
            ['data-pdf-url', p.pdfUrl],
            ['data-title', p.title],
            ['style', CARD_STYLE],
        ]);
        el.innerHTML =
            (p.title
                ? `<div style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #333;">${esc(p.title)}</div>` // design-lint-ignore: serialized learner HTML needs literal colours
                : '') +
            `<a href="${escAttr(p.pdfUrl)}" target="_blank" rel="noreferrer noopener" style="color: #3366cc; font-size: 13px;">${esc(t('pdf.openInNewTab'))}</a>`; // design-lint-ignore: serialized learner HTML needs literal colours
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <PdfBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Fill in the blanks ----------
export interface FillBlanksPayload {
    sentence: string;
}

export const FillBlanksBlock = createBlockNode<FillBlanksPayload>({
    nodeType: 'fillBlanks',
    defaultPayload: { sentence: '' },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'fillBlanks') return null;
        return { sentence: el.getAttribute('data-sentence') || '' };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'fillBlanks'],
            ['data-editor-type', 'fillBlanksEditor'],
            ['data-sentence', p.sentence],
            ['style', CARD_STYLE],
        ]);
        const displayHtml = esc(p.sentence).replace(
            /\{blank:([^}]+)\}/g,
            '<span style="display: inline-block; min-width: 80px; border-bottom: 2px solid #007acc; text-align: center; padding: 2px 8px; margin: 0 4px; color: transparent;" data-answer="$1">$1</span>' // design-lint-ignore: serialized learner HTML needs literal colours
        );
        el.innerHTML =
            `<div style="font-weight: 600; font-size: 13px; color: #666; margin-bottom: 8px;">${esc(t('fillBlanks.title'))}</div>` + // design-lint-ignore: serialized learner HTML needs literal colours
            `<div style="font-size: 16px; line-height: 2.2; color: #333;">${displayHtml}</div>`; // design-lint-ignore: serialized learner HTML needs literal colours
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <FillBlanksBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Jupyter notebook ----------
export interface JupyterPayload {
    projectName: string;
    contentUrl: string;
    contentBranch: string;
    notebookLocation: string;
    activeTab: string;
}

export const JupyterBlock = createBlockNode<JupyterPayload>({
    nodeType: 'jupyterNotebook',
    defaultPayload: {
        projectName: '',
        contentUrl: '',
        contentBranch: 'main',
        notebookLocation: 'root',
        activeTab: 'settings',
    },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'jupyterNotebook') return null;
        return {
            projectName: el.getAttribute('data-project-name') || '',
            contentUrl: el.getAttribute('data-content-url') || '',
            contentBranch: el.getAttribute('data-content-branch') || 'main',
            notebookLocation: el.getAttribute('data-notebook-location') || 'root',
            activeTab: el.getAttribute('data-active-tab') || 'settings',
        };
    },
    buildExportDom: (p) => {
        // Learner renders this block as raw HTML (no hydration) — the static
        // body, including the mybinder iframe in preview mode, IS the learner
        // experience. Mirror the legacy Yoopta template.
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'jupyterNotebook'],
            ['data-editor-type', 'jupyterEditor'],
            ['data-project-name', p.projectName],
            ['data-content-url', p.contentUrl],
            ['data-content-branch', p.contentBranch],
            ['data-notebook-location', p.notebookLocation],
            ['data-active-tab', p.activeTab],
            [
                'style',
                'border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 16px 0; background-color: #fafafa;', // design-lint-ignore: serialized learner HTML needs literal colours
            ],
        ]);
        const configured = p.projectName && p.contentUrl;
        if (!configured) {
            el.innerHTML =
                '<div style="display: flex; align-items: center; color: #666;">' + // design-lint-ignore: serialized learner HTML needs literal colours
                '<span style="font-size: 32px; margin-right: 16px;">📓</span>' +
                `<div><p style="font-size: 16px; margin: 0 0 8px 0;">${esc(t('jupyter.notConfigured'))}</p>` +
                `<p style="font-size: 14px; color: #999; margin: 0;">${esc(t('jupyter.notConfiguredDetail'))}</p></div></div>`; // design-lint-ignore: serialized learner HTML needs literal colours
            return el;
        }
        const binderUrl = `https://mybinder.org/v2/gh/${p.contentUrl.replace('https://github.com/', '')}/${p.contentBranch}?labpath=${p.notebookLocation}`;
        el.innerHTML =
            `<h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #333;">📓 ${esc(t('jupyter.heading', { name: p.projectName }))}</h3>` + // design-lint-ignore: serialized learner HTML needs literal colours
            (p.activeTab === 'preview'
                ? `<div style="width: 100%; height: 500px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden;"><iframe src="${escAttr(binderUrl)}" width="100%" height="100%" style="border: none;" title="${escAttr(t('jupyter.previewTitle'))}"></iframe></div>` // design-lint-ignore: serialized learner HTML needs literal colours
                : `<div style="padding: 12px; background: #e8f5e8; border-radius: 4px; font-size: 14px; color: #2d5a2d;"><div><strong>${esc(t('jupyter.repository'))}</strong> ${esc(p.contentUrl)}</div><div><strong>${esc(t('jupyter.branch'))}</strong> ${esc(p.contentBranch)}</div><div><strong>${esc(t('jupyter.location'))}</strong> ${esc(p.notebookLocation)}</div></div>`); // design-lint-ignore: serialized learner HTML needs literal colours
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <JupyterBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Scratch project ----------
export interface ScratchPayload {
    scratchId: string;
    activeTab: string;
}

export const ScratchBlock = createBlockNode<ScratchPayload>({
    nodeType: 'scratchProject',
    defaultPayload: { scratchId: '', activeTab: 'settings' },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'scratchProject') return null;
        return {
            scratchId: el.getAttribute('data-scratch-id') || '',
            activeTab: el.getAttribute('data-active-tab') || 'settings',
        };
    },
    buildExportDom: (p) => {
        // Like Jupyter: learner renders this raw — the embed iframe in the
        // static body is the learner experience.
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'scratchProject'],
            ['data-editor-type', 'scratchEditor'],
            ['data-scratch-id', p.scratchId],
            ['data-active-tab', p.activeTab],
            [
                'style',
                'border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 16px 0; background-color: #fafafa;', // design-lint-ignore: serialized learner HTML needs literal colours
            ],
        ]);
        if (!p.scratchId) {
            el.innerHTML =
                '<div style="display: flex; align-items: center; color: #666;">' + // design-lint-ignore: serialized learner HTML needs literal colours
                '<span style="font-size: 32px; margin-right: 16px;">🐱</span>' +
                `<div><p style="font-size: 16px; margin: 0 0 8px 0;">${esc(t('scratch.notConfigured'))}</p>` +
                `<p style="font-size: 14px; color: #999; margin: 0;">${esc(t('scratch.notConfiguredDetail'))}</p></div></div>`; // design-lint-ignore: serialized learner HTML needs literal colours
            return el;
        }
        el.innerHTML =
            `<h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #333;">🐱 ${esc(t('scratch.heading'))}</h3>` + // design-lint-ignore: serialized learner HTML needs literal colours
            `<div style="width: 100%; height: 500px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; background-color: white;"><iframe src="https://scratch.mit.edu/projects/${escAttr(p.scratchId)}/embed" width="100%" height="100%" style="border: none;" title="${escAttr(t('scratch.heading'))}" allowfullscreen></iframe></div>`; // design-lint-ignore: serialized learner HTML needs literal colours
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <ScratchBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Table of contents ----------
export type TocPayload = Record<string, never>;

export const TocBlock = createBlockNode<TocPayload>({
    nodeType: 'tableOfContents',
    defaultPayload: {},
    importTags: ['div'],
    importMatch: (el) => (el.getAttribute('data-yoopta-type') === 'tableOfContents' ? {} : null),
    buildExportDom: () => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'tableOfContents'],
            ['data-editor-type', 'tocEditor'],
            ['style', CARD_STYLE],
        ]);
        el.innerHTML =
            `<div style="font-weight: 600; font-size: 15px; color: #333; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">${esc(t('toc.title'))}</div>` + // design-lint-ignore: serialized learner HTML needs literal colours
            `<div style="color: #666; font-size: 13px;">${esc(t('toc.subtitle'))}</div>`; // design-lint-ignore: serialized learner HTML needs literal colours
        return el;
    },
    Component: () => <TocBlockEditor />,
});

export const simpleAttrNodeClasses = [
    MathBlock.NodeClass,
    MermaidBlock.NodeClass,
    AudioBlock.NodeClass,
    PdfBlock.NodeClass,
    FillBlanksBlock.NodeClass,
    JupyterBlock.NodeClass,
    ScratchBlock.NodeClass,
    TocBlock.NodeClass,
];
