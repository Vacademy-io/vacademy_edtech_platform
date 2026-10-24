import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trophy, Medal, Crown, Users, Buildings, Copy, ShareNetwork, CaretRight } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import { isLibraryToken } from '@/routes/settings/-constants/badge-library';
import {
    getBadgeStats,
    getCourseLeaderboardAdmin,
    getInstituteLeaderboardAdmin,
    type BadgeStat,
    type LeaderboardEntry,
} from '@/services/leaderboard';

const MEDAL_TONE: Record<number, string> = {
    1: 'text-warning-500',
    2: 'text-neutral-400',
    3: 'text-warning-700',
};

function RankCell({ rank }: { rank: number | null }) {
    if (rank != null && rank >= 1 && rank <= 3) {
        return <Medal weight="fill" className={cn('size-5', MEDAL_TONE[rank])} />;
    }
    return (
        <span className="w-6 text-center text-caption font-bold text-neutral-400">{rank ?? '–'}</span>
    );
}

/**
 * Collapse stats rows that share a `badgeId` (the server groups by the snapshot name/icon, so a
 * badge renamed or re-skinned after some awards comes back as several rows and duplicate keys).
 * Counts are summed; the last row's non-empty name/icon wins (the most recently written snapshot).
 */
export function aggregateBadgeStats(rows: BadgeStat[]): BadgeStat[] {
    const byId = new Map<string, BadgeStat>();
    for (const row of rows) {
        const prev = byId.get(row.badgeId);
        if (!prev) {
            byId.set(row.badgeId, { ...row, count: Number(row.count) || 0 });
            continue;
        }
        byId.set(row.badgeId, {
            badgeId: row.badgeId,
            badgeName: row.badgeName || prev.badgeName,
            badgeIcon: row.badgeIcon || prev.badgeIcon,
            count: prev.count + (Number(row.count) || 0),
        });
    }
    return [...byId.values()].sort((a, b) => b.count - a.count);
}

function BadgesStatsPanel() {
    const { t } = useTranslation('studyLibraryLeaderboardReports');
    const { data, isLoading } = useQuery({
        queryKey: ['badge-stats'],
        queryFn: getBadgeStats,
        staleTime: 5 * 60 * 1000,
    });
    const badgeRows = useMemo(() => aggregateBadgeStats(data?.badges ?? []), [data]);

    if (isLoading) {
        return (
            <div className="rounded-lg border border-neutral-200 bg-white p-4 text-caption text-muted-foreground">
                {t('badgesStats.loading')}
            </div>
        );
    }
    if (!data) return null;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
                <Trophy weight="fill" className="size-5 text-primary-500" />
                <h3 className="text-subtitle font-semibold text-neutral-700">{t('badgesStats.heading')}</h3>
            </div>
            <div className="mb-4 flex flex-wrap gap-3">
                <div className="rounded-lg bg-primary-50 px-4 py-2">
                    <p className="text-h3 font-bold text-primary-600">{data.totalAwarded}</p>
                    <p className="text-caption text-neutral-500">{t('badgesStats.totalAwarded')}</p>
                </div>
                <div className="rounded-lg bg-neutral-50 px-4 py-2">
                    <p className="text-h3 font-bold text-neutral-700">{data.learnersWithBadge}</p>
                    <p className="text-caption text-neutral-500">{t('badgesStats.learnersRecognised')}</p>
                </div>
            </div>
            {badgeRows.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {badgeRows.map((b) => (
                        <div key={b.badgeId} className="flex items-center gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50">
                                <BadgeVisual
                                    icon={b.badgeIcon || 'Trophy'}
                                    size={isLibraryToken(b.badgeIcon) ? 28 : 18}
                                    className="text-primary-500"
                                />
                            </div>
                            <span className="flex-1 truncate text-body text-neutral-700">
                                {b.badgeName || b.badgeId}
                            </span>
                            <span className="text-caption font-semibold text-neutral-600">
                                {b.count}
                            </span>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-caption italic text-muted-foreground">{t('badgesStats.noneAwarded')}</p>
            )}
        </div>
    );
}

/** The learner's earned badge icons (up to 3) + an overflow count. */
function BadgeIcons({ entry, size = 22 }: { entry: LeaderboardEntry; size?: number }) {
    const shown = entry.badges?.slice(0, 3) ?? [];
    if (entry.badgeCount <= 0) return null;
    return (
        <span className="inline-flex items-center gap-1">
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
    const { t } = useTranslation('studyLibraryLeaderboardReports');
    return (
        <Dialog open={Boolean(entry)} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Trophy weight="fill" className="size-5 text-warning-500" />
                        {entry?.name
                            ? t('badgesDialog.titleWithName', { name: entry.name })
                            : t('badgesDialog.title')}
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
                        {t('badgesDialog.noneEarned')}
                    </p>
                )}
            </DialogContent>
        </Dialog>
    );
}

function LeaderboardRow({ entry, onClick }: { entry: LeaderboardEntry; onClick?: () => void }) {
    const { t } = useTranslation('studyLibraryLeaderboardReports');
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
            title={clickable ? t('leaderboardRow.viewBadges') : undefined}
            className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-neutral-50',
                clickable && 'cursor-pointer'
            )}
        >
            <div className="flex w-6 shrink-0 justify-center">
                <RankCell rank={entry.rank} />
            </div>
            <span className="flex-1 truncate text-body font-medium text-neutral-700">
                {entry.name}
            </span>
            <BadgeIcons entry={entry} />
            <span className="w-20 text-right text-caption font-semibold tabular-nums text-neutral-600">
                {t('leaderboardRow.points', { count: entry.points })}
            </span>
            {clickable && <CaretRight className="size-3.5 shrink-0 text-neutral-300" />}
        </div>
    );
}

type LeaderboardView = 'institute' | 'course';

export default function LeaderboardReports() {
    const { t } = useTranslation('studyLibraryLeaderboardReports');
    const {
        instituteDetails,
        getCourseFromPackage,
        getSessionFromPackage,
        getLevelsFromPackage2,
        getPackageSessionId,
    } = useInstituteDetailsStore();
    const courseList = getCourseFromPackage();
    const instituteId = getCurrentInstituteId();

    const [view, setView] = useState<LeaderboardView>('institute');
    const [courseId, setCourseId] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [levelId, setLevelId] = useState('');
    const [sessionList, setSessionList] = useState<{ id: string; name: string }[]>([]);
    const [levelList, setLevelList] = useState<{ id: string; level_name: string }[]>([]);
    const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);

    useEffect(() => {
        if (courseId) {
            const s = getSessionFromPackage({ courseId });
            setSessionList(s);
            setSessionId(s.length === 1 && s[0] ? s[0].id : '');
        } else {
            setSessionList([]);
            setSessionId('');
        }
        setLevelId('');
    }, [courseId]);

    useEffect(() => {
        if (courseId && sessionId) {
            const l = getLevelsFromPackage2({ courseId, sessionId }) as {
                id: string;
                level_name: string;
            }[];
            setLevelList(l);
            if (l.length === 1 && l[0]) setLevelId(l[0].id);
            else if (sessionId === 'DEFAULT') setLevelId('DEFAULT');
            else setLevelId('');
        } else {
            setLevelList([]);
            setLevelId('');
        }
    }, [courseId, sessionId]);

    const packageSessionId = useMemo(
        () =>
            courseId && sessionId && levelId
                ? getPackageSessionId({ courseId, sessionId, levelId })
                : null,
        [courseId, sessionId, levelId]
    );

    const { data: courseLeaderboard, isLoading: courseLoading } = useQuery({
        queryKey: ['admin-course-leaderboard', packageSessionId],
        queryFn: () => getCourseLeaderboardAdmin(packageSessionId as string),
        enabled: view === 'course' && Boolean(packageSessionId),
        staleTime: 60 * 1000,
    });

    const { data: instituteLeaderboard, isLoading: instituteLoading } = useQuery({
        queryKey: ['admin-institute-leaderboard'],
        queryFn: getInstituteLeaderboardAdmin,
        enabled: view === 'institute',
        staleTime: 60 * 1000,
    });

    const isInstitute = view === 'institute';
    const activeData = isInstitute ? instituteLeaderboard : courseLeaderboard;
    const activeLoading = isInstitute ? instituteLoading : courseLoading;

    // Public, white-labelled shareable link (institute view only) — points at the
    // institute's LEARNER portal so domain-routing resolves the institute.
    const shareUrl = useMemo(() => {
        if (!isInstitute || !instituteId) return '';
        const rawBase = instituteDetails?.learner_portal_base_url || BASE_URL_LEARNER_DASHBOARD;
        const base =
            rawBase.startsWith('http://') || rawBase.startsWith('https://')
                ? rawBase
                : `https://${rawBase}`;
        return `${base.replace(/\/+$/, '')}/leaderboard/institute/${instituteId}`;
    }, [isInstitute, instituteId, instituteDetails?.learner_portal_base_url]);

    const handleCopy = () => {
        if (!shareUrl) return;
        navigator.clipboard.writeText(shareUrl);
        toast.success(t('toasts.linkCopied'));
    };
    const handleShare = () => {
        if (!shareUrl) return;
        if (typeof navigator !== 'undefined' && navigator.share) {
            navigator.share({ title: t('share.dialogTitle'), url: shareUrl }).catch(() => {});
        } else {
            handleCopy();
        }
    };

    return (
        <>
        <div className="flex flex-col gap-4 p-6">
            <BadgesStatsPanel />

            {/* View toggle */}
            <div className="flex items-center gap-2">
                <MyButton
                    buttonType={isInstitute ? 'primary' : 'secondary'}
                    scale="small"
                    onClick={() => setView('institute')}
                    className="gap-1.5"
                >
                    <Buildings className="size-4" />
                    {t('viewToggle.instituteWide')}
                </MyButton>
                <MyButton
                    buttonType={!isInstitute ? 'primary' : 'secondary'}
                    scale="small"
                    onClick={() => setView('course')}
                    className="gap-1.5"
                >
                    <Crown className="size-4" />
                    {t('viewToggle.byCourse')}
                </MyButton>
            </div>

            {/* Batch selector (course view only) */}
            {!isInstitute && (
                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                            <label className="mb-1 block text-caption font-medium text-neutral-700">
                                {t('batchSelector.course')}
                            </label>
                            <SearchableSelect
                                options={courseList.map((c) => ({ label: c.name, value: c.id }))}
                                value={courseId}
                                onChange={(v) => setCourseId(v)}
                                placeholder={t('batchSelector.selectCourse')}
                                searchPlaceholder={t('batchSelector.searchCourse')}
                                triggerClassName="h-9 text-sm"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-caption font-medium text-neutral-700">
                                {t('batchSelector.session')}
                            </label>
                            <Select
                                value={sessionId}
                                onValueChange={setSessionId}
                                disabled={!sessionList.length}
                            >
                                <SelectTrigger className="h-9 text-sm">
                                    <SelectValue placeholder={t('batchSelector.selectSession')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {sessionList.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="mb-1 block text-caption font-medium text-neutral-700">
                                {t('batchSelector.level')}
                            </label>
                            <Select
                                value={levelId}
                                onValueChange={setLevelId}
                                disabled={!levelList.length}
                            >
                                <SelectTrigger className="h-9 text-sm">
                                    <SelectValue placeholder={t('batchSelector.selectLevel')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {levelList.map((l) => (
                                        <SelectItem key={l.id} value={l.id}>
                                            {l.level_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            )}

            {/* Leaderboard */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        {isInstitute ? (
                            <Buildings weight="fill" className="size-5 text-primary-500" />
                        ) : (
                            <Crown weight="fill" className="size-5 text-warning-500" />
                        )}
                        <h3 className="text-subtitle font-semibold text-neutral-700">
                            {isInstitute
                                ? t('leaderboardPanel.instituteWideHeading')
                                : t('leaderboardPanel.courseHeading')}
                        </h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {activeData && (
                            <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
                                <Users className="size-4" />
                                {t('leaderboardPanel.learnersCount', {
                                    count: activeData.totalLearners,
                                })}
                            </span>
                        )}
                        {shareUrl && (
                            <>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={handleCopy}
                                    className="gap-1.5"
                                >
                                    <Copy className="size-4" />
                                    {t('leaderboardPanel.copyLink')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="icon"
                                    onClick={handleShare}
                                    aria-label={t('leaderboardPanel.shareAriaLabel')}
                                >
                                    <ShareNetwork className="size-4" />
                                </MyButton>
                            </>
                        )}
                    </div>
                </div>

                {!isInstitute && !packageSessionId ? (
                    <p className="py-6 text-center text-caption text-muted-foreground">
                        {t('leaderboardPanel.selectToView')}
                    </p>
                ) : activeLoading ? (
                    <p className="py-6 text-center text-caption text-muted-foreground">
                        {t('leaderboardPanel.loading')}
                    </p>
                ) : !activeData || activeData.entries.length === 0 ? (
                    <p className="py-6 text-center text-caption text-muted-foreground">
                        {isInstitute
                            ? t('leaderboardPanel.noInstituteActivity')
                            : t('leaderboardPanel.noBatchActivity')}
                    </p>
                ) : (
                    <div className="flex flex-col gap-1">
                        {activeData.entries.map((entry, i) => (
                            <LeaderboardRow
                                key={i}
                                entry={entry}
                                onClick={() =>
                                    entry.badgeCount > 0 && setSelectedEntry(entry)
                                }
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
        <EntryBadgesDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        </>
    );
}
