import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Info, Trophy, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStudentSidebar } from '../../../../-context/selected-student-sidebar-context';
import { ProfileSectionCard, ProfileSkeleton, ProfileError, ProfileEmpty } from '../profile-ui';
import {
    getStudentAwardedBadges,
    awardBadge,
    awardSource,
    revokeBadge,
    type AwardBadgeResponse,
    type LearnerBadgeAward,
} from '@/services/student-badges';
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
import { BadgePicker } from './badge-picker';
import { BadgeAwardRow, BadgePill } from './badge-award-row';

const NOTE_MAX = 300;

/** Pick the single learner's outcome out of the award envelope (legacy arrays → NEW). */
function outcomeFor(response: AwardBadgeResponse, userId: string): string {
    const mine = response.results.find((r) => r.userId === userId) ?? response.results[0];
    if (mine?.status) return mine.status;
    if (response.upgradedCount > 0) return 'UPGRADED_FROM_AUTO';
    if (response.alreadyHadCount > 0) return 'ALREADY_ACTIVE';
    return 'NEW';
}

export const StudentBadges = ({ isSubmissionTab }: { isSubmissionTab?: boolean }) => {
    const { t } = useTranslation('manageStudentsBadges');
    const { selectedStudent } = useStudentSidebar();
    const [awards, setAwards] = useState<LearnerBadgeAward[] | null>(null);
    const [config, setConfig] = useState<BadgesRewardsState | null>(null);
    const [selectedBadgeId, setSelectedBadgeId] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const noteId = useId();

    const userId = isSubmissionTab ? selectedStudent?.id : selectedStudent?.user_id;
    const canCreate = isUserAdmin();

    const load = async () => {
        if (!userId) return;
        setLoading(true);
        setLoadError(false);
        try {
            const [awarded, cfg] = await Promise.all([
                getStudentAwardedBadges(userId),
                getBadgesRewardsConfig(),
            ]);
            setAwards(awarded);
            setConfig(cfg);
        } catch {
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStudent?.id, selectedStudent?.user_id, isSubmissionTab]);

    const awarded = awards ?? [];
    const catalogue = (config?.badges ?? []).filter((b) => b.enabled !== false);
    const byId = new Map(catalogue.map((b) => [b.id, b]));
    const selected = selectedBadgeId ? byId.get(selectedBadgeId) : undefined;
    const staffHeldIds = new Set(
        awarded.filter((a) => awardSource(a) === 'MANUAL').map((a) => a.badgeId)
    );
    const autoHeld = selected
        ? awarded.some((a) => a.badgeId === selected.id && awardSource(a) === 'AUTO')
        : false;
    const badgesEnabled = config?.enabled === true;

    const handleCreated = (badge: BadgeDefinitionConfig) => {
        setConfig((prev) =>
            prev
                ? { ...prev, badges: [...prev.badges.filter((b) => b.id !== badge.id), badge] }
                : prev
        );
        setSelectedBadgeId(badge.id);
    };

    const handleAward = async () => {
        if (!userId || !selected) return;
        setBusy(true);
        try {
            const response = await awardBadge({
                userIds: [userId],
                badgeId: selected.id,
                badgeName: selected.name,
                badgeIcon: selected.icon,
                badgeDescription: selected.description,
                reason: reason.trim() || undefined,
            });
            setAwards(await getStudentAwardedBadges(userId));
            setSelectedBadgeId('');
            setReason('');
            const outcome = outcomeFor(response, userId);
            if (outcome === 'NOT_ENROLLED') {
                toast.error(t('award.toastNotEnrolled'));
            } else if (outcome === 'ALREADY_ACTIVE') {
                toast.info(t('award.toastAlreadyActive'));
            } else if (outcome === 'UPGRADED_FROM_AUTO') {
                toast.success(t('award.toastUpgraded'));
            } else {
                toast.success(t('award.toastNew'));
            }
            if (
                response.notified === false &&
                outcome !== 'ALREADY_ACTIVE' &&
                outcome !== 'NOT_ENROLLED'
            ) {
                toast.info(t('award.toastNotNotified'));
            }
        } catch {
            toast.error(t('award.errorToast'));
        } finally {
            setBusy(false);
        }
    };

    const handleRevoke = async (badgeId: string) => {
        if (!userId) return;
        setBusy(true);
        try {
            await revokeBadge(userId, badgeId);
            setAwards(await getStudentAwardedBadges(userId));
            toast.success(t('awarded.successToast'));
        } catch {
            toast.error(t('awarded.errorToast'));
        } finally {
            setBusy(false);
        }
    };

    if (loading && awards === null) {
        return <ProfileSkeleton blocks={2} />;
    }

    if (loadError) {
        return (
            <ProfileError title={t('loadError.title')} hint={t('loadError.hint')} onRetry={load} />
        );
    }

    const canAward = Boolean(selected) && !busy && !loading;

    return (
        <div className="flex flex-col gap-3">
            {config && !badgesEnabled && (
                <div
                    role="status"
                    className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3"
                >
                    <Info className="mt-0.5 size-4 shrink-0 text-warning-700" weight="fill" />
                    <p className="text-caption text-warning-700">{t('disabledBanner.text')}</p>
                </div>
            )}

            <ProfileSectionCard icon={Trophy as PhosphorIcon} heading={t('award.heading')}>
                <div className="flex flex-col gap-3">
                    {catalogue.length === 0 && (
                        <p className="text-caption italic text-muted-foreground">
                            {t('award.empty')}
                        </p>
                    )}
                    <BadgePicker
                        badges={catalogue}
                        value={selectedBadgeId}
                        onChange={setSelectedBadgeId}
                        earnedBadgeIds={staffHeldIds}
                        disabled={busy}
                        canCreate={canCreate}
                        onCreated={handleCreated}
                    />

                    {selected && <SelectedBadgePreview badge={selected} autoHeld={autoHeld} />}

                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor={noteId}
                            className="text-caption font-semibold text-neutral-600"
                        >
                            {t('award.noteLabel')}
                        </Label>
                        <Textarea
                            id={noteId}
                            rows={2}
                            maxLength={NOTE_MAX}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('award.notePlaceholder')}
                            disabled={busy}
                            className="text-body"
                        />
                        <span className="self-end text-2xs text-muted-foreground">
                            {reason.length}/{NOTE_MAX}
                        </span>
                    </div>

                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            disable={!canAward}
                            onAsyncClick={handleAward}
                        >
                            {t('award.submit')}
                        </MyButton>
                    </div>
                </div>
            </ProfileSectionCard>

            <ProfileSectionCard
                icon={Trophy as PhosphorIcon}
                heading={t('awarded.heading')}
                action={
                    awarded.length > 0 ? (
                        <BadgePill className="font-semibold">{String(awarded.length)}</BadgePill>
                    ) : undefined
                }
            >
                {awarded.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        {awarded.map((a) => (
                            <BadgeAwardRow
                                key={a.id}
                                award={a}
                                hidden={byId.get(a.badgeId)?.hidden === true}
                                disabled={busy}
                                onRevoke={handleRevoke}
                            />
                        ))}
                    </div>
                ) : (
                    <ProfileEmpty
                        icon={Trophy as PhosphorIcon}
                        title={t('awarded.emptyTitle')}
                        hint={t('awarded.emptyHint')}
                    />
                )}
            </ProfileSectionCard>
        </div>
    );
};

/** Preview card for the badge about to be awarded: visual, name/description, trigger chips. */
function SelectedBadgePreview({
    badge,
    autoHeld,
}: {
    badge: BadgeDefinitionConfig;
    autoHeld: boolean;
}) {
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
                {autoHeld && (
                    <p className="text-2xs text-muted-foreground">{t('preview.autoHeldHint')}</p>
                )}
            </div>
        </div>
    );
}
