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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Envelope,
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
import { getMessageTemplates, getMessageTemplate } from '@/services/message-template-service';
import type { MessageTemplate } from '@/types/message-template-types';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';
import { bulkEmailService, type BulkEmailResult } from '@/services/bulkEmailService';
import { useDialogStore } from '../../../../-hooks/useDialogStore';

// Multi-step compose flow modelled on the audience-manager SendMessageDialog, but
// email-only and wired to bulkEmailService so it targets the *selected* students
// (with automatic per-student variable enrichment) rather than a saved audience.
const buildStepTitles = (t: TFunction): string[] => [
    t('steps.composeEmail'),
    t('steps.mapVariables'),
    t('steps.reviewSend'),
];

// Student fields a {{placeholder}} can be mapped to. The value after `field:` is the
// canonical variable name that bulkEmailService auto-resolves per recipient on send.
const buildStudentFields = (t: TFunction): { value: string; label: string }[] => [
    { value: 'field:name', label: t('studentFields.fullName') },
    { value: 'field:email', label: t('studentFields.email') },
    { value: 'field:mobile_number', label: t('studentFields.mobileNumber') },
    { value: 'field:username', label: t('studentFields.username') },
    { value: 'field:enrollment_number', label: t('studentFields.enrollmentNumber') },
    { value: 'field:registration_date', label: t('studentFields.registrationDate') },
    { value: 'field:student_referral_code', label: t('studentFields.referralCode') },
    { value: 'field:course_name', label: t('studentFields.courseName') },
    { value: 'field:batch_name', label: t('studentFields.batchName') },
    { value: 'field:batch_start_date', label: t('studentFields.batchStartDate') },
    { value: 'field:batch_end_date', label: t('studentFields.batchEndDate') },
    { value: 'field:institute_name', label: t('studentFields.instituteName') },
    { value: 'field:institute_email', label: t('studentFields.instituteEmail') },
    { value: 'field:institute_phone', label: t('studentFields.institutePhone') },
    { value: 'field:attendance_percentage', label: t('studentFields.attendancePercentage') },
    { value: 'field:attendance_attended_classes', label: t('studentFields.classesAttended') },
    { value: 'field:attendance_total_classes', label: t('studentFields.totalClasses') },
    { value: 'field:current_date', label: t('studentFields.currentDate') },
    { value: 'field:support_email', label: t('studentFields.supportEmail') },
];

// Pull unique {{placeholder}} keys out of a string.
function extractPlaceholders(text: string): string[] {
    const matches = text.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '')))];
}

// Rewrite a template by applying the variable mapping:
//  - field:<var>  -> {{<var>}}  (a canonical name bulkEmailService resolves per student)
//  - static:<txt> -> the literal text
//  - unmapped     -> left as-is (standard names like {{name}} still auto-resolve)
function applyMapping(text: string, mapping: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (full, key) => {
        const v = mapping[key];
        if (!v) return full;
        if (v.startsWith('static:')) return v.slice('static:'.length);
        if (v.startsWith('field:')) return `{{${v.slice('field:'.length)}}}`;
        return full;
    });
}

export const SendEmailDialog = () => {
    const { t } = useTranslation('manageStudentsSendEmailDialogList');
    const { isSendEmailOpen, bulkActionInfo, selectedStudent, isBulkAction, closeAllDialogs } =
        useDialogStore();

    const STEP_TITLES = useMemo(() => buildStepTitles(t), [t]);
    const STUDENT_FIELDS = useMemo(() => buildStudentFields(t), [t]);

    const fieldLabel = useCallback(
        (val: string): string => {
            if (val.startsWith('static:')) {
                return t('reviewStep.staticValueLabel', { value: val.slice('static:'.length) });
            }
            return STUDENT_FIELDS.find((o) => o.value === val)?.label ?? val;
        },
        [STUDENT_FIELDS, t]
    );

    // Step
    const [step, setStep] = useState(1);

    // Compose state
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [bodyView, setBodyView] = useState<'preview' | 'edit'>('edit');

    // Template selection state
    const [templates, setTemplates] = useState<MessageTemplate[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('custom');
    const [loadingTemplateContent, setLoadingTemplateContent] = useState(false);

    // Variable mapping ({{placeholder}} -> field:<var> | static:<text>)
    const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});

    // Send state
    const [isSending, setIsSending] = useState(false);
    const [sendResult, setSendResult] = useState<BulkEmailResult | null>(null);

    // Placeholders present across subject + body (drives the mapping step)
    const variableKeys = useMemo(
        () => extractPlaceholders(`${subject} ${body}`),
        [subject, body]
    );

    const handleMappingChange = useCallback((varKey: string, fieldValue: string) => {
        setVariableMapping((prev) => ({ ...prev, [varKey]: fieldValue }));
    }, []);

    // -----------------------------------------------------------------------
    // Recipients (only students that actually have an email address)
    // -----------------------------------------------------------------------
    const recipients = useMemo(() => {
        const students = isBulkAction
            ? bulkActionInfo?.selectedStudents || []
            : selectedStudent
              ? [selectedStudent]
              : [];
        return students.filter((student) => student.email);
    }, [isBulkAction, bulkActionInfo, selectedStudent]);

    const skippedCount = useMemo(() => {
        const total = isBulkAction
            ? bulkActionInfo?.selectedStudents?.length || 0
            : selectedStudent
              ? 1
              : 0;
        return Math.max(0, total - recipients.length);
    }, [isBulkAction, bulkActionInfo, selectedStudent, recipients.length]);

    // -----------------------------------------------------------------------
    // Reset every time the dialog opens
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (isSendEmailOpen) {
            setStep(1);
            setSubject('');
            setBody('');
            setBodyView('edit');
            setSelectedTemplateId('custom');
            setLoadingTemplateContent(false);
            setVariableMapping({});
            setIsSending(false);
            setSendResult(null);
        }
    }, [isSendEmailOpen]);

    // -----------------------------------------------------------------------
    // Load saved email templates when the dialog opens
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!isSendEmailOpen) return;
        let cancelled = false;
        setLoadingTemplates(true);
        getMessageTemplates('EMAIL', 0, 100)
            .then((res) => {
                if (!cancelled) setTemplates(res.templates);
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
    }, [isSendEmailOpen, t]);

    // -----------------------------------------------------------------------
    // Apply a saved template (load full content -> prefill subject + body)
    // -----------------------------------------------------------------------
    const handleTemplateSelect = useCallback(
        async (templateId: string) => {
            setSelectedTemplateId(templateId);
            // Placeholders change with the template, so drop any prior mapping.
            setVariableMapping({});

            if (templateId === 'custom') {
                setSubject('');
                setBody('');
                setBodyView('edit');
                return;
            }

            setLoadingTemplateContent(true);
            try {
                const full = await getMessageTemplate(templateId);
                setSubject(full.subject ?? '');
                setBody(full.content ?? '');
                // Default to the rendered preview when a saved template loads.
                setBodyView('preview');
            } catch {
                toast.error(t('toasts.templateContentFailed'));
            } finally {
                setLoadingTemplateContent(false);
            }
        },
        [t]
    );

    // -----------------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------------
    const canProceed = useMemo(() => {
        switch (step) {
            case 1:
                return subject.trim() !== '' && body.trim() !== '' && recipients.length > 0;
            case 2:
                // Mapping is optional, but a "Static value…" row left empty would send a
                // blank — block until the user types something (or picks a field).
                return !Object.values(variableMapping).some((v) => v === 'static:');
            default:
                return true;
        }
    }, [step, subject, body, recipients.length, variableMapping]);

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
        if (recipients.length === 0) {
            toast.error(t('toasts.noValidRecipients'));
            return;
        }
        setIsSending(true);
        try {
            // Resolve mapped placeholders to canonical variables / static text first.
            const finalSubject = applyMapping(subject, variableMapping).trim();
            const finalBody = applyMapping(body, variableMapping).trim();
            const result = await bulkEmailService.sendBulkEmail({
                template: finalBody,
                subject: finalSubject,
                students: recipients,
                context: 'student-management',
                notificationType: 'EMAIL',
                source: 'STUDENT_MANAGEMENT_BULK_EMAIL',
                sourceId: uuidv4(),
                enrichmentOptions: {
                    includeCourse: true,
                    includeBatch: true,
                    includeInstitute: true,
                    includeAttendance: true,
                    includeLiveClass: true,
                    includeReferral: true,
                    includeCustomFields: true,
                },
            });
            setSendResult(result);
            if (result.success) {
                toast.success(t('toasts.sendSuccess'));
            } else {
                const validationError = result.errors?.find((e) => e.studentId === 'validation');
                toast.error(validationError?.error ?? t('toasts.sendFailed'));
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('toasts.unexpectedError'));
        } finally {
            setIsSending(false);
        }
    }, [recipients, body, subject, variableMapping, t]);

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
    // Step 1: compose
    // -----------------------------------------------------------------------
    const renderCompose = () => (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>{t('composeStep.templateLabel')}</Label>
                {loadingTemplates ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('composeStep.loadingTemplates')}
                    </div>
                ) : (
                    <TemplateSearchableSelect
                        options={toTemplateOptions(templates, 'id')}
                        value={selectedTemplateId}
                        onChange={handleTemplateSelect}
                        placeholder={t('composeStep.selectPlaceholder')}
                        emptyText={t('composeStep.emptyText')}
                        noneOption={{ value: 'custom', label: t('composeStep.noneOptionLabel') }}
                        disabled={loadingTemplateContent}
                        portal={false}
                    />
                )}
                {loadingTemplateContent && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CircleNotch className="size-3 animate-spin" />
                        {t('composeStep.loadingTemplateContent')}
                    </div>
                )}
            </div>

            <div className="space-y-2">
                <Label>{t('composeStep.subjectLabel')}</Label>
                <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t('composeStep.subjectPlaceholder')}
                />
            </div>

            <div className="space-y-2">
                <Label>{t('composeStep.bodyLabel')}</Label>
                <Tabs
                    value={bodyView}
                    onValueChange={(v) => setBodyView(v as 'preview' | 'edit')}
                    className="w-full"
                >
                    <TabsList className="grid w-fit grid-cols-2">
                        <TabsTrigger value="preview">{t('composeStep.previewTab')}</TabsTrigger>
                        <TabsTrigger value="edit">{t('composeStep.editTab')}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview" className="mt-2">
                        {body.trim() ? (
                            <div
                                className="max-h-96 min-h-64 overflow-auto rounded-md border bg-white p-4 text-sm text-neutral-900"
                                dangerouslySetInnerHTML={{ __html: body }}
                            />
                        ) : (
                            <div className="flex min-h-64 items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground">
                                {t('composeStep.previewEmptyState')}
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="edit" className="mt-2">
                        <Textarea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            placeholder={t('composeStep.bodyPlaceholder', {
                                example: '{{variable}}',
                            })}
                            className="min-h-64 font-mono text-sm"
                        />
                    </TabsContent>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                    {t('composeStep.placeholderHintPrefix')}{' '}
                    <code className="font-mono">{'{{name}}'}</code>{' '}
                    {t('composeStep.placeholderHintSuffix')}
                </p>
            </div>

            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
                <span className="font-medium text-foreground">
                    {t('composeStep.recipientsNotice', { count: recipients.length })}
                </span>
                {skippedCount > 0 && (
                    <span className="text-muted-foreground">
                        {' '}
                        {t('composeStep.skippedNotice', { count: skippedCount })}
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
                    {t('variableMappingStep.mapHintPrefix')}{' '}
                    <code className="font-mono">{'{{name}}'}</code>
                    {t('variableMappingStep.mapHintSuffix')}
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
                                    <Select
                                        value={selectValue}
                                        onValueChange={(val) =>
                                            handleMappingChange(
                                                varKey,
                                                val === '__static__' ? 'static:' : val
                                            )
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue
                                                placeholder={t(
                                                    'variableMappingStep.selectFieldPlaceholder'
                                                )}
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__static__">
                                                {t('variableMappingStep.staticValueOption')}
                                            </SelectItem>
                                            {STUDENT_FIELDS.map((opt) => (
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
            </div>
        );
    };

    // -----------------------------------------------------------------------
    // Step 3: review / result
    // -----------------------------------------------------------------------
    const renderReview = () => {
        if (sendResult) {
            // totalStudents = all recipients; failedStudents already includes both
            // hard failures and pre-send skips, so "sent" is simply total - failed.
            const sent = Math.max(0, sendResult.totalStudents - sendResult.failedStudents);
            const isSuccess = sendResult.success && sendResult.failedStudents === 0;
            return (
                <div className="flex flex-col items-center gap-4 py-8">
                    {isSuccess ? (
                        <CheckCircle className="size-12 text-success-500" />
                    ) : (
                        <XCircle className="size-12 text-danger-500" />
                    )}
                    <h3 className="text-lg font-semibold">
                        {isSuccess ? t('reviewStep.emailSent') : t('reviewStep.sendCompleted')}
                    </h3>
                    <div className="w-full max-w-sm space-y-2 rounded-md border p-4 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.recipientsLabel')}
                            </span>
                            <span className="font-medium">{sendResult.totalStudents}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.sentLabel')}
                            </span>
                            <span className="font-medium text-success-600">{sent}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                {t('reviewStep.failedLabel')}
                            </span>
                            <span className="font-medium text-danger-600">
                                {sendResult.failedStudents}
                            </span>
                        </div>
                    </div>
                    {sendResult.errors && sendResult.errors.length > 0 && (
                        <div className="max-h-32 w-full max-w-sm space-y-1 overflow-auto rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                            {sendResult.errors.slice(0, 10).map((e, idx) => (
                                <div key={`${e.studentId}-${idx}`}>
                                    <span className="font-medium text-foreground">
                                        {e.studentName || e.studentId}
                                    </span>
                                    : {e.error}
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
                        <Envelope className="size-5 text-primary" />
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
                            {t('reviewStep.subjectLabel')}
                        </p>
                        <p className="text-sm font-medium">{subject || '-'}</p>
                    </div>
                    <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                            {t('reviewStep.recipientsLabel')}
                        </p>
                        <p className="text-sm font-medium">
                            {t('reviewStep.selectedStudentsCount', { count: recipients.length })}
                            {skippedCount > 0 && (
                                <span className="text-muted-foreground">
                                    {' '}
                                    {t('reviewStep.skippedNotice', { count: skippedCount })}
                                </span>
                            )}
                        </p>
                    </div>
                    {variableKeys.some((k) => variableMapping[k]) && (
                        <div className="border-t pt-3">
                            <p className="mb-2 text-xs text-muted-foreground">
                                {t('reviewStep.variableMappingsLabel')}
                            </p>
                            <div className="space-y-1">
                                {variableKeys
                                    .filter((k) => variableMapping[k])
                                    .map((varKey) => (
                                        <div
                                            key={varKey}
                                            className="flex items-center gap-2 text-xs"
                                        >
                                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                                {`{{${varKey}}}`}
                                            </span>
                                            <CaretRight className="size-3 text-muted-foreground" />
                                            <span>{fieldLabel(variableMapping[varKey] ?? '')}</span>
                                        </div>
                                    ))}
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
                            {t('reviewStep.sendButton', { count: recipients.length })}
                        </>
                    )}
                </Button>
            </div>
        );
    };

    return (
        <Dialog open={isSendEmailOpen} onOpenChange={handleClose}>
            <DialogContent className="max-h-screen w-full overflow-y-auto overflow-x-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('dialogTitle')}</DialogTitle>
                    <DialogDescription>{t('dialogDescription')}</DialogDescription>
                </DialogHeader>

                {renderStepIndicator()}

                {step === 1 && renderCompose()}
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
