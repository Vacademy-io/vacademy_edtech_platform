import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { RichTextField, RichTextHtml } from '../../yoopta-editor-customizations/RichTextField';
import { cn } from '@/lib/utils';
import { Plus, Trash, CaretDown, CaretRight, ArrowsClockwise } from '@phosphor-icons/react';
import type {
    FlashcardPayload,
    TabsPayload,
    QuizPayload,
    TimelinePayload,
    ColumnsPayload,
    AccordionPayload,
    CodePayload,
    MultiLangCodePayload,
} from '../nodes/payload-nodes';

/** Editing UIs for the base64-payload blocks. Rich HTML sub-fields reuse the
 *  battle-tested RichTextField (shared with the legacy editor) — its output is
 *  exactly the rich-HTML dialect the learner app already renders. */

interface BlockEditorProps<T> {
    payload: T;
    setPayload: (next: T) => void;
    readOnly: boolean;
}

function BlockShell({
    title,
    children,
    actions,
}: {
    title: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
}) {
    return (
        <div className="my-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-caption font-semibold text-neutral-600">{title}</span>
                {actions}
            </div>
            {children}
        </div>
    );
}

// ---------- Flashcard ----------
export function FlashcardBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<FlashcardPayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    const [flipped, setFlipped] = useState(false);

    if (readOnly) {
        return (
            <BlockShell
                title={t('flashcard.title')}
                actions={
                    <MyButton buttonType="text" scale="small" onClick={() => setFlipped(!flipped)}>
                        <ArrowsClockwise size={14} className="mr-1" /> {t('flashcard.flip')}
                    </MyButton>
                }
            >
                <RichTextHtml html={flipped ? payload.back : payload.front} />
            </BlockShell>
        );
    }
    return (
        <BlockShell title={t('flashcard.title')}>
            <div className="grid gap-3 md:grid-cols-2">
                <div>
                    <div className="mb-1 text-caption font-semibold text-primary-500">
                        {t('flashcard.front')}
                    </div>
                    <div className="rounded-md border border-neutral-200 bg-white p-2">
                        <RichTextField
                            value={payload.front}
                            onChange={(html) => setPayload({ ...payload, front: html })}
                            placeholder={t('flashcard.frontPlaceholder')}
                            minHeight={60}
                        />
                    </div>
                </div>
                <div>
                    <div className="mb-1 text-caption font-semibold text-primary-500">
                        {t('flashcard.back')}
                    </div>
                    <div className="rounded-md border border-neutral-200 bg-white p-2">
                        <RichTextField
                            value={payload.back}
                            onChange={(html) => setPayload({ ...payload, back: html })}
                            placeholder={t('flashcard.backPlaceholder')}
                            minHeight={60}
                        />
                    </div>
                </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-caption text-neutral-600">
                {t('flashcard.aspectRatio')}
                {(['original', '1:1', '4:3', '16:9'] as const).map((r) => (
                    <button
                        key={r}
                        type="button"
                        className={cn(
                            'rounded-md border border-neutral-200 px-2 py-0.5',
                            payload.aspectRatio === r && 'border-primary-400 text-primary-500'
                        )}
                        onClick={() => setPayload({ ...payload, aspectRatio: r })}
                    >
                        {r}
                    </button>
                ))}
            </div>
        </BlockShell>
    );
}

// ---------- Tabs ----------
export function TabsBlockEditor({ payload, setPayload, readOnly }: BlockEditorProps<TabsPayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    const [active, setActive] = useState(0);
    const tabs = payload.tabs;
    const activeTab = tabs[Math.min(active, tabs.length - 1)];

    return (
        <BlockShell
            title={t('tabs.title')}
            actions={
                !readOnly ? (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() => {
                            setPayload({
                                tabs: [
                                    ...tabs,
                                    {
                                        label: t('tabs.tabDefaultLabel', { number: tabs.length + 1 }),
                                        content: '',
                                    },
                                ],
                            });
                            setActive(tabs.length);
                        }}
                    >
                        <Plus size={14} className="mr-1" /> {t('tabs.addTab')}
                    </MyButton>
                ) : undefined
            }
        >
            <div className="mb-2 flex flex-wrap gap-1 border-b border-neutral-200">
                {tabs.map((tab, i) => (
                    <button
                        key={i}
                        type="button"
                        className={cn(
                            'rounded-t-md px-3 py-1.5 text-caption font-medium',
                            i === active
                                ? 'border-b-2 border-primary-500 text-primary-500'
                                : 'text-neutral-500'
                        )}
                        onClick={() => setActive(i)}
                    >
                        {tab.label || t('tabs.tabDefaultLabel', { number: i + 1 })}
                    </button>
                ))}
            </div>
            {activeTab && (
                <div>
                    {!readOnly && (
                        <div className="mb-2 flex items-center gap-2">
                            <MyInput
                                inputType="text"
                                inputPlaceholder={t('tabs.tabLabelPlaceholder')}
                                input={activeTab.label}
                                onChangeFunction={(e) =>
                                    setPayload({
                                        tabs: tabs.map((tb, i) =>
                                            i === active ? { ...tb, label: e.target.value } : tb
                                        ),
                                    })
                                }
                                size="small"
                            />
                            {tabs.length > 1 && (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => {
                                        setPayload({ tabs: tabs.filter((_, i) => i !== active) });
                                        setActive(Math.max(0, active - 1));
                                    }}
                                >
                                    <Trash size={14} />
                                </MyButton>
                            )}
                        </div>
                    )}
                    {readOnly ? (
                        <RichTextHtml html={activeTab.content} />
                    ) : (
                        <div className="rounded-md border border-neutral-200 bg-white p-2">
                            <RichTextField
                                value={activeTab.content}
                                onChange={(html) =>
                                    setPayload({
                                        tabs: tabs.map((tb, i) =>
                                            i === active ? { ...tb, content: html } : tb
                                        ),
                                    })
                                }
                                placeholder={t('tabs.contentPlaceholder')}
                                minHeight={80}
                            />
                        </div>
                    )}
                </div>
            )}
        </BlockShell>
    );
}

// ---------- Quiz ----------
export function QuizBlockEditor({ payload, setPayload, readOnly }: BlockEditorProps<QuizPayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    const letters = 'ABCDEFGHIJ';
    /* Native radios sharing a `name` form ONE document-wide group, so a second
     * quiz block on the same slide would silently uncheck the first one's DOM
     * node (React only rewrites `checked` when the prop changes, so it never
     * repaints the loser) — the answer looked lost even though the payload was
     * intact. One group per block keeps them independent. */
    const groupName = `quiz-correct-${useId()}`;

    const setType = (type: QuizPayload['type']) => {
        if (type === payload.type) return;
        if (type === 'trueFalse') {
            setPayload({
                ...payload,
                type,
                options: [
                    { text: t('quiz.true'), isCorrect: true },
                    { text: t('quiz.false'), isCorrect: false },
                ],
            });
        } else {
            setPayload({ ...payload, type });
        }
    };

    return (
        <BlockShell
            title={t('quiz.title')}
            actions={
                !readOnly ? (
                    <div className="flex gap-1">
                        {(['mcq', 'trueFalse'] as const).map((qType) => (
                            <button
                                key={qType}
                                type="button"
                                className={cn(
                                    'rounded-md border border-neutral-200 px-2 py-0.5 text-caption',
                                    payload.type === qType && 'border-primary-400 text-primary-500'
                                )}
                                onClick={() => setType(qType)}
                            >
                                {qType === 'mcq' ? t('quiz.mcq') : t('quiz.trueFalse')}
                            </button>
                        ))}
                    </div>
                ) : undefined
            }
        >
            {readOnly ? (
                <RichTextHtml html={payload.question} />
            ) : (
                <div className="mb-2 rounded-md border border-neutral-200 bg-white p-2">
                    <RichTextField
                        value={payload.question}
                        onChange={(html) => setPayload({ ...payload, question: html })}
                        placeholder={t('quiz.questionPlaceholder')}
                        minHeight={40}
                    />
                </div>
            )}
            {payload.options.map((opt, i) => (
                <div
                    key={i}
                    className={cn(
                        'mb-1 flex items-start gap-2 rounded-md border bg-white p-2',
                        opt.isCorrect ? 'border-success-400' : 'border-neutral-200'
                    )}
                >
                    <input
                        type="radio"
                        name={groupName}
                        className="mt-1.5"
                        checked={opt.isCorrect}
                        disabled={readOnly}
                        onChange={() =>
                            setPayload({
                                ...payload,
                                options: payload.options.map((o, j) => ({
                                    ...o,
                                    isCorrect: j === i,
                                })),
                            })
                        }
                    />
                    <span className="mt-1 text-caption font-semibold text-primary-500">
                        {letters[i]}.
                    </span>
                    <div className="grow">
                        {readOnly || payload.type === 'trueFalse' ? (
                            <RichTextHtml html={opt.text} />
                        ) : (
                            <RichTextField
                                value={opt.text}
                                onChange={(html) =>
                                    setPayload({
                                        ...payload,
                                        options: payload.options.map((o, j) =>
                                            j === i ? { ...o, text: html } : o
                                        ),
                                    })
                                }
                                placeholder={t('quiz.optionPlaceholder', { letter: letters[i] })}
                                minHeight={24}
                            />
                        )}
                    </div>
                    {!readOnly && payload.type === 'mcq' && payload.options.length > 2 && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            onClick={() =>
                                setPayload({
                                    ...payload,
                                    options: payload.options.filter((_, j) => j !== i),
                                })
                            }
                        >
                            <Trash size={14} />
                        </MyButton>
                    )}
                </div>
            ))}
            {!readOnly && payload.type === 'mcq' && payload.options.length < 10 && (
                <MyButton
                    buttonType="text"
                    scale="small"
                    onClick={() =>
                        setPayload({
                            ...payload,
                            options: [...payload.options, { text: '', isCorrect: false }],
                        })
                    }
                >
                    <Plus size={14} className="mr-1" /> {t('quiz.addOption')}
                </MyButton>
            )}
            {!readOnly && (
                <div className="mt-2">
                    <div className="mb-1 text-caption text-neutral-500">
                        {t('quiz.explanationLabel')}
                    </div>
                    <div className="rounded-md border border-neutral-200 bg-white p-2">
                        <RichTextField
                            value={payload.explanation}
                            onChange={(html) => setPayload({ ...payload, explanation: html })}
                            placeholder={t('quiz.explanationPlaceholder')}
                            minHeight={32}
                        />
                    </div>
                </div>
            )}
        </BlockShell>
    );
}

// ---------- Timeline ----------
export function TimelineBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<TimelinePayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    return (
        <BlockShell
            title={t('timeline.title')}
            actions={
                !readOnly ? (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() =>
                            setPayload({
                                steps: [
                                    ...payload.steps,
                                    {
                                        title: t('timeline.stepDefaultTitle', {
                                            number: payload.steps.length + 1,
                                        }),
                                        description: '',
                                        color: '#007acc', // design-lint-ignore: serialized learner HTML needs literal colours
                                    },
                                ],
                            })
                        }
                    >
                        <Plus size={14} className="mr-1" /> {t('timeline.addStep')}
                    </MyButton>
                ) : undefined
            }
        >
            <div className="border-l-2 border-neutral-200 pl-4">
                {payload.steps.map((step, i) => (
                    <div key={i} className="relative mb-3">
                        <span
                            className="absolute -left-6 top-1.5 size-3 rounded-full"
                            style={{ background: step.color }}
                        />
                        {readOnly ? (
                            <>
                                <div className="font-semibold text-neutral-700">{step.title}</div>
                                {step.description && (
                                    <div className="text-caption text-neutral-500">
                                        {step.description}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex items-start gap-2">
                                <div className="flex grow flex-col gap-1">
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('timeline.stepTitlePlaceholder')}
                                        input={step.title}
                                        onChangeFunction={(e) =>
                                            setPayload({
                                                steps: payload.steps.map((s, j) =>
                                                    j === i ? { ...s, title: e.target.value } : s
                                                ),
                                            })
                                        }
                                        size="small"
                                    />
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('timeline.descriptionPlaceholder')}
                                        input={step.description}
                                        onChangeFunction={(e) =>
                                            setPayload({
                                                steps: payload.steps.map((s, j) =>
                                                    j === i
                                                        ? { ...s, description: e.target.value }
                                                        : s
                                                ),
                                            })
                                        }
                                        size="small"
                                    />
                                </div>
                                <input
                                    type="color"
                                    aria-label={t('timeline.stepColorAriaLabel')}
                                    value={step.color}
                                    className="mt-1 size-6 cursor-pointer rounded border-none"
                                    onChange={(e) =>
                                        setPayload({
                                            steps: payload.steps.map((s, j) =>
                                                j === i ? { ...s, color: e.target.value } : s
                                            ),
                                        })
                                    }
                                />
                                {payload.steps.length > 1 && (
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        onClick={() =>
                                            setPayload({
                                                steps: payload.steps.filter((_, j) => j !== i),
                                            })
                                        }
                                    >
                                        <Trash size={14} />
                                    </MyButton>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </BlockShell>
    );
}

// ---------- Columns ----------
export function ColumnsBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<ColumnsPayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    return (
        <BlockShell
            title={t('columns.title', { count: payload.columns.length })}
            actions={
                !readOnly ? (
                    <div className="flex items-center gap-1">
                        {payload.columns.length < 4 && (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() =>
                                    setPayload({
                                        ...payload,
                                        columns: [...payload.columns, { content: '' }],
                                    })
                                }
                            >
                                <Plus size={14} className="mr-1" /> {t('columns.addColumn')}
                            </MyButton>
                        )}
                        {payload.columns.length > 1 && (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() =>
                                    setPayload({
                                        ...payload,
                                        columns: payload.columns.slice(0, -1),
                                    })
                                }
                            >
                                <Trash size={14} className="mr-1" /> {t('columns.removeLast')}
                            </MyButton>
                        )}
                    </div>
                ) : undefined
            }
        >
            <div
                className="grid"
                style={{
                    gridTemplateColumns: `repeat(${payload.columns.length}, 1fr)`,
                    gap: payload.gap,
                }}
            >
                {payload.columns.map((col, i) => (
                    <div key={i} className="rounded-md border border-neutral-200 bg-white p-2">
                        {readOnly ? (
                            <RichTextHtml html={col.content} />
                        ) : (
                            <RichTextField
                                value={col.content}
                                onChange={(html) =>
                                    setPayload({
                                        ...payload,
                                        columns: payload.columns.map((c, j) =>
                                            j === i ? { content: html } : c
                                        ),
                                    })
                                }
                                placeholder={t('columns.columnPlaceholder', { number: i + 1 })}
                                minHeight={60}
                            />
                        )}
                    </div>
                ))}
            </div>
        </BlockShell>
    );
}

// ---------- Accordion ----------
export function AccordionBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<AccordionPayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    const [openSet, setOpenSet] = useState<Set<number>>(() => new Set([0]));

    const toggle = (i: number) => {
        setOpenSet((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });
    };

    return (
        <BlockShell
            title={t('accordion.title')}
            actions={
                !readOnly ? (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() => {
                            setPayload({
                                items: [
                                    ...payload.items,
                                    {
                                        heading: t('accordion.sectionDefaultHeading', {
                                            number: payload.items.length + 1,
                                        }),
                                        content: '',
                                    },
                                ],
                            });
                            setOpenSet((prev) => new Set(prev).add(payload.items.length));
                        }}
                    >
                        <Plus size={14} className="mr-1" /> {t('accordion.addSection')}
                    </MyButton>
                ) : undefined
            }
        >
            {payload.items.map((item, i) => {
                const open = openSet.has(i);
                return (
                    <div key={i} className="mb-1 rounded-md border border-neutral-200 bg-white">
                        <div className="flex items-center gap-2 p-2">
                            <button
                                type="button"
                                onClick={() => toggle(i)}
                                aria-label={t('accordion.toggleSectionAriaLabel')}
                            >
                                {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
                            </button>
                            {readOnly ? (
                                <span className="font-medium text-neutral-700">{item.heading}</span>
                            ) : (
                                <>
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('accordion.sectionHeadingPlaceholder')}
                                        input={item.heading}
                                        onChangeFunction={(e) =>
                                            setPayload({
                                                items: payload.items.map((it, j) =>
                                                    j === i
                                                        ? { ...it, heading: e.target.value }
                                                        : it
                                                ),
                                            })
                                        }
                                        size="small"
                                    />
                                    {payload.items.length > 1 && (
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            onClick={() =>
                                                setPayload({
                                                    items: payload.items.filter((_, j) => j !== i),
                                                })
                                            }
                                        >
                                            <Trash size={14} />
                                        </MyButton>
                                    )}
                                </>
                            )}
                        </div>
                        {open && (
                            <div className="border-t border-neutral-100 p-2">
                                {readOnly ? (
                                    <RichTextHtml html={item.content} />
                                ) : (
                                    <RichTextField
                                        value={item.content}
                                        onChange={(html) =>
                                            setPayload({
                                                items: payload.items.map((it, j) =>
                                                    j === i ? { ...it, content: html } : it
                                                ),
                                            })
                                        }
                                        placeholder={t('accordion.sectionContentPlaceholder')}
                                        minHeight={48}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </BlockShell>
    );
}

// ---------- Code (generic) ----------
const CODE_LANGUAGES = [
    'javascript',
    'typescript',
    'python',
    'java',
    'c',
    'cpp',
    'csharp',
    'go',
    'rust',
    'html',
    'css',
    'sql',
    'bash',
    'json',
    'yaml',
];

export function CodeBlockEditor({ payload, setPayload, readOnly }: BlockEditorProps<CodePayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    return (
        <div className="my-2 overflow-hidden rounded-md">
            {!readOnly && (
                <div className="flex items-center gap-2 bg-neutral-700 px-3 py-1">
                    <select
                        aria-label={t('code.languageAriaLabel')}
                        className="rounded-sm bg-neutral-600 px-1 py-0.5 text-caption text-white"
                        value={payload.language}
                        onChange={(e) => setPayload({ ...payload, language: e.target.value })}
                    >
                        {CODE_LANGUAGES.map((l) => (
                            <option key={l} value={l}>
                                {l}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            <textarea
                className="block w-full resize-y bg-neutral-800 p-4 font-mono text-caption text-white outline-none"
                rows={Math.max(3, payload.code.split('\n').length)}
                spellCheck={false}
                readOnly={readOnly}
                placeholder={t('code.placeholder')}
                value={payload.code}
                onChange={(e) => setPayload({ ...payload, code: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
            />
        </div>
    );
}

// ---------- Multi-language runnable code ----------
export function MultiLangCodeBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<MultiLangCodePayload>) {
    const { t } = useTranslation('studyLibraryPayloadBlockEditors');
    return (
        <BlockShell
            title={t('multiLangCode.title', { language: payload.language.toUpperCase() })}
        >
            {!readOnly && (
                <div className="mb-2">
                    <select
                        aria-label={t('multiLangCode.languageAriaLabel')}
                        className="rounded-md border border-neutral-200 px-2 py-1 text-caption"
                        value={payload.language}
                        onChange={(e) => setPayload({ ...payload, language: e.target.value })}
                    >
                        {['python', 'javascript', 'html', 'css'].map((l) => (
                            <option key={l} value={l}>
                                {l}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            <textarea
                className="block w-full resize-y rounded-md bg-neutral-800 p-4 font-mono text-caption text-white outline-none"
                rows={Math.max(4, payload.code.split('\n').length)}
                spellCheck={false}
                readOnly={readOnly}
                placeholder={t('multiLangCode.placeholder', { language: payload.language })}
                value={payload.code}
                onChange={(e) => setPayload({ ...payload, code: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
            />
            {payload.output && (
                <div className="mt-2 text-caption text-neutral-500">
                    {t('multiLangCode.output')}
                    <pre className="mt-1 whitespace-pre-wrap rounded-md bg-neutral-100 p-2">
                        {payload.output}
                    </pre>
                </div>
            )}
        </BlockShell>
    );
}
