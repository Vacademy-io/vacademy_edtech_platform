import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Megaphone, PencilSimple, Plus, Question, Trash } from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { formatDate } from '@/lib/formatters';
import {
    SITE_ASSISTANT_QUERY_KEY,
    deleteKnowledge,
    fetchKnowledge,
    knowledgeToInput,
    type KnowledgeItem,
    type KnowledgeKind,
} from '../-services/site-assistant-service';
import { KnowledgeDialog, emptyKnowledgeInput } from './KnowledgeDialog';
import { ErrorState } from './TabStates';

interface DialogState {
    key: number;
    kind: KnowledgeKind;
    editing: KnowledgeItem | null;
}

const lifecycle = (item: KnowledgeItem, now: number) => {
    if (!item.active) return { text: 'Off', status: 'INFO' as const };
    if (item.endsAt && new Date(item.endsAt).getTime() < now)
        return { text: 'Ended', status: 'INFO' as const };
    if (item.startsAt && new Date(item.startsAt).getTime() > now)
        return { text: 'Scheduled', status: 'WARNING' as const };
    return { text: 'In use', status: 'SUCCESS' as const };
};

const KnowledgeRow = ({
    item,
    onEdit,
    onDelete,
}: {
    item: KnowledgeItem;
    onEdit: () => void;
    onDelete: () => void;
}) => {
    const state = lifecycle(item, Date.now());
    return (
        <li className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1 space-y-1">
                <p className="text-subtitle font-medium text-neutral-800">{item.title}</p>
                <p className="line-clamp-3 whitespace-pre-line text-body text-neutral-600">
                    {item.body}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <StatusChip text={state.text} status={state.status} textSize="text-caption" />
                    <Badge variant="outline" className="text-caption">
                        {item.siteTag === null ? 'All sites' : 'This site'}
                    </Badge>
                    {(item.startsAt || item.endsAt) && (
                        <span className="text-caption text-neutral-500">
                            {item.startsAt ? `From ${formatDate(item.startsAt)}` : ''}
                            {item.startsAt && item.endsAt ? ' · ' : ''}
                            {item.endsAt ? `Until ${formatDate(item.endsAt)}` : ''}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex shrink-0 gap-1">
                <MyButton
                    buttonType="text"
                    layoutVariant="icon"
                    scale="medium"
                    aria-label={`Edit “${item.title}”`}
                    onClick={onEdit}
                >
                    <PencilSimple className="size-4" />
                </MyButton>
                <MyButton
                    buttonType="text"
                    layoutVariant="icon"
                    scale="medium"
                    aria-label={`Delete “${item.title}”`}
                    onClick={onDelete}
                >
                    <Trash className="size-4 text-danger-600" />
                </MyButton>
            </div>
        </li>
    );
};

const Section = ({
    kind,
    items,
    onAdd,
    onEdit,
    onDelete,
}: {
    kind: KnowledgeKind;
    items: KnowledgeItem[];
    onAdd: () => void;
    onEdit: (item: KnowledgeItem) => void;
    onDelete: (item: KnowledgeItem) => void;
}) => {
    const isFaq = kind === 'FAQ';
    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-800">
                        {isFaq ? <Question className="size-5" /> : <Megaphone className="size-5" />}
                        {isFaq ? 'FAQs' : 'Notices'}
                    </h3>
                    <p className="text-caption text-neutral-500">
                        {isFaq
                            ? 'Questions visitors often ask, with your answers. The assistant answers from these first.'
                            : 'Short news the assistant mentions when it fits: a new batch, a holiday, an event. Give each an end date.'}
                    </p>
                </div>
                <MyButton buttonType="secondary" scale="medium" onClick={onAdd}>
                    <Plus className="size-4" />
                    {isFaq ? 'Add FAQ' : 'Add notice'}
                </MyButton>
            </div>
            {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-body text-neutral-500">
                    {isFaq
                        ? 'No FAQs yet. Add the questions your team answers most often, or pick them from the Unanswered tab.'
                        : 'No notices yet.'}
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {items.map((item) => (
                        <KnowledgeRow
                            key={item.id}
                            item={item}
                            onEdit={() => onEdit(item)}
                            onDelete={() => onDelete(item)}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
};

export const KnowledgeTab = ({ siteTag, siteLabel }: { siteTag: string; siteLabel: string }) => {
    const queryClient = useQueryClient();
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const [deleting, setDeleting] = useState<KnowledgeItem | null>(null);

    const query = useQuery({
        queryKey: [SITE_ASSISTANT_QUERY_KEY, 'knowledge', siteTag],
        queryFn: () => fetchKnowledge(siteTag),
        enabled: !!siteTag,
        staleTime: 30_000,
    });

    const remove = useMutation({
        mutationFn: (id: string) => deleteKnowledge(id),
        onSuccess: () => {
            toast.success('Deleted.');
            setDeleting(null);
            void queryClient.invalidateQueries({ queryKey: [SITE_ASSISTANT_QUERY_KEY] });
        },
        onError: () => toast.error('Could not delete. Try again.'),
    });

    const open = (kind: KnowledgeKind, editing: KnowledgeItem | null = null) =>
        setDialog({ key: Date.now(), kind, editing });

    if (query.isLoading) {
        return (
            <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
            </div>
        );
    }
    if (query.isError) {
        return (
            <ErrorState
                message="Could not load your FAQs and notices."
                onRetry={() => void query.refetch()}
            />
        );
    }

    const items = query.data ?? [];
    return (
        <div className="flex flex-col gap-8">
            <Section
                kind="FAQ"
                items={items.filter((i) => i.kind === 'FAQ')}
                onAdd={() => open('FAQ')}
                onEdit={(item) => open('FAQ', item)}
                onDelete={setDeleting}
            />
            <Section
                kind="NOTICE"
                items={items.filter((i) => i.kind === 'NOTICE')}
                onAdd={() => open('NOTICE')}
                onEdit={(item) => open('NOTICE', item)}
                onDelete={setDeleting}
            />

            {dialog && (
                <KnowledgeDialog
                    key={dialog.key}
                    open
                    onOpenChange={(o) => !o && setDialog(null)}
                    siteTag={siteTag}
                    siteLabel={siteLabel}
                    editing={dialog.editing}
                    initial={
                        dialog.editing
                            ? knowledgeToInput(dialog.editing)
                            : emptyKnowledgeInput(dialog.kind)
                    }
                />
            )}

            <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete this {deleting?.kind === 'NOTICE' ? 'notice' : 'FAQ'}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            &ldquo;{deleting?.title}&rdquo; will no longer be used by the assistant
                            {deleting?.siteTag === null ? ' on any of your sites' : ''}. To keep it
                            for later, edit it and switch it off instead.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={(e) => {
                                e.preventDefault();
                                if (deleting) remove.mutate(deleting.id);
                            }}
                            disabled={remove.isPending}
                        >
                            {remove.isPending ? 'Deleting…' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
