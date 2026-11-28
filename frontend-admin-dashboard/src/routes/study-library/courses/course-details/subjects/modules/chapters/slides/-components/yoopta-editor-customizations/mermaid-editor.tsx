import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
    YooptaPlugin,
    useYooptaEditor,
    useYooptaReadOnly,
    PluginElementRenderProps,
} from '@yoopta/editor';
import mermaid from 'mermaid';
import { sanitizeMermaidCode } from '@/routes/study-library/ai-copilot/shared/utils/mermaidSanitizer';
import { commitBlockProps } from './commitBlockProps';

// Mermaid block chrome colours — centralised so the file carries no scattered hex.
const C = {
    muted: '#888888', // design-lint-ignore: Yoopta editor chrome — inline style required
    placeholder: '#999999', // design-lint-ignore: Yoopta editor chrome — inline style required
    cardBg: '#f8fafc', // design-lint-ignore: Yoopta editor chrome — inline style required
    cardBorder: '#e2e8f0', // design-lint-ignore: Yoopta editor chrome — inline style required
    white: '#ffffff', // design-lint-ignore: Yoopta editor chrome — inline style required
    inputBorder: '#dddddd', // design-lint-ignore: Yoopta editor chrome — inline style required
    label: '#555555', // design-lint-ignore: Yoopta editor chrome — inline style required
    accent: '#4338ca', // design-lint-ignore: Yoopta editor chrome — inline style required
    indigoBg: '#eef2ff', // design-lint-ignore: Yoopta editor chrome — inline style required
    indigoBorder: '#c7d2fe', // design-lint-ignore: Yoopta editor chrome — inline style required
    surface: '#fafafa', // design-lint-ignore: Yoopta editor chrome — inline style required
    border: '#e0e0e0', // design-lint-ignore: Yoopta editor chrome — inline style required
    danger: '#b91c1c', // design-lint-ignore: Yoopta editor chrome — inline style required
    dangerBg: '#fef2f2', // design-lint-ignore: Yoopta editor chrome — inline style required
};

// Coordinate mermaid init with TipTapEditor; re-init if suppression not applied.
const initializeMermaid = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.__mermaidSuppressErrorsApplied) return;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mermaid.initialize as any)({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose',
            suppressErrorRendering: true,
            flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
        });
        w.__mermaidSuppressErrorsApplied = true;
        w.__mermaidInitialized = true;
    } catch (error) {
        console.warn('[MermaidPlugin] Error initializing mermaid:', error);
    }
};

try { initializeMermaid(); } catch (_) { /* silent */ }

/** Portal-based zoom modal — renders at document.body so it's never clipped */
function MermaidZoomModal({ svg, onClose }: { svg: string; onClose: () => void }) {
    const { t } = useTranslation('studyLibraryMermaidEditor');
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handler);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                background: 'rgba(0, 0, 0, 0.82)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'zoom-out',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
            }}
            onClick={onClose}
        >
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                }}
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '24px',
                    background: 'rgba(255,255,255,0.18)',
                    border: '1px solid rgba(255,255,255,0.35)',
                    borderRadius: '50%',
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: C.white,
                    fontSize: '20px',
                    lineHeight: 1,
                    backdropFilter: 'blur(4px)',
                    zIndex: 100000,
                }}
                title={t('zoomModal.closeTitle')}
            >
                ✕
            </button>

            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: C.white,
                    borderRadius: '16px',
                    padding: '40px',
                    minWidth: '60vw',
                    maxWidth: '92vw',
                    maxHeight: '88vh',
                    overflow: 'auto',
                    boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
                    cursor: 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <div
                    dangerouslySetInnerHTML={{ __html: svg }}
                    style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
                />
            </div>
        </div>,
        document.body
    );
}

const EXAMPLE_CODE = `graph TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do this]
  B -->|No| D[Do that]`;

export function MermaidBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryMermaidEditor');
    const editor = useYooptaEditor();
    const isReadOnly = useYooptaReadOnly();
    const initialCode = element?.props?.code || '';
    const [code, setCode] = useState<string>(initialCode);
    const [svg, setSvg] = useState<string>('');
    const [isRendering, setIsRendering] = useState(false);
    const [isZoomed, setIsZoomed] = useState(false);
    const [hadError, setHadError] = useState(false);
    // Open the code editor by default for a fresh (empty) block in the admin.
    const [isEditing, setIsEditing] = useState(!isReadOnly && !initialCode.trim());
    const renderedCodeRef = useRef<string>('');
    // Track the last value we pushed to the block so the prop-adopt effect below
    // reacts ONLY to genuinely external changes (deserialize / AI insert) and
    // never echoes our own commit back over what is being typed (which, with
    // rapid typing + lagging props, could revert or blank the code).
    const lastCommittedRef = useRef<string>(initialCode);

    // Adopt external prop changes (deserialization / AI insert) — but never the
    // echo of our own commitCode.
    useEffect(() => {
        const propCode = element?.props?.code || '';
        if (propCode !== lastCommittedRef.current && propCode !== code) {
            lastCommittedRef.current = propCode;
            setCode(propCode);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [element?.props?.code]);

    // Persist the code to the Slate block so Save Draft / Publish serializes it.
    const commitCode = (next: string) => {
        setCode(next);
        lastCommittedRef.current = next;
        if (isReadOnly) return;
        commitBlockProps(editor, blockId, element, { code: next });
    };

    // Render mermaid diagram whenever the code changes.
    useEffect(() => {
        if (!code || code.trim() === '') {
            setSvg('');
            setHadError(false);
            return;
        }
        if (renderedCodeRef.current === code.trim()) return;

        const renderMermaid = async () => {
            try {
                setIsRendering(true);
                if (!mermaid || typeof mermaid.render !== 'function') {
                    setSvg('');
                    return;
                }
                initializeMermaid();

                let cleanCode = code.trim();
                if (cleanCode.toLowerCase().startsWith('mermaid ')) {
                    cleanCode = cleanCode.substring(8).trim();
                }
                if (!cleanCode) {
                    setSvg('');
                    return;
                }
                cleanCode = sanitizeMermaidCode(cleanCode);
                const renderId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                try {
                    const result = await mermaid.render(renderId, cleanCode);
                    if (result && result.svg) {
                        setSvg(result.svg);
                        setHadError(false);
                        renderedCodeRef.current = code.trim();
                    } else {
                        setSvg('');
                        setHadError(true);
                    }
                } catch (_renderError) {
                    console.warn('[MermaidBlock] Render failed:', _renderError);
                    setSvg('');
                    setHadError(true);
                }
            } catch (_) {
                setSvg('');
            } finally {
                setIsRendering(false);
            }
        };
        renderMermaid();
    }, [code]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Keep keystrokes inside the textarea from reaching the outer Slate editor.
        e.stopPropagation();
    };

    const renderedDiagram = svg && !isRendering && (
        <>
            <div
                onClick={() => setIsZoomed(true)}
                title={t('block.clickToZoom')}
                style={{
                    margin: '12px 0 0',
                    padding: '16px',
                    backgroundColor: C.cardBg,
                    border: `1px solid ${C.cardBorder}`,
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: 'zoom-in',
                    position: 'relative',
                    overflow: 'hidden',
                    maxWidth: '100%',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(0,0,0,0.4)',
                        color: C.white,
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        pointerEvents: 'none',
                        opacity: 0.85,
                    }}
                >
                    🔍 {t('block.clickToZoom')}
                </div>
                <div
                    dangerouslySetInnerHTML={{ __html: svg }}
                    style={{ maxWidth: '100%', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}
                />
            </div>
            {isZoomed && <MermaidZoomModal svg={svg} onClose={() => setIsZoomed(false)} />}
        </>
    );

    return (
        <div
            {...attributes}
            className="yoopta-mermaid-block"
            contentEditable={false}
            style={{
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                margin: '8px 0',
                overflow: 'hidden',
                backgroundColor: C.surface,
            }}
        >
            {/* Header — admin chrome only */}
            {!isReadOnly && (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: C.indigoBg,
                        borderBottom: `1px solid ${C.indigoBorder}`,
                    }}
                >
                    <span style={{ fontSize: '14px', fontWeight: 600, color: C.accent }}>
                        {t('block.header')}
                    </span>
                    <button
                        onClick={() => setIsEditing((v) => !v)}
                        style={{
                            padding: '3px 10px',
                            fontSize: '12px',
                            border: `1px solid ${C.indigoBorder}`,
                            borderRadius: '4px',
                            backgroundColor: C.white,
                            color: C.muted,
                            cursor: 'pointer',
                        }}
                    >
                        {isEditing ? t('block.done') : t('block.editCode')}
                    </button>
                </div>
            )}

            <div style={{ padding: '12px' }}>
                {isEditing && !isReadOnly ? (
                    <>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: C.label, display: 'block', marginBottom: '4px' }}>
                            {t('block.diagramCodeLabel')}
                        </label>
                        <textarea
                            value={code}
                            onChange={(e) => commitCode(e.target.value)}
                            onBlur={() => commitCode(code)}
                            onKeyDown={handleKeyDown}
                            placeholder={`${t('block.diagramCodePlaceholder')}\n${EXAMPLE_CODE}`}
                            spellCheck={false}
                            rows={6}
                            style={{
                                width: '100%',
                                minHeight: '120px',
                                padding: '10px',
                                fontSize: '13px',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                border: `1px solid ${C.inputBorder}`,
                                borderRadius: '6px',
                                backgroundColor: C.white,
                                resize: 'vertical',
                                outline: 'none',
                                lineHeight: 1.5,
                            }}
                        />
                        <div style={{ marginTop: '6px', fontSize: '11px', color: C.muted, lineHeight: 1.5 }}>
                            {t('block.livePreviewHintPrefix')} (<code>graph TD</code>){t('block.livePreviewHintSuffix')}{' '}
                            <button
                                type="button"
                                onClick={() => commitCode(EXAMPLE_CODE)}
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: C.accent,
                                    cursor: 'pointer',
                                    padding: 0,
                                    fontSize: '11px',
                                    textDecoration: 'underline',
                                }}
                            >
                                {t('block.insertExample')}
                            </button>
                        </div>

                        {isRendering && (
                            <div style={{ textAlign: 'center', padding: '16px', color: C.muted, fontSize: '13px' }}>
                                {t('block.renderingDiagram')}
                            </div>
                        )}
                        {renderedDiagram}
                        {!svg && !isRendering && hadError && code.trim() && (
                            <div
                                style={{
                                    marginTop: '12px',
                                    padding: '10px 12px',
                                    backgroundColor: C.dangerBg,
                                    border: `1px solid ${C.danger}`,
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    color: C.danger,
                                }}
                            >
                                {t('block.renderError')}
                            </div>
                        )}
                    </>
                ) : isRendering ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: C.muted, fontSize: '13px' }}>
                        {t('block.renderingDiagram')}
                    </div>
                ) : svg ? (
                    renderedDiagram
                ) : (
                    <div
                        onClick={() => !isReadOnly && setIsEditing(true)}
                        style={{
                            textAlign: 'center',
                            padding: '24px',
                            color: C.placeholder,
                            fontSize: '13px',
                            cursor: isReadOnly ? 'default' : 'pointer',
                        }}
                    >
                        <em>
                            {isReadOnly
                                ? t('block.noDiagram')
                                : t('block.clickToAdd')}
                        </em>
                    </div>
                )}
            </div>

            {/* Keep Slate's required {children} mounted but hidden (its
                "Type / for commands" placeholder was overlaying the block). */}
            <div
                aria-hidden
                style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
            >
                {children}
            </div>

            <style>{`
                .yoopta-mermaid-block svg {
                    max-width: 100% !important;
                    height: auto !important;
                    display: block;
                }
            `}</style>
        </div>
    );
}

// Yoopta Plugin Definition
export const MermaidPlugin = new YooptaPlugin<{ mermaid: any }>({
    type: 'mermaid',
    elements: {
        mermaid: {
            render: MermaidBlock,
        },
    },
    options: {
        display: {
            title: 'Mermaid Diagram',
            description: 'Add a mermaid diagram',
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            ),
        },
        shortcuts: ['mermaid', 'diagram', 'graph'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    try {
                        const className = element.getAttribute?.('class') || element.className || '';
                        const isMermaidDiv =
                            element.classList?.contains('mermaid') ||
                            (typeof className === 'string' && className.split(/\s+/).includes('mermaid'));
                        if (!isMermaidDiv) return undefined;
                        const code = element.textContent?.trim() || element.innerText?.trim() || '';
                        return {
                            id: `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            type: 'mermaid',
                            props: { code },
                            children: [{ text: '' }],
                        };
                    } catch (error) {
                        console.error('[MermaidPlugin] Error during deserialization:', error);
                        return undefined;
                    }
                },
            },
            serialize: (element, _children) => {
                const code = (element && element.props && element.props.code) || '';
                if (!code) return '<div class="mermaid"></div>';
                // Escape so the code (which may contain &, <, >) round-trips via
                // textContent on reload and never breaks the surrounding HTML.
                const esc = String(code)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                return `<div class="mermaid">${esc}</div>`;
            },
        },
    },
});
