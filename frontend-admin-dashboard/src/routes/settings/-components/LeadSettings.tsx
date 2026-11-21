import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import LeadStatusesManager from './LeadStatusesManager';
import LeadTiersManager from './LeadTiersManager';
import LeadSlaSettings from './LeadSlaSettings';
import LeadReportSettings from './LeadReportSettings';
import LeadDedupSettings from './LeadDedupSettings';
import LeadFollowUpFieldsSettings from './LeadFollowUpFieldsSettings';
import LeadLookupSettings from './LeadLookupSettings';
import PoolsList from './pools/PoolsList';
import AudienceFormSettings from './AudienceFormSettings';
// LOCAL ONLY — these power the Workbench tab where admins pick the leads team
// and configure the counsellor rating strategy.
import { CounsellorRatingSettings } from './CounsellorRatingSettings';

// ─── Types ───────────────────────────────────────────────────────────────────
// NOTE: Lead statuses and TAT/Follow-up SLA config now live in dedicated DB tables
// (LeadStatusesManager + LeadSlaSettings). The LEAD_SETTING JSON only keeps the
// scoring/visibility config below.

export interface LeadSettingsData {
    /** If false, all lead-related UI (scores, tiers, sidebar tab) is hidden across the institute. */
    enabled: boolean;

    /** Scoring factor weights. Must sum to 100. */
    scoringWeights: {
        sourceQuality: number;
        profileCompleteness: number;
        recency: number;
        engagement: number;
    };

    /** Max days before recency score starts decaying. */
    recencyDecayDays: number;

    showScoreInEnquiryTable: boolean;
    showScoreInContactsTable: boolean;
    showScoreInStudentsTable: boolean;
    /** Hide converted leads from the unfiltered "All leads" view (Recent Leads + Lead List). */
    hideConvertedInAllLeads: boolean;
    showConvertedFilterOption: boolean;
    /** Keep LOST leads out of every Follow-ups bucket, Completed included. On by default. */
    hideLostInFollowUps: boolean;
    /**
     * Institute-specific names for the built-in lead attributes (e.g. Tier → "Interest
     * Level", Lead status → "Action Label"). Blank = platform default. Read everywhere
     * through useLeadTerminology().
     */
    labels?: { tier?: string; leadStatus?: string; campaignType?: string };
}

const DEFAULT_LEAD_SETTINGS: LeadSettingsData = {
    enabled: true,
    scoringWeights: {
        sourceQuality: 25,
        profileCompleteness: 30,
        recency: 25,
        engagement: 20,
    },
    recencyDecayDays: 30,
    showScoreInEnquiryTable: true,
    showScoreInContactsTable: true,
    showScoreInStudentsTable: true,
    hideConvertedInAllLeads: false,
    showConvertedFilterOption: true,
    hideLostInFollowUps: true,
    labels: {},
};

const SETTING_KEY = 'LEAD_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

// ─── API ─────────────────────────────────────────────────────────────────────

const fetchLeadSettings = async (): Promise<LeadSettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    // GET returns the SettingDto itself ({key, name, data}) — response.data IS
    // the SettingDto, so its content is one level down at response.data.data.
    const saved = response.data?.data as Partial<LeadSettingsData> | undefined;
    if (!saved) return DEFAULT_LEAD_SETTINGS;
    return {
        ...DEFAULT_LEAD_SETTINGS,
        ...saved,
        scoringWeights: { ...DEFAULT_LEAD_SETTINGS.scoringWeights, ...saved.scoringWeights },
        // On unless explicitly switched off - older blobs have no key.
        hideLostInFollowUps: saved.hideLostInFollowUps !== false,
    };
};

const saveLeadSettings = async (data: LeadSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Lead Settings', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

function weightsSum(w: LeadSettingsData['scoringWeights']): number {
    return w.sourceQuality + w.profileCompleteness + w.recency + w.engagement;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function LeadSettings() {
    const { t } = useTranslation('settingsLead');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<LeadSettingsData>(DEFAULT_LEAD_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['lead-settings'],
        queryFn: fetchLeadSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveLeadSettings,
        onSuccess: () => {
            toast.success(t('toasts.saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['lead-settings'] });
            queryClient.invalidateQueries({ queryKey: ['lead-settings-config'] });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    const update = (patch: Partial<LeadSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const updateLabel = (key: 'tier' | 'leadStatus' | 'campaignType', value: string) => {
        setSettings((prev) => ({ ...prev, labels: { ...(prev.labels ?? {}), [key]: value } }));
        setHasChanges(true);
    };

    const updateWeight = (key: keyof LeadSettingsData['scoringWeights'], value: number) => {
        setSettings((prev) => ({
            ...prev,
            scoringWeights: { ...prev.scoringWeights, [key]: value },
        }));
        setHasChanges(true);
    };

    const handleSave = () => {
        const total = weightsSum(settings.scoringWeights);
        if (total !== 100) {
            toast.error(t('toasts.weightsSumError', { total }));
            return;
        }
        save(settings);
    };

    const weightTotal = weightsSum(settings.scoringWeights);
    const weightError = weightTotal !== 100;

    return (
        <div className="p-6">
            <Tabs defaultValue="config" className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="config">{t('tabs.config')}</TabsTrigger>
                    <TabsTrigger value="pools">{t('tabs.pools')}</TabsTrigger>
                    <TabsTrigger value="forms">{t('tabs.forms')}</TabsTrigger>
                    <TabsTrigger value="workbench">{t('tabs.workbench')}</TabsTrigger>
                </TabsList>

                <TabsContent value="config" className="space-y-6">
                    {isLoading ? (
                        <div className="text-sm text-muted-foreground">{t('loading')}</div>
                    ) : (
                        <ConfigSection
                            settings={settings}
                            update={update}
                            updateLabel={updateLabel}
                            updateWeight={updateWeight}
                            weightTotal={weightTotal}
                            weightError={weightError}
                            handleSave={handleSave}
                            saving={saving}
                            hasChanges={hasChanges}
                        />
                    )}
                </TabsContent>

                <TabsContent value="pools">
                    <PoolsList />
                </TabsContent>

                {/* Institute-wide defaults for audience-list forms — currently the
                    post-submit (thank-you / redirect) block that every new campaign
                    is prefilled with. */}
                <TabsContent value="forms" className="space-y-6">
                    <AudienceFormSettings />
                </TabsContent>

                <TabsContent value="workbench" className="space-y-6">
                    <CounsellorRatingSettings />
                </TabsContent>
            </Tabs>
        </div>
    );
}

interface ConfigSectionProps {
    settings: LeadSettingsData;
    update: (patch: Partial<LeadSettingsData>) => void;
    updateLabel: (key: 'tier' | 'leadStatus' | 'campaignType', value: string) => void;
    updateWeight: (key: keyof LeadSettingsData['scoringWeights'], value: number) => void;
    weightTotal: number;
    weightError: boolean;
    handleSave: () => void;
    saving: boolean;
    hasChanges: boolean;
}

function ConfigSection({
    settings,
    update,
    updateLabel,
    updateWeight,
    weightTotal,
    weightError,
    handleSave,
    saving,
    hasChanges,
}: ConfigSectionProps) {
    const { t } = useTranslation('settingsLead');
    return (
        <div className="space-y-6">
            {/* ── Enable / Disable Lead System ── */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('enableCard.title')}</CardTitle>
                    <CardDescription>{t('enableCard.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-3">
                        <Switch
                            id="lead-enabled"
                            checked={settings.enabled}
                            onCheckedChange={(v) => update({ enabled: v })}
                        />
                        <Label htmlFor="lead-enabled" className="cursor-pointer">
                            {settings.enabled ? t('enableCard.enabled') : t('enableCard.disabled')}
                        </Label>
                    </div>
                </CardContent>
            </Card>

            {settings.enabled && (
                <>
                    {/* ── Score Badge Visibility ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('visibilityCard.title')}</CardTitle>
                            <CardDescription>{t('visibilityCard.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {(
                                [
                                    [
                                        'showScoreInEnquiryTable',
                                        t('visibilityCard.options.enquiryTable'),
                                    ],
                                    [
                                        'showScoreInContactsTable',
                                        t('visibilityCard.options.contactsTable'),
                                    ],
                                    [
                                        'showScoreInStudentsTable',
                                        t('visibilityCard.options.studentsTable'),
                                    ],
                                ] as [keyof LeadSettingsData, string][]
                            ).map(([key, label]) => (
                                <div key={key} className="flex items-center gap-3">
                                    <Switch
                                        id={key}
                                        checked={settings[key] as boolean}
                                        onCheckedChange={(v) => update({ [key]: v })}
                                    />
                                    <Label htmlFor={key} className="cursor-pointer">
                                        {label}
                                    </Label>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    {/* ── All leads view: hide converted leads from the unfiltered list ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('allLeadsCard.title')}</CardTitle>
                            <CardDescription>{t('allLeadsCard.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="hideConvertedInAllLeads"
                                    checked={settings.hideConvertedInAllLeads}
                                    onCheckedChange={(v) => update({ hideConvertedInAllLeads: v })}
                                />
                                <Label htmlFor="hideConvertedInAllLeads" className="cursor-pointer">
                                    {t('allLeadsCard.hideConverted')}
                                </Label>
                            </div>
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="showConvertedFilterOption"
                                    checked={settings.showConvertedFilterOption}
                                    onCheckedChange={(v) =>
                                        update({ showConvertedFilterOption: v })
                                    }
                                />
                                <Label
                                    htmlFor="showConvertedFilterOption"
                                    className="cursor-pointer"
                                >
                                    {t('allLeadsCard.showConvertedFilter')}
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('allLeadsCard.showConvertedFilterHint')}
                            </p>
                        </CardContent>
                    </Card>

                    {/* ── Follow-ups: keep lost leads out of every bucket ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('followUpsCard.title')}</CardTitle>
                            <CardDescription>{t('followUpsCard.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="hideLostInFollowUps"
                                    checked={settings.hideLostInFollowUps}
                                    onCheckedChange={(v) => update({ hideLostInFollowUps: v })}
                                />
                                <Label htmlFor="hideLostInFollowUps" className="cursor-pointer">
                                    {t('followUpsCard.hideLost')}
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('followUpsCard.hideLostHint')}
                            </p>
                        </CardContent>
                    </Card>

                    {/* ── Scoring Weights ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('weightsCard.title')}</CardTitle>
                            <CardDescription>{t('weightsCard.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {(
                                [
                                    [
                                        'sourceQuality',
                                        t('weightsCard.factors.sourceQuality.label'),
                                        t('weightsCard.factors.sourceQuality.description'),
                                    ],
                                    [
                                        'profileCompleteness',
                                        t('weightsCard.factors.profileCompleteness.label'),
                                        t('weightsCard.factors.profileCompleteness.description'),
                                    ],
                                    [
                                        'recency',
                                        t('weightsCard.factors.recency.label'),
                                        t('weightsCard.factors.recency.description'),
                                    ],
                                    [
                                        'engagement',
                                        t('weightsCard.factors.engagement.label'),
                                        t('weightsCard.factors.engagement.description'),
                                    ],
                                ] as [keyof LeadSettingsData['scoringWeights'], string, string][]
                            ).map(([key, label, desc]) => (
                                <div
                                    key={key}
                                    className="grid grid-cols-[1fr_80px] items-start gap-4"
                                >
                                    <div>
                                        <p className="text-sm font-medium">{label}</p>
                                        <p className="text-xs text-muted-foreground">{desc}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={settings.scoringWeights[key]}
                                            onChange={(e) =>
                                                updateWeight(key, parseInt(e.target.value, 10) || 0)
                                            }
                                            className="w-16 text-center"
                                        />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </div>
                            ))}

                            <Separator />

                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{t('weightsCard.total')}</span>
                                <span
                                    className={
                                        weightError
                                            ? 'font-bold text-danger-600'
                                            : 'font-bold text-success-600'
                                    }
                                >
                                    {weightTotal} / 100
                                    {weightError && ` — ${t('weightsCard.mustEqual100')}`}
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── Recency Decay ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('recencyCard.title')}</CardTitle>
                            <CardDescription>
                                {t('recencyCard.description', {
                                    days: settings.recencyDecayDays,
                                })}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-3">
                                <Input
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={settings.recencyDecayDays}
                                    onChange={(e) =>
                                        update({
                                            recencyDecayDays: parseInt(e.target.value, 10) || 30,
                                        })
                                    }
                                    className="w-24"
                                />
                                <span className="text-sm text-muted-foreground">
                                    {t('recencyCard.unit')}
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── Terminology: what this institute calls Tier / Lead status / Campaign type ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('terminologyCard.title')}</CardTitle>
                            <CardDescription>{t('terminologyCard.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="lead-label-tier">
                                    {t('terminologyCard.tierLabel')}
                                </Label>
                                <Input
                                    id="lead-label-tier"
                                    value={settings.labels?.tier ?? ''}
                                    placeholder={t('terminologyCard.tierPlaceholder')}
                                    maxLength={40}
                                    onChange={(e) => updateLabel('tier', e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="lead-label-status">
                                    {t('terminologyCard.leadStatusLabel')}
                                </Label>
                                <Input
                                    id="lead-label-status"
                                    value={settings.labels?.leadStatus ?? ''}
                                    placeholder={t('terminologyCard.leadStatusPlaceholder')}
                                    maxLength={40}
                                    onChange={(e) => updateLabel('leadStatus', e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="lead-label-campaign-type">
                                    {t('terminologyCard.campaignTypeLabel')}
                                </Label>
                                <Input
                                    id="lead-label-campaign-type"
                                    value={settings.labels?.campaignType ?? ''}
                                    placeholder={t('terminologyCard.campaignTypePlaceholder')}
                                    maxLength={40}
                                    onChange={(e) => updateLabel('campaignType', e.target.value)}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground sm:col-span-2">
                                {t('terminologyCard.hint')}
                            </p>
                        </CardContent>
                    </Card>

                    {/* ── Score / visibility save (its own action; statuses + reminders save separately) ── */}
                    <div className="flex items-center justify-end">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleSave}
                            disable={saving || !hasChanges}
                        >
                            {saving ? t('saveButton.saving') : t('saveButton.save')}
                        </MyButton>
                    </div>

                    {/* ── Reports Center config (LEAD_SETTING.data.reports subtree) ── */}
                    <LeadReportSettings />

                    {/* ── Lead uniqueness / deduplication (LEAD_SETTING.data.dedup subtree) ── */}
                    <LeadDedupSettings />

                    {/* ── TAT + Follow-up reminders (table-backed) ── */}
                    <LeadSlaSettings />

                    {/* ── Follow-up form dropdowns (LEAD_SETTING.data.followUpFields subtree) ── */}
                    <LeadFollowUpFieldsSettings />

                    {/* ── Check Lead duplicate lookup (LEAD_SETTING.data.leadLookup subtree) ── */}
                    <LeadLookupSettings />

                    {/* ── Lead Statuses (table-backed CRUD) ── */}
                    <LeadStatusesManager />

                    {/* ── Lead Tiers (table-backed CRUD; Hot/Warm/Cold seeded, custom levels + score bands) ── */}
                    <LeadTiersManager />
                </>
            )}
        </div>
    );
}
