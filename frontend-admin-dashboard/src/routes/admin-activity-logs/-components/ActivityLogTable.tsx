import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type {
    AdminActivityLog,
    AdminActivityLogPage,
} from '@/services/admin-activity-logs/getActivityLogs';

interface Props {
    page: AdminActivityLogPage | undefined;
    isLoading: boolean;
    isError: boolean;
    onRowClick: (log: AdminActivityLog) => void;
    onPageChange: (page: number) => void;
    /** Whether the empty result is the filters' doing or a genuinely empty log. */
    hasActiveFilters: boolean;
    onClearFilters: () => void;
}

// The audit log's actions are free-form strings, so a StatusChip (which renders
// nothing for a status outside its fixed catalog) would leave the column blank.
// A Badge with a tone chosen per action always renders something.
const ACTION_VARIANT: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
    CREATE: 'default',
    ENROLL: 'default',
    ASSIGN: 'default',
    IMPORT: 'default',
    RESTORE: 'default',
    UPDATE: 'secondary',
    STATUS_CHANGE: 'secondary',
    TIER_CHANGE: 'secondary',
    SCORE_CHANGE: 'secondary',
    REASSIGN: 'secondary',
    BULK_UPDATE: 'secondary',
    DELETE: 'destructive',
    CANCEL: 'destructive',
    TERMINATE: 'destructive',
    UNASSIGN: 'destructive',
    REMOVE_MEMBER: 'destructive',
    VOID: 'destructive',
    DELETE_BLOCKED: 'destructive',
    SPLIT: 'secondary',
};

const RESOURCE_LABELS: Record<string, string> = {
    AUDIENCE: 'Audience list',
    LEAD: 'Lead',
    LEAD_STATUS: 'Lead status',
    LEAD_TIER: 'Lead tier',
    LEAD_FOLLOWUP: 'Follow-up',
    LEAD_SLA_CONFIG: 'Lead SLA',
    LEAD_TAT_DEADLINE: 'Lead TAT deadline',
    LEAD_LOOKUP: 'Lead lookup',
    LEAD_CONNECTOR: 'Lead connector',
    ENQUIRY: 'Enquiry',
    COUNSELLOR: 'Counsellor',
    COUNSELLOR_POOL: 'Counsellor pool',
    COUNSELLOR_TARGET: 'Counsellor target',
    COUNSELLOR_WORKBENCH_CONFIG: 'Workbench settings',
    TAG: 'Tag',
    TELEPHONY_CONFIG: 'Calling settings',
    TELEPHONY_NUMBER: 'Calling number',
    ENGAGEMENT_ENGINE: 'Engagement engine',
    AUTOMATION: 'Automation',
    COURSE: 'Course',
    LIVE_SESSION: 'Live session',
    LIVE_SESSION_MATERIAL: 'Class material',
    ENROLL_INVITE: 'Invite link',
    LEARNER: 'Learner',
    GUARDIAN_LINK: 'Guardian link',
    INSTITUTE_SETTING: 'Settings',
    LEARNER_BADGE: 'Learner badge',
    STUDENT_REPORT: 'Progress report',
    ASSESSMENT: 'Assessment',
};

const resourceLabel = (entityType: string): string =>
    RESOURCE_LABELS[entityType] ??
    entityType
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());

const formatAbsoluteTime = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
};

const formatRelativeTime = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
};

// Patterns marking which parts of a description are names worth bolding.
// Capture groups alternate: odd groups are connective text, even groups are
// the names. That lets one sentence highlight more than one subject —
// "enrolled learner |Amit Kumar| in |Physics 201|" bolds learner and course.
// First match wins, so more specific patterns must precede looser ones.
// Falls through to plain text when nothing matches — safe for descriptions
// with no distinct named target ("deleted 3 course(s)", "updated naming
// settings").
const NAMED_DESCRIPTION_PATTERNS: RegExp[] = [
    /^((?:created|updated|deleted) course )(.+)$/i,
    // Assessments (reported by assessment_service).
    /^((?:created|deleted|published) assessment )(.+)$/i,
    /^(updated (?:basic details|sections and questions|participants|access control) of assessment )(.+)$/i,
    /^(edited \d+ questions? of assessment )(.+)$/i,
    /^(created booking )(.+)$/i,
    /^(scheduled live session )(.+)$/i,
    // Class materials / recordings added to course chapters from a live session.
    // Greedy name: split on the LAST " to "/" from ", since titles like
    // "Intro to Algebra" are far more common than such chapter names.
    /^((?:added|removed) (?:class material|recording) )(.+)( (?:to|from) )(.+)$/i,
    /^((?:added|removed) (?:class material|recording) )(.+)$/i,
    /^(renamed (?:class material|recording) )(.+)( to )(.+)$/i,
    // "generated progress report for Anmol Agarwal (2026-04-01 to 2026-09-29)"
    /^(generated progress report for )(.+?)( \(.+\))$/i,

    // Enrollment — with and without a resolved course.
    /^((?:re-)?enrolled learner )(.+?)( in )(.+)$/i,
    /^((?:re-)?enrolled learner )(.+)$/i,
    /^(bulk enrolled learners from CSV into )(.+)$/i,
    /^(enrolled )(.+?)( in )(.+)$/i,

    // Removal from a course.
    /^(terminated )(.+?)( from )(.+)$/i,
    /^(cancelled enrollment of )(.+?)( in )(.+)$/i,
    /^((?:deactivated|reactivated) )(.+?)( in )(.+)$/i,

    // Batch move: "moved X from A to B".
    /^(moved )(.+?)( from )(.+?)( to )(.+)$/i,

    // Status / expiry changes, longest form first.
    /^(changed (?:status|expiry date) of )(.+?)( in )(.+?)( to )(.+)$/i,
    /^(changed (?:status|expiry date) of )(.+?)( in )(.+)$/i,

    // Same actions where the course could not be resolved — still bold the
    // learner(s). Must trail the "in <course>" forms above.
    /^(enrolled )(.+)$/i,
    /^(terminated )(.+)$/i,
    /^(cancelled enrollment of )(.+)$/i,
    /^((?:deactivated|reactivated) )(.+)$/i,

    // ── CRM ──────────────────────────────────────────────────────────
    /^((?:created|updated|deleted) audience )(.+)$/i,
    /^(sent a message to audience )(.+)$/i,
    /^(recalculated lead scores for audience )(.+)$/i,
    /^(imported )(\d+ lead\(s\))( into )(.+)$/i,
    /^(imported )(\d+ lead\(s\))$/i,
    /^((?:added|updated|deleted|restored) lead )(.+)$/i,
    /^(registered walk-in lead )(.+)$/i,
    /^(marked lead )(.+?)( as converted)$/i,
    /^(changed lead (?:status|tier|score) of )(.+?)( to )(.+)$/i,
    /^(assigned lead )(.+?)( to )(.+)$/i,
    /^(unassigned counsellor from lead )(.+)$/i,
    /^((?:assigned|reassigned) )(\d+ lead\(s\))( (?:to|from) )(.+)$/i,
    /^((?:assigned|reassigned) )(\d+ lead\(s\))$/i,
    /^((?:created|updated|deleted) lead status )(.+)$/i,
    /^((?:scheduled|rescheduled|closed) a follow-up for lead )(.+)$/i,
    /^(connected Meta lead form )(.+?)( to audience )(.+)$/i,
    /^(connected Meta lead form )(.+)$/i,
    /^(updated lead connector )(.+)$/i,
    /^((?:created|updated) counsellor pool )(.+)$/i,
    /^((?:added|removed) )(.+?)( (?:to|from) a counsellor pool)$/i,
    /^(changed (?:pool )?status of (?:counsellor )?)(.+?)( to )(.+)$/i,
    /^((?:set|removed) (?:a )?targets? for )(.+)$/i,
    /^((?:created|deleted) tag )(.+)$/i,
    /^(tagged )(\d+ contact\(s\))( with )(.+)$/i,
    /^((?:tagged|removed tags from) )(\d+ contact\(s\))$/i,
    /^((?:created|updated|deleted) automation )(.+)$/i,
    /^(created engagement engine )(.+)$/i,
    /^(changed status of engagement engine )(.+?)( to )(.+)$/i,
    /^((?:paused|resumed) autonomous sending for engagement engine )(.+)$/i,
    /^((?:added|updated) calling number )(.+)$/i,
    /^(changed the status of )(\d+ enquiry\(s\))( to )(.+)$/i,
    /^(changed the status of )(\d+ enquiry\(s\))$/i,

    /^(switched WhatsApp provider to )(.+)$/i,
    /^((?:updated|removed) WhatsApp credentials for )(.+)$/i,

    // ── Invite links ─────────────────────────────────────────────────
    // "made ... the default for <course>" bolds both the invite and the course;
    // it must precede the plain create/update/delete form for the same reason
    // as the payment-plan one below. The bulk delete ("deleted 3 invite
    // link(s)") has no single name and deliberately matches nothing.
    /^(made invite link )(.+?)( the default for )(.+)$/i,
    /^(assigned fee plan to invite link )(.+?)( for )(.+)$/i,
    /^(updated payment plans of invite link )(.+)$/i,
    /^((?:created|updated|deleted) invite link )(.+)$/i,

    // ── Payment plans ────────────────────────────────────────────────
    // "made ... the default" must precede the generic create/update/delete
    // form, which would otherwise swallow the trailing clause into the name.
    /^(made payment plan )(.+?)( the default)$/i,
    /^((?:created|updated|deleted|approved) (?:payment|fee) plan )(.+)$/i,
    /^(updated fee type )(.+)$/i,
];

/**
 * Splits a description into alternating connective / name fragments, or null
 * when no pattern claims it. Exported for the test that pins which parts of
 * each sentence get emphasised — a mis-ordered pattern bolds the wrong half,
 * which is invisible to types and to a passing render.
 */
export const splitDescriptionParts = (description: string): string[] | null => {
    for (const re of NAMED_DESCRIPTION_PATTERNS) {
        const m = description.match(re);
        if (m) return m.slice(1);
    }
    return null;
};

/** The sentence shown for a row when the backend left no description. */
export const fallbackDescription = (
    row: Pick<AdminActivityLog, 'action' | 'entity_type'>
): string => `${row.action.toLowerCase()}d a ${row.entity_type.toLowerCase().replace(/_/g, ' ')}`;

const renderActivitySentence = (row: AdminActivityLog): React.ReactNode => {
    const description =
        row.description && row.description.trim().length > 0
            ? row.description
            : fallbackDescription(row);

    const parts = splitDescriptionParts(description);
    if (!parts) return description;

    // Groups alternate connective / name, starting with connective.
    return (
        <>
            {parts.map((part, i) =>
                i % 2 === 0 ? (
                    <span key={i}>{part}</span>
                ) : (
                    <span key={i} className="font-semibold text-neutral-700">
                        {part}
                    </span>
                )
            )}
        </>
    );
};

const getActorLabel = (row: AdminActivityLog): string =>
    row.actor_name || row.actor_email || row.actor_id || 'Unknown user';

const initialsOf = (label: string): string =>
    label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('') || '?';

const statusTone = (status: number | null | undefined): string => {
    if (status == null) return 'bg-neutral-300';
    if (status >= 200 && status < 300) return 'bg-success-500';
    if (status >= 400 && status < 500) return 'bg-warning-500';
    return 'bg-danger-500';
};

export function ActivityLogTable({
    page,
    isLoading,
    isError,
    onRowClick,
    onPageChange,
    hasActiveFilters,
    onClearFilters,
}: Props) {
    if (isError) {
        return (
            <Card className="flex items-start gap-2 border-danger-200 bg-danger-50 p-4">
                <WarningCircle className="mt-0.5 size-5 shrink-0 text-danger-600" />
                <div>
                    <p className="text-body font-medium text-danger-600">
                        Failed to load activity logs
                    </p>
                    <p className="text-caption text-neutral-600">
                        The request did not complete. Use Refresh to try again.
                    </p>
                </div>
            </Card>
        );
    }

    const rows = page?.content ?? [];
    const currentPage = page?.number ?? 0;
    const totalPages = page?.totalPages ?? 0;
    const totalElements = page?.totalElements ?? 0;
    const pageSize = page?.size ?? 20;

    return (
        <TooltipProvider delayDuration={150}>
            <Card className="overflow-hidden border-neutral-200 shadow-sm">
                {/*
                  The narrow columns never wrap, so the table asks for the width
                  it actually needs and scrolls inside the card when the content
                  column cannot give it — no fixed min-width, which would clip
                  the same columns at 1024px where both sidebars are open. The
                  page body itself never scrolls sideways.
                */}
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                                <TableHead className="w-32 whitespace-nowrap pl-4 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                    When
                                </TableHead>
                                <TableHead className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                    Activity
                                </TableHead>
                                <TableHead className="whitespace-nowrap text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                    Resource
                                </TableHead>
                                <TableHead className="whitespace-nowrap text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                    Action
                                </TableHead>
                                <TableHead className="whitespace-nowrap pr-4 text-right text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                    <Tooltip>
                                        <TooltipTrigger className="inline-flex items-center gap-1">
                                            Latency
                                            <Info className="size-3.5 text-neutral-400" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-xs">
                                            API call wall-time on the server. Includes business
                                            logic + DB writes; excludes the audit-row write itself
                                            (~1–3 ms).
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && rows.length === 0 ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <TableRow key={`skeleton-${i}`}>
                                        <TableCell colSpan={5} className="px-4">
                                            <Skeleton className="h-6 w-full" />
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="py-12">
                                        <EmptyState
                                            hasActiveFilters={hasActiveFilters}
                                            onClearFilters={onClearFilters}
                                        />
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        tabIndex={0}
                                        role="button"
                                        aria-label={`Open details for ${getActorLabel(row)} — ${
                                            row.description ?? row.action
                                        }`}
                                        onClick={() => onRowClick(row)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                onRowClick(row);
                                            }
                                        }}
                                        className="cursor-pointer transition-colors hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                    >
                                        <TableCell className="whitespace-nowrap pl-4 align-top">
                                            <Tooltip>
                                                <TooltipTrigger className="text-caption text-neutral-600">
                                                    {formatRelativeTime(row.created_at)}
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    {formatAbsoluteTime(row.created_at)}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <div className="flex items-start gap-2.5">
                                                <span
                                                    className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500"
                                                    aria-hidden="true"
                                                >
                                                    {initialsOf(getActorLabel(row))}
                                                </span>
                                                <div className="min-w-0 text-body text-neutral-600">
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span
                                                            className={cn(
                                                                'inline-block size-2 shrink-0 rounded-full',
                                                                statusTone(row.response_status)
                                                            )}
                                                            title={
                                                                row.response_status != null
                                                                    ? `HTTP ${row.response_status}`
                                                                    : ''
                                                            }
                                                        />
                                                        <span className="font-semibold text-neutral-700">
                                                            {getActorLabel(row)}
                                                        </span>
                                                    </span>{' '}
                                                    {renderActivitySentence(row)}
                                                    {row.actor_email &&
                                                        row.actor_name &&
                                                        row.actor_email !== row.actor_name && (
                                                            <div className="mt-0.5 text-caption text-neutral-500">
                                                                {row.actor_email}
                                                            </div>
                                                        )}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap align-top">
                                            <span className="inline-block rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
                                                {resourceLabel(row.entity_type)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap align-top">
                                            <Badge
                                                variant={ACTION_VARIANT[row.action] || 'outline'}
                                            >
                                                {row.action.replace(/_/g, ' ')}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap pr-4 text-right align-top text-caption tabular-nums text-neutral-600">
                                            {row.response_time_ms != null
                                                ? `${row.response_time_ms} ms`
                                                : '—'}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {totalElements > 0 && (
                    <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-2.5">
                        <MyPagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            totalElements={totalElements}
                            pageSize={pageSize}
                            onPageChange={onPageChange}
                        />
                    </div>
                )}
            </Card>
        </TooltipProvider>
    );
}

/**
 * An empty table has two very different meanings, and reading "no entries" as
 * "the log is broken" is the easy mistake: either the filters exclude
 * everything, or that resource has genuinely never been recorded — a resource
 * only starts appearing once someone performs that action on a version of the
 * service that audits it. Say which, and offer the one-click way out.
 */
function EmptyState({
    hasActiveFilters,
    onClearFilters,
}: {
    hasActiveFilters: boolean;
    onClearFilters: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 text-center">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                <MagnifyingGlass className="size-5" />
            </span>
            <p className="text-body font-medium text-neutral-700">No audit entries</p>
            {hasActiveFilters ? (
                <>
                    <p className="max-w-md text-caption text-neutral-500">
                        Nothing matches the current filters. A resource shows up here only after
                        someone performs that action — try clearing the filters or widening the date
                        range.
                    </p>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        className="mt-1 sm:!min-w-0"
                        onClick={onClearFilters}
                    >
                        Clear filters
                    </MyButton>
                </>
            ) : (
                <p className="text-caption text-neutral-500">
                    Admin actions across the institute will appear here as they happen.
                </p>
            )}
        </div>
    );
}
