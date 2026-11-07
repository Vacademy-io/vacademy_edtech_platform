import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Medal, Trophy, Copy, ShareNetwork, Users, CaretRight } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import { isLibraryToken } from '@/routes/settings/-constants/badge-library';
import { getCourseLeaderboardAdmin, type LeaderboardEntry } from '@/services/leaderboard';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/** Per-place accent tones (gold / silver / bronze) — design tokens only. */
const PLACE = {
    1: { ring: 'ring-warning-400', chip: 'bg-warning-100 text-warning-700', bar: 'h-12' },
    2: { ring: 'ring-neutral-300', chip: 'bg-neutral-100 text-neutral-500', bar: 'h-9' },
    3: { ring: 'ring-warning-600', chip: 'bg-warning-50 text-warning-700', bar: 'h-7' },
} as const;

function initials(name: string) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Avatar({ name, className }: { name: string; className?: string }) {
    return (
        <div
            className={cn(
                'flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-bold text-primary-600',
                className
            )}
        >
            {initials(name)}
        </div>
    );
}

/** Up to 3 earned badge icons + an overflow count. */
function BadgeIcons({
    entry,
    size = 20,
    className,
}: {
    entry: LeaderboardEntry;
    size?: number;
    className?: string;
}) {
    const shown = entry.badges?.slice(0, 3) ?? [];
    if (entry.badgeCount <= 0) return null;
    return (
        <span className={cn('inline-flex items-center gap-1', className)}>
            {shown.map((b, i) => (
                <span key={i} title={b.name} className="inline-flex">
                    <BadgeVisual icon={b.icon} size={size} className="text-warning-600" />
                </span>
            ))}
            {entry.badgeCount > shown.length && (
                <span className="text-caption font-semibold text-warning-600">
                    +{entry.badgeCount - shown.length}
                </span>
            )}
        </span>
    );
}

/** A single badge at a readable size — library art or icon, with its name. */
function BadgeCell({ badge }: { badge: { name: string; icon: string } }) {
    const isLib = isLibraryToken(badge.icon);
    return (
        <div className="flex w-24 flex-col items-center gap-1.5" title={badge.name}>
            <span
                className={cn(
                    'flex items-center justify-center',
                    isLib ? 'size-24' : 'size-20 rounded-full bg-primary-50'
                )}
            >
                <BadgeVisual
                    icon={badge.icon}
                    size={isLib ? 88 : 44}
                    className={isLib ? undefined : 'text-primary-500'}
                />
            </span>
            <span className="w-full text-center text-caption font-medium leading-tight text-neutral-700">
                {badge.name}
            </span>
        </div>
    );
}

/** Popup: a learner's earned badges at full size (opened by clicking a leaderboard row). */
function EntryBadgesDialog({
    entry,
    onClose,
}: {
    entry: LeaderboardEntry | null;
    onClose: () => void;
}) {
    return (
        <Dialog open={Boolean(entry)} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Trophy weight="fill" className="size-5 text-warning-500" />
                        {entry?.name ? `${entry.name}'s badges` : 'Badges'}
                    </DialogTitle>
                </DialogHeader>
                {entry && entry.badges?.length > 0 ? (
                    <div className="flex flex-wrap justify-center gap-3 py-2">
                        {entry.badges.map((b, i) => (
                            <BadgeCell key={i} badge={b} />
                        ))}
                    </div>
                ) : (
                    <p className="py-6 text-center text-caption text-muted-foreground">
                        No badges earned yet.
                    </p>
                )}
            </DialogContent>
        </Dialog>
    );
}

function PodiumSpot({
    entry,
    place,
    onClick,
}: {
    entry?: LeaderboardEntry;
    place: 1 | 2 | 3;
    onClick?: () => void;
}) {
    if (!entry) return <div className="flex-1" />;
    const first = place === 1;
    const tone = PLACE[place];
    const clickable = Boolean(onClick) && entry.badgeCount > 0;
    return (
        <div
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? onClick : undefined}
            onKeyDown={
                clickable
                    ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onClick?.();
                          }
                      }
                    : undefined
            }
            title={clickable ? 'View badges' : undefined}
            className={cn(
                'flex flex-1 flex-col items-center justify-end gap-1',
                clickable && 'cursor-pointer'
            )}
        >
            {first ? (
                <Crown weight="fill" className="size-5 text-warning-500" />
            ) : (
                <Medal
                    weight="fill"
                    className={cn('size-4', place === 2 ? 'text-neutral-400' : 'text-warning-700')}
                />
            )}
            <div className="relative">
                <Avatar
                    name={entry.name}
                    className={cn('ring-4', first ? 'size-14 text-body' : 'size-11 text-caption', tone.ring)}
                />
                <span
                    className={cn(
                        'absolute -bottom-1 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full text-caption font-black shadow-sm',
                        tone.chip
                    )}
                >
                    {place}
                </span>
            </div>
            <p className="mt-1 w-full truncate px-1 text-center text-caption font-semibold text-neutral-700">
                {entry.name}
            </p>
            <p className="text-caption font-bold tabular-nums text-primary-600">{entry.points} pts</p>
            {entry.badgeCount > 0 && (
                <span className="flex items-center justify-center rounded-full bg-warning-50 px-2 py-1 ring-1 ring-warning-100">
                    <BadgeIcons entry={entry} size={first ? 28 : 24} />
                </span>
            )}
            <div className={cn('mt-1 w-full rounded-t-lg bg-primary-50', tone.bar)} />
        </div>
    );
}

function Row({ entry, onClick }: { entry: LeaderboardEntry; onClick?: () => void }) {
    const clickable = Boolean(onClick) && entry.badgeCount > 0;
    return (
        <div
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? onClick : undefined}
            onKeyDown={
                clickable
                    ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onClick?.();
                          }
                      }
                    : undefined
            }
            title={clickable ? 'View badges' : undefined}
            className={cn(
                'flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-50',
                clickable && 'cursor-pointer'
            )}
        >
            <span className="w-6 text-center text-caption font-bold tabular-nums text-neutral-400">
                {entry.rank ?? '–'}
            </span>
            <Avatar name={entry.name} className="size-8 text-caption" />
            <span className="flex-1 truncate text-body font-medium text-neutral-700">
                {entry.name}
            </span>
            <BadgeIcons entry={entry} size={22} />
            <span className="w-16 text-right text-body font-bold tabular-nums text-neutral-700">
                {entry.points}
                <span className="ml-0.5 text-caption font-normal text-neutral-400">pts</span>
            </span>
            {clickable && <CaretRight className="size-3.5 shrink-0 text-neutral-300" />}
        </div>
    );
}

interface LeaderboardShareDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    packageSessionId: string | null;
    batchName?: string;
    /** Public, white-labelled URL for this batch's leaderboard. */
    shareUrl: string;
}

/** Preview a batch's leaderboard (podium + list), then copy/share its public link. */
export function LeaderboardShareDialog({
    open,
    onOpenChange,
    packageSessionId,
    batchName,
    shareUrl,
}: LeaderboardShareDialogProps) {
    const { data, isLoading } = useQuery({
        queryKey: ['chat-course-leaderboard', packageSessionId],
        queryFn: () => getCourseLeaderboardAdmin(packageSessionId as string),
        enabled: open && Boolean(packageSessionId),
        staleTime: 60 * 1000,
    });

    const entries = data?.entries ?? [];
    const top3 = entries.slice(0, 3);
    const rest = entries.slice(3);
    const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);
    const openBadges = (entry: LeaderboardEntry) =>
        entry.badgeCount > 0 ? setSelectedEntry(entry) : undefined;

    const handleCopy = () => {
        if (!shareUrl) return;
        navigator.clipboard.writeText(shareUrl);
        toast.success('Public leaderboard link copied');
    };
    const handleShare = () => {
        if (!shareUrl) return;
        if (typeof navigator !== 'undefined' && navigator.share) {
            navigator
                .share({
                    title: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Leaderboard`,
                    url: shareUrl,
                })
                .catch(() => {});
        } else {
            handleCopy();
        }
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
                {/* Branded header */}
                <div className="bg-gradient-to-br from-primary-500 to-primary-400 px-6 py-5 text-white">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white">
                            <Crown weight="fill" className="size-5" />
                            {getTerminology(ContentTerms.Course, SystemTerms.Course)} Leaderboard
                        </DialogTitle>
                    </DialogHeader>
                    <p className="mt-1 flex items-center gap-1.5 text-caption text-white/85">
                        <span className="truncate">{batchName || 'This batch'}</span>
                        {data && (
                            <span className="inline-flex shrink-0 items-center gap-1">
                                · <Users className="size-3.5" />
                                {data.totalLearners} learners
                            </span>
                        )}
                    </p>
                </div>

                {/* Body */}
                <div className="max-h-96 overflow-y-auto px-5 py-4">
                    {isLoading ? (
                        <p className="py-8 text-center text-caption text-muted-foreground">
                            Loading leaderboard…
                        </p>
                    ) : entries.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                            <div className="grid size-12 place-items-center rounded-full bg-primary-50">
                                <Trophy weight="fill" className="size-6 text-primary-300" />
                            </div>
                            <p className="text-body font-semibold text-neutral-700">No rankings yet</p>
                            <p className="max-w-xs text-caption text-muted-foreground">
                                Learners climb the ranks as they study, attend live classes, and earn badges.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Podium: 2 · 1 · 3 */}
                            <div className="mb-3 flex items-end gap-2 rounded-lg bg-gradient-to-b from-primary-50 to-white p-3">
                                <PodiumSpot entry={top3[1]} place={2} onClick={() => top3[1] && openBadges(top3[1])} />
                                <PodiumSpot entry={top3[0]} place={1} onClick={() => top3[0] && openBadges(top3[0])} />
                                <PodiumSpot entry={top3[2]} place={3} onClick={() => top3[2] && openBadges(top3[2])} />
                            </div>

                            {rest.length > 0 && (
                                <div className="flex flex-col gap-0.5">
                                    {rest.map((entry, i) => (
                                        <Row key={i} entry={entry} onClick={() => openBadges(entry)} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-2 border-t border-neutral-100 px-5 py-3">
                    <p className="flex-1 text-caption text-muted-foreground">
                        Share the public, anonymized leaderboard.
                    </p>
                    <MyButton buttonType="secondary" scale="small" onClick={handleCopy} className="gap-1.5">
                        <Copy className="size-4" />
                        Copy link
                    </MyButton>
                    <MyButton buttonType="primary" scale="small" onClick={handleShare} className="gap-1.5">
                        <ShareNetwork className="size-4" />
                        Share
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
        <EntryBadgesDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        </>
    );
}
