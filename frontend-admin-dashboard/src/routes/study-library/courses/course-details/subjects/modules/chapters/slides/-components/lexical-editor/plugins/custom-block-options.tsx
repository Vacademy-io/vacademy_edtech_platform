import { $insertNodes, $createParagraphNode, type LexicalEditor, type LexicalNode } from 'lexical';
import type { TFunction } from 'i18next';
import {
    Image,
    VideoCamera,
    Paperclip,
    Browser,
    Megaphone,
    MusicNotes,
    FilePdf,
    Function as FunctionIcon,
    GitBranch,
    TextIndent,
    ListNumbers,
    BookOpen,
    GameController,
    Cards,
    Rows,
    Question,
    ListChecks,
    Columns,
    CaretCircleDown,
    Code,
    Terminal,
} from '@phosphor-icons/react';
import { SlashMenuOption } from './SlashMenuPlugin';
import {
    MathBlock,
    MermaidBlock,
    AudioBlock,
    PdfBlock,
    FillBlanksBlock,
    JupyterBlock,
    ScratchBlock,
    TocBlock,
} from '../nodes/simple-attr-nodes';
import { ImageBlock, VideoBlock, FileBlock, EmbedBlock, CalloutBlock } from '../nodes/media-nodes';
import {
    FlashcardBlock,
    TabsBlock,
    QuizBlock,
    TimelineBlock,
    ColumnsBlock,
    AccordionBlock,
    CodeBlock,
    MultiLangCodeBlock,
} from '../nodes/payload-nodes';

/** Slash-menu entries for the custom document blocks. */

const insertBlock = (editor: LexicalEditor, create: () => LexicalNode) => {
    editor.update(() => {
        // Follow with an empty paragraph so the caret has somewhere to land
        // after inserting a decorator (non-text) block.
        $insertNodes([create(), $createParagraphNode()]);
    });
};

export function buildCustomBlockOptions(t: TFunction): SlashMenuOption[] {
    return [
        new SlashMenuOption(t('customBlocks.image.title'), {
            description: t('customBlocks.image.description'),
            menuIcon: Image,
            keywords: ['image', 'picture', 'photo'],
            onSelect: (editor) => insertBlock(editor, () => ImageBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.video.title'), {
            description: t('customBlocks.video.description'),
            menuIcon: VideoCamera,
            keywords: ['video', 'movie'],
            onSelect: (editor) => insertBlock(editor, () => VideoBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.embed.title'), {
            description: t('customBlocks.embed.description'),
            menuIcon: Browser,
            keywords: ['embed', 'youtube', 'vimeo', 'loom', 'iframe'],
            onSelect: (editor) => insertBlock(editor, () => EmbedBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.file.title'), {
            description: t('customBlocks.file.description'),
            menuIcon: Paperclip,
            keywords: ['file', 'attachment', 'download'],
            onSelect: (editor) => insertBlock(editor, () => FileBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.callout.title'), {
            description: t('customBlocks.callout.description'),
            menuIcon: Megaphone,
            keywords: ['callout', 'note', 'alert', 'info'],
            onSelect: (editor) => insertBlock(editor, () => CalloutBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.audio.title'), {
            description: t('customBlocks.audio.description'),
            menuIcon: MusicNotes,
            keywords: ['audio', 'sound', 'music', 'podcast'],
            onSelect: (editor) => insertBlock(editor, () => AudioBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.pdfViewer.title'), {
            description: t('customBlocks.pdfViewer.description'),
            menuIcon: FilePdf,
            keywords: ['pdf', 'document'],
            onSelect: (editor) => insertBlock(editor, () => PdfBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.math.title'), {
            description: t('customBlocks.math.description'),
            menuIcon: FunctionIcon,
            keywords: ['math', 'latex', 'formula', 'equation', 'katex'],
            onSelect: (editor) => insertBlock(editor, () => MathBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.mermaid.title'), {
            description: t('customBlocks.mermaid.description'),
            menuIcon: GitBranch,
            keywords: ['mermaid', 'diagram', 'flowchart', 'chart'],
            onSelect: (editor) => insertBlock(editor, () => MermaidBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.fillBlanks.title'), {
            description: t('customBlocks.fillBlanks.description'),
            menuIcon: ListNumbers,
            keywords: ['fill', 'blanks', 'cloze', 'exercise'],
            onSelect: (editor) => insertBlock(editor, () => FillBlanksBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.toc.title'), {
            description: t('customBlocks.toc.description'),
            menuIcon: TextIndent,
            keywords: ['toc', 'contents', 'outline'],
            onSelect: (editor) => insertBlock(editor, () => TocBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.jupyter.title'), {
            description: t('customBlocks.jupyter.description'),
            menuIcon: BookOpen,
            keywords: ['jupyter', 'notebook', 'python'],
            onSelect: (editor) => insertBlock(editor, () => JupyterBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.scratch.title'), {
            description: t('customBlocks.scratch.description'),
            menuIcon: GameController,
            keywords: ['scratch', 'game', 'project'],
            onSelect: (editor) => insertBlock(editor, () => ScratchBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.flashcard.title'), {
            description: t('customBlocks.flashcard.description'),
            menuIcon: Cards,
            keywords: ['flashcard', 'card', 'flip'],
            onSelect: (editor) => insertBlock(editor, () => FlashcardBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.tabs.title'), {
            description: t('customBlocks.tabs.description'),
            menuIcon: Rows,
            keywords: ['tabs', 'tabbed', 'sections'],
            onSelect: (editor) => insertBlock(editor, () => TabsBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.quiz.title'), {
            description: t('customBlocks.quiz.description'),
            menuIcon: Question,
            keywords: ['quiz', 'mcq', 'question', 'test'],
            onSelect: (editor) => insertBlock(editor, () => QuizBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.timeline.title'), {
            description: t('customBlocks.timeline.description'),
            menuIcon: ListChecks,
            keywords: ['timeline', 'steps', 'process'],
            onSelect: (editor) => insertBlock(editor, () => TimelineBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.columns.title'), {
            description: t('customBlocks.columns.description'),
            menuIcon: Columns,
            keywords: ['columns', 'layout', 'grid'],
            onSelect: (editor) => insertBlock(editor, () => ColumnsBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.accordion.title'), {
            description: t('customBlocks.accordion.description'),
            menuIcon: CaretCircleDown,
            keywords: ['accordion', 'collapse', 'expand', 'faq'],
            onSelect: (editor) => insertBlock(editor, () => AccordionBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.code.title'), {
            description: t('customBlocks.code.description'),
            menuIcon: Code,
            keywords: ['code', 'snippet', 'pre'],
            onSelect: (editor) => insertBlock(editor, () => CodeBlock.$create()),
        }),
        new SlashMenuOption(t('customBlocks.codeEditor.title'), {
            description: t('customBlocks.codeEditor.description'),
            menuIcon: Terminal,
            keywords: ['code', 'python', 'run', 'interactive', 'editor'],
            onSelect: (editor) => insertBlock(editor, () => MultiLangCodeBlock.$create()),
        }),
    ];
}
