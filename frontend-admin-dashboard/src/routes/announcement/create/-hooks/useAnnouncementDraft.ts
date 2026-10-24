import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { MediumType, ModeType } from '@/services/announcement';
import { InstituteAnnouncementSettingsService } from '@/services/announcement';
import { getInstituteId } from '@/constants/helper';
import { getInstituteTags, getUserCountsByTags, type TagItem } from '@/services/tag-management';
import {
    getCustomFieldSettings,
    type CustomField,
    type FixedField,
    type GroupField,
} from '@/services/custom-field-settings';
import {
    getEmailConfigurations,
    type EmailConfiguration,
} from '@/services/email-configuration-service';
import { getMessageTemplate, getMessageTemplates } from '@/services/message-template-service';
import type { MessageTemplate } from '@/types/message-template-types';
import {
    listTemplates,
    syncTemplates,
    type WhatsAppTemplateDTO,
} from '@/routes/communication/whatsapp-templates/-services/template-api';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useCampaignsList } from '@/routes/audience-manager/list/-hooks/useCampaignsList';
import type { CampaignItem } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { getPrimaryRole, getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import useLocalStorage from '@/hooks/use-local-storage';
import { defaultModeSettings } from '../-utils/constants';
import type {
    AudienceRule,
    AudienceRuleType,
    BatchOption,
    CustomFieldOption,
    EmailConfig,
    ModeSettings,
    PushConfig,
    ScheduleType,
    WhatsAppConfig,
} from '../-types';

/** Async resource with an explicit error so every list can render a retry instead of an empty box. */
export interface Resource<T> {
    data: T;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

let ruleSeq = 0;
export const newRuleKey = () => `rule-${++ruleSeq}-${Math.random().toString(36).slice(2, 8)}`;

export function createRule(
    type: AudienceRuleType,
    patch: Partial<AudienceRule> = {}
): AudienceRule {
    return {
        key: newRuleKey(),
        type,
        roleId: type === 'ROLE' ? 'STUDENT' : '',
        packageSessionIds: [],
        userIds: [],
        tagIds: [],
        tagScope: 'ALL',
        campaignIds: [],
        campaignNames: {},
        fieldFilters: [],
        exclusions: [],
        ...patch,
    };
}

const errorText = (err: unknown, fallback: string) => {
    const withResponse = err as { response?: { data?: { message?: string } }; message?: string };
    return withResponse?.response?.data?.message || withResponse?.message || fallback;
};

const stripHtml = (html: string): string => {
    try {
        return (html || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    } catch {
        return html;
    }
};

export function useAnnouncementDraft() {
    const { t } = useTranslation('announcementUseAnnouncementDraft');
    const instituteId = getInstituteId() || '';
    // The sender's role in THIS institute (ADMIN first, never STUDENT); 'UNKNOWN' means
    // no staff role here, which keeps the old TEACHER default.
    const primaryRole = useMemo(() => {
        const role = getPrimaryRole(getRolesForCurrentInstitute());
        return role === 'UNKNOWN' ? 'TEACHER' : role;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on institute switch
    }, [instituteId]);

    // ---------------------------------------------------------------- content
    const [title, setTitle] = useState('');
    const [previewText, setPreviewText] = useState('');
    const [htmlContent, setHtmlContent] = useState('');
    const contentText = useMemo(() => stripHtml(htmlContent), [htmlContent]);

    // ---------------------------------------------------------------- placement
    const [modes, setModes] = useState<ModeType[]>([]);
    const [modeSettings, setModeSettings] = useState<Partial<Record<ModeType, ModeSettings>>>({});
    const [allowedModes, setAllowedModes] = useState<Partial<Record<ModeType, boolean>>>({});
    const [permissionsLoading, setPermissionsLoading] = useState(true);

    const toggleMode = useCallback((mode: ModeType) => {
        setModes((prev) => {
            if (prev.includes(mode)) return prev.filter((m) => m !== mode);
            return [...prev, mode];
        });
        setModeSettings((prev) =>
            prev[mode] ? prev : { ...prev, [mode]: defaultModeSettings(mode) }
        );
    }, []);

    const updateModeSettings = useCallback((mode: ModeType, settings: ModeSettings) => {
        setModeSettings((prev) => ({ ...prev, [mode]: settings }));
    }, []);

    // ---------------------------------------------------------------- channels
    const [mediums, setMediums] = useState<MediumType[]>(['PUSH_NOTIFICATION']);
    const [push, setPush] = useState<PushConfig>({ title: '', body: '' });
    const [pushSynced, setPushSynced] = useState(true);
    const [email, setEmail] = useState<EmailConfig>({
        templateId: '',
        templateName: '',
        fromKey: '',
        subjectOverride: '',
    });
    const [whatsapp, setWhatsapp] = useState<WhatsAppConfig>({
        templateName: '',
        languageCode: 'en',
        headerUrl: '',
        variables: {},
    });

    const toggleMedium = useCallback((medium: MediumType) => {
        setMediums((prev) =>
            prev.includes(medium) ? prev.filter((m) => m !== medium) : [...prev, medium]
        );
    }, []);

    // Push copy mirrors the announcement until the user edits it by hand.
    useEffect(() => {
        if (!pushSynced) return;
        setPush({ title, body: contentText.slice(0, 200) });
    }, [title, contentText, pushSynced]);

    // ---------------------------------------------------------------- audience
    const [rules, setRules] = useState<AudienceRule[]>([]);

    const addRule = useCallback((type: AudienceRuleType, patch: Partial<AudienceRule> = {}) => {
        const rule = createRule(type, patch);
        setRules((prev) => [...prev, rule]);
        return rule.key;
    }, []);

    const updateRule = useCallback((key: string, patch: Partial<AudienceRule>) => {
        setRules((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    }, []);

    const removeRule = useCallback((key: string) => {
        setRules((prev) => prev.filter((r) => r.key !== key));
    }, []);

    // ---------------------------------------------------------------- schedule
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    const { getValue: getSavedTz, setValue: setSavedTz } = useLocalStorage<string>(
        'announcement_timezone',
        browserTz
    );
    const [scheduleType, setScheduleType] = useState<ScheduleType>('IMMEDIATE');
    const [timezone, setTimezone] = useState<string>(getSavedTz());
    const [oneTimeStart, setOneTimeStart] = useState('');
    const [cronExpression, setCronExpression] = useState('');

    useEffect(() => {
        if (timezone) setSavedTz(timezone);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timezone]);

    // Prefill from the schedule calendar (?scheduleType=ONE_TIME&startDate=…).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('scheduleType') !== 'ONE_TIME') return;
            setScheduleType('ONE_TIME');
            const startDate = sp.get('startDate');
            if (!startDate) return;
            const dt = new Date(startDate);
            if (Number.isNaN(dt.getTime())) return;
            setOneTimeStart(
                new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
            );
        } catch {
            /* query string is advisory only */
        }
    }, []);

    // ---------------------------------------------------------------- batches
    // The layout already runs this query; subscribing here keeps the batch list in step with it
    // (the store alone can be empty on a hard refresh straight onto this route).
    const { isLoading: instituteLoading } = useQuery(useInstituteQuery());
    const { instituteDetails } = useInstituteDetailsStore();

    const batches = useMemo<BatchOption[]>(() => {
        const rows = instituteDetails?.batches_for_sessions ?? [];
        return rows
            .filter((batch) => !!batch.id)
            .map((batch) => ({
                id: batch.id,
                label: `${batch.package_dto.package_name} - ${batch.level.level_name} - ${batch.session.session_name}`,
                packageName: batch.package_dto.package_name,
                levelName: batch.level.level_name,
                sessionName: batch.session.session_name,
                status: batch.status,
                isOrgAssociated: Boolean(
                    (batch as { is_org_associated?: boolean }).is_org_associated
                ),
            }));
    }, [instituteDetails]);

    const batchById = useMemo(() => {
        const map: Record<string, BatchOption> = {};
        batches.forEach((b) => {
            map[b.id] = b;
        });
        return map;
    }, [batches]);

    // ---------------------------------------------------------------- tags
    const [tags, setTags] = useState<TagItem[]>([]);
    const [tagsLoading, setTagsLoading] = useState(false);
    const [tagsError, setTagsError] = useState<string | null>(null);
    const [tagsNonce, setTagsNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setTagsLoading(true);
        setTagsError(null);
        getInstituteTags()
            .then((list) => {
                if (!cancelled) setTags(list);
            })
            .catch((err) => {
                if (!cancelled) setTagsError(errorText(err, t('errors.loadTags')));
            })
            .finally(() => {
                if (!cancelled) setTagsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [tagsNonce]);

    const tagById = useMemo(() => {
        const map: Record<string, TagItem> = {};
        tags.forEach((t) => {
            map[t.id] = t;
        });
        return map;
    }, [tags]);

    // ---------------------------------------------------------------- custom fields
    const [customFields, setCustomFields] = useState<CustomFieldOption[]>([]);
    const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
    const [customFieldsNonce, setCustomFieldsNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setCustomFieldsError(null);
        getCustomFieldSettings()
            .then((settings) => {
                if (cancelled || !settings) return;
                const all: CustomFieldOption[] = [];
                settings.fixedFields.forEach((f: FixedField) =>
                    all.push({ id: f.id, name: f.name, type: 'text' })
                );
                settings.instituteFields.forEach((f: CustomField) =>
                    all.push({ id: f.id, name: f.name, type: f.type, options: f.options })
                );
                settings.customFields.forEach((f: CustomField) =>
                    all.push({ id: f.id, name: f.name, type: f.type, options: f.options })
                );
                settings.fieldGroups.forEach((group) =>
                    group.fields.forEach((f: GroupField) =>
                        all.push({ id: f.id, name: f.name, type: f.type, options: f.options })
                    )
                );
                setCustomFields(all);
            })
            .catch((err) => {
                if (!cancelled) {
                    setCustomFields([]);
                    setCustomFieldsError(errorText(err, t('errors.loadCustomFields')));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [customFieldsNonce]);

    // ---------------------------------------------------------------- campaigns
    const campaignsPayload = useMemo(
        () => ({ institute_id: instituteId, page: 0, size: 1000 }),
        [instituteId]
    );
    const {
        data: campaignsPage,
        isLoading: campaignsLoading,
        error: campaignsErrorRaw,
        refetch: refetchCampaigns,
    } = useCampaignsList(campaignsPayload);

    const campaigns = useMemo<CampaignItem[]>(() => {
        const content = campaignsPage?.content;
        if (!Array.isArray(content)) return [];
        return content.filter((campaign: CampaignItem) =>
            ['ACTIVE', 'INACTIVE', 'DRAFT'].includes((campaign.status ?? '').trim().toUpperCase())
        );
    }, [campaignsPage]);

    // ---------------------------------------------------------------- email senders
    const [emailSenders, setEmailSenders] = useState<EmailConfiguration[]>([]);
    const [emailSendersLoading, setEmailSendersLoading] = useState(false);
    const [emailSendersError, setEmailSendersError] = useState<string | null>(null);
    const [emailSendersNonce, setEmailSendersNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setEmailSendersLoading(true);
        setEmailSendersError(null);
        getEmailConfigurations()
            .then((configs) => {
                if (cancelled) return;
                setEmailSenders(configs);
                if (configs.length === 0) return;
                const persisted =
                    typeof window !== 'undefined'
                        ? localStorage.getItem('selectedFromEmail')
                        : null;
                const stillValid =
                    persisted && configs.some((c) => `${c.email}-${c.name}` === persisted);
                const first = configs[0];
                setEmail((prev) => ({
                    ...prev,
                    fromKey:
                        prev.fromKey ||
                        (stillValid && persisted ? persisted : `${first?.email}-${first?.name}`),
                }));
            })
            .catch((err) => {
                if (!cancelled)
                    setEmailSendersError(errorText(err, t('errors.loadSenders')));
            })
            .finally(() => {
                if (!cancelled) setEmailSendersLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [emailSendersNonce]);

    useEffect(() => {
        if (email.fromKey && typeof window !== 'undefined') {
            localStorage.setItem('selectedFromEmail', email.fromKey);
        }
    }, [email.fromKey]);

    // ---------------------------------------------------------------- email templates
    const [emailTemplates, setEmailTemplates] = useState<MessageTemplate[]>([]);
    const [emailTemplatesLoading, setEmailTemplatesLoading] = useState(false);
    const [emailTemplatesError, setEmailTemplatesError] = useState<string | null>(null);
    const emailTemplatesRequested = useRef(false);

    const loadEmailTemplates = useCallback((force = false) => {
        if (emailTemplatesRequested.current && !force) return;
        emailTemplatesRequested.current = true;
        setEmailTemplatesLoading(true);
        setEmailTemplatesError(null);
        getMessageTemplates('EMAIL', 0, 100)
            .then((res) => setEmailTemplates(res.templates ?? []))
            .catch((err) => {
                setEmailTemplates([]);
                setEmailTemplatesError(errorText(err, t('errors.loadEmailTemplates')));
            })
            .finally(() => setEmailTemplatesLoading(false));
    }, []);

    const [applyingEmailTemplate, setApplyingEmailTemplate] = useState(false);

    /**
     * Applying a template overwrites title/content, so it is a deliberate action rather than a
     * side effect of opening the dropdown. Passing '' clears the selection and leaves the
     * hand-written content alone.
     */
    const applyEmailTemplate = useCallback(
        async (templateId: string) => {
            if (!templateId) {
                setEmail((prev) => ({ ...prev, templateId: '', templateName: '' }));
                return;
            }
            setApplyingEmailTemplate(true);
            try {
                const full = await getMessageTemplate(templateId);
                setEmail((prev) => ({ ...prev, templateId, templateName: full.name }));
                if (full.subject) setTitle(full.subject);
                if (full.content) setHtmlContent(full.content);
                setPreviewText(full.previewText ?? '');
                toast.success(t('toast.templateApplied', { name: full.name }));
            } catch (err) {
                const cached = emailTemplates.find((template) => template.id === templateId);
                if (cached) {
                    setEmail((prev) => ({ ...prev, templateId, templateName: cached.name }));
                    if (cached.subject) setTitle(cached.subject);
                    if (cached.content) setHtmlContent(cached.content);
                    setPreviewText(cached.previewText ?? '');
                    toast.warning(t('toast.templateCachedCopy'));
                } else {
                    toast.error(errorText(err, t('errors.loadTemplate')));
                }
            } finally {
                setApplyingEmailTemplate(false);
            }
        },
        [emailTemplates, t]
    );

    // ---------------------------------------------------------------- whatsapp templates
    const [waTemplates, setWaTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [waTemplatesLoading, setWaTemplatesLoading] = useState(false);
    const [waTemplatesError, setWaTemplatesError] = useState<string | null>(null);
    const [waSyncing, setWaSyncing] = useState(false);
    const waRequested = useRef(false);

    const loadWhatsAppTemplates = useCallback(
        (force = false) => {
            if (!instituteId) return;
            if (waRequested.current && !force) return;
            waRequested.current = true;
            setWaTemplatesLoading(true);
            setWaTemplatesError(null);
            listTemplates(instituteId)
                .then((list) => setWaTemplates(Array.isArray(list) ? list : []))
                .catch((err) => {
                    setWaTemplates([]);
                    setWaTemplatesError(errorText(err, t('errors.loadWhatsappTemplates')));
                })
                .finally(() => setWaTemplatesLoading(false));
        },
        [instituteId, t]
    );

    const syncWhatsAppTemplates = useCallback(async () => {
        if (!instituteId) return;
        setWaSyncing(true);
        try {
            const res = await syncTemplates(instituteId);
            loadWhatsAppTemplates(true);
            toast.success(
                res?.synced
                    ? t('toast.templatesSynced', { count: res.synced })
                    : t('toast.templatesUpToDate')
            );
        } catch (err) {
            toast.error(errorText(err, t('errors.syncFailed')));
        } finally {
            setWaSyncing(false);
        }
    }, [instituteId, loadWhatsAppTemplates, t]);

    const approvedWaTemplates = useMemo(
        () => waTemplates.filter((t) => (t.status ?? '').toUpperCase() === 'APPROVED'),
        [waTemplates]
    );

    const selectedWaTemplate = useMemo(
        () => approvedWaTemplates.find((t) => t.name === whatsapp.templateName) ?? null,
        [approvedWaTemplates, whatsapp.templateName]
    );

    // ---------------------------------------------------------------- permissions
    useEffect(() => {
        let cancelled = false;
        const allModes: ModeType[] = [
            'SYSTEM_ALERT',
            'DASHBOARD_PIN',
            'APP_OVERLAY',
            'DM',
            'STREAM',
            'RESOURCES',
            'COMMUNITY',
            'TASKS',
        ];
        (async () => {
            try {
                await InstituteAnnouncementSettingsService.get().catch(() => undefined);
                const results = await Promise.all(
                    allModes.map(async (mode) => {
                        try {
                            const res: { allowed?: boolean } =
                                await InstituteAnnouncementSettingsService.checkPermissions({
                                    userRole: primaryRole,
                                    action: 'send',
                                    modeType: mode,
                                });
                            return [mode, res?.allowed ?? true] as const;
                        } catch {
                            // A missing permission endpoint must not lock the admin out of a mode.
                            return [mode, true] as const;
                        }
                    })
                );
                if (!cancelled) setAllowedModes(Object.fromEntries(results));
            } finally {
                if (!cancelled) setPermissionsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [primaryRole]);

    // ---------------------------------------------------------------- tag reach estimate
    const [tagReach, setTagReach] = useState<number | null>(null);
    const [tagReachLoading, setTagReachLoading] = useState(false);

    const selectedTagIds = useMemo(
        () => Array.from(new Set(rules.flatMap((r) => (r.type === 'TAG' ? r.tagIds : [])))),
        [rules]
    );
    const selectedTagKey = selectedTagIds.join(',');

    useEffect(() => {
        if (!selectedTagKey) {
            setTagReach(null);
            return;
        }
        let cancelled = false;
        setTagReachLoading(true);
        getUserCountsByTags(selectedTagKey.split(','))
            .then((res) => {
                if (!cancelled) setTagReach(res?.totalUsers ?? null);
            })
            .catch(() => {
                if (!cancelled) setTagReach(null);
            })
            .finally(() => {
                if (!cancelled) setTagReachLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [selectedTagKey]);

    return {
        instituteId,
        primaryRole,

        title,
        setTitle,
        previewText,
        setPreviewText,
        htmlContent,
        setHtmlContent,
        contentText,

        modes,
        setModes,
        modeSettings,
        setModeSettings,
        toggleMode,
        updateModeSettings,
        allowedModes,
        permissionsLoading,

        mediums,
        setMediums,
        toggleMedium,
        push,
        setPush,
        pushSynced,
        setPushSynced,
        email,
        setEmail,
        whatsapp,
        setWhatsapp,

        rules,
        setRules,
        addRule,
        updateRule,
        removeRule,

        scheduleType,
        setScheduleType,
        timezone,
        setTimezone,
        oneTimeStart,
        setOneTimeStart,
        cronExpression,
        setCronExpression,

        batches,
        batchById,
        batchesLoading: instituteLoading && batches.length === 0,

        tags,
        tagById,
        tagsLoading,
        tagsError,
        reloadTags: () => setTagsNonce((n) => n + 1),

        customFields,
        customFieldsError,
        reloadCustomFields: () => setCustomFieldsNonce((n) => n + 1),

        campaigns,
        campaignsLoading,
        campaignsError: campaignsErrorRaw ? t('errors.loadCampaigns') : null,
        reloadCampaigns: refetchCampaigns,

        emailSenders,
        emailSendersLoading,
        emailSendersError,
        reloadEmailSenders: () => setEmailSendersNonce((n) => n + 1),

        emailTemplates,
        emailTemplatesLoading,
        emailTemplatesError,
        loadEmailTemplates,
        applyEmailTemplate,
        applyingEmailTemplate,

        waTemplates,
        approvedWaTemplates,
        selectedWaTemplate,
        waTemplatesLoading,
        waTemplatesError,
        waSyncing,
        loadWhatsAppTemplates,
        syncWhatsAppTemplates,

        tagReach,
        tagReachLoading,
    };
}

export type AnnouncementDraftApi = ReturnType<typeof useAnnouncementDraft>;
