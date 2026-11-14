import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    BookOpen,
    Fire,
    Lightning,
    Star,
    Trophy,
    Medal,
    Crown,
    Rocket,
    Target,
    Heart,
    Confetti,
    GraduationCap,
    Lightbulb,
    Sparkle,
    Flag,
    CheckCircle,
    Plus,
    Trash,
    ArrowCounterClockwise,
    FloppyDisk,
    UploadSimple,
    Images,
    HandHeart,
    EyeSlash,
    Medal as MedalHeader,
    type IconProps,
} from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
    BADGE_ICON_NAMES,
    BadgeDefinitionConfig,
    BadgeTriggerType,
    DEFAULT_BADGE_CONFIG,
    DEFAULT_SCORING,
    getTriggerMeta,
    isManualTrigger,
    makeNewBadge,
    ScoringConfig,
    SCORING_FIELDS,
    TRIGGER_OPTIONS,
} from '../../-constants/badge-config';
import {
    getBadgesRewardsConfig,
    getBadgesRewardsConfigStrict,
    mergeMissingBadges,
    saveBadgesSettings,
} from '../../-services/badges-settings';
import { BadgeVisual, isBuiltInBadgeIcon } from '../../-constants/badge-icon-map';
import {
    isLibraryToken,
    libraryThemeForTrigger,
    buildLibraryToken,
    TIER_ORDER,
    type BadgeTier,
} from '../../-constants/badge-library';
import { BadgeLibraryPicker } from './BadgeLibraryPicker';
import { UploadFileInS3 } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';

const ICON_MAP: Record<string, React.FC<IconProps>> = {
    BookOpen,
    Fire,
    Lightning,
    Star,
    Trophy,
    Medal,
    Crown,
    Rocket,
    Target,
    Heart,
    Confetti,
    GraduationCap,
    Lightbulb,
    Sparkle,
    Flag,
    CheckCircle,
};

function BadgeIcon({ name, className }: { name: string; className?: string }) {
    const Icon = ICON_MAP[name] ?? Trophy;
    return <Icon weight="fill" className={className} />;
}

export default function BadgesRewardsSettings() {
    const { t } = useTranslation('settingsBadgesRewards');
    const queryClient = useQueryClient();
    const [badges, setBadges] = useState<BadgeDefinitionConfig[]>([]);
    const [enabled, setEnabled] = useState(false);
    const [scoring, setScoring] = useState<ScoringConfig>(DEFAULT_SCORING);
    const [publicShowFullNames, setPublicShowFullNames] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    /** True while the pre-save read of the server catalogue is in flight. */
    const [checkingServer, setCheckingServer] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['badges-settings'],
        queryFn: getBadgesRewardsConfig,
        staleTime: 5 * 60 * 1000,
    });

    // Ids that were on the server when this page loaded (or last saved). Anything the save
    // guard finds on the server that is NOT in here was created elsewhere in the meantime and
    // must be kept; anything that IS in here but missing locally was deleted by the admin on
    // purpose and must stay deleted.
    const knownIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (data) {
            setBadges(data.badges);
            setEnabled(data.enabled);
            setScoring(data.scoring);
            setPublicShowFullNames(data.publicShowFullNames);
            setHasChanges(false);
            knownIdsRef.current = new Set(
                data.storedBadgesEmpty ? [] : data.badges.map((b) => b.id)
            );
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: (vars: {
            badges: BadgeDefinitionConfig[];
            enabled: boolean;
            scoring: ScoringConfig;
            publicShowFullNames: boolean;
        }) => saveBadgesSettings(vars.badges, vars.enabled, vars.scoring, vars.publicShowFullNames),
        onSuccess: () => {
            toast.success(t('toasts.badgesSaved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['badges-settings'] });
        },
        onError: () => toast.error(t('toasts.saveFailed')),
    });

    const toggleEnabled = (v: boolean) => {
        setEnabled(v);
        setHasChanges(true);
    };

    const updateScoring = (key: keyof ScoringConfig, value: number) => {
        setScoring((prev) => ({ ...prev, [key]: value }));
        setHasChanges(true);
    };

    const updateBadge = (index: number, patch: Partial<BadgeDefinitionConfig>) => {
        setBadges((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
        setHasChanges(true);
    };

    const handleIconUpload = async (index: number, file: File | undefined) => {
        if (!file) return;
        try {
            const fileId = await UploadFileInS3(
                file,
                () => {},
                getUserId() || 'admin',
                'BADGE_ICON',
                'INSTITUTE',
                true
            );
            if (fileId) {
                updateBadge(index, { icon: fileId });
                toast.success(t('toasts.imageUploaded'));
            }
        } catch {
            toast.error(t('toasts.uploadFailed'));
        }
    };

    const removeBadge = (index: number) => {
        setBadges((prev) => prev.filter((_, i) => i !== index));
        setHasChanges(true);
    };

    const addBadge = (trigger: BadgeTriggerType = 'course_count') => {
        setBadges((prev) => [...prev, makeNewBadge(trigger)]);
        setHasChanges(true);
    };

    const resetDefaults = () => {
        const manualCount = badges.filter((b) => isManualTrigger(b.trigger)).length;
        setBadges(DEFAULT_BADGE_CONFIG.badges.map((b) => ({ ...b })));
        setHasChanges(true);
        if (manualCount > 0) {
            // Awards already given stay on the learners' records; only the catalogue entry goes.
            toast.info(t('toasts.resetRemovesManual', { count: manualCount }));
        }
    };

    /**
     * Trigger copy goes through i18n keyed by trigger id; the hardcoded English in
     * TRIGGER_META is only the fallback (also covers triggers this build does not know).
     */
    const triggerText = (trigger: string, field: 'label' | 'help' | 'unit') =>
        t(`triggers.${trigger}.${field}`, { defaultValue: getTriggerMeta(trigger)[field] });

    /** Any badge still on a plain icon that has matching ready-made artwork. */
    const canApplyLibraryArt = badges.some(
        (b) => !isLibraryToken(b.icon) && libraryThemeForTrigger(b.trigger)
    );

    /**
     * Swap every plain-icon badge to matching library artwork, keyed off its trigger.
     * Badges that share an achievement escalate through the tiers (by threshold) so no
     * two land on the same image; badges already using library art are left untouched.
     */
    const applyLibraryArt = () => {
        const themeGroups = new Map<string, number[]>();
        badges.forEach((b, i) => {
            if (isLibraryToken(b.icon)) return;
            const theme = libraryThemeForTrigger(b.trigger);
            if (!theme) return;
            const arr = themeGroups.get(theme) ?? [];
            arr.push(i);
            themeGroups.set(theme, arr);
        });
        if (themeGroups.size === 0) return;

        const tierByIndex = new Map<number, BadgeTier>();
        themeGroups.forEach((idxs) => {
            const sorted = [...idxs].sort(
                (a, z) => (badges[a]?.threshold ?? 0) - (badges[z]?.threshold ?? 0)
            );
            sorted.forEach((idx, k) => {
                const pos =
                    sorted.length <= 1
                        ? TIER_ORDER.indexOf('gold')
                        : Math.round((k * (TIER_ORDER.length - 1)) / (sorted.length - 1));
                tierByIndex.set(idx, TIER_ORDER[pos] ?? 'gold');
            });
        });

        setBadges((prev) =>
            prev.map((b, i) => {
                const tier = tierByIndex.get(i);
                const theme = libraryThemeForTrigger(b.trigger);
                const token = tier && theme ? buildLibraryToken(theme, tier) : undefined;
                return token ? { ...b, icon: token } : b;
            })
        );
        setHasChanges(true);
        toast.success(t('toasts.libraryArtApplied'));
    };

    const handleSave = async () => {
        const invalid = badges.find((b) => !b.name.trim());
        if (invalid) {
            toast.error(t('toasts.nameRequired'));
            return;
        }
        // Saving overwrites the whole catalogue. Badges created elsewhere while this page was
        // open (the student view appends through its own endpoint) must survive, and a failed
        // read must never be mistaken for "no custom badges" — so read STRICT, then merge.
        setCheckingServer(true);
        try {
            const server = await getBadgesRewardsConfigStrict();
            // When the server holds no list, `server.badges` is the built-in defaults — not
            // something created elsewhere, so there is nothing to merge back in (and an admin
            // who deleted a default must not see it reappear).
            // Only badges that did not exist when the page loaded count as "created elsewhere";
            // a badge the admin removed locally is on the server too, but must stay removed.
            const serverBadges = server.storedBadgesEmpty
                ? []
                : server.badges.filter((b) => !knownIdsRef.current.has(b.id));
            const { merged, added } = mergeMissingBadges(badges, serverBadges);
            if (added.length > 0) {
                setBadges(merged);
                toast.info(t('toasts.mergedFromServer', { count: added.length }));
            }
            knownIdsRef.current = new Set(merged.map((b) => b.id));
            save({ badges: merged, enabled, scoring, publicShowFullNames });
        } catch {
            // Never save from a failed read — a transient error must not wipe the catalogue.
            toast.error(t('toasts.saveGuardFailed'));
        } finally {
            setCheckingServer(false);
        }
    };

    const busy = saving || checkingServer;

    if (isLoading) {
        return <div className="flex items-center justify-center p-8">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 p-2">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h1 className="flex items-center gap-2 text-lg font-bold">
                        <MedalHeader className="size-6" weight="fill" />
                        {t('header.title')}
                    </h1>
                    <p className="text-sm text-neutral-500">{t('header.description')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <MyButton buttonType="secondary" onClick={resetDefaults} disabled={busy}>
                        <ArrowCounterClockwise className="mr-2 size-4" />
                        {t('header.resetDefaults')}
                    </MyButton>
                    <MyButton onClick={handleSave} disabled={busy || !hasChanges}>
                        <FloppyDisk className="mr-2 size-4" />
                        {busy ? t('header.saving') : t('header.saveChanges')}
                    </MyButton>
                </div>
            </div>

            <Card>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div className="space-y-0.5">
                        <Label className="text-sm font-semibold">{t('enableCard.label')}</Label>
                        <p className="text-xs text-neutral-500">{t('enableCard.description')}</p>
                    </div>
                    <Switch checked={enabled} onCheckedChange={toggleEnabled} />
                </CardContent>
            </Card>

            {hasChanges && (
                <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
                    <p className="text-sm text-warning-700">{t('unsavedBanner.text')}</p>
                </div>
            )}

            {!enabled && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-sm text-neutral-600">
                        {t('disabledBanner.before')}{' '}
                        <strong>{t('disabledBanner.disabled')}</strong>{' '}
                        {t('disabledBanner.after')}
                    </p>
                </div>
            )}

            {enabled && (
                <>
                    <Card>
                <CardContent className="space-y-4 p-4">
                    <div>
                        <h2 className="text-base font-semibold text-neutral-800">
                            {t('scoring.title')}
                        </h2>
                        <p className="text-sm text-neutral-500">{t('scoring.description')}</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        {SCORING_FIELDS.map((f) => (
                            <div key={f.key} className="space-y-1.5">
                                <Label className="text-sm">{f.label}</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        min={0}
                                        value={scoring[f.key]}
                                        onChange={(e) =>
                                            updateScoring(f.key, Number(e.target.value) || 0)
                                        }
                                        className="w-24"
                                    />
                                    <span className="text-xs text-neutral-400">
                                        {t('scoring.pointsUnit')}
                                    </span>
                                </div>
                                <p className="text-xs text-neutral-400">{f.help}</p>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-base font-semibold text-neutral-800">
                                {t('leaderboardNames.title')}
                            </h2>
                            <p className="text-sm text-neutral-500">
                                {t('leaderboardNames.description')}
                            </p>
                        </div>
                        <Switch
                            checked={publicShowFullNames}
                            onCheckedChange={(v) => {
                                setPublicShowFullNames(v);
                                setHasChanges(true);
                            }}
                        />
                    </div>
                </CardContent>
            </Card>

            {canApplyLibraryArt && (
                <div className="flex flex-col gap-3 rounded-lg border border-primary-100 bg-primary-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <Images className="mt-0.5 size-5 shrink-0 text-primary-500" weight="fill" />
                        <div>
                            <p className="text-sm font-semibold text-neutral-800">
                                {t('libraryArt.title')}
                            </p>
                            <p className="text-xs text-neutral-500">
                                {t('libraryArt.description')}
                            </p>
                        </div>
                    </div>
                    <MyButton
                        buttonType="secondary"
                        onClick={applyLibraryArt}
                        className="shrink-0"
                    >
                        <Images className="mr-2 size-4" />
                        {t('libraryArt.button')}
                    </MyButton>
                </div>
            )}

            {badges.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                        <Trophy className="size-8 text-neutral-300" weight="fill" />
                        <p className="text-sm text-neutral-500">{t('emptyState.text')}</p>
                        <div className="flex flex-wrap justify-center gap-2">
                            <MyButton buttonType="secondary" onClick={() => addBadge()}>
                                <Plus className="mr-2 size-4" />
                                {t('addBadge')}
                            </MyButton>
                            <MyButton buttonType="secondary" onClick={() => addBadge('manual')}>
                                <HandHeart className="mr-2 size-4" />
                                {t('addManualBadge')}
                            </MyButton>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4">
                {badges.map((badge, index) => {
                    const manual = isManualTrigger(badge.trigger);
                    const triggerLabel = triggerText(badge.trigger, 'label');
                    const triggerUnit = triggerText(badge.trigger, 'unit');
                    return (
                        <Card
                            key={badge.id}
                            data-testid="badge-card"
                            className={cn(
                                'overflow-hidden transition',
                                !badge.enabled && 'opacity-70'
                            )}
                        >
                            <CardContent className="p-0">
                                {/* Live preview header — mirrors what the learner sees */}
                                <div className="flex items-start gap-4 border-b border-neutral-100 bg-neutral-50 p-4">
                                    <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white p-2 shadow-sm">
                                        <BadgeVisual
                                            icon={badge.icon}
                                            fill
                                            size={52}
                                            className="text-primary-500"
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1 pt-1">
                                        <div className="flex items-center gap-2">
                                            <p className="truncate text-base font-semibold text-neutral-800">
                                                {badge.name.trim() || t('badgeCard.untitled')}
                                            </p>
                                            {!badge.enabled && (
                                                <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600">
                                                    {t('badgeCard.disabledChip')}
                                                </span>
                                            )}
                                            {badge.hidden && (
                                                <span
                                                    data-testid="hidden-chip"
                                                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600"
                                                >
                                                    <EyeSlash className="size-3" weight="bold" />
                                                    {t('badgeCard.hiddenChip')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="truncate text-sm text-neutral-500">
                                            {badge.description.trim() ||
                                                t('badgeCard.defaultDescription')}
                                        </p>
                                        {triggerLabel && (
                                            <span
                                                data-testid="trigger-chip"
                                                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600"
                                            >
                                                {manual ? (
                                                    <HandHeart className="size-3.5" weight="bold" />
                                                ) : (
                                                    <Target className="size-3.5" weight="bold" />
                                                )}
                                                {manual
                                                    ? triggerLabel
                                                    : `${triggerLabel} · ${badge.threshold} ${triggerUnit}`}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <div className="flex items-center gap-2 pr-1">
                                            <Switch
                                                checked={badge.enabled}
                                                onCheckedChange={(v) =>
                                                    updateBadge(index, { enabled: v })
                                                }
                                            />
                                            <span className="w-6 text-xs text-neutral-500">
                                                {badge.enabled
                                                    ? t('badgeCard.on')
                                                    : t('badgeCard.off')}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeBadge(index)}
                                            className="rounded-md p-2 text-danger-500 hover:bg-danger-50"
                                            aria-label={t('badgeCard.deleteAriaLabel')}
                                        >
                                            <Trash className="size-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Editable fields */}
                                <div className="space-y-4 p-4">
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label className="text-sm">
                                                {t('badgeCard.nameLabel')}
                                            </Label>
                                            <Input
                                                value={badge.name}
                                                placeholder={t('badgeCard.namePlaceholder')}
                                                onChange={(e) =>
                                                    updateBadge(index, { name: e.target.value })
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm">
                                                {t('badgeCard.iconLabel')}
                                            </Label>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1">
                                                    <Select
                                                        value={
                                                            isBuiltInBadgeIcon(badge.icon)
                                                                ? badge.icon
                                                                : ''
                                                        }
                                                        onValueChange={(v) =>
                                                            updateBadge(index, { icon: v })
                                                        }
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue
                                                                placeholder={t(
                                                                    'badgeCard.iconPlaceholder'
                                                                )}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {BADGE_ICON_NAMES.map((name) => (
                                                                <SelectItem key={name} value={name}>
                                                                    <span className="flex items-center gap-2">
                                                                        <BadgeIcon
                                                                            name={name}
                                                                            className="size-4 text-primary-500"
                                                                        />
                                                                        {name}
                                                                    </span>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <BadgeLibraryPicker
                                                    value={badge.icon}
                                                    onSelect={(token) =>
                                                        updateBadge(index, { icon: token })
                                                    }
                                                />
                                                <label
                                                    title={t('badgeCard.uploadTitle')}
                                                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                                                >
                                                    <UploadSimple className="size-4" />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) =>
                                                            handleIconUpload(
                                                                index,
                                                                e.target.files?.[0]
                                                            )
                                                        }
                                                    />
                                                </label>
                                            </div>
                                            <p className="text-xs text-neutral-400">
                                                {isLibraryToken(badge.icon)
                                                    ? t('badgeCard.iconHint.library')
                                                    : !isBuiltInBadgeIcon(badge.icon) && badge.icon
                                                      ? t('badgeCard.iconHint.custom')
                                                      : t('badgeCard.iconHint.default')}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm">
                                            {t('badgeCard.descriptionLabel')}
                                        </Label>
                                        <Input
                                            value={badge.description}
                                            placeholder={t(
                                                'badgeCard.descriptionPlaceholder'
                                            )}
                                            onChange={(e) =>
                                                updateBadge(index, {
                                                    description: e.target.value,
                                                })
                                            }
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label className="text-sm">
                                                {t('badgeCard.triggerLabel')}
                                            </Label>
                                            <Select
                                                value={badge.trigger}
                                                onValueChange={(v) => {
                                                    const next = v as BadgeTriggerType;
                                                    // Manual badges carry no threshold; leaving
                                                    // manual picks up the new trigger's default.
                                                    updateBadge(index, {
                                                        trigger: next,
                                                        threshold: isManualTrigger(next)
                                                            ? 0
                                                            : manual
                                                              ? getTriggerMeta(next)
                                                                    .defaultThreshold
                                                              : badge.threshold,
                                                    });
                                                }}
                                            >
                                                <SelectTrigger
                                                    aria-label={t('badgeCard.triggerLabel')}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {TRIGGER_OPTIONS.map((opt) => (
                                                        <SelectItem
                                                            key={opt.value}
                                                            value={opt.value}
                                                        >
                                                            {triggerText(opt.value, 'label')}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {manual ? (
                                            <div className="flex items-start gap-2 rounded-md border border-neutral-100 bg-neutral-50 p-3">
                                                <HandHeart
                                                    className="mt-0.5 size-4 shrink-0 text-primary-500"
                                                    weight="fill"
                                                />
                                                <p className="text-xs text-neutral-600">
                                                    {t('badgeCard.manualHint')}
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                <Label className="text-sm">
                                                    {t('badgeCard.thresholdLabel', {
                                                        unit: triggerUnit,
                                                    })}
                                                </Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    aria-label={t('badgeCard.thresholdLabel', {
                                                        unit: triggerUnit,
                                                    })}
                                                    value={badge.threshold}
                                                    onChange={(e) =>
                                                        updateBadge(index, {
                                                            threshold:
                                                                Number(e.target.value) || 0,
                                                        })
                                                    }
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-neutral-400">
                                        {triggerText(badge.trigger, 'help')}
                                    </p>

                                    <div className="flex items-start justify-between gap-4 rounded-md border border-neutral-100 p-3">
                                        <div className="space-y-0.5">
                                            <Label
                                                htmlFor={`badge-hidden-${badge.id}`}
                                                className="text-sm"
                                            >
                                                {t('badgeCard.hiddenLabel')}
                                            </Label>
                                            <p className="text-xs text-neutral-400">
                                                {t('badgeCard.hiddenHelp')}
                                            </p>
                                        </div>
                                        <Switch
                                            id={`badge-hidden-${badge.id}`}
                                            checked={badge.hidden === true}
                                            onCheckedChange={(v) =>
                                                updateBadge(index, { hidden: v })
                                            }
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {badges.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    <MyButton buttonType="secondary" onClick={() => addBadge()}>
                        <Plus className="mr-2 size-4" />
                        {t('addBadge')}
                    </MyButton>
                    <MyButton buttonType="secondary" onClick={() => addBadge('manual')}>
                        <HandHeart className="mr-2 size-4" />
                        {t('addManualBadge')}
                    </MyButton>
                </div>
            )}
                </>
            )}
        </div>
    );
}
