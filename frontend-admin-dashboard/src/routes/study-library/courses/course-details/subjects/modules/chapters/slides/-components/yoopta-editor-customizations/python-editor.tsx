import { Suspense, lazy } from 'react';
import { YooptaPlugin, useYooptaEditor, Elements, PluginElementRenderProps } from '@yoopta/editor';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

const LANGUAGE_OPTIONS = [
    { value: 'python', label: 'Python' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'html', label: 'HTML' },
    { value: 'css', label: 'CSS' },
];

const DEFAULT_CODE = {
    python: `def say_hello(name):\n    print("Hello,", name)\n\nsay_hello("World")`,
    javascript: `function sayHello(name) {\n  console.log("Hello, " + name);\n}\nsayHello("World");`,
    html: `<h1>Hello, World!</h1>`,
    css: `body {\n  background: #f0f0f0;\n  color: #333;\n}`,
};

export function MultiLangCodeBlock({
    element,
    attributes,
    children,
    blockId,
}: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryPythonEditor');
    const editor = useYooptaEditor();
    const initialLanguage = element?.props?.language || 'python';
    const initialCode =
        element?.props?.code || DEFAULT_CODE[initialLanguage as keyof typeof DEFAULT_CODE];
    const initialMode = element?.props?.mode || 'edit';
    const initialOutput = element?.props?.output || '';
    const initialHasRun = element?.props?.hasRun || false;

    const [language, setLanguage] = useState(initialLanguage);
    const [code, setCode] = useState(initialCode);
    const [output, setOutput] = useState(initialOutput);
    const [mode, setMode] = useState<'edit' | 'view'>(initialMode);
    const [hasRun, setHasRun] = useState(initialHasRun);
    const [loading, setLoading] = useState(false);
    const [isEditorReady, setIsEditorReady] = useState(false);
    const [editorError, setEditorError] = useState<string | null>(null);
    const editorRef = useRef<any>(null);

    const isFirstRender = useRef(true);

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propLang = element?.props?.language || 'python';
        const propCode = element?.props?.code || DEFAULT_CODE[propLang as keyof typeof DEFAULT_CODE];
        if (propLang !== language) setLanguage(propLang);
        if (propCode !== code) setCode(propCode);
    }, [element?.props?.language, element?.props?.code]);

    // Sync with Yoopta block state - save complete editor state
    // NOTE: Do NOT include Date.now() or other non-stable values here — it would
    // trigger Elements.updateElement → Yoopta onChange → re-render → useEffect → infinite loop.
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        Elements.updateElement(editor, blockId, {
            type: 'codeBlock',
            props: {
                ...element.props,
                language,
                code,
                mode,
                output,
                hasRun,
                editorType: 'multiLangCodeEditor',
            },
        });
    }, [language, code, mode, output, hasRun]);

    // Handle backspace prevention
    const handleEditorKeyDown = (e: any) => {
        if (e.key === 'Backspace') {
            const editor = editorRef.current;
            if (editor) {
                try {
                    const model = editor.getModel();
                    const position = editor.getPosition();
                    if (model && position) {
                        const isStartOfFile = position.lineNumber === 1 && position.column === 1;
                        if (!(code.length === 0 && isStartOfFile)) {
                            e.stopPropagation();
                        }
                    }
                } catch (error) {
                    console.warn('Error handling keydown:', error);
                }
            }
        }
    };

    const runCode = async () => {
        setLoading(true);
        setOutput('');
        try {
            if (language === 'python') {
                const res = await fetch('https://emkc.org/api/v2/piston/execute', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        language: 'python',
                        version: '3.10.0',
                        files: [
                            {
                                name: 'main.py',
                                content: code,
                            },
                        ],
                        stdin: '',
                        args: [],
                        compile_timeout: 10000,
                        run_timeout: 3000,
                        compile_memory_limit: -1,
                        run_memory_limit: -1,
                    }),
                });

                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`);
                }

                const data = await res.json();

                let output = '';
                if (data.run && data.run.stdout) {
                    output += data.run.stdout;
                }
                if (data.run && data.run.stderr) {
                    output += data.run.stderr;
                }
                if (data.compile && data.compile.stderr) {
                    output += t('compileErrorPrefix') + data.compile.stderr;
                }

                const finalOutput = output || t('noOutputProduced');
                setOutput(finalOutput);
                setHasRun(true);
            } else if (language === 'javascript') {
                try {
                    // Capture console.log output
                    const logs: string[] = [];
                    const originalLog = console.log;
                    console.log = (...args) => {
                        logs.push(args.map((arg) => String(arg)).join(' '));
                    };

                    // eslint-disable-next-line no-new-func
                    const result = Function('"use strict";' + code)();

                    // Restore console.log
                    console.log = originalLog;

                    let output = logs.join('\n');
                    if (result !== undefined) {
                        output += (output ? '\n' : '') + String(result);
                    }

                    const finalOutput = output || t('noOutput');
                    setOutput(finalOutput);
                    setHasRun(true);
                } catch (err: any) {
                    const errorOutput = t('errorPrefix') + String(err);
                    setOutput(errorOutput);
                    setHasRun(true);
                }
            }
        } catch (err: any) {
            console.error('Code execution error:', err);
            const errorOutput = t('errorRunningCodePrefix') + (err.message || String(err));
            setOutput(errorOutput);
            setHasRun(true);
        }
        setLoading(false);
    };

    // Error boundary for Monaco Editor
    const handleEditorError = (error: any) => {
        console.error('Monaco Editor Error:', error);
        setEditorError(t('failedToLoadCodeEditor'));
    };

    return (
        <div
            {...attributes}
            style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, margin: '8px 0' }}
        >
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    style={{ fontSize: 14 }}
                    disabled={mode === 'view'}
                >
                    {LANGUAGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                <button
                    onClick={runCode}
                    disabled={loading || mode === 'view' || language === 'css' || !isEditorReady}
                    style={{
                        padding: '4px 12px',
                        fontSize: '14px',
                        borderRadius: '4px',
                        border: '1px solid #ccc',
                        backgroundColor: loading ? '#f5f5f5' : '#007acc',
                        color: loading ? '#666' : 'white',
                        cursor: loading || !isEditorReady ? 'not-allowed' : 'pointer',
                    }}
                >
                    {loading ? t('running') : `▶ ${t('run')}`}
                </button>

                {/* Toggle Switch for Edit/View Mode */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', color: '#666' }}>{t('view')}</span>
                    <div
                        onClick={() =>
                            !loading && isEditorReady && setMode(mode === 'edit' ? 'view' : 'edit')
                        }
                        style={{
                            position: 'relative',
                            width: '40px',
                            height: '20px',
                            backgroundColor: mode === 'edit' ? '#007acc' : '#ccc',
                            borderRadius: '10px',
                            cursor: !isEditorReady || loading ? 'not-allowed' : 'pointer',
                            transition: 'background-color 0.3s ease',
                            opacity: !isEditorReady || loading ? 0.5 : 1,
                        }}
                    >
                        <div
                            style={{
                                position: 'absolute',
                                top: '2px',
                                left: mode === 'edit' ? '22px' : '2px',
                                width: '16px',
                                height: '16px',
                                backgroundColor: 'white',
                                borderRadius: '50%',
                                transition: 'left 0.3s ease',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                            }}
                        />
                    </div>
                    <span style={{ fontSize: '14px', color: '#666' }}>{t('edit')}</span>
                </div>
            </div>

            {editorError ? (
                <div
                    style={{
                        height: '180px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f8f8f8',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        color: '#666',
                    }}
                >
                    {editorError}
                </div>
            ) : (
                <Suspense fallback={<div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t('loadingEditor')}</div>}>
                    <MonacoEditor
                        height="180px"
                        language={language}
                        value={code}
                        onChange={(value) => setCode(value ?? '')}
                        onMount={(editor, monaco) => {
                            try {
                                editorRef.current = editor;
                                editor.onKeyDown(handleEditorKeyDown);
                                setIsEditorReady(true);
                                setEditorError(null);
                            } catch (error) {
                                handleEditorError(error);
                            }
                        }}
                        options={{
                            readOnly: mode === 'view',
                            fontSize: 14,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            lineNumbers: 'off',
                            folding: false,
                            lineDecorationsWidth: 0,
                            lineNumbersMinChars: 0,
                            glyphMargin: false,
                            contextmenu: false,
                            automaticLayout: true,
                            renderWhitespace: 'none',
                            scrollbar: {
                                vertical: 'hidden',
                                horizontal: 'hidden',
                            },
                        }}
                        loading={
                            <div style={{ padding: '20px', textAlign: 'center' }}>
                                {t('loadingEditorLower')}
                            </div>
                        }
                        onValidate={() => { }}
                        beforeMount={(monaco) => {
                            try {
                                // Define custom theme
                                monaco.editor.defineTheme('customTheme', {
                                    base: 'vs',
                                    inherit: true,
                                    rules: [],
                                    colors: {},
                                });
                                monaco.editor.setTheme('customTheme');
                            } catch (error) {
                                console.warn('Theme setup error:', error);
                                // Fallback to default theme
                            }
                        }}
                    />
                </Suspense>
            )}
            {output && language !== 'html' && language !== 'css' && (
                <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                        {t('outputLabel')}
                    </div>
                    <pre
                        style={{
                            background: '#f6f8fa',
                            padding: 8,
                            borderRadius: 4,
                            fontSize: '12px',
                            border: '1px solid #e1e4e8',
                            whiteSpace: 'pre-wrap',
                            maxHeight: '200px',
                            overflowY: 'auto',
                        }}
                    >
                        {output}
                    </pre>
                </div>
            )}
            {(language === 'html' || language === 'css') && (
                <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                        {t('previewLabel')}
                    </div>
                    <iframe
                        title={t('previewTitle')}
                        style={{
                            background: '#fff',
                            border: '1px solid #e1e4e8',
                            borderRadius: 4,
                            width: '100%',
                            minHeight: 100,
                        }}
                        srcDoc={
                            language === 'html'
                                ? code
                                : `<style>${code}</style><div>${t('cssPreviewArea')}</div>`
                        }
                    />
                </div>
            )}
            {children}
        </div>
    );
}

// Code Block Icon
const CodeIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
            d="M14.71 6.29l-4-4a1 1 0 00-1.42 0l-4 4a1 1 0 001.42 1.42L9 5.41V20a1 1 0 002 0V5.41l2.29 2.3a1 1 0 001.42-1.42zM21 14a1 1 0 00-1 1v2.59l-2.29-2.3a1 1 0 00-1.42 1.42l4 4a1 1 0 001.42 0l4-4a1 1 0 00-1.42-1.42L21 17.59V15a1 1 0 00-1-1z"
            fill="currentColor"
        />
    </svg>
);

// Yoopta Plugin Definition
export const MultiLangCodePlugin = new YooptaPlugin<{ codeBlock: any }>({
    type: 'codeBlock',
    elements: {
        codeBlock: {
            render: MultiLangCodeBlock,
        },
    },
    options: {
        display: {
            title: 'Code Editor',
            description: 'Editable code block with execution',
            icon: <CodeIcon />,
        },
        shortcuts: ['code', 'python', 'js', 'html', 'css'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'codeBlock') {
                        return undefined;
                    }
                    const language = element.getAttribute('data-language') || 'python';
                    const mode = element.getAttribute('data-mode') || 'edit';
                    const output = element.getAttribute('data-output') || '';
                    const hasRun = element.getAttribute('data-has-run') === 'true';
                    // Extract code from <pre><code> child or textContent
                    const codeEl = element.querySelector?.('pre code') || element.querySelector?.('pre');
                    const code = codeEl?.textContent || element.textContent?.trim() || '';
                    return {
                        id: `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'codeBlock',
                        props: { language, code, mode, output, hasRun, editorType: 'multiLangCodeEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                const props = element.props || {};
                const language = props.language || 'python';
                const code = props.code || '';
                const mode = props.mode || 'edit';
                const output = props.output || '';
                const hasRun = props.hasRun ? 'true' : 'false';
                // Escape HTML entities in code for safe embedding
                const escapedCode = code
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                return `<div data-yoopta-type="codeBlock" data-editor-type="multiLangCodeEditor" data-language="${language}" data-mode="${mode}" data-output="${output.replace(/"/g, '&quot;')}" data-has-run="${hasRun}" style="border: 1px solid #eee; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa;"><div style="margin-bottom: 8px; font-size: 12px; color: #666; font-weight: 600;">${language.toUpperCase()} Code Editor</div><pre style="background: #f6f8fa; padding: 12px; border-radius: 4px; font-size: 13px; overflow-x: auto;"><code>${escapedCode}</code></pre>${output ? `<div style="margin-top: 8px; font-size: 12px; color: #666;">Output: <pre style="background: #f6f8fa; padding: 8px; border-radius: 4px; font-size: 12px;">${output.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div>` : ''}</div>`;
            },
        },
    },
});
