import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { counsellorDisplayName } from './counsellor-display';
import { format } from 'date-fns';
import {
    Phone,
    Robot,
    Clock,
    Plus,
    UserPlus,
    ArrowsClockwise,
    NotePencil,
    CaretUp,
    CaretDown,
    CaretUpDown,
    Repeat,
} from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, parseHtmlToString } from '@/lib/utils';
import type { LeadProfileSummary } from '@/hooks/use-lead-profiles';
import type { LatestNoteEvent } from '@/hooks/use-latest-notes-batch';
import { LeadStatusSelect } from '@/components/shared/lead-status-select';
import { SlaDeadlineCell } from '@/components/shared/sla-deadline-cell';
import { TatStatusBadge } from '@/components/shared/tat-status-badge';
import { DuplicateBadge } from '@/components/shared/duplicate-badge';
import { useLeadDedupSettings } from '@/hooks/use-lead-dedup-settings';
import type { LeadStatus as LeadStatusCatalogItem } from '@/hooks/use-lead-statuses';
import type { LeadCardVM } from './lead-view-model';
import { truncateName } from './lead-view-model';
import type { LeadActionHandlers, LeadTier } from './lead-actions';
import { LeadAvatar } from './lead-avatar';
import { LeadInlineSelect, useLeadTierOptions } from './lead-inline-select';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { orderColumnIds } from './use-lead-column-prefs';
import { LeadSourcePill } from './lead-source-pill';
import { LeadScoreBar } from './lead-score-bar';
import { LeadConversionBadge } from './lead-conversion-badge';
import { LeadEmptyState } from './lead-empty-state';
import { CallPickerPopover } from './call-picker-popover';
import { LeadActionsMenu } from './lead-actions-menu';

/**
 * LeadTable — the premium Orbitra-style leads table: light sentence-case headers,
 * airy rows, avatar + name + relative-time, contact, a
 * neutral source pill, an editable custom-status chip, lead-score bar, editable
 * tier pill, TAT / follow-up SLA deadlines, counsellor owner, a compact activity
 * line, and round mail/call/⋯ row actions revealed on hover. Purpose-built (the
 * platform MyTable can't reproduce this look) but assembled from platform
 * primitives + tokens so it stays on the design system.
 */

/** Per-user activity-notes summary (latest events + total count). */
export interface LeadNotesSummary {
    recent: LatestNoteEvent[];
    count: number;
}

/**
 * Sort keys the backend's lead-list/recent-leads endpoints understand.
 *
 * LAST_ACTIVITY sorts by the newest timeline event on the lead — the very feed the
 * Activity column renders — and LAST_CALLED by the newest telephony_call_log entry,
 * so "who have I not touched in a while" is one click on the column header.
 */
export type LeadSortKey =
    | 'SUBMITTED_AT'
    | 'LEAD_SCORE'
    | 'LEAD_TIER'
    | 'STATUS'
    | 'LAST_ACTIVITY'
    | 'LAST_CALLED';
export type LeadSortDirection = 'ASC' | 'DESC';

interface LeadTableProps {
    vms: LeadCardVM[];
    profiles: Record<string, LeadProfileSummary>;
    /** Per-user activity notes, keyed by user id (for the Activity column). */
    notes?: Record<string, LeadNotesSummary>;
    /** Institute's custom lead-status catalog (ids + colours for the status chip). */
    statuses?: LeadStatusCatalogItem[];
    showOps: boolean;
    showScore?: boolean;
    isLoading: boolean;
    actions: LeadActionHandlers;
    /** Called after an inline status change so the parent can refetch. */
    onStatusUpdated?: () => void;
    hiddenColumns?: Set<string>;
    /**
     * Column ids in the order the user dragged them (from useColumnOrderPrefs). Ids the
     * table does not have are ignored and ids it has but the order does not mention keep
     * their natural slot, so a newly shipped column never disappears for someone who
     * reordered before it existed.
     */
    columnOrder?: string[];
    emptyState?: ReactNode;
    /** Surface-specific trailing columns (e.g. the Follow-ups page's inline
     *  "Mark complete" action). Cells are interactive — clicks don't bubble
     *  to the row's open-side-view handler. */
    extraColumns?: LeadTableExtraColumn[];
    /** Enables a leading checkbox column for multi-select (bulk actions). */
    selectable?: boolean;
    /**
     * Selected lead RESPONSE ids (selection is keyed on vm.responseId).
     *
     * Keyed per response, not per user: a row IS one campaign response, and the same person can
     * hold several — keying on userId collapsed those into one checkbox, so ticking one of a
     * person's rows silently ticked them all. Bulk actions that operate per-person (assign) must
     * therefore de-duplicate userIds from the selection themselves.
     */
    selectedIds?: Set<string>;
    /** Toggle a single row. Only fired for rows with both a userId and a responseId. */
    onToggleRow?: (responseId: string, vm: LeadCardVM) => void;
    /** Toggle all selectable rows currently rendered. */
    onToggleAll?: (checked: boolean, selectableVms: LeadCardVM[]) => void;
    /** Server-driven column sort. Omit to render headers as non-interactive (unsorted). */
    sortBy?: LeadSortKey | null;
    sortDirection?: LeadSortDirection | null;
    /** Fired with the clicked column's sort key + the direction it should switch to. */
    onSortChange?: (sortBy: LeadSortKey, sortDirection: LeadSortDirection) => void;
}

/** Shape of a caller-supplied trailing column. */
export interface LeadTableExtraColumn {
    id: string;
    header: string;
    thClass?: string;
    render: (vm: LeadCardVM, profile?: LeadProfileSummary) => ReactNode;
}

interface Col {
    id: string;
    header: string;
    thClass?: string;
    show: boolean;
    /** Stops a cell click from bubbling to the row's open-side-view handler. */
    interactive?: boolean;
    /** When set, the header becomes clickable and sorts the backend query by this key. */
    sortKey?: LeadSortKey;
    render: (vm: LeadCardVM, profile?: LeadProfileSummary) => ReactNode;
}

const relativeTime = (iso?: string | null) => {
    if (!iso) return '';
    // Backend serialises every Timestamp as a bare ISO string with NO timezone
    // marker (the raw DB wall-clock value). The convention here is to treat that
    // value as UTC and convert to the browser's local timezone for display, so
    // an IST user sees the right wall-clock for a row stored in UTC.
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(iso);
    const normalized = hasTimezone ? iso : `${iso.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return '';
    // Always show an absolute date + clock — never "X hours ago" or "Today at …" —
    // so the lead-name subtitle / activity timestamp are unambiguous at a glance.
    // Year suffix only when it differs from today (e.g. "12 Aug 2025, 4:30 PM").
    const isCurrentYear = d.getFullYear() === new Date().getFullYear();
    return format(d, isCurrentYear ? 'd MMM, h:mm a' : 'd MMM yyyy, h:mm a');
};

/** Compact, premium one-line activity cell (latest note + add affordance). */
function ActivityCell({ summary, onAdd }: { summary?: LeadNotesSummary; onAdd: () => void }) {
    const latest = summary?.recent?.[0];
    if (!latest) {
        return (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onAdd();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 transition-colors hover:border-primary-300 hover:text-primary-600"
            >
                <Plus className="size-3.5" />
                Add note
            </button>
        );
    }
    // Notes may be rich text (HTML) — show a clean plain-text preview so the
    // counsellor reads the actual note, not just the generic "Note" label.
    const raw = latest.description ?? '';
    const body = (/<\/?[a-z][^>]*>/i.test(raw) ? parseHtmlToString(raw) : raw).trim();
    const text = body || latest.title;
    return (
        <div className="min-w-0">
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="group/note block w-full rounded text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                        title="Click to view the full note"
                    >
                        <p className="line-clamp-2 text-sm text-neutral-700 group-hover/note:text-primary-700">
                            {text}
                        </p>
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-96 max-w-md p-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header — author + meta */}
                    <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
                        <LeadAvatar name={latest.actor_name ?? 'A'} size="sm" />
                        <div className="min-w-0 flex-1">
                            <p
                                className="truncate text-sm font-semibold text-neutral-900"
                                title={latest.actor_name ?? 'Unknown'}
                            >
                                {latest.actor_name || 'Unknown'}
                            </p>
                            <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                                <span className="inline-flex items-center gap-1">
                                    <NotePencil weight="fill" className="size-3 text-neutral-400" />
                                    {latest.title || 'Note'}
                                </span>
                                <span className="text-neutral-300">·</span>
                                <span>{relativeTime(latest.created_at)}</span>
                            </p>
                        </div>
                    </div>
                    {/* Body */}
                    <div className="max-h-72 overflow-y-auto px-4 py-3">
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-800">
                            {text}
                        </p>
                    </div>
                </PopoverContent>
            </Popover>
            <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-neutral-400">
                    {relativeTime(latest.created_at)}
                </span>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onAdd();
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 opacity-0 transition focus-within:opacity-100 hover:border-primary-300 hover:text-primary-600 group-hover/row:opacity-100"
                >
                    <Plus className="size-3" />
                    Add note
                </button>
            </div>
        </div>
    );
}

export function LeadTable({
    vms,
    profiles,
    notes,
    statuses,
    showOps,
    showScore = false,
    isLoading,
    actions,
    onStatusUpdated,
    hiddenColumns,
    columnOrder,
    emptyState,
    extraColumns,
    selectable = false,
    selectedIds,
    onToggleRow,
    onToggleAll,
    sortBy,
    sortDirection,
    onSortChange,
}: LeadTableProps) {
    const { t: tPages } = useTranslation('crmPages');
    const profOf = (vm: LeadCardVM) => (vm.userId ? profiles[vm.userId] : undefined);
    const notesOf = (vm: LeadCardVM) => (vm.userId ? notes?.[vm.userId] : undefined);
    // Institute tier catalog (labels, colours, score bands) + the institute's own
    // names for "Tier" / "Lead status" (e.g. "Interest Level" / "Action Label").
    const tierCatalog = useLeadTiers();
    const tierOptions = useLeadTierOptions();
    const terminology = useLeadTerminology();
    // Lead Settings → Deduplication → repeat lead → "Duplicate badge" switch, or "Show
    // duplicates only in Duplicate Leads", which badges the lead a hidden duplicate repeats.
    const dedupReattempt = useLeadDedupSettings().settings.repeatLead.reattempt;
    const showDuplicateBadge = dedupReattempt.showBadge || dedupReattempt.duplicatesTabOnly;

    // Rows that can participate in bulk selection. Needs a user id (assign targets a person)
    // AND a response id (that's the selection key, and what delete targets). response_id is the
    // audience_response primary key so it's always present on a lead row; the check is a guard,
    // not a narrowing — the selectable set is the same rows as before.
    const selectableVms = vms.filter((v) => !!v.userId && !!v.responseId);
    const allSelected =
        selectableVms.length > 0 && selectableVms.every((v) => selectedIds?.has(v.responseId!));

    // Contact cell: phone first and bold, call / AI call as small bordered
    // buttons (always visible), email as the grey sub-line. Same data and actions.
    const renderContact = (vm: LeadCardVM) => {
        const showEmail = vm.email !== '-' && vm.email !== vm.name;
        const showPhone = vm.phone !== '-';
        if (!showEmail && !showPhone) return <span className="text-sm text-neutral-300">—</span>;
        const callGate = actions.onCallLead && actions.canCall ? actions.canCall(vm) : null;
        const aiGateFn = actions.canAiCall ?? actions.canCall;
        const aiGate = actions.onAiCallLead && aiGateFn ? aiGateFn(vm) : null;
        const iconBtn =
            'inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 transition';
        return (
            <div className="min-w-0">
                {showPhone && (
                    <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold tabular-nums text-neutral-800">
                            {vm.phone}
                        </span>
                        {callGate && (
                            <CallPickerPopover
                                leadUserId={vm.userId}
                                disabled={!callGate.allowed}
                                disabledReason={callGate.reason}
                                onConfirm={(preferredNumberId) =>
                                    actions.onCallLead?.(vm, preferredNumberId)
                                }
                                trigger={
                                    <button
                                        type="button"
                                        onClick={(e) => e.stopPropagation()}
                                        disabled={!callGate.allowed}
                                        title={
                                            callGate.allowed
                                                ? tPages('leadCard.callTitle')
                                                : callGate.reason ?? tPages('leadCard.callTitle')
                                        }
                                        aria-label={tPages('leadCard.callTitle')}
                                        className={cn(
                                            iconBtn,
                                            callGate.allowed
                                                ? 'hover:border-success-300 hover:text-success-600'
                                                : 'cursor-not-allowed opacity-50'
                                        )}
                                    >
                                        <Phone weight="fill" className="size-3.5" />
                                    </button>
                                }
                            />
                        )}
                        {aiGate && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (aiGate.allowed) actions.onAiCallLead?.(vm);
                                }}
                                disabled={!aiGate.allowed}
                                title={
                                    aiGate.allowed
                                        ? tPages('leadCard.aiTitle')
                                        : aiGate.reason ?? tPages('leadCard.aiTitle')
                                }
                                aria-label={tPages('leadCard.aiTitle')}
                                className={cn(
                                    iconBtn,
                                    aiGate.allowed
                                        ? 'hover:border-primary-300 hover:text-primary-600'
                                        : 'cursor-not-allowed opacity-50'
                                )}
                            >
                                <Robot weight="fill" className="size-3.5" />
                            </button>
                        )}
                    </div>
                )}
                {showEmail && (
                    <p className="mt-0.5 truncate text-neutral-500" title={vm.email}>
                        <span className="text-caption">{vm.email}</span>
                    </p>
                )}
            </div>
        );
    };

    const allCols: Col[] = [
        {
            id: 'select',
            header: '',
            thClass: 'w-10',
            show: selectable,
            interactive: true,
            render: (vm) =>
                vm.userId && vm.responseId ? (
                    <Checkbox
                        checked={!!selectedIds?.has(vm.responseId)}
                        onCheckedChange={() => onToggleRow?.(vm.responseId!, vm)}
                        aria-label={`Select ${vm.name}`}
                    />
                ) : (
                    <span className="text-neutral-300">—</span>
                ),
        },
        {
            id: 'name',
            header: 'Lead name',
            thClass: 'min-w-56',
            show: true,
            render: (vm, profile) => (
                <div className="flex items-center gap-2.5">
                    <LeadAvatar name={vm.name} size="md" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    actions.onOpenDetails(vm);
                                }}
                                className="min-w-0 truncate text-left text-sm font-semibold text-neutral-900 hover:text-primary-600"
                                title={vm.name}
                            >
                                {truncateName(vm.name)}
                            </button>
                            {showDuplicateBadge && (
                                <DuplicateBadge
                                    isDuplicate={vm.isDuplicate}
                                    duplicateCount={vm.duplicateCount}
                                    className="shrink-0"
                                />
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {vm.submittedIso && (
                                <span className="flex items-center gap-1 text-xs text-neutral-400">
                                    <Clock className="size-3 shrink-0" />
                                    {relativeTime(vm.submittedIso)}
                                </span>
                            )}
                            <LeadConversionBadge conversionStatus={profile?.conversion_status} />
                            <TatStatusBadge
                                tatOverdue={vm.tatOverdue}
                                tatDueSoon={vm.tatDueSoon}
                                followUpOverdue={vm.followUpOverdue}
                            />
                            {vm.followUpPriority && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700">
                                    <Repeat className="size-3" />
                                    Reattempt
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ),
        },
        {
            id: 'contact',
            header: 'Contact',
            thClass: 'min-w-48',
            show: true,
            interactive: true,
            render: (vm) => renderContact(vm),
        },
        {
            id: 'source',
            header: terminology.leadSource,
            thClass: 'min-w-32',
            show: true,
            render: (vm) => <LeadSourcePill label={vm.audience} />,
        },
        {
            // The channel the audience itself belongs to (audience.campaign_type).
            // Sits beside Lead source because that column shows the audience LIST —
            // one channel holds many lists, and institutes read them together.
            id: 'campaignType',
            header: terminology.campaignType,
            thClass: 'min-w-32',
            show: true,
            render: (vm) => (
                <LeadSourcePill
                    label={vm.campaignType}
                    className="bg-primary-50 text-primary-500"
                />
            ),
        },
        {
            // The UTM campaign the lead was tagged with. Separate from the audience's
            // campaign type: that is the channel the LIST belongs to, this is the ad
            // campaign the individual lead arrived on.
            id: 'utmCampaign',
            header: 'UTM campaign',
            thClass: 'min-w-32',
            show: true,
            render: (vm) => (
                <LeadSourcePill label={vm.utmCampaign} className="bg-neutral-50 text-neutral-500" />
            ),
        },
        {
            id: 'status',
            header: terminology.leadStatus,
            thClass: 'w-40',
            show: showOps,
            interactive: true,
            sortKey: 'STATUS',
            render: (vm) => (
                <LeadStatusSelect
                    responseId={vm.responseId}
                    currentStatus={vm.leadStatus}
                    statuses={statuses ?? []}
                    onUpdated={onStatusUpdated}
                    caret
                />
            ),
        },
        {
            id: 'score',
            header: 'Lead score',
            thClass: 'w-44',
            show: showScore,
            interactive: true,
            sortKey: 'LEAD_SCORE',
            render: (vm, profile) => {
                if (!vm.userId || profile?.best_score == null)
                    return <span className="text-sm text-neutral-300">—</span>;
                return <LeadScoreBar score={profile.best_score} />;
            },
        },
        {
            id: 'tier',
            header: terminology.tier,
            thClass: 'w-28',
            show: showOps,
            interactive: true,
            sortKey: 'LEAD_TIER',
            render: (vm, profile) => {
                if (!vm.userId) return <span className="text-sm text-neutral-300">—</span>;
                // Explicit override wins, else the institute's score bands.
                const resolvedTier = tierCatalog.resolve(profile?.lead_tier, profile?.best_score);
                return (
                    <LeadInlineSelect
                        value={resolvedTier ?? undefined}
                        options={tierOptions}
                        placeholder={`Set ${terminology.tier.toLowerCase()}`}
                        onChange={(t) => actions.onSetTier?.(vm.userId!, vm.name, t as LeadTier)}
                    />
                );
            },
        },
        {
            id: 'reachout',
            header: 'Reach out in',
            thClass: 'min-w-36',
            show: showOps,
            render: (vm) => (
                <SlaDeadlineCell
                    mode="response"
                    dueAt={vm.tatDueAt}
                    overdue={vm.tatOverdue}
                    respondedAt={vm.firstResponseAt}
                    baselineAt={vm.submittedIso}
                    responseId={vm.responseId}
                    dueOverridden={vm.tatDueOverridden}
                    closed={vm.slaClosed}
                />
            ),
        },
        {
            id: 'followup',
            header: 'Follow up at',
            thClass: 'min-w-36',
            show: showOps,
            render: (vm) => (
                <SlaDeadlineCell
                    dueAt={vm.followUpDueAt}
                    overdue={vm.followUpOverdue}
                    closed={vm.slaClosed}
                />
            ),
        },
        {
            id: 'owner',
            header: 'Lead owner',
            thClass: 'min-w-44',
            show: showOps,
            interactive: true,
            render: (vm, profile) => {
                if (!vm.userId) return <span className="text-sm text-neutral-300">—</span>;
                const owner = counsellorDisplayName(profile);
                if (!owner) {
                    return (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                actions.onAssignCounsellor?.(vm.userId!, vm.name);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 transition-colors hover:border-primary-300 hover:text-primary-600"
                        >
                            <UserPlus className="size-3.5" />
                            Assign
                        </button>
                    );
                }
                return (
                    <div className="flex items-center gap-2">
                        <LeadAvatar name={owner} size="sm" />
                        <span
                            className="min-w-0 flex-1 truncate text-sm text-neutral-800"
                            title={owner}
                        >
                            {owner}
                        </span>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                actions.onAssignCounsellor?.(vm.userId!, vm.name);
                            }}
                            title="Reassign counsellor"
                            aria-label="Reassign counsellor"
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-400 opacity-0 transition focus-within:opacity-100 hover:bg-primary-50 hover:text-primary-600 group-hover/row:opacity-100"
                        >
                            <ArrowsClockwise className="size-4" />
                        </button>
                    </div>
                );
            },
        },
        {
            id: 'activity',
            header: 'Activity',
            thClass: 'min-w-56',
            show: showOps,
            // Sortable even though the cell text is hydrated client-side per page:
            // the ORDER BY runs server-side on the same timeline feed the preview
            // comes from, so the ordering is over ALL matching leads, not just the
            // page the notes batch happens to have loaded.
            sortKey: 'LAST_ACTIVITY',
            interactive: true,
            render: (vm) =>
                vm.userId ? (
                    <ActivityCell
                        summary={notesOf(vm)}
                        onAdd={() => actions.onAddNote?.(vm.userId!, vm.name, vm.responseId)}
                    />
                ) : (
                    <span className="text-sm text-neutral-300">—</span>
                ),
        },
        {
            id: 'submitted',
            header: 'Submitted',
            thClass: 'min-w-32',
            show: true,
            sortKey: 'SUBMITTED_AT',
            render: (vm) => (
                <span className="whitespace-nowrap text-sm text-neutral-600">
                    {vm.submittedIso
                        ? format(new Date(vm.submittedIso), 'MMM d, yyyy')
                        : vm.submittedDisplay}
                </span>
            ),
        },
    ];

    // Caller-supplied trailing columns render after the built-ins, always
    // interactive so their controls don't trigger the row's open handler.
    for (const extra of extraColumns ?? []) {
        allCols.push({ ...extra, show: true, interactive: true });
    }
    // A ⋮ row menu at the end — the same actions as the board card.
    allCols.push({
        id: 'rowMenu',
        header: '',
        thClass: 'w-12',
        show: true,
        interactive: true,
        render: (vm, profile) => (
            <LeadActionsMenu
                vm={vm}
                currentTier={profile?.lead_tier}
                currentStatus={vm.leadStatus}
                showOps={showOps}
                actions={actions}
            />
        ),
    });

    const visible = allCols.filter((c) => c.show && !hiddenColumns?.has(c.id));
    const cols = columnOrder?.length
        ? orderColumnIds(
              visible.map((c) => c.id),
              columnOrder
          )
              .map((id) => visible.find((c) => c.id === id))
              .filter((c): c is Col => !!c)
        : visible;

    const handleSortClick = (key: LeadSortKey) => {
        if (!onSortChange) return;
        const nextDirection: LeadSortDirection =
            sortBy === key && sortDirection === 'ASC' ? 'DESC' : 'ASC';
        onSortChange(key, nextDirection);
    };

    if (!isLoading && vms.length === 0) {
        return <>{emptyState ?? <LeadEmptyState />}</>;
    }

    return (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr className={cn('border-b border-neutral-200 text-left', 'bg-neutral-50')}>
                        {cols.map((c) => (
                            <th
                                key={c.id}
                                className={cn(
                                    'whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-500',
                                    c.id === 'select' &&
                                        cn('sticky left-0 z-20 !px-2', 'bg-neutral-50'),
                                    c.id === 'name' &&
                                        cn(
                                            'sticky z-20 border-r border-neutral-200',
                                            'bg-neutral-50',
                                            selectable ? 'left-10' : 'left-0'
                                        ),
                                    c.thClass
                                )}
                            >
                                {c.id === 'select' ? (
                                    <Checkbox
                                        checked={allSelected}
                                        disabled={selectableVms.length === 0}
                                        onCheckedChange={(checked) =>
                                            onToggleAll?.(checked === true, selectableVms)
                                        }
                                        aria-label="Select all"
                                    />
                                ) : c.sortKey && onSortChange ? (
                                    <button
                                        type="button"
                                        onClick={() => handleSortClick(c.sortKey!)}
                                        className="group/sort inline-flex items-center gap-1 hover:text-primary-700"
                                        aria-label={`Sort by ${c.header}`}
                                    >
                                        {c.header}
                                        {sortBy === c.sortKey ? (
                                            sortDirection === 'ASC' ? (
                                                <CaretUp
                                                    className="size-3.5 text-primary-600"
                                                    weight="bold"
                                                />
                                            ) : (
                                                <CaretDown
                                                    className="size-3.5 text-primary-600"
                                                    weight="bold"
                                                />
                                            )
                                        ) : (
                                            <CaretUpDown className="size-3.5 text-neutral-400 opacity-60 group-hover/sort:opacity-100" />
                                        )}
                                    </button>
                                ) : (
                                    c.header
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                    {isLoading
                        ? Array.from({ length: 8 }).map((_, i) => (
                              <tr key={i}>
                                  {cols.map((c) => (
                                      <td
                                          key={c.id}
                                          className={cn(
                                              'border-r border-neutral-100 px-4 py-3.5 last:border-r-0',
                                              c.id === 'select' &&
                                                  'sticky left-0 z-10 bg-white !px-2',
                                              c.id === 'name' &&
                                                  cn(
                                                      'sticky z-10 border-r border-neutral-200 bg-white',
                                                      selectable ? 'left-10' : 'left-0'
                                                  )
                                          )}
                                      >
                                          <Skeleton className="h-6 w-40" />
                                      </td>
                                  ))}
                              </tr>
                          ))
                        : vms.map((vm) => {
                              const profile = profOf(vm);
                              return (
                                  <tr
                                      key={vm.key}
                                      onClick={() => actions.onOpenDetails(vm)}
                                      className="group/row cursor-pointer transition-colors hover:bg-neutral-50"
                                  >
                                      {cols.map((c) => (
                                          <td
                                              key={c.id}
                                              className={cn(
                                                  'px-3 py-2.5 align-middle',
                                                  c.id === 'select' &&
                                                      'sticky left-0 z-10 bg-white !px-2 group-hover/row:bg-neutral-50',
                                                  c.id === 'name' &&
                                                      cn(
                                                          'sticky z-10 border-r border-neutral-200 bg-white group-hover/row:bg-neutral-50',
                                                          selectable ? 'left-10' : 'left-0'
                                                      )
                                              )}
                                              onClick={
                                                  c.interactive
                                                      ? (e) => e.stopPropagation()
                                                      : undefined
                                              }
                                          >
                                              {c.render(vm, profile)}
                                          </td>
                                      ))}
                                  </tr>
                              );
                          })}
                </tbody>
            </table>
        </div>
    );
}
