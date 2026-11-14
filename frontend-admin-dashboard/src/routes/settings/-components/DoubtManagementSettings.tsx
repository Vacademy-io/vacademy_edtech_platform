import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import SelectChips from '@/components/design-system/SelectChips';
import { toast } from 'sonner';
import { Plus, Trash } from '@phosphor-icons/react';
import { ColorPicker } from '@/components/ui/color-picker';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import {
    useInstituteAssignees,
    type AssigneeOption,
} from '@/routes/dashboard/-hooks/useInstituteAssignees';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

type DoubtAssigneeSource = 'SUBJECT_TEACHER' | 'BATCH_TEACHER' | 'BOTH' | 'NONE';

// Per-type routing can additionally target a role or specific staff, beyond the faculty cascade.
type QueryTypeAssigneeSource =
    | 'SUBJECT_TEACHER'
    | 'BATCH_TEACHER'
    | 'BOTH'
    | 'ROLE'
    | 'SPECIFIC_USERS'
    | 'NONE';

interface QueryTypeAssignee {
    /** Absent = no override; the institute-wide "Default auto-assignment" is the base. */
    source?: QueryTypeAssigneeSource;
    role?: string | null;
    user_ids?: string[];
    /** Roles assigned IN ADDITION to whatever `source` resolves to. */
    also_roles?: string[];
    /** Staff assigned IN ADDITION to whatever `source` resolves to. */
    also_user_ids?: string[];
}

interface QueryTypeConfig {
    key: string;
    label: string;
    enabled?: boolean;
    is_system?: boolean;
    learner_selectable?: boolean;
    assignee?: QueryTypeAssignee | null;
}

interface LearnerQueryPrefs {
    enabled: boolean;
    show_topbar_icon: boolean;
    show_dashboard_card: boolean;
    /** Logged-out visitors can raise queries from the login page; replies go to their email. */
    allow_guest: boolean;
}

interface NotificationChannelPrefs {
    push_enabled: boolean;
    email_enabled: boolean;
    system_alert_enabled: boolean;
    email_template_id: string | null;
}

interface DoubtNotificationPrefs {
    on_doubt_raised: NotificationChannelPrefs;
    on_doubt_resolved: NotificationChannelPrefs;
}

type SubOrgNotifyRecipients = 'ADMINS_ONLY' | 'ALL_TEAM';

interface SubOrgNotificationPrefs {
    /** Also route a sub-org learner's doubt to that sub-org's own staff. */
    enabled: boolean;
    recipients: SubOrgNotifyRecipients;
    /**
     * When true (default), the parent institute's own staff are notified too (additive). When
     * false, only the sub-org is emailed — the parent team gets no notification but still sees the
     * doubt in Doubt Management.
     */
    notify_parent_staff: boolean;
}

/** Learner-facing meaning of a status; drives the coarse ACTIVE/RESOLVED state and the learner tone. */
type WorkflowStatusKind = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

/** Mirrors the backend WorkflowStatusConfig (DOUBT_MANAGEMENT_SETTING.statuses). */
interface WorkflowStatusConfig {
    key: string;
    label: string;
    learner_label?: string | null;
    kind: WorkflowStatusKind;
    color?: string | null;
    enabled: boolean;
    is_system: boolean;
}

interface DoubtManagementSettingsData {
    default_assignee_source: DoubtAssigneeSource;
    fallback_to_batch_when_no_subject_teacher: boolean;
    notifications: DoubtNotificationPrefs;
    learner_query: LearnerQueryPrefs;
    query_types: QueryTypeConfig[];
    sub_org_notifications: SubOrgNotificationPrefs;
    /** Configurable workflow statuses. PENDING and RESOLVED are built in and always present. */
    statuses: WorkflowStatusConfig[];
}

const STATUS_KINDS: WorkflowStatusKind[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

// The two built-ins — mirrors DoubtStatusCatalog.defaults() on the backend. Labels are editable,
// keys and kinds are not (the learner app and every filter lean on PENDING/RESOLVED).
const SYSTEM_STATUSES: WorkflowStatusConfig[] = [
    {
        key: 'PENDING',
        label: 'Pending',
        learner_label: null,
        kind: 'OPEN',
        color: null,
        enabled: true,
        is_system: true,
    },
    {
        key: 'RESOLVED',
        label: 'Resolved',
        learner_label: null,
        kind: 'RESOLVED',
        color: null,
        enabled: true,
        is_system: true,
    },
];

/** Same normalisation the backend applies: built-ins guaranteed around the stored list. */
function normalizeStatuses(raw: unknown): WorkflowStatusConfig[] {
    const stored = Array.isArray(raw) ? (raw as Partial<WorkflowStatusConfig>[]) : [];
    const out: WorkflowStatusConfig[] = [];
    let hasPending = false;
    let hasResolved = false;
    for (const s of stored) {
        const key = (s?.key ?? '').trim().toUpperCase();
        if (!key) continue;
        if (key === 'PENDING') hasPending = true;
        if (key === 'RESOLVED') hasResolved = true;
        const kindRaw = (s.kind ?? '').toString().toUpperCase() as WorkflowStatusKind;
        out.push({
            key,
            label: s.label?.trim() || key,
            learner_label: s.learner_label ?? null,
            kind:
                key === 'PENDING'
                    ? 'OPEN'
                    : key === 'RESOLVED'
                      ? 'RESOLVED'
                      : STATUS_KINDS.includes(kindRaw)
                        ? kindRaw
                        : 'OPEN',
            color: s.color ?? null,
            enabled: s.enabled !== false,
            is_system: key === 'PENDING' || key === 'RESOLVED' || !!s.is_system,
        });
    }
    if (!hasPending) out.unshift({ ...SYSTEM_STATUSES[0]! });
    if (!hasResolved) out.push({ ...SYSTEM_STATUSES[1]! });
    return out;
}

const DEFAULT_CHANNEL_PREFS: NotificationChannelPrefs = {
    push_enabled: true,
    email_enabled: true,
    system_alert_enabled: true,
    email_template_id: null,
};

// Mirrors the backend default in DoubtManagementSettingDataDto.SubOrgNotificationPrefs: on, and
// the whole sub-org team. A sub-org learner's doubt is otherwise invisible to the sub-org — every
// other route resolves to the parent institute's staff.
const DEFAULT_SUB_ORG_NOTIFICATIONS: SubOrgNotificationPrefs = {
    enabled: true,
    recipients: 'ALL_TEAM',
    notify_parent_staff: true,
};

const DEFAULT_LEARNER_QUERY: LearnerQueryPrefs = {
    enabled: false,
    show_topbar_icon: false,
    show_dashboard_card: false,
    allow_guest: false,
};

// Always-present academic type — cannot be removed (historical rows keep type='DOUBT').
// `assignee: null` = no per-type override, so it follows the global "Default auto-assignment"
// radio. Admins can override it (including to specific staff) from the Query types card.
const SYSTEM_DOUBT_TYPE: QueryTypeConfig = {
    key: 'DOUBT',
    label: 'Doubt',
    enabled: true,
    is_system: true,
    learner_selectable: true,
    assignee: null,
};

// Seeded defaults shown to institutes that haven't configured types yet. Nothing is persisted (or
// shown to learners) until the admin enables learner intake and hits Save.
const DEFAULT_QUERY_TYPES: QueryTypeConfig[] = [
    SYSTEM_DOUBT_TYPE,
    {
        key: 'TECHNICAL',
        label: 'Technical Issue',
        enabled: true,
        learner_selectable: true,
        assignee: { source: 'ROLE', role: 'ADMIN' },
    },
    {
        key: 'PAYMENT',
        label: 'Payment Issue',
        enabled: true,
        learner_selectable: true,
        assignee: { source: 'ROLE', role: 'ADMIN' },
    },
];

// Roles offered when a type routes by ROLE.
const ROLE_OPTIONS = ['ADMIN', 'TEACHER', 'EVALUATOR', 'CONTENT CREATOR', 'ASSESSMENT CREATOR'];

/**
 * Frontend-only sentinel for "no per-type override" — the type defers to the institute-wide
 * "Default auto-assignment" radio above. It is never persisted as a source string: picking it
 * clears the type's `assignee` entirely, which is what makes the backend
 * (DoubtsManager.resolveAssigneesForDoubt) fall back to `default_assignee_source`.
 */
const INHERIT_DEFAULT = 'DEFAULT';
type RouteSelectValue = QueryTypeAssigneeSource | typeof INHERIT_DEFAULT;

// i18nKey maps to queryTypes.assigneeSource.<i18nKey> in the settingsDoubtManagement catalog.
const ASSIGNEE_SOURCE_OPTIONS: { value: RouteSelectValue; i18nKey: string }[] = [
    { value: INHERIT_DEFAULT, i18nKey: 'default' },
    { value: 'SUBJECT_TEACHER', i18nKey: 'subjectTeacher' },
    { value: 'BATCH_TEACHER', i18nKey: 'batchTeacher' },
    { value: 'ROLE', i18nKey: 'role' },
    { value: 'SPECIFIC_USERS', i18nKey: 'specificUsers' },
    { value: 'NONE', i18nKey: 'none' },
];

/**
 * Strips empty additive arrays and collapses an assignee that no longer says anything to
 * `undefined`. Sending `also_user_ids: []` would be harmless but writes noise into every institute's
 * settings blob, and an assignee of `{}` reads as "configured" while behaving as "not configured".
 */
const normalizeAssignee = (assignee: QueryTypeAssignee | null | undefined) => {
    if (!assignee) return undefined;
    const alsoRoles = (assignee.also_roles ?? []).filter(Boolean);
    const alsoUsers = (assignee.also_user_ids ?? []).filter(Boolean);
    const next: QueryTypeAssignee = { ...assignee };
    delete next.also_roles;
    delete next.also_user_ids;
    if (alsoRoles.length) next.also_roles = alsoRoles;
    if (alsoUsers.length) next.also_user_ids = alsoUsers;
    if (!next.source && !next.also_roles && !next.also_user_ids) return undefined;
    return next;
};

/** UPPER_SNAKE slug used as a stable type key when the admin adds a new type. */
const slugifyKey = (label: string): string =>
    label
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'TYPE';

const DEFAULT_SETTINGS: DoubtManagementSettingsData = {
    default_assignee_source: 'BATCH_TEACHER',
    fallback_to_batch_when_no_subject_teacher: true,
    notifications: {
        on_doubt_raised: { ...DEFAULT_CHANNEL_PREFS },
        on_doubt_resolved: { ...DEFAULT_CHANNEL_PREFS },
    },
    learner_query: { ...DEFAULT_LEARNER_QUERY },
    query_types: DEFAULT_QUERY_TYPES.map((t) => ({ ...t })),
    sub_org_notifications: { ...DEFAULT_SUB_ORG_NOTIFICATIONS },
    statuses: SYSTEM_STATUSES.map((s) => ({ ...s })),
};

const SETTING_KEY = 'DOUBT_MANAGEMENT_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
const TEMPLATES_BY_TYPE_URL = (instituteId: string, type: string) =>
    `${BASE_URL}/admin-core-service/institute/template/v1/institute/${instituteId}/type/${type}`;

// i18nKey maps to defaultAssignment.options.<i18nKey> in the settingsDoubtManagement catalog.
const OPTIONS: { value: DoubtAssigneeSource; i18nKey: string }[] = [
    { value: 'SUBJECT_TEACHER', i18nKey: 'subjectTeacher' },
    { value: 'BATCH_TEACHER', i18nKey: 'batchTeacher' },
    { value: 'BOTH', i18nKey: 'both' },
    { value: 'NONE', i18nKey: 'none' },
];

// Labels take the institute's own word for a sub-org (Franchise / Center / ...) so the copy reads
// correctly wherever NamingSettings has been customised. i18nKey maps to
// subOrg.recipients.<i18nKey> in the settingsDoubtManagement catalog.
const SUB_ORG_RECIPIENT_OPTIONS: {
    value: SubOrgNotifyRecipients;
    i18nKey: string;
}[] = [
    { value: 'ALL_TEAM', i18nKey: 'allTeam' },
    { value: 'ADMINS_ONLY', i18nKey: 'adminsOnly' },
];

type EmailTemplateOption = { id: string; name: string };

const fetchSettings = async (): Promise<DoubtManagementSettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    // `/get` returns a SettingDto shape: { key, name, data }. `data` is the typed payload.
    const stored = response.data?.data ?? null;
    return mergeWithDefaults(stored);
};

/**
 * Merges whatever is stored server-side with DEFAULT_SETTINGS so missing fields don't render
 * uncontrolled inputs. This also handles the case where an institute has a pre-notifications
 * payload saved (no `notifications` block yet).
 */
function mergeWithDefaults(
    raw: Partial<DoubtManagementSettingsData> | null
): DoubtManagementSettingsData {
    if (!raw) return DEFAULT_SETTINGS;
    // Existing institutes may have a payload without query_types/learner_query — seed defaults so
    // the editors render, but leave learner intake OFF so nothing changes for them until they save.
    const storedTypes =
        Array.isArray(raw.query_types) && raw.query_types.length > 0
            ? raw.query_types
            : DEFAULT_QUERY_TYPES;
    const hasDoubt = storedTypes.some((t) => t?.key?.toUpperCase() === 'DOUBT');
    const query_types = (hasDoubt ? storedTypes : [SYSTEM_DOUBT_TYPE, ...storedTypes]).map((t) => ({
        ...t,
        enabled: t.enabled ?? true,
        learner_selectable: t.learner_selectable ?? true,
        is_system: t.key?.toUpperCase() === 'DOUBT' ? true : t.is_system ?? false,
        // A stored type with no assignee keeps deferring to `default_assignee_source`. Seeding a
        // concrete source here would silently start overriding that global choice on the next save.
        assignee: t.assignee ?? null,
    }));
    return {
        default_assignee_source:
            raw.default_assignee_source ?? DEFAULT_SETTINGS.default_assignee_source,
        fallback_to_batch_when_no_subject_teacher:
            raw.fallback_to_batch_when_no_subject_teacher ??
            DEFAULT_SETTINGS.fallback_to_batch_when_no_subject_teacher,
        notifications: {
            on_doubt_raised: {
                ...DEFAULT_CHANNEL_PREFS,
                ...(raw.notifications?.on_doubt_raised ?? {}),
            },
            on_doubt_resolved: {
                ...DEFAULT_CHANNEL_PREFS,
                ...(raw.notifications?.on_doubt_resolved ?? {}),
            },
        },
        learner_query: { ...DEFAULT_LEARNER_QUERY, ...(raw.learner_query ?? {}) },
        query_types,
        sub_org_notifications: {
            ...DEFAULT_SUB_ORG_NOTIFICATIONS,
            ...(raw.sub_org_notifications ?? {}),
        },
        statuses: normalizeStatuses(raw.statuses),
    };
}

const saveSettings = async (data: DoubtManagementSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Doubt Management Settings', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

const fetchEmailTemplates = async (): Promise<EmailTemplateOption[]> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return [];
    try {
        const response = await authenticatedAxiosInstance.get(
            TEMPLATES_BY_TYPE_URL(instituteId, 'EMAIL')
        );
        const rows = Array.isArray(response.data) ? response.data : response.data?.data ?? [];
        return rows
            .filter((t: { id?: string; name?: string }) => !!t?.id && !!t?.name)
            .map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
    } catch {
        return [];
    }
};

export default function DoubtManagementSettings() {
    const { t } = useTranslation('settingsDoubtManagement');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? undefined;
    const { assignees, isLoading: assigneesLoading } = useInstituteAssignees(instituteId);
    const [settings, setSettings] = useState<DoubtManagementSettingsData>(DEFAULT_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);
    const { ensurePermission } = usePushNotifications();
    const [browserPushStatus, setBrowserPushStatus] = useState<
        NotificationPermission | 'unsupported'
    >(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

    const handleEnablePush = async () => {
        if (browserPushStatus === 'unsupported') {
            toast.error(t('toast.pushUnsupported'));
            return;
        }
        await ensurePermission();
        // Permission state may have changed; re-read to reflect in UI.
        if (typeof Notification !== 'undefined') {
            setBrowserPushStatus(Notification.permission);
            if (Notification.permission === 'granted') {
                toast.success(t('toast.pushEnabled'));
            } else if (Notification.permission === 'denied') {
                toast.error(t('toast.pushBlocked'));
            }
        }
    };

    const { data, isLoading } = useQuery({
        queryKey: ['doubt-management-settings'],
        queryFn: fetchSettings,
        staleTime: 5 * 60 * 1000,
    });

    const { data: emailTemplates = [] } = useQuery({
        queryKey: ['doubt-management-email-templates'],
        queryFn: fetchEmailTemplates,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveSettings,
        onSuccess: () => {
            toast.success(t('toast.saveSuccess'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['doubt-management-settings'] });
        },
        onError: () => {
            toast.error(t('toast.saveFailed'));
        },
    });

    const update = (patch: Partial<DoubtManagementSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const updateNotificationEvent = (
        event: keyof DoubtNotificationPrefs,
        patch: Partial<NotificationChannelPrefs>
    ) => {
        setSettings((prev) => ({
            ...prev,
            notifications: {
                ...prev.notifications,
                [event]: { ...prev.notifications[event], ...patch },
            },
        }));
        setHasChanges(true);
    };

    const updateLearnerQuery = (patch: Partial<LearnerQueryPrefs>) => {
        setSettings((prev) => ({ ...prev, learner_query: { ...prev.learner_query, ...patch } }));
        setHasChanges(true);
    };

    const updateQueryType = (index: number, patch: Partial<QueryTypeConfig>) => {
        setSettings((prev) => ({
            ...prev,
            query_types: prev.query_types.map((qt, i) => (i === index ? { ...qt, ...patch } : qt)),
        }));
        setHasChanges(true);
    };

    const addQueryType = () => {
        setSettings((prev) => ({
            ...prev,
            query_types: [
                ...prev.query_types,
                {
                    key: '',
                    label: '',
                    enabled: true,
                    learner_selectable: true,
                    assignee: { source: 'ROLE', role: 'ADMIN' },
                },
            ],
        }));
        setHasChanges(true);
    };

    const removeQueryType = (index: number) => {
        setSettings((prev) => ({
            ...prev,
            query_types: prev.query_types.filter((_, i) => i !== index),
        }));
        setHasChanges(true);
    };

    const updateStatus = (index: number, patch: Partial<WorkflowStatusConfig>) => {
        setSettings((prev) => ({
            ...prev,
            statuses: prev.statuses.map((st, i) => (i === index ? { ...st, ...patch } : st)),
        }));
        setHasChanges(true);
    };

    // New statuses slot in before RESOLVED so the list reads as a left-to-right workflow.
    const addStatus = () => {
        setSettings((prev) => {
            const resolvedIdx = prev.statuses.findIndex((st) => st.key === 'RESOLVED');
            const next: WorkflowStatusConfig = {
                key: '',
                label: '',
                learner_label: null,
                kind: 'IN_PROGRESS',
                color: null,
                enabled: true,
                is_system: false,
            };
            const statuses = [...prev.statuses];
            statuses.splice(resolvedIdx < 0 ? statuses.length : resolvedIdx, 0, next);
            return { ...prev, statuses };
        });
        setHasChanges(true);
    };

    const removeStatus = (index: number) => {
        setSettings((prev) => ({
            ...prev,
            statuses: prev.statuses.filter((_, i) => i !== index),
        }));
        setHasChanges(true);
    };

    const showFallbackToggle = settings.default_assignee_source === 'SUBJECT_TEACHER';
    const subOrgLabel = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);

    // Email can be turned on without explicitly picking a template — the backend resolves through
    // three layers: admin-configured id → institute-specific override row → global DEFAULT row
    // seeded by V215 (see DoubtNotificationService.resolveTemplateId). Email defaults to ON;
    // admins can turn it off per-event below.
    const handleSave = () => {
        // Drop blank rows, assign a stable UPPER_SNAKE key to new types (the system DOUBT key is
        // fixed), and de-duplicate by key so the per-type routing lookup is unambiguous.
        const seen = new Set<string>();
        const normalizedTypes: QueryTypeConfig[] = [];
        for (const qt of settings.query_types) {
            const label = qt.label.trim();
            if (!label && !qt.is_system) continue;
            const key = (qt.is_system ? 'DOUBT' : qt.key || slugifyKey(label)).toUpperCase();
            if (seen.has(key)) {
                toast.error(t('toast.duplicateType', { key }));
                return;
            }
            seen.add(key);
            normalizedTypes.push({
                ...qt,
                key,
                label: label || qt.label,
                // Every type — the built-in DOUBT included — may carry its own routing. An
                // assignee that says nothing (no source, no additive handlers) is dropped so the
                // backend keeps falling back to default_assignee_source for that type.
                assignee: normalizeAssignee(qt.assignee),
            });
        }
        // Statuses: drop blank rows, give new ones a stable UPPER_SNAKE key, keep keys unique.
        const seenStatus = new Set<string>();
        const normalizedStatuses: WorkflowStatusConfig[] = [];
        for (const st of settings.statuses) {
            const label = st.label.trim();
            if (!label && !st.is_system) continue;
            const key = (st.is_system ? st.key : st.key || slugifyKey(label)).toUpperCase();
            if (seenStatus.has(key)) {
                toast.error(t('toast.duplicateStatus', { key }));
                return;
            }
            seenStatus.add(key);
            normalizedStatuses.push({
                ...st,
                key,
                label: label || st.label,
                learner_label: st.learner_label?.trim() || null,
                color: st.color?.trim() || null,
            });
        }
        save({ ...settings, query_types: normalizedTypes, statuses: normalizedStatuses });
    };

    if (isLoading) {
        return <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('defaultAssignment.title')}</CardTitle>
                    <CardDescription>{t('defaultAssignment.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {OPTIONS.map((opt) => {
                        const selected = settings.default_assignee_source === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => update({ default_assignee_source: opt.value })}
                                className={`w-full rounded-lg border p-4 text-left transition-colors ${
                                    selected
                                        ? 'border-primary-400 bg-primary-50'
                                        : 'border-neutral-200 hover:border-neutral-300'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <span
                                        aria-hidden
                                        className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                                            selected
                                                ? 'border-primary-500 bg-primary-500'
                                                : 'border-neutral-300 bg-white'
                                        }`}
                                    >
                                        {selected && (
                                            <span className="size-1.5 rounded-full bg-white" />
                                        )}
                                    </span>
                                    <div>
                                        <div className="text-sm font-medium text-neutral-800">
                                            {t(`defaultAssignment.options.${opt.i18nKey}.title`)}
                                        </div>
                                        <p className="mt-0.5 text-xs text-neutral-600">
                                            {t(
                                                `defaultAssignment.options.${opt.i18nKey}.description`
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </CardContent>
            </Card>

            {showFallbackToggle && (
                <Card>
                    <CardHeader>
                        <CardTitle>{t('fallback.title')}</CardTitle>
                        <CardDescription>{t('fallback.description')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-start gap-3">
                            <Switch
                                id="fallback-to-batch"
                                checked={settings.fallback_to_batch_when_no_subject_teacher}
                                onCheckedChange={(v) =>
                                    update({ fallback_to_batch_when_no_subject_teacher: v })
                                }
                            />
                            <div>
                                <Label
                                    htmlFor="fallback-to-batch"
                                    className="cursor-pointer text-sm font-medium text-neutral-800"
                                >
                                    {t('fallback.label')}
                                </Label>
                                <p className="mt-0.5 text-xs text-neutral-600">
                                    {t('fallback.hint')}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>{t('subOrg.title', { label: subOrgLabel })}</CardTitle>
                    <CardDescription>
                        {t('subOrg.description', { labelLower: subOrgLabel.toLowerCase() })}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-start gap-3">
                        <Switch
                            id="sub-org-notify"
                            checked={settings.sub_org_notifications.enabled}
                            onCheckedChange={(v) =>
                                update({
                                    sub_org_notifications: {
                                        ...settings.sub_org_notifications,
                                        enabled: v,
                                    },
                                })
                            }
                        />
                        <div>
                            <Label
                                htmlFor="sub-org-notify"
                                className="cursor-pointer text-sm font-medium text-neutral-800"
                            >
                                {t('subOrg.notifyLabel', { labelLower: subOrgLabel.toLowerCase() })}
                            </Label>
                            <p className="mt-0.5 text-xs text-neutral-600">
                                {t('subOrg.notifyHint')}
                            </p>
                        </div>
                    </div>

                    {settings.sub_org_notifications.enabled && (
                        <div className="space-y-2 border-t border-neutral-200 pt-4">
                            <Label className="text-sm font-medium text-neutral-800">
                                {t('subOrg.whoReceives')}
                            </Label>
                            {SUB_ORG_RECIPIENT_OPTIONS.map((opt) => {
                                const selected =
                                    settings.sub_org_notifications.recipients === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() =>
                                            update({
                                                sub_org_notifications: {
                                                    ...settings.sub_org_notifications,
                                                    recipients: opt.value,
                                                },
                                            })
                                        }
                                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                            selected
                                                ? 'border-primary-400 bg-primary-50'
                                                : 'border-neutral-200 hover:border-neutral-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <span
                                                aria-hidden
                                                className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                                                    selected
                                                        ? 'border-primary-500 bg-primary-500'
                                                        : 'border-neutral-300 bg-white'
                                                }`}
                                            >
                                                {selected && (
                                                    <span className="size-1.5 rounded-full bg-white" />
                                                )}
                                            </span>
                                            <div>
                                                <div className="text-sm font-medium text-neutral-800">
                                                    {t(`subOrg.recipients.${opt.i18nKey}.title`, {
                                                        label: subOrgLabel,
                                                    })}
                                                </div>
                                                <p className="mt-0.5 text-xs text-neutral-600">
                                                    {t(
                                                        `subOrg.recipients.${opt.i18nKey}.description`,
                                                        { labelLower: subOrgLabel.toLowerCase() }
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {settings.sub_org_notifications.enabled && (
                        <div className="space-y-3 border-t border-neutral-200 pt-4">
                            <div className="flex items-start gap-3">
                                <Switch
                                    id="sub-org-notify-parent"
                                    checked={settings.sub_org_notifications.notify_parent_staff}
                                    onCheckedChange={(v) =>
                                        update({
                                            sub_org_notifications: {
                                                ...settings.sub_org_notifications,
                                                notify_parent_staff: v,
                                            },
                                        })
                                    }
                                />
                                <div>
                                    <Label
                                        htmlFor="sub-org-notify-parent"
                                        className="cursor-pointer text-sm font-medium text-neutral-800"
                                    >
                                        {t('subOrg.notifyParentLabel')}
                                    </Label>
                                    <p className="mt-0.5 text-xs text-neutral-600">
                                        {settings.sub_org_notifications.notify_parent_staff
                                            ? t('subOrg.notifyParentOn', {
                                                  labelLower: subOrgLabel.toLowerCase(),
                                              })
                                            : t('subOrg.notifyParentOff', {
                                                  labelLower: subOrgLabel.toLowerCase(),
                                              })}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('browserPush.title')}</CardTitle>
                    <CardDescription>{t('browserPush.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between gap-4">
                        <div className="text-sm">
                            <div className="font-medium text-neutral-800">
                                {browserPushStatus === 'granted'
                                    ? t('browserPush.status.granted')
                                    : browserPushStatus === 'denied'
                                      ? t('browserPush.status.denied')
                                      : browserPushStatus === 'unsupported'
                                        ? t('browserPush.status.unsupported')
                                        : t('browserPush.status.default')}
                            </div>
                            <p className="mt-0.5 text-xs text-neutral-600">
                                {browserPushStatus === 'granted' && t('browserPush.hint.granted')}
                                {browserPushStatus === 'denied' && t('browserPush.hint.denied')}
                                {browserPushStatus === 'default' && t('browserPush.hint.default')}
                                {browserPushStatus === 'unsupported' &&
                                    t('browserPush.hint.unsupported')}
                            </p>
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={handleEnablePush}
                            disable={
                                browserPushStatus === 'granted' ||
                                browserPushStatus === 'unsupported'
                            }
                        >
                            {browserPushStatus === 'granted'
                                ? t('browserPush.alreadyEnabled')
                                : t('browserPush.enableButton')}
                        </MyButton>
                    </div>
                </CardContent>
            </Card>

            <NotificationEventCard
                title={t('events.raised.title')}
                description={t('events.raised.description')}
                idPrefix="raised"
                prefs={settings.notifications.on_doubt_raised}
                templates={emailTemplates}
                onChange={(patch) => updateNotificationEvent('on_doubt_raised', patch)}
            />

            <NotificationEventCard
                title={t('events.resolved.title')}
                description={t('events.resolved.description')}
                idPrefix="resolved"
                prefs={settings.notifications.on_doubt_resolved}
                templates={emailTemplates}
                onChange={(patch) => updateNotificationEvent('on_doubt_resolved', patch)}
            />

            <QueryTypesCard
                types={settings.query_types}
                assignees={assignees}
                assigneesLoading={assigneesLoading}
                onUpdate={updateQueryType}
                onAdd={addQueryType}
                onRemove={removeQueryType}
            />

            <StatusesCard
                statuses={settings.statuses}
                onUpdate={updateStatus}
                onAdd={addStatus}
                onRemove={removeStatus}
            />

            <LearnerQueryCard prefs={settings.learner_query} onChange={updateLearnerQuery} />

            <div className="flex justify-end">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleSave}
                    disable={saving || !hasChanges}
                >
                    {saving ? t('saveButton.saving') : t('saveButton.save')}
                </MyButton>
            </div>
        </div>
    );
}

function NotificationEventCard({
    title,
    description,
    idPrefix,
    prefs,
    templates,
    onChange,
}: {
    title: string;
    description: string;
    idPrefix: string;
    prefs: NotificationChannelPrefs;
    templates: EmailTemplateOption[];
    onChange: (patch: Partial<NotificationChannelPrefs>) => void;
}) {
    const { t } = useTranslation('settingsDoubtManagement');
    const pushId = `${idPrefix}-push`;
    const emailId = `${idPrefix}-email`;
    const systemAlertId = `${idPrefix}-system-alert`;
    const templateId = `${idPrefix}-template`;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                    <Switch
                        id={pushId}
                        checked={prefs.push_enabled}
                        onCheckedChange={(v) => onChange({ push_enabled: v })}
                    />
                    <div>
                        <Label
                            htmlFor={pushId}
                            className="cursor-pointer text-sm font-medium text-neutral-800"
                        >
                            {t('notificationCard.push.label')}
                        </Label>
                        <p className="mt-0.5 text-xs text-neutral-600">
                            {t('notificationCard.push.hint')}
                        </p>
                    </div>
                </div>

                <div className="flex items-start gap-3">
                    <Switch
                        id={systemAlertId}
                        checked={prefs.system_alert_enabled}
                        onCheckedChange={(v) => onChange({ system_alert_enabled: v })}
                    />
                    <div>
                        <Label
                            htmlFor={systemAlertId}
                            className="cursor-pointer text-sm font-medium text-neutral-800"
                        >
                            {t('notificationCard.bell.label')}
                        </Label>
                        <p className="mt-0.5 text-xs text-neutral-600">
                            {t('notificationCard.bell.hint')}
                        </p>
                    </div>
                </div>

                <div className="flex items-start gap-3">
                    <Switch
                        id={emailId}
                        checked={prefs.email_enabled}
                        onCheckedChange={(v) =>
                            onChange({
                                email_enabled: v,
                                ...(v ? {} : { email_template_id: null }),
                            })
                        }
                    />
                    <div className="flex-1">
                        <Label
                            htmlFor={emailId}
                            className="cursor-pointer text-sm font-medium text-neutral-800"
                        >
                            {t('notificationCard.email.label')}
                        </Label>
                        <p className="mt-0.5 text-xs text-neutral-600">
                            {t('notificationCard.email.hint')}
                        </p>

                        {prefs.email_enabled && (
                            <div className="mt-2 space-y-1">
                                <Label htmlFor={templateId} className="text-xs text-neutral-700">
                                    {t('notificationCard.emailTemplate.label')}
                                </Label>
                                <select
                                    id={templateId}
                                    className="w-full max-w-md rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 focus:border-primary-400 focus:outline-none"
                                    value={prefs.email_template_id ?? ''}
                                    onChange={(e) =>
                                        onChange({
                                            email_template_id: e.target.value || null,
                                        })
                                    }
                                >
                                    <option value="">
                                        {t('notificationCard.emailTemplate.defaultOption')}
                                    </option>
                                    {templates.map((tpl) => (
                                        <option key={tpl.id} value={tpl.id}>
                                            {tpl.name}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-caption text-neutral-500">
                                    {t('notificationCard.emailTemplate.helpPrefix')}{' '}
                                    <em>{t('notificationCard.emailTemplate.helpEm')}</em>{' '}
                                    {t('notificationCard.emailTemplate.helpSuffix')}
                                </p>
                                <p className="text-caption text-neutral-500">
                                    {t('notificationCard.emailTemplate.placeholdersLabel')}{' '}
                                    <code>{'{{institute_name}}'}</code>,{' '}
                                    <code>{'{{institute_theme_color}}'}</code>,{' '}
                                    <code>{'{{recipient_name}}'}</code>,{' '}
                                    <code>{'{{doubt_text}}'}</code>, <code>{'{{doubt_id}}'}</code>,{' '}
                                    <code>{'{{support_email}}'}</code>.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function QueryTypesCard({
    types,
    assignees,
    assigneesLoading,
    onUpdate,
    onAdd,
    onRemove,
}: {
    types: QueryTypeConfig[];
    assignees: AssigneeOption[];
    assigneesLoading: boolean;
    onUpdate: (index: number, patch: Partial<QueryTypeConfig>) => void;
    onAdd: () => void;
    onRemove: (index: number) => void;
}) {
    const { t } = useTranslation('settingsDoubtManagement');
    const assigneeOptions = assignees.map((a) => ({
        label: a.subtitle ? `${a.name} · ${a.subtitle}` : a.name,
        value: a.id,
    }));
    const roleChipOptions = ROLE_OPTIONS.map((r) => ({
        label: t(`queryTypes.roles.${r}`),
        value: r,
    }));

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('queryTypes.title')}</CardTitle>
                <CardDescription>{t('queryTypes.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="space-y-3">
                    {types.map((qt, i) => {
                        const source: RouteSelectValue = qt.assignee?.source ?? INHERIT_DEFAULT;
                        const pickedStaff = qt.assignee?.user_ids ?? [];
                        const alsoStaff = qt.assignee?.also_user_ids ?? [];
                        const alsoRoles = qt.assignee?.also_roles ?? [];
                        // With SPECIFIC_USERS the base list already IS a staff picker; a second one
                        // would just be two lists doing the same job.
                        const showAlsoStaff = source !== 'SPECIFIC_USERS';
                        return (
                            <div
                                key={i}
                                className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3"
                            >
                                <div className="flex items-center gap-3">
                                    <Input
                                        placeholder={t('queryTypes.namePlaceholder')}
                                        value={qt.label}
                                        disabled={qt.is_system}
                                        onChange={(e) => onUpdate(i, { label: e.target.value })}
                                        className="h-9 flex-1"
                                    />
                                    {qt.is_system ? (
                                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                                            {t('queryTypes.builtIn')}
                                        </span>
                                    ) : (
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            aria-label={t('queryTypes.removeType')}
                                            onClick={() => onRemove(i)}
                                            className="shrink-0 !text-neutral-400 hover:!text-danger-500"
                                        >
                                            <Trash className="size-4" />
                                        </MyButton>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={qt.enabled !== false}
                                            onCheckedChange={(v) => onUpdate(i, { enabled: v })}
                                        />
                                        <span className="text-xs text-neutral-700">
                                            {t('queryTypes.enabled')}
                                        </span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={qt.learner_selectable !== false}
                                            onCheckedChange={(v) =>
                                                onUpdate(i, { learner_selectable: v })
                                            }
                                        />
                                        <span className="text-xs text-neutral-700">
                                            {t('queryTypes.learnerCanPick')}
                                        </span>
                                    </label>
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-xs font-semibold text-neutral-600">
                                        {t('queryTypes.routeTo')}
                                    </span>
                                    <select
                                        className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 focus:border-primary-400 focus:outline-none"
                                        value={source}
                                        onChange={(e) => {
                                            const next = e.target.value as RouteSelectValue;
                                            // The sentinel isn't a source — clear the override so
                                            // the type falls back to the global default again,
                                            // keeping any additive handlers on top of it.
                                            if (next === INHERIT_DEFAULT) {
                                                const keep =
                                                    alsoRoles.length || alsoStaff.length
                                                        ? {
                                                              also_roles: alsoRoles,
                                                              also_user_ids: alsoStaff,
                                                          }
                                                        : null;
                                                onUpdate(i, { assignee: keep });
                                                return;
                                            }
                                            onUpdate(i, {
                                                assignee: { ...qt.assignee, source: next },
                                            });
                                        }}
                                    >
                                        {ASSIGNEE_SOURCE_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>
                                                {t(`queryTypes.assigneeSource.${o.i18nKey}`)}
                                            </option>
                                        ))}
                                    </select>

                                    {source === 'ROLE' && (
                                        <select
                                            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 focus:border-primary-400 focus:outline-none"
                                            value={qt.assignee?.role ?? 'ADMIN'}
                                            onChange={(e) =>
                                                onUpdate(i, {
                                                    assignee: {
                                                        ...qt.assignee,
                                                        source: 'ROLE',
                                                        role: e.target.value,
                                                    },
                                                })
                                            }
                                        >
                                            {ROLE_OPTIONS.map((r) => (
                                                <option key={r} value={r}>
                                                    {t(`queryTypes.roles.${r}`)}
                                                </option>
                                            ))}
                                        </select>
                                    )}

                                    {source === INHERIT_DEFAULT && (
                                        <span className="text-xs italic text-neutral-500">
                                            {t('queryTypes.followsDefault')}
                                        </span>
                                    )}
                                </div>

                                {qt.is_system && source !== INHERIT_DEFAULT && (
                                    <p className="text-xs text-neutral-500">
                                        {t('queryTypes.systemRoutingNote')}
                                    </p>
                                )}

                                {source === 'SPECIFIC_USERS' && (
                                    <div className="space-y-1">
                                        <span className="text-xs font-semibold text-neutral-600">
                                            {t('queryTypes.staffHandlers')}
                                        </span>
                                        <SelectChips
                                            options={assigneeOptions}
                                            selected={assigneeOptions.filter((o) =>
                                                pickedStaff.includes(o.value)
                                            )}
                                            onChange={(
                                                picked: { label: string; value: string }[]
                                            ) =>
                                                onUpdate(i, {
                                                    assignee: {
                                                        ...qt.assignee,
                                                        source: 'SPECIFIC_USERS',
                                                        // Preserve already-saved ids that aren't in
                                                        // the loaded staff page (beyond the first
                                                        // 200, or now inactive) so they aren't
                                                        // silently dropped on save.
                                                        user_ids: [
                                                            ...picked.map((p) => p.value),
                                                            ...pickedStaff.filter(
                                                                (id) =>
                                                                    !assigneeOptions.some(
                                                                        (o) => o.value === id
                                                                    )
                                                            ),
                                                        ],
                                                    },
                                                })
                                            }
                                            multiSelect={true}
                                            hasClearFilter={false}
                                            className="min-w-60"
                                        />
                                        {assigneesLoading ? (
                                            <p className="text-xs text-neutral-500">
                                                {t('queryTypes.loadingStaff')}
                                            </p>
                                        ) : assigneeOptions.length === 0 ? (
                                            <p className="text-xs text-warning-600">
                                                {t('queryTypes.noStaff')}
                                            </p>
                                        ) : pickedStaff.length === 0 ? (
                                            <p className="text-xs text-neutral-500">
                                                {t('queryTypes.nobodyPicked')}
                                            </p>
                                        ) : null}
                                    </div>
                                )}

                                <div className="space-y-2 rounded-md bg-neutral-50 p-2">
                                    <span className="text-xs font-semibold text-neutral-600">
                                        {t('queryTypes.alsoAlwaysAssign')}
                                    </span>
                                    <p className="text-xs text-neutral-500">
                                        {t('queryTypes.alsoAssignHint')}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <SelectChips
                                            placeholder={t('queryTypes.rolesPlaceholder')}
                                            options={roleChipOptions}
                                            selected={roleChipOptions.filter((o) =>
                                                alsoRoles.includes(o.value)
                                            )}
                                            onChange={(picked) =>
                                                onUpdate(i, {
                                                    assignee: {
                                                        ...qt.assignee,
                                                        also_roles: picked.map((p) => p.value),
                                                    },
                                                })
                                            }
                                            multiSelect={true}
                                            hasClearFilter={true}
                                            className="min-w-44"
                                        />
                                        {showAlsoStaff && (
                                            <SelectChips
                                                placeholder={t('queryTypes.staffPlaceholder')}
                                                options={assigneeOptions}
                                                selected={assigneeOptions.filter((o) =>
                                                    alsoStaff.includes(o.value)
                                                )}
                                                onChange={(picked) =>
                                                    onUpdate(i, {
                                                        assignee: {
                                                            ...qt.assignee,
                                                            // Keep ids that aren't in the loaded
                                                            // staff page so they aren't dropped.
                                                            also_user_ids: [
                                                                ...picked.map((p) => p.value),
                                                                ...alsoStaff.filter(
                                                                    (id) =>
                                                                        !assigneeOptions.some(
                                                                            (o) => o.value === id
                                                                        )
                                                                ),
                                                            ],
                                                        },
                                                    })
                                                }
                                                multiSelect={true}
                                                hasClearFilter={true}
                                                className="min-w-60"
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <MyButton buttonType="secondary" onClick={onAdd} className="w-full border-dashed">
                    <span className="flex items-center gap-2">
                        <Plus className="size-4" />
                        {t('queryTypes.addType')}
                    </span>
                </MyButton>
            </CardContent>
        </Card>
    );
}

/**
 * Workflow statuses a doubt moves through on the admin/teacher side. Each status has a kind
 * (open / in progress / resolved) that the learner app tones by and that keeps the built-in
 * resolved/pending behaviour intact, plus an optional learner-facing label so internal wording
 * ("Escalated to HOD") never leaks to a learner.
 */
function StatusesCard({
    statuses,
    onUpdate,
    onAdd,
    onRemove,
}: {
    statuses: WorkflowStatusConfig[];
    onUpdate: (index: number, patch: Partial<WorkflowStatusConfig>) => void;
    onAdd: () => void;
    onRemove: (index: number) => void;
}) {
    const { t } = useTranslation('settingsDoubtManagement');
    const selectCls =
        'rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 focus:border-primary-400 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500';

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('statuses.title')}</CardTitle>
                <CardDescription>{t('statuses.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="space-y-3">
                    {statuses.map((st, i) => (
                        <div
                            key={st.is_system ? st.key : `custom-${i}`}
                            className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3"
                        >
                            <div className="flex items-center gap-3">
                                <ColorPicker
                                    value={st.color || ''}
                                    onChange={(v) => onUpdate(i, { color: v })}
                                    aria-label={t('statuses.color')}
                                    className="size-9 shrink-0"
                                />
                                <Input
                                    placeholder={t('statuses.namePlaceholder')}
                                    value={st.label}
                                    onChange={(e) => onUpdate(i, { label: e.target.value })}
                                    className="h-9 flex-1"
                                    aria-label={t('statuses.namePlaceholder')}
                                />
                                {st.is_system ? (
                                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                                        {t('statuses.builtIn')}
                                    </span>
                                ) : (
                                    <MyButton
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="small"
                                        aria-label={t('statuses.removeStatus')}
                                        onClick={() => onRemove(i)}
                                        className="shrink-0 !text-neutral-400 hover:!text-danger-500"
                                    >
                                        <Trash className="size-4" />
                                    </MyButton>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                <label className="flex items-center gap-2 text-xs text-neutral-700">
                                    <span className="font-medium">{t('statuses.kind')}</span>
                                    <select
                                        className={selectCls}
                                        value={st.kind}
                                        disabled={st.is_system}
                                        onChange={(e) =>
                                            onUpdate(i, {
                                                kind: e.target.value as WorkflowStatusKind,
                                            })
                                        }
                                    >
                                        {STATUS_KINDS.map((k) => (
                                            <option key={k} value={k}>
                                                {t(`statuses.kinds.${k}`)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex min-w-60 flex-1 items-center gap-2 text-xs text-neutral-700">
                                    <span className="shrink-0 font-medium">
                                        {t('statuses.learnerLabel')}
                                    </span>
                                    <Input
                                        placeholder={t('statuses.learnerLabelPlaceholder', {
                                            label: st.label || t('statuses.thisStatus'),
                                        })}
                                        value={st.learner_label ?? ''}
                                        onChange={(e) =>
                                            onUpdate(i, { learner_label: e.target.value })
                                        }
                                        className="h-8 flex-1"
                                    />
                                </label>
                                {!st.is_system && (
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={st.enabled !== false}
                                            onCheckedChange={(v) => onUpdate(i, { enabled: v })}
                                        />
                                        <span className="text-xs text-neutral-700">
                                            {t('statuses.enabled')}
                                        </span>
                                    </label>
                                )}
                            </div>
                            <p className="text-xs text-neutral-500">
                                {t(`statuses.kindHint.${st.kind}`)}
                            </p>
                        </div>
                    ))}
                </div>
                <MyButton buttonType="secondary" scale="small" onClick={onAdd}>
                    <Plus className="size-4" />
                    {t('statuses.addStatus')}
                </MyButton>
                <p className="text-xs text-neutral-500">{t('statuses.trailNote')}</p>
            </CardContent>
        </Card>
    );
}

function LearnerQueryCard({
    prefs,
    onChange,
}: {
    prefs: LearnerQueryPrefs;
    onChange: (patch: Partial<LearnerQueryPrefs>) => void;
}) {
    const { t } = useTranslation('settingsDoubtManagement');
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('learnerQuery.title')}</CardTitle>
                <CardDescription>{t('learnerQuery.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                    <Switch
                        id="learner-query-enabled"
                        checked={prefs.enabled}
                        onCheckedChange={(v) => onChange({ enabled: v })}
                    />
                    <div>
                        <Label
                            htmlFor="learner-query-enabled"
                            className="cursor-pointer text-sm font-medium text-neutral-800"
                        >
                            {t('learnerQuery.enableLabel')}
                        </Label>
                        <p className="mt-0.5 text-xs text-neutral-600">
                            {t('learnerQuery.enableHint')}
                        </p>
                    </div>
                </div>

                {prefs.enabled && (
                    <>
                        <div className="flex items-start gap-3">
                            <Switch
                                id="learner-query-topbar"
                                checked={prefs.show_topbar_icon}
                                onCheckedChange={(v) => onChange({ show_topbar_icon: v })}
                            />
                            <div>
                                <Label
                                    htmlFor="learner-query-topbar"
                                    className="cursor-pointer text-sm font-medium text-neutral-800"
                                >
                                    {t('learnerQuery.topbarLabel')}
                                </Label>
                                <p className="mt-0.5 text-xs text-neutral-600">
                                    {t('learnerQuery.topbarHint')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <Switch
                                id="learner-query-dashboard"
                                checked={prefs.show_dashboard_card}
                                onCheckedChange={(v) => onChange({ show_dashboard_card: v })}
                            />
                            <div>
                                <Label
                                    htmlFor="learner-query-dashboard"
                                    className="cursor-pointer text-sm font-medium text-neutral-800"
                                >
                                    {t('learnerQuery.dashboardLabel')}
                                </Label>
                                <p className="mt-0.5 text-xs text-neutral-600">
                                    {t('learnerQuery.dashboardHint')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <Switch
                                id="learner-query-guest"
                                checked={prefs.allow_guest}
                                onCheckedChange={(v) => onChange({ allow_guest: v })}
                            />
                            <div>
                                <Label
                                    htmlFor="learner-query-guest"
                                    className="cursor-pointer text-sm font-medium text-neutral-800"
                                >
                                    {t('learnerQuery.guestLabel')}
                                </Label>
                                <p className="mt-0.5 text-xs text-neutral-600">
                                    {t('learnerQuery.guestHint')}
                                </p>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
