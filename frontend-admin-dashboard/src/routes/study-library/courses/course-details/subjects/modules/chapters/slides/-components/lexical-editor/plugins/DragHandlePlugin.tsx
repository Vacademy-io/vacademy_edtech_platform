import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin';
import { DotsSixVertical } from '@phosphor-icons/react';

/** Class the plugin's `isOnMenu` predicate keys on to recognise handle
 *  interactions (so a mousedown on the grip starts a drag rather than a
 *  caret placement / block select). */
const DRAG_HANDLE_CLASS = 'lex-drag-handle';

function isOnHandle(element: HTMLElement): boolean {
    return !!element.closest(`.${DRAG_HANDLE_CLASS}`);
}

/**
 * Notion-style reordering of top-level blocks. On hover, a grip handle appears
 * in the left gutter of the block under the cursor; dragging it shows a drop
 * line and moves the whole block (paragraph, heading, list, table, or any
 * custom block) to the new position. Reordering mutates the editor state, so
 * autosave + serialization pick it up with no extra wiring.
 *
 * The handle and drop line are portaled into `anchorElem` (the positioned
 * wrapper around the ContentEditable); hover detection runs on the anchor's
 * parent (`.lexical-doc-editor`). Only mounted for the editable (admin) view.
 */
export function DragHandlePlugin({ anchorElem }: { anchorElem: HTMLElement }) {
    const menuRef = useRef<HTMLDivElement>(null);
    const targetLineRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation('studyLibraryDragHandlePlugin');

    return (
        <DraggableBlockPlugin_EXPERIMENTAL
            anchorElem={anchorElem}
            menuRef={menuRef}
            targetLineRef={targetLineRef}
            menuComponent={
                <div
                    ref={menuRef}
                    className={`${DRAG_HANDLE_CLASS} lex-drag-handle-floating`}
                    role="button"
                    aria-label={t('dragToReorderBlock')}
                    title={t('dragToReorder')}
                >
                    <DotsSixVertical size={16} weight="bold" />
                </div>
            }
            targetLineComponent={<div ref={targetLineRef} className="lex-drag-target-line" />}
            isOnMenu={isOnHandle}
        />
    );
}
