/**
 * Presentational blocks for the session detail page.
 *
 * Split out of `$sessionId.tsx` (2,400+ lines) so the new layout can be read
 * and tested on its own. Everything here is presentation only — no fetching,
 * no navigation decisions — except the single avatar lookup in
 * {@link AssignedTeacherCard}, which is one call for one person.
 */
import { useEffect, useState } from 'react';
import {
    CalendarBlank,
    CaretRight,
    GlobeHemisphereWest,
    LockSimple,
    Users,
    UsersThree,
    VideoCamera,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getPublicUrl } from '@/services/upload_file';

interface Instructor {
    user_id: string;
    full_name?: string | null;
    email?: string | null;
    profile_pic_file_id?: string | null;
}

interface PackageSessionDetail {
    package_session_id: string;
    package_name: string;
    level_name: string;
    session_name: string;
}

/** Status / access / recurrence chips beside the page title. */
export function SessionStatusChips({
    timeStatus,
    accessType,
    isRecurring,
}: {
    /** 'Live' | 'Upcoming' | 'Past' — already resolved by the caller. */
    timeStatus?: string | null;
    accessType?: string | null;
    isRecurring: boolean;
}) {
    const isPrivate = (accessType ?? '').toLowerCase() === 'private';
    const chip = 'gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-none';

    return (
        <div className="flex flex-wrap items-center gap-2">
            {timeStatus ? (
                <Badge className={cn(chip, 'border-info-200 bg-info-50 text-info-600 hover:bg-info-50')}>
                    <CalendarBlank size={13} weight="fill" />
                    {timeStatus}
                </Badge>
            ) : null}
            {accessType ? (
                <Badge
                    className={cn(
                        chip,
                        isPrivate
                            ? 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-50'
                            : 'border-primary-200 bg-primary-50 text-primary-500 hover:bg-primary-50'
                    )}
                >
                    {isPrivate ? (
                        <LockSimple size={13} weight="fill" />
                    ) : (
                        <GlobeHemisphereWest size={13} weight="fill" />
                    )}
                    <span className="capitalize">{accessType}</span>
                </Badge>
            ) : null}
            <Badge
                className={cn(chip, 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-50')}
            >
                <VideoCamera size={13} weight="fill" />
                {isRecurring ? 'Recurring Session' : 'One-time Session'}
            </Badge>
        </div>
    );
}

/**
 * "Assigned Teacher".
 *
 * The instructor has been on the detail response all along
 * (`GetSessionByIdService` sets it) — this page just never rendered it.
 *
 * The subtitle is the instructor's email rather than a job title: the DTO
 * carries no designation, and inventing one would put a label on screen that
 * nothing in the system can keep true.
 *
 * Renders nothing when nobody is assigned — a card whose whole content is a
 * greyed-out "Not assigned" is noise. Somebody assigned but unnamed still
 * renders, because that is a data problem worth seeing.
 */
export function AssignedTeacherCard({
    instructors,
    label,
    unassignedLabel,
    unknownLabel,
    onClick,
}: {
    instructors?: Instructor[] | null;
    label: string;
    /** Unused now that the unassigned case renders nothing; kept so callers do
     *  not all have to change, and so the decision is visible at the call site. */
    unassignedLabel?: string;
    unknownLabel: string;
    onClick?: () => void;
}) {
    const assigned = instructors ?? [];
    const named = assigned.filter((i) => !!i?.full_name?.trim());
    const lead = named[0];
    const leadName = lead?.full_name?.trim() ?? '';
    const extra = named.length - 1;

    const [avatarUrl, setAvatarUrl] = useState<string>('');
    const fileId = lead?.profile_pic_file_id ?? '';

    useEffect(() => {
        let cancelled = false;
        if (!fileId) {
            setAvatarUrl('');
            return;
        }
        (async () => {
            try {
                const url = await getPublicUrl(fileId);
                if (!cancelled) setAvatarUrl(url || '');
            } catch {
                if (!cancelled) setAvatarUrl('');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [fileId]);

    if (!assigned.length) return null;

    const displayName = leadName || unknownLabel;

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardContent className="p-5">
                <button
                    type="button"
                    onClick={onClick}
                    disabled={!onClick}
                    className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"
                >
                    <span className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                        <span className="flex size-7 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <Users size={15} weight="fill" />
                        </span>
                        {label}
                    </span>
                    {onClick ? <CaretRight size={16} className="text-neutral-400" /> : null}
                </button>

                <div className="mt-4 flex items-center gap-3">
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt={leadName}
                            className="size-12 shrink-0 rounded-full object-cover"
                        />
                    ) : leadName ? (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-lg font-semibold text-primary-500">
                            {leadName.charAt(0).toUpperCase()}
                        </span>
                    ) : (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                            <Users size={20} />
                        </span>
                    )}
                    <div className="min-w-0">
                        <div
                            className={cn(
                                'truncate font-semibold',
                                leadName ? 'text-neutral-900' : 'pr-0.5 italic text-neutral-400'
                            )}
                        >
                            {displayName}
                            {extra > 0 ? (
                                <span className="font-normal text-neutral-400"> +{extra}</span>
                            ) : null}
                        </div>
                        {lead?.email ? (
                            <div className="truncate text-sm text-neutral-500" title={lead.email}>
                                {lead.email}
                            </div>
                        ) : null}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * "Associated Batches" summary — count plus chips, overflow behind a toggle.
 *
 * "+N more" is a button, not a label: it used to be a plain <span>, so on a
 * session with seven batches you could click it all day and never see the other
 * four.
 *
 * Expanding shows every batch and lets the card grow. A capped scroll area was
 * tried and removed: macOS hides overlay scrollbars, so two batches sat below
 * the fold with nothing on screen saying they were there — worse than the
 * unclickable badge it replaced. Height only grows when you ask it to; the
 * collapsed card is what keeps a seven-batch session compact by default.
 */
export function LinkedBatchesCard({
    batches,
    label,
    linkedLabel,
    maxVisible = 3,
    onClick,
}: {
    batches: PackageSessionDetail[];
    label: string;
    /** e.g. "3 batches linked" — already pluralised by the caller. */
    linkedLabel: string;
    maxVisible?: number;
    onClick?: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? batches : batches.slice(0, maxVisible);
    const hidden = batches.length - Math.min(maxVisible, batches.length);
    const toggle =
        'rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-500 transition-colors hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300';

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardContent className="p-5">
                <button
                    type="button"
                    onClick={onClick}
                    disabled={!onClick}
                    className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"
                >
                    <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                            <span className="flex size-7 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                <UsersThree size={15} weight="fill" />
                            </span>
                            {label}
                        </span>
                        <span className="mt-1 block text-sm text-neutral-500">{linkedLabel}</span>
                    </span>
                    {onClick ? (
                        <CaretRight size={16} className="shrink-0 text-neutral-400" />
                    ) : null}
                </button>

                <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-2">
                        {visible.map((b) => (
                            <span
                                key={b.package_session_id}
                                className="max-w-xs truncate rounded-lg bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700"
                                title={`${b.level_name} ${b.package_name}`}
                            >
                                {`${b.level_name} ${b.package_name}`.trim()}
                            </span>
                        ))}
                        {!expanded && hidden > 0 ? (
                            <button type="button" className={toggle} onClick={() => setExpanded(true)}>
                                +{hidden} more
                            </button>
                        ) : null}
                    </div>
                </div>
                {expanded ? (
                    <button
                        type="button"
                        className={cn(toggle, 'mt-2')}
                        onClick={() => setExpanded(false)}
                    >
                        Show less
                    </button>
                ) : null}
            </CardContent>
        </Card>
    );
}

/**
 * Registered / Attended / Attendance-rate tiles.
 *
 * Rate is computed from the same rows the table below renders, so the headline
 * number and the list can never disagree. With nobody registered the rate is 0,
 * not NaN.
 */
export function AttendanceStatTiles({
    registered,
    attended,
    labels,
}: {
    registered: number;
    attended: number;
    labels: { registered: string; attended: string; rate: string; students: string };
}) {
    const rate = registered > 0 ? Math.round((attended / registered) * 100) : 0;

    // h-full + mt-auto bottom-aligns the figure, so a label that wraps to two
    // lines (a long locale, a narrow window) cannot knock the three numbers out
    // of line with each other. break-words is the backstop against a single
    // unbreakable word; nothing here is ever allowed to truncate, because
    // clipping "Attendance Rate" to "Atte…" is worse than an extra line.
    const tile = 'flex h-full flex-col rounded-xl border border-neutral-200 bg-neutral-50/60 p-4';
    const chip = 'flex size-8 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm';
    const caption = 'mt-3 break-words text-sm leading-tight text-neutral-500';
    const figure = 'mt-auto pt-2 text-2xl font-semibold leading-none text-neutral-900';

    return (
        <div className="grid gap-3 sm:grid-cols-3">
            <div className={tile}>
                <span className={cn(chip, 'text-neutral-500')}>
                    <Users size={16} />
                </span>
                <div className={caption}>{labels.registered}</div>
                <div className={figure}>{registered}</div>
                <div className="mt-1 text-xs text-neutral-400">{labels.students}</div>
            </div>

            <div className={tile}>
                <span className={cn(chip, 'text-success-600')}>
                    <Users size={16} weight="fill" />
                </span>
                <div className={caption}>{labels.attended}</div>
                <div className={figure}>{attended}</div>
                <div className="mt-1 text-xs text-neutral-400">{labels.students}</div>
            </div>

            <div className={tile}>
                <span className={cn(chip, 'text-primary-500')}>
                    <UsersThree size={16} weight="fill" />
                </span>
                <div className={caption}>{labels.rate}</div>
                <div className={figure}>{rate}%</div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                    {/* design-lint-ignore: the bar's width IS the datum — a
                        percentage computed at runtime cannot be a static class. */}
                    <div
                        className="h-full rounded-full bg-success-500 transition-all"
                        style={{ width: `${rate}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
