import i18next from 'i18next';
import { createBlockNode, setAttrs } from './block-node-factory';
import { encodeBlockData, decodeBlockData } from '../../yoopta-editor-customizations/RichTextField';
import {
    FlashcardBlockEditor,
    TabsBlockEditor,
    QuizBlockEditor,
    TimelineBlockEditor,
    ColumnsBlockEditor,
    AccordionBlockEditor,
    CodeBlockEditor,
    MultiLangCodeBlockEditor,
} from '../blocks/payload-block-editors';

/**
 * Base64-payload blocks — state carried as encodeBlockData() JSON in a single
 * data-* attribute (invisible to formatHTMLString's regexes by design), with a
 * static fallback body for raw-HTML renderers. Selectors and attribute names
 * MUST match the legacy Yoopta serializers: the learner app hydrates
 * `div[data-yoopta-type=…]` via decodeBlockData on the same attributes.
 */

const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// buildExportDom below runs outside React (invoked by the Yoopta/Lexical
// export pipeline, not rendered from a component), so useTranslation isn't
// available — read the current locale off the shared i18next instance
// instead, matching the module-scope-function pattern used elsewhere (e.g.
// simple-attr-nodes.tsx, Payment/utils/utils.ts).
const t = (key: string, options?: Record<string, unknown>): string =>
    i18next.t(`studyLibraryPayloadNodes:${key}`, options) as string;

/** Tag-stripped plaintext (legacy data-front/data-back fallback attrs). */
const htmlToText = (html: string): string => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || '').trim();
};

const CARD_STYLE =
    'border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa;'; // design-lint-ignore: serialized learner HTML needs literal colours

// ---------- Flashcard ----------
export interface FlashcardPayload {
    front: string; // rich HTML
    back: string; // rich HTML
    aspectRatio: 'original' | '1:1' | '4:3' | '16:9';
}

export const FlashcardBlock = createBlockNode<FlashcardPayload>({
    nodeType: 'flashcard',
    defaultPayload: { front: '', back: '', aspectRatio: 'original' },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'flashcard') return null;
        const encoded = el.getAttribute('data-flashcard');
        if (encoded) {
            return decodeBlockData<FlashcardPayload>(encoded, {
                front: '',
                back: '',
                aspectRatio: 'original',
            });
        }
        // Legacy plaintext fallback
        return {
            front: el.getAttribute('data-front') || '',
            back: el.getAttribute('data-back') || '',
            aspectRatio: (el.getAttribute('data-aspect-ratio') ||
                'original') as FlashcardPayload['aspectRatio'],
        };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'flashcard'],
            ['data-editor-type', 'flashcardEditor'],
            ['data-flashcard', encodeBlockData(p)],
            ['data-front', htmlToText(p.front)],
            ['data-back', htmlToText(p.back)],
            ['data-aspect-ratio', p.aspectRatio],
            [
                'style',
                'border: 2px solid #007acc; border-radius: 8px; padding: 16px; margin: 8px 0;', // design-lint-ignore: serialized learner HTML needs literal colours
            ],
        ]);
        el.innerHTML =
            `<div style="margin-bottom: 12px;"><div style="font-weight: 600; font-size: 12px; color: #007acc; margin-bottom: 4px;">${esc(t('flashcard.front'))}</div><div>${p.front || ''}</div></div>` + // design-lint-ignore: serialized learner HTML needs literal colours
            `<div><div style="font-weight: 600; font-size: 12px; color: #007acc; margin-bottom: 4px;">${esc(t('flashcard.back'))}</div><div>${p.back || ''}</div></div>`; // design-lint-ignore: serialized learner HTML needs literal colours
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <FlashcardBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Tabbed content ----------
export interface TabItem {
    label: string;
    content: string; // rich HTML
    color?: string;
}
export interface TabsPayload {
    tabs: TabItem[];
}

const DEFAULT_TABS: TabsPayload = {
    tabs: [
        { label: 'Tab 1', content: '' },
        { label: 'Tab 2', content: '' },
    ],
};

export const TabsBlock = createBlockNode<TabsPayload>({
    nodeType: 'tabbedContent',
    defaultPayload: DEFAULT_TABS,
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'tabbedContent') return null;
        const tabs = decodeBlockData<TabItem[]>(el.getAttribute('data-tabs'), DEFAULT_TABS.tabs);
        return { tabs: Array.isArray(tabs) && tabs.length > 0 ? tabs : DEFAULT_TABS.tabs };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'tabbedContent'],
            ['data-editor-type', 'tabsEditor'],
            ['data-tabs', encodeBlockData(p.tabs)],
            [
                'style',
                'border: 1px solid #e0e0e0; border-radius: 8px; margin: 8px 0; overflow: hidden;', // design-lint-ignore: serialized learner HTML needs literal colours
            ],
        ]);
        const headers = p.tabs
            .map(
                (t, i) =>
                    `<div style="padding: 10px 16px; font-weight: 600; font-size: 14px; border-top: 3px solid ${t.color || '#007acc'}; background: ${i === 0 ? '#fff' : '#f5f5f5'}; color: #333;">${esc(t.label)}</div>` // design-lint-ignore: serialized learner HTML needs literal colours
            )
            .join('');
        const contents = p.tabs
            .map(
                (t, i) =>
                    `<div data-tab-index="${i}" style="display: ${i === 0 ? 'block' : 'none'}; padding: 16px;">${t.content || ''}</div>`
            )
            .join('');
        el.innerHTML =
            `<div style="display: flex; border-bottom: 1px solid #e0e0e0;">${headers}</div>` + // design-lint-ignore: serialized learner HTML needs literal colours
            `<div>${contents}</div>`;
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <TabsBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Quiz ----------
export interface QuizOption {
    text: string; // rich HTML
    isCorrect: boolean;
}
export interface QuizPayload {
    question: string; // rich HTML
    type: 'mcq' | 'trueFalse';
    options: QuizOption[];
    explanation: string; // rich HTML
}

const DEFAULT_QUIZ: QuizPayload = {
    question: '',
    type: 'mcq',
    options: [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
    ],
    explanation: '',
};

export const QuizBlock = createBlockNode<QuizPayload>({
    nodeType: 'quizBlock',
    defaultPayload: DEFAULT_QUIZ,
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'quizBlock') return null;
        return decodeBlockData<QuizPayload>(el.getAttribute('data-quiz'), DEFAULT_QUIZ);
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'quizBlock'],
            ['data-editor-type', 'quizBlockEditor'],
            ['data-quiz', encodeBlockData(p)],
            ['style', CARD_STYLE],
        ]);
        const letters = 'ABCDEFGHIJ';
        const options = p.options
            .map(
                (o, i) =>
                    `<div style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; margin: 6px 0; border: 1px solid #e0e0e0; border-radius: 6px; background: #fff;"><span style="font-weight: 600; color: #007acc;">${letters[i] || i + 1}.</span><div>${o.text || ''}</div></div>` // design-lint-ignore: serialized learner HTML needs literal colours
            )
            .join('');
        el.innerHTML =
            `<div style="font-weight: 700; font-size: 12px; color: #007acc; margin-bottom: 8px;">${esc(t('quiz.label'))}</div>` + // design-lint-ignore: serialized learner HTML needs literal colours
            `<div style="margin-bottom: 8px;">${p.question || ''}</div>` +
            options;
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <QuizBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Timeline ----------
export interface TimelineStep {
    title: string;
    description: string;
    color: string;
}
export interface TimelinePayload {
    steps: TimelineStep[];
}

const DEFAULT_TIMELINE: TimelinePayload = {
    steps: [{ title: 'Step 1', description: '', color: '#007acc' }], // design-lint-ignore: serialized learner HTML needs literal colours
};

export const TimelineBlock = createBlockNode<TimelinePayload>({
    nodeType: 'timeline',
    defaultPayload: DEFAULT_TIMELINE,
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'timeline') return null;
        const steps = decodeBlockData<TimelineStep[]>(
            el.getAttribute('data-steps'),
            DEFAULT_TIMELINE.steps
        );
        return {
            steps: (Array.isArray(steps) ? steps : DEFAULT_TIMELINE.steps).map((s) => ({
                title: String(s?.title ?? ''),
                description: String(s?.description ?? ''),
                color: s?.color || '#007acc', // design-lint-ignore: serialized learner HTML needs literal colours
            })),
        };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'timeline'],
            ['data-editor-type', 'timelineEditor'],
            ['data-steps', encodeBlockData(p.steps)],
            ['style', 'padding: 8px 0; margin: 8px 0;'],
        ]);
        const steps = p.steps
            .map(
                (s) =>
                    `<div style="display: flex; gap: 12px; padding: 8px 0;"><div style="width: 12px; height: 12px; border-radius: 50%; background: ${s.color}; margin-top: 4px; flex-shrink: 0;"></div><div><div style="font-weight: 600; color: #333;">${esc(s.title)}</div>${s.description ? `<div style="font-size: 14px; color: #666;">${esc(s.description)}</div>` : ''}</div></div>` // design-lint-ignore: serialized learner HTML needs literal colours
            )
            .join('');
        el.innerHTML = `<div style="border-left: 2px solid #e0e0e0; padding-left: 16px;">${steps}</div>`; // design-lint-ignore: serialized learner HTML needs literal colours
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <TimelineBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Columns layout ----------
export interface ColumnItem {
    content: string; // rich HTML
}
export interface ColumnsPayload {
    columns: ColumnItem[];
    gap: number;
}

const DEFAULT_COLUMNS: ColumnsPayload = { columns: [{ content: '' }, { content: '' }], gap: 16 };

export const ColumnsBlock = createBlockNode<ColumnsPayload>({
    nodeType: 'columnsLayout',
    defaultPayload: DEFAULT_COLUMNS,
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'columnsLayout') return null;
        const columns = decodeBlockData<ColumnItem[]>(
            el.getAttribute('data-columns'),
            DEFAULT_COLUMNS.columns
        );
        const gap = parseInt(el.getAttribute('data-gap') || '16', 10);
        return {
            columns:
                Array.isArray(columns) && columns.length > 0 ? columns : DEFAULT_COLUMNS.columns,
            gap: Number.isFinite(gap) && gap >= 0 ? gap : 16,
        };
    },
    buildExportDom: (p) => {
        // Learner renders this raw (styled via its index.css) — the inline grid
        // is the actual learner layout.
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'columnsLayout'],
            ['data-editor-type', 'columnsEditor'],
            ['data-columns', encodeBlockData(p.columns)],
            ['data-gap', String(p.gap)],
            [
                'style',
                `display: grid; grid-template-columns: repeat(${p.columns.length}, 1fr); gap: ${p.gap}px; margin: 8px 0;`,
            ],
        ]);
        el.innerHTML = p.columns
            .map(
                (c) =>
                    `<div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px;">${c.content || ''}</div>` // design-lint-ignore: serialized learner HTML needs literal colours
            )
            .join('');
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <ColumnsBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Accordion ----------
export interface AccordionItem {
    heading: string; // plaintext
    content: string; // rich HTML
}
export interface AccordionPayload {
    items: AccordionItem[];
}

const parseDetails = (details: Element): AccordionItem => {
    const summary = details.querySelector(':scope > summary');
    const heading = summary?.textContent?.trim() || '';
    const clone = details.cloneNode(true) as HTMLElement;
    clone.querySelector(':scope > summary')?.remove();
    // Unwrap the single padding wrapper div the serializer adds
    let content = clone.innerHTML.trim();
    const tmp = document.createElement('div');
    tmp.innerHTML = content;
    if (
        tmp.children.length === 1 &&
        tmp.children[0]?.tagName === 'DIV' &&
        (tmp.children[0] as HTMLElement).style.padding === '4px 0px'
    ) {
        content = (tmp.children[0] as HTMLElement).innerHTML.trim();
    }
    return { heading, content };
};

export const AccordionBlock = createBlockNode<AccordionPayload>({
    nodeType: 'accordion',
    defaultPayload: { items: [{ heading: 'Section 1', content: '' }] },
    importTags: ['div', 'details'],
    importMatch: (el) => {
        if (el.tagName === 'DETAILS') {
            // Legacy bare <details> — but only when not inside an accordion wrapper
            // (the wrapper conversion consumes its children).
            if (el.parentElement?.getAttribute('data-yoopta-type') === 'accordion') return null;
            return { items: [parseDetails(el)] };
        }
        if (el.getAttribute('data-yoopta-type') !== 'accordion') return null;
        const items = Array.from(el.querySelectorAll(':scope > details')).map(parseDetails);
        return { items: items.length > 0 ? items : [{ heading: '', content: '' }] };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'accordion'],
            ['data-editor-type', 'accordionEditor'],
            ['style', 'margin: 8px 0;'],
        ]);
        el.innerHTML = p.items
            .map(
                (item, i) =>
                    `<details${i === 0 ? ' open' : ''}><summary>${esc(item.heading)}</summary><div style="padding: 4px 0;">${item.content || ''}</div></details>`
            )
            .join('');
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <AccordionBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Code (generic <pre data-code>) ----------
export interface CodePayload {
    code: string;
    language: string;
    theme: string;
}

const b64EncodeCode = (s: string): string => {
    try {
        return btoa(unescape(encodeURIComponent(s)));
    } catch {
        return '';
    }
};
const b64DecodeCode = (s: string): string | null => {
    try {
        return decodeURIComponent(escape(atob(s)));
    } catch {
        return null;
    }
};

export const CodeBlock = createBlockNode<CodePayload>({
    nodeType: 'code',
    defaultPayload: { code: '', language: 'javascript', theme: 'VSCode' },
    importTags: ['pre'],
    importMatch: (el) => {
        // Only claim <pre> that is NOT inside a multi-lang codeBlock wrapper
        if (el.closest('[data-yoopta-type="codeBlock"]')) return null;
        const encoded = el.getAttribute('data-code');
        const code =
            (encoded ? b64DecodeCode(encoded) : null) ??
            el.querySelector('code')?.textContent ??
            el.textContent ??
            '';
        return {
            code,
            language: el.getAttribute('data-language') || 'javascript',
            theme: el.getAttribute('data-theme') || 'VSCode',
        };
    },
    buildExportDom: (p) => {
        const el = document.createElement('pre');
        setAttrs(el, [
            ['data-code', b64EncodeCode(p.code)],
            ['data-theme', p.theme],
            ['data-language', p.language],
            ['data-meta-align', 'left'],
            ['data-meta-depth', '0'],
            [
                'style',
                'margin: 8px 0; background-color: #263238; color: #fff; padding: 20px 24px; border-radius: 6px; white-space: pre; overflow-x: auto; font-size: 14px;', // design-lint-ignore: serialized learner HTML needs literal colours
            ],
        ]);
        const code = document.createElement('code');
        code.textContent = p.code;
        el.appendChild(code);
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <CodeBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

// ---------- Multi-language runnable code block ----------
export interface MultiLangCodePayload {
    language: string;
    code: string;
    mode: string;
    output: string;
    hasRun: boolean;
}

export const MultiLangCodeBlock = createBlockNode<MultiLangCodePayload>({
    nodeType: 'codeBlock',
    defaultPayload: { language: 'python', code: '', mode: 'edit', output: '', hasRun: false },
    importTags: ['div'],
    importMatch: (el) => {
        if (el.getAttribute('data-yoopta-type') !== 'codeBlock') return null;
        return {
            language: el.getAttribute('data-language') || 'python',
            code:
                el.querySelector('pre code')?.textContent ??
                el.querySelector('pre')?.textContent ??
                '',
            mode: el.getAttribute('data-mode') || 'edit',
            output: el.getAttribute('data-output') || '',
            hasRun: el.getAttribute('data-has-run') === 'true',
        };
    },
    buildExportDom: (p) => {
        const el = document.createElement('div');
        setAttrs(el, [
            ['data-yoopta-type', 'codeBlock'],
            ['data-editor-type', 'multiLangCodeEditor'],
            ['data-language', p.language],
            ['data-mode', p.mode],
            ['data-output', p.output],
            ['data-has-run', String(p.hasRun)],
            ['style', CARD_STYLE],
        ]);
        el.innerHTML =
            `<div style="font-weight: 600; font-size: 13px; color: #666; margin-bottom: 8px;">${esc(t('multiLangCode.editorHeading', { language: p.language.toUpperCase() }))}</div>` + // design-lint-ignore: serialized learner HTML needs literal colours
            `<pre style="background: #263238; color: #fff; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 14px; white-space: pre;"><code>${esc(p.code)}</code></pre>` + // design-lint-ignore: serialized learner HTML needs literal colours
            (p.output
                ? `<div style="margin-top: 8px; font-size: 13px; color: #666;">${esc(t('multiLangCode.outputLabel'))} <pre style="background: #f5f5f5; padding: 8px; border-radius: 4px; white-space: pre-wrap;">${esc(p.output)}</pre></div>` // design-lint-ignore: serialized learner HTML needs literal colours
                : '');
        return el;
    },
    Component: ({ payload, setPayload, readOnly }) => (
        <MultiLangCodeBlockEditor payload={payload} setPayload={setPayload} readOnly={readOnly} />
    ),
});

export const payloadNodeClasses = [
    FlashcardBlock.NodeClass,
    TabsBlock.NodeClass,
    QuizBlock.NodeClass,
    TimelineBlock.NodeClass,
    ColumnsBlock.NodeClass,
    AccordionBlock.NodeClass,
    CodeBlock.NodeClass,
    MultiLangCodeBlock.NodeClass,
];
