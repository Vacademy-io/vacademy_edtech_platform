import { useMemo, useState } from 'react';
import { tierChipStyle, useLeadTiers } from '@/hooks/use-lead-tiers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_ALL_LEAD_EVENTS } from '@/constants/urls';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchCallRecordingUrl } from '@/components/shared/leads';
import { AddLeadNoteDialog } from '@/components/shared/add-lead-note-dialog';
import type { CallActivity } from '@/components/shared/lead-calls/call-activity';
import {
    Path,
    UserPlus,
    UserCheck,
    ArrowsLeftRight,
    TrendUp,
    TrendDown,
    CalendarCheck,
    ChatCircle,
    CheckCircle,
    XCircle,
    GitMerge,
    CurrencyCircleDollar,
    GraduationCap,
    Warning,
    ArrowRight,
    PencilSimple,
    Note,
    NotePencil,
    Phone,
    PlayCircle,
    DownloadSimple,
    CaretDown,
    CaretUp,
    ArrowsClockwise,
    WhatsappLogo,
    type Icon as PhosphorIcon,
    Repeat,
} from '@phosphor-icons/react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineEvent {
    id: string;
    type: string;
    type_id: string;
    action_type: string;
    actor_type: string;
    actor_name: string | null;
    title: string;
    description: string | null;
    metadata: Record<string, unknown> | null;
    category: 'JOURNEY' | 'ACTIVITY';
    is_pinned: boolean;
    created_at: string;
}

interface EventPage {
    content: TimelineEvent[];
    totalElements: number;
    totalPages: number;
    last: boolean;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchAllEvents(
    userId: string,
    responseId: string | null | undefined,
    page: number,
    size: number
): Promise<EventPage> {
    const params: Record<string, unknown> = { page, size };
    // Pass responseId as typeIds so legacy journey events (stored with type_id=responseId
    // but null student_user_id) are also included in the OR query.
    if (responseId) params['typeIds'] = responseId;
    const res = await authenticatedAxiosInstance.get(GET_ALL_LEAD_EVENTS(userId), { params });
    return res.data;
}

// ── Event config ──────────────────────────────────────────────────────────────

type ActionConfig = {
    Icon: PhosphorIcon;
    dotBg: string;
    iconColor: string;
    label: string;
};

// Sentinel key for the fallback config entry — kept inside the same map (rather
// than a separate constant) so buildActionConfig has a single t()-driven source.
const FALLBACK_ACTION_KEY = '__fallback__';

function buildActionConfig(t: TFunction): Record<string, ActionConfig> {
    return {
        // JOURNEY events
        LEAD_SUBMITTED: {
            Icon: UserPlus,
            dotBg: 'bg-info-50 ring-info-200',
            iconColor: 'text-info-600',
            label: t('actionConfig.leadSubmitted'),
        },
        COUNSELOR_ASSIGNED: {
            Icon: UserCheck,
            dotBg: 'bg-primary-50 ring-primary-200',
            iconColor: 'text-primary-600',
            label: t('actionConfig.counselorAssigned'),
        },
        STATUS_CHANGED: {
            Icon: ArrowsLeftRight,
            dotBg: 'bg-secondary ring-border',
            iconColor: 'text-muted-foreground',
            label: t('actionConfig.statusChanged'),
        },
        SCORE_UPDATED: {
            Icon: TrendUp,
            dotBg: 'bg-warning-50 ring-warning-200',
            iconColor: 'text-warning-600',
            label: t('actionConfig.scoreUpdated'),
        },
        MANUAL_SCORE_UPDATE: {
            Icon: PencilSimple,
            dotBg: 'bg-primary-50 ring-primary-200',
            iconColor: 'text-primary-600',
            label: t('actionConfig.manualScoreUpdate'),
        },
        FOLLOWUP: {
            Icon: CalendarCheck,
            dotBg: 'bg-info-50 ring-info-200',
            iconColor: 'text-info-500',
            label: t('actionConfig.followup'),
        },
        REACHOUT: {
            Icon: ChatCircle,
            dotBg: 'bg-primary-50 ring-primary-200',
            iconColor: 'text-primary-500',
            label: t('actionConfig.reachout'),
        },
        LEAD_CONVERTED: {
            Icon: CheckCircle,
            dotBg: 'bg-success-50 ring-success-300',
            iconColor: 'text-success-600',
            label: t('actionConfig.leadConverted'),
        },
        LEAD_LOST: {
            Icon: XCircle,
            dotBg: 'bg-danger-50 ring-danger-200',
            iconColor: 'text-danger-600',
            label: t('actionConfig.leadLost'),
        },
        DUPLICATE_MERGED: {
            Icon: GitMerge,
            dotBg: 'bg-warning-50 ring-warning-200',
            iconColor: 'text-warning-600',
            label: t('actionConfig.duplicateMerged'),
        },
        // An existing lead contacted us again through a WhatsApp chatbot flow — no new lead created.
        RE_ENQUIRY: {
            Icon: WhatsappLogo,
            dotBg: 'bg-info-50 ring-info-200',
            iconColor: 'text-info-600',
            label: t('actionConfig.reEnquiry'),
        },
        // An existing lead enquired again through a form, ad or list (repeat-lead handling).
        REATTEMPT: {
            Icon: Repeat,
            dotBg: 'bg-warning-50 ring-warning-200',
            iconColor: 'text-warning-600',
            label: t('actionConfig.reattempt'),
        },
        PAYMENT_RECEIVED: {
            Icon: CurrencyCircleDollar,
            dotBg: 'bg-success-50 ring-success-200',
            iconColor: 'text-success-600',
            label: t('actionConfig.paymentReceived'),
        },
        ENROLLMENT_COMPLETED: {
            Icon: GraduationCap,
            dotBg: 'bg-success-50 ring-success-200',
            iconColor: 'text-success-700',
            label: t('actionConfig.enrollmentCompleted'),
        },
        // ACTIVITY events
        NOTE: {
            Icon: Note,
            dotBg: 'bg-secondary ring-border',
            iconColor: 'text-neutral-500',
            label: t('actionConfig.note'),
        },
        CALL: {
            Icon: Phone,
            dotBg: 'bg-secondary ring-border',
            iconColor: 'text-neutral-500',
            label: t('actionConfig.call'),
        },
        // Outbound call placed via the telephony integration (Exotel etc.).
        // Recording playback is rendered inline in EventMeta when a
        // recording_storage_key is present on the metadata.
        CALL_MADE: {
            Icon: Phone,
            dotBg: 'bg-primary-50 ring-primary-200',
            iconColor: 'text-primary-600',
            label: t('actionConfig.callMade'),
        },
        WALK_IN_NOTE: {
            Icon: Note,
            dotBg: 'bg-secondary ring-border',
            iconColor: 'text-neutral-500',
            label: t('actionConfig.walkInNote'),
        },
        FOLLOWUP_SCHEDULED: {
            Icon: CalendarCheck,
            dotBg: 'bg-info-50 ring-info-200',
            iconColor: 'text-info-500',
            label: t('actionConfig.followupScheduled'),
        },
        STATUS_CHANGE: {
            Icon: ArrowsLeftRight,
            dotBg: 'bg-secondary ring-border',
            iconColor: 'text-muted-foreground',
            label: t('actionConfig.statusChange'),
        },
        [FALLBACK_ACTION_KEY]: {
            Icon: Warning,
            dotBg: 'bg-secondary ring-border',
            iconColor: 'text-muted-foreground',
            label: t('actionConfig.fallback'),
        },
    };
}

function getConfig(actionType: string, config: Record<string, ActionConfig>): ActionConfig {
    return config[actionType] ?? config[FALLBACK_ACTION_KEY]!;
}

// ── Metadata renderers ────────────────────────────────────────────────────────

function StatusChangeMeta({ meta }: { meta: Record<string, unknown> }) {
    const { t } = useTranslation('manageStudentsLeadJourneyTimeline');
    const from =
        (meta.from_status_label as string) ||
        (meta.from_status_key as string) ||
        (meta.old_status as string) ||
        null;
    const to =
        (meta.to_status_label as string) ||
        (meta.to_status_key as string) ||
        (meta.new_status as string) ||
        null;
    if (!from && !to) return null;
    return (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {from ? (
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {from}
                </span>
            ) : (
                <span className="text-xs italic text-muted-foreground">
                    {t('statusChangeMeta.previous')}
                </span>
            )}
            <ArrowRight weight="bold" className="size-3 shrink-0 text-muted-foreground" />
            {to && (
                <span className="rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-600">
                    {to}
                </span>
            )}
        </div>
    );
}

function ScoreUpdateMeta({ meta }: { meta: Record<string, unknown> }) {
    const oldScore = meta.old_score as number | undefined;
    const newScore = meta.new_score as number | undefined;
    const tier = meta.tier as string | undefined;
    // Tier label/colour from the institute catalog (custom tiers included).
    const tierCatalog = useLeadTiers();
    if (newScore === undefined) return null;
    const improved = oldScore === undefined || newScore >= oldScore;
    const TierIcon = improved ? TrendUp : TrendDown;

    return (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
                {oldScore !== undefined && (
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                        {oldScore}
                    </span>
                )}
                <TierIcon
                    weight="bold"
                    className={cn('size-3.5', improved ? 'text-success-500' : 'text-danger-500')}
                />
                <span
                    className={cn(
                        'text-xs font-bold tabular-nums',
                        improved ? 'text-success-600' : 'text-danger-600'
                    )}
                >
                    {newScore}
                </span>
            </div>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
                <div
                    className={cn(
                        'h-full rounded-full transition-all duration-300',
                        improved ? 'bg-success-400' : 'bg-danger-400'
                    )}
                    style={{
                        width: `${newScore}%`,
                    }} /* dynamic score % — cannot use Tailwind token */
                />
            </div>
            {tier && (
                <span
                    className="rounded-full border px-1.5 py-0.5 text-xs font-semibold"
                    // Inline style: tier colour is admin-picked hex (no design token).
                    style={tierChipStyle(tierCatalog.colorFor(tier))}
                >
                    {tierCatalog.labelFor(tier)}
                </span>
            )}
        </div>
    );
}

function CounselorMeta({ meta }: { meta: Record<string, unknown> }) {
    const { t } = useTranslation('manageStudentsLeadJourneyTimeline');
    const name = meta.counselor_name as string | undefined;
    const source = meta.assignment_source as string | undefined;
    if (!name && !meta.counselor_id) return null;
    const initial = name?.[0]?.toUpperCase() ?? '?';
    return (
        <div className="mt-1.5 flex items-center gap-1.5">
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                {initial}
            </div>
            <span className="text-xs font-medium text-neutral-700">
                {name ?? t('counselorMeta.unknown')}
            </span>
            {source && (
                <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                    {source === 'AUTO' ? t('counselorMeta.autoPool') : t('counselorMeta.manual')}
                </span>
            )}
        </div>
    );
}

function SourceMeta({ meta }: { meta: Record<string, unknown> }) {
    const source = meta.source_type as string | undefined;
    if (!source) return null;
    return (
        <div className="mt-1.5">
            <span className="rounded-full border border-info-200 bg-info-50 px-2 py-0.5 text-xs font-medium text-info-600">
                {source.replace(/_/g, ' ')}
            </span>
        </div>
    );
}

function FollowupMeta({ meta }: { meta: Record<string, unknown> }) {
    const scheduleTime = meta.scheduleTime as string | number | undefined;
    if (!scheduleTime) return null;
    // Handles: epoch ms number, epoch ms string, or legacy SQL timestamp string "2026-05-23 02:40:53.228"
    const asNumber = typeof scheduleTime === 'number' ? scheduleTime : Number(scheduleTime);
    const d = isNaN(asNumber)
        ? new Date(String(scheduleTime).replace(' ', 'T'))
        : new Date(asNumber);
    const isValid = !isNaN(d.getTime());
    if (!isValid) return null;
    return (
        <div className="mt-1.5 flex items-center gap-1.5">
            <CalendarCheck weight="fill" className="size-3.5 shrink-0 text-info-500" />
            <span className="text-xs font-medium text-neutral-700">
                {format(d, 'MMM d, yyyy · h:mm a')}
            </span>
        </div>
    );
}

/**
 * CallRecordingMeta — inline player + download for an Outbound Call event.
 *
 * The recording mp3 lives in our media_service (uploaded by the backend
 * after Exotel delivers the StatusCallback). The presigned URL is fetched
 * lazily on first Play click and reused for Download so we don't trigger
 * two presign round-trips per recording.
 *
 * NOT-A-BUG: the raw Exotel URL in the row's `recording_url` column does
 * require HTTP Basic Auth (our Exotel API creds). That URL is purely a
 * server-side breadcrumb — the UI never touches it. We always go through
 * GET /telephony/calls/{id}/recording, which returns a presigned URL from
 * our media_service that the browser can play directly.
 */
function CallRecordingMeta({
    title,
    description,
    meta,
    userId,
    linkedNotes,
}: {
    title: string;
    description: string | null;
    meta: Record<string, unknown>;
    userId: string;
    /** Notes added from this specific call row — rendered inline below the
     *  recording so the counsellor sees "what was discussed" tied to "which
     *  call". Empty array means no linked notes. */
    linkedNotes: TimelineEvent[];
}) {
    const { t } = useTranslation('manageStudentsLeadJourneyTimeline');
    const instituteId = getCurrentInstituteId() ?? '';
    const callLogId = typeof meta.call_log_id === 'string' ? meta.call_log_id : null;
    const callerId = typeof meta.caller_id === 'string' ? meta.caller_id : null;
    const status = typeof meta.status === 'string' ? meta.status : null;
    const direction = typeof meta.direction === 'string' ? meta.direction : null;
    const durationSeconds =
        typeof meta.duration_seconds === 'number' ? meta.duration_seconds : null;
    const hasRecording = typeof meta.recording_storage_key === 'string';

    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [noteDialogOpen, setNoteDialogOpen] = useState(false);

    // Pre-fill the Add-note dialog so the counsellor only has to pick an
    // outcome and (optionally) write a note — direction + telephony_call_log_id
    // come straight from this row's metadata, so the saved note links back to
    // this exact call.
    const initialCallActivity: CallActivity = {
        direction: direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
        provider: 'EXOTEL',
        telephonyCallLogId: callLogId ?? undefined,
    };

    const resolveUrl = async (): Promise<string | null> => {
        if (url) return url;
        if (!callLogId || !instituteId) return null;
        setLoading(true);
        try {
            const fetched = await fetchCallRecordingUrl(callLogId, instituteId);
            setUrl(fetched);
            return fetched;
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
            {/* Top line: status pill + duration + caller-ID */}
            <div className="flex flex-wrap items-center gap-1.5">
                {status && (
                    <span
                        className={cn(
                            'rounded-full px-1.5 py-0.5 text-2xs font-medium',
                            status === 'COMPLETED'
                                ? 'bg-success-50 text-success-700'
                                : status === 'NO_ANSWER' || status === 'BUSY'
                                  ? 'bg-warning-50 text-warning-700'
                                  : status === 'FAILED' || status === 'CANCELLED'
                                    ? 'bg-danger-50 text-danger-700'
                                    : 'bg-neutral-100 text-neutral-600'
                        )}
                    >
                        {formatStatus(status, t)}
                    </span>
                )}
                {durationSeconds != null && durationSeconds > 0 && (
                    <span className="text-neutral-600">{formatDuration(durationSeconds, t)}</span>
                )}
                {callerId && (
                    <span className="text-neutral-400">
                        {t('callRecording.from', { caller: callerId })}
                    </span>
                )}
            </div>

            {description && status == null && <p className="leading-relaxed">{description}</p>}

            {hasRecording && (
                <div className="pt-0.5">
                    {url ? (
                        <div className="space-y-1.5">
                            <audio
                                controls
                                src={url}
                                preload="metadata"
                                className="w-full max-w-md"
                            />
                            <a
                                href={url}
                                download={`call-${callLogId}.mp3`}
                                className="inline-flex items-center gap-1 text-2xs text-primary-600 hover:underline"
                            >
                                <DownloadSimple className="size-3" />
                                {t('callRecording.download')}
                            </a>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={resolveUrl}
                            disabled={loading || !callLogId}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-2xs text-neutral-700 transition-colors',
                                loading || !callLogId
                                    ? 'cursor-not-allowed opacity-60'
                                    : 'hover:border-primary-300 hover:bg-neutral-50'
                            )}
                        >
                            <PlayCircle className="size-3.5" />
                            {loading
                                ? t('callRecording.loading')
                                : t('callRecording.playRecording')}
                        </button>
                    )}
                </div>
            )}

            {/* Suppress title-only display for CALL_MADE — the pill row above
                already conveys "Outbound call · 0m 23s · Connected". */}
            <span className="sr-only">{title}</span>

            {/* Inline notes — anything the counsellor logged from this call's
                Add-note button is shown here (not as a separate timeline row)
                so the note travels with the call it describes. */}
            {linkedNotes.length > 0 && (
                <div className="mt-2 space-y-1.5 border-l-2 border-primary-100 pl-2.5">
                    {linkedNotes
                        .slice()
                        .sort((a, b) => a.created_at.localeCompare(b.created_at))
                        .map((n) => (
                            <LinkedCallNote key={n.id} note={n} />
                        ))}
                </div>
            )}

            {/* Add-note affordance — opens AddLeadNoteDialog pre-filled with
                action_type=CALL_LOG and a link to this call (via
                telephony_call_log_id metadata). Lets the counsellor log an
                outcome + note for the call directly from the Lead Journey
                timeline. */}
            {userId && callLogId && (
                <div className="pt-1">
                    <button
                        type="button"
                        onClick={() => setNoteDialogOpen(true)}
                        className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-2xs text-neutral-700 hover:border-primary-300 hover:bg-neutral-50"
                    >
                        <NotePencil className="size-3.5" />
                        {t('callRecording.addNote')}
                    </button>
                </div>
            )}
            {userId && (
                <AddLeadNoteDialog
                    open={noteDialogOpen}
                    onOpenChange={setNoteDialogOpen}
                    userId={userId}
                    initialActionType="CALL_LOG"
                    initialCallActivity={initialCallActivity}
                    hideCallRecordingControls
                />
            )}
        </div>
    );
}

/**
 * One note tied to a specific call row — outcome pill + body + actor/time.
 * Kept lightweight (no avatar / left rail) since it lives nested inside the
 * parent CALL_MADE row's card, not as a top-level timeline event.
 */
function LinkedCallNote({ note }: { note: TimelineEvent }) {
    const { t } = useTranslation('manageStudentsLeadJourneyTimeline');
    const outcome =
        note.metadata && typeof note.metadata.call_outcome === 'string'
            ? (note.metadata.call_outcome as string)
            : null;
    const rawTs = note.created_at ?? '';
    const hasOffset = rawTs.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawTs);
    const ts = rawTs ? new Date(hasOffset ? rawTs : rawTs + '+05:30') : null;

    return (
        <div className="rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
                <NotePencil weight="fill" className="size-3 shrink-0 text-primary-500" />
                {outcome && (
                    <span className="rounded-full bg-primary-50 px-1.5 py-0.5 text-2xs font-medium text-primary-700">
                        {formatCallOutcome(outcome, t)}
                    </span>
                )}
                {note.actor_name && (
                    <span className="text-2xs text-neutral-500">{note.actor_name}</span>
                )}
                {ts && !isNaN(ts.getTime()) && (
                    <span className="text-2xs text-neutral-400">
                        · {format(ts, 'MMM d, h:mm a')}
                    </span>
                )}
            </div>
            {note.description && (
                <div
                    className="mt-1 leading-relaxed text-neutral-700 [&_p+p]:mt-1 [&_p]:m-0"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.description) }}
                />
            )}
        </div>
    );
}

/** Outcome key → friendly label. Mirrors CALL_OUTCOME_LABELS from
 *  call-activity.ts; duplicated here to avoid a cross-feature import
 *  for one lookup. */
function formatCallOutcome(key: string, t: TFunction): string {
    switch (key) {
        case 'CONNECTED':
            return t('callOutcome.connected');
        case 'NO_ANSWER':
            return t('callOutcome.noAnswer');
        case 'BUSY':
            return t('callOutcome.busy');
        case 'LEFT_VOICEMAIL':
            return t('callOutcome.leftVoicemail');
        case 'CALL_BACK_LATER':
            return t('callOutcome.callBackLater');
        case 'NOT_REACHABLE':
            return t('callOutcome.notReachable');
        case 'SWITCHED_OFF':
            return t('callOutcome.switchedOff');
        case 'WRONG_NUMBER':
            return t('callOutcome.wrongNumber');
        case 'INTERESTED':
            return t('callOutcome.interested');
        case 'NOT_INTERESTED':
            return t('callOutcome.notInterested');
        case 'FOLLOW_UP_SCHEDULED':
            return t('callOutcome.followUpScheduled');
        case 'DEMO_SCHEDULED':
            return t('callOutcome.demoScheduled');
        case 'CONVERTED':
            return t('callOutcome.converted');
        case 'DO_NOT_CALL':
            return t('callOutcome.doNotCall');
        default:
            return key;
    }
}

function formatDuration(seconds: number, t: TFunction): string {
    if (seconds <= 0) return t('duration.zero');
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m === 0
        ? t('duration.secondsOnly', { count: s })
        : t('duration.minutesSeconds', { minutes: m, seconds: s });
}

function formatStatus(status: string, t: TFunction): string {
    switch (status) {
        case 'COMPLETED':
            return t('callStatus.connected');
        case 'NO_ANSWER':
            return t('callStatus.noAnswer');
        case 'BUSY':
            return t('callStatus.busy');
        case 'FAILED':
            return t('callStatus.failed');
        case 'CANCELLED':
            return t('callStatus.cancelled');
        case 'IN_PROGRESS':
            return t('callStatus.inProgress');
        case 'COUNSELLOR_RINGING':
        case 'COUNSELLOR_ANSWERED':
            return t('callStatus.ringing');
        case 'QUEUED':
            return t('callStatus.queued');
        default:
            return status;
    }
}

function EventMeta({
    event,
    userId,
    linkedNotes,
}: {
    event: TimelineEvent;
    userId: string;
    linkedNotes: TimelineEvent[];
}) {
    const meta = event.metadata ?? {};
    switch (event.action_type) {
        case 'STATUS_CHANGED':
        case 'LEAD_CONVERTED':
        case 'LEAD_LOST':
        case 'STATUS_CHANGE':
            return <StatusChangeMeta meta={meta} />;
        case 'SCORE_UPDATED':
        case 'MANUAL_SCORE_UPDATE':
            return <ScoreUpdateMeta meta={meta} />;
        case 'COUNSELOR_ASSIGNED':
            return <CounselorMeta meta={meta} />;
        case 'LEAD_SUBMITTED':
            return <SourceMeta meta={meta} />;
        case 'FOLLOWUP_SCHEDULED':
        case 'FOLLOWUP':
            return <FollowupMeta meta={meta} />;
        case 'CALL_MADE':
            return (
                <CallRecordingMeta
                    title={event.title}
                    description={event.description}
                    meta={meta}
                    userId={userId}
                    linkedNotes={linkedNotes}
                />
            );
        default:
            if (!event.description) return null;
            // Sanitize and render rich text (HTML from the RichTextEditor)
            return (
                <div
                    className="prose-xs mt-1 text-xs leading-relaxed text-muted-foreground [&_p+p]:mt-1 [&_p]:m-0"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(event.description) }}
                />
            );
    }
}

// ── Single event row ───────────────────────────────────────────────────────────

function EventRow({
    event,
    isLast,
    userId,
    linkedNotes,
    actionConfig,
}: {
    event: TimelineEvent;
    isLast: boolean;
    userId: string;
    /** For CALL_MADE rows: notes whose metadata.telephony_call_log_id matches
     *  this call's call_log_id — rendered inline under the recording so they
     *  travel with the call instead of as separate timeline rows. */
    linkedNotes: TimelineEvent[];
    /** Built once in the parent via buildActionConfig(t) and threaded down so
     *  every row doesn't need its own translation lookup for icon/label config. */
    actionConfig: Record<string, ActionConfig>;
}) {
    const { t } = useTranslation('manageStudentsLeadJourneyTimeline');
    const config = getConfig(event.action_type, actionConfig);
    const { Icon, dotBg, iconColor } = config;
    const isConverted = event.action_type === 'LEAD_CONVERTED';
    const isLost = event.action_type === 'LEAD_LOST';
    const isTerminal = isConverted || isLost;
    const isActivity = event.category === 'ACTIVITY';
    const isSystem = event.actor_type === 'SYSTEM';
    // Backend sends raw DB timestamp without timezone (e.g. "2026-05-23T09:03:36.590").
    // Append IST offset so the browser interprets it correctly. Guard against
    // old events that still carry a timezone suffix (Z / +HH:MM).
    const rawTs = event.created_at ?? '';
    const hasOffset = rawTs.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawTs);
    const eventDate = new Date(hasOffset ? rawTs : rawTs + '+05:30');

    return (
        <div className="flex gap-3">
            {/* Left rail — always at same x, line stays aligned */}
            <div className="flex flex-col items-center">
                <div
                    className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full ring-2',
                        dotBg,
                        isTerminal && 'ring-offset-1'
                    )}
                >
                    <Icon weight="fill" className={cn('size-3.5', iconColor)} />
                </div>
                {!isLast && <div className="mt-1 min-h-6 w-px flex-1 bg-border" />}
            </div>

            {/* Card */}
            <div
                className={cn(
                    'mb-4 min-w-0 flex-1 rounded-lg border px-3 py-2.5',
                    isActivity
                        ? 'border-border/60 bg-muted/30'
                        : isConverted
                          ? 'border-success-200 bg-success-50/60'
                          : isLost
                            ? 'border-danger-200 bg-danger-50/40'
                            : 'border-border bg-card'
                )}
            >
                <div className="flex items-start justify-between gap-2">
                    <p
                        className={cn(
                            'truncate text-xs leading-tight',
                            isActivity ? 'font-medium text-neutral-600' : 'font-semibold',
                            isConverted
                                ? 'text-success-700'
                                : isLost
                                  ? 'text-danger-700'
                                  : isActivity
                                    ? 'text-neutral-600'
                                    : 'text-neutral-800'
                        )}
                    >
                        {event.title}
                    </p>
                    <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {format(eventDate, 'd MMM yyyy, h:mm a')}
                    </time>
                </div>

                <EventMeta event={event} userId={userId} linkedNotes={linkedNotes} />

                {/* Actor line: "by name" for admins, "System" badge for system events */}
                <div className="mt-1.5 flex items-center gap-1.5">
                    {isSystem ? (
                        <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                            {t('eventRow.system')}
                        </span>
                    ) : event.actor_name ? (
                        <p className="text-xs text-muted-foreground">
                            {t('eventRow.byPrefix')}{' '}
                            <span className="font-medium text-neutral-600">{event.actor_name}</span>
                        </p>
                    ) : null}
                    {isActivity && (
                        <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                            {t('eventRow.activity')}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows() {
    return (
        <div className="flex flex-col">
            {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                        <Skeleton className="size-7 rounded-full" />
                        {i < 3 && <Skeleton className="mt-1 min-h-8 w-px flex-1" />}
                    </div>
                    <div className="mb-4 flex-1">
                        <Skeleton className="h-14 w-full rounded-lg" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
    const { t } = useTranslation('manageStudentsLeadJourneyTimeline');
    return (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 py-8 text-center">
            <Path weight="duotone" className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">{t('emptyState.title')}</p>
            <p className="max-w-xs text-xs text-muted-foreground/70">
                {t('emptyState.description')}
            </p>
        </div>
    );
}

// ── Main exported component ───────────────────────────────────────────────────

interface LeadJourneyTimelineProps {
    /** The student user ID — all events across all types are fetched by this */
    userId: string | null | undefined;
    /** The best-score audience response ID — included in typeIds to catch legacy journey events */
    responseId?: string | null;
}

export function LeadJourneyTimeline({ userId, responseId }: LeadJourneyTimelineProps) {
    const { t } = useTranslation('manageStudentsLeadJourneyTimeline');
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState(0);
    const pageSize = 50;
    const queryClient = useQueryClient();
    const queryKey = ['lead-all-events', userId, responseId, page];
    const actionConfig = useMemo(() => buildActionConfig(t), [t]);

    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey,
        queryFn: () => fetchAllEvents(userId!, responseId, page, pageSize),
        enabled: open && !!userId,
        staleTime: 30 * 1000,
    });

    const totalCount = data?.totalElements;

    // Group notes that were added from a specific call row (they carry
    // metadata.telephony_call_log_id pointing back at that call) so we can:
    //   1. Render them inline under the matching CALL_MADE row, and
    //   2. Exclude them from the top-level timeline so the user doesn't see
    //      the same note twice.
    // Notes added from the generic Add-activity flow have no
    // telephony_call_log_id and stay in the timeline as standalone rows.
    const { visibleEvents, notesByCallLogId } = useMemo(() => {
        const events = data?.content ?? [];
        const map: Record<string, TimelineEvent[]> = {};
        const visible: TimelineEvent[] = [];
        for (const e of events) {
            const linkedId =
                e.metadata && typeof e.metadata.telephony_call_log_id === 'string'
                    ? (e.metadata.telephony_call_log_id as string)
                    : null;
            if (linkedId) {
                (map[linkedId] ??= []).push(e);
            } else {
                visible.push(e);
            }
        }
        return { visibleEvents: visible, notesByCallLogId: map };
    }, [data?.content]);

    function handleRefresh(e: React.MouseEvent) {
        e.stopPropagation();
        queryClient.invalidateQueries({ queryKey });
    }

    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
            <button
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    'flex w-full cursor-pointer items-center gap-2 px-4 py-3 transition-colors duration-150',
                    'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    open && 'border-b border-border'
                )}
                aria-expanded={open}
            >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50">
                    <Path weight="fill" className="size-3.5 text-primary-500" />
                </div>
                <span className="flex-1 text-left text-sm font-semibold text-neutral-700">
                    {t('header.title')}
                </span>
                {totalCount !== undefined && totalCount > 0 && (
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-600">
                        {totalCount}
                    </span>
                )}
                <button
                    onClick={handleRefresh}
                    className="flex size-5 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-muted"
                    title={t('header.refresh')}
                    aria-label={t('header.refreshAria')}
                >
                    <ArrowsClockwise
                        weight="bold"
                        className={cn(
                            'size-3.5 text-muted-foreground',
                            isFetching && 'animate-spin'
                        )}
                    />
                </button>
                {open ? (
                    <CaretUp weight="bold" className="size-3.5 text-muted-foreground" />
                ) : (
                    <CaretDown weight="bold" className="size-3.5 text-muted-foreground" />
                )}
            </button>

            {open && (
                <div className="p-4">
                    {!userId && (
                        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 py-6 text-center">
                            <Path weight="duotone" className="size-7 text-muted-foreground/40" />
                            <p className="text-xs text-muted-foreground">{t('noProfileLinked')}</p>
                        </div>
                    )}

                    {userId && isLoading && <SkeletonRows />}

                    {userId && isError && (
                        <div className="flex flex-col items-center gap-2 rounded-lg border border-danger-200 bg-danger-50/50 py-5 text-center">
                            <p className="text-xs font-medium text-danger-600">
                                {t('errorState.title')}
                            </p>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setPage(0)}
                            >
                                {t('errorState.retry')}
                            </MyButton>
                        </div>
                    )}

                    {userId && !isLoading && !isError && data && (
                        <>
                            {visibleEvents.length === 0 ? (
                                <EmptyState />
                            ) : (
                                <div>
                                    {visibleEvents.map((event, idx) => (
                                        <EventRow
                                            key={event.id}
                                            event={event}
                                            isLast={idx === visibleEvents.length - 1 && data.last}
                                            userId={userId ?? ''}
                                            linkedNotes={
                                                event.action_type === 'CALL_MADE' &&
                                                typeof event.metadata?.call_log_id === 'string'
                                                    ? notesByCallLogId[
                                                          event.metadata.call_log_id as string
                                                      ] ?? []
                                                    : []
                                            }
                                            actionConfig={actionConfig}
                                        />
                                    ))}

                                    {data.totalPages > 1 && (
                                        <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
                                            <span className="text-xs text-muted-foreground">
                                                {t('pagination.pageOf', {
                                                    current: page + 1,
                                                    total: data.totalPages,
                                                })}
                                            </span>
                                            <div className="flex gap-1.5">
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() =>
                                                        setPage((p) => Math.max(0, p - 1))
                                                    }
                                                    disabled={page === 0}
                                                >
                                                    {t('pagination.prev')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() =>
                                                        setPage((p) =>
                                                            Math.min(data.totalPages - 1, p + 1)
                                                        )
                                                    }
                                                    disabled={page >= data.totalPages - 1}
                                                >
                                                    {t('pagination.next')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
