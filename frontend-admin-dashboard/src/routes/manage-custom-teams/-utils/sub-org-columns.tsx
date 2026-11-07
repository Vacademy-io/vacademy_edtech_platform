import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Copy, DotsThreeVertical, LinkSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { SubOrgListItem } from '../-services/custom-team-services';
import { cn } from '@/lib/utils';
import { formatDate } from './list-export';
import { humanizeStatus, statusToneClass } from './status-display';

/**
 * One column of the Manage VLEs list: how it renders on screen AND what it contributes to
 * the CSV. Keeping both on the same record is the point — "Manage Column" then governs the
 * export as well as the table, and a column can never be added to one and forgotten in the
 * other.
 *
 * A column may map to more than one CSV field (see `name` and `seats`), which is why the
 * headers and values are arrays rather than single cells.
 */
export interface SubOrgColumn {
    id: string;
    label: string;
    /** Identity columns: draggable, but their checkbox renders ticked and disabled. */
    locked?: boolean;
    /** CSV header(s) this column contributes, positionally matched by `csvValues`. */
    csvHeaders: readonly string[];
    csvValues: (org: SubOrgListItem) => unknown[];
    cell: (org: SubOrgListItem) => ReactNode;
    cellClassName?: string;
    /**
     * Natural width in pixels, applied to the header and every cell of this column.
     * Only the columns that genuinely need taming carry one — the rest size to content.
     * A user drag overrides it and is remembered per browser, which is the whole point:
     * a channel partner with a long legal name can be widened until it reads in full.
     */
    defaultWidth?: number;
    /**
     * Extra classes for the header cell. Exists so a numeric column can right-align its
     * heading with its values — a right-aligned "128" under a left-aligned "Learners"
     * reads as two different columns.
     */
    headClassName?: string;
    /**
     * Value this column sorts on. Omit to make the column unsortable — the invite code is a
     * random string, so ordering by it would only ever look like a shuffle.
     *
     * Numbers sort numerically and strings case-insensitively (see compareSubOrgs); blanks
     * always sink to the bottom regardless of direction, so ascending never opens with a
     * screenful of VLEs that have no address.
     */
    sortValue?: (org: SubOrgListItem) => string | number | null | undefined;
}

export type SortDirection = 'asc' | 'desc';

/**
 * Row comparator for one column. Blank values are forced last in BOTH directions: a
 * missing address is absence of data, not a value that belongs at one end of the range,
 * and burying the populated rows under the empty ones is never what the sort was for.
 */
export function compareSubOrgs(
    column: SubOrgColumn,
    direction: SortDirection
): (a: SubOrgListItem, b: SubOrgListItem) => number {
    const read = column.sortValue;
    if (!read) return () => 0;
    const blank = (v: unknown) => v === null || v === undefined || v === '';
    return (a, b) => {
        const av = read(a);
        const bv = read(b);
        if (blank(av) && blank(bv)) return 0;
        if (blank(av)) return 1;
        if (blank(bv)) return -1;
        const order =
            typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
        return direction === 'asc' ? order : -order;
    };
}

/**
 * Off by default. "Created On" was CSV-only before columns became manageable — it is a real
 * column now so the export can stay driven by the layout, but showing it would widen a table
 * that already scrolls. Exported as a module constant so the reference is stable across
 * renders (useLeadColumnPrefs closes over it in resetColumns).
 */
export const DEFAULT_HIDDEN_SUB_ORG_COLUMNS = ['created_at'];

/**
 * Avatar tints, picked by a stable hash of the name so a given VLE keeps the same colour
 * across pages, sorts and reloads. A random or index-based pick would recolour every row
 * the moment the table is re-sorted, which is worse than no colour at all.
 */
const AVATAR_TONES = [
    'bg-primary-100 text-primary-600',
    'bg-info-100 text-info-600',
    'bg-success-100 text-success-600',
    'bg-warning-100 text-warning-700',
];

const avatarTone = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_TONES[hash % AVATAR_TONES.length]!;
};

/**
 * Muted dash used wherever a row has no value for a column. An en dash rather than a
 * hyphen: at 14px a hyphen next to real values reads as a stray mark, and half the columns
 * used to return a bare '-' string that skipped this muted styling entirely.
 */
const Blank = () => <span className="text-muted-foreground">–</span>;

/** Whether the row resolved a root admin — the person "Share credentials" would mail. */
const hasAdmin = (o: SubOrgListItem) => !!(o.admin_user_id || o.admin_email || o.admin_name);

interface BuildSubOrgColumnsArgs {
    t: TFunction;
    /** Institute-configured word for an invite (the column's header). */
    inviteTerm: string;
    /** Resolves a row's full invite URL, for the copy button's tooltip. */
    buildInviteUrl: (org: SubOrgListItem) => string;
    copyInviteLink: (e: React.MouseEvent, org: SubOrgListItem) => void;
    /** Opens a sub-org's detail page — the name cell is the row's keyboard entry point. */
    openSubOrg: (org: SubOrgListItem) => void;
    /**
     * Opens the confirm dialog that re-sends the row's admin their login details. Omit it to
     * leave the item out of the menu — the list does so for roles without canManageTeam,
     * which is what the backend checks before sending.
     */
    shareCredentials?: (org: SubOrgListItem) => void;
}

/** Every column the VLE list can render, in their natural left-to-right order. */
export function buildSubOrgColumns({
    t,
    inviteTerm,
    buildInviteUrl,
    copyInviteLink,
    openSubOrg,
    shareCredentials,
}: BuildSubOrgColumnsArgs): SubOrgColumn[] {
    return [
        {
            id: 'name',
            label: t('columns.name'),
            // A row without its name is unidentifiable, and the CSV would lose the VLE it
            // describes — so this one can be moved but not switched off.
            locked: true,
            // The cell stacks the admin's name under the org name, so the CSV keeps them as
            // two fields rather than flattening one into the other.
            csvHeaders: [t('csv.name'), t('csv.admin')],
            csvValues: (o) => [o.name, o.admin_name],
            sortValue: (o) => o.name,
            defaultWidth: 256,
            cell: (o) => {
                const name = o.name || t('fallback.unknown');
                return (
                    <div className="flex items-center gap-2">
                        <Avatar className="size-8 shrink-0">
                            <AvatarFallback
                                className={cn('text-xs font-semibold', avatarTone(name))}
                            >
                                {String(name).charAt(0).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                            {/*
                              The whole row is clickable for the mouse, but a click handler on
                              a <tr> is unreachable by keyboard — and giving the <tr> a button
                              role would strip its row semantics. So the name is a real button:
                              it lands in the tab order, is announced as a control, and still
                              sits inside a properly-announced table row. stopPropagation keeps
                              the row's own handler from navigating a second time.
                            */}
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openSubOrg(o);
                                }}
                                className="block max-w-full truncate rounded-sm text-left text-sm font-semibold text-neutral-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                // The column is capped so long names truncate rather than
                                // stretch the table, so the full name has to be recoverable.
                                title={name}
                            >
                                {name}
                            </button>
                            {o.admin_name && (
                                <p className="truncate text-xs text-muted-foreground">
                                    {o.admin_name}
                                </p>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            id: 'email',
            label: t('columns.email'),
            csvHeaders: [t('csv.email')],
            csvValues: (o) => [o.admin_email],
            sortValue: (o) => o.admin_email,
            defaultWidth: 176,
            cell: (o) =>
                o.admin_email ? (
                    <span className="block truncate" title={o.admin_email}>
                        {o.admin_email}
                    </span>
                ) : (
                    <Blank />
                ),
        },
        {
            id: 'phone',
            label: t('columns.phone'),
            csvHeaders: [t('csv.phone')],
            csvValues: (o) => [o.admin_phone],
            sortValue: (o) => o.admin_phone,
            cell: (o) =>
                o.admin_phone ? <span className="tabular-nums">{o.admin_phone}</span> : <Blank />,
        },
        {
            id: 'address',
            label: t('columns.address'),
            // 192px rather than the old 320: address is reference data you look up on one
            // row, while the extra 128px was pushing Seats — a number you scan down the
            // whole column — past the right edge.
            defaultWidth: 192,
            csvHeaders: [t('csv.address')],
            csvValues: (o) => [o.address_line],
            sortValue: (o) => o.address_line,
            cell: (o) =>
                o.address_line ? (
                    // Free text with no length ceiling — a live row runs to 87 characters and
                    // would push every column after it off screen. Clamp the cell and put the
                    // whole value in the tooltip; the CSV still carries it in full. The
                    // clamp lives on the column's width (below) rather than this span, so
                    // dragging the header wider actually reveals more of the address.
                    <span className="block truncate" title={o.address_line}>
                        {o.address_line}
                    </span>
                ) : (
                    <Blank />
                ),
        },
        {
            id: 'city',
            label: t('columns.city'),
            csvHeaders: [t('csv.city')],
            csvValues: (o) => [o.city],
            sortValue: (o) => o.city,
            cell: (o) => o.city || <Blank />,
        },
        {
            id: 'state',
            label: t('columns.state'),
            csvHeaders: [t('csv.state')],
            csvValues: (o) => [o.state],
            sortValue: (o) => o.state,
            cell: (o) => o.state || <Blank />,
        },
        {
            id: 'pincode',
            label: t('columns.pincode'),
            csvHeaders: [t('csv.pincode')],
            csvValues: (o) => [o.pincode],
            sortValue: (o) => o.pincode,
            cell: (o) =>
                o.pincode ? <span className="tabular-nums">{o.pincode}</span> : <Blank />,
        },
        {
            id: 'status',
            label: t('columns.status'),
            csvHeaders: [t('csv.status')],
            csvValues: (o) => [o.plan_status ? humanizeStatus(o.plan_status) : ''],
            sortValue: (o) => (o.plan_status ? humanizeStatus(o.plan_status) : ''),
            cell: (o) =>
                o.plan_status ? (
                    <Badge variant="outline" className={statusToneClass(o.plan_status)}>
                        {humanizeStatus(o.plan_status)}
                    </Badge>
                ) : (
                    <Blank />
                ),
        },
        {
            id: 'learners',
            label: t('columns.learners'),
            csvHeaders: [t('csv.learners')],
            csvValues: (o) => [o.learner_count ?? o.used_seats ?? ''],
            sortValue: (o) => o.learner_count ?? o.used_seats,
            cellClassName: 'text-right',
            headClassName: 'text-right',
            cell: (o) => (
                <span className="tabular-nums">{o.learner_count ?? o.used_seats ?? 0}</span>
            ),
        },
        {
            id: 'seats',
            label: t('columns.seats'),
            // Rendered as "used/total" in one cell, but split across two CSV fields so a
            // spreadsheet can sum or sort them.
            csvHeaders: [t('csv.seatsUsed'), t('csv.seatsTotal')],
            csvValues: (o) => [o.used_seats ?? '', o.total_seats ?? ''],
            // Occupancy, not raw seats — "4/1000" is emptier than "9/10".
            sortValue: (o) =>
                o.total_seats ? (o.used_seats ?? 0) / o.total_seats : o.used_seats ?? null,
            cellClassName: 'text-right',
            headClassName: 'text-right',
            // A bare "128/400" makes you do the division. The bar under it answers the only
            // question this column is ever asked — how full is this one — and tints once a
            // partner is close enough to the ceiling to need more seats ordered.
            cell: (o) => {
                if (o.used_seats == null && o.total_seats == null) return <Blank />;
                const used = o.used_seats ?? 0;
                const total = o.total_seats ?? null;
                const pct = total ? Math.min(100, Math.round((used / total) * 100)) : null;
                return (
                    <div className="ml-auto w-20">
                        <p className="tabular-nums">
                            {used}
                            {total != null && (
                                <span className="text-muted-foreground">{`/${total}`}</span>
                            )}
                        </p>
                        {pct != null && (
                            <div
                                className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-100"
                                role="img"
                                aria-label={t('seats.percentUsedAriaLabel', {
                                    count: pct,
                                    percent: pct,
                                })}
                            >
                                {/* eslint-disable-next-line -- the width IS the datum: a
                                    per-row percentage has no Tailwind token, and rounding it
                                    to a fixed scale would hide the difference between 71%
                                    and 89%. Colour and size stay on tokens. */}
                                <div
                                    className={cn(
                                        'h-full rounded-full',
                                        pct >= 90
                                            ? 'bg-danger-500'
                                            : pct >= 70
                                              ? 'bg-warning-500'
                                              : 'bg-success-500'
                                    )}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            id: 'invite',
            label: inviteTerm,
            csvHeaders: [t('csv.inviteCode')],
            csvValues: (o) => [o.invite_code],
            cell: (o) =>
                o.invite_code ? (
                    <button
                        type="button"
                        onClick={(e) => copyInviteLink(e, o)}
                        className="text-primary flex items-center gap-1 text-sm hover:underline"
                        title={buildInviteUrl(o)}
                    >
                        <LinkSimple className="size-3.5" />
                        <span className="w-20 truncate">{o.invite_code}</span>
                        <Copy className="size-3" />
                    </button>
                ) : (
                    <Blank />
                ),
        },
        {
            id: 'created_at',
            label: t('columns.createdOn'),
            csvHeaders: [t('csv.createdOn')],
            csvValues: (o) => [formatDate(o.created_at)],
            // The raw timestamp, so it orders chronologically rather than by "Aug" < "Jul".
            sortValue: (o) => (o.created_at ? new Date(o.created_at).getTime() : null),
            cell: (o) => <span className="text-sm">{formatDate(o.created_at)}</span>,
        },
        {
            id: 'actions',
            label: t('columns.actions'),
            // Locked: hiding the only per-row action surface would strand the row's
            // operations behind nothing at all.
            locked: true,
            // Nothing to export — an "Actions" column in a spreadsheet is a blank strip.
            csvHeaders: [],
            csvValues: () => [],
            cellClassName: 'text-right',
            headClassName: 'text-right',
            cell: (o) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon"
                            className="size-8"
                            // The row navigates on click; the menu must not also fire it.
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t('actions.ariaLabel', {
                                name: o.name || t('actions.thisRow'),
                            })}
                        >
                            <DotsThreeVertical className="size-4" weight="bold" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => openSubOrg(o)}>
                            {t('actions.openDetails')}
                        </DropdownMenuItem>
                        {o.invite_code && (
                            <DropdownMenuItem
                                onSelect={() => navigator.clipboard.writeText(buildInviteUrl(o))}
                            >
                                {t('actions.copyInviteLink')}
                            </DropdownMenuItem>
                        )}
                        {/* Only where there is an admin to send to: a row whose registration
                            never enrolled one would otherwise offer an action that can only
                            fail. Any admin identity counts — the backend resolves the recipient
                            from the mapping row itself, so this must not hinge on the newer
                            admin_user_id field alone (older backends omit it). */}
                        {shareCredentials && hasAdmin(o) && (
                            <DropdownMenuItem onSelect={() => shareCredentials(o)}>
                                {t('actions.shareCredentials')}
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
    ];
}

/** Flat CSV header row for the given columns, in the order they are shown. */
export const subOrgCsvHeaders = (columns: SubOrgColumn[]): string[] =>
    columns.flatMap((c) => [...c.csvHeaders]);

/**
 * One CSV row per VLE, carrying exactly the fields the given columns contribute — so the
 * export always lines up with the header row above, whichever columns are visible.
 */
export const subOrgCsvRows = (columns: SubOrgColumn[], rows: SubOrgListItem[]): unknown[][] =>
    rows.map((org) => columns.flatMap((c) => c.csvValues(org)));
