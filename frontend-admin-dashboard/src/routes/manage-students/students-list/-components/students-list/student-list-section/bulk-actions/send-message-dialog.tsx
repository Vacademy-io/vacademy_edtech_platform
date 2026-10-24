import { useCallback, useEffect, useMemo, useState } from 'react';
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
    WhatsappLogo,
    CaretLeft,
    CaretRight,
    CircleNotch,
    PaperPlaneTilt,
    CheckCircle,
    XCircle,
} from '@phosphor-icons/react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    listTemplates,
    type WhatsAppTemplateDTO,
} from '@/routes/communication/whatsapp-templates/-services/template-api';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';
import {
    fetchCustomFieldSetup,
    type CustomFieldSetupItem,
} from '@/routes/audience-manager/list/-services/get-custom-field-setup';
import {
    sendNotification,
    waitForBatchCompletion,
    type UnifiedSendResponse,
} from '@/services/unified-send-service';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { StudentTable } from '@/types/student-table-types';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { USERS_CREDENTIALS } from '@/constants/urls';
import type { StudentCredentialsType } from '@/services/student-list-section/getStudentCredentails';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { useDialogStore } from '../../../../-hooks/useDialogStore';

// Multi-step compose flow modelled on the side-view IndividualSendDialog (WhatsApp
// branch), but multi-recipient: variables are resolved per selected student and the
// whole selection goes out in one unified send (queued as a durable batch when the
// selection is larger than one, so the request never hangs on per-recipient sends).
const buildStepTitles = (t: TFunction): string[] => [
    t('steps.selectTemplate'),
    t('steps.mapVariables'),
    t('steps.reviewSend'),
];

// Student fields a template variable can be mapped to, resolved per recipient. Username and
// password come from the recipient's auth-service credentials only — the login checks against
// that row, so no other field is used as a stand-in.
const buildSystemFields = (
    t: TFunction
): Array<{
    value: string;
    label: string;
    resolve: (s: StudentTable, creds?: StudentCredentialsType) => string;
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

// Credentials are read in pages with a pause between them, so a large selection does not fire
// one burst of requests at auth-service.
const CREDENTIALS_PAGE_SIZE = 100;
const CREDENTIALS_PAGE_PAUSE_MS = 300;

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

export const SendMessageDialog = () => {
    const { t } = useTranslation('manageStudentsSendMessageDialog');
    const { isSendMessageOpen, bulkActionInfo, selectedStudent, isBulkAction, closeAllDialogs } =
        useDialogStore();

    const instituteId = getCurrentInstituteId() || '';

    const STEP_TITLES = useMemo(() => buildStepTitles(t), [t]);
    const SYSTEM_FIELDS = useMemo(() => buildSystemFields(t), [t]);

    // Step
    const [step, setStep] = useState(1);

    // Template selection state
    const [templates, setTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateDTO | null>(null);
    const [languageCode, setLanguageCode] = useState('en');

    // Custom field setup (to offer named custom-field mappings)
    const [customFieldSetup, setCustomFieldSetup] = useState<CustomFieldSetupItem[]>([]);

    // Variable mapping: varKey -> "system:..." | "custom:<fieldId>" | "static:<text>"
    const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});

    // Recipients' portal credentials, keyed by user_id. Only fetched once a variable is mapped to
    // username or password.
    const [credentialsByUser, setCredentialsByUser] = useState<
        Record<string, StudentCredentialsType>
    >({});
    const [credentialsLoading, setCredentialsLoading] = useState(false);
    const [credentialsFailed, setCredentialsFailed] = useState(false);
    const [credentialsProgress, setCredentialsProgress] = useState({ done: 0, total: 0 });

    // Send state
    const [isSending, setIsSending] = useState(false);
    const [sendResult, setSendResult] = useState<UnifiedSendResponse | null>(null);

    // -----------------------------------------------------------------------
    // Recipients (only students that actually have a mobile number)
    // -----------------------------------------------------------------------
    const selectedStudents = useMemo<StudentTable[]>(() => {
        if (isBulkAction) return bulkActionInfo?.selectedStudents || [];
        return selectedStudent ? [selectedStudent] : [];
    }, [isBulkAction, bulkActionInfo, selectedStudent]);

    const recipients = useMemo(
        () => selectedStudents.filter((student) => student.mobile_number),
        [selectedStudents]
    );

    const skippedCount = selectedStudents.length - recipients.length;

    // -----------------------------------------------------------------------
    // Reset every time the dialog opens
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (isSendMessageOpen) {
            setStep(1);
            setSelectedTemplate(null);
            setLanguageCode('en');
            setVariableMapping({});
            setCredentialsByUser({});
            setCredentialsFailed(false);
            setIsSending(false);
            setSendResult(null);
        }
    }, [isSendMessageOpen]);

    // -----------------------------------------------------------------------
    // Load approved WhatsApp templates when the dialog opens
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!isSendMessageOpen || !instituteId) return;
        let cancelled = false;
        setLoadingTemplates(true);
        listTemplates(instituteId)
            .then((data) => {
                if (!cancelled) setTemplates(data);
            })
            .catch(() => {
                if (!cancelled) toast.error(t('toasts.loadTemplatesFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoadingTemplates(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isSendMessageOpen, instituteId, t]);

    // Load custom field setup once per open (non-fatal if it fails)
    useEffect(() => {
        if (!isSendMessageOpen || !instituteId) return;
        let cancelled = false;
        fetchCustomFieldSetup(instituteId)
            .then((data) => {
                if (!cancelled) setCustomFieldSetup(data);
            })
            .catch(() => {
                /* mapper simply won't offer custom fields */
            });
        return () => {
            cancelled = true;
        };
    }, [isSendMessageOpen, instituteId]);

    const approvedTemplates = useMemo(
        () => templates.filter((tpl) => tpl.status === 'APPROVED'),
        [templates]
    );

    const handleTemplateSelect = useCallback(
        (templateName: string) => {
            const tpl = approvedTemplates.find((x) => x.name === templateName) ?? null;
            setSelectedTemplate(tpl);
            if (tpl?.language) setLanguageCode(tpl.language);
            setVariableMapping({});
        },
        [approvedTemplates]
    );

    // -----------------------------------------------------------------------
    // Variables to map (template-declared names first, else body placeholders)
    // -----------------------------------------------------------------------
    const variableKeys = useMemo<string[]>(() => {
        if (!selectedTemplate) return [];
        if (selectedTemplate.bodyVariableNames?.length) {
            return selectedTemplate.bodyVariableNames;
        }
        return extractPlaceholders(selectedTemplate.bodyText ?? '');
    }, [selectedTemplate]);

    // Auto-map recognizable variables when they first appear
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

    const mappingOptions = useMemo(() => {
        const customs = customFieldSetup
            .filter((f) => !f.is_hidden)
            .map((f) => ({
                value: `custom:${f.custom_field_id}`,
                label: f.field_name || f.field_key,
            }));
        const all = [...SYSTEM_FIELDS.map((f) => ({ value: f.value, label: f.label })), ...customs];
        // The searchable list matches and highlights by label, so two custom fields sharing a
        // name would act as one row. Number the repeats to keep every option distinct.
        const seen: Record<string, number> = {};
        return all.map((o) => {
            const n = (seen[o.label] ?? 0) + 1;
            seen[o.label] = n;
            return n > 1 ? { ...o, label: `${o.label} (${n})` } : o;
        });
    }, [customFieldSetup, SYSTEM_FIELDS]);

    const usesUsername = Object.values(variableMapping).includes('system:username');
    const usesPassword = Object.values(variableMapping).includes('system:password');
    const needsCredentials = usesUsername || usesPassword;

    useEffect(() => {
        if (!isSendMessageOpen || !needsCredentials) return;
        const userIds = [...new Set(recipients.map((s) => s.user_id).filter(Boolean))];
        if (userIds.length === 0) return;
        let cancelled = false;
        setCredentialsLoading(true);
        setCredentialsFailed(false);
        setCredentialsProgress({ done: 0, total: userIds.length });
        (async () => {
            const found: Record<string, StudentCredentialsType> = {};
            try {
                for (let i = 0; i < userIds.length; i += CREDENTIALS_PAGE_SIZE) {
                    if (i > 0) {
                        await new Promise((r) => setTimeout(r, CREDENTIALS_PAGE_PAUSE_MS));
                    }
                    if (cancelled) return;
                    const page = userIds.slice(i, i + CREDENTIALS_PAGE_SIZE);
                    const res = await authenticatedAxiosInstance.post<StudentCredentialsType[]>(
                        USERS_CREDENTIALS,
                        page
                    );
                    // Keyed by the user_id the server returns, never by position: the endpoint
                    // leaves out users the caller may not view, so rows do not line up with ids.
                    for (const c of Array.isArray(res.data) ? res.data : []) {
                        if (c?.user_id) found[c.user_id] = c;
                    }
                    if (cancelled) return;
                    setCredentialsProgress({
                        done: Math.min(i + CREDENTIALS_PAGE_SIZE, userIds.length),
                        total: userIds.length,
                    });
                }
                setCredentialsByUser(found);
            } catch {
                if (!cancelled) setCredentialsFailed(true);
            } finally {
                if (!cancelled) setCredentialsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
            setCredentialsLoading(false);
        };
    }, [isSendMessageOpen, needsCredentials, recipients]);

    // A blank username/password variable is rejected by WhatsApp, so recipients without the
    // credential a mapping needs are left out of the send and counted instead.
    const sendableRecipients = useMemo(() => {
        if (!needsCredentials) return recipients;
        return recipients.filter((s) => {
            const c = credentialsByUser[s.user_id];
            return (!usesUsername || !!c?.username) && (!usesPassword || !!c?.password);
        });
    }, [needsCredentials, usesUsername, usesPassword, recipients, credentialsByUser]);

    const credentialsReady = !needsCredentials || (!credentialsLoading && !credentialsFailed);
    const missingCredentialsCount = credentialsReady
        ? recipients.length - sendableRecipients.length
        : 0;

    // Resolve one variable for one student
    const resolveValue = useCallback(
        (varKey: string, student: StudentTable): string => {
            const mapping = variableMapping[varKey];
            if (!mapping) return '';
            if (mapping.startsWith('static:')) return mapping.slice('static:'.length);
            if (mapping.startsWith('system:')) {
                const sys = SYSTEM_FIELDS.find((f) => f.value === mapping);
                return sys?.resolve(student, credentialsByUser[student.user_id]) ?? '';
            }
            if (mapping.startsWith('custom:')) {
                const fieldId = mapping.slice('custom:'.length);
                return student.custom_fields?.[fieldId] ?? '';
            }
            return '';
        },
        [variableMapping, SYSTEM_FIELDS, credentialsByUser]
    );

    const handleMappingChange = useCallback((varKey: string, fieldValue: string) => {
        setVariableMapping((prev) => ({ ...prev, [varKey]: fieldValue }));
    }, []);

    // -----------------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------------
    const canProceed = useMemo(() => {
        switch (step) {
            case 1:
                return selectedTemplate !== null && recipients.length > 0;
            case 2:
                // A "Static value…" row left empty would send an empty WhatsApp
                // variable, which the provider rejects — block until filled.
                return (
                    !Object.values(variableMapping).some((v) => v === 'static:') &&
                    credentialsReady &&
                    sendableRecipients.length > 0
                );
            default:
                return true;
        }
    }, [
        step,
        selectedTemplate,
        recipients.length,
        variableMapping,
        credentialsReady,
        sendableRecipients.length,
    ]);

    const handleClose = useCallback(
        (open: boolean) => {
            if (open) return;
            if (isSending) return; // don't allow closing mid-send
            closeAllDialogs();
        },
        [isSending, closeAllDialogs]
    );

    // -----------------------------------------------------------------------
    // Send
    // -----------------------------------------------------------------------
    const handleSend = useCallback(async () => {
        if (!selectedTemplate) {
            toast.error(t('toasts.selectTemplateFirst'));
            return;
        }
        if (sendableRecipients.length === 0) {
            toast.error(t('toasts.noValidRecipients'));
            return;
        }
        setIsSending(true);
        try {
            let result = await sendNotification({
                instituteId,
                channel: 'WHATSAPP',
                templateName: selectedTemplate.name,
                languageCode: languageCode || selectedTemplate.language || 'en',
                recipients: sendableRecipients.map((student) => {
                    const variables: Record<string, string> = {};
                    for (const k of variableKeys) {
                        variables[k] = resolveValue(k, student);
                    }
                    return {
                        phone: student.mobile_number,
                        userId: student.user_id,
                        name: student.full_name,
                        variables,
                    };
                }),
                // Multi-recipient sends run as a durable server-side batch so the
                // request returns immediately instead of timing out mid-send.
                forceAsync: sendableRecipients.length > 1,
                options: {
                    source: 'STUDENT_MANAGEMENT_BULK_WHATSAPP',
                    sourceId: uuidv4(),
                },
            });

            if (result.batchId && result.status === 'PROCESSING') {
                try {
                    result = await waitForBatchCompletion(result.batchId, (progress) =>
                        setSendResult(progress)
                    );
                } catch {
                    // Polling timed out; the batch keeps running server-side.
                }
            }

            setSendResult(result);
            // A batch routinely comes back partially failed (Meta throttling, invalid numbers,
            // 24h-window rules). Reporting a flat "sent" for those is how a bulk send quietly
            // misses people — report the split. "Accepted" is also the honest word: it means
            // WhatsApp took the message, not that it reached the handset.
            const failedCount = result.failed ?? 0;
            const acceptedCount = result.accepted ?? 0;
            const totalCount = result.total ?? sendableRecipients.length;
            if (result.status === 'FAILED' || acceptedCount === 0) {
                toast.error(t('toasts.sendFailed'));
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
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('toasts.unexpectedError'));
        } finally {
            setIsSending(false);
        }
    }, [
        selectedTemplate,
        sendableRecipients,
        instituteId,
        languageCode,
        variableKeys,
        resolveValue,
        t,
    ]);

    // -----------------------------------------------------------------------
    // Step indicator
    // -----------------------------------------------------------------------
    const renderStepIndicator = () => (
        <div className="mb-6 flex w-full min-w-0 items-center gap-2 overflow-hidden">
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
                                className={`h-px min-w-2 flex-1 ${isDone ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                            />
                        )}
                        <div
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                                isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : isDone
                                      ? 'bg-primary/20 text-primary'
                                      : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {isDone ? <CheckCircle className="size-3.5" /> : stepNum}
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

    // -----------------------------------------------------------------------
    // Step 1: template selection
    // -----------------------------------------------------------------------
    const renderTemplateStep = () => (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>{t('templateStep.templateLabel')}</Label>
                {loadingTemplates ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('templateStep.loadingTemplates')}
                    </div>
                ) : (
                    <TemplateSearchableSelect
                        options={toTemplateOptions(approvedTemplates)}
                        value={selectedTemplate?.name ?? ''}
                        onChange={handleTemplateSelect}
                        placeholder={t('templateStep.selectPlaceholder')}
                        emptyText={t('templateStep.emptyText')}
                        // Inside a Radix Dialog: react-remove-scroll blocks scrolling on
                        // portalled nodes, so the list must render inline.
                        portal={false}
                    />
                )}
                {!loadingTemplates && approvedTemplates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        {t('templateStep.noTemplatesFound')}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Label>{t('templateStep.languageCodeLabel')}</Label>
                <Input
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    placeholder="en"
                    className="w-32"
                />
            </div>

            {selectedTemplate && (
                <div className="space-y-2">
                    <Label>{t('templateStep.templatePreviewLabel')}</Label>
                    <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm">
                        {selectedTemplate.bodyText}
                    </div>
                </div>
            )}

            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
                <span className="font-medium text-foreground">
                    {t('templateStep.recipientsNotice', { count: recipients.length })}
                </span>
                {skippedCount > 0 && (
                    <span className="text-muted-foreground">
                        {' '}
                        {t('templateStep.skippedNotice', { count: skippedCount })}
                    </span>
                )}
            </div>
        </div>
    );

    // -----------------------------------------------------------------------
    // Step 2: variable mapping
    // -----------------------------------------------------------------------
    const renderVariableMapping = () => {
        if (variableKeys.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                    <CheckCircle className="size-8" />
                    <p className="text-sm">{t('variableMappingStep.noVariables')}</p>
                </div>
            );
        }

        return (
            <div className="space-y-1">
                <p className="mb-3 text-sm text-muted-foreground">
                    {t('variableMappingStep.mapHint')}
                </p>
                <div className="rounded-md border">
                    <div className="grid grid-cols-2 gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
                        <span>{t('variableMappingStep.columnVariable')}</span>
                        <span>{t('variableMappingStep.columnMappedField')}</span>
                    </div>
                    {variableKeys.map((varKey) => {
                        const currentValue = variableMapping[varKey] ?? '';
                        const isStatic = currentValue.startsWith('static:');
                        const selectValue = isStatic ? '__static__' : currentValue;
                        const staticText = isStatic
                            ? currentValue.substring('static:'.length)
                            : '';

                        return (
                            <div
                                key={varKey}
                                className="grid grid-cols-2 items-center gap-4 border-b px-4 py-2 last:border-b-0"
                            >
                                <span className="rounded bg-muted px-2 py-1 font-mono text-sm">
                                    {`{{${varKey}}}`}
                                </span>
                                <div className="flex flex-col gap-2">
                                    <SearchableSelect
                                        options={[
                                            {
                                                value: '__static__',
                                                label: t('variableMappingStep.staticValueOption'),
                                            },
                                            ...mappingOptions,
                                        ]}
                                        value={selectValue}
                                        onChange={(val) =>
                                            handleMappingChange(
                                                varKey,
                                                val === '__static__' ? 'static:' : val
                                            )
                                        }
                                        placeholder={t(
                                            'variableMappingStep.selectFieldPlaceholder'
                                        )}
                                        searchPlaceholder={t(
                                            'variableMappingStep.searchPlaceholder'
                                        )}
                                        emptyText={t('variableMappingStep.noMatch')}
                                        portal={false}
                                    />
                                    {isStatic && (
                                        <Input
                                            value={staticText}
                                            onChange={(e) =>
                                                handleMappingChange(
                                                    varKey,
                                                    `static:${e.target.value}`
                                                )
                                            }
                                            placeholder={t(
                                                'variableMappingStep.staticValuePlaceholder'
                                            )}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {needsCredentials && (
                    <p
                        className={`pt-2 text-xs ${
                            credentialsFailed || missingCredentialsCount > 0
                                ? 'text-danger-600'
                                : 'text-muted-foreground'
                        }`}
                    >
                        {credentialsLoading ? (
                            <span className="flex items-center gap-1.5">
                                <CircleNotch className="size-3.5 animate-spin" />
                                {t('variableMappingStep.credentialsLoading', credentialsProgress)}
                            </span>
                        ) : credentialsFailed ? (
                            t('variableMappingStep.credentialsFailed')
                        ) : missingCredentialsCount > 0 ? (
                            t('variableMappingStep.credentialsMissing', {
                                count: missingCredentialsCount,
                            })
                        ) : (
                            t('variableMappingStep.credentialsReady', {
                                count: sendableRecipients.length,
                            })
                        )}
                    </p>
                )}
            </div>
        );
    };

    // -----------------------------------------------------------------------
    // Step 3: review / result
    // -----------------------------------------------------------------------
    const renderReview = () => {
        // One real recipient's resolved values, so the admin can see exactly what lands in each
        // placeholder (e.g. that {{4}} carries the username and {{6}} the password) before sending.
        const sampleRecipient = sendableRecipients[0];
        if (sendResult && !isSending) {
            const failed = sendResult.failed ?? 0;
            const isSuccess = sendResult.status !== 'FAILED' && failed === 0;
            const failedResults = (sendResult.results ?? []).filter((r) => !r.success);
            return (
                <div className="flex flex-col items-center gap-4 py-8">
                    {isSuccess ? (
                        <CheckCircle className="size-12 text-success-500" />
                    ) : (
                        <XCircle className="size-12 text-danger-500" />
                    )}
                    <h3 className="text-lg font-semibold">
                        {isSuccess ? t('reviewStep.messagesSent') : t('reviewStep.sendCompleted')}
                    </h3>
                    <div className="w-full max-w-sm space-y-2 rounded-md border p-4 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.recipientsLabel')}
                            </span>
                            <span className="font-medium">{sendResult.total}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.sentLabel')}
                            </span>
                            <span className="font-medium text-success-600">
                                {sendResult.accepted}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.failedLabel')}
                            </span>
                            <span className="font-medium text-danger-600">{failed}</span>
                        </div>
                        {sendResult.status === 'PROCESSING' && (
                            <p className="text-xs text-muted-foreground">
                                {t('reviewStep.stillProcessing')}
                            </p>
                        )}
                    </div>
                    {failedResults.length > 0 && (
                        <div className="max-h-32 w-full max-w-sm space-y-1 overflow-auto rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                            {failedResults.slice(0, 10).map((r, idx) => (
                                <div key={`${r.phone}-${idx}`}>
                                    <span className="font-medium text-foreground">{r.phone}</span>
                                    : {r.error || r.status}
                                </div>
                            ))}
                        </div>
                    )}
                    <Button variant="outline" onClick={() => closeAllDialogs()} className="mt-2">
                        {t('reviewStep.close')}
                    </Button>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-center gap-3">
                        <WhatsappLogo className="size-5 text-primary" />
                        <div>
                            <p className="text-sm font-semibold">
                                {t('reviewStep.channelLabel')}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {t('reviewStep.channelHeading')}
                            </p>
                        </div>
                    </div>
                    <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                            {t('reviewStep.templateLabel')}
                        </p>
                        <p className="text-sm font-medium">{selectedTemplate?.name || '-'}</p>
                    </div>
                    <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                            {t('reviewStep.recipientsLabel')}
                        </p>
                        <p className="text-sm font-medium">
                            {t('reviewStep.selectedStudentsCount', {
                                count: sendableRecipients.length,
                            })}
                            {skippedCount > 0 && (
                                <span className="text-muted-foreground">
                                    {' '}
                                    {t('templateStep.skippedNotice', { count: skippedCount })}
                                </span>
                            )}
                            {missingCredentialsCount > 0 && (
                                <span className="text-muted-foreground">
                                    {' '}
                                    {t('variableMappingStep.credentialsMissing', {
                                        count: missingCredentialsCount,
                                    })}
                                </span>
                            )}
                        </p>
                    </div>
                    {variableKeys.some((k) => variableMapping[k]) && (
                        <div className="border-t pt-3">
                            <p className="mb-2 text-xs text-muted-foreground">
                                {t('reviewStep.variableMappingsLabel')}
                                {sampleRecipient &&
                                    ` · ${t('reviewStep.sampleFor', {
                                        name:
                                            sampleRecipient.full_name ||
                                            sampleRecipient.mobile_number,
                                    })}`}
                            </p>
                            <div className="space-y-1">
                                {variableKeys
                                    .filter((k) => variableMapping[k])
                                    .map((varKey) => {
                                        const mapped = variableMapping[varKey] ?? '';
                                        const label = mapped.startsWith('static:')
                                            ? t('reviewStep.staticValueLabel', {
                                                  value: mapped.slice('static:'.length),
                                              })
                                            : (mappingOptions.find((o) => o.value === mapped)
                                                  ?.label ?? mapped);
                                        return (
                                            <div
                                                key={varKey}
                                                className="flex items-center gap-2 text-xs"
                                            >
                                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                                    {`{{${varKey}}}`}
                                                </span>
                                                <CaretRight className="size-3 text-muted-foreground" />
                                                <span>{label}</span>
                                                {sampleRecipient && (
                                                    <span className="min-w-0 truncate font-mono text-muted-foreground">
                                                        ={' '}
                                                        {resolveValue(varKey, sampleRecipient) ||
                                                            '—'}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}
                </div>

                <Button className="w-full" onClick={handleSend} disabled={isSending}>
                    {isSending ? (
                        <>
                            <CircleNotch className="mr-2 size-4 animate-spin" />
                            {t('reviewStep.sending')}
                        </>
                    ) : (
                        <>
                            <PaperPlaneTilt className="mr-2 size-4" />
                            {t('reviewStep.sendButton', { count: sendableRecipients.length })}
                        </>
                    )}
                </Button>
            </div>
        );
    };

    return (
        <Dialog open={isSendMessageOpen} onOpenChange={handleClose}>
            <DialogContent className="max-h-screen w-full overflow-y-auto overflow-x-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('dialogTitle')}</DialogTitle>
                    <DialogDescription>{t('dialogDescription')}</DialogDescription>
                </DialogHeader>

                {renderStepIndicator()}

                {step === 1 && renderTemplateStep()}
                {step === 2 && renderVariableMapping()}
                {step === 3 && renderReview()}

                {/* Footer navigation (hidden once a result is shown) */}
                {!sendResult && (
                    <div className="mt-6 flex items-center justify-between">
                        <div>
                            {step > 1 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setStep((s) => s - 1)}
                                    disabled={isSending}
                                >
                                    <CaretLeft className="mr-1 size-4" />
                                    {t('footer.back')}
                                </Button>
                            )}
                        </div>
                        <div>
                            {step < 3 && (
                                <Button
                                    size="sm"
                                    onClick={() => setStep((s) => s + 1)}
                                    disabled={!canProceed}
                                >
                                    {t('footer.next')}
                                    <CaretRight className="ml-1 size-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
