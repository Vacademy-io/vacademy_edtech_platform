import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { Info, Plus, Robot, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { Link, useNavigate } from '@tanstack/react-router';
import { fetchAiVoiceCarrier } from '@/routes/settings/telephony/-services/ai-voice-carrier';
import { AiAgentsCard } from './AiAgentsCard';
import { AiCallingApiCard } from './AiCallingApiCard';
import { noAutofillProps } from '@/lib/no-autofill';

// ─── Types ───────────────────────────────────────────────────────────────────
// Stored under the institute's AI_CALLING_SETTING JSON. The backend EVALUATE
// node reads this to decide, per call outcome, whether to assign a counsellor or
// keep retrying. Recording + AI summary are shown on the lead profile first;
// assignment only happens when these rules say so.

type AssignmentMode = 'ROUND_ROBIN' | 'TIME_BASED' | 'MANUAL';

/** One calling window. `start`/`end` are "HH:mm" (24h, institute timezone). */
export interface Shift {
    start: string;
    end: string;
}

/** Direction of an AI campaign: we dial the lead (Outbound), or the lead dials our AI line (Inbound). */
export type CampaignDirection = 'OUTBOUND' | 'INBOUND';

/**
 * One registered AI campaign. `name` is the provider-agnostic agent a workflow author
 * picks (e.g. "Class Feedback"); `campaignId` is the raw id `provider` uses for it; the
 * same `name` can repeat once per provider so switching provider resolves to the right id.
 * Inbound-tagged ids also let the backend classify an incoming webhook (matched by phone).
 */
export interface Campaign {
    campaignId: string;
    name: string;
    direction: CampaignDirection;
    /** Provider this campaign id belongs to (e.g. AAVTAAR). Blank ⇒ any provider. */
    provider?: string;
}

export interface AiCallingSettingsData {
    /** Master switch — when off, no AI calls are placed for this institute. */
    enabled: boolean;
    /**
     * Show the manual "AI call" robot button in lead lists. Independent of
     * `enabled`: turning this off only hides the icon — AI workflows keep running.
     */
    showInLeadList: boolean;
    /** AI-voice provider code (e.g. "AAVTAAR"). Selects which backend adapter places calls. */
    provider: string;
    /** Provider campaign id (AI script/persona) used for outbound AI calls. */
    defaultCampaignId: string;
    /**
     * Campaign registry: every provider campaign id this institute uses, each tagged
     * Inbound or Outbound. Inbound-tagged ids classify incoming AI-call webhooks (the
     * lead dialed our AI line); the rest are informational/outbound.
     */
    campaigns: Campaign[];
    /** A call shorter than this (seconds) counts as "didn't really connect" → retry. */
    connectThresholdSec: number;

    // Retry policy
    maxRetries: number;
    maxCallsPerDayPerLead: number;
    /** Minutes the bot waits before re-dialing a no-answer lead. */
    retryGapMinutes: number;
    /** Minutes before re-checking a lead deferred (outside shift / at the day cap). */
    recheckMinutes: number;
    /** Time windows the bot may (re)dial in — supports multiple shifts. */
    callingShifts: Shift[];
    timezone: string; // e.g. "Asia/Kolkata"

    // Outcome → action. Dispositions in neither list are retried until max, then
    // assigned to a human.
    assignOnDispositions: string[];
    stopOnDispositions: string[];
    /**
     * Admin-defined outcomes beyond the built-in set — the disposition strings the
     * institute's own AI agent can return. They appear as extra rows in the
     * Outcome → Action table and behave exactly like the built-ins.
     */
    customDispositions: string[];

    // Counsellor assignment
    assignmentMode: AssignmentMode;
    assignExhaustedToHuman: boolean;
    reassignQualifiedToPool: boolean;

    /**
     * Auto-capture unknown INBOUND callers as leads. When the AI helpline answers a
     * caller whose number isn't already a lead, a lead is created (or matched) so the
     * call is followable in Recent Leads + the Call Log. Off by default.
     */
    inboundLeadCapture: { enabled: boolean };
}

const DISPOSITIONS = [
    'Interested',
    'Likely_Interested',
    'Callback',
    'Requirement_Not_Clear',
    'Incomplete',
    'Not_Interested',
] as const;

const ASSIGNMENT_MODES: { value: AssignmentMode; labelKey: string }[] = [
    { value: 'ROUND_ROBIN', labelKey: 'assignmentModes.roundRobin' },
    { value: 'TIME_BASED', labelKey: 'assignmentModes.timeBased' },
    { value: 'MANUAL', labelKey: 'assignmentModes.manual' },
];

const DEFAULT_AI_CALLING_SETTINGS: AiCallingSettingsData = {
    enabled: false,
    showInLeadList: false,
    provider: 'AAVTAAR',
    defaultCampaignId: '',
    campaigns: [],
    connectThresholdSec: 20,
    maxRetries: 3,
    maxCallsPerDayPerLead: 3,
    retryGapMinutes: 120,
    recheckMinutes: 30,
    callingShifts: [{ start: '09:00', end: '21:00' }],
    timezone: 'Asia/Kolkata',
    assignOnDispositions: ['Interested', 'Likely_Interested'],
    stopOnDispositions: ['Not_Interested'],
    customDispositions: [],
    assignmentMode: 'ROUND_ROBIN',
    assignExhaustedToHuman: true,
    reassignQualifiedToPool: false,
    inboundLeadCapture: { enabled: false },
};

type AiCallingTabKey = 'general' | 'agents' | 'retries' | 'outcomes' | 'assignment';

const SETTING_KEY = 'AI_CALLING_SETTING';
const GET_URL = `${BASE_URL}/admin-core-service/institute/setting/v1/get`;
const SAVE_URL = `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`;

// ─── Provider metadata ─────────────────────────────────────────────────────────
// Per-provider UI copy. The list of selectable providers comes from the backend
// (what's actually wired). Adding an entry here gives a provider nicer labels; any
// provider the backend reports that isn't listed falls back to generic labels — so
// a new AI agent works out-of-the-box with no UI change required.
interface ProviderMeta {
    label: string;
    companyCodeLabel: string;
    companyCodePlaceholder: string;
    tokenLabel: string;
    tokenPlaceholder: string;
    campaignPlaceholder: string;
    campaignHelp: string;
}
const PROVIDER_META_BUILDERS: Record<string, (t: TFunction) => ProviderMeta> = {
    AAVTAAR: (t) => ({
        label: t('provider.aavtaar.label'),
        companyCodeLabel: t('provider.aavtaar.companyCodeLabel'),
        companyCodePlaceholder: t('provider.aavtaar.companyCodePlaceholder'),
        tokenLabel: t('provider.aavtaar.tokenLabel'),
        tokenPlaceholder: t('provider.aavtaar.tokenPlaceholder'),
        campaignPlaceholder: t('provider.aavtaar.campaignPlaceholder'),
        campaignHelp: t('provider.aavtaar.campaignHelp'),
    }),
    VACADEMY_AI: (t) => ({
        label: t('provider.vacademyAi.label'),
        companyCodeLabel: t('provider.vacademyAi.companyCodeLabel'),
        companyCodePlaceholder: t('provider.vacademyAi.companyCodePlaceholder'),
        tokenLabel: t('provider.vacademyAi.tokenLabel'),
        tokenPlaceholder: t('provider.vacademyAi.tokenPlaceholder'),
        campaignPlaceholder: t('provider.vacademyAi.campaignPlaceholder'),
        campaignHelp: t('provider.vacademyAi.campaignHelp'),
    }),
};
const titleCase = (code: string, t: TFunction) =>
    code ? code.charAt(0).toUpperCase() + code.slice(1).toLowerCase() : t('provider.fallbackLabel');
const metaFor = (code: string, t: TFunction): ProviderMeta =>
    PROVIDER_META_BUILDERS[code]?.(t) ?? {
        label: titleCase(code, t),
        companyCodeLabel: t('provider.fallback.companyCodeLabel'),
        companyCodePlaceholder: t('provider.fallback.companyCodePlaceholder'),
        tokenLabel: t('provider.fallback.tokenLabel'),
        tokenPlaceholder: t('provider.fallback.tokenPlaceholder'),
        campaignPlaceholder: t('provider.fallback.campaignPlaceholder'),
        campaignHelp: t('provider.fallback.campaignHelp'),
    };
const webhookPathFor = (code: string) =>
    code === 'AAVTAAR'
        ? '…/telephony/webhook/aavtaar'
        : `…/telephony/webhook/ai-voice/${(code || '').toLowerCase()}`;

const PROVIDERS_URL = `${BASE_URL}/admin-core-service/v1/telephony/ai-config/meta/providers`;
/** Providers the backend has wired. Falls back to Aavtaar if the endpoint isn't up yet. */
const fetchProviders = async (): Promise<string[]> => {
    try {
        const { data } = await authenticatedAxiosInstance.get<string[]>(PROVIDERS_URL);
        return Array.isArray(data) && data.length ? data : ['AAVTAAR'];
    } catch {
        return ['AAVTAAR'];
    }
};

// ─── API ─────────────────────────────────────────────────────────────────────

const fetchAiCallingSettings = async (): Promise<AiCallingSettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_URL,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    // `/get` returns a SettingDto shape: { key, name, data } — the saved settings
    // live at response.data.data, NOT nested again under the settingKey.
    const saved = response.data?.data as
        | (Partial<AiCallingSettingsData> & { windowStart?: string; windowEnd?: string })
        | undefined;
    if (!saved) return DEFAULT_AI_CALLING_SETTINGS;
    const merged = { ...DEFAULT_AI_CALLING_SETTINGS, ...saved };
    if (!Array.isArray(merged.customDispositions)) merged.customDispositions = [];
    // Migrate the legacy single window → one shift when shifts weren't saved yet.
    if (
        (!saved.callingShifts || saved.callingShifts.length === 0) &&
        (saved.windowStart || saved.windowEnd)
    ) {
        merged.callingShifts = [
            { start: saved.windowStart ?? '09:00', end: saved.windowEnd ?? '21:00' },
        ];
    }
    return merged;
};

const saveAiCallingSettings = async (data: AiCallingSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'AI Calling Settings', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

// ─── Credentials (encrypted, stored in institute_telephony_config) ─────────────
interface AiConfigView {
    companyCode: string | null;
    enabled: boolean;
    hasToken: boolean;
    hasWebhookSecret: boolean;
}
interface AiConfigSave {
    companyCode: string;
    apiToken?: string;
    webhookSecret?: string;
}
const AI_CONFIG_URL = (instituteId: string) =>
    `${BASE_URL}/admin-core-service/v1/telephony/ai-config/${instituteId}`;

const fetchAiConfig = async (): Promise<AiConfigView> => {
    const instituteId = getCurrentInstituteId() ?? '';
    const { data } = await authenticatedAxiosInstance.get<AiConfigView>(AI_CONFIG_URL(instituteId));
    return data;
};

const saveAiConfig = async (payload: AiConfigSave): Promise<void> => {
    const instituteId = getCurrentInstituteId() ?? '';
    await authenticatedAxiosInstance.put(AI_CONFIG_URL(instituteId), payload);
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AiCallingSettings() {
    const { t } = useTranslation('settingsAiCalling');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<AiCallingSettingsData>(DEFAULT_AI_CALLING_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);
    const [newDisposition, setNewDisposition] = useState('');
    const [activeTab, setActiveTab] = useState<AiCallingTabKey>('general');
    const navigate = useNavigate();

    const { data, isLoading } = useQuery({
        queryKey: ['ai-calling-settings'],
        queryFn: fetchAiCallingSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveAiCallingSettings,
        onSuccess: () => {
            toast.success(t('toast.settingsSaved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['ai-calling-settings'] });
        },
        onError: () => {
            toast.error(t('toast.settingsSaveFailed'));
        },
    });

    // ── Credentials (separate from the policy JSON; stored encrypted) ──
    const { data: cfg } = useQuery({
        queryKey: ['ai-calling-config'],
        queryFn: fetchAiConfig,
        staleTime: 5 * 60 * 1000,
    });

    // Providers the backend actually has wired (drives the picker — never hardcoded).
    const { data: providerCodes = ['AAVTAAR'] } = useQuery({
        queryKey: ['ai-voice-providers'],
        queryFn: fetchProviders,
        staleTime: 30 * 60 * 1000,
    });
    const [companyCode, setCompanyCode] = useState('');
    const [apiToken, setApiToken] = useState('');
    const [webhookSecret, setWebhookSecret] = useState('');
    useEffect(() => {
        if (cfg) setCompanyCode(cfg.companyCode ?? '');
    }, [cfg]);

    const { mutate: saveCreds, isPending: savingCreds } = useMutation({
        mutationFn: saveAiConfig,
        onSuccess: () => {
            toast.success(t('toast.credentialsSaved'));
            setApiToken('');
            setWebhookSecret('');
            queryClient.invalidateQueries({ queryKey: ['ai-calling-config'] });
        },
        onError: (err: unknown) => {
            const msg = (err as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.credentialsSaveFailed'));
        },
    });

    const handleSaveCreds = () => {
        const m = metaFor(settings.provider, t);
        if (!companyCode.trim()) {
            toast.error(t('toast.fieldRequired', { field: m.companyCodeLabel }));
            return;
        }
        if (!cfg?.hasToken && !apiToken.trim()) {
            toast.error(t('toast.fieldRequired', { field: m.tokenLabel }));
            return;
        }
        saveCreds({
            companyCode: companyCode.trim(),
            apiToken: apiToken.trim() || undefined,
            webhookSecret: webhookSecret.trim() || undefined,
        });
    };

    const update = (patch: Partial<AiCallingSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const toggleDisposition = (
        field: 'assignOnDispositions' | 'stopOnDispositions',
        disposition: string,
        on: boolean
    ) => {
        setSettings((prev) => {
            const current = new Set(prev[field]);
            if (on) current.add(disposition);
            else current.delete(disposition);
            // A disposition can't be both "assign" and "stop" — clear the other side.
            const other =
                field === 'assignOnDispositions' ? 'stopOnDispositions' : 'assignOnDispositions';
            const otherSet = new Set(prev[other]);
            if (on) otherSet.delete(disposition);
            return { ...prev, [field]: Array.from(current), [other]: Array.from(otherSet) };
        });
        setHasChanges(true);
    };

    const addCustomDisposition = () => {
        const key = newDisposition.trim().replace(/\s+/g, '_');
        if (!key) return;
        const exists = [...DISPOSITIONS, ...settings.customDispositions].some(
            (d) => d.toLowerCase() === key.toLowerCase()
        );
        if (exists) {
            setNewDisposition('');
            return;
        }
        setSettings((prev) => ({
            ...prev,
            customDispositions: [...prev.customDispositions, key],
        }));
        setNewDisposition('');
        setHasChanges(true);
    };

    const removeCustomDisposition = (key: string) => {
        setSettings((prev) => ({
            ...prev,
            customDispositions: prev.customDispositions.filter((d) => d !== key),
            assignOnDispositions: prev.assignOnDispositions.filter((d) => d !== key),
            stopOnDispositions: prev.stopOnDispositions.filter((d) => d !== key),
        }));
        setHasChanges(true);
    };

    const addShift = () => {
        setSettings((prev) => ({
            ...prev,
            callingShifts: [...prev.callingShifts, { start: '09:00', end: '13:00' }],
        }));
        setHasChanges(true);
    };

    const removeShift = (index: number) => {
        setSettings((prev) => ({
            ...prev,
            callingShifts: prev.callingShifts.filter((_, i) => i !== index),
        }));
        setHasChanges(true);
    };

    const updateShift = (index: number, patch: Partial<Shift>) => {
        setSettings((prev) => ({
            ...prev,
            callingShifts: prev.callingShifts.map((s, i) => (i === index ? { ...s, ...patch } : s)),
        }));
        setHasChanges(true);
    };

    const addCampaign = () => {
        setSettings((prev) => ({
            ...prev,
            campaigns: [
                ...(prev.campaigns ?? []),
                { campaignId: '', name: '', direction: 'OUTBOUND', provider: prev.provider },
            ],
        }));
        setHasChanges(true);
    };

    const removeCampaign = (index: number) => {
        setSettings((prev) => ({
            ...prev,
            campaigns: (prev.campaigns ?? []).filter((_, i) => i !== index),
        }));
        setHasChanges(true);
    };

    const updateCampaign = (index: number, patch: Partial<Campaign>) => {
        setSettings((prev) => ({
            ...prev,
            campaigns: (prev.campaigns ?? []).map((c, i) => (i === index ? { ...c, ...patch } : c)),
        }));
        setHasChanges(true);
    };

    // Saving/deleting a Vacademy AI agent bridges its campaign entry into
    // AI_CALLING_SETTING server-side. Mirror that into the LOCAL unsaved state
    // (same replace-by-campaignId logic as the backend bridge, no setHasChanges)
    // so a later "Save changes" on this screen doesn't clobber the bridged entry.
    const mirrorBridgedCampaign = (c: Campaign) => {
        setSettings((prev) => ({
            ...prev,
            campaigns: [...(prev.campaigns ?? []).filter((x) => x.campaignId !== c.campaignId), c],
        }));
    };
    const mirrorRemovedCampaign = (agentId: string) => {
        setSettings((prev) => ({
            ...prev,
            campaigns: (prev.campaigns ?? []).filter((x) => x.campaignId !== agentId),
        }));
    };

    const handleSave = () => {
        if (settings.enabled && !settings.defaultCampaignId.trim()) {
            toast.error(t('toast.campaignIdRequired'));
            return;
        }
        save(settings);
    };

    const meta = metaFor(settings.provider, t);
    const webhookPath = webhookPathFor(settings.provider);

    // Tab labels are built every render (never memoised) so a language switch
    // re-labels them. Retries / Outcome / Assignment exist only while AI calling
    // is enabled — same rule as before the tabs — and the open tab falls back to
    // the first one when it disappears.
    const tabs: { key: AiCallingTabKey; label: string }[] = [
        { key: 'general', label: t('tabs.general') },
        { key: 'agents', label: t('tabs.agents') },
        ...(settings.enabled
            ? [
                  { key: 'retries' as const, label: t('tabs.retries') },
                  { key: 'outcomes' as const, label: t('tabs.outcomes') },
                  { key: 'assignment' as const, label: t('tabs.assignment') },
              ]
            : []),
    ];
    const currentTab = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'general';
    const hasVacademyAi = providerCodes.includes('VACADEMY_AI');

    return (
        <div className="space-y-6 p-6">
            {/* ── Header: policy save lives here so it is reachable from every tab ── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl font-semibold text-neutral-900">
                            {t('header.title')}
                        </h1>
                        {hasChanges && (
                            <span className="rounded-sm bg-warning-50 px-2 py-0.5 text-caption font-medium text-warning-700">
                                {t('header.unsaved')}
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-neutral-500">{t('header.description')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {hasVacademyAi && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => navigate({ to: '/calling/ai-agents' })}
                        >
                            <Robot className="size-4" /> {t('header.aiAgents')}
                        </MyButton>
                    )}
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={handleSave}
                        disable={saving || !hasChanges || isLoading}
                    >
                        {saving ? t('save.saving') : t('save.save')}
                    </MyButton>
                </div>
            </div>

            {!settings.enabled && (
                <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-body text-neutral-600">
                    <Info className="mt-0.5 size-4 shrink-0 text-primary-500" />
                    <span>{t('header.disabledBanner')}</span>
                </div>
            )}

            {/* Every tab stays mounted (hidden while inactive) so switching tabs
                never resets an edit or refetches a card's data. */}
            <Tabs
                value={currentTab}
                onValueChange={(v) => setActiveTab(v as AiCallingTabKey)}
                className="space-y-6"
            >
                <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
                    {tabs.map((tab) => (
                        <TabsTrigger key={tab.key} value={tab.key}>
                            {tab.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent
                    value="general"
                    forceMount
                    className="mt-0 space-y-6 data-[state=inactive]:hidden"
                >
                    {/* ── Enable + Campaign ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('enableCard.title')}</CardTitle>
                            <CardDescription>{t('enableCard.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="ai-calling-enabled"
                                    checked={settings.enabled}
                                    onCheckedChange={(v) => update({ enabled: v })}
                                />
                                <Label htmlFor="ai-calling-enabled" className="cursor-pointer">
                                    {settings.enabled
                                        ? t('enableCard.enabled')
                                        : t('enableCard.disabled')}
                                </Label>
                            </div>

                            <Separator />

                            <div className="flex items-center gap-3">
                                <Switch
                                    id="ai-show-in-lead-list"
                                    checked={settings.showInLeadList}
                                    onCheckedChange={(v) => update({ showInLeadList: v })}
                                />
                                <Label htmlFor="ai-show-in-lead-list" className="cursor-pointer">
                                    {t('enableCard.showInLeadList')}
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('enableCard.showInLeadListHint')}
                            </p>

                            <Separator />

                            <div className="flex items-center gap-3">
                                <Switch
                                    id="ai-inbound-lead-capture"
                                    checked={settings.inboundLeadCapture?.enabled ?? false}
                                    onCheckedChange={(v) =>
                                        update({ inboundLeadCapture: { enabled: v } })
                                    }
                                />
                                <Label htmlFor="ai-inbound-lead-capture" className="cursor-pointer">
                                    {t('enableCard.inboundLeadCapture')}
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('enableCard.inboundLeadCaptureHint')}
                            </p>

                            <Separator />

                            <div className="grid max-w-md gap-2">
                                <Label htmlFor="ai-provider">{t('enableCard.providerLabel')}</Label>
                                <Select
                                    value={settings.provider}
                                    onValueChange={(v) => update({ provider: v })}
                                >
                                    <SelectTrigger id="ai-provider">
                                        <SelectValue
                                            placeholder={t('enableCard.providerPlaceholder')}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {providerCodes.map((code) => (
                                            <SelectItem key={code} value={code}>
                                                {metaFor(code, t).label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {t('enableCard.providerHint')}
                                </p>
                            </div>

                            {settings.provider === 'VACADEMY_AI' && <AiCarrierStatusStrip />}

                            {settings.enabled && (
                                <div className="grid max-w-md gap-2">
                                    <Label htmlFor="ai-campaign-id">
                                        {t('enableCard.defaultCampaignIdLabel')}
                                    </Label>
                                    <Input
                                        id="ai-campaign-id"
                                        value={settings.defaultCampaignId}
                                        placeholder={meta.campaignPlaceholder}
                                        onChange={(e) =>
                                            update({ defaultCampaignId: e.target.value })
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {meta.campaignHelp}
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* ── Credentials ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('credentials.title')}</CardTitle>
                            <CardDescription>{t('credentials.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid max-w-md gap-2">
                                <Label htmlFor="ai-company-code">{meta.companyCodeLabel}</Label>
                                <Input
                                    id="ai-company-code"
                                    value={companyCode}
                                    placeholder={meta.companyCodePlaceholder}
                                    onChange={(e) => setCompanyCode(e.target.value)}
                                />
                            </div>
                            <div className="grid max-w-md gap-2">
                                <Label htmlFor="ai-token">{meta.tokenLabel}</Label>
                                <Input
                                    id="ai-token"
                                    type="password"
                                    {...noAutofillProps('password')}
                                    value={apiToken}
                                    placeholder={
                                        cfg?.hasToken
                                            ? t('credentials.savedPlaceholder')
                                            : meta.tokenPlaceholder
                                    }
                                    onChange={(e) => setApiToken(e.target.value)}
                                />
                            </div>
                            <div className="grid max-w-md gap-2">
                                <Label htmlFor="ai-webhook-secret">
                                    {t('credentials.webhookSecretLabel')}
                                </Label>
                                <Input
                                    id="ai-webhook-secret"
                                    type="password"
                                    {...noAutofillProps('password')}
                                    value={webhookSecret}
                                    placeholder={
                                        cfg?.hasWebhookSecret
                                            ? t('credentials.savedPlaceholder')
                                            : t('credentials.webhookSecretPlaceholder')
                                    }
                                    onChange={(e) => setWebhookSecret(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('credentials.webhookHelp', { webhookPath })}
                                </p>
                            </div>
                            <div className="flex justify-end">
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={handleSaveCreds}
                                    disable={savingCreds}
                                >
                                    {savingCreds ? t('credentials.saving') : t('credentials.save')}
                                </MyButton>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent
                    value="agents"
                    forceMount
                    className="mt-0 space-y-6 data-[state=inactive]:hidden"
                >
                    {/* ── Campaigns (inbound / outbound) ── */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('campaigns.title')}</CardTitle>
                            <CardDescription>
                                {t('campaigns.description.part1')}{' '}
                                <b>{t('campaigns.description.nameWord')}</b>{' '}
                                {t('campaigns.description.part2')}{' '}
                                <b>{t('campaigns.description.nameWord')}</b>
                                {t('campaigns.description.part3')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-2">
                                {(settings.campaigns ?? []).map((c, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <Input
                                            value={c.name}
                                            placeholder={t('campaigns.agentNamePlaceholder')}
                                            onChange={(e) =>
                                                updateCampaign(i, { name: e.target.value })
                                            }
                                            className="flex-1"
                                        />
                                        <Input
                                            value={c.campaignId}
                                            placeholder={t('campaigns.campaignIdPlaceholder')}
                                            onChange={(e) =>
                                                updateCampaign(i, { campaignId: e.target.value })
                                            }
                                            className="flex-1"
                                        />
                                        <Select
                                            value={c.provider || settings.provider}
                                            onValueChange={(v) =>
                                                updateCampaign(i, { provider: v })
                                            }
                                        >
                                            <SelectTrigger className="w-32">
                                                <SelectValue
                                                    placeholder={t('campaigns.providerPlaceholder')}
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {providerCodes.map((code) => (
                                                    <SelectItem key={code} value={code}>
                                                        {metaFor(code, t).label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Select
                                            value={c.direction}
                                            onValueChange={(v) =>
                                                updateCampaign(i, {
                                                    direction: v as CampaignDirection,
                                                })
                                            }
                                        >
                                            <SelectTrigger className="w-32">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="OUTBOUND">
                                                    {t('campaigns.outbound')}
                                                </SelectItem>
                                                <SelectItem value="INBOUND">
                                                    {t('campaigns.inbound')}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <MyButton
                                            buttonType="secondary"
                                            scale="medium"
                                            onClick={() => removeCampaign(i)}
                                        >
                                            <Trash className="size-4" />
                                        </MyButton>
                                    </div>
                                ))}
                                {(settings.campaigns ?? []).length === 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        {t('campaigns.empty')}
                                    </p>
                                )}
                            </div>
                            <div>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={addCampaign}
                                >
                                    <Plus className="size-4" /> {t('campaigns.addCampaign')}
                                </MyButton>
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── Vacademy AI agent registry (personas for our own caller) ── */}
                    {hasVacademyAi && (
                        <AiAgentsCard
                            onBridged={mirrorBridgedCampaign}
                            onRemoved={mirrorRemovedCampaign}
                        />
                    )}

                    {/* ── Public API: keys, agent ids, webhook (calls placed by the client's own systems) ── */}
                    {hasVacademyAi && <AiCallingApiCard />}
                </TabsContent>

                {settings.enabled && (
                    <>
                        <TabsContent
                            value="retries"
                            forceMount
                            className="mt-0 space-y-6 data-[state=inactive]:hidden"
                        >
                            {/* ── Retry & Calling Window ── */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>{t('retryCard.title')}</CardTitle>
                                    <CardDescription>{t('retryCard.description')}</CardDescription>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div className="grid gap-2">
                                        <Label htmlFor="max-retries">
                                            {t('retryCard.maxRetries')}
                                        </Label>
                                        <Input
                                            id="max-retries"
                                            type="number"
                                            min={0}
                                            max={10}
                                            value={settings.maxRetries}
                                            onChange={(e) =>
                                                update({
                                                    maxRetries: parseInt(e.target.value, 10) || 0,
                                                })
                                            }
                                            className="w-28"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="max-per-day">
                                            {t('retryCard.maxPerDay')}
                                        </Label>
                                        <Input
                                            id="max-per-day"
                                            type="number"
                                            min={1}
                                            max={10}
                                            value={settings.maxCallsPerDayPerLead}
                                            onChange={(e) =>
                                                update({
                                                    maxCallsPerDayPerLead:
                                                        parseInt(e.target.value, 10) || 1,
                                                })
                                            }
                                            className="w-28"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="retry-gap">{t('retryCard.retryGap')}</Label>
                                        <Input
                                            id="retry-gap"
                                            type="number"
                                            min={1}
                                            max={1440}
                                            value={settings.retryGapMinutes}
                                            onChange={(e) =>
                                                update({
                                                    retryGapMinutes:
                                                        parseInt(e.target.value, 10) || 1,
                                                })
                                            }
                                            className="w-28"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            {t('retryCard.retryGapHint')}
                                        </p>
                                    </div>
                                    <div className="grid gap-2 sm:col-span-2">
                                        <Label>{t('retryCard.callingShifts')}</Label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('retryCard.callingShiftsHint')}
                                        </p>
                                        <div className="space-y-2">
                                            {settings.callingShifts.map((shift, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <Input
                                                        type="time"
                                                        value={shift.start}
                                                        onChange={(e) =>
                                                            updateShift(i, {
                                                                start: e.target.value,
                                                            })
                                                        }
                                                        className="w-36"
                                                    />
                                                    <span className="text-sm text-muted-foreground">
                                                        {t('retryCard.shiftTo')}
                                                    </span>
                                                    <Input
                                                        type="time"
                                                        value={shift.end}
                                                        onChange={(e) =>
                                                            updateShift(i, { end: e.target.value })
                                                        }
                                                        className="w-36"
                                                    />
                                                    <MyButton
                                                        buttonType="secondary"
                                                        scale="medium"
                                                        onClick={() => removeShift(i)}
                                                        disable={settings.callingShifts.length <= 1}
                                                    >
                                                        <Trash className="size-4" />
                                                    </MyButton>
                                                </div>
                                            ))}
                                        </div>
                                        <div>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="medium"
                                                onClick={addShift}
                                            >
                                                <Plus className="size-4" />{' '}
                                                {t('retryCard.addShift')}
                                            </MyButton>
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="timezone">{t('retryCard.timezone')}</Label>
                                        <Input
                                            id="timezone"
                                            value={settings.timezone}
                                            onChange={(e) => update({ timezone: e.target.value })}
                                            className="w-48"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="connect-threshold">
                                            {t('retryCard.connectThreshold')}
                                        </Label>
                                        <Input
                                            id="connect-threshold"
                                            type="number"
                                            min={0}
                                            max={120}
                                            value={settings.connectThresholdSec}
                                            onChange={(e) =>
                                                update({
                                                    connectThresholdSec:
                                                        parseInt(e.target.value, 10) || 0,
                                                })
                                            }
                                            className="w-28"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            {t('retryCard.connectThresholdHint')}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent
                            value="outcomes"
                            forceMount
                            className="mt-0 space-y-6 data-[state=inactive]:hidden"
                        >
                            {/* ── Outcome → Action ── */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>{t('outcomeAction.title')}</CardTitle>
                                    <CardDescription>
                                        {t('outcomeAction.description')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>
                                                    {t('outcomeAction.dispositionHeader')}
                                                </TableHead>
                                                <TableHead className="text-center">
                                                    {t('outcomeAction.assignHeader')}
                                                </TableHead>
                                                <TableHead className="text-center">
                                                    {t('outcomeAction.stopHeader')}
                                                </TableHead>
                                                <TableHead>
                                                    {t('outcomeAction.otherwiseHeader')}
                                                </TableHead>
                                                <TableHead className="w-12" />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {[...DISPOSITIONS, ...settings.customDispositions].map(
                                                (d) => {
                                                    const isCustom = !(
                                                        DISPOSITIONS as readonly string[]
                                                    ).includes(d);
                                                    const assigns =
                                                        settings.assignOnDispositions.includes(d);
                                                    const stops =
                                                        settings.stopOnDispositions.includes(d);
                                                    return (
                                                        <TableRow key={d}>
                                                            <TableCell>
                                                                <span className="flex items-center gap-2 font-medium text-neutral-800">
                                                                    {d.replace(/_/g, ' ')}
                                                                    {isCustom && (
                                                                        <Badge variant="secondary">
                                                                            {t(
                                                                                'outcomeAction.customBadge'
                                                                            )}
                                                                        </Badge>
                                                                    )}
                                                                </span>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex justify-center">
                                                                    <Switch
                                                                        checked={assigns}
                                                                        onCheckedChange={(v) =>
                                                                            toggleDisposition(
                                                                                'assignOnDispositions',
                                                                                d,
                                                                                v
                                                                            )
                                                                        }
                                                                        aria-label={t(
                                                                            'outcomeAction.assignHeader'
                                                                        )}
                                                                    />
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex justify-center">
                                                                    <Switch
                                                                        checked={stops}
                                                                        onCheckedChange={(v) =>
                                                                            toggleDisposition(
                                                                                'stopOnDispositions',
                                                                                d,
                                                                                v
                                                                            )
                                                                        }
                                                                        aria-label={t(
                                                                            'outcomeAction.stopHeader'
                                                                        )}
                                                                    />
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-caption text-neutral-500">
                                                                {assigns || stops
                                                                    ? '—'
                                                                    : settings.assignExhaustedToHuman
                                                                      ? t(
                                                                            'outcomeAction.otherwiseRetry'
                                                                        )
                                                                      : t(
                                                                            'outcomeAction.otherwiseRetryOnly'
                                                                        )}
                                                            </TableCell>
                                                            <TableCell>
                                                                {isCustom && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            removeCustomDisposition(
                                                                                d
                                                                            )
                                                                        }
                                                                        className="text-muted-foreground transition-colors hover:text-danger-600"
                                                                        aria-label={t(
                                                                            'outcomeAction.removeAria',
                                                                            {
                                                                                disposition:
                                                                                    d.replace(
                                                                                        /_/g,
                                                                                        ' '
                                                                                    ),
                                                                            }
                                                                        )}
                                                                    >
                                                                        <Trash size={14} />
                                                                    </button>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                }
                                            )}
                                        </TableBody>
                                    </Table>
                                    <Separator />
                                    <div className="flex items-center gap-2">
                                        <Input
                                            value={newDisposition}
                                            onChange={(e) => setNewDisposition(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    addCustomDisposition();
                                                }
                                            }}
                                            placeholder={t('outcomeAction.addOutcomePlaceholder')}
                                            className="h-9 max-w-xs"
                                        />
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="medium"
                                            onClick={addCustomDisposition}
                                            disable={!newDisposition.trim()}
                                        >
                                            <Plus size={14} /> {t('outcomeAction.addOutcome')}
                                        </MyButton>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent
                            value="assignment"
                            forceMount
                            className="mt-0 space-y-6 data-[state=inactive]:hidden"
                        >
                            {/* ── Counsellor Assignment ── */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>{t('assignmentCard.title')}</CardTitle>
                                    <CardDescription>
                                        {t('assignmentCard.description')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid gap-2">
                                        <Label>{t('assignmentCard.modeLabel')}</Label>
                                        <div className="flex flex-wrap gap-2">
                                            {ASSIGNMENT_MODES.map((m) => (
                                                <MyButton
                                                    key={m.value}
                                                    buttonType={
                                                        settings.assignmentMode === m.value
                                                            ? 'primary'
                                                            : 'secondary'
                                                    }
                                                    scale="medium"
                                                    onClick={() =>
                                                        update({ assignmentMode: m.value })
                                                    }
                                                >
                                                    {t(m.labelKey)}
                                                </MyButton>
                                            ))}
                                        </div>
                                    </div>

                                    <Separator />

                                    <div className="flex items-center gap-3">
                                        <Switch
                                            id="assign-exhausted"
                                            checked={settings.assignExhaustedToHuman}
                                            onCheckedChange={(v) =>
                                                update({ assignExhaustedToHuman: v })
                                            }
                                        />
                                        <Label
                                            htmlFor="assign-exhausted"
                                            className="cursor-pointer"
                                        >
                                            {t('assignmentCard.assignExhausted')}
                                        </Label>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <Switch
                                            id="reassign-qualified"
                                            className="mt-0.5"
                                            checked={settings.reassignQualifiedToPool}
                                            onCheckedChange={(v) =>
                                                update({ reassignQualifiedToPool: v })
                                            }
                                        />
                                        <div className="flex flex-col gap-0.5">
                                            <Label
                                                htmlFor="reassign-qualified"
                                                className="cursor-pointer"
                                            >
                                                {t('assignmentCard.reassignQualified')}
                                            </Label>
                                            <span className="text-caption text-neutral-500">
                                                {t('assignmentCard.reassignQualifiedHint')}
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </>
                )}
            </Tabs>
        </div>
    );
}

/**
 * Where Vacademy AI calls physically go out from, shown right under the provider
 * picker. Vacademy AI streams the live conversation over Plivo, so an institute whose
 * team calls on Airtel or Exotel needs a separate Vacademy Voice line — and the failure
 * without one is invisible here: the settings save fine and the very first dial throws.
 * This strip surfaces that before anyone builds an agent, and points at the one card
 * that fixes it.
 */
function AiCarrierStatusStrip() {
    const { t } = useTranslation('settingsAiCalling');
    const instituteId = getCurrentInstituteId() ?? '';
    const { data, isLoading } = useQuery({
        queryKey: ['ai-voice-carrier', instituteId],
        queryFn: () => fetchAiVoiceCarrier(instituteId),
        enabled: !!instituteId,
    });

    if (isLoading || !data) return null;

    const line = data.ready
        ? t('carrierStrip.readyLine', {
              line:
                  data.mode === 'DEDICATED'
                      ? t('carrierStrip.dedicatedLine')
                      : t('carrierStrip.providerLine', {
                            provider: data.primaryProviderName ?? t('carrierStrip.defaultProviderWord'),
                        }),
              callerIdSuffix: data.callerId ? ` (${data.callerId})` : '',
          })
        : (data.blockingReason ?? t('carrierStrip.notReadyFallback'));

    return (
        <div
            className={`flex max-w-2xl flex-col gap-1 rounded-lg border p-3 ${
                data.ready
                    ? 'border-success-200 bg-success-50'
                    : 'border-warning-200 bg-warning-50'
            }`}
        >
            <span
                className={`text-caption ${data.ready ? 'text-success-800' : 'text-warning-800'}`}
            >
                {line}
            </span>
            <Link
                to="/settings/telephony"
                hash="ai-line"
                className="text-caption text-primary-500 underline"
            >
                {t('carrierStrip.manageLink')}
            </Link>
        </div>
    );
}
