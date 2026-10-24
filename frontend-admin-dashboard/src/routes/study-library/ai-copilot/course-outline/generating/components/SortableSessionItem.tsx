import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { GripVertical, Edit2, Trash2, CheckCircle, X } from 'lucide-react';
import { SessionProgress } from '../../../shared/types';
import { CircularProgress } from './CircularProgress';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface SortableSessionItemProps {
    session: SessionProgress;
    sessionIndex: number;
    onEdit: (sessionId: string, newTitle: string) => void;
    onDelete: (sessionId: string) => void;
    onRegenerate: (sessionId: string) => void;
    editingSessionId: string | null;
    editSessionTitle: string;
    onStartEdit: (sessionId: string, currentTitle: string) => void;
    onCancelEdit: () => void;
    onSaveEdit: (sessionId: string) => void;
    setEditSessionTitle: (title: string) => void;
    children: React.ReactNode;
}

export const SortableSessionItem = ({
    session,
    sessionIndex,
    onDelete,
    editingSessionId,
    editSessionTitle,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    setEditSessionTitle,
    children,
}: SortableSessionItemProps) => {
    const { t } = useTranslation('studyLibrarySortableSessionItem');
    const isEditing = editingSessionId === session.sessionId;
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: session.sessionId,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const handleSaveEdit = () => {
        if (editSessionTitle.trim()) {
            onSaveEdit(session.sessionId);
        }
    };

    const completedCount = session.slides.filter((s) => s.status === 'completed').length;

    return (
        <div ref={setNodeRef} style={style}>
            <AccordionItem
                value={session.sessionId}
                className="border-b border-neutral-200 last:border-b-0"
            >
                <AccordionTrigger className="group py-3 text-left hover:no-underline sm:py-4 [&>svg]:hidden">
                    <div className="flex w-full items-center justify-between gap-2 pr-2 sm:pr-4">
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                            <button
                                {...attributes}
                                {...listeners}
                                className="shrink-0 cursor-grab text-neutral-400 transition-opacity hover:text-neutral-600 active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <GripVertical className="size-4" />
                            </button>
                            {isEditing ? (
                                <Input
                                    value={editSessionTitle}
                                    onChange={(e) => setEditSessionTitle(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveEdit();
                                        if (e.key === 'Escape') onCancelEdit();
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-7 flex-1 text-sm"
                                    autoFocus
                                />
                            ) : (
                                <h3 className="truncate text-sm font-semibold text-neutral-900 sm:text-base">
                                    <span className="hidden sm:inline">
                                        {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} {sessionIndex + 1}:{' '}
                                    </span>
                                    <span className="sm:hidden">{getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).slice(0, 2)} {sessionIndex + 1}: </span>
                                    {session.sessionTitle}
                                </h3>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                            {!isEditing && (
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onStartEdit(session.sessionId, session.sessionTitle);
                                        }}
                                        className="rounded p-1 text-xs text-indigo-600 transition-opacity hover:bg-indigo-50 md:opacity-0 md:group-hover:opacity-100"
                                        title={t('edit')}
                                    >
                                        <Edit2 className="size-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(session.sessionId);
                                        }}
                                        className="rounded p-1 text-xs text-red-600 transition-opacity hover:bg-red-50 md:opacity-0 md:group-hover:opacity-100"
                                        title={t('delete')}
                                    >
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </div>
                            )}
                            {isEditing && (
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSaveEdit();
                                        }}
                                        className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                        title={t('save')}
                                    >
                                        <CheckCircle className="size-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onCancelEdit();
                                        }}
                                        className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                                        title={t('cancel')}
                                    >
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            )}
                            <div className="text-xs text-neutral-500">
                                {t('pagesCount', {
                                    completed: completedCount,
                                    count: session.slides.length,
                                })}
                            </div>
                            {session.progress < 100 && (
                                <CircularProgress
                                    value={session.progress}
                                    size={32}
                                    strokeWidth={3}
                                />
                            )}
                            {session.progress === 100 && (
                                <CheckCircle className="size-6 text-green-600" />
                            )}
                        </div>
                    </div>
                </AccordionTrigger>
                {children}
            </AccordionItem>
        </div>
    );
};
