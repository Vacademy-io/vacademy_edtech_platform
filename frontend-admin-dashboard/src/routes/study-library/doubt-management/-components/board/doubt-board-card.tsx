import { useTranslation } from 'react-i18next';
import { ChatsCircle } from '@phosphor-icons/react';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { CategoryCell } from '../doubt-table/category-cell';
import { DoubtStatusChip } from '../doubt-status-chip';
import { getInitials, stripHtml, timeAgo } from '../inbox/utils';
import { explicitAssigneeUserIds } from './board-model';

/**
 * One Kanban card. Pure presentational — the column wraps it in the draggable and owns the
 * click. Shows the same at-a-glance facts as the inbox row (learner, category, snippet, reply
 * count, age) plus the assignee avatars so a doubt shared between two teachers is visibly
 * "also with someone else" in each of their columns.
 */
export const DoubtBoardCard = ({
    doubt,
    learnerName,
    batchName,
    assigneeNameById,
    onOpen,
}: {
    doubt: Doubt;
    learnerName?: string;
    batchName?: string;
    assigneeNameById: (userId: string) => string;
    onOpen: () => void;
}) => {
    const { t, i18n } = useTranslation('studyLibraryDoubtBoard');
    const isResolved = doubt.status === 'RESOLVED';
    // Logged-out (guest) queries have no user_id — show the contact the guest left.
    const isGuest = !doubt.user_id && !!doubt.guest_name;
    const name = isGuest ? doubt.guest_name! : learnerName ?? t('anonymous');
    const snippet = stripHtml(doubt.html_text);
    const replyCount = doubt.replies?.length ?? 0;
    const assigneeIds = explicitAssigneeUserIds(doubt);
    const shownAssignees = assigneeIds.slice(0, 3);
    const extraAssignees = assigneeIds.length - shownAssignees.length;

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
            aria-label={t('openDoubtFrom', { name })}
            className={cn(
                'group flex flex-col gap-2 rounded-lg border bg-white p-3 text-left shadow-sm transition-all hover:border-neutral-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                isResolved ? 'border-success-200' : 'border-neutral-200'
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                    <CategoryCell doubt={doubt} />
                    <DoubtStatusChip doubt={doubt} />
                </span>
                <span className="flex shrink-0 items-center gap-1 text-caption text-neutral-400">
                    {timeAgo(doubt.raised_time, t, i18n.language)}
                </span>
            </div>

            <div className="flex items-center gap-2">
                <Avatar className="size-6">
                    <AvatarFallback className="bg-primary-100 text-caption font-semibold text-primary-700">
                        {getInitials(name)}
                    </AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate text-sm font-semibold text-neutral-900">
                    {name}
                </span>
                {isGuest && (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-caption font-semibold text-neutral-500">
                        {t('guest')}
                    </span>
                )}
            </div>

            <p className="line-clamp-2 text-xs text-neutral-600">{snippet || t('noDescription')}</p>

            <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-caption text-neutral-400">
                    {isGuest ? doubt.guest_email : batchName}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                    {replyCount > 0 && (
                        <span className="flex items-center gap-1 text-caption text-neutral-400">
                            <ChatsCircle size={13} weight="duotone" />
                            {replyCount}
                        </span>
                    )}
                    {shownAssignees.length > 0 && (
                        <span className="flex items-center gap-0.5" aria-hidden>
                            {shownAssignees.map((id) => (
                                <span
                                    key={id}
                                    title={assigneeNameById(id)}
                                    className="flex size-6 items-center justify-center rounded-full bg-neutral-200 text-caption font-semibold text-neutral-700"
                                >
                                    {getInitials(assigneeNameById(id))}
                                </span>
                            ))}
                            {extraAssignees > 0 && (
                                <span className="flex size-6 items-center justify-center rounded-full bg-neutral-100 text-caption font-semibold text-neutral-500">
                                    +{extraAssignees}
                                </span>
                            )}
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
};
