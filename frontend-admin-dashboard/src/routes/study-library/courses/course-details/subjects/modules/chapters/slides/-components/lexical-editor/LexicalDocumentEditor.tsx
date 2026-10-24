import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TRANSFORMERS } from '@lexical/markdown';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import { editorNodes, editorTheme, onEditorError } from './editor-config';
import { importDocHtml, exportDocHtml, diffStructuralLoss } from './serialization';
import { AutosaveBridgePlugin } from './plugins/AutosaveBridgePlugin';
import { SlashMenuPlugin } from './plugins/SlashMenuPlugin';
import { buildCustomBlockOptions } from './plugins/custom-block-options';
import { FloatingToolbarPlugin } from './plugins/FloatingToolbarPlugin';
import { DragHandlePlugin } from './plugins/DragHandlePlugin';
import './lexical-editor.css';

export interface LexicalDocumentEditorProps {
    slideId: string;
    /** Full stored HTML (formatHTMLString skeleton + marker wrapper). The
     *  content source (local draft / data / published_data) is chosen by the
     *  caller with the same precedence as the Yoopta path. */
    initialHtml: string;
    readOnly?: boolean;
    /** Registers a synchronous "current HTML" getter used by slide-material's
     *  getCurrentEditorHTMLContent delegation. The getter never throws — it
     *  falls back to the last successful serialization. */
    registerHtmlGetter: (fn: () => string) => void;
    /** Fired once after the initial import: hands back the post-import
     *  round-trip HTML (the only stable unsaved-changes baseline) plus any
     *  block types the import dropped (integrity guard input). */
    onReady: (roundTrippedHtml: string, lostTypes: string[]) => void;
    /** Debounced (500ms) full-format HTML on every real edit. */
    onDebouncedHtml: (html: string) => void;
}

/** Loads initial content once, wires the html getter, reports the baseline. */
function EditorLifecyclePlugin({
    initialHtml,
    registerHtmlGetter,
    onReady,
}: Pick<LexicalDocumentEditorProps, 'initialHtml' | 'registerHtmlGetter' | 'onReady'>) {
    const [editor] = useLexicalComposerContext();
    const initializedRef = useRef(false);
    const lastGoodHtmlRef = useRef<string>('');

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        importDocHtml(editor, initialHtml);
        const roundTripped = exportDocHtml(editor);
        lastGoodHtmlRef.current = roundTripped;

        registerHtmlGetter(() => {
            try {
                const htmlOut = exportDocHtml(editor);
                lastGoodHtmlRef.current = htmlOut;
                return htmlOut;
            } catch (error) {
                // Never throw into SaveDraft — fall back to the last good
                // serialization rather than losing the user's work.
                console.error('[Lexical] html getter failed, using fallback:', error);
                return lastGoodHtmlRef.current;
            }
        });

        onReady(roundTripped, diffStructuralLoss(initialHtml, roundTripped));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor]);

    return null;
}

/** Keeps the editable state in sync with the readOnly prop. */
function EditablePlugin({ readOnly }: { readOnly: boolean }) {
    const [editor] = useLexicalComposerContext();
    useEffect(() => {
        editor.setEditable(!readOnly);
    }, [editor, readOnly]);
    return null;
}

export default function LexicalDocumentEditor({
    slideId,
    initialHtml,
    readOnly = false,
    registerHtmlGetter,
    onReady,
    onDebouncedHtml,
}: LexicalDocumentEditorProps) {
    const { t } = useTranslation('studyLibraryLexicalDocumentEditor');
    // One composer per slide (caller passes key={slideId} too, belt+braces).
    const [initialConfig] = useState(() => ({
        namespace: `doc-slide-${slideId}`,
        nodes: editorNodes,
        theme: editorTheme,
        editable: !readOnly,
        onError: onEditorError,
    }));

    // The drag-handle plugin portals its grip + drop line into this anchor and
    // positions them relative to it; hover detection runs on the anchor's
    // parent (.lexical-doc-editor). Captured post-mount so the plugin only
    // mounts once the wrapper DOM exists.
    const [anchorElem, setAnchorElem] = useState<HTMLDivElement | null>(null);
    const onAnchorRef = useCallback((el: HTMLDivElement | null) => {
        if (el) setAnchorElem(el);
    }, []);

    return (
        <div className="lexical-doc-editor" data-slide-id={slideId}>
            <LexicalComposer initialConfig={initialConfig}>
                <RichTextPlugin
                    contentEditable={
                        <div className="lexical-editor-anchor" ref={onAnchorRef}>
                            <ContentEditable className="lexical-content-editable" />
                        </div>
                    }
                    placeholder={
                        <div className="pointer-events-none absolute left-7 top-1 text-lg text-gray-400">
                            {t('placeholder')}
                        </div>
                    }
                    ErrorBoundary={LexicalErrorBoundary}
                />
                <HistoryPlugin />
                <ListPlugin />
                <CheckListPlugin />
                <TablePlugin />
                <LinkPlugin />
                <TabIndentationPlugin />
                <HorizontalRulePlugin />
                <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
                {!readOnly && <SlashMenuPlugin extraOptions={buildCustomBlockOptions(t)} />}
                {!readOnly && <FloatingToolbarPlugin />}
                {!readOnly && anchorElem && <DragHandlePlugin anchorElem={anchorElem} />}
                <EditablePlugin readOnly={readOnly} />
                <EditorLifecyclePlugin
                    initialHtml={initialHtml}
                    registerHtmlGetter={registerHtmlGetter}
                    onReady={onReady}
                />
                <AutosaveBridgePlugin onDebouncedHtml={onDebouncedHtml} />
            </LexicalComposer>
        </div>
    );
}
