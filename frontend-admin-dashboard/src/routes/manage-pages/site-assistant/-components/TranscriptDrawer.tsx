import { useQuery } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp, Question } from '@phosphor-icons/react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
    SITE_ASSISTANT_QUERY_KEY,
    fetchConversation,
    type TranscriptMessage,
} from '../-services/site-assistant-service';
import { CardsView } from './CardsView';
import { LeadBadge } from './LeadBadge';
import { ErrorState } from './TabStates';

const Bubble = ({ message }: { message: TranscriptMessage }) => {
    const mine = message.role === 'user';
    return (
        <div className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
            {message.content && (
                <div
                    className={cn(
                        'max-w-full whitespace-pre-line rounded-lg px-3 py-2 text-body sm:max-w-md',
                        mine ? 'bg-primary-50 text-neutral-800' : 'bg-neutral-100 text-neutral-800'
                    )}
                >
                    {message.content}
                </div>
            )}
            {message.cards.length > 0 && (
                <div className="w-full sm:max-w-md">
                    <CardsView cards={message.cards} />
                </div>
            )}
            <div className="flex items-center gap-2 text-caption text-neutral-400">
                {message.createdAt && <span>{formatDateTime(message.createdAt)}</span>}
                {message.answered === false && (
                    <span className="flex items-center gap-1 text-warning-600">
                        <Question className="size-3.5" /> Not answered
                    </span>
                )}
                {message.feedback === 1 && (
                    <ThumbsUp className="size-3.5 text-success-600" aria-label="Thumbs up" />
                )}
                {message.feedback === -1 && (
                    <ThumbsDown className="size-3.5 text-danger-600" aria-label="Thumbs down" />
                )}
            </div>
        </div>
    );
};

/** One conversation, read-only: what the visitor asked and what they were shown. */
export const TranscriptDrawer = ({
    conversationId,
    onClose,
}: {
    conversationId: string | null;
    onClose: () => void;
}) => {
    const query = useQuery({
        queryKey: [SITE_ASSISTANT_QUERY_KEY, 'conversation', conversationId],
        queryFn: () => fetchConversation(conversationId!),
        enabled: !!conversationId,
    });
    const convo = query.data;
    // Tool rows are the assistant's own lookups; the admin sees what the visitor saw.
    const messages = (convo?.messages ?? []).filter((m) => m.role !== 'tool');

    return (
        <Sheet open={!!conversationId} onOpenChange={(o) => !o && onClose()}>
            <SheetContent
                side="right"
                className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg"
            >
                <SheetHeader>
                    <SheetTitle>Conversation</SheetTitle>
                    <SheetDescription>
                        {convo
                            ? [
                                  convo.startedAt ? formatDateTime(convo.startedAt) : null,
                                  convo.startedPage ? `started on ${convo.startedPage}` : null,
                              ]
                                  .filter(Boolean)
                                  .join(' · ')
                            : 'Loading…'}
                    </SheetDescription>
                    {convo?.leadStatus && (
                        <div>
                            <LeadBadge lead={convo.leadStatus} />
                        </div>
                    )}
                </SheetHeader>
                {query.isLoading && (
                    <div className="flex flex-col gap-3">
                        <Skeleton className="ml-auto h-10 w-2/3" />
                        <Skeleton className="h-16 w-3/4" />
                        <Skeleton className="ml-auto h-10 w-1/2" />
                    </div>
                )}
                {query.isError && (
                    <ErrorState
                        message="Could not load this conversation."
                        onRetry={() => void query.refetch()}
                    />
                )}
                {query.isSuccess && messages.length === 0 && (
                    <p className="text-body text-neutral-500">No messages in this conversation.</p>
                )}
                {query.isSuccess && (
                    <div className="flex flex-col gap-4">
                        {messages.map((m) => (
                            <Bubble key={m.id} message={m} />
                        ))}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
};
