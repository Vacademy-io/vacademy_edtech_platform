import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
    ChatCircleText,
    ArrowsClockwise,
    ListChecks,
    Note,
} from '@phosphor-icons/react';
import {
    CallStatusPill,
    CallRecordingPlayButton,
    formatCallDuration,
} from '@/components/shared/leads';
import {
    fetchActivityFeed,
    type ActivityFeedItem,
} from '../-services/counsellor-workbench-services';

interface Props {
    instituteId: string;
    counsellorUserId: string;
}

const ICON: Record<string, React.ReactNode> = {
    CALL: <Phone size={16} className="text-success-600" />,
    FOLLOWUP_CREATED: <ListChecks size={16} className="text-primary-600" />,
    FOLLOWUP_CLOSED: <ListChecks size={16} className="text-success-600" />,
    NOTE_ADDED: <Note size={16} className="text-neutral-600" />,
    LEAD_TRANSFERRED_OUT: <ArrowsClockwise size={16} className="text-warning-600" />,
    LEAD_TRANSFERRED_IN: <ArrowsClockwise size={16} className="text-primary-600" />,
    STATUS_CHANGED: <ChatCircleText size={16} className="text-info-600" />,
};

export function CounsellorActivityTab({ instituteId, counsellorUserId }: Props) {
    const { t } = useTranslation('counsellorsActivityTab');
    const { data, isLoading, error } = useQuery({
        queryKey: ['workbench-activity', counsellorUserId, instituteId],
        enabled: !!instituteId && !!counsellorUserId,
        queryFn: () => fetchActivityFeed(counsellorUserId, instituteId, undefined, undefined, 50),
    });

    if (isLoading)
        return <div className="p-4 text-subtitle text-neutral-500">{t('loading')}</div>;
    if (error)
        return (
            <div className="p-4 text-subtitle text-danger-600">
                {t('error')}
            </div>
        );
    if (!data || data.length === 0) {
        return (
            <div className="rounded border border-dashed border-neutral-300 p-6 text-center text-subtitle text-neutral-500">
                {t('empty')}
            </div>
        );
    }

    return (
        <ul className="space-y-1.5">
            {data.map((item) => (
                <ActivityRow
                    key={`${item.source_table}-${item.id}`}
                    item={item}
                    instituteId={instituteId}
                />
            ))}
        </ul>
    );
}

/** CALL-row metadata emitted by WorkbenchActivityRepository's calls branch. */
interface CallMetadata {
    status?: string | null;
    duration_seconds?: number | null;
    recording_url?: string | null;
    direction?: string | null;
}

function parseCallMetadata(json: string | null): CallMetadata | null {
    if (!json) return null;
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? (parsed as CallMetadata) : null;
    } catch {
        return null;
    }
}

function ActivityRow({ item, instituteId }: { item: ActivityFeedItem; instituteId: string }) {
    const { t } = useTranslation('counsellorsActivityTab');
    const callMeta = item.action_type === 'CALL' ? parseCallMetadata(item.metadata_json) : null;

    return (
        <li className="flex items-start gap-3 rounded-md border border-neutral-200 bg-white p-3">
            <div className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-neutral-100">
                {ICON[item.action_type] ?? <ChatCircleText size={16} />}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-body font-medium text-neutral-900">
                        {labelFor(item.action_type, t)}
                    </div>
                    <time className="shrink-0 text-caption text-neutral-500">
                        {relative(item.created_at, t)}
                    </time>
                </div>
                {callMeta ? (
                    <CallDetails meta={callMeta} callLogId={item.id} instituteId={instituteId} />
                ) : (
                    <>
                        {item.title && (
                            <div className="text-subtitle text-neutral-700">{item.title}</div>
                        )}
                        {item.description && (
                            <div className="truncate text-caption text-neutral-500">
                                {item.description}
                            </div>
                        )}
                    </>
                )}
            </div>
        </li>
    );
}

/**
 * Rich CALL row: direction + outcome pill + duration, and inline recording
 * playback when the call carries one. For telephony_call_log rows `item.id`
 * IS the call-log id, which is what the presigned-URL endpoint expects.
 */
function CallDetails({
    meta,
    callLogId,
    instituteId,
}: {
    meta: CallMetadata;
    callLogId: string;
    instituteId: string;
}) {
    const { t } = useTranslation('counsellorsActivityTab');
    const isInbound = meta.direction === 'INBOUND';
    return (
        <div className="mt-1 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
                {meta.direction &&
                    (isInbound ? (
                        <span className="inline-flex items-center gap-1 text-caption text-info-600">
                            <PhoneIncoming size={12} /> {t('inbound')}
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-caption text-neutral-500">
                            <PhoneOutgoing size={12} /> {t('outbound')}
                        </span>
                    ))}
                {meta.status && <CallStatusPill status={meta.status} />}
                <span className="text-caption text-neutral-500">
                    · {formatCallDuration(meta.duration_seconds)}
                </span>
            </div>
            {meta.recording_url && (
                <CallRecordingPlayButton
                    callLogId={callLogId}
                    instituteId={instituteId}
                    className="max-w-xs self-start"
                />
            )}
        </div>
    );
}

function labelFor(action: string, t: TFunction) {
    switch (action) {
        case 'CALL':
            return t('actions.call');
        case 'FOLLOWUP_CREATED':
            return t('actions.followupCreated');
        case 'FOLLOWUP_CLOSED':
            return t('actions.followupClosed');
        case 'NOTE_ADDED':
            return t('actions.noteAdded');
        case 'LEAD_TRANSFERRED_OUT':
            return t('actions.leadTransferredOut');
        case 'LEAD_TRANSFERRED_IN':
            return t('actions.leadTransferredIn');
        case 'STATUS_CHANGED':
            return t('actions.statusChanged');
        default:
            return action.replaceAll('_', ' ').toLowerCase();
    }
}

function relative(iso: string, t: TFunction) {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return t('relativeTime.justNow');
    if (minutes < 60) return t('relativeTime.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('relativeTime.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('relativeTime.daysAgo', { count: days });
}
