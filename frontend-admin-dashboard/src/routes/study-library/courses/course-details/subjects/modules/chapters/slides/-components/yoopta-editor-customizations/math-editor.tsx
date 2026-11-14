import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { YooptaPlugin, useYooptaEditor, Elements, PluginElementRenderProps } from '@yoopta/editor';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function MathBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryMathEditor');
    const editor = useYooptaEditor();
    const [latex, setLatex] = useState(element?.props?.latex || '');
    const [displayMode, setDisplayMode] = useState(
        element?.props?.displayMode !== false
    );
    const [isEditing, setIsEditing] = useState(!element?.props?.latex);
    const isFirstRender = useRef(true);

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propLatex = element?.props?.latex || '';
        if (propLatex !== latex) setLatex(propLatex);
        if (element?.props?.displayMode !== undefined && element.props.displayMode !== displayMode) {
            setDisplayMode(element.props.displayMode);
        }
    }, [element?.props?.latex, element?.props?.displayMode]);

    // Persist state to Yoopta/Slate store via Elements.updateElement
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        Elements.updateElement(editor, blockId, {
            type: 'mathBlock',
            props: {
                ...element.props,
                latex,
                displayMode,
                editorType: 'mathEditor',
            },
        });
    }, [latex, displayMode]);

    // Render LaTeX preview
    const renderedHtml = useMemo(() => {
        if (!latex.trim()) return '';
        try {
            return katex.renderToString(latex, {
                displayMode,
                throwOnError: false,
                output: 'html',
            });
        } catch {
            const escaped = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<span style="color: #dc2626;">${t('invalidLatex', { latex: escaped })}</span>`;
        }
    }, [latex, displayMode, t]);

    // Handle backspace prevention for textarea
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Backspace') {
            const target = e.target as HTMLTextAreaElement;
            if (target.value.length > 0 || target.selectionStart !== 0) {
                e.stopPropagation();
                return;
            }
        }
        // Allow Tab to insert spaces in textarea
        if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            const target = e.target as HTMLTextAreaElement;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const newValue = latex.substring(0, start) + '  ' + latex.substring(end);
            setLatex(newValue);
            // Restore cursor position after state update
            requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = start + 2;
            });
        }
    };

    return (
        <div
            {...attributes}
            contentEditable={false}
            style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                margin: '8px 0',
                overflow: 'hidden',
                backgroundColor: '#fafafa',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: '#f0f0f0',
                    borderBottom: '1px solid #e0e0e0',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 600, color: '#333' }}>
                        ∑ {t('mathLatex')}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Display/Inline toggle */}
                    <button
                        onClick={() => setDisplayMode(true)}
                        style={{
                            padding: '3px 10px',
                            fontSize: '12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px 0 0 4px',
                            backgroundColor: displayMode ? '#007acc' : 'white',
                            color: displayMode ? 'white' : '#666',
                            cursor: 'pointer',
                        }}
                    >
                        {t('display')}
                    </button>
                    <button
                        onClick={() => setDisplayMode(false)}
                        style={{
                            padding: '3px 10px',
                            fontSize: '12px',
                            border: '1px solid #ccc',
                            borderLeft: 'none',
                            borderRadius: '0 4px 4px 0',
                            backgroundColor: !displayMode ? '#007acc' : 'white',
                            color: !displayMode ? 'white' : '#666',
                            cursor: 'pointer',
                        }}
                    >
                        {t('inline')}
                    </button>

                    {/* Edit/Preview toggle */}
                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        style={{
                            padding: '3px 10px',
                            fontSize: '12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            backgroundColor: 'white',
                            color: '#666',
                            cursor: 'pointer',
                            marginLeft: '4px',
                        }}
                    >
                        {isEditing ? t('preview') : t('edit')}
                    </button>
                </div>
            </div>

            {/* Content area */}
            <div style={{ padding: '12px' }}>
                {isEditing ? (
                    <textarea
                        value={latex}
                        onChange={(e) => setLatex(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('latexPlaceholder')}
                        style={{
                            width: '100%',
                            minHeight: '60px',
                            padding: '10px',
                            fontFamily: '"Fira Code", "Consolas", monospace',
                            fontSize: '14px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            backgroundColor: '#fff',
                            resize: 'vertical',
                            outline: 'none',
                        }}
                    />
                ) : null}

                {/* Live preview */}
                {latex.trim() && (
                    <div
                        style={{
                            marginTop: isEditing ? '12px' : '0',
                            padding: '16px',
                            backgroundColor: '#fff',
                            borderRadius: '4px',
                            border: isEditing ? '1px solid #e8e8e8' : 'none',
                            textAlign: displayMode ? 'center' : 'left',
                            minHeight: '32px',
                            cursor: isEditing ? 'default' : 'pointer',
                        }}
                        onClick={() => {
                            if (!isEditing) setIsEditing(true);
                        }}
                        dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                )}

                {!latex.trim() && !isEditing && (
                    <div
                        onClick={() => setIsEditing(true)}
                        style={{
                            padding: '20px',
                            textAlign: 'center',
                            color: '#999',
                            fontSize: '14px',
                            cursor: 'pointer',
                        }}
                    >
                        {t('clickToAddEquation')}
                    </div>
                )}
            </div>

            {/* Common LaTeX shortcuts */}
            {isEditing && (
                <div
                    style={{
                        padding: '6px 12px 10px',
                        borderTop: '1px solid #eee',
                        display: 'flex',
                        gap: '4px',
                        flexWrap: 'wrap',
                    }}
                >
                    {[
                        { key: 'fraction', label: t('shortcutFraction'), code: '\\frac{a}{b}' },
                        { key: 'squareRoot', label: t('shortcutSquareRoot'), code: '\\sqrt{x}' },
                        { key: 'power', label: t('shortcutPower'), code: 'x^{n}' },
                        { key: 'subscript', label: t('shortcutSubscript'), code: 'x_{i}' },
                        { key: 'integral', label: t('shortcutIntegral'), code: '\\int_{a}^{b}' },
                        { key: 'sum', label: t('shortcutSum'), code: '\\sum_{i=1}^{n}' },
                        { key: 'greek', label: t('shortcutGreek'), code: '\\alpha \\beta \\gamma' },
                        {
                            key: 'matrix',
                            label: t('shortcutMatrix'),
                            code: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
                        },
                    ].map((shortcut) => (
                        <button
                            key={shortcut.key}
                            onClick={() => setLatex((prev: string) => prev + (prev ? ' ' : '') + shortcut.code)}
                            title={shortcut.code}
                            style={{
                                padding: '2px 8px',
                                fontSize: '11px',
                                border: '1px solid #ddd',
                                borderRadius: '3px',
                                backgroundColor: '#f8f8f8',
                                color: '#555',
                                cursor: 'pointer',
                            }}
                        >
                            {shortcut.label}
                        </button>
                    ))}
                </div>
            )}

            {children}
        </div>
    );
}

// Sigma icon for the action menu
const MathIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 4H6L12 12L6 20H18" />
    </svg>
);

// Yoopta Plugin Definition
export const MathPlugin = new YooptaPlugin<{ mathBlock: any }>({
    type: 'mathBlock',
    elements: {
        mathBlock: {
            render: MathBlock,
        },
    },
    options: {
        display: {
            title: 'Math / LaTeX',
            description: 'Add math equations with LaTeX',
            icon: <MathIcon />,
        },
        shortcuts: ['math', 'latex', 'equation', 'formula'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'mathBlock') {
                        return undefined;
                    }
                    const displayMode = element.getAttribute('data-display-mode') !== 'false';
                    // Extract LaTeX from text content, stripping $$ delimiters if present
                    let latex = element.textContent?.trim() || '';
                    if (latex.startsWith('$$') && latex.endsWith('$$')) {
                        latex = latex.slice(2, -2).trim();
                    } else if (latex.startsWith('$') && latex.endsWith('$')) {
                        latex = latex.slice(1, -1).trim();
                    }
                    return {
                        id: `math-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'mathBlock',
                        props: { latex, displayMode, editorType: 'mathEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                const props = element.props || {};
                const latex = props.latex || '';
                const displayMode = props.displayMode !== false;
                const delimiter = displayMode ? '$$' : '$';
                const escapedLatex = latex
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                return `<div data-yoopta-type="mathBlock" data-editor-type="mathEditor" data-display-mode="${displayMode}" style="text-align: ${displayMode ? 'center' : 'left'}; padding: 16px; margin: 8px 0;">${delimiter}${escapedLatex}${delimiter}</div>`;
            },
        },
    },
});
