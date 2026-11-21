import { useState } from 'react';
import { CaretDown, CaretUp, ChatsCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useMyQueries } from '@/services/my-queries';
import { useDoubtManagementSetting } from '@/services/doubt-management-settings';
import { Reply } from '@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/doubt-resolution-sidebar/components/reply';
import {
    collectAuthorIds,
    useDoubtAuthors,
    type DoubtAuthorMap,
} from '@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/doubt-resolution-sidebar/hooks/useDoubtAuthors';
import { Doubt } from '@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/doubt-resolution-sidebar/types/get-doubts-type';

const stripHtml = (html?: string): string => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

const formatWhen = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
};

const QueryItem = ({
    doubt,
    typeLabel,
    authors,
}: {
    doubt: Doubt;
    typeLabel: string;
    authors: DoubtAuthorMap;
}) => {
    const [expanded, setExpanded] = useState(false);
    const isResolved = doubt.status === 'RESOLVED';
    const replyCount = doubt.replies?.length ?? 0;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full flex-col gap-1.5 p-3 text-start"
            >
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'rounded-full px-2 py-0.5 text-caption font-semibold',
                            isResolved
                                ? 'bg-success-50 text-success-700'
                                : 'bg-warning-50 text-warning-700'
                        )}
                    >
                        {isResolved ? 'Resolved' : 'Pending'}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-medium text-neutral-600">
                        {typeLabel}
                    </span>
                    <span className="ms-auto shrink-0 text-caption text-neutral-400">
                        {formatWhen(doubt.raised_time)}
                    </span>
                </div>
                <p className={cn('text-sm text-neutral-800', !expanded && 'line-clamp-2')}>
                    {stripHtml(doubt.html_text) || 'No description'}
                </p>
                <span className="flex items-center gap-1 text-caption text-neutral-500">
                    <ChatsCircle size={13} weight="duotone" />
                    {replyCount > 0
                        ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
                        : 'No replies yet'}
                    {replyCount > 0 &&
                        (expanded ? <CaretUp size={12} /> : <CaretDown size={12} />)}
                </span>
            </button>
            {expanded && replyCount > 0 && (
                <div className="flex flex-col gap-2 border-t border-neutral-100 bg-neutral-50 p-3">
                    {doubt.replies.map((reply) => (
                        <Reply
                            key={reply.id}
                            reply={reply}
                            raiserUserId={doubt.user_id}
                            authors={authors}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * The learner's recent doubts + queries with their reply threads, shown inside the "?" dialog.
 * Degrades silently: loading → skeletons, error → one muted line, empty → friendly message. Never
 * throws — the Raise tab must always stay usable.
 */
export const MyQueriesList = () => {
    const { queries, isLoading, isError } = useMyQueries();
    const { selectableTypes } = useDoubtManagementSetting();
    // Names + avatars for everyone in these threads, in one round trip — replies are answered by
    // staff whose names the doubt payload does not always carry.
    const authors = useDoubtAuthors(collectAuthorIds(queries));

    const typeLabel = (doubt: Doubt): string => {
        if (doubt.source === 'SLIDE') return 'Doubt';
        const key = (doubt.type ?? 'DOUBT').toUpperCase();
        const match = selectableTypes.find((t) => t.key?.toUpperCase() === key);
        if (match) return match.label;
        return key === 'DOUBT' ? 'Doubt' : key.charAt(0) + key.slice(1).toLowerCase();
    };

    if (isLoading) {
        return (
            <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-20 animate-pulse rounded-lg bg-neutral-100" />
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <p className="py-6 text-center text-xs text-neutral-400">
                Couldn’t load your queries right now. Please try again later.
            </p>
        );
    }

    if (queries.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ChatsCircle size={28} weight="duotone" className="text-neutral-300" />
                <p className="text-sm font-medium text-neutral-600">No queries yet</p>
                <p className="text-xs text-neutral-400">
                    Your doubts and queries — and the replies — will show up here.
                </p>
            </div>
        );
    }

    return (
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pe-1">
            {queries.map((q) => (
                <QueryItem key={q.id} doubt={q} typeLabel={typeLabel(q)} authors={authors} />
            ))}
        </div>
    );
};
