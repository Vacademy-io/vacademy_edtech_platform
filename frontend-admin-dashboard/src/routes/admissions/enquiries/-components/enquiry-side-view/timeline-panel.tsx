import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    handleFetchTimelineEvents,
    createTimelineEvent,
    timelineQueryKeys,
    type TimelineEvent,
    type CreateTimelineEventPayload,
} from '../../../-services/timeline-services';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { parseHtmlToString } from '@/lib/utils';
import DOMPurify from 'dompurify';
import { CallRecordingInput } from '@/components/shared/lead-calls/CallRecordingInput';
import { CallRecordingPlayer } from '@/components/shared/lead-calls/CallRecordingPlayer';
import {
    type CallActivity,
    callActivityToMetadata,
    callActivityFromMetadata,
    isCallActivityEmpty,
    stripCallMetadata,
} from '@/components/shared/lead-calls/call-activity';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
    NotePencil,
    ArrowsClockwise,
    User,
    ClipboardText,
    ArrowRight,
    Phone,
    EnvelopeSimple,
    CurrencyCircleDollar,
    Buildings,
    PushPin,
    CalendarCheck,
    GitMerge,
    WhatsappLogo,
    Repeat,
} from '@phosphor-icons/react';

// ─── Action Type Icons & Colors ──────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: ReactNode; color: string; bgColor: string }> = {
    // ── New creatable types ──
    NOTE: {
        icon: <NotePencil weight="fill" className="size-4" />,
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
    },
    CALL_LOG: {
        icon: <Phone weight="fill" className="size-4" />,
        color: 'text-teal-600',
        bgColor: 'bg-teal-100',
    },
    FOLLOW_UP: {
        icon: <CalendarCheck weight="fill" className="size-4" />,
        color: 'text-violet-600',
        bgColor: 'bg-violet-100',
    },
    MEETING: {
        icon: <Buildings weight="fill" className="size-4" />,
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
    },
    // ── Legacy types (display only — backward compat) ──
    NOTE_ADDED: {
        icon: <NotePencil weight="fill" className="size-4" />,
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
    },
    STATUS_CHANGE: {
        icon: <ArrowsClockwise weight="fill" className="size-4" />,
        color: 'text-amber-600',
        bgColor: 'bg-amber-100',
    },
    COUNSELOR_ASSIGNED: {
        icon: <User weight="fill" className="size-4" />,
        color: 'text-purple-600',
        bgColor: 'bg-purple-100',
    },
    APPLICATION_SUBMITTED: {
        icon: <ClipboardText weight="fill" className="size-4" />,
        color: 'text-green-600',
        bgColor: 'bg-green-100',
    },
    APPLICATION_TRANSITIONED: {
        icon: <ArrowRight weight="bold" className="size-4" />,
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-100',
    },
    PHONE_CALL: {
        icon: <Phone weight="fill" className="size-4" />,
        color: 'text-teal-600',
        bgColor: 'bg-teal-100',
    },
    EMAIL_SENT: {
        icon: <EnvelopeSimple weight="fill" className="size-4" />,
        color: 'text-sky-600',
        bgColor: 'bg-sky-100',
    },
    PAYMENT_SUCCESS: {
        icon: <CurrencyCircleDollar weight="fill" className="size-4" />,
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-100',
    },
    CAMPUS_VISIT: {
        icon: <Buildings weight="fill" className="size-4" />,
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
    },
    DUPLICATE_MERGED: {
        icon: <GitMerge weight="fill" className="size-4" />,
        color: 'text-neutral-600',
        bgColor: 'bg-neutral-100',
    },
    // An existing lead contacted us again through a WhatsApp chatbot flow — no new lead created.
    RE_ENQUIRY: {
        icon: <WhatsappLogo weight="fill" className="size-4" />,
        color: 'text-info-600',
        bgColor: 'bg-info-100',
    },
    // An existing lead enquired again through a form, ad or list (repeat-lead handling).
    REATTEMPT: {
        icon: <Repeat weight="fill" className="size-4" />,
        color: 'text-warning-600',
        bgColor: 'bg-warning-100',
    },
    DEFAULT: {
        icon: <PushPin weight="fill" className="size-4" />,
        color: 'text-neutral-600',
        bgColor: 'bg-neutral-100',
    },
};

const DEFAULT_CONFIG = {
    icon: <PushPin weight="fill" className="size-4" />,
    color: 'text-neutral-600',
    bgColor: 'bg-neutral-100',
};

const getActionConfig = (actionType: string): { icon: ReactNode; color: string; bgColor: string } =>
    ACTION_CONFIG[actionType] ?? DEFAULT_CONFIG;

// ─── Note Action Types ───────────────────────────────────────────────────────

const buildNoteActionTypes = (t: TFunction) => [
    {
        value: 'NOTE',
        label: t('addNote.actionTypes.note'),
        icon: <NotePencil weight="fill" className="size-3.5" />,
    },
    {
        value: 'CALL_LOG',
        label: t('addNote.actionTypes.callLog'),
        icon: <Phone weight="fill" className="size-3.5" />,
    },
    {
        value: 'FOLLOW_UP',
        label: t('addNote.actionTypes.followUp'),
        icon: <CalendarCheck weight="fill" className="size-3.5" />,
    },
    {
        value: 'MEETING',
        label: t('addNote.actionTypes.meeting'),
        icon: <Buildings weight="fill" className="size-3.5" />,
    },
];

// ─── Timeline Event Item ─────────────────────────────────────────────────────

export const TimelineEventItem = ({ event }: { event: TimelineEvent }) => {
    const { t } = useTranslation('admissionsTimelinePanel');
    const config = getActionConfig(event.action_type);
    const [isTextExpanded, setIsTextExpanded] = useState(false);

    const formatTime = (dateStr: string) => {
        try {
            return format(new Date(dateStr), 'd MMM yyyy, h:mm a');
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="group relative flex gap-3 pb-6 last:pb-0">
            {/* Vertical line connector */}
            <div className="absolute -bottom-0 start-4 top-9 w-px bg-neutral-200 group-last:hidden" />

            {/* Icon circle */}
            <div
                className={`z-10 flex size-9 shrink-0 items-center justify-center rounded-full text-sm ${config.bgColor} ${config.color}`}
            >
                {config.icon}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-medium leading-tight text-neutral-800">
                        {event.title}
                    </h4>
                    <span className="shrink-0 text-caption font-medium tabular-nums text-neutral-400">
                        {formatTime(event.created_at)}
                    </span>
                </div>

                {event.description &&
                    (() => {
                        // Notes created with the rich text editor are HTML; legacy notes
                        // are plain text. Render HTML safely, but keep plain-text line
                        // breaks for older notes. Length checks use the rendered text.
                        const isHtml = /<\/?[a-z][^>]*>/i.test(event.description);
                        const plain = isHtml
                            ? parseHtmlToString(event.description).trim()
                            : event.description.trim();
                        const isLong = plain.length > 100;
                        const showFull = isTextExpanded || !isLong;
                        return (
                            <div className="mt-1">
                                {showFull && isHtml ? (
                                    <div
                                        className="break-words text-sm leading-relaxed text-neutral-600 [&_a]:text-primary-600 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-200 [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0.5 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                                        dangerouslySetInnerHTML={{
                                            __html: DOMPurify.sanitize(event.description),
                                        }}
                                    />
                                ) : (
                                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-600">
                                        {showFull ? plain : `${plain.slice(0, 100).trim()}...`}
                                    </p>
                                )}
                                {isLong && (
                                    <button
                                        onClick={() => setIsTextExpanded(!isTextExpanded)}
                                        className="mt-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary-700 hover:underline"
                                    >
                                        {isTextExpanded ? t('event.viewLess') : t('event.viewMore')}
                                    </button>
                                )}
                            </div>
                        );
                    })()}

                {/* Actor info */}
                {event.actor_name && (
                    <p className="mt-1.5 text-caption text-neutral-400">
                        {t('event.actorPrefix')}{' '}
                        <span className="font-medium text-neutral-500">{event.actor_name}</span>
                    </p>
                )}

                {/* Call recording + details (Call Log) */}
                {(() => {
                    const call = callActivityFromMetadata(event.metadata);
                    return call ? <CallRecordingPlayer call={call} /> : null;
                })()}

                {/* Metadata badges (call-activity keys rendered above instead) */}
                {(() => {
                    const otherMeta = stripCallMetadata(event.metadata);
                    const entries = Object.entries(otherMeta);
                    if (entries.length === 0) return null;
                    return (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {entries.map(([key, value]) => (
                                <span
                                    key={key}
                                    className="inline-flex items-center gap-1 rounded-md border border-neutral-100 bg-neutral-50 px-2 py-0.5 text-caption text-neutral-500"
                                >
                                    <span className="font-medium text-neutral-600">
                                        {key.replace(/_/g, ' ')}:
                                    </span>
                                    {String(value)}
                                </span>
                            ))}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

// ─── Add Note Form ───────────────────────────────────────────────────────────

interface AddNoteFormProps {
    entityType: 'ENQUIRY' | 'APPLICANT';
    entityId: string;
}

const AddNoteForm = ({ entityType, entityId }: AddNoteFormProps) => {
    const { t } = useTranslation('admissionsTimelinePanel');
    const [noteText, setNoteText] = useState('');
    const [actionType, setActionType] = useState('NOTE');
    const [isExpanded, setIsExpanded] = useState(false);
    const [callActivity, setCallActivity] = useState<CallActivity | null>(null);
    const queryClient = useQueryClient();

    const noteActionTypes = buildNoteActionTypes(t);

    const createMutation = useMutation({
        mutationFn: createTimelineEvent,
        onSuccess: () => {
            toast.success(t('addNote.toast.success'));
            setNoteText('');
            setCallActivity(null);
            setIsExpanded(false);
            queryClient.invalidateQueries({
                queryKey: timelineQueryKeys.events(entityType, entityId),
            });
        },
        onError: () => {
            toast.error(t('addNote.toast.error'));
        },
    });

    // The rich text editor emits HTML, so check the rendered text (not the markup)
    // to know whether the note is actually empty.
    const isNoteEmpty = !parseHtmlToString(noteText).trim();

    // For Call Log, a recording / call details alone are enough to submit.
    const callMeta =
        actionType === 'CALL_LOG' && !isCallActivityEmpty(callActivity)
            ? callActivityToMetadata(callActivity as CallActivity)
            : undefined;
    const canSubmit = !isNoteEmpty || callMeta !== undefined;

    const handleSubmit = () => {
        if (!canSubmit) {
            toast.warning(t('addNote.toast.emptyWarning'));
            return;
        }

        const actionLabel =
            noteActionTypes.find((noteType) => noteType.value === actionType)?.label ||
            t('addNote.actionTypes.note');

        const payload: CreateTimelineEventPayload = {
            type: entityType,
            type_id: entityId,
            action_type: actionType,
            title: `${actionLabel}`,
            description: noteText.trim(),
            metadata: callMeta,
        };

        createMutation.mutate(payload);
    };

    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="flex w-full items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-3 text-sm text-neutral-500 transition-all duration-200 hover:border-primary-300 hover:bg-primary-50/30 hover:text-primary-600"
            >
                <svg
                    className="size-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('addNote.collapsedPlaceholder')}
            </button>
        );
    }

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
            {/* Action type selector */}
            <div className="mb-2 flex items-center gap-1.5">
                {noteActionTypes.map((type) => (
                    <button
                        key={type.value}
                        onClick={() => setActionType(type.value)}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all
                            ${
                                actionType === type.value
                                    ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300'
                                    : 'bg-neutral-50 text-neutral-500 hover:bg-neutral-100'
                            }`}
                    >
                        {type.icon}
                        {type.label}
                    </button>
                ))}
            </div>

            {/* Note input — rich text editor with formatting toolbar */}
            <div
                className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-800 focus-within:border-primary-300 focus-within:bg-white focus-within:ring-1 focus-within:ring-primary-300 [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2"
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleSubmit();
                    }
                }}
            >
                <RichTextEditor
                    value={noteText}
                    onChange={setNoteText}
                    placeholder={t('addNote.notePlaceholder')}
                    minHeight={64}
                    minimalToolbar
                />
            </div>

            {/* Call recording (Call Log only) */}
            {actionType === 'CALL_LOG' && (
                <CallRecordingInput value={callActivity} onChange={setCallActivity} />
            )}

            {/* Actions */}
            <div className="mt-2 flex items-center justify-between">
                <span className="text-caption text-neutral-400">{t('addNote.submitHint')}</span>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-3 text-xs text-neutral-500"
                        onClick={() => {
                            setIsExpanded(false);
                            setNoteText('');
                            setCallActivity(null);
                        }}
                    >
                        {t('addNote.cancel')}
                    </Button>
                    <Button
                        size="sm"
                        className="h-7 bg-primary-500 px-3 text-xs text-white hover:bg-primary-600"
                        onClick={handleSubmit}
                        disabled={createMutation.isPending || !canSubmit}
                    >
                        {createMutation.isPending ? t('addNote.submitting') : t('addNote.submit')}
                    </Button>
                </div>
            </div>
        </div>
    );
};

// ─── Main Timeline Panel ─────────────────────────────────────────────────────

interface TimelinePanelProps {
    entityType: 'ENQUIRY' | 'APPLICANT';
    entityId: string;
}

export const TimelinePanel = ({ entityType, entityId }: TimelinePanelProps) => {
    const { t } = useTranslation('admissionsTimelinePanel');
    const [page, setPage] = useState(0);
    const pageSize = 5;

    const { data, isLoading, error } = useQuery(
        handleFetchTimelineEvents(entityType, entityId, page, pageSize)
    );
    return (
        <div className="flex flex-col gap-4">
            {/* Section Header */}
            <div className="flex items-center gap-2">
                <div className="h-3.5 w-1 rounded-full bg-primary-500" />
                <h4 className="text-sm font-semibold text-neutral-700">{t('header.title')}</h4>
                {data?.totalElements !== undefined && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-neutral-500">
                        {data.totalElements}
                    </span>
                )}
            </div>

            {/* Add Note Form */}
            <AddNoteForm entityType={entityType} entityId={entityId} />

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-8">
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
                        <div className="size-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                        {t('loading')}
                    </div>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                    {t('error')}
                </div>
            )}

            {/* Events List */}
            {data && data.content.length > 0 && (
                <div className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
                    {data.content.map((event) => (
                        <TimelineEventItem key={event.id} event={event} />
                    ))}

                    {/* Pagination */}
                    {data.totalPages > 1 && (
                        <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
                            <span className="text-caption text-neutral-400">
                                {t('pagination.pageInfo', {
                                    current: page + 1,
                                    total: data.totalPages,
                                })}
                            </span>
                            <div className="flex gap-1.5">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 px-2 text-caption"
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                >
                                    {t('pagination.previous')}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 px-2 text-caption"
                                    onClick={() =>
                                        setPage((p) => Math.min(data.totalPages - 1, p + 1))
                                    }
                                    disabled={page >= data.totalPages - 1}
                                >
                                    {t('pagination.next')}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Empty State */}
            {data && data.content.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-8 text-center">
                    <ClipboardText weight="fill" className="size-8 text-neutral-400" />
                    <p className="text-sm font-medium text-neutral-500">{t('empty.title')}</p>
                    <p className="text-xs text-neutral-400">{t('empty.description')}</p>
                </div>
            )}
        </div>
    );
};
