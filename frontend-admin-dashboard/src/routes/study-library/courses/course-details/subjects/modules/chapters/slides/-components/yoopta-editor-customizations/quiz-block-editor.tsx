import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    YooptaPlugin,
    useYooptaEditor,
    useYooptaReadOnly,
    PluginElementRenderProps,
} from '@yoopta/editor';
import { commitBlockProps } from './commitBlockProps';
import { encodeBlockData, decodeBlockData } from './RichTextField';
import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

interface QuizOption {
    id?: string; // stable key (survives add/remove/reorder)
    text: string; // rich-text HTML
    isCorrect: boolean;
}

interface QuizData {
    question: string; // rich-text HTML
    type: 'mcq' | 'trueFalse';
    options: QuizOption[];
    explanation: string; // rich-text HTML
}

const genId = () => `qo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const withIds = (opts: QuizOption[]): QuizOption[] =>
    (Array.isArray(opts) ? opts : []).map((o) => (o.id ? o : { ...o, id: genId() }));

const DEFAULT_MCQ: QuizData = {
    question: '',
    type: 'mcq',
    options: [
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
    ],
    explanation: '',
};

const DEFAULT_TRUE_FALSE: QuizData = {
    question: '',
    type: 'trueFalse',
    options: [
        { text: 'True', isCorrect: false },
        { text: 'False', isCorrect: false },
    ],
    explanation: '',
};

// Quiz-block colours — centralised so the file carries no scattered literal hex.
const C = {
    border: '#e0e0e0', // design-lint-ignore: Yoopta editor chrome — inline style required
    surface: '#fafafa', // design-lint-ignore: Yoopta editor chrome — inline style required
    indigoBg: '#eef2ff', // design-lint-ignore: Yoopta editor chrome — inline style required
    indigoBorder: '#c7d2fe', // design-lint-ignore: Yoopta editor chrome — inline style required
    indigo: '#4338ca', // design-lint-ignore: Yoopta editor chrome — inline style required
    muted: '#666666', // design-lint-ignore: Yoopta editor chrome — inline style required
    label: '#555555', // design-lint-ignore: Yoopta editor chrome — inline style required
    inputBorder: '#dddddd', // design-lint-ignore: Yoopta editor chrome — inline style required
    green: '#28a745', // design-lint-ignore: Yoopta editor chrome — inline style required
    gray: '#cccccc', // design-lint-ignore: Yoopta editor chrome — inline style required
    red: '#dc3545', // design-lint-ignore: Yoopta editor chrome — inline style required
    text: '#333333', // design-lint-ignore: Yoopta editor chrome — inline style required
    correctBg: '#d4edda', // design-lint-ignore: Yoopta editor chrome — inline style required
    correctText: '#155724', // design-lint-ignore: Yoopta editor chrome — inline style required
    wrongBg: '#f8d7da', // design-lint-ignore: Yoopta editor chrome — inline style required
    wrongText: '#721c24', // design-lint-ignore: Yoopta editor chrome — inline style required
    explBg: '#fff3cd', // design-lint-ignore: Yoopta editor chrome — inline style required
    explBorder: '#ffc107', // design-lint-ignore: Yoopta editor chrome — inline style required
    explText: '#856404', // design-lint-ignore: Yoopta editor chrome — inline style required
    white: '#ffffff', // design-lint-ignore: Yoopta editor chrome — inline style required
};

/** Upload an image to S3 and return its public URL. Returns null on failure. */
async function uploadQuizImage(file: File): Promise<string | null> {
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const data = getTokenDecodedData(accessToken);
        const INSTITUTE_ID = (data && Object.keys(data.authorities)[0]) || undefined;
        const userId = data?.sub || 'unknown-user';
        const fileId = await UploadFileInS3(file, () => {}, userId, INSTITUTE_ID, 'STUDENTS', true);
        if (!fileId) return null;
        const url = await getPublicUrl(fileId);
        return url || null;
    } catch (e) {
        console.error('[Quiz] image upload failed', e);
        return null;
    }
}

// Inject (and keep up to date) the contentEditable field styles: placeholder,
// focus ring, and — crucially — re-enable list markers, which Tailwind's global
// preflight resets away (`ul,ol { list-style: none }`). The `!important` +
// `display: list-item` make the bullets/numbers robust against that reset. We
// UPDATE the existing tag rather than skip, so CSS changes apply on reload/HMR.
function ensureQuizEditorStyles() {
    if (typeof document === 'undefined') return;
    const css = `
        .quiz-rich-field:empty:before { content: attr(data-placeholder); color: ${C.muted}; pointer-events: none; }
        .quiz-rich-box:focus-within { border-color: ${C.indigo} !important; box-shadow: 0 0 0 1px ${C.indigo}; }
        .quiz-rich-field img, .quiz-rich-html img { max-width: 100%; height: auto; border-radius: 4px; }
        .quiz-rich-field p, .quiz-rich-field div, .quiz-rich-html p, .quiz-rich-html div { margin: 0; }
        .quiz-rich-field ul, .quiz-rich-html ul { list-style: disc outside !important; margin: 4px 0; padding-left: 26px; }
        .quiz-rich-field ol, .quiz-rich-html ol { list-style: decimal outside !important; margin: 4px 0; padding-left: 26px; }
        .quiz-rich-field li, .quiz-rich-html li { display: list-item !important; margin: 2px 0; }
        .quiz-rich-field a, .quiz-rich-html a { color: ${C.indigo}; text-decoration: underline; }
    `;
    let style = document.getElementById('quiz-rich-field-styles') as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = 'quiz-rich-field-styles';
        document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
}

// Treat blank / "<p><br></p>" / nbsp-only / formatting-only content as empty,
// but never treat embedded media (image/video/etc.) as empty.
const isHtmlEmpty = (html: string): boolean => {
    if (!html) return true;
    if (/<(img|iframe|video|audio)\b/i.test(html)) return false;
    const text = html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&');
    return text.trim() === '';
};

const placeCaretAtEnd = (el: HTMLElement) => {
    try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    } catch {
        /* noop */
    }
};

const safeLinkHref = (raw: string): string | null => {
    const url = raw.trim();
    if (!url) return null;
    if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) return url;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) return `https://${url}`; // bare domain
    return null;
};

// A self-contained rich-text field: its own compact toolbar + a controlled
// contentEditable. We set the DOM innerHTML ONLY when the incoming value differs
// from what's already there (external change) — never on our own keystrokes — so
// the caret never jumps. Plain contentEditable (no heavy editor instance) stays
// stable when the surrounding Slate block re-renders.
function RichField({
    value,
    onChange,
    placeholder,
    minHeight,
}: {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
    minHeight?: number;
}) {
    const { t } = useTranslation('studyLibraryQuizBlockEditor');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (el.innerHTML === (value || '')) return;
        // Guard against data loss: while the user is actively editing this field,
        // never let a momentary empty/stale `value` echo overwrite what they've
        // typed — the next commit reconciles it. Only sync genuine external
        // changes (deserialize / not focused).
        if (
            document.activeElement === el &&
            isHtmlEmpty(value || '') &&
            !isHtmlEmpty(el.innerHTML)
        ) {
            return;
        }
        el.innerHTML = value || '';
    }, [value]);

    // Slate (the outer document editor) attaches NATIVE beforeinput/keydown
    // listeners on its editable to manage this void block — and they swallowed
    // Backspace/Delete inside this nested contentEditable (Slate tried to delete
    // the whole quiz block instead). Stop those native events at the field so the
    // browser performs the edit and Slate never sees them. We deliberately do NOT
    // stop `input`, so React's onInput still fires to capture the change.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const stopNative = (e: Event) => e.stopPropagation();
        el.addEventListener('beforeinput', stopNative);
        el.addEventListener('keydown', stopNative);
        el.addEventListener('keyup', stopNative);
        return () => {
            el.removeEventListener('beforeinput', stopNative);
            el.removeEventListener('keydown', stopNative);
            el.removeEventListener('keyup', stopNative);
        };
    }, []);

    const fire = () => {
        if (ref.current) onChange(ref.current.innerHTML);
    };

    const exec = (command: string, val?: string) => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        document.execCommand(command, false, val);
        fire();
    };

    const insertLink = () => {
        const el = ref.current;
        if (!el) return;
        const raw = window.prompt(t('prompts.linkUrl'));
        if (!raw) return;
        const href = safeLinkHref(raw);
        if (!href) return;
        el.focus();
        document.execCommand('createLink', false, href);
        fire();
    };

    const insertImage = () => {
        const el = ref.current;
        if (!el) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const url = await uploadQuizImage(file);
            const node = ref.current;
            if (!url || !node) return;
            node.focus();
            placeCaretAtEnd(node);
            document.execCommand(
                'insertHTML',
                false,
                `<img src="${url.replace(/"/g, '&quot;')}" alt="" style="max-width:100%;" />`
            );
            // A trailing image leaves no caret position after it, so you can't
            // type below it. Append an empty line and move the caret into it.
            const line = document.createElement('div');
            line.appendChild(document.createElement('br'));
            node.appendChild(line);
            try {
                const range = document.createRange();
                range.setStart(line, 0);
                range.collapse(true);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            } catch {
                /* noop */
            }
            fire();
        };
        input.click();
    };

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    const tbBtn = (
        label: string,
        onClick: () => void,
        title: string,
        extra?: React.CSSProperties
    ) => (
        <button
            type="button"
            // Keep the field's selection (the button would steal focus first).
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            title={title}
            style={{
                minWidth: '26px',
                height: '24px',
                padding: '0 6px',
                fontSize: '13px',
                border: 'none',
                borderRadius: '4px',
                backgroundColor: 'transparent',
                color: C.muted,
                cursor: 'pointer',
                ...extra,
            }}
            onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.indigoBg;
            }}
            onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
            }}
        >
            {label}
        </button>
    );

    return (
        <div
            className="quiz-rich-box"
            style={{
                border: `1px solid ${C.inputBorder}`,
                borderRadius: '6px',
                overflow: 'hidden',
                backgroundColor: C.white,
            }}
        >
            {/* Per-field toolbar */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1px',
                    flexWrap: 'wrap',
                    padding: '3px 4px',
                    borderBottom: `1px solid ${C.inputBorder}`,
                    backgroundColor: C.surface,
                }}
            >
                {tbBtn('B', () => exec('bold'), t('toolbar.bold'), { fontWeight: 700 })}
                {tbBtn('I', () => exec('italic'), t('toolbar.italic'), { fontStyle: 'italic' })}
                {tbBtn('U', () => exec('underline'), t('toolbar.underline'), {
                    textDecoration: 'underline',
                })}
                {tbBtn('•', () => exec('insertUnorderedList'), t('toolbar.bulletList'))}
                {tbBtn('1.', () => exec('insertOrderedList'), t('toolbar.numberedList'))}
                {tbBtn('🔗', insertLink, t('toolbar.insertLink'))}
                {tbBtn('🖼', insertImage, t('toolbar.insertImage'))}
            </div>

            {/* Editable area */}
            <div
                ref={ref}
                contentEditable
                suppressContentEditableWarning
                className="quiz-rich-field"
                data-placeholder={placeholder || ''}
                onInput={fire}
                // Commit again on blur so the final edit is persisted before an
                // action that reads the document (e.g. clicking Save Draft moves
                // focus out of the field → this fires before the save handler).
                onBlur={fire}
                onKeyDown={stop}
                onKeyUp={stop}
                onMouseDown={stop}
                onPaste={stop}
                onCut={stop}
                onCopy={stop}
                onDrop={stop}
                style={{
                    minHeight: minHeight ? `${minHeight}px` : '40px',
                    padding: '8px 10px',
                    fontSize: '14px',
                    lineHeight: 1.5,
                    outline: 'none',
                    overflowWrap: 'anywhere',
                }}
            />
        </div>
    );
}

// Renders stored rich-text HTML (preview + non-editing states).
function RichHtml({ html, style }: { html: string; style?: React.CSSProperties }) {
    return (
        <div
            className="quiz-rich-html"
            style={style}
            dangerouslySetInnerHTML={{ __html: html || '' }}
        />
    );
}

export function QuizBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryQuizBlockEditor');
    const editor = useYooptaEditor();
    const isReadOnly = useYooptaReadOnly();
    const hasStoredQuiz =
        !!element?.props?.quizData &&
        typeof element.props.quizData === 'object';
    const initialData: QuizData = hasStoredQuiz
        ? { ...element!.props!.quizData, options: withIds(element!.props!.quizData.options) }
        : { ...DEFAULT_MCQ, options: withIds(DEFAULT_MCQ.options.map((o) => ({ ...o }))) };
    const [quizData, setQuizData] = useState<QuizData>(initialData);
    const [isEditing, setIsEditing] = useState(
        !isReadOnly && isHtmlEmpty(element?.props?.quizData?.question || '')
    );
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
    const [showResult, setShowResult] = useState(false);

    useEffect(() => {
        ensureQuizEditorStyles();
    }, []);

    const quizDataRef = useRef<QuizData>(initialData);
    const mcqStashRef = useRef<QuizOption[] | null>(null);

    const commitQuiz = (next: QuizData | ((prev: QuizData) => QuizData)) => {
        const resolved =
            typeof next === 'function' ? (next as any)(quizDataRef.current) : next;
        quizDataRef.current = resolved;
        setQuizData(resolved);
        if (isReadOnly) return;
        commitBlockProps(editor, blockId, element, {
            quizData: resolved,
            editorType: 'quizBlockEditor',
        });
    };

    useEffect(() => {
        if (!isReadOnly && !hasStoredQuiz) {
            commitBlockProps(editor, blockId, element, {
                quizData: initialData,
                editorType: 'quizBlockEditor',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const propQuiz = element?.props?.quizData;
        if (propQuiz && JSON.stringify(propQuiz) !== JSON.stringify(quizData)) {
            const next = { ...propQuiz, options: withIds(propQuiz.options) };
            quizDataRef.current = next;
            setQuizData(next);
        }
    }, [element?.props?.quizData]);

    const updateQuestion = (question: string) => commitQuiz((prev) => ({ ...prev, question }));
    const updateExplanation = (explanation: string) =>
        commitQuiz((prev) => ({ ...prev, explanation }));
    const updateOptionText = (id: string, text: string) =>
        commitQuiz((prev) => ({
            ...prev,
            options: prev.options.map((opt) => (opt.id === id ? { ...opt, text } : opt)),
        }));

    const toggleCorrect = (id: string) => {
        commitQuiz((prev) => ({
            ...prev,
            options: prev.options.map((opt) => ({
                ...opt,
                isCorrect: opt.id === id ? !opt.isCorrect : false, // single correct answer
            })),
        }));
    };

    const addOption = () => {
        if (quizData.options.length >= 6) return;
        commitQuiz((prev) => ({
            ...prev,
            options: [...prev.options, { id: genId(), text: '', isCorrect: false }],
        }));
    };

    const removeOption = (id: string) => {
        if (quizData.options.length <= 2) return;
        commitQuiz((prev) => ({
            ...prev,
            options: prev.options.filter((opt) => opt.id !== id),
        }));
    };

    const switchType = (type: 'mcq' | 'trueFalse') => {
        if (type === quizData.type) return;
        if (type === 'trueFalse') {
            mcqStashRef.current = quizDataRef.current.options;
            commitQuiz((prev) => ({
                ...prev,
                type,
                options: withIds([
                    { text: 'True', isCorrect: false },
                    { text: 'False', isCorrect: false },
                ]),
            }));
        } else {
            const restored =
                mcqStashRef.current && mcqStashRef.current.length >= 2
                    ? mcqStashRef.current
                    : withIds(DEFAULT_MCQ.options.map((o) => ({ ...o })));
            commitQuiz((prev) => ({ ...prev, type, options: restored }));
        }
    };

    const handleReset = () => {
        setSelectedAnswer(null);
        setShowResult(false);
    };

    const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

    return (
        <div
            {...attributes}
            contentEditable={false}
            style={{
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                margin: '8px 0',
                overflow: 'hidden',
                backgroundColor: C.surface,
            }}
        >
            {/* Header */}
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
                <span style={{ fontSize: '14px', fontWeight: 600, color: C.indigo }}>
                    {t('header.quizBlock')}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {!isReadOnly && isEditing && (
                        <>
                            <button
                                onClick={() => switchType('mcq')}
                                style={{
                                    padding: '3px 10px',
                                    fontSize: '12px',
                                    border: `1px solid ${C.indigoBorder}`,
                                    borderRadius: '4px',
                                    backgroundColor: quizData.type === 'mcq' ? C.indigo : C.white,
                                    color: quizData.type === 'mcq' ? C.white : C.muted,
                                    cursor: 'pointer',
                                }}
                            >
                                {t('header.mcq')}
                            </button>
                            <button
                                onClick={() => switchType('trueFalse')}
                                style={{
                                    padding: '3px 10px',
                                    fontSize: '12px',
                                    border: `1px solid ${C.indigoBorder}`,
                                    borderRadius: '4px',
                                    backgroundColor: quizData.type === 'trueFalse' ? C.indigo : C.white,
                                    color: quizData.type === 'trueFalse' ? C.white : C.muted,
                                    cursor: 'pointer',
                                }}
                            >
                                {t('header.trueFalse')}
                            </button>
                        </>
                    )}
                    {!isReadOnly && (
                        <button
                            onClick={() => {
                                setIsEditing(!isEditing);
                                handleReset();
                            }}
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
                            {isEditing ? t('header.preview') : t('header.edit')}
                        </button>
                    )}
                </div>
            </div>

            <div style={{ padding: '16px' }}>
                {isEditing ? (
                    /* Edit mode — each field is its own rich-text editor */
                    <div>
                        {/* Question */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: C.label, display: 'block', marginBottom: '4px' }}>
                                {t('labels.question')}
                            </label>
                            <RichField
                                value={quizData.question}
                                onChange={updateQuestion}
                                placeholder={t('placeholders.question')}
                                minHeight={64}
                            />
                        </div>

                        {/* Options */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: C.label, display: 'block', marginBottom: '4px' }}>
                                {t('labels.options')}
                            </label>
                            {quizData.options.map((option, index) => (
                                <div
                                    key={option.id || index}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '8px',
                                        marginBottom: '10px',
                                    }}
                                >
                                    <button
                                        onClick={() => toggleCorrect(option.id!)}
                                        title={t('actions.markCorrect')}
                                        style={{
                                            width: '24px',
                                            height: '24px',
                                            marginTop: '6px',
                                            borderRadius: '50%',
                                            border: `2px solid ${option.isCorrect ? C.green : C.gray}`,
                                            backgroundColor: option.isCorrect ? C.green : C.white,
                                            color: option.isCorrect ? C.white : C.gray,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '12px',
                                            flexShrink: 0,
                                        }}
                                    >
                                        {option.isCorrect ? '✓' : optionLabels[index]}
                                    </button>

                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <RichField
                                            value={option.text}
                                            onChange={(html) => updateOptionText(option.id!, html)}
                                            placeholder={t('placeholders.option', {
                                                label: optionLabels[index],
                                            })}
                                            minHeight={44}
                                        />
                                    </div>

                                    {quizData.type === 'mcq' && (
                                        <button
                                            onClick={() => removeOption(option.id!)}
                                            disabled={quizData.options.length <= 2}
                                            title={t('actions.removeOption')}
                                            style={{
                                                padding: '4px 8px',
                                                marginTop: '6px',
                                                fontSize: '12px',
                                                border: `1px solid ${C.inputBorder}`,
                                                borderRadius: '4px',
                                                backgroundColor: C.white,
                                                color: C.red,
                                                cursor: quizData.options.length <= 2 ? 'default' : 'pointer',
                                                opacity: quizData.options.length <= 2 ? 0.3 : 1,
                                                flexShrink: 0,
                                            }}
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            ))}

                            {quizData.type === 'mcq' && quizData.options.length < 6 && (
                                <button
                                    onClick={addOption}
                                    style={{
                                        padding: '4px 12px',
                                        fontSize: '12px',
                                        border: `1px dashed ${C.gray}`,
                                        borderRadius: '4px',
                                        backgroundColor: C.white,
                                        color: C.muted,
                                        cursor: 'pointer',
                                        marginTop: '4px',
                                    }}
                                >
                                    {t('actions.addOption')}
                                </button>
                            )}
                        </div>

                        {/* Explanation */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: C.label, display: 'block', marginBottom: '4px' }}>
                                {t('labels.explanation')}
                            </label>
                            <RichField
                                value={quizData.explanation}
                                onChange={updateExplanation}
                                placeholder={t('placeholders.explanation')}
                                minHeight={44}
                            />
                        </div>
                    </div>
                ) : (
                    /* Preview / interactive mode */
                    <div>
                        {/* Question */}
                        {!isHtmlEmpty(quizData.question) ? (
                            <RichHtml
                                html={quizData.question}
                                style={{ fontSize: '16px', color: C.text, marginBottom: '12px' }}
                            />
                        ) : (
                            <div style={{ fontSize: '16px', fontWeight: 600, color: C.text, marginBottom: '12px' }}>
                                {t('preview.noQuestion')}
                            </div>
                        )}

                        {/* Options */}
                        <div style={{ marginBottom: '12px' }}>
                            {quizData.options.map((option, index) => {
                                let bgColor = C.white;
                                let borderColor = C.inputBorder;
                                let textColor = C.text;

                                if (selectedAnswer === index) {
                                    borderColor = C.indigo;
                                    bgColor = C.indigoBg;
                                }

                                if (showResult) {
                                    if (option.isCorrect) {
                                        bgColor = C.correctBg;
                                        borderColor = C.green;
                                        textColor = C.correctText;
                                    } else if (selectedAnswer === index && !option.isCorrect) {
                                        bgColor = C.wrongBg;
                                        borderColor = C.red;
                                        textColor = C.wrongText;
                                    }
                                }

                                return (
                                    <div
                                        key={option.id || index}
                                        onClick={() => {
                                            if (!showResult) setSelectedAnswer(index);
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '10px',
                                            padding: '10px 12px',
                                            border: `2px solid ${borderColor}`,
                                            borderRadius: '6px',
                                            marginBottom: '6px',
                                            cursor: showResult ? 'default' : 'pointer',
                                            backgroundColor: bgColor,
                                            color: textColor,
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        <span style={{
                                            width: '24px',
                                            height: '24px',
                                            marginTop: '2px',
                                            borderRadius: '50%',
                                            border: `2px solid ${borderColor}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            flexShrink: 0,
                                            backgroundColor: selectedAnswer === index ? borderColor : 'transparent',
                                            color: selectedAnswer === index ? C.white : textColor,
                                        }}>
                                            {showResult && option.isCorrect ? '✓' : optionLabels[index]}
                                        </span>
                                        <RichHtml
                                            html={
                                                isHtmlEmpty(option.text)
                                                    ? t('placeholders.option', {
                                                          label: optionLabels[index],
                                                      })
                                                    : option.text
                                            }
                                            style={{ fontSize: '14px', flex: 1, minWidth: 0 }}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {!showResult ? (
                                <button
                                    onClick={() => setShowResult(true)}
                                    disabled={selectedAnswer === null}
                                    style={{
                                        padding: '6px 16px',
                                        fontSize: '13px',
                                        border: 'none',
                                        borderRadius: '4px',
                                        backgroundColor: selectedAnswer !== null ? C.indigo : C.gray,
                                        color: C.white,
                                        cursor: selectedAnswer !== null ? 'pointer' : 'default',
                                    }}
                                >
                                    {t('preview.checkAnswer')}
                                </button>
                            ) : (
                                <button
                                    onClick={handleReset}
                                    style={{
                                        padding: '6px 16px',
                                        fontSize: '13px',
                                        border: `1px solid ${C.gray}`,
                                        borderRadius: '4px',
                                        backgroundColor: C.white,
                                        color: C.muted,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {t('preview.tryAgain')}
                                </button>
                            )}
                        </div>

                        {/* Explanation */}
                        {showResult && !isHtmlEmpty(quizData.explanation) && (
                            <div
                                style={{
                                    marginTop: '12px',
                                    padding: '10px 12px',
                                    backgroundColor: C.explBg,
                                    border: `1px solid ${C.explBorder}`,
                                    borderRadius: '6px',
                                    fontSize: '13px',
                                    color: C.explText,
                                }}
                            >
                                <strong>{t('preview.explanationLabel')}</strong>
                                <RichHtml html={quizData.explanation} />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {children}
        </div>
    );
}

// Quiz icon
const QuizIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

// Yoopta Plugin Definition
export const QuizBlockPlugin = new YooptaPlugin<{ quizBlock: any }>({
    type: 'quizBlock',
    elements: {
        quizBlock: {
            render: QuizBlock,
        },
    },
    options: {
        display: {
            title: 'Quiz Block',
            description: 'Add an interactive quiz question',
            icon: <QuizIcon />,
        },
        shortcuts: ['quiz', 'question', 'mcq', 'test'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'quizBlock') {
                        return undefined;
                    }
                    // decodeBlockData handles BOTH the new base64 payload and any
                    // older raw/escaped-JSON data-quiz, so existing slides keep
                    // working.
                    const quizData: QuizData = decodeBlockData<QuizData>(
                        element.getAttribute('data-quiz'),
                        DEFAULT_MCQ
                    );
                    return {
                        id: `quiz-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'quizBlock',
                        props: { quizData, editorType: 'quizBlockEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                // Bulletproof: this serializer must NEVER throw, or it would break
                // the whole-document Save Draft / Publish ("Could not read editor
                // content"). The data-quiz attribute (source of truth) is always
                // emitted; the static body is best-effort.
                const props = (element && element.props) || {};
                const quizData: QuizData =
                    props.quizData && typeof props.quizData === 'object'
                        ? props.quizData
                        : DEFAULT_MCQ;
                const options = Array.isArray(quizData.options) ? quizData.options : [];

                // base64 so the document-wide HTML sanitizers can never corrupt
                // the JSON (an S3 image URL inside a field used to truncate it,
                // wiping the whole quiz on reload).
                let quizJson: string;
                try {
                    quizJson = encodeBlockData({ ...quizData, options });
                } catch {
                    quizJson = encodeBlockData(DEFAULT_MCQ);
                }

                let body = '';
                try {
                    const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
                    const optionsHtml = options
                        .map(
                            (opt, i) =>
                                `<div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 2px solid ${C.inputBorder}; border-radius: 6px; margin-bottom: 6px; background: ${C.white};"><span style="width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${C.inputBorder}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0;">${optionLabels[i]}</span><div style="font-size: 14px;">${(opt && opt.text) || ''}</div></div>`
                        )
                        .join('');
                    body = `<div style="padding: 4px 8px; background: ${C.indigoBg}; border: 1px solid ${C.indigoBorder}; border-radius: 4px; display: inline-block; font-size: 12px; font-weight: 600; color: ${C.indigo}; margin-bottom: 12px;">QUIZ</div><div style="font-size: 16px; color: ${C.text}; margin-bottom: 12px;">${quizData.question || ''}</div>${optionsHtml}`;
                } catch {
                    body = '';
                }

                return `<div data-yoopta-type="quizBlock" data-editor-type="quizBlockEditor" data-quiz="${quizJson}" style="border: 1px solid ${C.border}; border-radius: 8px; padding: 16px; margin: 8px 0; background: ${C.surface};">${body}</div>`;
            },
        },
    },
});
