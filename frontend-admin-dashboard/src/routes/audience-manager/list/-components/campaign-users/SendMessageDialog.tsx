import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
    getEmailConfigurations,
    type EmailConfiguration,
} from '@/services/email-configuration-service';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    ChatCircleDots,
    EnvelopeSimple,
    Bell,
    WarningCircle,
    CaretRight,
    CaretLeft,
    CircleNotch,
    PaperPlaneTilt,
    CheckCircle,
    XCircle,
    type Icon,
} from '@phosphor-icons/react';
import {
    sendAudienceMessage,
    type SendAudienceMessageRequest,
    type SendAudienceMessageResponse,
} from '../../-services/send-audience-message';
import {
    listTemplates,
    type WhatsAppTemplateDTO,
} from '@/routes/communication/whatsapp-templates/-services/template-api';
import {
    getMessageTemplates,
    getMessageTemplate,
} from '@/services/message-template-service';
import type { MessageTemplate } from '@/types/message-template-types';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';
import { toast } from 'sonner';
import { useGetCampaignById } from '../../-hooks/useGetCampaignById';
import { parseCustomFieldsFromJson } from '../../-utils/lead-bulk-import-utils';
import { fetchCampaignLeads } from '../../-services/get-campaign-users';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SendMessageDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    campaignId: string;
    campaignName: string;
    instituteId: string;
    customFields: Array<{ id: string; fieldName: string; fieldKey: string }>;
    leadCount: number;
    /**
     * audience_response ids ticked in the lead table. When non-empty the send goes to
     * exactly these leads; empty/omitted keeps the original whole-audience blast.
     */
    selectedResponseIds?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

function buildSystemFields(t: TFunction) {
    return [
        { value: 'system:full_name', label: t('systemFields.fullName') },
        { value: 'system:email', label: t('systemFields.email') },
        { value: 'system:mobile_number', label: t('systemFields.mobileNumber') },
        { value: 'system:city', label: t('systemFields.city') },
        { value: 'system:region', label: t('systemFields.region') },
        { value: 'system:campaign_name', label: t('systemFields.campaignName') },
        { value: 'system:submitted_at', label: t('systemFields.submittedAt') },
        { value: 'system:source_type', label: t('systemFields.sourceType') },
    ];
}

type Channel = 'WHATSAPP' | 'EMAIL' | 'PUSH' | 'SYSTEM_ALERT';

function buildChannels(
    t: TFunction
): { value: Channel; label: string; description: string; icon: Icon }[] {
    return [
        {
            value: 'WHATSAPP',
            label: t('channels.whatsapp.label'),
            description: t('channels.whatsapp.description'),
            icon: ChatCircleDots,
        },
        {
            value: 'EMAIL',
            label: t('channels.email.label'),
            description: t('channels.email.description'),
            icon: EnvelopeSimple,
        },
        {
            value: 'PUSH',
            label: t('channels.push.label'),
            description: t('channels.push.description'),
            icon: Bell,
        },
        {
            value: 'SYSTEM_ALERT',
            label: t('channels.systemAlert.label'),
            description: t('channels.systemAlert.description'),
            icon: WarningCircle,
        },
    ];
}

function buildStepTitles(t: TFunction): string[] {
    return [
        t('stepTitles.selectChannel'),
        t('stepTitles.composeContent'),
        t('stepTitles.mapVariables'),
        t('stepTitles.reviewSend'),
    ];
}

// Known backend communication-send statuses, mapped to translated labels. Falls back to the
// raw value for any status the backend introduces later, so nothing silently disappears.
function getStatusLabel(t: TFunction, status: string): string {
    const known: Record<string, string> = {
        SUCCESS: t('review.statusValues.success'),
        FAILED: t('review.statusValues.failed'),
    };
    return known[status] ?? status;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPlaceholders(text: string): string[] {
    const matches = text.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    const unique = [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
    return unique;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendMessageDialog({
    open,
    onOpenChange,
    campaignId,
    campaignName,
    instituteId,
    customFields: customFieldsProp,
    leadCount,
    selectedResponseIds,
}: SendMessageDialogProps) {
    const { t } = useTranslation('audienceManagerSendMessageDialog');
    const CHANNELS = useMemo(() => buildChannels(t), [t]);
    const SYSTEM_FIELDS = useMemo(() => buildSystemFields(t), [t]);
    const STEP_TITLES = useMemo(() => buildStepTitles(t), [t]);

    // Fetch campaign details to get custom fields when not provided via props
    const needsFieldFetch = customFieldsProp.length === 0;
    const { data: fetchedCampaign } = useGetCampaignById({
        instituteId,
        audienceId: campaignId,
        enabled: open && needsFieldFetch,
    });

    const fetchedFields = useMemo(() => {
        if (!fetchedCampaign?.institute_custom_fields) return [];
        return parseCustomFieldsFromJson(JSON.stringify(fetchedCampaign.institute_custom_fields));
    }, [fetchedCampaign]);

    const customFields = customFieldsProp.length > 0 ? customFieldsProp : fetchedFields;

    // Step
    const [step, setStep] = useState(1);

    // Channel
    const [channel, setChannel] = useState<Channel | ''>('');

    // WhatsApp state
    const [templates, setTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateDTO | null>(null);
    const [languageCode, setLanguageCode] = useState('en');
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    // Media URL for templates whose header is IMAGE/VIDEO/DOCUMENT. Meta requires the
    // header component on every send — omitting it fails every recipient in the blast.
    const [headerMediaUrl, setHeaderMediaUrl] = useState('');

    // Email state
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    // The institute's configured senders. The type code is what the backend resolves
    // EMAIL_SETTING.data.<type> by, so the dropdown must offer the real codes — a
    // hardcoded list silently fell back to the default sender whenever it didn't match
    // (e.g. a marketing address saved as MARKETING_EMAIL).
    const [emailSenders, setEmailSenders] = useState<EmailConfiguration[]>([]);
    const [emailType, setEmailType] = useState('UTILITY_EMAIL');
    const [emailTemplates, setEmailTemplates] = useState<MessageTemplate[]>([]);
    const [loadingEmailTemplates, setLoadingEmailTemplates] = useState(false);
    const [selectedEmailTemplateId, setSelectedEmailTemplateId] = useState<string>('custom');
    const [loadingTemplateContent, setLoadingTemplateContent] = useState(false);
    const [emailBodyView, setEmailBodyView] = useState<'preview' | 'edit'>('edit');

    // Push / System Alert state
    const [pushTitle, setPushTitle] = useState('');
    const [pushBody, setPushBody] = useState('');

    // Variable mapping
    const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});

    // Send state
    const [isSending, setIsSending] = useState(false);
    const [sendResult, setSendResult] = useState<SendAudienceMessageResponse | null>(null);

    // Resolved recipient count: prefer the prop (may already be known from the lead table view),
    // else fetch a 1-row page from the leads endpoint to read totalElements.
    const [resolvedLeadCount, setResolvedLeadCount] = useState<number | null>(
        leadCount > 0 ? leadCount : null
    );

    // A ticked selection wins over the audience total everywhere: the payload, the review
    // screen and the send button. Previously the dialog ignored the selection entirely and
    // every send was a whole-audience blast.
    const hasSelection = (selectedResponseIds?.length ?? 0) > 0;
    const selectionCount = selectedResponseIds?.length ?? 0;
    // Recipient count actually being sent to (null = unknown, "all members").
    const targetCount = hasSelection ? selectionCount : resolvedLeadCount;

    // -----------------------------------------------------------------------
    // Reset on close
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!open) {
            setStep(1);
            setChannel('');
            setTemplates([]);
            setSelectedTemplate(null);
            setLanguageCode('en');
            setHeaderMediaUrl('');
            setLoadingTemplates(false);
            setSubject('');
            setBody('');
            setEmailType('UTILITY_EMAIL');
            setEmailTemplates([]);
            setLoadingEmailTemplates(false);
            setSelectedEmailTemplateId('custom');
            setLoadingTemplateContent(false);
            setEmailBodyView('edit');
            setPushTitle('');
            setPushBody('');
            setVariableMapping({});
            setIsSending(false);
            setSendResult(null);
            setResolvedLeadCount(leadCount > 0 ? leadCount : null);
        }
    }, [open, leadCount]);

    // -----------------------------------------------------------------------
    // Resolve actual lead count when caller didn't pass one.
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!open) return;
        if (leadCount > 0) return;
        let cancelled = false;
        fetchCampaignLeads({ audience_id: campaignId, page: 0, size: 1 })
            .then((res) => {
                if (!cancelled) setResolvedLeadCount(res.totalElements ?? 0);
            })
            .catch(() => {
                /* leave as null; UI falls back to "all members" */
            });
        return () => {
            cancelled = true;
        };
    }, [open, campaignId, leadCount]);

    // -----------------------------------------------------------------------
    // Fetch WA templates when channel is WHATSAPP
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (channel !== 'WHATSAPP') return;
        let cancelled = false;
        setLoadingTemplates(true);
        listTemplates(instituteId)
            .then((data) => {
                if (!cancelled) setTemplates(data);
            })
            .catch(() => {
                if (!cancelled) toast.error(t('toasts.loadWhatsappTemplatesFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoadingTemplates(false);
            });
        return () => {
            cancelled = true;
        };
    }, [channel, instituteId]);

    // -----------------------------------------------------------------------
    // Fetch the institute's configured email senders when channel is EMAIL
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (channel !== 'EMAIL') return;
        let cancelled = false;
        getEmailConfigurations()
            .then((configs) => {
                if (cancelled) return;
                setEmailSenders(configs);
                // Keep the current pick if it still exists, else use the first sender.
                setEmailType((prev) =>
                    configs.some((c) => c.type === prev) ? prev : configs[0]?.type ?? prev
                );
            })
            .catch(() => {
                // Non-fatal: the select falls back to the default sender below.
                if (!cancelled) setEmailSenders([]);
            });
        return () => {
            cancelled = true;
        };
    }, [channel]);

    // -----------------------------------------------------------------------
    // Fetch saved email templates when channel is EMAIL
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (channel !== 'EMAIL') return;
        let cancelled = false;
        setLoadingEmailTemplates(true);
        // Pull a generous page so the dropdown shows everything the institute has.
        getMessageTemplates('EMAIL', 0, 100)
            .then((res) => {
                if (!cancelled) setEmailTemplates(res.templates);
            })
            .catch(() => {
                if (!cancelled) toast.error(t('toasts.loadEmailTemplatesFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoadingEmailTemplates(false);
            });
        return () => {
            cancelled = true;
        };
    }, [channel]);

    // -----------------------------------------------------------------------
    // Apply selected email template (load full content -> prefill subject + body)
    // -----------------------------------------------------------------------
    const handleEmailTemplateSelect = useCallback(async (templateId: string) => {
        setSelectedEmailTemplateId(templateId);
        // Reset variable mapping since placeholders will change.
        setVariableMapping({});

        if (templateId === 'custom') {
            setSubject('');
            setBody('');
            setEmailBodyView('edit');
            return;
        }

        setLoadingTemplateContent(true);
        try {
            const full = await getMessageTemplate(templateId);
            setSubject(full.subject ?? '');
            setBody(full.content ?? '');
            // Default to rendered preview when a saved template loads.
            setEmailBodyView('preview');
        } catch {
            toast.error(t('toasts.loadTemplateContentFailed'));
        } finally {
            setLoadingTemplateContent(false);
        }
    }, []);

    // -----------------------------------------------------------------------
    // Derived: approved templates
    // -----------------------------------------------------------------------
    const approvedTemplates = useMemo(
        () => templates.filter((tpl) => tpl.status === 'APPROVED'),
        [templates]
    );

    // -----------------------------------------------------------------------
    // Derived: variables to map
    // -----------------------------------------------------------------------
    const variableKeys = useMemo<string[]>(() => {
        if (channel === 'WHATSAPP' && selectedTemplate) {
            if (
                selectedTemplate.bodyVariableNames &&
                selectedTemplate.bodyVariableNames.length > 0
            ) {
                return selectedTemplate.bodyVariableNames;
            }
            return extractPlaceholders(selectedTemplate.bodyText ?? '');
        }
        if (channel === 'EMAIL') {
            const combined = `${subject} ${body}`;
            return extractPlaceholders(combined);
        }
        if (channel === 'PUSH' || channel === 'SYSTEM_ALERT') {
            const combined = `${pushTitle} ${pushBody}`;
            return extractPlaceholders(combined);
        }
        return [];
    }, [channel, selectedTemplate, subject, body, pushTitle, pushBody]);

    // -----------------------------------------------------------------------
    // Mapping options (system + custom)
    // -----------------------------------------------------------------------
    const mappingOptions = useMemo(() => {
        const custom = customFields.map((f) => ({
            value: `custom:${f.id}`,
            label: f.fieldName,
        }));
        return [...SYSTEM_FIELDS, ...custom];
    }, [customFields, SYSTEM_FIELDS]);

    /**
     * Lowercased media header kind when the selected template carries an
     * IMAGE/VIDEO/DOCUMENT header, else null. TEXT/NONE headers need no media.
     * Declared before canProceed/handleSend, which both read it.
     */
    const waHeaderKind = useMemo<'image' | 'video' | 'document' | null>(() => {
        if (channel !== 'WHATSAPP') return null;
        const raw = selectedTemplate?.headerType?.toUpperCase();
        if (raw === 'IMAGE') return 'image';
        if (raw === 'VIDEO') return 'video';
        if (raw === 'DOCUMENT') return 'document';
        return null;
    }, [channel, selectedTemplate]);

    // -----------------------------------------------------------------------
    // Can proceed to next step?
    // -----------------------------------------------------------------------
    const canProceed = useMemo(() => {
        switch (step) {
            case 1:
                return channel !== '';
            case 2:
                if (channel === 'WHATSAPP') return selectedTemplate !== null;
                if (channel === 'EMAIL') return subject.trim() !== '' && body.trim() !== '';
                if (channel === 'PUSH' || channel === 'SYSTEM_ALERT')
                    return pushTitle.trim() !== '' && pushBody.trim() !== '';
                return false;
            case 3:
                // A media-header template without its media is rejected for every
                // recipient, so block the blast here rather than fail at send time.
                if (waHeaderKind && headerMediaUrl.trim() === '') return false;
                // Mapping is optional, but if the user picked "Static value…" for a row
                // they must enter a non-empty value (sending `static:` would resolve to
                // an empty string and break WhatsApp template sends).
                return !Object.values(variableMapping).some((v) => v === 'static:');
            default:
                return false;
        }
    }, [
        step,
        channel,
        selectedTemplate,
        subject,
        body,
        pushTitle,
        pushBody,
        variableMapping,
        waHeaderKind,
        headerMediaUrl,
    ]);

    // -----------------------------------------------------------------------
    // Handlers
    // -----------------------------------------------------------------------
    const handleNext = useCallback(() => {
        if (step < 4) setStep((s) => s + 1);
    }, [step]);

    const handleBack = useCallback(() => {
        if (step > 1) setStep((s) => s - 1);
    }, [step]);

    const handleMappingChange = useCallback((varKey: string, fieldValue: string) => {
        setVariableMapping((prev) => ({ ...prev, [varKey]: fieldValue }));
    }, []);

    const handleTemplateSelect = useCallback(
        (templateName: string) => {
            const tmpl = approvedTemplates.find((tpl) => tpl.name === templateName) ?? null;
            setSelectedTemplate(tmpl);
            if (tmpl?.language) setLanguageCode(tmpl.language);
            // Pre-fill with the media approved alongside the template; still editable.
            setHeaderMediaUrl(tmpl?.headerSampleUrl ?? '');
        },
        [approvedTemplates]
    );

    const handleSend = useCallback(async () => {
        if (!channel) return;
        setIsSending(true);
        try {
            // Drop entries where the user picked "Static value…" but didn't type anything —
            // WhatsApp Cloud API rejects templates with empty body variables.
            const cleanedMapping = Object.fromEntries(
                Object.entries(variableMapping).filter(
                    ([, value]) => value !== '' && value !== 'static:'
                )
            );

            const payload: SendAudienceMessageRequest = {
                institute_id: instituteId,
                channel: channel as SendAudienceMessageRequest['channel'],
                variable_mapping:
                    Object.keys(cleanedMapping).length > 0 ? cleanedMapping : undefined,
                // Only the ticked rows when there is a selection; omitted = whole audience.
                response_ids: hasSelection ? selectedResponseIds : undefined,
            };

            if (channel === 'WHATSAPP' && selectedTemplate) {
                payload.template_name = selectedTemplate.name;
                payload.language_code = languageCode;
                // Meta rejects every recipient of a media-header template that arrives
                // without its header component, so always thread it through.
                if (waHeaderKind && headerMediaUrl.trim()) {
                    payload.header_url = headerMediaUrl.trim();
                    payload.header_type = waHeaderKind;
                }
            }
            if (channel === 'EMAIL') {
                payload.subject = subject;
                payload.body = body;
                payload.email_type = emailType;
            }
            if (channel === 'PUSH' || channel === 'SYSTEM_ALERT') {
                payload.subject = pushTitle;
                payload.body = pushBody;
            }

            const result = await sendAudienceMessage(campaignId, payload);
            setSendResult(result);
            // Same reasoning as the learner bulk send: a partially failed batch reported as
            // "sent successfully" is how recipients get silently missed. "Accepted" is also the
            // honest word — the provider took it, delivery is confirmed separately.
            const failedCount = result.failed ?? 0;
            const acceptedCount = result.accepted ?? 0;
            const totalCount = result.recipient_count ?? acceptedCount + failedCount;
            if (acceptedCount === 0) {
                toast.error(t('toasts.noneSent'));
            } else if (failedCount > 0) {
                toast.warning(
                    t('toasts.partialSuccess', {
                        accepted: acceptedCount,
                        total: totalCount,
                        failed: failedCount,
                    }),
                    { duration: 8000 }
                );
            } else {
                toast.success(t('toasts.sendSuccess', { count: acceptedCount }));
            }
        } catch (err: any) {
            toast.error(err?.message ?? t('toasts.sendFailed'));
        } finally {
            setIsSending(false);
        }
    }, [
        channel,
        instituteId,
        variableMapping,
        selectedTemplate,
        languageCode,
        waHeaderKind,
        headerMediaUrl,
        subject,
        body,
        emailType,
        pushTitle,
        pushBody,
        campaignId,
        hasSelection,
        selectedResponseIds,
    ]);

    // -----------------------------------------------------------------------
    // Channel icon helper
    // -----------------------------------------------------------------------
    const channelMeta = CHANNELS.find((c) => c.value === channel);

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------

    const renderStepIndicator = () => (
        <div className="mb-6 flex w-full min-w-0 items-center gap-1 overflow-hidden">
            {STEP_TITLES.map((title, i) => {
                const stepNum = i + 1;
                const isActive = stepNum === step;
                const isDone = stepNum < step;
                return (
                    <div
                        key={title}
                        className={`flex min-w-0 items-center gap-1.5 ${isActive ? 'flex-1' : 'flex-none'}`}
                    >
                        {i > 0 && (
                            <div
                                className={`h-px flex-1 min-w-2 ${isDone ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                            />
                        )}
                        <div
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                                isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : isDone
                                      ? 'bg-primary/20 text-primary'
                                      : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {isDone ? <CheckCircle className="h-3.5 w-3.5" /> : stepNum}
                        </div>
                        {isActive && (
                            <span className="truncate text-xs font-semibold text-foreground">
                                {title}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // Step 1 ------------------------------------------------------------------
    const handleChannelPick = (value: Channel) => {
        setChannel(value);
        // Skip the redundant "Next" click — channel choice is final on click.
        setStep(2);
    };

    const renderChannelSelection = () => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {CHANNELS.map((ch) => {
                const Icon = ch.icon;
                const isSelected = channel === ch.value;
                return (
                    <button
                        key={ch.value}
                        type="button"
                        onClick={() => handleChannelPick(ch.value)}
                        className={`flex min-w-0 flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-colors hover:bg-muted/50 ${
                            isSelected
                                ? 'border-primary bg-primary/5'
                                : 'border-muted-foreground/20'
                        }`}
                    >
                        <Icon
                            className={`h-7 w-7 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                        />
                        <span className="text-sm font-semibold">{ch.label}</span>
                        <span className="text-xs text-muted-foreground line-clamp-3">
                            {ch.description}
                        </span>
                    </button>
                );
            })}
        </div>
    );

    // Step 2 ------------------------------------------------------------------
    const renderContent = () => {
        if (channel === 'WHATSAPP') {
            return (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>{t('whatsappStep.templateLabel')}</Label>
                        {loadingTemplates ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <CircleNotch className="h-4 w-4 animate-spin" />
                                {t('whatsappStep.loadingTemplates')}
                            </div>
                        ) : (
                            <TemplateSearchableSelect
                                options={toTemplateOptions(approvedTemplates)}
                                value={selectedTemplate?.name ?? ''}
                                onChange={handleTemplateSelect}
                                placeholder={t('whatsappStep.selectPlaceholder')}
                                emptyText={t('whatsappStep.emptyText')}
                                portal={false}
                            />
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>{t('whatsappStep.languageCodeLabel')}</Label>
                        <Input
                            value={languageCode}
                            onChange={(e) => setLanguageCode(e.target.value)}
                            placeholder="en"
                            className="w-32"
                        />
                    </div>

                    {selectedTemplate && (
                        <div className="space-y-2">
                            <Label>{t('whatsappStep.templatePreviewLabel')}</Label>
                            <div className="rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap">
                                {selectedTemplate.bodyText}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        if (channel === 'EMAIL') {
            return (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>{t('emailStep.templateLabel')}</Label>
                        {loadingEmailTemplates ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <CircleNotch className="h-4 w-4 animate-spin" />
                                {t('emailStep.loadingTemplates')}
                            </div>
                        ) : (
                            <TemplateSearchableSelect
                                options={toTemplateOptions(emailTemplates, 'id')}
                                value={selectedEmailTemplateId}
                                onChange={handleEmailTemplateSelect}
                                placeholder={t('emailStep.selectPlaceholder')}
                                emptyText={t('emailStep.emptyText')}
                                noneOption={{
                                    value: 'custom',
                                    label: t('emailStep.customOption'),
                                }}
                                disabled={loadingTemplateContent}
                                portal={false}
                            />
                        )}
                        {loadingTemplateContent && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <CircleNotch className="h-3 w-3 animate-spin" />
                                {t('emailStep.loadingTemplateContent')}
                            </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label>{t('emailStep.emailTypeLabel')}</Label>
                        <Select value={emailType} onValueChange={setEmailType}>
                            <SelectTrigger className="w-80">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {emailSenders.length > 0 ? (
                                    emailSenders.map((c) => (
                                        <SelectItem key={c.type} value={c.type}>
                                            {c.name} ({c.email})
                                        </SelectItem>
                                    ))
                                ) : (
                                    <>
                                        <SelectItem value="UTILITY_EMAIL">
                                            {t('emailStep.utilityEmail')}
                                        </SelectItem>
                                        <SelectItem value="PROMOTIONAL_EMAIL">
                                            {t('emailStep.promotionalEmail')}
                                        </SelectItem>
                                    </>
                                )}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {t('emailStep.emailTypeHint')}
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label>{t('emailStep.subjectLabel')}</Label>
                        <Input
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            placeholder={t('emailStep.subjectPlaceholder')}
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>{t('emailStep.bodyLabel')}</Label>
                        </div>
                        <Tabs
                            value={emailBodyView}
                            onValueChange={(v) => setEmailBodyView(v as 'preview' | 'edit')}
                            className="w-full"
                        >
                            <TabsList className="grid w-fit grid-cols-2">
                                <TabsTrigger value="preview">{t('emailStep.previewTab')}</TabsTrigger>
                                <TabsTrigger value="edit">{t('emailStep.editTab')}</TabsTrigger>
                            </TabsList>
                            <TabsContent value="preview" className="mt-2">
                                {body.trim() ? (
                                    <div
                                        className="min-h-64 max-h-96 overflow-auto rounded-md border bg-white p-4 text-sm text-neutral-900"
                                        dangerouslySetInnerHTML={{ __html: body }}
                                    />
                                ) : (
                                    <div className="flex min-h-64 items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground">
                                        {t('emailStep.previewEmptyState')}
                                    </div>
                                )}
                            </TabsContent>
                            <TabsContent value="edit" className="mt-2">
                                <Textarea
                                    value={body}
                                    onChange={(e) => setBody(e.target.value)}
                                    placeholder={t('emailStep.bodyPlaceholder', {
                                        token: '{{variable}}',
                                    })}
                                    className="min-h-64 font-mono text-sm"
                                />
                            </TabsContent>
                        </Tabs>
                        <p className="text-xs text-muted-foreground">
                            {t('emailStep.placeholderHintPrefix')}{' '}
                            <code className="font-mono">{'{{name}}'}</code>{' '}
                            {t('emailStep.placeholderHintSuffix')}
                        </p>
                    </div>
                </div>
            );
        }

        // PUSH or SYSTEM_ALERT
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label>{t('pushStep.titleLabel')}</Label>
                    <Input
                        value={pushTitle}
                        onChange={(e) => setPushTitle(e.target.value)}
                        placeholder={t('pushStep.titlePlaceholder')}
                    />
                </div>
                <div className="space-y-2">
                    <Label>{t('pushStep.bodyLabel')}</Label>
                    <Textarea
                        value={pushBody}
                        onChange={(e) => setPushBody(e.target.value)}
                        placeholder={t('pushStep.bodyPlaceholder')}
                        className="min-h-32"
                    />
                </div>
            </div>
        );
    };

    // Media header input — shown for any template whose header is IMAGE/VIDEO/DOCUMENT.
    // Required: without it the provider rejects every recipient of the blast.
    const renderHeaderMediaField = () => {
        if (!waHeaderKind) return null;
        const url = headerMediaUrl.trim();
        const kindLabel = t(`headerMedia.kindLabels.${waHeaderKind}`);
        return (
            <div className="mb-4 space-y-2 rounded-md border bg-muted/30 p-4">
                <Label>
                    {t('headerMedia.label', { kind: kindLabel })}{' '}
                    <span className="text-danger-600">*</span>
                </Label>
                <Input
                    value={headerMediaUrl}
                    onChange={(e) => setHeaderMediaUrl(e.target.value)}
                    placeholder="https://..."
                />
                <p className="text-xs text-muted-foreground">
                    {t('headerMedia.hint', { kind: kindLabel })}
                </p>
                {waHeaderKind === 'image' && url && (
                    <img
                        src={url}
                        alt={t('headerMedia.imagePreviewAlt')}
                        className="max-h-40 rounded-md border object-contain"
                    />
                )}
            </div>
        );
    };

    // Step 3 ------------------------------------------------------------------
    const renderVariableMapping = () => {
        if (variableKeys.length === 0) {
            return (
                <div>
                    {renderHeaderMediaField()}
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                        <CheckCircle className="h-8 w-8" />
                        <p className="text-sm">{t('variableMapping.noVariables')}</p>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-1">
                {renderHeaderMediaField()}
                <p className="mb-3 text-sm text-muted-foreground">
                    {t('variableMapping.mapHint')}
                </p>
                <div className="rounded-md border">
                    <div className="grid grid-cols-2 gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
                        <span>{t('variableMapping.columnVariable')}</span>
                        <span>{t('variableMapping.columnMappedField')}</span>
                    </div>
                    {variableKeys.map((varKey) => {
                        const currentValue = variableMapping[varKey] ?? '';
                        const isStatic = currentValue.startsWith('static:');
                        const selectValue = isStatic ? '__static__' : currentValue;
                        const staticText = isStatic ? currentValue.substring('static:'.length) : '';

                        return (
                            <div
                                key={varKey}
                                className="grid grid-cols-2 items-center gap-4 border-b px-4 py-2 last:border-b-0"
                            >
                                <span className="rounded bg-muted px-2 py-1 font-mono text-sm">
                                    {`{{${varKey}}}`}
                                </span>
                                <div className="flex flex-col gap-2">
                                    <Select
                                        value={selectValue}
                                        onValueChange={(val) => {
                                            if (val === '__static__') {
                                                handleMappingChange(varKey, 'static:');
                                            } else {
                                                handleMappingChange(varKey, val);
                                            }
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue
                                                placeholder={t(
                                                    'variableMapping.selectFieldPlaceholder'
                                                )}
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__static__">
                                                {t('variableMapping.staticValueOption')}
                                            </SelectItem>
                                            {mappingOptions.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {isStatic && (
                                        <Input
                                            value={staticText}
                                            onChange={(e) =>
                                                handleMappingChange(
                                                    varKey,
                                                    `static:${e.target.value}`
                                                )
                                            }
                                            placeholder={t('variableMapping.staticValuePlaceholder')}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Step 4 ------------------------------------------------------------------
    const renderReview = () => {
        if (sendResult) {
            const isSuccess = sendResult.status === 'SUCCESS' || sendResult.accepted > 0;
            return (
                <div className="flex flex-col items-center gap-4 py-8">
                    {isSuccess ? (
                        <CheckCircle className="h-12 w-12 text-green-500" />
                    ) : (
                        <XCircle className="h-12 w-12 text-destructive" />
                    )}
                    <h3 className="text-lg font-semibold">
                        {isSuccess ? t('review.messageSent') : t('review.sendCompleted')}
                    </h3>
                    <div className="w-full max-w-sm space-y-2 rounded-md border p-4 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('review.statusLabel')}</span>
                            <span className="font-medium">
                                {getStatusLabel(t, sendResult.status)}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('review.recipientsLabel')}
                            </span>
                            <span className="font-medium">{sendResult.recipient_count}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('review.acceptedLabel')}
                            </span>
                            <span className="font-medium text-green-600">
                                {sendResult.accepted}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('review.failedLabel')}</span>
                            <span className="font-medium text-destructive">
                                {sendResult.failed}
                            </span>
                        </div>
                    </div>
                    {sendResult.batch_id && (
                        <p className="text-xs text-muted-foreground">
                            {t('review.processingNotice', { batchId: sendResult.batch_id })}
                        </p>
                    )}
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="mt-2">
                        {t('review.close')}
                    </Button>
                </div>
            );
        }

        const ChannelIcon = channelMeta?.icon ?? ChatCircleDots;
        const contentLabel =
            channel === 'WHATSAPP'
                ? selectedTemplate?.name
                : channel === 'EMAIL'
                  ? subject
                  : pushTitle;

        return (
            <div className="space-y-4">
                <div className="rounded-md border p-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <ChannelIcon className="h-5 w-5 text-primary" />
                        <div>
                            <p className="text-sm font-semibold">{channelMeta?.label}</p>
                            <p className="text-xs text-muted-foreground">
                                {t('review.channelHeading')}
                            </p>
                        </div>
                    </div>

                    <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                            {channel === 'WHATSAPP'
                                ? t('review.whatsappContentLabel')
                                : t('review.otherContentLabel')}
                        </p>
                        <p className="text-sm font-medium">
                            {contentLabel || t('review.contentFallback')}
                        </p>
                    </div>

                    <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                            {t('review.recipientsLabel')}
                        </p>
                        <p className="text-sm font-medium">
                            {hasSelection
                                ? t('review.recipientsSelected', { count: selectionCount })
                                : resolvedLeadCount !== null
                                  ? t('review.recipientsAllKnown', { count: resolvedLeadCount })
                                  : t('review.recipientsAllUnknown')}
                        </p>
                    </div>

                    {Object.keys(variableMapping).length > 0 && (
                        <div className="border-t pt-3">
                            <p className="mb-2 text-xs text-muted-foreground">
                                {t('review.variableMappingsLabel')}
                            </p>
                            <div className="space-y-1">
                                {Object.entries(variableMapping).map(([varKey, field]) => {
                                    const fieldLabel = field.startsWith('static:')
                                        ? t('review.staticValueLabel', {
                                              value: field.substring('static:'.length),
                                          })
                                        : (mappingOptions.find((o) => o.value === field)?.label ??
                                          field);
                                    return (
                                        <div
                                            key={varKey}
                                            className="flex items-center gap-2 text-xs"
                                        >
                                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                                {`{{${varKey}}}`}
                                            </span>
                                            <CaretRight className="h-3 w-3 text-muted-foreground" />
                                            <span>{fieldLabel}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <Button
                    className="w-full"
                    onClick={handleSend}
                    disabled={isSending}
                >
                    {isSending ? (
                        <>
                            <CircleNotch className="me-2 h-4 w-4 animate-spin" />
                            {t('review.sending')}
                        </>
                    ) : (
                        <>
                            <PaperPlaneTilt className="me-2 h-4 w-4" />
                            {targetCount !== null
                                ? t('review.sendButtonKnown', { count: targetCount })
                                : t('review.sendButtonUnknown')}
                        </>
                    )}
                </Button>
            </div>
        );
    };

    // -----------------------------------------------------------------------
    // Main render
    // -----------------------------------------------------------------------
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-dialog-md max-h-dialog-tall overflow-y-auto overflow-x-hidden">
                <DialogHeader>
                    <DialogTitle>{t('dialogTitle')}</DialogTitle>
                    <DialogDescription>
                        {hasSelection
                            ? t('dialogDescriptionSelected', { count: selectionCount })
                            : t('dialogDescription', { campaignName })}
                    </DialogDescription>
                </DialogHeader>

                {renderStepIndicator()}

                {step === 1 && renderChannelSelection()}
                {step === 2 && renderContent()}
                {step === 3 && renderVariableMapping()}
                {step === 4 && renderReview()}

                {/* Footer navigation (hidden after send result) */}
                {!sendResult && (
                    <div className="mt-6 flex items-center justify-between">
                        <div>
                            {step > 1 && (
                                <Button variant="ghost" size="sm" onClick={handleBack}>
                                    <CaretLeft className="me-1 h-4 w-4" />
                                    {t('footer.back')}
                                </Button>
                            )}
                        </div>
                        <div>
                            {step < 4 && (
                                <Button size="sm" onClick={handleNext} disabled={!canProceed}>
                                    {t('footer.next')}
                                    <CaretRight className="ms-1 h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
