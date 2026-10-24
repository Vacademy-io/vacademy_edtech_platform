import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    ChatCircle,
    Envelope,
    CaretRight,
    CaretLeft,
    CircleNotch,
    PaperPlaneTilt,
    CheckCircle,
    XCircle,
} from '@phosphor-icons/react';
import {
    listTemplates,
    type WhatsAppTemplateDTO,
} from '@/routes/communication/whatsapp-templates/-services/template-api';
import { getMessageTemplates, getMessageTemplate } from '@/services/message-template-service';
import type { MessageTemplate } from '@/types/message-template-types';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';
import { WhatsAppTemplatePreview } from '@/components/templates/WhatsAppTemplatePreview';
import { sendNotification, getDeliveryStatus } from '@/services/unified-send-service';
import type { DeliveryStatus, UnifiedSendResponse } from '@/services/unified-send-service';
import {
    fetchCustomFieldSetup,
    type CustomFieldSetupItem,
} from '@/routes/audience-manager/list/-services/get-custom-field-setup';
import { StudentTable } from '@/types/student-table-types';
import {
    useStudentCredentails,
    type StudentCredentialsType,
} from '@/services/student-list-section/getStudentCredentails';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

type Channel = 'EMAIL' | 'WHATSAPP';

/**
 * What the result panel should say about a finished send.
 *
 * WhatsApp answers twice — the send call says whether the provider TOOK the message, its status
 * webhook says what happened to it a second or two later — and either answer can be a refusal that
 * arrives inside a 200. Pure and exported so those combinations are covered by tests rather than
 * eyeballed one send at a time.
 */
export function resolveSendVerdict({
    sendResult,
    delivery,
    channel,
    awaitingDelivery,
}: {
    sendResult: UnifiedSendResponse;
    delivery: DeliveryStatus | null;
    channel: Channel;
    awaitingDelivery: boolean;
}) {
    // A rejected recipient rides back inside a 200, and a batch can report COMPLETED while
    // carrying failed: 1 — with one recipient the counts are the truth, not the envelope.
    const rejected = sendResult.failed > 0 || sendResult.status === 'FAILED';
    const accepted = !rejected && (sendResult.status === 'COMPLETED' || sendResult.accepted > 0);
    const failedOnDelivery = delivery?.status === 'FAILED';
    const confirmedDelivered = delivery?.status === 'DELIVERED' || delivery?.status === 'READ';
    const unconfirmed = accepted && channel === 'WHATSAPP' && !confirmedDelivered;

    let headingKey = 'reviewStep.sendCompleted';
    if (rejected) headingKey = 'reviewStep.sendFailed';
    else if (failedOnDelivery) headingKey = 'reviewStep.notDelivered';
    else if (confirmedDelivered) headingKey = 'reviewStep.delivered';
    else if (unconfirmed && awaitingDelivery) headingKey = 'reviewStep.confirmingDelivery';
    else if (accepted) headingKey = 'reviewStep.messageSent';

    // The reason only ever appeared in a toast that had already gone by the time the admin read the
    // panel. Null means the provider gave none, and the caller shows its own fallback copy.
    let reason: string | null = null;
    if (rejected) {
        reason = sendResult.results?.find((r) => !r.success)?.error ?? null;
    } else if (failedOnDelivery) {
        const code = delivery?.errorCode ? ` (${delivery.errorCode})` : '';
        reason = delivery?.errorMessage ? `${delivery.errorMessage}${code}` : null;
    }

    return {
        tone: (rejected || failedOnDelivery
            ? 'failed'
            : unconfirmed && awaitingDelivery
              ? 'confirming'
              : 'ok') as 'failed' | 'confirming' | 'ok',
        headingKey,
        reason,
        showDelivery: accepted && channel === 'WHATSAPP',
        // No verdict yet reads as SENT, not as a question: WhatsApp has the message and has not
        // rejected it — the same one tick it shows the sender. Anything worse arrives as a status.
        deliveryWord: delivery?.status ?? 'SENT',
        failedOnDelivery,
        confirmedDelivered,
    };
}

interface IndividualSendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    student: StudentTable | null;
    channel: Channel;
    instituteId: string;
}

// System fields the user can map a variable to. Resolved against the StudentTable, plus the
// learner's portal credentials for username/password (fetched only when one of them is mapped).
// Both come from auth-service only — the login checks against that row, so no other field is
// used as a stand-in for the username.
const buildSystemFields = (
    t: TFunction
): Array<{
    value: string;
    label: string;
    resolve: (s: StudentTable, creds?: StudentCredentialsType | null) => string;
}> => [
    { value: 'system:full_name', label: t('systemFields.fullName'), resolve: (s) => s.full_name || '' },
    { value: 'system:email', label: t('systemFields.email'), resolve: (s) => s.email || '' },
    {
        value: 'system:mobile_number',
        label: t('systemFields.mobileNumber'),
        resolve: (s) => s.mobile_number || '',
    },
    { value: 'system:city', label: t('systemFields.city'), resolve: (s) => s.city || '' },
    { value: 'system:region', label: t('systemFields.region'), resolve: (s) => s.region || '' },
    { value: 'system:gender', label: t('systemFields.gender'), resolve: (s) => s.gender || '' },
    {
        value: 'system:enrollment_id',
        label: t('systemFields.enrollmentId'),
        resolve: (s) => s.institute_enrollment_id || '',
    },
    {
        value: 'system:fathers_name',
        label: t('systemFields.fathersName'),
        resolve: (s) => s.fathers_name || '',
    },
    {
        value: 'system:mothers_name',
        label: t('systemFields.mothersName'),
        resolve: (s) => s.mothers_name || '',
    },
    {
        value: 'system:username',
        label: t('systemFields.username'),
        resolve: (_s, creds) => creds?.username || '',
    },
    {
        value: 'system:password',
        label: t('systemFields.password'),
        resolve: (_s, creds) => creds?.password || '',
    },
];

const CREDENTIAL_MAPPINGS = ['system:username', 'system:password'];

const buildStepTitlesEmail = (t: TFunction): string[] => [
    t('steps.selectTemplate'),
    t('steps.composeContent'),
    t('steps.mapVariables'),
    t('steps.reviewSend'),
];
const buildStepTitlesWhatsapp = (t: TFunction): string[] => [
    t('steps.selectTemplate'),
    t('steps.mapVariables'),
    t('steps.reviewSend'),
];

function extractPlaceholders(text: string): string[] {
    const matches = text.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
}

// Best-effort auto-map: variable name "name" → system:full_name, etc.
function autoMapVariable(varKey: string): string | undefined {
    const k = varKey.toLowerCase();
    if (k === 'name' || k === 'full_name' || k === 'student_name' || k === 'fullname') {
        return 'system:full_name';
    }
    if (k === 'email' || k === 'email_id') return 'system:email';
    if (k === 'mobile' || k === 'mobile_number' || k === 'phone' || k === 'phone_number') {
        return 'system:mobile_number';
    }
    if (k === 'city') return 'system:city';
    if (k === 'region' || k === 'state') return 'system:region';
    if (k === 'gender') return 'system:gender';
    if (k === 'enrollment_id' || k === 'enrollment_number') return 'system:enrollment_id';
    if (k === 'username' || k === 'user_name' || k === 'login_id') return 'system:username';
    if (k === 'password') return 'system:password';
    return undefined;
}

export function IndividualSendDialog({
    open,
    onOpenChange,
    student,
    channel,
    instituteId,
}: IndividualSendDialogProps) {
    const { t } = useTranslation('manageStudentsIndividualSendDialog');
    const STEP_TITLES = channel === 'EMAIL' ? buildStepTitlesEmail(t) : buildStepTitlesWhatsapp(t);
    const totalSteps = STEP_TITLES.length;
    const SYSTEM_FIELDS = useMemo(() => buildSystemFields(t), [t]);
    const [step, setStep] = useState(1);

    // Email state
    const [emailTemplates, setEmailTemplates] = useState<MessageTemplate[]>([]);
    const [loadingEmailTemplates, setLoadingEmailTemplates] = useState(false);
    const [selectedEmailTemplateId, setSelectedEmailTemplateId] = useState<string>('');
    const [loadingTemplateContent, setLoadingTemplateContent] = useState(false);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [emailType, setEmailType] = useState<
        'UTILITY_EMAIL' | 'PROMOTIONAL_EMAIL' | 'TRANSACTIONAL_EMAIL'
    >('UTILITY_EMAIL');
    const [emailBodyView, setEmailBodyView] = useState<'preview' | 'edit'>('edit');

    // WhatsApp state
    const [waTemplates, setWaTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [loadingWaTemplates, setLoadingWaTemplates] = useState(false);
    const [selectedWaTemplate, setSelectedWaTemplate] = useState<WhatsAppTemplateDTO | null>(null);
    const [languageCode, setLanguageCode] = useState('en');
    // Media URL for templates whose header is IMAGE/VIDEO/DOCUMENT. Meta requires the
    // header component on every send of such a template — the sample approved with the
    // template is NOT attached automatically — so omitting it fails the whole send.
    const [headerMediaUrl, setHeaderMediaUrl] = useState('');

    // Custom fields setup (so we can show field names instead of IDs in the mapper)
    const [customFieldSetup, setCustomFieldSetup] = useState<CustomFieldSetupItem[]>([]);

    // Variable mapping: varKey -> "system:..." | "custom:<fieldId>" | "literal:<text>"
    const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});
    const [literalValues, setLiteralValues] = useState<Record<string, string>>({});

    // Send state
    const [isSending, setIsSending] = useState(false);
    const [sendResult, setSendResult] = useState<UnifiedSendResponse | null>(null);
    // What WhatsApp did with the message AFTER accepting it. The send response cannot know:
    // acceptance is a queue receipt and the verdict arrives on the status webhook a moment later.
    const [delivery, setDelivery] = useState<DeliveryStatus | null>(null);
    const [awaitingDelivery, setAwaitingDelivery] = useState(false);
    // Bumped on every new send and on close, so a poll that is still in flight cannot write a
    // verdict into a dialog that has moved on to a different message.
    const deliveryPollToken = useRef(0);

    // Reset on close
    useEffect(() => {
        if (!open) {
            setStep(1);
            setSelectedEmailTemplateId('');
            setSubject('');
            setBody('');
            setEmailBodyView('edit');
            setSelectedWaTemplate(null);
            setLanguageCode('en');
            setHeaderMediaUrl('');
            setVariableMapping({});
            setLiteralValues({});
            setIsSending(false);
            setSendResult(null);
            setDelivery(null);
            setAwaitingDelivery(false);
            deliveryPollToken.current += 1;
        }
    }, [open]);

    // Load templates when channel/open changes
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        if (channel === 'EMAIL') {
            setLoadingEmailTemplates(true);
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
        } else {
            setLoadingWaTemplates(true);
            listTemplates(instituteId)
                .then((data) => {
                    if (!cancelled) setWaTemplates(data);
                })
                .catch(() => {
                    if (!cancelled) toast.error(t('toasts.loadWaTemplatesFailed'));
                })
                .finally(() => {
                    if (!cancelled) setLoadingWaTemplates(false);
                });
        }
        return () => {
            cancelled = true;
        };
    }, [open, channel, instituteId, t]);

    // Load custom field setup once per open
    useEffect(() => {
        if (!open || !instituteId) return;
        let cancelled = false;
        fetchCustomFieldSetup(instituteId)
            .then((data) => {
                if (!cancelled) setCustomFieldSetup(data);
            })
            .catch(() => {
                /* non-fatal: mapper falls back to IDs */
            });
        return () => {
            cancelled = true;
        };
    }, [open, instituteId]);

    // Apply selected email template
    const handleEmailTemplateSelect = useCallback(async (templateId: string) => {
        setSelectedEmailTemplateId(templateId);
        setVariableMapping({});
        setLiteralValues({});
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
            setEmailBodyView('preview');
        } catch {
            toast.error(t('toasts.loadTemplateContentFailed'));
        } finally {
            setLoadingTemplateContent(false);
        }
    }, [t]);

    const handleWaTemplateSelect = useCallback(
        (templateName: string) => {
            const tpl = waTemplates.find((x) => x.name === templateName) ?? null;
            setSelectedWaTemplate(tpl);
            if (tpl?.language) setLanguageCode(tpl.language);
            setVariableMapping({});
            setLiteralValues({});
            // Pre-fill with the media approved alongside the template so the common
            // case needs no extra input; still editable before sending.
            setHeaderMediaUrl(tpl?.headerSampleUrl ?? '');
        },
        [waTemplates]
    );

    /**
     * Lowercased media header kind ('image' | 'video' | 'document') when the selected
     * template carries a media header, else null. TEXT/NONE headers need no media.
     */
    const waHeaderKind = useMemo<'image' | 'video' | 'document' | null>(() => {
        const raw = selectedWaTemplate?.headerType?.toUpperCase();
        if (raw === 'IMAGE') return 'image';
        if (raw === 'VIDEO') return 'video';
        if (raw === 'DOCUMENT') return 'document';
        return null;
    }, [selectedWaTemplate]);

    const approvedWaTemplates = useMemo(
        () => waTemplates.filter((tpl) => tpl.status === 'APPROVED'),
        [waTemplates]
    );

    // Variables to map
    const variableKeys = useMemo<string[]>(() => {
        if (channel === 'WHATSAPP' && selectedWaTemplate) {
            if (selectedWaTemplate.bodyVariableNames?.length) {
                return selectedWaTemplate.bodyVariableNames;
            }
            return extractPlaceholders(selectedWaTemplate.bodyText ?? '');
        }
        if (channel === 'EMAIL') {
            return extractPlaceholders(`${subject} ${body}`);
        }
        return [];
    }, [channel, selectedWaTemplate, subject, body]);

    // Auto-map variables when they first appear
    useEffect(() => {
        if (variableKeys.length === 0) return;
        setVariableMapping((prev) => {
            const next = { ...prev };
            for (const k of variableKeys) {
                if (!next[k]) {
                    const auto = autoMapVariable(k);
                    if (auto) next[k] = auto;
                }
            }
            return next;
        });
    }, [variableKeys]);

    // Credentials are only fetched once a variable is mapped to username/password, so opening the
    // dialog for an ordinary template does not read the learner's password.
    const needsCredentials = Object.values(variableMapping).some((m) =>
        CREDENTIAL_MAPPINGS.includes(m)
    );
    const credentialsQuery = useStudentCredentails({
        userId: open && needsCredentials ? student?.user_id || student?.id || '' : '',
    });
    const credentials = credentialsQuery.data;
    const credentialsPending = needsCredentials && credentialsQuery.isFetching;

    // Mapping options shown in dropdowns
    const mappingOptions = useMemo(() => {
        const customs = customFieldSetup
            .filter((f) => !f.is_hidden)
            .map((f) => ({
                value: `custom:${f.custom_field_id}`,
                label: f.field_name || f.field_key,
            }));
        const all = [
            ...SYSTEM_FIELDS.map((f) => ({ value: f.value, label: f.label })),
            ...customs,
            { value: 'literal:value', label: t('variableMappingStep.literalOption') },
        ];
        // The searchable list matches and highlights by label, so two custom fields sharing a
        // name would act as one row. Number the repeats to keep every option distinct.
        const seen: Record<string, number> = {};
        return all.map((o) => {
            const n = (seen[o.label] ?? 0) + 1;
            seen[o.label] = n;
            return n > 1 ? { ...o, label: `${o.label} (${n})` } : o;
        });
    }, [customFieldSetup, SYSTEM_FIELDS, t]);

    // Resolve a single variable's runtime value from the current student
    const resolveValue = useCallback(
        (varKey: string): string => {
            if (!student) return '';
            const mapping = variableMapping[varKey];
            if (!mapping) return '';
            if (mapping.startsWith('literal:')) {
                return literalValues[varKey] ?? '';
            }
            if (mapping.startsWith('system:')) {
                const sys = SYSTEM_FIELDS.find((f) => f.value === mapping);
                return sys?.resolve(student, credentials) ?? '';
            }
            if (mapping.startsWith('custom:')) {
                const fieldId = mapping.slice('custom:'.length);
                return student.custom_fields?.[fieldId] ?? '';
            }
            return '';
        },
        [student, variableMapping, literalValues, SYSTEM_FIELDS, credentials]
    );

    const resolvedVariables = useMemo(() => {
        const out: Record<string, string> = {};
        for (const k of variableKeys) {
            out[k] = resolveValue(k);
        }
        return out;
    }, [variableKeys, resolveValue]);

    // Replace placeholders in a string with resolved values (for email preview/send)
    const interpolate = useCallback(
        (text: string) => {
            if (!text) return text;
            return text.replace(/\{\{(\w+)\}\}/g, (_, key) => resolvedVariables[key] ?? '');
        },
        [resolvedVariables]
    );

    const canProceed = useMemo(() => {
        if (channel === 'EMAIL') {
            switch (step) {
                case 1:
                    return !!selectedEmailTemplateId;
                case 2:
                    return subject.trim() !== '' && body.trim() !== '';
                case 3:
                    return !credentialsPending; // mapping optional
                default:
                    return false;
            }
        }
        // WHATSAPP
        switch (step) {
            case 1:
                return selectedWaTemplate !== null;
            case 2:
                // A media-header template without its media is guaranteed to be rejected
                // by the provider, so block it here instead of failing at send time.
                return (!waHeaderKind || headerMediaUrl.trim() !== '') && !credentialsPending;
            default:
                return false;
        }
    }, [
        channel,
        step,
        selectedEmailTemplateId,
        subject,
        body,
        selectedWaTemplate,
        waHeaderKind,
        headerMediaUrl,
        credentialsPending,
    ]);

    const handleNext = useCallback(() => {
        if (step < totalSteps) setStep((s) => s + 1);
    }, [step, totalSteps]);

    const handleBack = useCallback(() => {
        if (step > 1) setStep((s) => s - 1);
    }, [step]);

    const handleMappingChange = useCallback((varKey: string, fieldValue: string) => {
        setVariableMapping((prev) => ({ ...prev, [varKey]: fieldValue }));
    }, []);

    const handleLiteralChange = useCallback((varKey: string, text: string) => {
        setLiteralValues((prev) => ({ ...prev, [varKey]: text }));
    }, []);

    /**
     * Follow an accepted WhatsApp message until the provider says what happened to it.
     *
     * The send response is a queue receipt: WhatsApp acknowledges the message, then reports the real
     * outcome on its status webhook a second or two later. Without this the dialog showed a green
     * tick for messages that were rejected outright (131042 payment issue kills every send on an
     * account, and looks identical to a healthy send at this point).
     */
    const pollDeliveryStatus = useCallback(async (messageId: string) => {
        const token = ++deliveryPollToken.current;
        setAwaitingDelivery(true);
        const deadline = Date.now() + 12000;
        try {
            while (Date.now() < deadline && token === deliveryPollToken.current) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                if (token !== deliveryPollToken.current) return;
                const [status] = await getDeliveryStatus([messageId]);
                if (token !== deliveryPollToken.current) return;
                if (!status || status.status === 'PENDING') continue;
                setDelivery(status);
                // DELIVERED can still become READ, but this panel says "Delivered" for both, so
                // there is nothing left to wait for — stopping here saves ~8 polls per send.
                if (status.settled || status.status === 'DELIVERED') return;
            }
        } catch (err) {
            // Never let a failed lookup become a claim about delivery — leave the panel saying
            // "accepted, not confirmed" rather than inventing either outcome.
            console.warn('Could not confirm WhatsApp delivery status', err);
        } finally {
            if (token === deliveryPollToken.current) setAwaitingDelivery(false);
        }
    }, []);

    const handleSend = useCallback(async () => {
        if (!student || !instituteId) return;

        // Validate recipient has the right contact for the channel
        if (channel === 'EMAIL' && !student.email) {
            toast.error(t('toasts.noEmailAddress'));
            return;
        }
        if (channel === 'WHATSAPP' && !student.mobile_number) {
            toast.error(t('toasts.noMobileNumber'));
            return;
        }

        setIsSending(true);
        try {
            if (channel === 'EMAIL') {
                const result = await sendNotification({
                    instituteId,
                    channel: 'EMAIL',
                    recipients: [
                        {
                            email: student.email,
                            userId: student.user_id,
                            name: student.full_name,
                            variables: resolvedVariables,
                        },
                    ],
                    options: {
                        emailSubject: interpolate(subject),
                        emailBody: interpolate(body),
                        emailType,
                        source: 'STUDENT_SIDE_VIEW',
                        sourceId: uuidv4(),
                    },
                });
                setSendResult(result);
                // Same trap as WhatsApp below: a rejected recipient rides back inside a 200.
                if (result.failed > 0) {
                    const reason = result.results?.find((r) => !r.success)?.error;
                    toast.error(
                        reason
                            ? t('toasts.emailRejectedWithReason', { reason })
                            : t('toasts.emailRejected')
                    );
                } else {
                    toast.success(t('toasts.emailSent'));
                }
            } else {
                if (!selectedWaTemplate) {
                    toast.error(t('toasts.selectWaTemplateFirst'));
                    setIsSending(false);
                    return;
                }
                const result = await sendNotification({
                    instituteId,
                    channel: 'WHATSAPP',
                    templateName: selectedWaTemplate.name,
                    languageCode: languageCode || selectedWaTemplate.language || 'en',
                    recipients: [
                        {
                            phone: student.mobile_number,
                            userId: student.user_id,
                            name: student.full_name,
                            variables: resolvedVariables,
                        },
                    ],
                    options: {
                        source: 'STUDENT_SIDE_VIEW',
                        sourceId: uuidv4(),
                        // Meta rejects the whole send if a media-header template arrives
                        // without its header component, so always thread it through.
                        ...(waHeaderKind && headerMediaUrl.trim()
                            ? {
                                  headerType: waHeaderKind,
                                  headerUrl: headerMediaUrl.trim(),
                              }
                            : {}),
                    },
                });
                setSendResult(result);
                // A per-recipient rejection comes back inside a 200 (failed: 1), so only reading
                // the promise resolving showed "message sent" for sends the provider refused
                // outright. And even a clean acceptance is not delivery — WhatsApp confirms that
                // later on its status webhook — so the success copy promises handover, not arrival.
                if (result.failed > 0) {
                    const reason = result.results?.find((r) => !r.success)?.error;
                    toast.error(
                        reason
                            ? t('toasts.whatsappRejectedWithReason', { reason })
                            : t('toasts.whatsappRejected')
                    );
                } else {
                    toast.success(t('toasts.whatsappQueued'));
                    // Accepted is not delivered. Follow the message for a few seconds so the panel
                    // can report what WhatsApp actually did instead of a green tick it cannot back up.
                    const messageId = result.results?.find((r) => r.success)?.messageId;
                    if (messageId) void pollDeliveryStatus(messageId);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('toasts.sendFailed');
            toast.error(msg);
        } finally {
            setIsSending(false);
        }
    }, [
        student,
        instituteId,
        channel,
        resolvedVariables,
        subject,
        body,
        emailType,
        selectedWaTemplate,
        languageCode,
        interpolate,
        pollDeliveryStatus,
        t,
    ]);

    const channelIcon = channel === 'EMAIL' ? Envelope : ChatCircle;
    const ChannelIcon = channelIcon;

    // ------- render helpers -------

    const waPreviewLabels = useMemo(
        () => ({
            image: t('waPreview.image'),
            video: t('waPreview.video'),
            document: t('waPreview.document'),
            emptyBody: t('waPreview.emptyBody'),
        }),
        [t]
    );

    /**
     * The message as it will land on the phone, with whatever the mapping has resolved so far.
     * Shown on every WhatsApp step after the template is picked: the admin is sending a message
     * they cannot edit, so the only protection against sending the wrong one is seeing it.
     */
    const renderWaMessagePreview = (label: string) =>
        // The mapping and review steps are shared by both channels. Today's callers mount a fresh
        // dialog per channel so a WhatsApp template cannot survive into an email flow, but the
        // channel check keeps that true no matter how the dialog is mounted later.
        channel === 'WHATSAPP' && selectedWaTemplate ? (
            <div className="space-y-2">
                <Label>{label}</Label>
                <WhatsAppTemplatePreview
                    template={selectedWaTemplate}
                    values={resolvedVariables}
                    mediaUrl={headerMediaUrl}
                    labels={waPreviewLabels}
                />
            </div>
        ) : null;

    const renderStepIndicator = () => (
        <div className="mb-6 flex w-full min-w-0 items-center gap-1 overflow-hidden">
            {STEP_TITLES.map((title, i) => {
                const stepNum = i + 1;
                const isActive = stepNum === step;
                const isDone = stepNum < step;
                return (
                    <div
                        key={stepNum}
                        className={`flex min-w-0 items-center gap-1.5 ${isActive ? 'flex-1' : 'flex-none'}`}
                    >
                        {i > 0 && (
                            <div
                                className={`h-px min-w-2 flex-1 ${isDone ? 'bg-primary-500' : 'bg-neutral-200'}`}
                            />
                        )}
                        <div
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ring-1 transition-colors ${
                                isActive
                                    ? 'bg-primary-500 text-white shadow-sm ring-primary-500'
                                    : isDone
                                      ? 'bg-primary-100 text-primary-600 ring-primary-200'
                                      : 'bg-neutral-100 text-neutral-500 ring-neutral-200'
                            }`}
                        >
                            {isDone ? <CheckCircle className="size-3.5" /> : stepNum}
                        </div>
                        {isActive && (
                            <span className="truncate text-xs font-semibold text-primary-600">
                                {title}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const renderEmailTemplateStep = () => (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>{t('emailTemplateStep.templateLabel')}</Label>
                {loadingEmailTemplates ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('emailTemplateStep.loadingTemplates')}
                    </div>
                ) : (
                    <TemplateSearchableSelect
                        options={toTemplateOptions(emailTemplates, 'id')}
                        value={selectedEmailTemplateId}
                        onChange={handleEmailTemplateSelect}
                        placeholder={t('emailTemplateStep.selectPlaceholder')}
                        emptyText={t('emailTemplateStep.emptyText')}
                        noneOption={{ value: 'custom', label: t('emailTemplateStep.customOption') }}
                        expandLabel={t('templatePicker.showFullMessage')}
                        collapseLabel={t('templatePicker.showLess')}
                        disabled={loadingTemplateContent}
                        portal={false}
                    />
                )}
                {loadingTemplateContent && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CircleNotch className="size-3 animate-spin" />
                        {t('emailTemplateStep.loadingContent')}
                    </div>
                )}
            </div>
        </div>
    );

    const renderEmailComposeStep = () => (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>{t('emailComposeStep.emailTypeLabel')}</Label>
                <Select
                    value={emailType}
                    onValueChange={(v) => setEmailType(v as typeof emailType)}
                >
                    <SelectTrigger className="w-60">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="UTILITY_EMAIL">
                            {t('emailComposeStep.emailTypeUtility')}
                        </SelectItem>
                        <SelectItem value="PROMOTIONAL_EMAIL">
                            {t('emailComposeStep.emailTypePromotional')}
                        </SelectItem>
                        <SelectItem value="TRANSACTIONAL_EMAIL">
                            {t('emailComposeStep.emailTypeTransactional')}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label>{t('emailComposeStep.subjectLabel')}</Label>
                <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t('emailComposeStep.subjectPlaceholder')}
                />
            </div>
            <div className="space-y-2">
                <Label>{t('emailComposeStep.bodyLabel')}</Label>
                <Tabs
                    value={emailBodyView}
                    onValueChange={(v) => setEmailBodyView(v as 'preview' | 'edit')}
                    className="w-full"
                >
                    <TabsList className="grid w-fit grid-cols-2">
                        <TabsTrigger value="preview">{t('emailComposeStep.previewTab')}</TabsTrigger>
                        <TabsTrigger value="edit">{t('emailComposeStep.editTab')}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview" className="mt-2">
                        {body.trim() ? (
                            <div
                                className="max-h-96 min-h-64 overflow-auto rounded-md border bg-white p-4 text-sm text-neutral-900"
                                dangerouslySetInnerHTML={{ __html: body }}
                            />
                        ) : (
                            <div className="flex min-h-64 items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground">
                                {t('emailComposeStep.emptyBodyPreview')}
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="edit" className="mt-2">
                        <Textarea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            placeholder={t('emailComposeStep.bodyPlaceholder', {
                                varSyntax: '{{variable}}',
                            })}
                            className="min-h-64 font-mono text-sm"
                        />
                    </TabsContent>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                    {t('emailComposeStep.bodyHelpPrefix')}{' '}
                    <code className="font-mono">{'{{name}}'}</code>{' '}
                    {t('emailComposeStep.bodyHelpSuffix')}
                </p>
            </div>
        </div>
    );

    const renderWaTemplateStep = () => (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>{t('waTemplateStep.templateLabel')}</Label>
                {loadingWaTemplates ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('waTemplateStep.loadingTemplates')}
                    </div>
                ) : (
                    <TemplateSearchableSelect
                        options={toTemplateOptions(approvedWaTemplates)}
                        value={selectedWaTemplate?.name ?? ''}
                        onChange={handleWaTemplateSelect}
                        placeholder={t('waTemplateStep.selectPlaceholder')}
                        emptyText={t('waTemplateStep.emptyText')}
                        expandLabel={t('templatePicker.showFullMessage')}
                        collapseLabel={t('templatePicker.showLess')}
                        portal={false}
                    />
                )}
            </div>
            <div className="space-y-2">
                <Label>{t('waTemplateStep.languageCodeLabel')}</Label>
                <Input
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    placeholder="en"
                    className="w-32"
                />
            </div>
            {selectedWaTemplate && (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label>{t('waTemplateStep.templatePreviewLabel')}</Label>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {selectedWaTemplate.category && (
                                <span className="rounded bg-primary-50 px-1.5 py-0.5 text-2xs text-primary-500">
                                    {selectedWaTemplate.category}
                                </span>
                            )}
                            {selectedWaTemplate.language && (
                                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs text-neutral-500">
                                    {selectedWaTemplate.language}
                                </span>
                            )}
                            {waHeaderKind && (
                                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-2xs text-neutral-500">
                                    {t('waTemplateStep.headerBadge', {
                                        kind: t(`mediaKind.${waHeaderKind}`),
                                    })}
                                </span>
                            )}
                        </div>
                    </div>
                    {/* No values yet — every placeholder shows the field it will be filled from. */}
                    <WhatsAppTemplatePreview
                        template={selectedWaTemplate}
                        labels={waPreviewLabels}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('waTemplateStep.previewHint')}
                    </p>
                </div>
            )}
        </div>
    );

    // Media header input — rendered for any template whose header is IMAGE/VIDEO/DOCUMENT.
    // Without it the provider rejects the send outright, so it is a required field.
    const renderHeaderMediaField = () => {
        if (!waHeaderKind) return null;
        const url = headerMediaUrl.trim();
        const kindLabel = t(`mediaKind.${waHeaderKind}`);
        return (
            <div className="mb-4 space-y-2 rounded-md border bg-muted/30 p-4">
                <Label>
                    {t('headerMediaField.label', { kind: kindLabel })}{' '}
                    <span className="text-danger-600">*</span>
                </Label>
                <Input
                    value={headerMediaUrl}
                    onChange={(e) => setHeaderMediaUrl(e.target.value)}
                    placeholder="https://..."
                />
                <p className="text-xs text-muted-foreground">
                    {t('headerMediaField.helpText', { kind: kindLabel })}
                </p>
                {waHeaderKind === 'image' && url && (
                    <img
                        src={url}
                        alt={t('headerMediaField.previewAlt')}
                        className="max-h-40 rounded-md border object-contain"
                    />
                )}
            </div>
        );
    };

    const renderVariableMappingStep = () => {
        if (variableKeys.length === 0) {
            return (
                <div className="space-y-4">
                    {renderHeaderMediaField()}
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
                        <CheckCircle className="size-8" />
                        <p className="text-sm">{t('variableMappingStep.noVariables')}</p>
                    </div>
                    {renderWaMessagePreview(t('variableMappingStep.livePreviewLabel'))}
                </div>
            );
        }
        return (
            <div className="space-y-1">
                {renderHeaderMediaField()}
                <p className="mb-3 text-sm text-muted-foreground">
                    {t('variableMappingStep.mapHint')}
                </p>
                <div className="rounded-md border">
                    {/* `minmax(0,...)` on every column lets long content (e.g. emails)
                        truncate inside the cell instead of forcing the row wider than
                        the dialog. The pill column is intentionally narrowest. */}
                    <div className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
                        <span>{t('variableMappingStep.columnVariable')}</span>
                        <span>{t('variableMappingStep.columnSource')}</span>
                        <span>{t('variableMappingStep.columnResolvedValue')}</span>
                    </div>
                    {variableKeys.map((varKey) => {
                        const mapping = variableMapping[varKey] ?? '';
                        const isLiteral = mapping.startsWith('literal:');
                        const resolved = resolveValue(varKey);
                        return (
                            <div
                                key={varKey}
                                className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 border-b px-4 py-2 last:border-b-0"
                            >
                                <span
                                    className="truncate rounded bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-700"
                                    title={`{{${varKey}}}`}
                                >
                                    {`{{${varKey}}}`}
                                </span>
                                <div className="flex min-w-0 flex-col gap-1">
                                    <SearchableSelect
                                        options={mappingOptions}
                                        value={mapping}
                                        onChange={(val) => handleMappingChange(varKey, val)}
                                        placeholder={t('variableMappingStep.sourcePlaceholder')}
                                        searchPlaceholder={t(
                                            'variableMappingStep.sourceSearchPlaceholder'
                                        )}
                                        emptyText={t('variableMappingStep.sourceNoMatch')}
                                        portal={false}
                                    />
                                    {isLiteral && (
                                        <Input
                                            value={literalValues[varKey] ?? ''}
                                            onChange={(e) =>
                                                handleLiteralChange(varKey, e.target.value)
                                            }
                                            placeholder={t(
                                                'variableMappingStep.literalPlaceholder'
                                            )}
                                            className="h-8 text-xs"
                                        />
                                    )}
                                </div>
                                <span
                                    className="block min-w-0 truncate text-xs text-neutral-700"
                                    title={resolved}
                                >
                                    {resolved || (
                                        <span className="italic text-neutral-400">
                                            {t('variableMappingStep.unresolved')}
                                        </span>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
                <div className="pt-4">
                    {renderWaMessagePreview(t('variableMappingStep.livePreviewLabel'))}
                </div>
            </div>
        );
    };

    /**
     * Provider status vocabulary → something an admin reads. Falls back to the raw word so a status
     * WhatsApp adds later shows up as itself rather than as a missing translation key.
     */
    const deliveryStatusLabel = useCallback(
        (status: string) => t(`reviewStep.deliveryStatus.${status}`, { defaultValue: status }),
        [t]
    );

    const renderReviewStep = () => {
        if (sendResult) {
            const verdict = resolveSendVerdict({
                sendResult,
                delivery,
                channel,
                awaitingDelivery,
            });

            return (
                <div className="flex flex-col items-center gap-4 py-8">
                    {verdict.tone === 'failed' ? (
                        <XCircle className="size-12 text-destructive" />
                    ) : verdict.tone === 'confirming' ? (
                        <CircleNotch className="size-12 animate-spin text-neutral-400" />
                    ) : (
                        <CheckCircle className="size-12 text-green-500" />
                    )}
                    <h3 className="text-lg font-semibold">{t(verdict.headingKey)}</h3>
                    {verdict.tone === 'failed' && (
                        <p className="max-w-sm text-center text-sm text-destructive">
                            {verdict.reason ?? t('reviewStep.noReason')}
                        </p>
                    )}
                    <div className="w-full max-w-sm space-y-2 rounded-md border p-4 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.statusLabel')}
                            </span>
                            <span className="font-medium">{sendResult.status}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.acceptedLabel')}
                            </span>
                            <span className="font-medium text-green-600">
                                {sendResult.accepted}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.failedLabel')}
                            </span>
                            <span className="font-medium text-destructive">
                                {sendResult.failed}
                            </span>
                        </div>
                        {verdict.showDelivery && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                    {t('reviewStep.deliveryLabel')}
                                </span>
                                <span
                                    className={`font-medium ${
                                        verdict.failedOnDelivery
                                            ? 'text-destructive'
                                            : verdict.confirmedDelivered
                                              ? 'text-green-600'
                                              : 'text-muted-foreground'
                                    }`}
                                >
                                    {deliveryStatusLabel(verdict.deliveryWord)}
                                </span>
                            </div>
                        )}
                    </div>
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="mt-2">
                        {t('reviewStep.close')}
                    </Button>
                </div>
            );
        }

        const headerLabel =
            channel === 'EMAIL'
                ? interpolate(subject) || t('reviewStep.noSubject')
                : selectedWaTemplate?.name || '-';
        const recipient = channel === 'EMAIL' ? student?.email : student?.mobile_number;

        return (
            <div className="space-y-4">
                <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-center gap-3">
                        <ChannelIcon className="size-5 text-primary-500" />
                        <div>
                            <p className="text-sm font-semibold">
                                {channel === 'EMAIL'
                                    ? t('channelLabel.EMAIL')
                                    : t('channelLabel.WHATSAPP')}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {t('reviewStep.channelHeading')}
                            </p>
                        </div>
                    </div>
                    <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                            {channel === 'EMAIL'
                                ? t('reviewStep.subjectLabel')
                                : t('reviewStep.templateLabel')}
                        </p>
                        <p className="text-sm font-medium">{headerLabel}</p>
                    </div>
                    <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                            {t('reviewStep.recipientLabel')}
                        </p>
                        <p className="text-sm font-medium">
                            {student?.full_name}
                            {recipient && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                    ({recipient})
                                </span>
                            )}
                        </p>
                    </div>
                    {variableKeys.length > 0 && (
                        <div className="border-t pt-3">
                            <p className="mb-2 text-xs text-muted-foreground">
                                {t('reviewStep.variablesLabel')}
                            </p>
                            <div className="space-y-1">
                                {variableKeys.map((k) => (
                                    <div key={k} className="flex items-center gap-2 text-xs">
                                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                            {`{{${k}}}`}
                                        </span>
                                        <CaretRight className="size-3 text-muted-foreground" />
                                        <span className="truncate">
                                            {resolvedVariables[k] || (
                                                <span className="italic text-neutral-400">
                                                    {t('reviewStep.empty')}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                {renderWaMessagePreview(t('reviewStep.messagePreviewLabel'))}
                <Button className="w-full" onClick={handleSend} disabled={isSending}>
                    {isSending ? (
                        <>
                            <CircleNotch className="me-2 size-4 animate-spin" />
                            {t('reviewStep.sending')}
                        </>
                    ) : (
                        <>
                            <PaperPlaneTilt className="me-2 size-4" />
                            {t('reviewStep.sendTo', { name: student?.full_name ?? '' })}
                        </>
                    )}
                </Button>
            </div>
        );
    };

    const renderStep = () => {
        if (channel === 'EMAIL') {
            if (step === 1) return renderEmailTemplateStep();
            if (step === 2) return renderEmailComposeStep();
            if (step === 3) return renderVariableMappingStep();
            if (step === 4) return renderReviewStep();
        } else {
            if (step === 1) return renderWaTemplateStep();
            if (step === 2) return renderVariableMappingStep();
            if (step === 3) return renderReviewStep();
        }
        return null;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* A column, not the base grid: the header, the step rail and the Back/Next bar hold
                still while only the step's own content scrolls. Before this the whole dialog
                scrolled, so opening the template list pushed Next out of sight and the list itself
                was read through a letterbox. `min-h-dialog-md` stops the panel collapsing to the
                height of a closed picker and jumping on every step. */}
            <DialogContent className="flex max-h-dialog-tall min-h-dialog-md w-dialog-lg flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle>
                        {t('dialogTitle', {
                            channelLabel:
                                channel === 'EMAIL'
                                    ? t('channelLabel.EMAIL')
                                    : t('channelLabel.WHATSAPP'),
                        })}
                    </DialogTitle>
                    <DialogDescription>
                        {student
                            ? t('dialogDescription.withStudent', {
                                  contentType:
                                      channel === 'EMAIL'
                                          ? t('contentType.EMAIL')
                                          : t('contentType.WHATSAPP'),
                                  name: student.full_name,
                              })
                            : t('dialogDescription.noStudent')}
                    </DialogDescription>
                </DialogHeader>

                {renderStepIndicator()}

                {/* min-h-0: without it a flex child refuses to shrink below its content and the
                    scroll lands on the dialog again. */}
                <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{renderStep()}</div>

                {!sendResult && (
                    <div className="mt-4 flex shrink-0 items-center justify-between border-t pt-4">
                        <div>
                            {step > 1 && (
                                <Button variant="ghost" size="sm" onClick={handleBack}>
                                    <CaretLeft className="me-1 size-4" />
                                    {t('footer.back')}
                                </Button>
                            )}
                        </div>
                        <div>
                            {step < totalSteps && (
                                <Button size="sm" onClick={handleNext} disabled={!canProceed}>
                                    {t('footer.next')}
                                    <CaretRight className="ms-1 size-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
