import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bell, Gear, Info, Question, Trash, Warning } from '@phosphor-icons/react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

// Friendly purposes for an email address. Each option maps to the storage `type`
// key used inside institute.setting.EMAIL_SETTING.data on the backend. The
// dropdown shows the friendly label; the backend persists the code.
//
// `UTILITY_EMAIL` is the system-wide fallback used when no type matches, so it
// stays as the default for new addresses.
const EMAIL_PURPOSE_DEFS = [
    { code: 'UTILITY_EMAIL', i18nKey: 'utility' },
    { code: 'INFO_EMAIL', i18nKey: 'info' },
    { code: 'TRANSACTIONAL_EMAIL', i18nKey: 'transactional' },
    { code: 'MARKETING_EMAIL', i18nKey: 'marketing' },
    { code: 'SUPPORT_EMAIL', i18nKey: 'support' },
] as const;

// Resolved lazily (not memoized) so the labels/hints always reflect the active language.
function getEmailPurposes(): { code: string; label: string; hint: string }[] {
    return EMAIL_PURPOSE_DEFS.map((p) => ({
        code: p.code,
        label: i18next.t(`settingsNotification:emailPurposes.${p.i18nKey}.label`),
        hint: i18next.t(`settingsNotification:emailPurposes.${p.i18nKey}.hint`),
    }));
}

const CUSTOM_PURPOSE_OPTION = '__custom__';

function purposeLabelFor(code: string): string {
    const match = getEmailPurposes().find((p) => p.code === code);
    if (match) return match.label;
    // Custom / unknown type — turn UTILITY_EMAIL into "Utility email" for display.
    return code
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
import type {
    NotificationSettings,
    NotificationSettingsResponse,
    ChatSettings,
    ChatDirectRole,
    ChatModerationAction,
    EmailCcSettings,
} from '@/services/notification-settings';
import {
    createUpsertRequest,
    getNotificationDefaultTemplate,
    getNotificationSettings,
    upsertNotificationSettings,
    mergeChatSettings,
    mergeAppOverlaySettings,
    mergeEmailCcSettings,
    EMAIL_CC_TRIGGERS,
} from '@/services/notification-settings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getEmailConfigurations,
    createEmailConfiguration,
    updateEmailConfiguration,
    deleteEmailConfiguration,
    type EmailConfiguration,
    type CreateEmailConfigurationRequest,
} from '@/services/email-configuration-service';
import {
    getVerificationEnabled,
    verifySender,
    getVerificationStatus,
    type SenderVerificationResponse,
    type VerificationStatus,
    type DnsRecord,
} from '@/services/email-verification-service';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { Textarea } from '@/components/ui/textarea';
import {
    FIREBASE_CREDENTIALS_LABEL,
    FIREBASE_CREDENTIALS_HELPER_TEXT,
    FIREBASE_CREDENTIALS_PLACEHOLDER,
    FIREBASE_CREDENTIALS_TOOLTIP,
    FIREBASE_VALIDATION_MESSAGES,
    normalizeServiceAccountInput,
    validateFirebaseServiceAccountJson,
} from '@/services/notification-settings';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type Props = { isTab?: boolean };

// Sub-tabs that group the notification cards, mirroring the Display Settings tab pattern.
type NotificationSubTab = 'general' | 'chat' | 'push' | 'email';
const SUB_TABS: { key: NotificationSubTab }[] = [
    { key: 'general' },
    { key: 'chat' },
    { key: 'push' },
    { key: 'email' },
];

export default function NotificationSettings({ isTab = false }: Props) {
    const { t } = useTranslation('settingsNotification');
    const [settings, setSettings] = useState<NotificationSettings | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [subTab, setSubTab] = useState<NotificationSubTab>('general');
    
    // Email configurations state
    const [emailConfigurations, setEmailConfigurations] = useState<EmailConfiguration[]>([]);
    const [emailLoading, setEmailLoading] = useState(false);
    const [emailError, setEmailError] = useState<string | null>(null);

    getInstituteId();

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const data: NotificationSettingsResponse = await getNotificationSettings();
                if (!data?.id) {
                    const template = await getNotificationDefaultTemplate();
                    setSettings({
                        ...template.settings,
                        emails: template.settings.emails || []
                    });
                } else {
                    setSettings({
                        ...data.settings,
                        emails: data.settings.emails || []
                    });
                }
            } catch (e) {
                console.error(e);
                setError(t('errors.loadSettings'));
            } finally {
                setLoading(false);
            }
        };
        init();
    }, []);

    // Load email configurations
    useEffect(() => {
        const loadEmailConfigurations = async () => {
            setEmailLoading(true);
            setEmailError(null);
            try {
                const configs = await getEmailConfigurations();
                setEmailConfigurations(configs);
            } catch (e) {
                console.error('Error loading email configurations:', e);
                setEmailError(t('errors.loadEmailConfigurations'));
            } finally {
                setEmailLoading(false);
            }
        };
        loadEmailConfigurations();
    }, []);

    const update = <K extends keyof NotificationSettings>(
        key: K,
        updater: (prev: NotificationSettings[K]) => NotificationSettings[K]
    ) => {
        setSettings((prev) => {
            if (!prev) return prev;
            setHasChanges(true);
            return { ...prev, [key]: updater(prev[key]) } as NotificationSettings;
        });
    };

    const handleSave = async () => {
        if (!settings) return;
        setSaving(true);
        try {
            // Create a copy of settings without the emails field for API compatibility
            const { emails, ...settingsForApi } = settings;
            const req = createUpsertRequest(settingsForApi);
            const saved = await upsertNotificationSettings(req);
            // A server that redacts the key (reports `configured`) never needs it back, so drop a pasted key
            // from page state. An older server still returns and expects the key — keep what it returned, or
            // the next save from this page would erase the stored key.
            const savedFirebase = saved?.settings?.firebase;
            if (savedFirebase && savedFirebase.configured !== undefined) {
                setSettings((prev) =>
                    prev
                        ? {
                              ...prev,
                              firebase: {
                                  ...(prev.firebase || {}),
                                  ...savedFirebase,
                                  serviceAccountJson: null,
                                  serviceAccountJsonBase64: null,
                              },
                          }
                        : prev
                );
            }
            toast.success(t('toasts.settingsSaved'));
            setHasChanges(false);
        } catch (e) {
            console.error(e);
            toast.error(t('errors.saveSettings'));
        } finally {
            setSaving(false);
        }
    };

    const handleValidateAndSaveFirebase = async () => {
        if (!settings) return;
        const firebase = settings.firebase || {};
        const normalized = normalizeServiceAccountInput({
            jsonString: firebase.serviceAccountJson || null,
            base64String: firebase.serviceAccountJsonBase64 || null,
        });
        if (!normalized || normalized.trim().length === 0) {
            // No new key pasted: the stored key (never sent back by the server) stays as it is.
            if (firebase.configured) {
                await handleSave();
                return;
            }
            toast.error(FIREBASE_VALIDATION_MESSAGES.required);
            return;
        }
        const result = validateFirebaseServiceAccountJson(normalized);
        if (!result.valid) {
            toast.error(result.errorMessage || FIREBASE_VALIDATION_MESSAGES.invalidJson);
            return;
        }
        await handleSave();
    };

    if (loading || !settings) {
        return <div className="flex items-center justify-center p-8">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6">
            {isTab && (
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold ">{t('header.title')}</h2>
                        <p className="text-sm text-gray-600">
                            {t('header.subtitle')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <MyButton
                            buttonType="primary"
                            onClick={handleSave}
                            disabled={saving || !hasChanges}
                        >
                            {t('header.saveSettings')}
                        </MyButton>
                    </div>
                </div>
            )}

            {error && (
                <Alert variant="destructive">
                    <Warning className="size-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Sub-tab navigation */}
            <div
                role="tablist"
                aria-label={t('subTabs.ariaLabel')}
                className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted p-1"
            >
                {SUB_TABS.map((tab) => {
                    const active = subTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setSubTab(tab.key)}
                            className={
                                'cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ' +
                                (active
                                    ? 'bg-white text-neutral-900 shadow-sm'
                                    : 'text-neutral-600 hover:text-neutral-800')
                            }
                        >
                            {t(`subTabs.${tab.key}`)}
                        </button>
                    );
                })}
            </div>

            {subTab === 'general' && (
            <>
            {/* General */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Gear className="size-5" /> {t('general.title')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div>
                                <Label>{t('general.approvalRequired.label')}</Label>
                                <div className="text-xs text-muted-foreground">
                                    {t('general.approvalRequired.hint')}
                                </div>
                            </div>
                            <Switch
                                checked={settings.general.announcement_approval_required}
                                onCheckedChange={(checked) =>
                                    update('general', (g) => ({
                                        ...g,
                                        announcement_approval_required: checked,
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div>
                                <Label>{t('general.maxAnnouncementsPerDay.label')}</Label>
                                <div className="text-xs text-muted-foreground">{t('general.maxAnnouncementsPerDay.hint')}</div>
                            </div>
                            <Input
                                type="number"
                                className="w-28"
                                value={settings.general.max_announcements_per_day}
                                onChange={(e) =>
                                    update('general', (g) => ({
                                        ...g,
                                        max_announcements_per_day: Number(e.target.value || 0),
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div>
                                <Label>{t('general.retentionDays.label')}</Label>
                                <div className="text-xs text-muted-foreground">
                                    {t('general.retentionDays.hint')}
                                </div>
                            </div>
                            <Input
                                type="number"
                                className="w-28"
                                value={settings.general.retention_days}
                                onChange={(e) =>
                                    update('general', (g) => ({
                                        ...g,
                                        retention_days: Number(e.target.value || 0),
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div>
                                <Label>{t('general.defaultTimezone.label')}</Label>
                                <div className="text-xs text-muted-foreground">
                                    {t('general.defaultTimezone.hint')}
                                </div>
                            </div>
                            <Input
                                className="w-56"
                                value={settings.general.default_timezone}
                                onChange={(e) =>
                                    update('general', (g) => ({
                                        ...g,
                                        default_timezone: e.target.value,
                                    }))
                                }
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Community */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Bell className="size-5" /> {t('community.title')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                        <ToggleRow
                            label={t('community.studentsCanSend')}
                            checked={settings.community.students_can_send}
                            onChange={(checked) =>
                                update('community', (c) => ({ ...c, students_can_send: checked }))
                            }
                        />
                        <ToggleRow
                            label={t('community.adminsCanModerate')}
                            checked={!!settings.community.moderation_enabled}
                            onChange={(checked) =>
                                update('community', (c) => ({ ...c, moderation_enabled: checked }))
                            }
                        />
                        <ToggleRow
                            label={t('community.allowReplies')}
                            checked={!!settings.community.allow_replies}
                            onChange={(checked) =>
                                update('community', (c) => ({ ...c, allow_replies: checked }))
                            }
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('community.allowedTags')}</Label>
                        <TagEditor
                            value={settings.community.allowed_tags || []}
                            onChange={(tags) =>
                                update('community', (c) => ({ ...c, allowed_tags: tags }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Chat */}
            <ChatSection
                chat={mergeChatSettings(settings.chat)}
                onChange={(updater) =>
                    update('chat', (prev) => updater(mergeChatSettings(prev)))
                }
            />

            </>
            )}

            {subTab === 'chat' && (
            <>
            {/* System Alerts */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('systemAlerts.title')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <ToggleRow
                        label={t('systemAlerts.teachersCanSend')}
                        checked={!!settings.systemAlerts.teachers_can_send}
                        onChange={(checked) =>
                            update('systemAlerts', (s) => ({ ...s, teachers_can_send: checked }))
                        }
                    />
                    <ToggleRow
                        label={t('systemAlerts.adminsCanSend')}
                        checked={!!settings.systemAlerts.admins_can_send}
                        onChange={(checked) =>
                            update('systemAlerts', (s) => ({ ...s, admins_can_send: checked }))
                        }
                    />
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label>{t('systemAlerts.autoDismissHours.label')}</Label>
                            <div className="text-xs text-muted-foreground">{t('systemAlerts.autoDismissHours.hint')}</div>
                        </div>
                        <Input
                            type="number"
                            className="w-28"
                            value={settings.systemAlerts.auto_dismiss_hours}
                            onChange={(e) =>
                                update('systemAlerts', (s) => ({
                                    ...s,
                                    auto_dismiss_hours: Number(e.target.value || 0),
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            {/* App Overlays */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('appOverlays.title')}</CardTitle>
                    <div className="mt-1 text-xs text-muted-foreground">
                        {t('appOverlays.description', { role: chatRoleLabelPlural('student').toLowerCase() })}
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <ToggleRow
                        label={t('appOverlays.canSend', { role: chatRoleLabelPlural('student') })}
                        checked={mergeAppOverlaySettings(settings.appOverlays).students_can_send}
                        onChange={(checked) =>
                            update('appOverlays', (a) => ({
                                ...mergeAppOverlaySettings(a),
                                students_can_send: checked,
                            }))
                        }
                    />
                    <ToggleRow
                        label={t('appOverlays.canSend', { role: chatRoleLabelPlural('teacher') })}
                        checked={mergeAppOverlaySettings(settings.appOverlays).teachers_can_send}
                        onChange={(checked) =>
                            update('appOverlays', (a) => ({
                                ...mergeAppOverlaySettings(a),
                                teachers_can_send: checked,
                            }))
                        }
                    />
                    <ToggleRow
                        label={t('appOverlays.canSend', { role: chatRoleLabelPlural('admin') })}
                        checked={mergeAppOverlaySettings(settings.appOverlays).admins_can_send}
                        onChange={(checked) =>
                            update('appOverlays', (a) => ({
                                ...mergeAppOverlaySettings(a),
                                admins_can_send: checked,
                            }))
                        }
                    />
                </CardContent>
            </Card>

            {/* Dashboard Pins */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('dashboardPins.title')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <ToggleRow
                        label={t('dashboardPins.studentsCanCreate')}
                        checked={settings.dashboardPins.students_can_create}
                        onChange={(checked) =>
                            update('dashboardPins', (d) => ({ ...d, students_can_create: checked }))
                        }
                    />
                    <ToggleRow
                        label={t('dashboardPins.teachersCanCreate')}
                        checked={!!settings.dashboardPins.teachers_can_create}
                        onChange={(checked) =>
                            update('dashboardPins', (d) => ({ ...d, teachers_can_create: checked }))
                        }
                    />
                    <ToggleRow
                        label={t('dashboardPins.adminsCanCreate')}
                        checked={!!settings.dashboardPins.admins_can_create}
                        onChange={(checked) =>
                            update('dashboardPins', (d) => ({ ...d, admins_can_create: checked }))
                        }
                    />
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label>{t('dashboardPins.maxDurationHours.label')}</Label>
                            <div className="text-xs text-muted-foreground">{t('dashboardPins.maxDurationHours.hint')}</div>
                        </div>
                        <Input
                            type="number"
                            className="w-28"
                            value={settings.dashboardPins.max_duration_hours}
                            onChange={(e) =>
                                update('dashboardPins', (d) => ({
                                    ...d,
                                    max_duration_hours: Number(e.target.value || 0),
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label>{t('dashboardPins.maxPinsPerUser.label')}</Label>
                            <div className="text-xs text-muted-foreground">{t('dashboardPins.maxPinsPerUser.hint')}</div>
                        </div>
                        <Input
                            type="number"
                            className="w-28"
                            value={settings.dashboardPins.max_pins_per_user}
                            onChange={(e) =>
                                update('dashboardPins', (d) => ({
                                    ...d,
                                    max_pins_per_user: Number(e.target.value || 0),
                                }))
                            }
                        />
                    </div>
                    <ToggleRow
                        label={t('dashboardPins.requireApproval')}
                        checked={!!settings.dashboardPins.require_approval}
                        onChange={(checked) =>
                            update('dashboardPins', (d) => ({ ...d, require_approval: checked }))
                        }
                    />
                </CardContent>
            </Card>

            {/* Direct Messages */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('directMessages.title')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <ToggleRow
                        label={t('directMessages.studentsCanSend')}
                        checked={settings.directMessages.students_can_send}
                        onChange={(checked) =>
                            update('directMessages', (s) => ({ ...s, students_can_send: checked }))
                        }
                    />
                    <ToggleRow
                        label={t('directMessages.allowReplies')}
                        checked={settings.directMessages.allow_replies}
                        onChange={(checked) =>
                            update('directMessages', (s) => ({ ...s, allow_replies: checked }))
                        }
                    />
                    <ToggleRow
                        label={t('directMessages.moderationEnabled')}
                        checked={settings.directMessages.moderation_enabled}
                        onChange={(checked) =>
                            update('directMessages', (s) => ({ ...s, moderation_enabled: checked }))
                        }
                    />
                </CardContent>
            </Card>

            </>
            )}

            {subTab === 'push' && (
            <>
            {/* Push Notifications (Firebase) */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('push.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label>{t('push.enable.label')}</Label>
                            <div className="text-xs text-muted-foreground">
                                {t('push.enable.hint')}
                            </div>
                        </div>
                        <Switch
                            checked={!!settings.firebase?.enabled}
                            onCheckedChange={(checked) => {
                                if (checked) {
                                    const normalized = normalizeServiceAccountInput({
                                        jsonString: settings.firebase?.serviceAccountJson || null,
                                        base64String:
                                            settings.firebase?.serviceAccountJsonBase64 || null,
                                    });
                                    if (!normalized && !settings.firebase?.configured) {
                                        toast.error(FIREBASE_VALIDATION_MESSAGES.required);
                                        return;
                                    }
                                    const res = normalized
                                        ? validateFirebaseServiceAccountJson(normalized)
                                        : { valid: true as const, errorMessage: undefined };
                                    if (!res.valid) {
                                        toast.error(
                                            res.errorMessage ||
                                                FIREBASE_VALIDATION_MESSAGES.invalidJson
                                        );
                                        return;
                                    }
                                }
                                update(
                                    'firebase',
                                    (f) =>
                                        ({
                                            ...(f || {}),
                                            enabled: checked,
                                        }) as NonNullable<NotificationSettings['firebase']>
                                );
                            }}
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Label>{FIREBASE_CREDENTIALS_LABEL}</Label>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button type="button" className="text-muted-foreground">
                                            <Question className="size-4" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <ul className="list-disc pl-4">
                                            {FIREBASE_CREDENTIALS_TOOLTIP.map((t) => (
                                                <li key={t}>{t}</li>
                                            ))}
                                        </ul>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {FIREBASE_CREDENTIALS_HELPER_TEXT}
                        </div>
                        {settings.firebase?.configured && (
                            <div className="text-xs font-medium text-success-600">
                                {t('push.keyConfigured')}
                            </div>
                        )}
                        <Textarea
                            className="min-h-40 font-mono"
                            placeholder={FIREBASE_CREDENTIALS_PLACEHOLDER}
                            value={settings.firebase?.serviceAccountJson || ''}
                            onChange={(e) =>
                                update(
                                    'firebase',
                                    (f) =>
                                        ({
                                            ...(f || {}),
                                            serviceAccountJson: e.target.value,
                                        }) as NonNullable<NotificationSettings['firebase']>
                                )
                            }
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t('push.base64Label')}</Label>
                        <Input
                            placeholder={t('push.base64Placeholder')}
                            value={settings.firebase?.serviceAccountJsonBase64 || ''}
                            onChange={(e) =>
                                update(
                                    'firebase',
                                    (f) =>
                                        ({
                                            ...(f || {}),
                                            serviceAccountJsonBase64: e.target.value,
                                        }) as NonNullable<NotificationSettings['firebase']>
                                )
                            }
                        />
                    </div>

                    <div className="flex items-center justify-end">
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            onClick={handleValidateAndSaveFirebase}
                        >
                            {t('push.validateAndSave')}
                        </MyButton>
                    </div>
                </CardContent>
            </Card>

            </>
            )}

            {subTab === 'chat' && (
            <>
            {/* Streams */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('streams.title')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <ToggleRow
                        label={t('streams.teachersCanSend')}
                        checked={settings.streams.teachers_can_send}
                        onChange={(checked) =>
                            update('streams', (s) => ({ ...s, teachers_can_send: checked }))
                        }
                    />
                    <ToggleRow
                        label={t('streams.allowDuringClass')}
                        checked={settings.streams.allow_during_class}
                        onChange={(checked) =>
                            update('streams', (s) => ({ ...s, allow_during_class: checked }))
                        }
                    />
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label>{t('streams.autoArchiveHours.label')}</Label>
                            <div className="text-xs text-muted-foreground">
                                {t('streams.autoArchiveHours.hint')}
                            </div>
                        </div>
                        <Input
                            type="number"
                            className="w-28"
                            value={settings.streams.auto_archive_hours}
                            onChange={(e) =>
                                update('streams', (s) => ({
                                    ...s,
                                    auto_archive_hours: Number(e.target.value || 0),
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>
            {/* Resources */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('resources.title')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <ToggleRow
                        label={t('resources.studentsCanUpload')}
                        checked={settings.resources.students_can_upload}
                        onChange={(checked) =>
                            update('resources', (r) => ({ ...r, students_can_upload: checked }))
                        }
                    />
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label>{t('resources.maxFileSizeMb.label')}</Label>
                            <div className="text-xs text-muted-foreground">{t('resources.maxFileSizeMb.hint')}</div>
                        </div>
                        <Input
                            type="number"
                            className="w-28"
                            value={settings.resources.max_file_size_mb}
                            onChange={(e) =>
                                update('resources', (r) => ({
                                    ...r,
                                    max_file_size_mb: Number(e.target.value || 0),
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            </>
            )}

            {subTab === 'email' && (
            <>
            {/* Email Settings */}
            <Card className="rounded-lg border-gray-200">
                <CardHeader className="py-3">
                    <CardTitle className="text-base">{t('email.addressesTitle')}</CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">
                        {t('email.addressesDescription')}
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <EmailListEditor
                        emailConfigurations={emailConfigurations}
                        loading={emailLoading}
                        error={emailError}
                        onAdd={async (config) => {
                            try {
                                const newConfig = await createEmailConfiguration(config);
                                setEmailConfigurations(prev => [...prev, newConfig]);
                                // Detailed verification toast is shown by the editor.
                            } catch (error) {
                                toast.error(t('email.toastAddFailed'));
                            }
                        }}
                        onUpdate={async (emailType, config) => {
                            try {
                                const updatedConfig = await updateEmailConfiguration(emailType, config);
                                setEmailConfigurations(prev =>
                                    prev.map(c => c.type === emailType ? updatedConfig : c)
                                );
                                toast.success(t('email.toastUpdateSuccess'));
                            } catch (error) {
                                toast.error(t('email.toastUpdateFailed'));
                            }
                        }}
                        onDelete={async (emailType) => {
                            try {
                                await deleteEmailConfiguration(emailType);
                                setEmailConfigurations(prev => prev.filter(c => c.type !== emailType));
                                toast.success(t('email.toastDeleteSuccess'));
                            } catch (error) {
                                toast.error(t('email.toastDeleteFailed'));
                            }
                        }}
                    />
                </CardContent>
            </Card>

            <EmailCcSection
                value={mergeEmailCcSettings(settings.emailCc)}
                onChange={(next) => update('emailCc', () => next)}
            />
            </>
            )}

            {!isTab && (
                <div className="flex items-center justify-end gap-2">
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        onClick={handleSave}
                        disabled={saving || !hasChanges}
                    >
                        {t('footer.save')}
                    </MyButton>
                </div>
            )}
        </div>
    );
}

function ToggleRow({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-md border p-3">
            <Label>{label}</Label>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

function NumberRow({
    label,
    hint,
    value,
    onChange,
}: {
    label: string;
    hint?: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-md border p-3">
            <div>
                <Label>{label}</Label>
                {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
            </div>
            <Input
                type="number"
                className="w-28"
                value={value}
                onChange={(e) => onChange(Number(e.target.value || 0))}
            />
        </div>
    );
}

const CHAT_DIRECT_ROLES: ChatDirectRole[] = ['student', 'teacher', 'admin'];

// Maps the API role code (kept unchanged) to its configured singular/plural term.
const CHAT_ROLE_TERMS: Record<ChatDirectRole, { term: RoleTerms; system: SystemTerms }> = {
    student: { term: RoleTerms.Learner, system: SystemTerms.Learner },
    teacher: { term: RoleTerms.Teacher, system: SystemTerms.Teacher },
    admin: { term: RoleTerms.Admin, system: SystemTerms.Admin },
};

const chatRoleLabel = (role: ChatDirectRole): string =>
    getTerminology(CHAT_ROLE_TERMS[role].term, CHAT_ROLE_TERMS[role].system);

const chatRoleLabelPlural = (role: ChatDirectRole): string =>
    getTerminologyPlural(CHAT_ROLE_TERMS[role].term, CHAT_ROLE_TERMS[role].system);

function ChatSection({
    chat,
    onChange,
}: {
    chat: ChatSettings;
    onChange: (updater: (prev: ChatSettings) => ChatSettings) => void;
}) {
    const { t } = useTranslation('settingsNotification');
    const batchLabel = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const rules = chat.community.rules;

    return (
        <Card className="rounded-lg border-gray-200">
            <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Bell className="size-5" /> {t('chat.title')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Master toggle */}
                <ToggleRow
                    label={t('chat.enabled')}
                    checked={chat.enabled}
                    onChange={(checked) => onChange((c) => ({ ...c, enabled: checked }))}
                />

                {/* What learners may do to their OWN messages */}
                <div className="space-y-2">
                    <div className="text-sm font-medium">
                        {t('chat.ownMessagesTitle', { role: chatRoleLabelPlural('student') })}
                    </div>
                    <p className="text-xs text-neutral-500">
                        {t('chat.ownMessagesDescription', {
                            studentRoleLower: chatRoleLabelPlural('student').toLowerCase(),
                            teacherRole: chatRoleLabelPlural('teacher'),
                        })}
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <ToggleRow
                            label={t('chat.canEditOwn', { role: chatRoleLabelPlural('student') })}
                            checked={chat.message_actions.students_can_edit_own}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    message_actions: {
                                        ...c.message_actions,
                                        students_can_edit_own: checked,
                                    },
                                }))
                            }
                        />
                        <ToggleRow
                            label={t('chat.canDeleteOwn', { role: chatRoleLabelPlural('student') })}
                            checked={chat.message_actions.students_can_delete_own}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    message_actions: {
                                        ...c.message_actions,
                                        students_can_delete_own: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                </div>

                {/* Batch groups */}
                <div className="space-y-2">
                    <div className="text-sm font-medium">{t('chat.batchGroupsTitle', { batch: batchLabel })}</div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <ToggleRow
                            label={t('chat.canPost', { role: chatRoleLabelPlural('student') })}
                            checked={chat.batch_group.students_can_post}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    batch_group: {
                                        ...c.batch_group,
                                        students_can_post: checked,
                                    },
                                }))
                            }
                        />
                        <ToggleRow
                            label={t('chat.canPost', { role: chatRoleLabelPlural('teacher') })}
                            checked={chat.batch_group.teachers_can_post}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    batch_group: {
                                        ...c.batch_group,
                                        teachers_can_post: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                </div>

                {/* Community */}
                <div className="space-y-2">
                    <div className="text-sm font-medium">{t('chat.communityTitle')}</div>
                    <ToggleRow
                        label={t('chat.communityChannelEnabled')}
                        checked={chat.community.enabled}
                        onChange={(checked) =>
                            onChange((c) => ({
                                ...c,
                                community: {
                                    ...c.community,
                                    enabled: checked,
                                },
                            }))
                        }
                    />
                    <div className="grid gap-4 md:grid-cols-3">
                        <ToggleRow
                            label={t('chat.canPost', { role: chatRoleLabelPlural('student') })}
                            checked={chat.community.students_can_post}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        students_can_post: checked,
                                    },
                                }))
                            }
                        />
                        <ToggleRow
                            label={t('chat.canPost', { role: chatRoleLabelPlural('teacher') })}
                            checked={chat.community.teachers_can_post}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        teachers_can_post: checked,
                                    },
                                }))
                            }
                        />
                        <ToggleRow
                            label={t('chat.canPost', { role: chatRoleLabelPlural('admin') })}
                            checked={chat.community.admins_can_post}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        admins_can_post: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                </div>

                {/* Community Rules */}
                <div className="space-y-4 rounded-md border p-4">
                    <div className="text-sm font-medium">{t('chat.communityRulesTitle')}</div>

                    <div className="space-y-2">
                        <Label>{t('chat.guidelinesTitle')}</Label>
                        <Input
                            value={rules.guidelines.title}
                            onChange={(e) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            guidelines: {
                                                ...c.community.rules.guidelines,
                                                title: e.target.value,
                                            },
                                        },
                                    },
                                }))
                            }
                            placeholder={t('chat.guidelinesTitlePlaceholder')}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t('chat.guidelineItems')}</Label>
                        <StringListEditor
                            value={rules.guidelines.items}
                            placeholder={t('chat.guidelineItemPlaceholder')}
                            onChange={(items) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            guidelines: {
                                                ...c.community.rules.guidelines,
                                                items,
                                            },
                                        },
                                    },
                                }))
                            }
                        />
                    </div>

                    <ToggleRow
                        label={t('chat.acknowledgementRequired')}
                        checked={rules.acknowledgement_required}
                        onChange={(checked) =>
                            onChange((c) => ({
                                ...c,
                                community: {
                                    ...c.community,
                                    rules: {
                                        ...c.community.rules,
                                        acknowledgement_required: checked,
                                    },
                                },
                            }))
                        }
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                        <NumberRow
                            label={t('chat.slowModeSeconds.label')}
                            hint={t('chat.slowModeSeconds.hint')}
                            value={rules.posting.slow_mode_seconds}
                            onChange={(value) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            posting: {
                                                ...c.community.rules.posting,
                                                slow_mode_seconds: value,
                                            },
                                        },
                                    },
                                }))
                            }
                        />
                        <NumberRow
                            label={t('chat.newMemberReadonlyMinutes.label')}
                            hint={t('chat.newMemberReadonlyMinutes.hint')}
                            value={rules.posting.new_member_readonly_minutes}
                            onChange={(value) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            posting: {
                                                ...c.community.rules.posting,
                                                new_member_readonly_minutes: value,
                                            },
                                        },
                                    },
                                }))
                            }
                        />
                        <ToggleRow
                            label={t('chat.allowLinks')}
                            checked={rules.posting.allow_links}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            posting: {
                                                ...c.community.rules.posting,
                                                allow_links: checked,
                                            },
                                        },
                                    },
                                }))
                            }
                        />
                        <ToggleRow
                            label={t('chat.allowAttachments')}
                            checked={rules.posting.allow_attachments}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            posting: {
                                                ...c.community.rules.posting,
                                                allow_attachments: checked,
                                            },
                                        },
                                    },
                                }))
                            }
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t('chat.bannedKeywords')}</Label>
                        <StringListEditor
                            value={rules.auto_moderation.banned_keywords}
                            placeholder={t('chat.bannedKeywordPlaceholder')}
                            onChange={(keywords) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            auto_moderation: {
                                                ...c.community.rules.auto_moderation,
                                                banned_keywords: keywords,
                                            },
                                        },
                                    },
                                }))
                            }
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t('chat.autoModerationAction')}</Label>
                        <Select
                            value={rules.auto_moderation.action}
                            onValueChange={(value) =>
                                onChange((c) => ({
                                    ...c,
                                    community: {
                                        ...c.community,
                                        rules: {
                                            ...c.community.rules,
                                            auto_moderation: {
                                                ...c.community.rules.auto_moderation,
                                                action: value as ChatModerationAction,
                                            },
                                        },
                                    },
                                }))
                            }
                        >
                            <SelectTrigger className="w-48">
                                <SelectValue placeholder={t('chat.selectActionPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="BLOCK">{t('chat.actionBlock')}</SelectItem>
                                <SelectItem value="FLAG">{t('chat.actionFlag')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Direct messages */}
                <div className="space-y-3">
                    <div className="text-sm font-medium">{t('chat.directMessagesTitle')}</div>
                    <ToggleRow
                        label={t('chat.directMessagesEnabled')}
                        checked={chat.direct.enabled}
                        onChange={(checked) =>
                            onChange((c) => ({
                                ...c,
                                direct: { ...c.direct, enabled: checked },
                            }))
                        }
                    />
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr>
                                    <th className="p-3 text-left font-medium text-muted-foreground">
                                        {t('chat.senderCanMessage')}
                                    </th>
                                    {CHAT_DIRECT_ROLES.map((target) => (
                                        <th
                                            key={target}
                                            className="p-3 text-center font-medium text-muted-foreground"
                                        >
                                            {chatRoleLabel(target)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {CHAT_DIRECT_ROLES.map((sender) => (
                                    <tr key={sender} className="border-t">
                                        <td className="p-3 font-medium">
                                            {chatRoleLabel(sender)}
                                        </td>
                                        {CHAT_DIRECT_ROLES.map((target) => (
                                            <td key={target} className="p-3 text-center">
                                                <div className="flex justify-center">
                                                    <Switch
                                                        checked={chat.direct.matrix[sender][target]}
                                                        onCheckedChange={(checked) =>
                                                            onChange((c) => ({
                                                                ...c,
                                                                direct: {
                                                                    ...c.direct,
                                                                    matrix: {
                                                                        ...c.direct.matrix,
                                                                        [sender]: {
                                                                            ...c.direct.matrix[
                                                                                sender
                                                                            ],
                                                                            [target]: checked,
                                                                        },
                                                                    },
                                                                },
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Attachments */}
                <div className="space-y-2">
                    <div className="text-sm font-medium">{t('chat.attachmentsTitle')}</div>
                    <div className="grid gap-4 md:grid-cols-3">
                        <ToggleRow
                            label={t('chat.imagesEnabled')}
                            checked={chat.attachments.images_enabled}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    attachments: {
                                        ...c.attachments,
                                        images_enabled: checked,
                                    },
                                }))
                            }
                        />
                        <ToggleRow
                            label={t('chat.filesEnabled')}
                            checked={chat.attachments.files_enabled}
                            onChange={(checked) =>
                                onChange((c) => ({
                                    ...c,
                                    attachments: {
                                        ...c.attachments,
                                        files_enabled: checked,
                                    },
                                }))
                            }
                        />
                        <NumberRow
                            label={t('chat.maxFileSizeMb.label')}
                            hint={t('chat.maxFileSizeMb.hint')}
                            value={chat.attachments.max_file_size_mb}
                            onChange={(value) =>
                                onChange((c) => ({
                                    ...c,
                                    attachments: {
                                        ...c.attachments,
                                        max_file_size_mb: value,
                                    },
                                }))
                            }
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * Copy-recipient (CC/BCC) configuration for transactional email.
 *
 * Triggers come from EMAIL_CC_TRIGGERS, a curated list of events whose sender actually stamps
 * a matching `source` — deliberately NOT every value of the backend NotificationEventType enum,
 * several of which have no send-site and would render controls that do nothing.
 */
// Rejects entries that would silently fail at send time: the backend parses copy addresses with
// InternetAddress.parse and, on failure, drops the copies and sends anyway — so a typo here would
// otherwise look configured while never delivering.
function getCcEmailPlaceholder(): string {
    return i18next.t('settingsNotification:emailCc.emailPlaceholder');
}

function validateCcEmail(candidate: string): string | null {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
        ? null
        : i18next.t('settingsNotification:emailCc.invalidEmail', { value: candidate });
}

function EmailCcSection({
    value,
    onChange,
}: {
    value: EmailCcSettings;
    onChange: (next: EmailCcSettings) => void;
}) {
    const { t } = useTranslation('settingsNotification');
    const setTrigger = (key: string, patch: Partial<{ enabled: boolean; cc: string[] }>) => {
        const current = value.triggers[key] ?? { enabled: false, cc: [] };
        onChange({
            ...value,
            triggers: { ...value.triggers, [key]: { ...current, ...patch } },
        });
    };

    // A config can be switched on yet still deliver nothing — no email selected, or none of the
    // selected ones has an address. Both look configured and fail silently, so say so here.
    const enabledTriggers = EMAIL_CC_TRIGGERS.filter((trig) => value.triggers[trig.key]?.enabled);
    const hasAnyAddress =
        value.global_cc.length > 0 ||
        enabledTriggers.some((trig) => (value.triggers[trig.key]?.cc?.length ?? 0) > 0);
    const inactiveReason =
        enabledTriggers.length === 0
            ? t('emailCc.noneSelected')
            : !hasAnyAddress
              ? t('emailCc.noAddresses')
              : null;

    return (
        <Card className="rounded-lg border-gray-200">
            <CardHeader className="py-3">
                <CardTitle className="text-base">{t('emailCc.title')}</CardTitle>
                <div className="mt-1 text-xs text-muted-foreground">
                    {t('emailCc.description')}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <ToggleRow
                    label={t('emailCc.sendCopies')}
                    checked={value.enabled}
                    onChange={(enabled) => onChange({ ...value, enabled })}
                />

                {value.enabled && (
                    <>
                        {inactiveReason && (
                            <Alert variant="destructive">
                                <Warning className="size-4" />
                                <AlertDescription className="text-xs">
                                    {inactiveReason}
                                </AlertDescription>
                            </Alert>
                        )}

                        <div className="rounded-md border p-3">
                            <Label>{t('emailCc.copyType')}</Label>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {t('emailCc.copyTypeHint')}
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                                {(['BCC', 'CC'] as const).map((mode) => (
                                    <Button
                                        key={mode}
                                        type="button"
                                        variant={value.mode === mode ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => onChange({ ...value, mode })}
                                    >
                                        {mode}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-md border p-3">
                            <Label>{t('emailCc.alwaysCopy')}</Label>
                            <div className="mb-3 mt-1 text-xs text-muted-foreground">
                                {t('emailCc.alwaysCopyHint')}
                            </div>
                            <StringListEditor
                                value={value.global_cc}
                                onChange={(global_cc) => onChange({ ...value, global_cc })}
                                placeholder={getCcEmailPlaceholder()}
                                validate={validateCcEmail}
                            />
                        </div>

                        <div className="space-y-3">
                            <Label>{t('emailCc.whichEmails')}</Label>
                            {EMAIL_CC_TRIGGERS.map((trigger) => {
                                const config = value.triggers[trigger.key] ?? {
                                    enabled: false,
                                    cc: [],
                                };
                                return (
                                    <div key={trigger.key} className="rounded-md border p-3">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <Label>{trigger.label}</Label>
                                                <div className="text-xs text-muted-foreground">
                                                    {trigger.description}
                                                </div>
                                            </div>
                                            <Switch
                                                checked={config.enabled}
                                                onCheckedChange={(enabled) =>
                                                    setTrigger(trigger.key, { enabled })
                                                }
                                            />
                                        </div>
                                        {config.enabled && (
                                            <div className="mt-3">
                                                <div className="mb-2 text-xs text-muted-foreground">
                                                    {t('emailCc.alsoCopyTo')}
                                                </div>
                                                <StringListEditor
                                                    value={config.cc}
                                                    onChange={(cc) =>
                                                        setTrigger(trigger.key, { cc })
                                                    }
                                                    placeholder={getCcEmailPlaceholder()}
                                                    validate={validateCcEmail}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <Alert>
                            <Info className="size-4" />
                            <AlertDescription className="text-xs">
                                {t('emailCc.notRecorded')}
                            </AlertDescription>
                        </Alert>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function StringListEditor({
    value,
    onChange,
    placeholder,
    validate,
}: {
    value: string[];
    onChange: (items: string[]) => void;
    placeholder?: string;
    /** Return an error message to reject the entry, or null to accept it. */
    validate?: (item: string) => string | null;
}) {
    const { t } = useTranslation('settingsNotification');
    const [input, setInput] = useState('');
    const addItem = () => {
        const v = input.trim();
        if (!v) return;
        // Clear on duplicate too — leaving the text behind makes it look unsaved.
        if (value.includes(v)) {
            setInput('');
            return;
        }
        if (validate) {
            const error = validate(v);
            if (error) {
                toast.error(error);
                return;
            }
        }
        onChange([...value, v]);
        setInput('');
    };
    const removeItem = (item: string) => {
        onChange(value.filter((existing) => existing !== item));
    };
    return (
        <div className="flex flex-wrap items-center gap-2">
            {value.map((item) => (
                <Badge key={item} variant="secondary" className="flex items-center gap-2">
                    {item}
                    <button type="button" className="text-xs" onClick={() => removeItem(item)}>
                        ×
                    </button>
                </Badge>
            ))}
            <Input
                className="w-64"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addItem();
                    }
                }}
                // Commit on blur as well as Enter. Without this, typing a value and clicking
                // Save discards it silently — the field looks filled in, but an empty list is
                // what gets persisted.
                onBlur={addItem}
                placeholder={placeholder ?? t('stringListEditor.defaultPlaceholder')}
            />
        </div>
    );
}

function TagEditor({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
    const { t } = useTranslation('settingsNotification');
    const [input, setInput] = useState('');
    const addTag = () => {
        const v = input.trim();
        if (!v) return;
        if (value.includes(v)) return;
        onChange([...value, v]);
        setInput('');
    };
    const removeTag = (tag: string) => {
        onChange(value.filter((existing) => existing !== tag));
    };
    return (
        <div className="flex flex-wrap items-center gap-2">
            {value.map((tag) => (
                <Badge key={tag} variant="secondary" className="flex items-center gap-2">
                    {tag}
                    <button className="text-xs" onClick={() => removeTag(tag)}>
                        ×
                    </button>
                </Badge>
            ))}
            <Input
                className="w-56"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                    }
                }}
                placeholder={t('tagEditor.placeholder')}
            />
        </div>
    );
}

function EmailListEditor({
    emailConfigurations,
    loading,
    error,
    onAdd,
    onUpdate,
    onDelete,
}: {
    emailConfigurations: EmailConfiguration[];
    loading: boolean;
    error: string | null;
    onAdd: (config: CreateEmailConfigurationRequest) => Promise<void>;
    onUpdate: (id: string, config: Partial<CreateEmailConfigurationRequest>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const { t } = useTranslation('settingsNotification');
    const [newEmail, setNewEmail] = useState('');
    const [newName, setNewName] = useState('');
    const [newPurposeCode, setNewPurposeCode] = useState<string>(getEmailPurposes()[0]!.code);
    const [newCustomPurpose, setNewCustomPurpose] = useState('');
    const [newDescription, setNewDescription] = useState('');

    // Whether this deployment supports self-serve SES sender verification. When true,
    // we replace the manual "contact support" flow with an in-app "Verify" action.
    const [verificationEnabled, setVerificationEnabled] = useState(false);

    useEffect(() => {
        let active = true;
        getVerificationEnabled()
            .then((enabled) => {
                if (active) setVerificationEnabled(enabled);
            })
            .catch(() => {
                /* getVerificationEnabled already swallows errors and returns false */
            });
        return () => {
            active = false;
        };
    }, []);

    const resolvedNewPurposeCode =
        newPurposeCode === CUSTOM_PURPOSE_OPTION
            ? newCustomPurpose.trim().toUpperCase().replace(/\s+/g, '_')
            : newPurposeCode;

    const canSubmit =
        newEmail.trim().length > 0 &&
        newName.trim().length > 0 &&
        resolvedNewPurposeCode.length > 0;

    const addEmail = async () => {
        if (!canSubmit) return;

        const emailExists = emailConfigurations.some(
            (e) => e.email.toLowerCase() === newEmail.trim().toLowerCase()
        );
        if (emailExists) {
            toast.error(t('emailList.toasts.emailExists'));
            return;
        }
        const typeExists = emailConfigurations.some((e) => e.type === resolvedNewPurposeCode);
        if (typeExists) {
            toast.error(t('emailList.toasts.purposeExists'));
            return;
        }

        const addedEmail = newEmail.trim();
        const addedName = newName.trim();
        const addedType = resolvedNewPurposeCode;

        try {
            await onAdd({
                email: addedEmail,
                name: addedName,
                type: addedType,
                description: newDescription.trim() || undefined,
            });

            if (verificationEnabled) {
                // Kick off SES verification immediately so a confirmation email is on its
                // way before the admin even scrolls to the new row.
                try {
                    const result = await verifySender({
                        email: addedEmail,
                        name: addedName,
                        type: addedType,
                        mode: 'EMAIL',
                    });
                    toast.success(t('emailList.toasts.addedVerificationStarted'), {
                        description:
                            result.message ||
                            t('emailList.toasts.addedVerificationStartedDescription', { email: addedEmail }),
                        duration: 10000,
                    });
                } catch {
                    toast.success(t('emailList.toasts.added'), {
                        description: t('emailList.toasts.addedVerificationFailedDescription'),
                        duration: 10000,
                    });
                }
            } else {
                toast.success(t('emailList.toasts.added'), {
                    description: t('emailList.toasts.addedNoVerificationDescription'),
                    duration: 10000,
                });
            }

            setNewEmail('');
            setNewName('');
            setNewPurposeCode(getEmailPurposes()[0]!.code);
            setNewCustomPurpose('');
            setNewDescription('');
        } catch (error) {
            // Error toast is raised by the parent
        }
    };

    const verificationNotice = verificationEnabled ? (
        <Alert className="border-info-300 bg-info-50 text-info-700">
            <Info className="size-4 text-info-600" />
            <AlertDescription className="text-xs leading-relaxed">
                {t('emailList.verifiedNotice.part1')} <strong>{t('emailList.verifiedNotice.verifiedWithService')}</strong>{' '}
                {t('emailList.verifiedNotice.part2')} <strong>{t('emailList.verifiedNotice.refreshStatus')}</strong>
                {t('emailList.verifiedNotice.part3')}
            </AlertDescription>
        </Alert>
    ) : (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <Info className="size-4 text-amber-700" />
            <AlertDescription className="text-xs leading-relaxed">
                {t('emailList.unverifiedNotice.part1')}{' '}
                <strong>{t('emailList.unverifiedNotice.needsVerification')}</strong>
                {t('emailList.unverifiedNotice.part2')}{' '}
                <strong>{t('emailList.unverifiedNotice.contactSupport')}</strong>{' '}
                {t('emailList.unverifiedNotice.part3')}
            </AlertDescription>
        </Alert>
    );

    if (loading) {
        return (
            <div className="space-y-4">
                {verificationNotice}
                <div className="text-sm text-muted-foreground text-center py-4">
                    {t('emailList.loadingAddresses')}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="space-y-4">
                {verificationNotice}
                <div className="text-sm text-red-600 text-center py-4">
                    {error}
                </div>
            </div>
        );
    }

    const selectedPurposeHint =
        newPurposeCode !== CUSTOM_PURPOSE_OPTION
            ? getEmailPurposes().find((p) => p.code === newPurposeCode)?.hint
            : t('emailPurposes.customHint');

    return (
        <div className="space-y-4">
            {verificationNotice}

            {/* Add new email form */}
            <div className="rounded-md border border-dashed border-gray-300 p-4 space-y-3">
                <div className="text-sm font-medium">{t('emailList.addNewTitle')}</div>
                <div className="grid gap-3 md:grid-cols-2">
                    <div>
                        <Label htmlFor="new-email">{t('emailList.fields.email')}</Label>
                        <Input
                            id="new-email"
                            type="email"
                            placeholder={t('emailList.fields.emailPlaceholder')}
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                        />
                    </div>
                    <div>
                        <Label htmlFor="new-name">{t('emailList.fields.displayName')}</Label>
                        <Input
                            id="new-name"
                            placeholder={t('emailList.fields.displayNamePlaceholder')}
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                            {t('emailList.fields.displayNameHint')}
                        </div>
                    </div>
                    <div>
                        <Label htmlFor="new-purpose">{t('emailList.fields.purpose')}</Label>
                        <Select value={newPurposeCode} onValueChange={setNewPurposeCode}>
                            <SelectTrigger id="new-purpose">
                                <SelectValue placeholder={t('emailList.fields.purposePlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {getEmailPurposes().map((p) => (
                                    <SelectItem key={p.code} value={p.code}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                                <SelectItem value={CUSTOM_PURPOSE_OPTION}>
                                    {t('emailPurposes.other')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {newPurposeCode === CUSTOM_PURPOSE_OPTION ? (
                            <div className="mt-2 space-y-1">
                                <Input
                                    placeholder={t('emailList.fields.customPurposePlaceholder')}
                                    value={newCustomPurpose}
                                    onChange={(e) => setNewCustomPurpose(e.target.value)}
                                />
                                <div className="text-xs text-muted-foreground">
                                    {t('emailList.fields.customPurposeHint', {
                                        code: resolvedNewPurposeCode || t('emailList.fields.customPurposeDefaultCode'),
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="text-xs text-muted-foreground mt-1">
                                {selectedPurposeHint}
                            </div>
                        )}
                    </div>
                    <div>
                        <Label htmlFor="new-description">{t('emailList.fields.notes')}</Label>
                        <Input
                            id="new-description"
                            placeholder={t('emailList.fields.notesPlaceholder')}
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button
                        type="button"
                        onClick={addEmail}
                        disabled={!canSubmit}
                    >
                        {t('emailList.addButton')}
                    </Button>
                </div>
            </div>

            {/* Email list */}
            <div className="space-y-2">
                <div className="text-sm font-medium">
                    {t('emailList.yourAddresses', { count: emailConfigurations.length })}
                </div>
                {emailConfigurations.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-md">
                        {t('emailList.emptyState')}
                    </div>
                ) : (
                    emailConfigurations.map((config) => (
                        <EmailConfigurationRow
                            key={config.type}
                            config={config}
                            verificationEnabled={verificationEnabled}
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

// Small status pill for a sender's SES verification state.
function VerificationBadge({ status }: { status: VerificationStatus | null }) {
    const { t } = useTranslation('settingsNotification');
    const map: Record<VerificationStatus, { label: string; className: string }> = {
        VERIFIED: { label: t('verificationBadge.verified'), className: 'border-success-200 bg-success-50 text-success-700' },
        PENDING: { label: t('verificationBadge.pending'), className: 'border-info-200 bg-info-50 text-info-700' },
        FAILED: { label: t('verificationBadge.failed'), className: 'border-danger-200 bg-danger-50 text-danger-600' },
        NOT_STARTED: { label: t('verificationBadge.notVerified'), className: 'border-neutral-200 bg-neutral-50 text-neutral-500' },
    };
    const s = status ?? 'NOT_STARTED';
    const { label, className } = map[s];
    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
            {label}
        </span>
    );
}

// DNS records the institute must publish for DOMAIN-mode (DKIM) verification.
function DnsRecordsTable({ records }: { records: DnsRecord[] }) {
    const { t } = useTranslation('settingsNotification');
    const copy = (value: string) => {
        navigator.clipboard?.writeText(value).then(
            () => toast.success(t('dnsTable.toastCopied')),
            () => toast.error(t('dnsTable.toastCopyFailed'))
        );
    };
    return (
        <div className="space-y-2 rounded-md border border-info-200 bg-info-50 p-2">
            <div className="text-xs font-medium text-info-700">
                {t('dnsTable.instructions')}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                        <tr>
                            <th className="pr-2 font-medium">{t('dnsTable.columnType')}</th>
                            <th className="pr-2 font-medium">{t('dnsTable.columnName')}</th>
                            <th className="pr-2 font-medium">{t('dnsTable.columnValue')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody className="font-mono">
                        {records.map((r, i) => (
                            <tr key={`${r.name}-${i}`} className="align-top">
                                <td className="pr-2 py-1">{r.type}</td>
                                <td className="pr-2 py-1 break-all">{r.name}</td>
                                <td className="pr-2 py-1 break-all">{r.value}</td>
                                <td className="py-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2"
                                        onClick={() => copy(`${r.name}\t${r.value}`)}
                                    >
                                        {t('dnsTable.copyButton')}
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function EmailConfigurationRow({
    config,
    verificationEnabled,
    onUpdate,
    onDelete,
}: {
    config: EmailConfiguration;
    verificationEnabled: boolean;
    onUpdate: (emailType: string, config: Partial<CreateEmailConfigurationRequest>) => Promise<void>;
    onDelete: (emailType: string) => Promise<void>;
}) {
    const { t } = useTranslation('settingsNotification');
    const [email, setEmail] = useState(config.email);
    const [name, setName] = useState(config.name);
    const [description, setDescription] = useState(config.description || '');
    // Sending controls: kept as strings for the inputs, parsed on save.
    const [maxPerDay, setMaxPerDay] = useState(String(config.maxPerDay ?? 0));
    const [timezone, setTimezone] = useState(config.timezone || '');
    const [sendAfterHour, setSendAfterHour] = useState(String(config.sendAfterHour ?? 0));
    const [postalAddress, setPostalAddress] = useState(config.postalAddress || '');
    const [listUnsubscribe, setListUnsubscribe] = useState(Boolean(config.listUnsubscribe));
    // Warm-up ramp
    const [rampEnabled, setRampEnabled] = useState(Boolean(config.rampEnabled));
    const [rampStartPerDay, setRampStartPerDay] = useState(String(config.rampStartPerDay ?? 20));
    const [rampStep, setRampStep] = useState(String(config.rampStep ?? 20));
    const [rampEveryDays, setRampEveryDays] = useState(String(config.rampEveryDays ?? 7));
    const [rampCeiling, setRampCeiling] = useState(String(config.rampCeiling ?? 150));
    const [skipWeekends, setSkipWeekends] = useState(Boolean(config.skipWeekends));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // SES verification state for this sender.
    const [vStatus, setVStatus] = useState<VerificationStatus | null>(null);
    const [vMessage, setVMessage] = useState('');
    const [vDns, setVDns] = useState<DnsRecord[] | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [checking, setChecking] = useState(false);

    const applyVerification = (r: SenderVerificationResponse) => {
        setVStatus(r.status);
        setVMessage(r.message || '');
        setVDns(r.dnsRecords && r.dnsRecords.length > 0 ? r.dnsRecords : null);
    };

    const errorText = (e: unknown) => {
        const err = e as { response?: { data?: { error?: string } } };
        return err?.response?.data?.error || t('emailRow.genericError');
    };

    useEffect(() => {
        setEmail(config.email);
        setName(config.name);
        setDescription(config.description || '');
    }, [config.email, config.name, config.type, config.description]);

    // Load current verification status when the feature is available.
    useEffect(() => {
        if (!verificationEnabled) return;
        let active = true;
        setChecking(true);
        getVerificationStatus(config.type)
            .then((r) => {
                if (active) applyVerification(r);
            })
            .catch(() => {
                /* leave status null → shows "Not verified" */
            })
            .finally(() => {
                if (active) setChecking(false);
            });
        return () => {
            active = false;
        };
    }, [verificationEnabled, config.type]);

    const runVerify = async (mode: 'EMAIL' | 'DOMAIN') => {
        setVerifying(true);
        try {
            const r = await verifySender({
                email: config.email,
                name: config.name,
                type: config.type,
                mode,
            });
            applyVerification(r);
            toast.success(
                mode === 'DOMAIN' ? t('emailRow.toasts.domainVerificationStarted') : t('emailRow.toasts.verificationEmailSent'),
                { description: r.message, duration: 8000 }
            );
        } catch (e) {
            toast.error(t('emailRow.toasts.verificationStartFailed'), { description: errorText(e) });
        } finally {
            setVerifying(false);
        }
    };

    const refreshStatus = async () => {
        setChecking(true);
        try {
            const r = await getVerificationStatus(config.type);
            applyVerification(r);
        } catch (e) {
            toast.error(t('emailRow.toasts.refreshFailed'), { description: errorText(e) });
        } finally {
            setChecking(false);
        }
    };

    const isDirty =
        email !== config.email ||
        name !== config.name ||
        description !== (config.description || '') ||
        Number(maxPerDay || 0) !== (config.maxPerDay ?? 0) ||
        timezone !== (config.timezone || '') ||
        Number(sendAfterHour || 0) !== (config.sendAfterHour ?? 0) ||
        postalAddress !== (config.postalAddress || '') ||
        listUnsubscribe !== Boolean(config.listUnsubscribe) ||
        rampEnabled !== Boolean(config.rampEnabled) ||
        Number(rampStartPerDay || 0) !== (config.rampStartPerDay ?? 20) ||
        Number(rampStep || 0) !== (config.rampStep ?? 20) ||
        Number(rampEveryDays || 0) !== (config.rampEveryDays ?? 7) ||
        Number(rampCeiling || 0) !== (config.rampCeiling ?? 150) ||
        skipWeekends !== Boolean(config.skipWeekends);

    const canSave =
        isDirty &&
        email.trim().length > 0 &&
        name.trim().length > 0 &&
        !saving;

    const handleUpdate = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await onUpdate(config.type, {
                email: email.trim(),
                name: name.trim(),
                description: description.trim() || undefined,
                maxPerDay: Math.max(0, Number(maxPerDay || 0)),
                timezone: timezone.trim(),
                sendAfterHour: Math.min(23, Math.max(0, Number(sendAfterHour || 0))),
                postalAddress: postalAddress.trim(),
                listUnsubscribe,
                rampEnabled,
                rampStartPerDay: Math.max(0, Number(rampStartPerDay || 0)),
                rampStep: Math.max(0, Number(rampStep || 0)),
                rampEveryDays: Math.max(1, Number(rampEveryDays || 1)),
                rampCeiling: Math.max(0, Number(rampCeiling || 0)),
                skipWeekends,
            });
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => {
        setEmail(config.email);
        setName(config.name);
        setDescription(config.description || '');
        setMaxPerDay(String(config.maxPerDay ?? 0));
        setTimezone(config.timezone || '');
        setSendAfterHour(String(config.sendAfterHour ?? 0));
        setPostalAddress(config.postalAddress || '');
        setListUnsubscribe(Boolean(config.listUnsubscribe));
        setRampEnabled(Boolean(config.rampEnabled));
        setRampStartPerDay(String(config.rampStartPerDay ?? 20));
        setRampStep(String(config.rampStep ?? 20));
        setRampEveryDays(String(config.rampEveryDays ?? 7));
        setRampCeiling(String(config.rampCeiling ?? 150));
        setSkipWeekends(Boolean(config.skipWeekends));
    };

    const handleDelete = async () => {
        const ok = confirm(
            t('emailRow.confirmDelete', {
                email: config.email,
                purpose: purposeLabelFor(config.type).toLowerCase(),
            })
        );
        if (!ok) return;
        setDeleting(true);
        try {
            await onDelete(config.type);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="space-y-3 p-3 border rounded-md">
            <div className="flex items-start justify-between gap-3">
                <Badge variant="secondary" className="font-normal">
                    {purposeLabelFor(config.type)}
                </Badge>
                <span
                    className="text-xs text-muted-foreground"
                    title={t('emailRow.purposeLockedTitle')}
                >
                    {t('emailRow.purposeLocked')}
                </span>
            </div>

            {verificationEnabled && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{t('emailRow.sendingStatus')}</span>
                            <VerificationBadge status={vStatus} />
                        </div>
                        <div className="flex items-center gap-2">
                            {vStatus !== 'VERIFIED' && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => runVerify('EMAIL')}
                                    disabled={verifying}
                                >
                                    {verifying ? t('emailRow.working') : t('emailRow.verifySender')}
                                </Button>
                            )}
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={refreshStatus}
                                disabled={checking}
                            >
                                {checking ? t('emailRow.checking') : t('emailRow.refreshStatus')}
                            </Button>
                        </div>
                    </div>
                    {vMessage && (
                        <div className="text-xs text-muted-foreground leading-relaxed">
                            {vMessage}
                        </div>
                    )}
                    {vDns && vDns.length > 0 && <DnsRecordsTable records={vDns} />}
                    {(!vDns || vDns.length === 0) && (
                        <button
                            type="button"
                            className="text-xs text-info-600 underline underline-offset-2 disabled:opacity-50"
                            onClick={() => runVerify('DOMAIN')}
                            disabled={verifying}
                        >
                            {vStatus === 'VERIFIED'
                                ? t('emailRow.verifyDomainUpgrade')
                                : t('emailRow.verifyDomainInstead')}
                        </button>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                    <Label className="text-xs">{t('emailList.fields.email')}</Label>
                    <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="font-mono text-sm"
                    />
                </div>
                <div>
                    <Label className="text-xs">{t('emailList.fields.displayName')}</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('emailList.fields.displayNamePlaceholder')}
                    />
                </div>
                <div>
                    <Label className="text-xs">{t('emailList.fields.notes')}</Label>
                    <Input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('emailList.fields.notesPlaceholder')}
                    />
                </div>
            </div>

            <details className="rounded-md border bg-muted/20 p-2">
                <summary className="cursor-pointer text-xs font-medium">
                    {t('emailRow.controls.controlsTitle')}
                </summary>
                <div className="mt-1 text-xs text-muted-foreground">
                    {t('emailRow.controls.controlsHint')}
                </div>
                <label className="mt-3 flex items-start gap-2 text-xs">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={rampEnabled}
                        onChange={(e) => setRampEnabled(e.target.checked)}
                    />
                    <span>
                        {t('emailRow.controls.rampEnabled')}
                        <span className="block text-muted-foreground">
                            {t('emailRow.controls.rampEnabledHint')}
                        </span>
                    </span>
                </label>
                {rampEnabled && (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                        <div>
                            <Label className="text-xs">
                                {t('emailRow.controls.rampStartPerDay')}
                            </Label>
                            <Input
                                type="number"
                                min={0}
                                value={rampStartPerDay}
                                onChange={(e) => setRampStartPerDay(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('emailRow.controls.rampStep')}</Label>
                            <Input
                                type="number"
                                min={0}
                                value={rampStep}
                                onChange={(e) => setRampStep(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">
                                {t('emailRow.controls.rampEveryDays')}
                            </Label>
                            <Input
                                type="number"
                                min={1}
                                value={rampEveryDays}
                                onChange={(e) => setRampEveryDays(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('emailRow.controls.rampCeiling')}</Label>
                            <Input
                                type="number"
                                min={0}
                                value={rampCeiling}
                                onChange={(e) => setRampCeiling(e.target.value)}
                            />
                        </div>
                        {config.rampStartedOn && (
                            <div className="text-xs text-muted-foreground md:col-span-4">
                                {t('emailRow.controls.rampStartedOn', {
                                    date: config.rampStartedOn,
                                })}
                            </div>
                        )}
                    </div>
                )}
                <label className="mt-3 flex items-start gap-2 text-xs">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={skipWeekends}
                        onChange={(e) => setSkipWeekends(e.target.checked)}
                    />
                    <span>{t('emailRow.controls.skipWeekends')}</span>
                </label>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div>
                        <Label className="text-xs">
                            {rampEnabled
                                ? t('emailRow.controls.maxPerDayManaged')
                                : t('emailRow.controls.maxPerDay')}
                        </Label>
                        <Input
                            type="number"
                            min={0}
                            value={maxPerDay}
                            onChange={(e) => setMaxPerDay(e.target.value)}
                            placeholder={t('emailRow.controls.maxPerDayPlaceholder')}
                            disabled={rampEnabled}
                        />
                    </div>
                    <div>
                        <Label className="text-xs">{t('emailRow.controls.timezone')}</Label>
                        <Input
                            value={timezone}
                            onChange={(e) => setTimezone(e.target.value)}
                            placeholder={t('emailRow.controls.timezonePlaceholder')}
                            className="font-mono text-sm"
                        />
                    </div>
                    <div>
                        <Label className="text-xs">{t('emailRow.controls.sendAfterHour')}</Label>
                        <Input
                            type="number"
                            min={0}
                            max={23}
                            value={sendAfterHour}
                            onChange={(e) => setSendAfterHour(e.target.value)}
                        />
                    </div>
                    <div className="md:col-span-3">
                        <Label className="text-xs">{t('emailRow.controls.postalAddress')}</Label>
                        <Input
                            value={postalAddress}
                            onChange={(e) => setPostalAddress(e.target.value)}
                            placeholder={t('emailRow.controls.postalAddressPlaceholder')}
                        />
                    </div>
                    <label className="flex items-start gap-2 text-xs md:col-span-3">
                        <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={listUnsubscribe}
                            onChange={(e) => setListUnsubscribe(e.target.checked)}
                        />
                        <span>
                            {t('emailRow.controls.listUnsubscribe')}
                            <span className="block text-muted-foreground">
                                {t('emailRow.controls.listUnsubscribeHint')}
                            </span>
                        </span>
                    </label>
                </div>
            </details>

            <div className="flex items-center justify-end gap-2">
                {isDirty && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        disabled={saving}
                    >
                        {t('emailRow.cancel')}
                    </Button>
                )}
                <Button
                    type="button"
                    size="sm"
                    onClick={handleUpdate}
                    disabled={!canSave}
                >
                    {saving ? t('emailRow.saving') : t('emailRow.saveChanges')}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                >
                    <Trash className="size-4 mr-1" />
                    {deleting ? t('emailRow.removing') : t('emailRow.remove')}
                </Button>
            </div>
        </div>
    );
}
