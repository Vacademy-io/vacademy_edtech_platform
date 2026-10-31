/**
 * Shared presentation for the live-session list cards (live/upcoming, past, draft).
 *
 * The three cards used to repeat the same shell class string and each grew its
 * own ragged "Label: value" metadata row, so the same session read differently
 * depending on which tab you were on. Everything here is presentation only — no
 * fetching, no navigation, no knowledge of which kind of session it is drawing.
 *
 * Note the cards no longer carry their own vertical margin: the list that
 * renders them already uses `space-y-*`, and `my-6` on top of that was what
 * made the gaps between cards uneven.
 */
import { useState } from 'react';
import { GlobeHemisphereWest, LockSimple, User, Users } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Outer card surface. `cardRef` is forwarded so callers can keep their
 *  "did this click really land inside the card" guard against portalled
 *  dialogs re-bubbling through the React tree. */
export function SessionCardShell({
    children,
    className,
    onClick,
    cardRef,
}: {
    children: React.ReactNode;
    className?: string;
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
    cardRef?: React.RefObject<HTMLDivElement>;
}) {
    return (
        <div
            ref={cardRef}
            onClick={onClick}
            className={cn(
                'flex cursor-pointer flex-col gap-3.5 rounded-xl border border-neutral-200 bg-white p-4 transition-all',
                'hover:border-primary-200 hover:shadow-md sm:p-5',
                className
            )}
        >
            {children}
        </div>
    );
}

/**
 * Title block. `actions` (the ⋮ menu, buttons) is wrapped in its own
 * stopPropagation boundary so callers never have to remember to add one —
 * forgetting it is how the QR download button ended up navigating away from
 * the list instead of downloading.
 */
export function SessionCardHeading({
    title,
    subtitle,
    badge,
    actions,
}: {
    title: string;
    subtitle?: string | null;
    badge?: React.ReactNode;
    actions?: React.ReactNode;
}) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
                <h3
                    className="truncate text-base font-semibold text-neutral-900 sm:text-lg"
                    title={title}
                >
                    {title}
                </h3>
                {subtitle ? (
                    <p className="mt-0.5 truncate text-sm text-neutral-500" title={subtitle}>
                        {subtitle}
                    </p>
                ) : null}
            </div>
            {badge || actions ? (
                <div
                    className="flex shrink-0 items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                >
                    {badge}
                    {actions}
                </div>
            ) : null}
        </div>
    );
}

/** private → neutral lock, anything else (public) → branded globe. */
export function AccessBadge({ accessLevel }: { accessLevel?: string | null }) {
    if (!accessLevel) return null;
    const isPrivate = accessLevel.toLowerCase() === 'private';
    return (
        <Badge
            className={cn(
                'gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-none',
                isPrivate
                    ? 'border-neutral-200 bg-neutral-100 text-neutral-600 hover:bg-neutral-100'
                    : 'border-primary-200 bg-primary-50 text-primary-500 hover:bg-primary-50'
            )}
        >
            {isPrivate ? (
                <LockSimple size={12} weight="fill" />
            ) : (
                <GlobeHemisphereWest size={12} weight="fill" />
            )}
            <span className="capitalize">{accessLevel}</span>
        </Badge>
    );
}

/**
 * Icon tints for the metadata row.
 *
 * A fact keeps the same colour on every tab, so a card can be read by shape as
 * well as by text — all-grey glyphs made the row scan as one undifferentiated
 * block. Tokens only; nothing here is a literal colour.
 */
export type MetaTone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger';

const META_TONE: Record<MetaTone, string> = {
    neutral: 'text-neutral-500',
    primary: 'text-primary-500',
    info: 'text-info-500',
    success: 'text-success-600',
    warning: 'text-warning-600',
    danger: 'text-danger-500',
};

/** Horizontal run of {@link SessionMetaItem}s; wraps on narrow viewports. */
export function SessionMetaRow({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex flex-wrap items-start gap-x-6 gap-y-3 sm:gap-x-8', className)}>
            {children}
        </div>
    );
}

/**
 * One piece of session metadata. With `label` it stacks (caption above value,
 * like the mock's "Meeting Type / Once"); without it, it reads as a single
 * icon + value line.
 */
export function SessionMetaItem({
    icon,
    label,
    value,
    tone = 'neutral',
}: {
    icon: React.ReactNode;
    label?: string;
    value: React.ReactNode;
    tone?: MetaTone;
}) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <span className={cn('shrink-0', META_TONE[tone])}>{icon}</span>
            <div className="min-w-0 leading-tight">
                {label ? (
                    <div className="text-xs text-neutral-500">
                        {label}
                    </div>
                ) : null}
                <div className={cn('truncate text-sm text-neutral-700', label && 'mt-0.5')}>
                    {value}
                </div>
            </div>
        </div>
    );
}

/**
 * Batch chips with a "+N more" toggle.
 *
 * The previous cards did `batches.join(', ')` into a single line, which on a
 * session with four batches overflowed the card and pushed everything else out
 * of alignment. Here the overflow is explicit and expandable in place.
 */
export function SessionBatches({
    batches,
    label,
    maxVisible = 2,
    moreLabel,
    lessLabel,
    tone = 'info',
}: {
    batches: string[];
    /** Terminology-aware word for "Batches". */
    label: string;
    maxVisible?: number;
    /** e.g. "+{{count}} more" */
    moreLabel: (count: number) => string;
    lessLabel: string;
    tone?: MetaTone;
}) {
    const [expanded, setExpanded] = useState(false);
    if (!batches.length) return null;

    const hiddenCount = Math.max(batches.length - maxVisible, 0);
    const toggle = 'rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-500 transition-colors hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300';
    const onToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded((v) => !v);
    };

    return (
        <div className="flex min-w-0 items-start gap-2">
            <Users size={16} className={cn('mt-0.5 shrink-0', META_TONE[tone])} />
            <div className="min-w-0">
                <div className="text-xs text-neutral-500">
                    {label} ({batches.length})
                </div>
                {expanded ? (
                    /* Expanded has to actually reveal the names. Keeping the
                       collapsed single `truncate`d line here meant "+N more"
                       swapped one ellipsis for another and showed nothing new —
                       one name per line is the whole point of opening it. */
                    <>
                        <ul className="mt-1 space-y-1">
                            {batches.map((name, i) => (
                                <li
                                    key={`${name}-${i}`}
                                    className="break-words text-sm text-neutral-700"
                                >
                                    {name}
                                </li>
                            ))}
                        </ul>
                        <button type="button" className={cn(toggle, 'mt-2')} onClick={onToggle}>
                            {lessLabel}
                        </button>
                    </>
                ) : (
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm text-neutral-700" title={batches.join(', ')}>
                            {batches.slice(0, maxVisible).join(', ')}
                        </span>
                        {hiddenCount > 0 ? (
                            <button type="button" className={toggle} onClick={onToggle}>
                                {moreLabel(hiddenCount)}
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Whether a session has anyone on it at all. Callers need this to decide
 *  whether to draw the separator that would otherwise dangle next to a
 *  {@link SessionTeacher} that rendered nothing. */
export function hasAssignedTeacher(
    instructors?: Array<{ user_id: string }> | null
): boolean {
    return (instructors ?? []).length > 0;
}

/**
 * "Who is taking this class", beside the batches on a card.
 *
 * Two visible states — nobody assigned draws nothing at all, because a row of
 * greyed-out "Not assigned" on every card is noise, not information:
 *   named instructor  → photo (or first-letter badge) + name
 *   assigned, unnamed → placeholder + `unknownLabel`, never a raw user id
 *   none at all       → null
 *
 * The unnamed case still renders: somebody IS on the session and the directory
 * could not name them, which is a real problem worth seeing.
 *
 * `avatarUrl` is resolved once for a whole page by the list and handed down, so
 * a page of ten sessions costs one batched lookup instead of ten.
 */
export function SessionTeacher({
    instructors,
    label,
    unassignedLabel,
    unknownLabel,
    avatarUrlByFileId,
}: {
    instructors?: Array<{
        user_id: string;
        full_name?: string | null;
        profile_pic_file_id?: string | null;
    }> | null;
    /** Terminology-aware word for "Teacher". */
    label: string;
    /** Unused once nobody-assigned renders nothing; kept so callers do not all
     *  have to change, and so the decision is documented at the call site. */
    unassignedLabel?: string;
    /** Shown when someone is assigned but the directory could not name them. */
    unknownLabel: string;
    avatarUrlByFileId?: Record<string, string>;
}) {
    const assigned = instructors ?? [];
    if (!assigned.length) return null;

    const named = assigned.filter((i) => !!i?.full_name?.trim());
    const lead = named[0];
    const leadName = lead?.full_name?.trim() ?? '';

    const avatarUrl = lead?.profile_pic_file_id
        ? avatarUrlByFileId?.[lead.profile_pic_file_id]
        : undefined;
    // First letter of the name, as a fallback badge when there is no photo.
    const firstLetter = leadName.charAt(0).toUpperCase();
    const extra = named.length - 1;

    const displayName = leadName || unknownLabel;

    return (
        <div className="flex min-w-0 items-center gap-2">
            {avatarUrl ? (
                <img
                    src={avatarUrl}
                    alt={leadName}
                    className="size-10 shrink-0 rounded-full object-cover"
                />
            ) : firstLetter ? (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-base font-semibold text-primary-500">
                    {firstLetter}
                </span>
            ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                    <User size={18} />
                </span>
            )}
            <div className="min-w-0 leading-tight">
                <div className="text-xs text-neutral-500">
                    {label}
                </div>
                <div
                    className={cn(
                        'mt-0.5 truncate text-sm',
                        // pr-0.5: an italic glyph overhangs its box, and `truncate`
                        // (overflow-hidden) shaves the last letter without it.
                        leadName
                            ? 'font-semibold text-neutral-900'
                            : 'pr-0.5 italic text-neutral-400'
                    )}
                    title={named.map((i) => i.full_name).join(', ') || displayName}
                >
                    {displayName}
                    {extra > 0 ? <span className="text-neutral-400"> +{extra}</span> : null}
                </div>
            </div>
        </div>
    );
}

/** Hairline group separator, as the design places before "Meeting Type" and
 *  between the teacher and the batches. Hidden on narrow screens, where the
 *  row wraps and a vertical rule would land in the wrong place. */
export function SessionMetaDivider() {
    return <span aria-hidden className="hidden h-8 w-px shrink-0 bg-neutral-200 sm:block" />;
}

/** Divider + action strip along the bottom of a card. */
export function SessionCardFooter({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'flex flex-col gap-3 border-t border-neutral-100 pt-3.5 sm:flex-row sm:items-center sm:justify-between',
                className
            )}
        >
            {children}
        </div>
    );
}
