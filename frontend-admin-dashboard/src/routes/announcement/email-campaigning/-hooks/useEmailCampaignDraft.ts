import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AnnouncementService } from '@/services/announcement';
import { getInstituteId } from '@/constants/helper';
import { getUserRoleForInstitute } from '@/lib/auth/instituteUtils';
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
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useCampaignsList } from '@/routes/audience-manager/list/-hooks/useCampaignsList';
import type { CampaignItem } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import useLocalStorage from '@/hooks/use-local-storage';
import { createRule } from '../../create/-hooks/useAnnouncementDraft';
import type { AudienceRule, AudienceRuleType, CustomFieldOption } from '../../create/-types';
import { errorText, hydrateCampaign } from '../-utils/payload';
import { senderKey, stripHtml } from '../-utils/validation';
import type { BatchOption, EmailCampaignDraft, EmailPriority, ScheduleType } from '../-types';
import { LOCKED_STATUSES } from '../-types';

/** Same key the Create Announcement page uses, so the chosen sender follows the admin around. */
const SENDER_STORAGE_KEY = 'selectedFromEmail';

export interface PrefillState {
    loading: boolean;
    error: string | null;
    notFound: boolean;
    /** Backend status of the campaign being edited; null until loaded. */
    status: string | null;
    /** The backend will refuse an update for these statuses — say so before the user edits. */
    locked: boolean;
}

export function useEmailCampaignDraft(editingId?: string) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    const instituteId = getInstituteId() || '';
    const primaryRole = useMemo(
        () => getUserRoleForInstitute(instituteId) || 'UNKNOWN',
        [instituteId]
    );

    // ---------------------------------------------------------------- content
    const [title, setTitle] = useState('');
    const [subject, setSubject] = useState('');
    const [previewText, setPreviewText] = useState('');
    const [htmlContent, setHtmlContent] = useState('');
    const contentText = useMemo(() => stripHtml(htmlContent), [htmlContent]);

    // ---------------------------------------------------------------- template
    const [templateId, setTemplateId] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [templatesError, setTemplatesError] = useState<string | null>(null);
    const [applyingTemplate, setApplyingTemplate] = useState(false);

    /** One page of the template picker; the picker owns search + infinite scroll. */
    const loadTemplateOptions = useCallback(
        async (search: string, page: number) => {
            setTemplatesError(null);
            try {
                const response = await getMessageTemplates('EMAIL', page, 20, search);
                return {
                    options: (response.templates ?? [])
                        .filter((template) => template.id && template.id.trim() !== '')
                        .map((template) => ({ label: template.name, value: template.id })),
                    hasMore: !(response.isLast ?? true),
                };
            } catch (err) {
                setTemplatesError(errorText(err, t('errors.loadTemplates')));
                return { options: [], hasMore: false };
            }
        },
        [t]
    );

    /**
     * Applying a template replaces subject, content and preview text — a deliberate action,
     * so it also tells the user what happened. Passing '' clears the selection only.
     */
    const applyTemplate = useCallback(
        async (id: string, name?: string) => {
            if (!id) {
                setTemplateId('');
                setTemplateName('');
                return;
            }
            setApplyingTemplate(true);
            try {
                const full = await getMessageTemplate(id);
                setTemplateId(id);
                setTemplateName(full.name || name || '');
                if (full.subject) setSubject(full.subject);
                if (full.content) setHtmlContent(full.content);
                setPreviewText(full.previewText ?? '');
                toast.success(t('toast.templateApplied', { name: full.name || name || '' }));
            } catch (err) {
                toast.error(errorText(err, t('errors.loadTemplate')));
            } finally {
                setApplyingTemplate(false);
            }
        },
        [t]
    );

    // ---------------------------------------------------------------- sender + settings
    const [senders, setSenders] = useState<EmailConfiguration[]>([]);
    const [sendersLoading, setSendersLoading] = useState(true);
    const [sendersLoaded, setSendersLoaded] = useState(false);
    const [sendersError, setSendersError] = useState<string | null>(null);
    const [sendersNonce, setSendersNonce] = useState(0);
    const [fromKey, setFromKey] = useState('');
    const [priority, setPriority] = useState<EmailPriority>('MEDIUM');
    const [expiresAt, setExpiresAt] = useState('');

    useEffect(() => {
        let cancelled = false;
        setSendersLoading(true);
        setSendersError(null);
        getEmailConfigurations()
            .then((configs) => {
                if (cancelled) return;
                const usable = (configs ?? []).filter((c) => c.email && c.name);
                setSenders(usable);
                setSendersLoaded(true);
                if (usable.length === 0) return;
                const persisted =
                    typeof window !== 'undefined'
                        ? window.localStorage.getItem(SENDER_STORAGE_KEY)
                        : null;
                const persistedValid = persisted && usable.some((c) => senderKey(c) === persisted);
                const first = usable[0];
                // An edit prefill may already have set the sender; never overwrite it.
                setFromKey(
                    (prev) =>
                        prev ||
                        (persistedValid && persisted ? persisted : first ? senderKey(first) : '')
                );
            })
            .catch((err) => {
                if (!cancelled) setSendersError(errorText(err, t('errors.loadSenders')));
            })
            .finally(() => {
                if (!cancelled) setSendersLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sendersNonce]);

    useEffect(() => {
        if (!fromKey || typeof window === 'undefined') return;
        // Only remember senders that exist; a stale key from an edit would poison the default.
        if (senders.some((c) => senderKey(c) === fromKey)) {
            window.localStorage.setItem(SENDER_STORAGE_KEY, fromKey);
        }
    }, [fromKey, senders]);

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
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { getValue: getSavedTz, setValue: setSavedTz } = useLocalStorage<string>(
        'email_campaign_timezone',
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

    // ---------------------------------------------------------------- batches
    // The layout already runs this query; subscribing keeps the list in step with it on a hard
    // refresh straight onto this route, when the store alone can still be empty.
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
                if (!cancelled) setTags(Array.isArray(list) ? list : []);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tagsNonce]);

    const tagById = useMemo(() => {
        const map: Record<string, TagItem> = {};
        tags.forEach((tag) => {
            map[tag.id] = tag;
        });
        return map;
    }, [tags]);

    const tagNameById = useMemo(
        () => Object.fromEntries(tags.map((tag) => [tag.id, tag.tagName])),
        [tags]
    );

    // ---------------------------------------------------------------- custom fields
    const [customFields, setCustomFields] = useState<CustomFieldOption[]>([]);
    const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
    const [customFieldsNonce, setCustomFieldsNonce] = useState(0);
    const customFieldsRef = useRef<CustomFieldOption[]>([]);

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
                customFieldsRef.current = all;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customFieldsNonce]);

    // ---------------------------------------------------------------- campaigns (audience lists)
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

    // ---------------------------------------------------------------- tag reach estimate
    const [tagReach, setTagReach] = useState<number | null>(null);
    const [tagReachLoading, setTagReachLoading] = useState(false);

    const selectedTagKey = useMemo(
        () =>
            Array.from(new Set(rules.flatMap((r) => (r.type === 'TAG' ? r.tagIds : [])))).join(','),
        [rules]
    );

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
                // An estimate is advisory; failing it must not show "0 users".
                if (!cancelled) setTagReach(null);
            })
            .finally(() => {
                if (!cancelled) setTagReachLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [selectedTagKey]);

    // ---------------------------------------------------------------- edit-mode prefill
    const [prefill, setPrefill] = useState<PrefillState>({
        loading: Boolean(editingId),
        error: null,
        notFound: false,
        status: null,
        locked: false,
    });
    const [prefillNonce, setPrefillNonce] = useState(0);

    useEffect(() => {
        if (!editingId) {
            setPrefill({
                loading: false,
                error: null,
                notFound: false,
                status: null,
                locked: false,
            });
            return;
        }
        let cancelled = false;
        setPrefill({ loading: true, error: null, notFound: false, status: null, locked: false });
        AnnouncementService.getById(editingId)
            .then((raw) => {
                if (cancelled) return;
                const { draft, status } = hydrateCampaign(raw, customFieldsRef.current);
                setTitle(draft.title ?? '');
                setSubject(draft.subject ?? '');
                setPreviewText(draft.previewText ?? '');
                setHtmlContent(draft.htmlContent ?? '');
                setTemplateName(draft.templateName ?? '');
                if (draft.fromKey) setFromKey(draft.fromKey);
                if (draft.priority) setPriority(draft.priority);
                setExpiresAt(draft.expiresAt ?? '');
                setRules(draft.rules ?? []);
                if (draft.scheduleType) setScheduleType(draft.scheduleType);
                if (draft.timezone) setTimezone(draft.timezone);
                setOneTimeStart(draft.oneTimeStart ?? '');
                setCronExpression(draft.cronExpression ?? '');
                const locked =
                    !!status &&
                    (LOCKED_STATUSES as readonly string[]).includes(status.toUpperCase());
                setPrefill({ loading: false, error: null, notFound: false, status, locked });
            })
            .catch((err) => {
                if (cancelled) return;
                const status = (err as { response?: { status?: number } })?.response?.status;
                setPrefill({
                    loading: false,
                    error:
                        status === 404
                            ? t('prefill.notFound')
                            : errorText(err, t('prefill.failed')),
                    notFound: status === 404,
                    status: null,
                    locked: false,
                });
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingId, prefillNonce]);

    // ---------------------------------------------------------------- reset after create
    const resetDraft = useCallback(() => {
        setTitle('');
        setSubject('');
        setPreviewText('');
        setHtmlContent('');
        setTemplateId('');
        setTemplateName('');
        setPriority('MEDIUM');
        setExpiresAt('');
        setRules([]);
        setScheduleType('IMMEDIATE');
        setOneTimeStart('');
        setCronExpression('');
    }, []);

    const draft: EmailCampaignDraft = useMemo(
        () => ({
            title,
            subject,
            previewText,
            htmlContent,
            templateId,
            templateName,
            fromKey,
            priority,
            expiresAt,
            rules,
            scheduleType,
            timezone,
            oneTimeStart,
            cronExpression,
        }),
        [
            title,
            subject,
            previewText,
            htmlContent,
            templateId,
            templateName,
            fromKey,
            priority,
            expiresAt,
            rules,
            scheduleType,
            timezone,
            oneTimeStart,
            cronExpression,
        ]
    );

    return {
        instituteId,
        primaryRole,
        draft,
        contentText,
        resetDraft,

        setTitle,
        setSubject,
        setPreviewText,
        setHtmlContent,

        applyTemplate,
        applyingTemplate,
        loadTemplateOptions,
        templatesError,
        clearTemplatesError: () => setTemplatesError(null),

        senders,
        sendersLoading,
        sendersLoaded,
        sendersError,
        reloadSenders: () => setSendersNonce((n) => n + 1),
        setFromKey,
        setPriority,
        setExpiresAt,

        addRule,
        updateRule,
        removeRule,
        batches,
        batchById,
        batchesLoading: instituteLoading && batches.length === 0,
        tags,
        tagById,
        tagNameById,
        tagsLoading,
        tagsError,
        reloadTags: () => setTagsNonce((n) => n + 1),
        customFields,
        customFieldsError,
        reloadCustomFields: () => setCustomFieldsNonce((n) => n + 1),
        campaigns,
        campaignsLoading,
        campaignsError: campaignsErrorRaw ? t('errors.loadCampaigns') : null,
        reloadCampaigns: () => {
            void refetchCampaigns();
        },
        tagReach,
        tagReachLoading,

        setScheduleType,
        setTimezone,
        setOneTimeStart,
        setCronExpression,

        prefill,
        reloadPrefill: () => setPrefillNonce((n) => n + 1),
    };
}

export type EmailCampaignDraftApi = ReturnType<typeof useEmailCampaignDraft>;
