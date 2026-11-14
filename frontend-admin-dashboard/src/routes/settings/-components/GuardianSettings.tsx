/**
 * GuardianSettings — institute settings tab for guardian-student linking.
 *
 * Master toggle (PARENT_SETTING.enabled) gates all guardian-linking UI across
 * the app (see useParentSettings). This page also exposes a one-off backfill
 * action that creates a guardian account for every student that doesn't
 * already have one linked.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SpinnerGap, Sparkle } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { TemplateSelector } from '@/components/templates/TemplateSelector';
import { MessageTemplate } from '@/types/message-template-types';
import { createMessageTemplate, getMessageTemplate } from '@/services/message-template-service';
import { buildSampleGuardianCredentialsTemplate } from './sample-guardian-credentials-template';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_INSITITUTE_SETTINGS, EXPORT_GUARDIAN_CREDENTIALS } from '@/constants/urls';
import {
    getCurrentInstituteId,
    getActiveRoleDisplaySettingsKey,
} from '@/lib/auth/instituteUtils';
import {
    getDisplaySettingsWithFallback,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CredentialRecipient = 'STUDENT' | 'GUARDIAN';

/**
 * "My Child" parent-portal config. Stored under PARENT_SETTING.data.parentPortal
 * and read server-side by ParentPortalSettingService. This is SEPARATE from the
 * guardian-linking `enabled` flag below — a school can link guardians without
 * exposing the monitoring portal, and vice versa.
 */
export interface ParentPortalConfig {
    enabled: boolean;
    modules: Record<string, { visible: boolean }>;
    reportAccess?: string;
    allowViewAsChild?: boolean;
    allowSwitchToParentView?: boolean;
}

export interface GuardianSettingsData {
    /** If false, all guardian-linking UI (bulk-assign, side-view, backfill) is hidden institute-wide. */
    enabled: boolean;
    /**
     * Whether a credential email is sent whenever a new guardian account is
     * created — via bulk-assign linking, the side-view "Add Guardian" flow,
     * or backfill.
     */
    sendCredentialEmail: boolean;
    /**
     * Who receives the credential email. "STUDENT" (default) is the only
     * practically deliverable choice for backfill — the guardian's backfilled
     * email is a synthetic, undeliverable @vacademy.com address. For the
     * assignment-time link flows a guardian's email is usually real, so
     * "GUARDIAN" is meaningful there.
     */
    credentialRecipient: CredentialRecipient;
    /** "My Child" parent-portal config (nested; independent of `enabled` above). */
    parentPortal?: ParentPortalConfig;
}

function getParentPortalModules(t: TFunction): { key: string; label: string }[] {
    return [
        { key: 'overview', label: t('parentPortal.modules.overview') },
        { key: 'attendance', label: t('parentPortal.modules.attendance') },
        { key: 'liveSessions', label: t('parentPortal.modules.liveSessions') },
        { key: 'assessments', label: t('parentPortal.modules.assessments') },
        { key: 'progress', label: t('parentPortal.modules.progress') },
        { key: 'payments', label: t('parentPortal.modules.payments') },
        { key: 'badges', label: t('parentPortal.modules.badges') },
        { key: 'certificates', label: t('parentPortal.modules.certificates') },
        { key: 'reports', label: t('parentPortal.modules.reports') },
    ];
}

const DEFAULT_PARENT_PORTAL: ParentPortalConfig = {
    enabled: false,
    modules: {
        overview: { visible: true },
        attendance: { visible: true },
        liveSessions: { visible: true },
        assessments: { visible: true },
        progress: { visible: true },
        payments: { visible: false }, // most sensitive — opt-in
        badges: { visible: true },
        certificates: { visible: true },
        reports: { visible: true },
    },
};

const DEFAULT_GUARDIAN_SETTINGS: GuardianSettingsData = {
    enabled: false,
    sendCredentialEmail: true,
    credentialRecipient: 'STUDENT',
    parentPortal: DEFAULT_PARENT_PORTAL,
};

const SETTING_KEY = 'PARENT_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
const BACKFILL_URL = `${BASE_URL}/admin-core-service/parent-link/v1/backfill`;
const PENDING_URL = `${BASE_URL}/admin-core-service/parent-link/v1/backfill/pending`;
const LEADS_BACKFILL_URL = `${BASE_URL}/admin-core-service/parent-link/v1/backfill-leads`;
const LEADS_PENDING_URL = `${BASE_URL}/admin-core-service/parent-link/v1/backfill-leads/pending`;
const CREDENTIAL_TEMPLATE_URL = `${BASE_URL}/admin-core-service/parent-link/v1/credential-template`;
const PENDING_PREVIEW_LIMIT = 25;

interface CredentialTemplateConfig {
    template_id: string | null;
    template_name: string | null;
    template_subject: string | null;
}

interface BackfillResult {
    total_eligible: number;
    created: number;
    skipped: number;
}

interface PendingGuardianStudent {
    user_id: string;
    full_name: string | null;
    email: string | null;
    mobile_number: string | null;
}

// ─── API ─────────────────────────────────────────────────────────────────────

const fetchGuardianSettings = async (): Promise<GuardianSettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    // GET returns the SettingDto itself ({key, name, data}) — response.data IS
    // the SettingDto, so its content is one level down at response.data.data
    // (matches LeadSettings.tsx's fetchLeadSettings, verified working).
    const saved = response.data?.data as Partial<GuardianSettingsData> | undefined;
    if (!saved) return DEFAULT_GUARDIAN_SETTINGS;
    return { ...DEFAULT_GUARDIAN_SETTINGS, ...saved };
};

const saveGuardianSettings = async (data: GuardianSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Guardian Settings', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

const runGuardianBackfill = async (url: string): Promise<BackfillResult> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance.post(url, {}, { params: { instituteId } });
    return response.data as BackfillResult;
};

export interface BackfillProgress {
    createdSoFar: number;
    skippedSoFar: number;
    /** Stable denominator — the outstanding count as of the very first call, before this run touched anything. */
    startingTotal: number;
}

/**
 * The backend processes at most one batch (100) per call and recomputes
 * eligibility fresh each time — so this just calls it repeatedly until it
 * reports nothing left, no cursor/offset to track. Each call is fast (one
 * bounded batch), so no single request risks a timeout regardless of
 * institute size; `onProgress` fires after every batch so the UI can show
 * live "X of Y done" instead of one long blocking spinner.
 */
const runFullBackfillInChunks = async (
    url: string,
    onProgress: (progress: BackfillProgress) => void
): Promise<BackfillProgress> => {
    let createdSoFar = 0;
    let skippedSoFar = 0;
    let startingTotal = 0;
    // Safety backstop only — at chunk size 100 this covers 100,000+ students.
    // Never expected to trigger; just prevents a truly stuck loop from spinning forever.
    const MAX_ROUNDS = 1000;
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await runGuardianBackfill(url);
        if (round === 0) {
            startingTotal = result.total_eligible;
        }
        createdSoFar += result.created;
        skippedSoFar += result.skipped;
        onProgress({ createdSoFar, skippedSoFar, startingTotal });
        const processedThisRound = result.created + result.skipped;
        if (result.total_eligible === 0 || processedThisRound === 0) {
            break;
        }
    }
    return { createdSoFar, skippedSoFar, startingTotal };
};

const fetchPendingGuardianStudents = async (url: string): Promise<PendingGuardianStudent[]> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return [];
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url,
        params: { instituteId },
    });
    return (response.data as PendingGuardianStudent[]) ?? [];
};

const fetchCredentialTemplateConfig = async (): Promise<CredentialTemplateConfig> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: CREDENTIAL_TEMPLATE_URL,
        params: { instituteId },
    });
    return response.data as CredentialTemplateConfig;
};

const saveCredentialTemplateConfig = async (templateId: string): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(CREDENTIAL_TEMPLATE_URL, null, {
        params: { instituteId, templateId },
    });
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function GuardianSettings() {
    const { t } = useTranslation('settingsGuardian');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<GuardianSettingsData>(DEFAULT_GUARDIAN_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);
    const parentPortalModules = getParentPortalModules(t);

    const { data, isLoading } = useQuery({
        queryKey: ['guardian-settings'],
        queryFn: fetchGuardianSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveGuardianSettings,
        onSuccess: () => {
            toast.success(t('toasts.settingsSaved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['guardian-settings'] });
            queryClient.invalidateQueries({ queryKey: ['parent-settings-config'] });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    const update = (patch: Partial<GuardianSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const handleSave = () => {
        save(settings);
    };

    return (
        <div className="p-6">
            <div className="space-y-6">
                {/* ── Enable / Disable Guardian Linking ── */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t('enableCard.title')}</CardTitle>
                        <CardDescription>{t('enableCard.description')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="text-body text-neutral-500">{t('enableCard.loading')}</div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="guardian-enabled"
                                    checked={settings.enabled}
                                    onCheckedChange={(v) => update({ enabled: v })}
                                />
                                <Label htmlFor="guardian-enabled" className="cursor-pointer">
                                    {settings.enabled
                                        ? t('enableCard.enabledLabel')
                                        : t('enableCard.disabledLabel')}
                                </Label>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* ── Parent Portal ("My Child" monitoring) ── */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t('parentPortal.title')}</CardTitle>
                        <CardDescription>{t('parentPortal.description')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="text-body text-neutral-500">{t('parentPortal.loading')}</div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id="parent-portal-enabled"
                                        checked={settings.parentPortal?.enabled ?? false}
                                        onCheckedChange={(v) =>
                                            update({
                                                parentPortal: {
                                                    ...(settings.parentPortal ?? DEFAULT_PARENT_PORTAL),
                                                    enabled: v,
                                                },
                                            })
                                        }
                                    />
                                    <Label htmlFor="parent-portal-enabled" className="cursor-pointer">
                                        {settings.parentPortal?.enabled
                                            ? t('parentPortal.enabledLabel')
                                            : t('parentPortal.disabledLabel')}
                                    </Label>
                                </div>

                                {settings.parentPortal?.enabled && (
                                    <div className="space-y-3">
                                        <p className="text-body font-medium text-neutral-700">
                                            {t('parentPortal.sectionsVisible')}
                                        </p>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            {parentPortalModules.map((m) => {
                                                const pp =
                                                    settings.parentPortal ?? DEFAULT_PARENT_PORTAL;
                                                const visible =
                                                    pp.modules?.[m.key]?.visible ?? false;
                                                return (
                                                    <div
                                                        key={m.key}
                                                        className="flex items-center gap-3"
                                                    >
                                                        <Switch
                                                            id={`ppm-${m.key}`}
                                                            checked={visible}
                                                            onCheckedChange={(v) =>
                                                                update({
                                                                    parentPortal: {
                                                                        ...pp,
                                                                        modules: {
                                                                            ...pp.modules,
                                                                            [m.key]: { visible: v },
                                                                        },
                                                                    },
                                                                })
                                                            }
                                                        />
                                                        <Label
                                                            htmlFor={`ppm-${m.key}`}
                                                            className="cursor-pointer"
                                                        >
                                                            {m.label}
                                                        </Label>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <p className="pt-2 text-body font-medium text-neutral-700">
                                            {t('parentPortal.viewSwitching')}
                                        </p>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <div className="flex items-center gap-3">
                                                <Switch
                                                    id="pp-view-as-child"
                                                    checked={
                                                        settings.parentPortal?.allowViewAsChild ?? true
                                                    }
                                                    onCheckedChange={(v) =>
                                                        update({
                                                            parentPortal: {
                                                                ...(settings.parentPortal ??
                                                                    DEFAULT_PARENT_PORTAL),
                                                                allowViewAsChild: v,
                                                            },
                                                        })
                                                    }
                                                />
                                                <Label
                                                    htmlFor="pp-view-as-child"
                                                    className="cursor-pointer"
                                                >
                                                    {t('parentPortal.viewAsChildLabel')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Switch
                                                    id="pp-switch-to-parent"
                                                    checked={
                                                        settings.parentPortal
                                                            ?.allowSwitchToParentView ?? true
                                                    }
                                                    onCheckedChange={(v) =>
                                                        update({
                                                            parentPortal: {
                                                                ...(settings.parentPortal ??
                                                                    DEFAULT_PARENT_PORTAL),
                                                                allowSwitchToParentView: v,
                                                            },
                                                        })
                                                    }
                                                />
                                                <Label
                                                    htmlFor="pp-switch-to-parent"
                                                    className="cursor-pointer"
                                                >
                                                    {t('parentPortal.switchToParentLabel')}
                                                </Label>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* ── Guardian credential email (link / link-new-guardian / backfill) ── */}
                {settings.enabled && (
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('credentialEmail.title')}</CardTitle>
                            <CardDescription>{t('credentialEmail.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="guardian-send-credentials"
                                    checked={settings.sendCredentialEmail}
                                    onCheckedChange={(v) => update({ sendCredentialEmail: v })}
                                />
                                <Label htmlFor="guardian-send-credentials" className="cursor-pointer">
                                    {t('credentialEmail.sendToggleLabel')}
                                </Label>
                            </div>
                            {settings.sendCredentialEmail && (
                                <>
                                    <div className="flex flex-col gap-2">
                                        <Label>{t('credentialEmail.sendToLabel')}</Label>
                                        <div className="flex items-center gap-2">
                                            <MyButton
                                                buttonType={
                                                    settings.credentialRecipient === 'STUDENT'
                                                        ? 'primary'
                                                        : 'secondary'
                                                }
                                                scale="small"
                                                onClick={() => update({ credentialRecipient: 'STUDENT' })}
                                            >
                                                {t('credentialEmail.studentButton')}
                                            </MyButton>
                                            <MyButton
                                                buttonType={
                                                    settings.credentialRecipient === 'GUARDIAN'
                                                        ? 'primary'
                                                        : 'secondary'
                                                }
                                                scale="small"
                                                onClick={() => update({ credentialRecipient: 'GUARDIAN' })}
                                            >
                                                {t('credentialEmail.guardianButton')}
                                            </MyButton>
                                        </div>
                                        <p className="text-caption text-neutral-500">
                                            {settings.credentialRecipient === 'STUDENT'
                                                ? t('credentialEmail.studentHint')
                                                : t('credentialEmail.guardianHint')}
                                        </p>
                                    </div>
                                    <GuardianCredentialTemplateSelector />
                                </>
                            )}
                        </CardContent>
                    </Card>
                )}

                {!isLoading && (
                    <div className="flex items-center justify-end">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleSave}
                            disable={saving || !hasChanges}
                        >
                            {saving ? t('save.saving') : t('save.save')}
                        </MyButton>
                    </div>
                )}

                {/* ── Backfill Existing Students ── */}
                <BackfillSection
                    settingsEnabled={settings.enabled}
                    title={t('backfillEnrolled.title')}
                    description={t('backfillEnrolled.description')}
                    pendingUrl={PENDING_URL}
                    backfillUrl={BACKFILL_URL}
                    queryKeySuffix="enrolled"
                    dialogHeading={t('backfillEnrolled.dialogHeading')}
                    emptyStateLabel={t('backfillEnrolled.emptyState')}
                    awaitingLabel={t('backfillEnrolled.awaiting')}
                />

                {/* ── Backfill Leads' Guardians ── */}
                <BackfillSection
                    settingsEnabled={settings.enabled}
                    title={t('backfillLeads.title')}
                    description={t('backfillLeads.description')}
                    pendingUrl={LEADS_PENDING_URL}
                    backfillUrl={LEADS_BACKFILL_URL}
                    queryKeySuffix="leads"
                    dialogHeading={t('backfillLeads.dialogHeading')}
                    emptyStateLabel={t('backfillLeads.emptyState')}
                    awaitingLabel={t('backfillLeads.awaiting')}
                />

                {/* ── Export guardian credentials ── */}
                {settings.enabled && <GuardianCredentialsExport />}
            </div>
        </div>
    );
}

// ─── Backfill section (reused for enrolled students + leads) ──────────────────

interface BackfillSectionProps {
    settingsEnabled: boolean;
    title: string;
    description: string;
    pendingUrl: string;
    backfillUrl: string;
    queryKeySuffix: string;
    dialogHeading: string;
    emptyStateLabel: string;
    awaitingLabel: string;
}

function BackfillSection({
    settingsEnabled,
    title,
    description,
    pendingUrl,
    backfillUrl,
    queryKeySuffix,
    dialogHeading,
    emptyStateLabel,
    awaitingLabel,
}: BackfillSectionProps) {
    const { t } = useTranslation('settingsGuardian');
    const queryClient = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [progress, setProgress] = useState<BackfillProgress | null>(null);
    const pendingQueryKey = ['guardian-backfill-pending', queryKeySuffix];

    const { data: pendingStudents, isLoading: pendingLoading } = useQuery({
        queryKey: pendingQueryKey,
        queryFn: () => fetchPendingGuardianStudents(pendingUrl),
        enabled: settingsEnabled,
        staleTime: 60 * 1000,
    });

    const { mutate: backfill, isPending: backfilling } = useMutation({
        mutationFn: () => {
            setProgress(null);
            return runFullBackfillInChunks(backfillUrl, setProgress);
        },
        onSuccess: (result) => {
            toast.success(
                t('backfill.completeToast', {
                    title,
                    created: result.createdSoFar,
                    skipped: result.skippedSoFar,
                    total: result.startingTotal,
                })
            );
            setProgress(null);
            queryClient.invalidateQueries({ queryKey: pendingQueryKey });
        },
        onError: () => {
            setProgress(null);
            toast.error(t('backfill.failedToast', { title }));
        },
    });

    const progressDone = progress ? progress.createdSoFar + progress.skippedSoFar : 0;
    const progressPct =
        progress && progress.startingTotal > 0
            ? Math.min(100, Math.round((progressDone / progress.startingTotal) * 100))
            : 0;

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent>
                    {settingsEnabled && (
                        <div className="mb-4">
                            {pendingLoading ? (
                                <div className="text-body text-neutral-500">
                                    {t('backfill.checkingFor', { awaitingLabel })}
                                </div>
                            ) : (pendingStudents?.length ?? 0) === 0 ? (
                                <div className="text-body text-success-600">{emptyStateLabel}</div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <div className="text-body font-medium text-neutral-800">
                                        {t('backfill.studentsAwaiting', {
                                            count: pendingStudents!.length,
                                            awaitingLabel,
                                        })}
                                    </div>
                                    <div className="max-h-56 overflow-y-auto rounded-md border border-neutral-200">
                                        <div className="flex flex-col divide-y divide-neutral-100">
                                            {pendingStudents!.slice(0, PENDING_PREVIEW_LIMIT).map((s) => (
                                                <div key={s.user_id} className="flex flex-col gap-0.5 px-3 py-2">
                                                    <span className="text-caption font-medium text-neutral-800">
                                                        {s.full_name || '—'}
                                                    </span>
                                                    <span className="text-2xs text-neutral-500">
                                                        {s.email || '—'} · {s.mobile_number || '—'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {pendingStudents!.length > PENDING_PREVIEW_LIMIT && (
                                        <div className="text-caption text-neutral-500">
                                            {t('backfill.moreNotShown', {
                                                count: pendingStudents!.length - PENDING_PREVIEW_LIMIT,
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {backfilling && progress && (
                        <div className="mb-4 flex flex-col gap-1.5">
                            <Progress value={progressPct} className="w-full" />
                            <div className="text-caption text-neutral-500">
                                {t('backfill.progressLine', {
                                    done: progressDone,
                                    total: progress.startingTotal,
                                    created: progress.createdSoFar,
                                    skipped: progress.skippedSoFar,
                                })}
                            </div>
                        </div>
                    )}
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setDialogOpen(true)}
                        disable={!settingsEnabled || backfilling || (pendingStudents?.length ?? 0) === 0}
                    >
                        {backfilling ? t('backfill.runningButton') : t('backfill.runButton')}
                    </MyButton>
                </CardContent>
            </Card>

            <GuardianBackfillConfirmDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onConfirm={() => backfill()}
                pendingCount={pendingStudents?.length ?? 0}
                heading={dialogHeading}
            />
        </>
    );
}

// ─── Guardian credentials export ──────────────────────────────────────────────

/**
 * Downloads a CSV of every linked guardian's login credentials — the delivery
 * mechanism for backfilled guardians, whose synthetic @vacademy.com address
 * can't receive the credential email. Contains plaintext passwords, so it's
 * gated on the same `allowViewPassword` role setting that guards credential
 * reveal in the student side-view.
 */
function GuardianCredentialsExport() {
    const { t } = useTranslation('settingsGuardian');
    const [allowViewPassword, setAllowViewPassword] = useState<boolean | null>(null);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const roleKey = getActiveRoleDisplaySettingsKey();
            const cached = getDisplaySettingsFromCache(roleKey);
            const settings =
                cached?.learnerManagement ??
                (await getDisplaySettingsWithFallback(roleKey)).learnerManagement;
            if (!cancelled) setAllowViewPassword(settings?.allowViewPassword ?? false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleExport = async () => {
        setExporting(true);
        try {
            const instituteId = getCurrentInstituteId();
            const response = await authenticatedAxiosInstance({
                method: 'GET',
                url: EXPORT_GUARDIAN_CREDENTIALS,
                params: { instituteId },
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data as BlobPart]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'guardian-credentials.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success(t('export.successToast'));
        } catch {
            toast.error(t('export.errorToast'));
        } finally {
            setExporting(false);
        }
    };

    if (allowViewPassword === false) {
        return null;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('export.title')}</CardTitle>
                <CardDescription>{t('export.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <p className="text-caption text-warning-600">{t('export.warning')}</p>
                <div>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleExport}
                        disable={exporting || allowViewPassword === null}
                    >
                        {exporting ? t('export.exporting') : t('export.button')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
}

// ─── Guardian credential email template picker ────────────────────────────────

function GuardianCredentialTemplateSelector() {
    const { t } = useTranslation('settingsGuardian');
    const queryClient = useQueryClient();
    const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const { data: config, isLoading } = useQuery({
        queryKey: ['guardian-credential-template-config'],
        queryFn: fetchCredentialTemplateConfig,
        staleTime: 60 * 1000,
    });

    useEffect(() => {
        if (!config?.template_id) {
            setSelectedTemplate(null);
            return;
        }
        getMessageTemplate(config.template_id)
            .then(setSelectedTemplate)
            .catch(() => setSelectedTemplate(null));
    }, [config?.template_id]);

    const { mutate: selectTemplate } = useMutation({
        mutationFn: (templateId: string) => saveCredentialTemplateConfig(templateId),
        onSuccess: () => {
            toast.success(t('credentialTemplate.updateSuccessToast'));
            queryClient.invalidateQueries({ queryKey: ['guardian-credential-template-config'] });
        },
        onError: () => {
            toast.error(t('credentialTemplate.updateErrorToast'));
        },
    });

    const handleTemplateSelect = (template: MessageTemplate | null) => {
        setSelectedTemplate(template);
        if (template) {
            selectTemplate(template.id);
        }
    };

    const handleGenerateSample = async () => {
        setIsGenerating(true);
        try {
            const sample = buildSampleGuardianCredentialsTemplate();
            const created = await createMessageTemplate({
                name: sample.name,
                type: 'EMAIL',
                subject: sample.subject,
                content: sample.content,
                variables: sample.variables,
                templateType: 'transactional',
            });
            setSelectedTemplate(created);
            selectTemplate(created.id);
            toast.success(t('credentialTemplate.createSuccessToast'));
        } catch (error) {
            console.error('Error generating sample guardian credential template:', error);
            toast.error(t('credentialTemplate.createErrorToast'));
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4">
            <div className="flex items-center justify-between gap-2">
                <Label>{t('credentialTemplate.label')}</Label>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateSample}
                    disabled={isGenerating}
                    title={t('credentialTemplate.generateTitle')}
                >
                    {isGenerating ? (
                        <SpinnerGap className="mr-2 size-4 animate-spin" />
                    ) : (
                        <Sparkle className="mr-2 size-4 text-warning-500" />
                    )}
                    {isGenerating ? t('credentialTemplate.generating') : t('credentialTemplate.generateButton')}
                </Button>
            </div>
            {isLoading ? (
                <div className="text-body text-neutral-500">{t('credentialTemplate.loading')}</div>
            ) : (
                <TemplateSelector
                    templateType="EMAIL"
                    selectedTemplate={selectedTemplate}
                    onTemplateSelect={handleTemplateSelect}
                    variant="dropdown"
                    placeholder={t('credentialTemplate.placeholder')}
                />
            )}
        </div>
    );
}

// ─── Backfill confirmation dialog ─────────────────────────────────────────────

interface GuardianBackfillConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called when the user confirms. Closing is handled by the dialog. */
    onConfirm: () => void;
    pendingCount: number;
    heading: string;
}

function GuardianBackfillConfirmDialog({
    open,
    onOpenChange,
    onConfirm,
    pendingCount,
    heading,
}: GuardianBackfillConfirmDialogProps) {
    const { t } = useTranslation('settingsGuardian');
    const footer = (
        <div className="flex w-full items-center justify-end gap-2">
            <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                {t('backfillDialog.cancel')}
            </MyButton>
            <MyButton
                buttonType="primary"
                scale="medium"
                onClick={() => {
                    onConfirm();
                    onOpenChange(false);
                }}
            >
                {t('backfillDialog.confirm')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={heading}
            footer={footer}
            dialogWidth="max-w-md"
        >
            <div className="px-6 py-6">
                <p className="text-body text-neutral-500">
                    {t('backfillDialog.bodyPrefix')}{' '}
                    <span className="font-medium text-neutral-800">
                        {t('backfillDialog.studentCount', { count: pendingCount })}
                    </span>{' '}
                    {t('backfillDialog.bodySuffix', { count: pendingCount })}
                </p>
            </div>
        </MyDialog>
    );
}
