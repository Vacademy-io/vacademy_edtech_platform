import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import {
    $getNodeByKey,
    $getSelection,
    $isRangeSelection,
    CLICK_COMMAND,
    COMMAND_PRIORITY_LOW,
    KEY_BACKSPACE_COMMAND,
    KEY_DELETE_COMMAND,
    type NodeKey,
} from 'lexical';
import { TrashSimple } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/** Elements inside a block's own editing UI that must keep receiving clicks
 *  normally (buttons, inputs, links, contentEditable rich-text fields, …) —
 *  a click landing on any of these must NOT select or delete the block. */
const INTERACTIVE_SELECTOR =
    'button, input, textarea, select, a, [contenteditable="true"], [role="option"], [role="tab"]';

/**
 * Shared delete/selection chrome wrapped around every custom document block
 * (flashcard, quiz, image, math, …) by the block-node factory. Gives every
 * block the same two ways to remove it:
 *  - an always-discoverable hover delete button (top-right corner) — the
 *    primary, mouse-only affordance, works regardless of selection state.
 *  - click-to-select (on the chrome border, never on interactive children)
 *    + Backspace/Delete, matching how native paragraphs/images behave in
 *    other editors.
 * Selecting elsewhere in the document (text, another block) clears the
 * selection automatically via useLexicalNodeSelection.
 */
export function BlockChrome({
    nodeKey,
    readOnly,
    children,
}: {
    nodeKey: NodeKey;
    readOnly: boolean;
    children: React.ReactNode;
}) {
    const { t } = useTranslation('studyLibraryBlockChrome');
    const [editor] = useLexicalComposerContext();
    const [isSelected, setSelected, clearSelected] = useLexicalNodeSelection(nodeKey);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const deleteNode = useCallback(() => {
        editor.update(() => {
            $getNodeByKey(nodeKey)?.remove();
        });
    }, [editor, nodeKey]);

    useEffect(() => {
        if (readOnly) return undefined;
        return mergeRegister(
            editor.registerCommand<MouseEvent>(
                CLICK_COMMAND,
                (event) => {
                    const target = event.target as HTMLElement;
                    if (!wrapperRef.current?.contains(target)) return false;
                    // Never hijack clicks meant for the block's own controls.
                    if (target.closest(INTERACTIVE_SELECTOR)) return false;
                    event.preventDefault();
                    setSelected(true);
                    return true;
                },
                COMMAND_PRIORITY_LOW
            ),
            editor.registerCommand(
                KEY_DELETE_COMMAND,
                () => {
                    if (!isSelected) return false;
                    deleteNode();
                    return true;
                },
                COMMAND_PRIORITY_LOW
            ),
            editor.registerCommand(
                KEY_BACKSPACE_COMMAND,
                () => {
                    if (isSelected) {
                        deleteNode();
                        return true;
                    }
                    // Backspace with the caret collapsed at the very start of the
                    // block immediately following this one — select the block
                    // instead of doing nothing, so a second Backspace (or the
                    // delete button) removes it. Mirrors how decorator-adjacent
                    // deletion behaves in other block editors (Notion, etc.).
                    const selection = $getSelection();
                    if (
                        !$isRangeSelection(selection) ||
                        !selection.isCollapsed() ||
                        selection.anchor.offset !== 0
                    ) {
                        return false;
                    }
                    const node = $getNodeByKey(nodeKey);
                    if (!node) return false;
                    const topLevel = selection.anchor.getNode().getTopLevelElementOrThrow();
                    if (!topLevel.getPreviousSibling()?.is(node)) return false;
                    setSelected(true);
                    return true;
                },
                COMMAND_PRIORITY_LOW
            )
        );
    }, [editor, isSelected, setSelected, deleteNode, readOnly, nodeKey]);

    // Clicking anywhere outside this block's chrome (but still inside the
    // editor) is handled by useLexicalNodeSelection's own selection-change
    // subscription — isSelected flips to false automatically, no extra code
    // needed here. clearSelected is exposed for completeness / future use.
    void clearSelected;

    if (readOnly) return <>{children}</>;

    return (
        <div
            ref={wrapperRef}
            className={cn(
                'group relative rounded-md',
                isSelected && 'outline outline-2 outline-offset-2 outline-primary-400'
            )}
        >
            <div className="pointer-events-none absolute -top-3 right-1 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                    type="button"
                    aria-label={t('deleteBlock')}
                    className="pointer-events-auto rounded-md border border-neutral-200 bg-white p-1 text-neutral-500 shadow-sm hover:border-danger-300 hover:text-danger-600"
                    onClick={(e) => {
                        e.stopPropagation();
                        deleteNode();
                    }}
                >
                    <TrashSimple size={14} />
                </button>
            </div>
            {children}
        </div>
    );
}
