import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CalendarCheck, CaretDown, Clock, PencilSimple } from '@phosphor-icons/react';
import {
    CompleteFollowUpPopover,
    fetchLeadFollowups,
    type LeadFollowup,
} from '@/components/shared/leads';
import { parseHtmlToString } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useFollowUpFeatures } from '@/components/shared/leads/follow-up-fields';
import { EditFollowUpDialog } from './edit-follow-up-dialog';

// Close flow (CompleteFollowUpPopover) lives in the shared leads layer now —
// the Follow-ups page reuses the same component for its inline row action.
export type { LeadFollowup };

function buildStatusConfig(t: TFunction): Record<string, { label: string; className: string }> {
    return {
        PENDING: { label: t('status.pending'), className: 'bg-blue-100 text-blue-700' },
        ONGOING: { label: t('status.ongoing'), className: 'bg-amber-100 text-amber-700' },
        OVERDUE: { label: t('status.overdue'), className: 'bg-red-100 text-red-700' },
        COMPLETED: { label: t('status.completed'), className: 'bg-emerald-100 text-emerald-700' },
    };
}

const DATE_TIME = 'd MMM yyyy, h:mm a';

const formatDateTime = (raw: string | null | undefined): string | null =>
    raw ? format(new Date(raw), DATE_TIME) : null;

/** Notes are written in the rich text editor, so they may be HTML. */
const plainText = (raw: string | null | undefined): string => {
    if (!raw) return '';
    const isHtml = /<\/?[a-z][^>]*>/i.test(raw);
    return (isHtml ? parseHtmlToString(raw) : raw).trim();
};

function EditButton({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation('manageStudentsFollowUpsWidget');
    return (
        <button
            type="button"
            onClick={onClick}
            title={t('card.edit')}
            aria-label={t('card.edit')}
            className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        >
            <PencilSimple className="size-3.5" />
        </button>
    );
}

// ── Follow-up Card ────────────────────────────────────────────────────────────

function FollowUpCard({
    followup,
    userId,
    onEdit,
    showCreated,
}: {
    followup: LeadFollowup;
    userId: string;
    /** Omitted = the institute has editing switched off; no edit button. */
    onEdit?: () => void;
    showCreated: boolean;
}) {
    const { t } = useTranslation('manageStudentsFollowUpsWidget');
    const statusConfig = useMemo(() => buildStatusConfig(t), [t]);
    const config = (statusConfig[followup.status] ?? statusConfig['PENDING'])!;

    const formattedTime = formatDateTime(followup.schedule_time);
    const createdAt = showCreated ? formatDateTime(followup.created_at) : null;

    const relativeTime = followup.schedule_time
        ? formatDistanceToNow(new Date(followup.schedule_time), { addSuffix: true })
        : null;

    const contentPreview = (() => {
        const text = plainText(followup.content);
        if (!text) return null;
        return text.length > 90 ? `${text.slice(0, 90)}…` : text;
    })();

    return (
        <div className="rounded-xl border border-neutral-100 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
                <span
                    className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold',
                        config.className
                    )}
                >
                    {config.label}
                </span>
                <div className="flex items-center gap-1">
                    {onEdit && <EditButton onClick={onEdit} />}
                    {!followup.is_closed && (
                        <CompleteFollowUpPopover
                            followupId={followup.id}
                            audienceResponseId={followup.audience_response_id}
                            userId={userId}
                        />
                    )}
                </div>
            </div>

            {formattedTime && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                    <Clock weight="fill" className="size-3.5 shrink-0 text-neutral-400" />
                    <span>{formattedTime}</span>
                    {relativeTime && <span className="text-neutral-400">· {relativeTime}</span>}
                </div>
            )}

            {createdAt && (
                <p className="mt-1 text-caption text-neutral-400">
                    {t('card.created', { date: createdAt })}
                </p>
            )}

            {followup.interest_level && (
                <span className="mt-1.5 inline-block rounded-full bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-700">
                    {followup.interest_level}
                </span>
            )}

            {contentPreview && (
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{contentPreview}</p>
            )}

            {followup.is_closed && followup.closer_reason && (
                <p className="mt-1.5 text-xs italic text-neutral-400">
                    {t('card.closedReason', { reason: followup.closer_reason })}
                </p>
            )}
        </div>
    );
}

// ── Follow-up History ─────────────────────────────────────────────────────────

const HISTORY_PREVIEW = 5;

function HistoryLine({ label, value }: { label: string; value: string | null | undefined }) {
    if (!value) return null;
    return (
        <p className="text-xs text-neutral-500">
            <span className="font-medium text-neutral-600">{label}:</span> {value}
        </p>
    );
}

/**
 * Every follow-up on the lead, open and closed, newest first — so a counsellor
 * can read the past calls in one place instead of opening each event in the
 * journey. Each entry can be edited, closed ones included.
 */
function FollowUpHistory({
    followups,
    onEdit,
}: {
    followups: LeadFollowup[];
    /** Omitted = the institute has editing switched off; no edit buttons. */
    onEdit?: (f: LeadFollowup) => void;
}) {
    const { t } = useTranslation('manageStudentsFollowUpsWidget');
    const statusConfig = useMemo(() => buildStatusConfig(t), [t]);
    const [showAll, setShowAll] = useState(false);

    const sorted = useMemo(
        () =>
            [...followups].sort(
                (a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? '') || 0
            ),
        [followups]
    );
    const shown = showAll ? sorted : sorted.slice(0, HISTORY_PREVIEW);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <div className="h-3.5 w-1 rounded-full bg-neutral-300" />
                <h4 className="text-sm font-semibold text-neutral-700">{t('history.title')}</h4>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-neutral-500">
                    {sorted.length}
                </span>
            </div>

            <ol className="flex flex-col divide-y divide-neutral-100 rounded-xl border border-neutral-100 bg-white">
                {shown.map((f) => {
                    const config = (statusConfig[f.status] ?? statusConfig['PENDING'])!;
                    const comment = plainText(f.content);
                    return (
                        <li key={f.id} className="flex flex-col gap-1 px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                    <span
                                        className={cn(
                                            'shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold',
                                            config.className
                                        )}
                                    >
                                        {config.label}
                                    </span>
                                    {f.interest_level && (
                                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-700">
                                            {f.interest_level}
                                        </span>
                                    )}
                                </div>
                                {onEdit && <EditButton onClick={() => onEdit(f)} />}
                            </div>
                            <HistoryLine
                                label={t('history.created')}
                                value={formatDateTime(f.created_at)}
                            />
                            <HistoryLine
                                label={t('history.nextFollowUp')}
                                value={formatDateTime(f.schedule_time)}
                            />
                            <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700">
                                {comment || (
                                    <span className="text-xs italic text-neutral-400">
                                        {t('history.noComment')}
                                    </span>
                                )}
                            </p>
                            <HistoryLine label={t('history.response')} value={f.student_response} />
                            <HistoryLine label={t('history.mode')} value={f.follow_up_mode} />
                            <HistoryLine label={t('history.nextAction')} value={f.next_action} />
                            {f.is_closed && (
                                <HistoryLine
                                    label={t('history.closingNote')}
                                    value={[f.closer_reason, formatDateTime(f.closed_at)]
                                        .filter(Boolean)
                                        .join(' · ')}
                                />
                            )}
                        </li>
                    );
                })}
            </ol>

            {sorted.length > HISTORY_PREVIEW && (
                <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="flex items-center gap-1 self-start text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                    <CaretDown className={cn('size-3', showAll && 'rotate-180')} />
                    {showAll
                        ? t('history.showLess')
                        : t('history.showAll', { count: sorted.length })}
                </button>
            )}
        </div>
    );
}

// ── Follow-ups Widget ─────────────────────────────────────────────────────────

interface FollowUpsWidgetProps {
    audienceResponseId: string;
    userId: string;
}

export function FollowUpsWidget({ audienceResponseId, userId }: FollowUpsWidgetProps) {
    const { t } = useTranslation('manageStudentsFollowUpsWidget');
    const [editing, setEditing] = useState<LeadFollowup | null>(null);
    // Institute switches; both off = the widget exactly as before.
    const { showHistory, allowEditing } = useFollowUpFeatures();
    const { data: followups = [], isLoading } = useQuery({
        queryKey: ['lead-followups', audienceResponseId],
        queryFn: () => fetchLeadFollowups(audienceResponseId),
        enabled: !!audienceResponseId,
        staleTime: 60 * 1000,
    });

    const open = followups.filter((f) => !f.is_closed);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <div className="h-3.5 w-1 rounded-full bg-primary-500" />
                <h4 className="text-sm font-semibold text-neutral-700">{t('widget.title')}</h4>
                {open.length > 0 && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-neutral-500">
                        {t('widget.openCount', { count: open.length })}
                    </span>
                )}
            </div>

            {isLoading && <div className="h-16 animate-pulse rounded-xl bg-neutral-100" />}

            {!isLoading && open.length === 0 && (
                <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-5 text-center">
                    <CalendarCheck weight="fill" className="size-7 text-neutral-300" />
                    <p className="text-xs font-medium text-neutral-500">{t('emptyState.title')}</p>
                    <p className="text-caption text-neutral-400">
                        {t('emptyState.description')}
                    </p>
                </div>
            )}

            {!isLoading && open.length > 0 && (
                <div className="flex flex-col gap-2">
                    {open.map((f) => (
                        <FollowUpCard
                            key={f.id}
                            followup={f}
                            userId={userId}
                            onEdit={allowEditing ? () => setEditing(f) : undefined}
                            showCreated={showHistory}
                        />
                    ))}
                </div>
            )}

            {showHistory && !isLoading && followups.length > 0 && (
                <FollowUpHistory
                    followups={followups}
                    onEdit={allowEditing ? setEditing : undefined}
                />
            )}

            {allowEditing && (
                <EditFollowUpDialog
                    followup={editing}
                    userId={userId}
                    onOpenChange={(o) => !o && setEditing(null)}
                />
            )}
        </div>
    );
}
