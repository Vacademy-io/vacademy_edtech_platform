import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, Info, Warning } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { awardBadge, AWARD_BATCH_LIMIT } from '@/services/student-badges';
import {
    getBadgesRewardsConfig,
    type BadgesRewardsState,
} from '@/routes/settings/-services/badges-settings';
import {
    getTriggerMeta,
    isManualTrigger,
    type BadgeDefinitionConfig,
} from '@/routes/settings/-constants/badge-config';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import { isUserAdmin } from '@/utils/userDetails';
import { BadgePicker } from '../../student-side-view/student-badges/badge-picker';
import { BadgePill } from '../../student-side-view/student-badges/badge-award-row';

type Step = 'PICK' | 'RUNNING' | 'RESULTS';

/**
 * Learners per POST. Well under the server cap (AWARD_BATCH_LIMIT = 500): each call writes
 * every row in one transaction and sends one notification batch after commit, so smaller
 * chunks keep a single slow request from holding the whole selection, and give the admin a
 * progress line that actually moves.
 */
export const AWARD_CHUNK_SIZE = Math.min(25, AWARD_BATCH_LIMIT);

const NOTE_MAX = 300;

export interface BulkAwardTotals {
    awardedCount: number;
    alreadyHadCount: number;
    upgradedCount: number;
    /** Ids the server found not to belong to this institute (skipped, never written or notified). */
    notEnrolledCount: number;
    /** Learners in chunks whose request failed (the server never confirmed them). */
    failedCount: number;
    /** False as soon as ANY chunk reports the institute toggle off. */
    notified: boolean;
}

const EMPTY_TOTALS: BulkAwardTotals = {
    awardedCount: 0,
    alreadyHadCount: 0,
    upgradedCount: 0,
    notEnrolledCount: 0,
    failedCount: 0,
    notified: true,
};

/** Split a list into consecutive groups of at most `size` (exported for the test). */
export function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/**
 * Bulk "Award badge" — mounted INSIDE BulkActionsMenu, so it exists on every list that shows
 * the menu (students list, course-details learners, live-session learners). Reads its
 * selection from the shared dialog store like the other bulk dialogs.
 *
 * Steps: PICK (badge + optional note) → RUNNING (sequential chunked POSTs with progress;
 * closing is blocked) → RESULTS (aggregated counts).
 */
export const BulkAwardBadgeDialog = () => {
    const { t } = useTranslation('manageStudentsBulkAwardBadge');
    const { isAwardBadgeOpen, bulkActionInfo, closeAllDialogs } = useDialogStore();
    const noteId = useId();

    const [step, setStep] = useState<Step>('PICK');
    const [config, setConfig] = useState<BadgesRewardsState | null>(null);
    const [configLoading, setConfigLoading] = useState(false);
    const [selectedBadgeId, setSelectedBadgeId] = useState('');
    const [reason, setReason] = useState('');
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [totals, setTotals] = useState<BulkAwardTotals>(EMPTY_TOTALS);

    const learners = (bulkActionInfo?.selectedStudents ?? []).filter((s) => s?.user_id);
    // Cross-page selection is keyed by the enrolment row, so a learner in several batches
    // surfaces as several rows. The server is idempotent per learner, but the counts shown
    // here would be inflated without the dedupe.
    const userIds = Array.from(new Set(learners.map((s) => s.user_id)));
    const duplicateRows = learners.length - userIds.length;

    useEffect(() => {
        if (!isAwardBadgeOpen) return;
        let cancelled = false;
        setStep('PICK');
        setSelectedBadgeId('');
        setReason('');
        setProgress({ done: 0, total: 0 });
        setTotals(EMPTY_TOTALS);
        setConfig(null);
        setConfigLoading(true);
        // Lenient reader: a fetch failure yields "feature off + default badges", which is the
        // right degraded state for a picker (never feeds a save).
        getBadgesRewardsConfig()
            .then((cfg) => {
                if (!cancelled) setConfig(cfg);
            })
            .finally(() => {
                if (!cancelled) setConfigLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isAwardBadgeOpen]);

    const catalogue = (config?.badges ?? []).filter((b) => b.enabled !== false);
    const selected = selectedBadgeId ? catalogue.find((b) => b.id === selectedBadgeId) : undefined;
    const badgesEnabled = config?.enabled === true;
    const running = step === 'RUNNING';

    const handleCreated = (badge: BadgeDefinitionConfig) => {
        setConfig((prev) =>
            prev
                ? { ...prev, badges: [...prev.badges.filter((b) => b.id !== badge.id), badge] }
                : prev
        );
        setSelectedBadgeId(badge.id);
    };

    const handleOpenChange = (open: boolean) => {
        // The X button, Escape and outside clicks all land here. While requests are in
        // flight, closing would hide the progress of writes that keep happening anyway.
        if (!open && running) return;
        if (!open) closeAllDialogs();
    };

    const handleAward = async () => {
        if (!selected || userIds.length === 0) return;
        const batches = chunk(userIds, AWARD_CHUNK_SIZE);
        const note = reason.trim() || undefined;
        setStep('RUNNING');
        setProgress({ done: 0, total: userIds.length });

        const sum: BulkAwardTotals = { ...EMPTY_TOTALS };
        for (const batch of batches) {
            try {
                const res = await awardBadge({
                    userIds: batch,
                    badgeId: selected.id,
                    badgeName: selected.name,
                    badgeIcon: selected.icon,
                    badgeDescription: selected.description,
                    reason: note,
                });
                sum.awardedCount += res.awardedCount;
                sum.alreadyHadCount += res.alreadyHadCount;
                sum.upgradedCount += res.upgradedCount;
                sum.notEnrolledCount += res.notEnrolledCount;
                if (res.notified === false) sum.notified = false;
            } catch {
                // Keep going: one failed chunk must not strand the learners behind it. The
                // failure is surfaced once, in the results step and a single toast.
                sum.failedCount += batch.length;
            }
            setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + batch.length) }));
        }

        setTotals(sum);
        setStep('RESULTS');

        const changed = sum.awardedCount + sum.upgradedCount;
        if (sum.failedCount > 0) {
            toast.error(t('toasts.partialFailure', { count: sum.failedCount }));
        }
        if (changed > 0) {
            toast.success(t('toasts.success', { count: changed }));
        } else if (sum.failedCount === 0) {
            toast.info(t('toasts.nothingNew'));
        }
        if (!sum.notified && changed > 0) {
            toast.info(t('toasts.notNotified'));
        }
    };

    const canAward = Boolean(selected) && userIds.length > 0 && !configLoading;

    const renderPick = () => (
        <div className="flex flex-col gap-4">
            <p className="text-body text-muted-foreground">
                {t('intro', { count: userIds.length })}
                {duplicateRows > 0 && (
                    <span className="block text-caption">
                        {t('duplicateRowsHint', { count: duplicateRows })}
                    </span>
                )}
            </p>

            {config && !badgesEnabled && (
                <div
                    role="status"
                    className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3"
                >
                    <Info className="mt-0.5 size-4 shrink-0 text-warning-700" weight="fill" />
                    <p className="text-caption text-warning-700">{t('disabledBanner')}</p>
                </div>
            )}

            {configLoading ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-9 w-full" />
                </div>
            ) : (
                <BadgePicker
                    badges={catalogue}
                    value={selectedBadgeId}
                    onChange={setSelectedBadgeId}
                    canCreate={isUserAdmin()}
                    onCreated={handleCreated}
                />
            )}

            {selected && <SelectedBadgePreview badge={selected} />}

            <div className="flex flex-col gap-1.5">
                <Label htmlFor={noteId} className="text-caption font-semibold text-neutral-600">
                    {t('noteLabel')}
                </Label>
                <Textarea
                    id={noteId}
                    rows={2}
                    maxLength={NOTE_MAX}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('notePlaceholder')}
                    className="text-body"
                />
                <div className="flex items-start justify-between gap-2">
                    <p className="text-2xs text-muted-foreground">{t('noteHint')}</p>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                        {reason.length}/{NOTE_MAX}
                    </span>
                </div>
            </div>
        </div>
    );

    const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

    const renderRunning = () => (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <p className="text-body font-semibold text-card-foreground">{t('running.title')}</p>
            <Progress
                value={percent}
                className="h-2 border border-neutral-200"
                aria-label={t('running.title')}
            />
            <p className="text-caption text-muted-foreground">
                {t('running.progress', { done: progress.done, total: progress.total })}
            </p>
            <p className="text-2xs text-muted-foreground">{t('running.keepOpen')}</p>
        </div>
    );

    const renderResults = () => {
        const rows: Array<{
            key: string;
            label: string;
            count: number;
            tone: 'ok' | 'muted' | 'bad';
        }> = [
            {
                key: 'awarded',
                label: t('results.awarded', { count: totals.awardedCount }),
                count: totals.awardedCount,
                tone: 'ok',
            },
            {
                key: 'upgraded',
                label: t('results.upgraded', { count: totals.upgradedCount }),
                count: totals.upgradedCount,
                tone: 'ok',
            },
            {
                key: 'alreadyHad',
                label: t('results.alreadyHad', { count: totals.alreadyHadCount }),
                count: totals.alreadyHadCount,
                tone: 'muted',
            },
            {
                key: 'notEnrolled',
                label: t('results.notEnrolled', { count: totals.notEnrolledCount }),
                count: totals.notEnrolledCount,
                tone: 'muted',
            },
            {
                key: 'failed',
                label: t('results.failed', { count: totals.failedCount }),
                count: totals.failedCount,
                tone: 'bad',
            },
        ];
        const changed = totals.awardedCount + totals.upgradedCount;
        return (
            <div className="flex flex-col gap-4">
                {selected && (
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 ring-1 ring-primary-200">
                            <BadgeVisual
                                icon={selected.icon}
                                fill
                                className="size-5 text-primary-500"
                            />
                        </div>
                        <p className="min-w-0 truncate text-body font-semibold text-card-foreground">
                            {selected.name}
                        </p>
                    </div>
                )}
                <ul className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
                    {rows
                        .filter((r) => r.count > 0 || r.key === 'awarded')
                        .map((r) => (
                            <li
                                key={r.key}
                                className="flex items-center gap-2 text-caption text-neutral-700"
                            >
                                {r.tone === 'bad' ? (
                                    <Warning
                                        className="size-4 shrink-0 text-danger-500"
                                        weight="fill"
                                    />
                                ) : (
                                    <CheckCircle
                                        className={
                                            r.tone === 'ok'
                                                ? 'size-4 shrink-0 text-success-600'
                                                : 'size-4 shrink-0 text-neutral-400'
                                        }
                                        weight="fill"
                                    />
                                )}
                                <span>{r.label}</span>
                            </li>
                        ))}
                </ul>
                {changed > 0 && (
                    <p className="flex items-start gap-2 text-caption text-muted-foreground">
                        <Info className="mt-0.5 size-4 shrink-0" />
                        <span>
                            {totals.notified ? t('results.notified') : t('results.notNotified')}
                        </span>
                    </p>
                )}
            </div>
        );
    };

    const footer = (
        <div className="flex items-center gap-2">
            {step === 'PICK' && (
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => closeAllDialogs()}
                    >
                        {t('footer.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        scale="medium"
                        disable={!canAward}
                        onClick={handleAward}
                    >
                        {t('footer.award', { count: userIds.length })}
                    </MyButton>
                </>
            )}
            {step === 'RUNNING' && (
                <MyButton type="button" scale="medium" disable>
                    {t('footer.awarding')}
                </MyButton>
            )}
            {step === 'RESULTS' && (
                <MyButton type="button" scale="medium" onClick={() => closeAllDialogs()}>
                    {t('footer.done')}
                </MyButton>
            )}
        </div>
    );

    return (
        <MyDialog
            heading={t('dialogTitle')}
            open={isAwardBadgeOpen}
            onOpenChange={handleOpenChange}
            dialogWidth="max-w-lg"
            footer={footer}
        >
            {step === 'PICK' && renderPick()}
            {step === 'RUNNING' && renderRunning()}
            {step === 'RESULTS' && renderResults()}
        </MyDialog>
    );
};

/**
 * Compact preview of the badge about to be awarded (visual, name, description, chips).
 * Trigger/unit/preview copy is shared with the side-view Badges tab, so this reads the
 * `manageStudentsBadges` catalogue rather than duplicating 20 keys ×4 locales.
 */
function SelectedBadgePreview({ badge }: { badge: BadgeDefinitionConfig }) {
    const { t } = useTranslation('manageStudentsBadges');
    const meta = getTriggerMeta(badge.trigger);
    const label = t(`trigger.${badge.trigger}`, { defaultValue: meta.label });
    const chip = isManualTrigger(badge.trigger)
        ? label
        : t('preview.autoChip', {
              label,
              threshold: badge.threshold,
              unit: t(`unit.${badge.trigger}`, { defaultValue: meta.unit }),
          });

    return (
        <div className="flex items-start gap-3 rounded-lg border border-primary-200 bg-primary-50 p-2.5">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card ring-1 ring-primary-200">
                <BadgeVisual icon={badge.icon} fill className="size-6 text-primary-500" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-body font-semibold text-card-foreground">
                    {badge.name}
                </p>
                <p className="text-caption text-muted-foreground">
                    {badge.description || t('preview.noDescription')}
                </p>
                <div className="flex flex-wrap gap-1">
                    <BadgePill className="bg-card">{chip}</BadgePill>
                    {badge.hidden && (
                        <BadgePill className="bg-card">{t('preview.hidden')}</BadgePill>
                    )}
                </div>
            </div>
        </div>
    );
}
