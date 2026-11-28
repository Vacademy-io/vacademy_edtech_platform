import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChatsCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { CategoryCell } from '../doubt-table/category-cell';
import { DoubtStatusChip } from '../doubt-status-chip';
import { getInitials, stripHtml, timeAgo } from './utils';

/** One row in the inbox list: status dot, learner, snippet, category, reply count, time. */
export const InboxListItem = ({
    doubt,
    selected,
    onSelect,
    learnerName,
}: {
    doubt: Doubt;
    selected: boolean;
    onSelect: () => void;
    learnerName?: string;
}) => {
    const { t, i18n } = useTranslation('studyLibraryInboxListItem');
    const isResolved = doubt.status === 'RESOLVED';
    const snippet = stripHtml(doubt.html_text);
    const replyCount = doubt.replies?.length ?? 0;
    // Logged-out (guest) queries have no user_id — show the contact the guest left.
    const isGuest = !doubt.user_id && !!doubt.guest_name;
    const name = isGuest ? doubt.guest_name! : learnerName ?? t('anonymous');

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={selected}
            className={cn(
                'flex w-full flex-col gap-1.5 border-b border-neutral-100 px-3 py-3 text-left transition-colors',
                selected ? 'bg-primary-50' : 'bg-white hover:bg-neutral-50'
            )}
        >
            <div className="flex items-center gap-2">
                <span
                    aria-hidden
                    title={isResolved ? t('resolved') : t('unresolved')}
                    className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        isResolved ? 'bg-success-500' : 'bg-warning-500'
                    )}
                />
                <Avatar className="size-7">
                    <AvatarFallback className="bg-primary-100 text-caption font-semibold text-primary-700">
                        {getInitials(name)}
                    </AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-neutral-800">{name}</span>
                    {isGuest && (
                        <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-caption font-semibold text-neutral-500">
                            {t('guest')}
                        </span>
                    )}
                </span>
                <span className="shrink-0 text-caption text-neutral-400">
                    {timeAgo(doubt.raised_time, t, i18n.language)}
                </span>
            </div>
            {isGuest && doubt.guest_email && (
                <p className="truncate pl-1 text-caption text-neutral-400">{doubt.guest_email}</p>
            )}
            <p className="line-clamp-2 pl-1 text-xs text-neutral-600">
                {snippet || t('noDescription')}
            </p>
            <div className="flex flex-wrap items-center gap-2 pl-1">
                <CategoryCell doubt={doubt} />
                <DoubtStatusChip doubt={doubt} />
                {replyCount > 0 && (
                    <span className="flex items-center gap-1 text-caption text-neutral-400">
                        <ChatsCircle size={13} weight="duotone" />
                        {replyCount}
                    </span>
                )}
            </div>
        </button>
    );
};
