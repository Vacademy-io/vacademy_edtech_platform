/**
 * One post in the calendar: date block, title + who wrote it, target networks and the
 * status. Expanding it shows the copy, media, per-network results and the actions the
 * caller is allowed to take.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowSquareOut,
    ArrowsClockwise,
    CaretDown,
    CheckCircle,
    PaperPlaneTilt,
    PencilSimple,
    Prohibit,
    Robot,
    Trash,
    VideoCamera,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusPill } from '@/components/shared/crm-enhance/screen-header';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PlatformIcon, platformLabel } from '../../-marketing/platform-meta';
import {
    useApproveSocialPost,
    useCancelSocialPost,
    useDeleteSocialPost,
    usePostSocialPostNow,
    useRetrySocialPost,
} from '../../-marketing/use-marketing';
import type { SocialPlatform, SocialPost } from '../../-marketing/types';
import { EDITABLE, postDate, postError, STATUS_TONE } from './social-utils';

type ConfirmKind = 'postNow' | 'cancel' | 'delete' | null;

const TARGET_TONE = {
    PENDING: 'neutral',
    PUBLISHING: 'primary',
    POSTED: 'success',
    FAILED: 'danger',
    SKIPPED: 'neutral',
} as const;

export function PostRow({
    post,
    isAdmin,
    currentUserId,
    expanded,
    onToggle,
    onEdit,
}: {
    post: SocialPost;
    isAdmin: boolean;
    currentUserId: string;
    expanded: boolean;
    onToggle: () => void;
    onEdit: (post: SocialPost) => void;
}) {
    const { t, i18n } = useTranslation('marketingSocial');
    const [confirm, setConfirm] = useState<ConfirmKind>(null);
    const approve = useApproveSocialPost();
    const postNow = usePostSocialPostNow();
    const cancel = useCancelSocialPost();
    const retry = useRetrySocialPost();
    const remove = useDeleteSocialPost();

    const date = postDate(post);
    const locale = i18n.language;
    const parts = useMemo(
        () => ({
            weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
            day: new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date),
            month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date),
            time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
                date
            ),
        }),
        // date is derived from these two fields
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [locale, post.scheduled_at, post.created_at]
    );

    const isOwn = !!post.created_by_user_id && post.created_by_user_id === currentUserId;
    const platforms = useMemo(
        () => Array.from(new Set(post.targets.map((target) => target.platform))),
        [post.targets]
    );
    const tailored = (Object.entries(post.overrides ?? {}) as [SocialPlatform, string][]).filter(
        ([, text]) => !!text?.trim()
    );
    const error = postError(post);
    const posted = post.targets.filter((target) => target.permalink);
    const busy =
        approve.isPending ||
        postNow.isPending ||
        cancel.isPending ||
        retry.isPending ||
        remove.isPending;

    const status = post.status;
    const canPostNow = isAdmin && ['DRAFT', 'NEEDS_APPROVAL', 'SCHEDULED'].includes(status);
    const canApprove = isAdmin && status === 'NEEDS_APPROVAL';
    // Staff may edit a scheduled post too; the server sends it back for approval.
    const canEdit = EDITABLE.has(status);
    const canRetry = isAdmin && (status === 'FAILED' || status === 'PARTIAL');
    const canCancel =
        ['DRAFT', 'NEEDS_APPROVAL', 'SCHEDULED'].includes(status) &&
        (isAdmin || (isOwn && (status === 'DRAFT' || status === 'NEEDS_APPROVAL')));
    const canDelete = status !== 'PUBLISHING' && (isAdmin || isOwn);

    const subline =
        post.source === 'AGENT'
            ? t('calendar.byAgent')
            : isOwn
              ? t('calendar.byYou')
              : t('calendar.byTeam');

    const statusPill = <StatusPill tone={STATUS_TONE[status]}>{t(`status.${status}`)}</StatusPill>;

    const detailsId = `post-details-${post.id}`;

    return (
        <li
            className={cn(
                'rounded-lg border bg-white transition-colors',
                expanded ? 'border-primary-200' : 'border-neutral-200 hover:border-neutral-300',
                status === 'CANCELLED' && 'opacity-70'
            )}
        >
            <div className="flex items-stretch gap-2 p-2 sm:gap-3 sm:p-3">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                    <span className="flex w-14 shrink-0 flex-col items-center rounded-md bg-neutral-50 px-1 py-1.5 text-center">
                        <span className="text-caption uppercase text-neutral-500">
                            {parts.weekday}
                        </span>
                        <span className="text-h3 font-semibold leading-none text-neutral-900">
                            {parts.day}
                        </span>
                        <span className="text-caption text-neutral-500">{parts.month}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-body font-medium text-neutral-900">
                            {post.title?.trim() || post.body?.trim() || t('calendar.untitled')}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-neutral-500">
                            <span className="tabular-nums">
                                {post.scheduled_at ? parts.time : t('calendar.notScheduled')}
                            </span>
                            <span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1">
                                {post.source === 'AGENT' && (
                                    <Robot size={12} className="text-primary-500" aria-hidden />
                                )}
                                {subline}
                            </span>
                        </span>
                        {platforms.length > 0 && (
                            <span className="flex flex-wrap gap-1 pt-0.5">
                                {platforms.map((platform) => (
                                    <PlatformIcon
                                        key={platform}
                                        platform={platform}
                                        size="sm"
                                        title={platformLabel(platform, t, 'social')}
                                    />
                                ))}
                            </span>
                        )}
                    </span>
                    <CaretDown
                        size={16}
                        className={cn(
                            'hidden shrink-0 text-neutral-400 transition-transform sm:block',
                            expanded && 'rotate-180'
                        )}
                        aria-hidden
                    />
                </button>
                <div className="flex shrink-0 flex-col items-end justify-center gap-1">
                    {(status === 'FAILED' || status === 'PARTIAL') && error ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-300"
                                    aria-label={`${t(`status.${status}`)}: ${error}`}
                                >
                                    {statusPill}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs bg-neutral-800 text-white">
                                <span className="text-caption">{error}</span>
                            </TooltipContent>
                        </Tooltip>
                    ) : (
                        statusPill
                    )}
                    {(status === 'POSTED' || status === 'PARTIAL') && posted.length > 0 && (
                        <span className="flex flex-wrap justify-end gap-x-2">
                            {posted.map((target) => (
                                <a
                                    key={target.id}
                                    href={target.permalink ?? undefined}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 rounded text-caption font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                    aria-label={t('calendar.viewOn', {
                                        name: platformLabel(target.platform, t, 'social'),
                                    })}
                                >
                                    {posted.length > 1
                                        ? platformLabel(target.platform, t, 'social')
                                        : t('calendar.view')}
                                    <ArrowSquareOut size={12} aria-hidden />
                                </a>
                            ))}
                        </span>
                    )}
                </div>
            </div>

            {expanded && (
                <div
                    id={detailsId}
                    className="flex flex-col gap-4 border-t border-neutral-100 px-3 pb-4 pt-3 sm:px-4"
                >
                    {post.body?.trim() && (
                        <blockquote className="whitespace-pre-line border-l-2 border-primary-200 ps-3 text-body text-neutral-700">
                            “{post.body.trim()}”
                        </blockquote>
                    )}

                    {tailored.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-caption font-medium text-neutral-600">
                                {t('calendar.tailored')}
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {tailored.map(([platform, text]) => (
                                    <div
                                        key={platform}
                                        className="flex flex-col gap-1 rounded-md bg-neutral-50 p-2"
                                    >
                                        <span className="flex items-center gap-1.5 text-caption font-medium text-neutral-700">
                                            <PlatformIcon platform={platform} size="sm" />
                                            {platformLabel(platform, t, 'social')}
                                        </span>
                                        <p className="line-clamp-4 whitespace-pre-line text-caption text-neutral-600">
                                            {text}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {post.media.length > 0 && (
                        <ul className="flex flex-wrap gap-2" aria-label={t('calendar.media')}>
                            {post.media.map((media) => (
                                <li
                                    key={media.file_id}
                                    className="flex size-20 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50"
                                >
                                    {media.type === 'IMAGE' && media.url ? (
                                        <img
                                            src={media.url}
                                            alt={media.name ?? ''}
                                            className="size-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : media.type === 'VIDEO' && media.url ? (
                                        <video
                                            src={media.url}
                                            className="size-full object-cover"
                                            preload="metadata"
                                            muted
                                            aria-label={media.name ?? t('composer.media.video')}
                                        />
                                    ) : (
                                        <VideoCamera
                                            size={20}
                                            className="text-neutral-400"
                                            aria-hidden
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {post.link_url && (
                        <a
                            href={post.link_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-fit max-w-full items-center gap-1 truncate rounded text-caption text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        >
                            <ArrowSquareOut size={12} aria-hidden />
                            <span className="truncate">{post.link_url}</span>
                        </a>
                    )}

                    {post.targets.length > 0 && (
                        <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-100">
                            {post.targets.map((target) => (
                                <li
                                    key={target.id}
                                    className="flex flex-wrap items-center gap-2 px-3 py-2"
                                >
                                    <PlatformIcon platform={target.platform} size="sm" />
                                    <span className="min-w-0 flex-1 truncate text-caption text-neutral-700">
                                        {target.account_name ??
                                            platformLabel(target.platform, t, 'social')}
                                    </span>
                                    {target.permalink && (
                                        <a
                                            href={target.permalink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 rounded text-caption font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                        >
                                            {t('calendar.view')}
                                            <ArrowSquareOut size={12} aria-hidden />
                                        </a>
                                    )}
                                    <StatusPill tone={TARGET_TONE[target.status] ?? 'neutral'}>
                                        {t(`targetStatus.${target.status}`)}
                                    </StatusPill>
                                    {target.error_message && (
                                        <p className="w-full text-caption text-danger-600">
                                            {target.error_message}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {status === 'PUBLISHING' && (
                        <p className="text-caption text-neutral-500">
                            {t('calendar.publishingHint')}
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        {canPostNow && (
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                className="gap-1.5"
                                disable={busy}
                                onClick={() => setConfirm('postNow')}
                            >
                                <PaperPlaneTilt size={14} aria-hidden />
                                {t('actions.postNow')}
                            </MyButton>
                        )}
                        {canApprove && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="gap-1.5"
                                disable={busy}
                                onClick={() => approve.mutate(post.id)}
                            >
                                <CheckCircle size={14} aria-hidden />
                                {t('actions.approve')}
                            </MyButton>
                        )}
                        {canEdit && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="gap-1.5"
                                disable={busy}
                                onClick={() => onEdit(post)}
                            >
                                <PencilSimple size={14} aria-hidden />
                                {t('actions.edit')}
                            </MyButton>
                        )}
                        {canRetry && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="gap-1.5"
                                disable={busy}
                                onClick={() => retry.mutate(post.id)}
                            >
                                <ArrowsClockwise size={14} aria-hidden />
                                {t('actions.retry')}
                            </MyButton>
                        )}
                        {canCancel && (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                className="gap-1.5 text-neutral-600"
                                disable={busy}
                                onClick={() => setConfirm('cancel')}
                            >
                                <Prohibit size={14} aria-hidden />
                                {t('actions.cancelPost')}
                            </MyButton>
                        )}
                        {canDelete && (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                className="gap-1.5 text-danger-600"
                                disable={busy}
                                onClick={() => setConfirm('delete')}
                            >
                                <Trash size={14} aria-hidden />
                                {t('actions.delete')}
                            </MyButton>
                        )}
                    </div>
                </div>
            )}

            <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirm && t(`confirm.${confirm}.title`, { count: platforms.length })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirm &&
                                t(`confirm.${confirm}.body`, {
                                    networks: platforms
                                        .map((platform) => platformLabel(platform, t, 'social'))
                                        .join(', '),
                                })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('actions.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            className={cn(
                                confirm === 'postNow'
                                    ? 'bg-primary-500 text-white hover:bg-primary-400'
                                    : 'bg-danger-600 text-white hover:bg-danger-700'
                            )}
                            onClick={() => {
                                if (confirm === 'postNow') postNow.mutate(post.id);
                                if (confirm === 'cancel') cancel.mutate(post.id);
                                if (confirm === 'delete') remove.mutate(post.id);
                                setConfirm(null);
                            }}
                        >
                            {confirm && t(`confirm.${confirm}.confirm`)}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </li>
    );
}
