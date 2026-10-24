import { useTranslation } from 'react-i18next';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CaretLeft } from '@phosphor-icons/react';
import { isUserAdmin, isUserTeacher, getUserId } from '@/utils/userDetails';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { convertCapitalToTitleCase } from '@/lib/utils';
import { formatISODateTimeReadable } from '@/helpers/formatISOTime';
import { DeleteDoubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/doubt-resolution/DeleteDoubt';
import { AddReply } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/doubt-resolution/AddReply';
import { Reply } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/doubt-resolution/reply';
import { AssigneeCell } from '../doubt-table/assignee-cell';
import { CategoryCell } from '../doubt-table/category-cell';
import { TimestampCell } from '../doubt-table/doubt-cell';
import { NavigateCell } from '../doubt-table/navigate-cell';
import { DoubtStatusPicker } from '../status/doubt-status-picker';
import { DoubtActivityTimeline } from '../activity/doubt-activity-timeline';
import { getInitials } from './utils';

/**
 * Right pane: header (status picker / assign / delete / view-source) + activity trail +
 * conversation thread + reply composer. The status picker lists the institute's configurable
 * statuses and records a remark on the change; the activity section shows who assigned / moved
 * what (and whether a rule did it) — both staff-only.
 */
export const ConversationPane = ({
    doubt,
    refetch,
    learnerName,
    onBack,
    activityDefaultOpen = false,
}: {
    doubt: Doubt;
    refetch: () => void;
    learnerName?: string;
    onBack: () => void;
    /** Open with the activity trail expanded (board toast → "Add remark"). */
    activityDefaultOpen?: boolean;
}) => {
    const { t } = useTranslation('studyLibraryConversationPane');
    const isAdmin = isUserAdmin();
    const isTeacher = isUserTeacher();
    const userId = getUserId();
    const { instituteDetails } = useInstituteDetailsStore();
    // Logged-out (guest) queries have no user_id — show the contact the guest left.
    const isGuest = !doubt.user_id && !!doubt.guest_name;
    const name = isGuest ? doubt.guest_name! : learnerName ?? t('anonymous');

    const batch = instituteDetails?.batches_for_sessions?.find((b) => b.id === doubt.batch_id);
    const batchName = batch
        ? `${convertCapitalToTitleCase(batch.level.level_name)} ${convertCapitalToTitleCase(
              batch.package_dto.package_name
          )} ${convertCapitalToTitleCase(batch.session.session_name)}`
        : '';

    const isSlide = doubt.source === 'SLIDE' && !!doubt.source_id;
    const isAssignedUser =
        !!userId &&
        !!doubt.all_doubt_assignee?.some((a) => a.source === 'USER' && a.source_id === userId);
    const isPendingAssignee = !!userId && !!doubt.doubt_assignee_request_user_ids?.includes(userId);
    const canReply = isAdmin || isTeacher || isAssignedUser || isPendingAssignee;

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
                <button
                    type="button"
                    onClick={onBack}
                    aria-label={t('backToList')}
                    className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 sm:hidden"
                >
                    <CaretLeft size={18} />
                </button>
                <Avatar className="size-9">
                    <AvatarFallback className="bg-primary-100 text-sm font-semibold text-primary-700">
                        {getInitials(name)}
                    </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-neutral-800">
                            {name}
                        </span>
                        {isGuest && (
                            <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-caption font-semibold text-neutral-500">
                                {t('guest')}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500">
                        <CategoryCell doubt={doubt} />
                        {isGuest && doubt.guest_email ? (
                            <span className="truncate">{doubt.guest_email}</span>
                        ) : (
                            batchName && <span className="truncate">{batchName}</span>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {isSlide && <NavigateCell doubt={doubt} />}
                    {/* Every admin-app viewer could flip Resolved before; the picker keeps that
                        reach (remarks/custom statuses are still staff-gated server-side). */}
                    <DoubtStatusPicker doubt={doubt} refetch={refetch} canChange />
                    {isAdmin && <DeleteDoubt doubt={doubt} refetch={refetch} showText={false} />}
                </div>
            </div>

            {/* Assignee */}
            {isAdmin && (
                <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2">
                    <span className="shrink-0 text-xs font-medium text-neutral-500">
                        {t('assigned')}
                    </span>
                    <AssigneeCell doubt={doubt} />
                </div>
            )}

            {/* Who did what — assignments (manual / by rule), status changes, remarks */}
            {canReply && (
                <DoubtActivityTimeline
                    key={`${doubt.id}-${activityDefaultOpen}`}
                    doubt={doubt}
                    canRemark={canReply}
                    defaultOpen={activityDefaultOpen}
                />
            )}

            {/* Conversation thread */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-neutral-700">
                            {t('nameAsked', { name })}
                        </span>
                        <span className="shrink-0 text-caption text-neutral-400">
                            {formatISODateTimeReadable(doubt.raised_time)}
                        </span>
                    </div>
                    <div
                        className="custom-html-content text-sm text-neutral-800"
                        dangerouslySetInnerHTML={{ __html: doubt.html_text || '' }}
                    />
                    {isSlide && (
                        <div className="mt-2">
                            <TimestampCell doubt={doubt} />
                        </div>
                    )}
                </div>

                {(doubt.replies ?? []).map((r) => (
                    <Reply key={r.id} reply={r} refetch={refetch} />
                ))}
            </div>

            {/* Composer */}
            <div className="border-t border-neutral-200 p-3">
                {canReply ? (
                    <AddReply parent={doubt} refetch={refetch} />
                ) : (
                    <p className="px-1 text-center text-xs text-neutral-400">
                        {t('noPermissionToReply')}
                    </p>
                )}
            </div>
        </div>
    );
};
