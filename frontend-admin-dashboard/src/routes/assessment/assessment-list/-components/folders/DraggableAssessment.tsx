import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { DRAG_TYPE_ASSESSMENT, useAssessmentFolderUi } from './assessment-folder-context';

/**
 * Makes an assessment card draggable onto a folder in the rail. The card stays in
 * place (a small DragOverlay follows the pointer), and a click that ends a drag is
 * swallowed so dropping does not also open the assessment.
 */
export const DraggableAssessment = ({
    assessmentId,
    name,
    folderId,
    children,
}: {
    assessmentId: string;
    name: string;
    folderId: string | null;
    children: React.ReactNode;
}) => {
    const { isClickSuppressed } = useAssessmentFolderUi();
    const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
        id: `assessment:${assessmentId}`,
        data: { type: DRAG_TYPE_ASSESSMENT, assessmentId, name, folderId },
    });
    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            // The card itself is the button; dnd-kit's role would announce it twice.
            role={undefined}
            tabIndex={undefined}
            onClickCapture={(e) => {
                if (isClickSuppressed()) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            }}
            className={cn('touch-pan-y', isDragging && 'opacity-50')}
        >
            {children}
        </div>
    );
};
