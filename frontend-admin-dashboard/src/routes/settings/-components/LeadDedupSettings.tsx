/**
 * LeadDedupSettings — the "Deduplication" config card on Settings → Lead
 * settings → Configuration. Controls what happens when a new lead submission
 * matches one that already exists:
 *
 *   1. Enabled     → turn duplicate detection on/off (off preserves prior behaviour)
 *   2. Field       → match by email or phone number
 *   3. Scope       → this lead list, a hand-picked set of lead lists, or every
 *                    lead list in the institute
 *   4. Action      → reject the submission, or allow it through and reassign
 *   5. Repeat lead handling (only when action = allow & reassign):
 *      - Counsellor: none / same as previous / a specific counsellor / round-robin
 *      - Status: keep their current status, or reset to New
 *      - Match by phone only: join the existing person; stop counsellors adding a
 *        lead another counsellor owns
 *      - Reattempt: flag the repeat as a duplicate, a journey entry, a bell to the
 *        lead's counsellor, a "Duplicate" badge in lead tables, a priority follow-up,
 *        and the tier (Interest Level) to set (each its own setting)
 *
 * Persisted at LEAD_SETTING.data.dedup (snake_case-free, matches backend enum
 * casing directly). The save path READ-MODIFY-WRITES the whole LEAD_SETTING
 * data object — fetch current, merge only the dedup subtree, save — so
 * sibling keys (enabled, scoringWeights, reports, workbench, …) are never
 * clobbered.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Fingerprint, X } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MultiSelect, type OptionType } from '@/components/design-system/multi-select';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useCampaignsList } from '@/routes/audience-manager/list/-hooks/useCampaignsList';
import { useUserAutosuggestDebounced, USER_ROLES } from '@/services/user-autosuggest';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import {
    LEAD_DEDUP_SETTINGS_QUERY_KEY,
    fetchLeadDedupSettings,
    type LeadDedupAction,
    type LeadDedupField,
    type LeadDedupScope,
    type LeadDedupSettings as LeadDedupSettingsValues,
    type LeadDedupSettingsSubtree,
    type RepeatLeadCounsellorMode,
    type RepeatLeadSettings,
    type RepeatLeadStatusMode,
    type ReattemptSettings,
    REPEAT_LEAD_SETTINGS_DEFAULTS,
} from '@/hooks/use-lead-dedup-settings';
import { fetchLeadSettingRawData } from '@/hooks/use-lead-report-settings';

const SETTING_KEY = 'LEAD_SETTING';

type ReattemptSwitchKey = Exclude<keyof ReattemptSettings, 'tier' | 'duplicateOpenOnly'>;

/** Reattempt switches in display order; labels/hints live under repeatLead.reattempt.<key>. */
const REATTEMPT_SWITCHES: ReattemptSwitchKey[] = [
    'markDuplicate',
    'journeyEntry',
    'notifyOwner',
    'followUp',
    'showBadge',
    'duplicatesTabOnly',
];

/** Select value for "leave the tier as it is" (Radix Select can't use an empty value). */
const KEEP_TIER = '__keep__';
// Mirrors LeadSettings.tsx — the institute-settings save endpoint.
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

async function saveDedupSettings(next: LeadDedupSettingsValues): Promise<void> {
    const instituteId = getCurrentInstituteId();
    // Read-modify-write: fetch the CURRENT full data object right before saving
    // so concurrent edits to sibling subtrees aren't clobbered.
    const current = await fetchLeadSettingRawData();
    const dedup: LeadDedupSettingsSubtree = {
        enabled: next.enabled,
        field: next.field,
        scope: next.scope,
        audienceIds: next.scope === 'SELECTED' ? next.audienceIds : [],
        action: next.action,
        repeatLead: next.action === 'ALLOW_REASSIGN' ? next.repeatLead : REPEAT_LEAD_SETTINGS_DEFAULTS,
    };
    const merged = { ...current, dedup };
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Lead Settings', setting_data: merged },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
}

/** Single-counsellor search picker — mirrors the autosuggest pattern in
 * routes/settings/-components/School/Counsellor.tsx, simplified to one pick. */
function CounsellorPicker({
    counsellorId,
    counsellorName,
    onChange,
}: {
    counsellorId: string | null;
    counsellorName: string | null;
    onChange: (id: string | null, name: string | null) => void;
}) {
    const { t } = useTranslation('settingsLeadDedup');
    const [query, setQuery] = useState('');
    const { data: suggestions, isLoading } = useUserAutosuggestDebounced(
        query,
        [USER_ROLES.ADMIN, USER_ROLES.COUNSELLOR],
        300
    );

    if (counsellorId) {
        return (
            <div className="flex max-w-sm items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span className="text-sm">{counsellorName || counsellorId}</span>
                <button
                    type="button"
                    onClick={() => onChange(null, null)}
                    className="text-neutral-400 hover:text-neutral-600"
                    aria-label={t('counsellorPicker.clearAriaLabel')}
                >
                    <X size={14} />
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-sm">
            <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('counsellorPicker.searchPlaceholder')}
            />
            {isLoading && (
                <p className="mt-1 text-xs text-muted-foreground">{t('counsellorPicker.searching')}</p>
            )}
            {suggestions && suggestions.length > 0 && query && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border">
                    {suggestions.map((user) => (
                        <button
                            key={user.id}
                            type="button"
                            onClick={() => {
                                onChange(user.id, user.full_name);
                                setQuery('');
                            }}
                            className="w-full border-b p-2 text-left text-sm transition-colors last:border-0 hover:bg-neutral-50"
                        >
                            <div className="font-medium">{user.full_name}</div>
                            <div className="text-xs text-muted-foreground">{user.email}</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function LeadDedupSettings() {
    const { t } = useTranslation('settingsLeadDedup');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';
    const { tiers } = useLeadTiers();
    const terminology = useLeadTerminology();

    const { data: saved, isLoading } = useQuery({
        queryKey: LEAD_DEDUP_SETTINGS_QUERY_KEY,
        queryFn: fetchLeadDedupSettings,
        staleTime: 5 * 60 * 1000,
    });

    // All lead lists in the institute, for the "specific lead lists" multi-select
    // and for detecting a full selection (→ auto-switch to institute-wide).
    const { data: campaignsPage, isLoading: campaignsLoading } = useCampaignsList({
        institute_id: instituteId,
        page: 0,
        size: 200,
    });
    const audienceOptions: OptionType[] = (campaignsPage?.content ?? []).map((c) => ({
        // AudienceDTO's actual id field is `id` (== Audience.id, the FK
        // audience_response.audience_id points at); campaign_id/audience_id are
        // defensive aliases in case a different serializer shape shows up.
        value: c.id ?? c.audience_id ?? c.campaign_id ?? '',
        label: c.campaign_name,
    }));

    const [enabled, setEnabled] = useState(false);
    const [field, setField] = useState<LeadDedupField>('EMAIL');
    const [scope, setScope] = useState<LeadDedupScope>('CAMPAIGN');
    const [audienceIds, setAudienceIds] = useState<string[]>([]);
    const [action, setAction] = useState<LeadDedupAction>('REJECT');
    const [repeatLead, setRepeatLead] = useState<RepeatLeadSettings>(REPEAT_LEAD_SETTINGS_DEFAULTS);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (saved) {
            setEnabled(saved.enabled);
            setField(saved.field);
            setScope(saved.scope);
            setAudienceIds(saved.audienceIds);
            setAction(saved.action);
            setRepeatLead(saved.repeatLead);
            setHasChanges(false);
        }
    }, [saved]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveDedupSettings,
        onSuccess: () => {
            toast.success(t('toasts.saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: LEAD_DEDUP_SETTINGS_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: ['lead-settings-config'] });
            queryClient.invalidateQueries({ queryKey: ['lead-settings'] });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    const handleSave = () => {
        if (scope === 'SELECTED' && audienceIds.length === 0) {
            toast.error(t('toasts.pickLeadList'));
            return;
        }
        if (action === 'ALLOW_REASSIGN' && repeatLead.counsellorMode === 'SPECIFIC' && !repeatLead.specificCounsellorId) {
            toast.error(t('toasts.pickCounsellor'));
            return;
        }
        save({ enabled, field, scope, audienceIds, action, repeatLead });
    };

    // Picking every currently-available lead list is equivalent to "the whole
    // institute" and stays correct as new lead lists get created later, so
    // collapse it to the INSTITUTE scope instead of storing a static id list.
    const handleAudienceSelectionChange = (ids: string[]) => {
        if (audienceOptions.length > 0 && ids.length === audienceOptions.length) {
            setScope('INSTITUTE');
            setAudienceIds([]);
        } else {
            setAudienceIds(ids);
        }
        setHasChanges(true);
    };

    const updateRepeatLead = (patch: Partial<RepeatLeadSettings>) => {
        setRepeatLead((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const updateReattempt = (patch: Partial<ReattemptSettings>) => {
        setRepeatLead((prev) => ({ ...prev, reattempt: { ...prev.reattempt, ...patch } }));
        setHasChanges(true);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Fingerprint size={18} className="text-neutral-500" />
                    {t('header.title')}
                </CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="text-sm text-muted-foreground">{t('loading')}</div>
                ) : (
                    <div className="flex flex-col gap-5">
                        <div className="flex items-center gap-3">
                            <Switch
                                id="dedup-enabled"
                                checked={enabled}
                                onCheckedChange={(v) => {
                                    setEnabled(v);
                                    setHasChanges(true);
                                }}
                            />
                            <Label htmlFor="dedup-enabled" className="cursor-pointer">
                                {enabled ? t('enabled.enabled') : t('enabled.disabled')}
                            </Label>
                        </div>

                        {enabled && (
                            <>
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="dedup-field">{t('fields.matchBy.label')}</Label>
                                    <p className="text-xs text-muted-foreground">
                                        {t('fields.matchBy.hint')}
                                    </p>
                                    <Select
                                        value={field}
                                        onValueChange={(v) => {
                                            setField(v as LeadDedupField);
                                            setHasChanges(true);
                                        }}
                                    >
                                        <SelectTrigger id="dedup-field" className="w-full max-w-sm">
                                            <SelectValue placeholder={t('fields.matchBy.placeholder')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="EMAIL">
                                                {t('fields.matchBy.options.email')}
                                            </SelectItem>
                                            <SelectItem value="PHONE">
                                                {t('fields.matchBy.options.phone')}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="dedup-scope">{t('fields.scope.label')}</Label>
                                    <p className="text-xs text-muted-foreground">
                                        {t('fields.scope.hint')}
                                    </p>
                                    <Select
                                        value={scope}
                                        onValueChange={(v) => {
                                            setScope(v as LeadDedupScope);
                                            setHasChanges(true);
                                        }}
                                    >
                                        <SelectTrigger id="dedup-scope" className="w-full max-w-sm">
                                            <SelectValue placeholder={t('fields.scope.placeholder')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="CAMPAIGN">
                                                {t('fields.scope.options.campaign')}
                                            </SelectItem>
                                            <SelectItem value="SELECTED">
                                                {t('fields.scope.options.selected')}
                                            </SelectItem>
                                            <SelectItem value="INSTITUTE">
                                                {t('fields.scope.options.institute')}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {scope === 'SELECTED' && (
                                    <div className="flex flex-col gap-1.5">
                                        <Label>{t('fields.audienceLists.label')}</Label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('fields.audienceLists.hint')}
                                        </p>
                                        <MultiSelect
                                            options={audienceOptions}
                                            selected={audienceIds}
                                            onChange={handleAudienceSelectionChange}
                                            placeholder={
                                                campaignsLoading
                                                    ? t('fields.audienceLists.placeholderLoading')
                                                    : t('fields.audienceLists.placeholder')
                                            }
                                            disabled={campaignsLoading}
                                            className="max-w-sm"
                                        />
                                    </div>
                                )}

                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="dedup-action">{t('fields.action.label')}</Label>
                                    <p className="text-xs text-muted-foreground">
                                        {t('fields.action.hint')}
                                    </p>
                                    <Select
                                        value={action}
                                        onValueChange={(v) => {
                                            setAction(v as LeadDedupAction);
                                            setHasChanges(true);
                                        }}
                                    >
                                        <SelectTrigger id="dedup-action" className="w-full max-w-sm">
                                            <SelectValue placeholder={t('fields.action.placeholder')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="REJECT">
                                                {t('fields.action.options.reject')}
                                            </SelectItem>
                                            <SelectItem value="ALLOW_REASSIGN">
                                                {t('fields.action.options.allowReassign')}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {action === 'ALLOW_REASSIGN' && (
                                    <div className="flex flex-col gap-4 rounded-md border p-4">
                                        <p className="text-sm font-medium">{t('repeatLead.title')}</p>

                                        <div className="flex flex-col gap-1.5">
                                            <Label htmlFor="repeat-counsellor-mode">
                                                {t('repeatLead.counsellorMode.label')}
                                            </Label>
                                            <Select
                                                value={repeatLead.counsellorMode}
                                                onValueChange={(v) =>
                                                    updateRepeatLead({
                                                        counsellorMode: v as RepeatLeadCounsellorMode,
                                                    })
                                                }
                                            >
                                                <SelectTrigger
                                                    id="repeat-counsellor-mode"
                                                    className="w-full max-w-sm"
                                                >
                                                    <SelectValue
                                                        placeholder={t('repeatLead.counsellorMode.placeholder')}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="NONE">
                                                        {t('repeatLead.counsellorMode.options.none')}
                                                    </SelectItem>
                                                    <SelectItem value="SAME_AS_PREVIOUS">
                                                        {t('repeatLead.counsellorMode.options.sameAsPrevious')}
                                                    </SelectItem>
                                                    <SelectItem value="SPECIFIC">
                                                        {t('repeatLead.counsellorMode.options.specific')}
                                                    </SelectItem>
                                                    <SelectItem value="ROUND_ROBIN">
                                                        {t('repeatLead.counsellorMode.options.roundRobin')}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {repeatLead.counsellorMode === 'SPECIFIC' && (
                                            <div className="flex flex-col gap-1.5">
                                                <Label>{t('repeatLead.counsellorPicker.label')}</Label>
                                                <CounsellorPicker
                                                    counsellorId={repeatLead.specificCounsellorId}
                                                    counsellorName={repeatLead.specificCounsellorName}
                                                    onChange={(id, name) =>
                                                        updateRepeatLead({
                                                            specificCounsellorId: id,
                                                            specificCounsellorName: name,
                                                        })
                                                    }
                                                />
                                            </div>
                                        )}

                                        <div className="flex flex-col gap-1.5">
                                            <Label htmlFor="repeat-status-mode">
                                                {t('repeatLead.statusMode.label')}
                                            </Label>
                                            <Select
                                                value={repeatLead.statusMode}
                                                onValueChange={(v) =>
                                                    updateRepeatLead({
                                                        statusMode: v as RepeatLeadStatusMode,
                                                    })
                                                }
                                            >
                                                <SelectTrigger
                                                    id="repeat-status-mode"
                                                    className="w-full max-w-sm"
                                                >
                                                    <SelectValue
                                                        placeholder={t('repeatLead.statusMode.placeholder')}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="KEEP_EXISTING">
                                                        {t('repeatLead.statusMode.options.keepExisting')}
                                                    </SelectItem>
                                                    <SelectItem value="RESET_TO_NEW">
                                                        {t('repeatLead.statusMode.options.resetToNew')}
                                                    </SelectItem>
                                                    <SelectItem value="RESET_CLOSED_TO_NEW">
                                                        {t(
                                                            'repeatLead.statusMode.options.resetClosedToNew'
                                                        )}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {field === 'PHONE' && (
                                            <>
                                                <div className="flex items-start gap-3">
                                                    <Switch
                                                        id="repeat-same-person"
                                                        checked={repeatLead.samePersonByPhone}
                                                        onCheckedChange={(v) =>
                                                            updateRepeatLead({
                                                                samePersonByPhone: v,
                                                            })
                                                        }
                                                    />
                                                    <div className="flex flex-col gap-0.5">
                                                        <Label
                                                            htmlFor="repeat-same-person"
                                                            className="cursor-pointer"
                                                        >
                                                            {t(
                                                                'repeatLead.samePersonByPhone.label'
                                                            )}
                                                        </Label>
                                                        <p className="text-xs text-muted-foreground">
                                                            {t('repeatLead.samePersonByPhone.hint')}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-start gap-3">
                                                    <Switch
                                                        id="repeat-also-email"
                                                        checked={repeatLead.alsoMatchEmail}
                                                        onCheckedChange={(v) =>
                                                            updateRepeatLead({
                                                                alsoMatchEmail: v,
                                                            })
                                                        }
                                                    />
                                                    <div className="flex flex-col gap-0.5">
                                                        <Label
                                                            htmlFor="repeat-also-email"
                                                            className="cursor-pointer"
                                                        >
                                                            {t('repeatLead.alsoMatchEmail.label')}
                                                        </Label>
                                                        <p className="text-xs text-muted-foreground">
                                                            {t('repeatLead.alsoMatchEmail.hint')}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-start gap-3">
                                                    <Switch
                                                        id="repeat-block-owned"
                                                        checked={repeatLead.blockOwnedManualAdd}
                                                        onCheckedChange={(v) =>
                                                            updateRepeatLead({
                                                                blockOwnedManualAdd: v,
                                                            })
                                                        }
                                                    />
                                                    <div className="flex flex-col gap-0.5">
                                                        <Label
                                                            htmlFor="repeat-block-owned"
                                                            className="cursor-pointer"
                                                        >
                                                            {t(
                                                                'repeatLead.blockOwnedManualAdd.label'
                                                            )}
                                                        </Label>
                                                        <p className="text-xs text-muted-foreground">
                                                            {t(
                                                                'repeatLead.blockOwnedManualAdd.hint'
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        <div className="flex items-start gap-3">
                                            <Switch
                                                id="repeat-block-open"
                                                checked={repeatLead.blockOpenLeadManualAdd}
                                                onCheckedChange={(v) =>
                                                    updateRepeatLead({ blockOpenLeadManualAdd: v })
                                                }
                                            />
                                            <div className="flex flex-col gap-0.5">
                                                <Label htmlFor="repeat-block-open" className="cursor-pointer">
                                                    {t('repeatLead.blockOpenLeadManualAdd.label')}
                                                </Label>
                                                <p className="text-xs text-muted-foreground">
                                                    {t('repeatLead.blockOpenLeadManualAdd.hint')}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-3 border-t pt-4">
                                            <div className="flex flex-col gap-0.5">
                                                <p className="text-sm font-medium">
                                                    {t('repeatLead.reattempt.title')}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {t('repeatLead.reattempt.hint')}
                                                </p>
                                            </div>
                                            {REATTEMPT_SWITCHES.map((key) => (
                                                <div key={key} className="flex items-start gap-3">
                                                    <Switch
                                                        id={`repeat-reattempt-${key}`}
                                                        checked={repeatLead.reattempt[key]}
                                                        onCheckedChange={(v) =>
                                                            updateReattempt({ [key]: v })
                                                        }
                                                    />
                                                    <div className="flex flex-col gap-0.5">
                                                        <Label
                                                            htmlFor={`repeat-reattempt-${key}`}
                                                            className="cursor-pointer"
                                                        >
                                                            {t(`repeatLead.reattempt.${key}.label`)}
                                                        </Label>
                                                        <p className="text-xs text-muted-foreground">
                                                            {t(`repeatLead.reattempt.${key}.hint`)}
                                                        </p>
                                                        {key === 'markDuplicate' &&
                                                            repeatLead.reattempt.markDuplicate && (
                                                                <div className="mt-2 flex items-start gap-2">
                                                                    <Switch
                                                                        id="repeat-reattempt-open-only"
                                                                        checked={
                                                                            repeatLead.reattempt
                                                                                .duplicateOpenOnly
                                                                        }
                                                                        onCheckedChange={(v) =>
                                                                            updateReattempt({
                                                                                duplicateOpenOnly:
                                                                                    v,
                                                                            })
                                                                        }
                                                                    />
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <Label
                                                                            htmlFor="repeat-reattempt-open-only"
                                                                            className="cursor-pointer"
                                                                        >
                                                                            {t(
                                                                                'repeatLead.reattempt.duplicateOpenOnly.label'
                                                                            )}
                                                                        </Label>
                                                                        <p className="text-xs text-muted-foreground">
                                                                            {t(
                                                                                'repeatLead.reattempt.duplicateOpenOnly.hint'
                                                                            )}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            )}
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="flex flex-col gap-1.5">
                                                <Label htmlFor="repeat-reattempt-tier">
                                                    {t('repeatLead.reattempt.tier.label', {
                                                        tier: terminology.tier,
                                                    })}
                                                </Label>
                                                <p className="text-xs text-muted-foreground">
                                                    {t('repeatLead.reattempt.tier.hint')}
                                                </p>
                                                <Select
                                                    value={repeatLead.reattempt.tier ?? KEEP_TIER}
                                                    onValueChange={(v) =>
                                                        updateReattempt({
                                                            tier: v === KEEP_TIER ? null : v,
                                                        })
                                                    }
                                                >
                                                    <SelectTrigger
                                                        id="repeat-reattempt-tier"
                                                        className="w-full max-w-sm"
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value={KEEP_TIER}>
                                                            {t('repeatLead.reattempt.tier.keep')}
                                                        </SelectItem>
                                                        {tiers.map((tier) => (
                                                            <SelectItem
                                                                key={tier.tier_key}
                                                                value={tier.tier_key}
                                                            >
                                                                {tier.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        <div className="flex items-center justify-end">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleSave}
                                disable={saving || !hasChanges}
                            >
                                {saving ? t('footer.saving') : t('footer.save')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
