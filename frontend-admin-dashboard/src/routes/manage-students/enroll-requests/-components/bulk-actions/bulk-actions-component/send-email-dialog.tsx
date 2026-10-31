import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { PaperPlaneTilt, Spinner, Eye } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useEnrollRequestsDialogStore } from '../bulk-actions-store';
import { bulkEmailService, type BulkEmailResult } from '@/services/bulkEmailService';

// Define email templates. The subject/content strings contain the app's own
// {{placeholder}} tokens (resolved later by bulkEmailService's per-student
// resolver, not by i18next) — each is translated with an identity
// interpolation value so the token text survives translation unchanged.
const buildEmailTemplates = (t: TFunction) => [
    {
        id: 'template1',
        name: t('templates.welcome.name'),
        subject: t('templates.welcome.subject'),
        content: t('templates.welcome.content', {
            name: '{{name}}',
            email: '{{email}}',
            mobile_number: '{{mobile_number}}',
        }),
    },
    {
        id: 'template2',
        name: t('templates.sessionUpdate.name'),
        subject: t('templates.sessionUpdate.subject', { name: '{{name}}' }),
        content: t('templates.sessionUpdate.content', { name: '{{name}}' }),
    },
    {
        id: 'template3',
        name: t('templates.custom.name'),
        subject: t('templates.custom.subject'),
        content: t('templates.custom.content', {
            name: '{{name}}',
            custom_message_text: '{{custom_message_text}}',
        }),
    },
];

type EmailSendingStatus = 'pending' | 'sending' | 'sent' | 'failed';

interface StudentEmailStatus {
    userId: string;
    name: string;
    email: string;
    status: EmailSendingStatus;
    error?: string;
}

// Placeholder variables users can insert — every one of these is actually resolved by
// bulkEmailService.ts's per-student placeholder resolver at send time (no dead variables).
// Only the label is translated; the `value` token itself must stay literal in every
// locale since bulkEmailService matches on the exact {{...}} text.
const buildPlaceholderVariables = (t: TFunction) => [
    { label: t('placeholders.studentName'), value: '{{name}}' },
    { label: t('placeholders.emailAddress'), value: '{{email}}' },
    { label: t('placeholders.mobileNumber'), value: '{{mobile_number}}' },
    { label: t('placeholders.customMessage'), value: '{{custom_message_text}}' },
    { label: t('placeholders.courseName'), value: '{{course_name}}' },
    { label: t('placeholders.batchName'), value: '{{batch_name}}' },
    { label: t('placeholders.loginUsername'), value: '{{username}}' },
    { label: t('placeholders.registrationDate'), value: '{{registration_date}}' },
    { label: t('placeholders.currentDate'), value: '{{current_date}}' },
];

export const SendEmailDialog = () => {
    const { t } = useTranslation('manageStudentsSendEmailDialogEnroll');
    const { isSendEmailOpen, bulkActionInfo, selectedStudent, isBulkAction, closeAllDialogs } =
        useEnrollRequestsDialogStore();
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [studentEmailStatuses, setStudentEmailStatuses] = useState<StudentEmailStatus[]>([]);
    const [isBulkEmailSending, setIsBulkEmailSending] = useState(false);
    const [customMessage, setCustomMessage] = useState(
        'Thank you for being part of our learning community.'
    );
    const [showPreviewModal, setShowPreviewModal] = useState(false);

    const emailSubjectRef = useRef<HTMLInputElement>(null);
    const emailBodyRef = useRef<HTMLTextAreaElement>(null);

    const emailTemplates = useMemo(() => buildEmailTemplates(t), [t]);
    const placeholderVariables = useMemo(() => buildPlaceholderVariables(t), [t]);

    const handleSelectEmailTemplate = (templateId: string) => {
        // Renamed the find() callback param from `t` to `tpl` — it shadowed the
        // outer translation function `t` from useTranslation() above.
        const template = emailTemplates.find((tpl) => tpl.id === templateId);
        if (template) {
            setSelectedTemplateId(template.id);
            setEmailSubject(template.subject);
            setEmailBody(template.content);
            toast.info(t('toasts.templateLoaded', { name: template.name }));
        }
    };

    // Function to insert placeholder at cursor position
    const insertPlaceholder = (placeholder: string, isSubject: boolean = false) => {
        const textarea = isSubject ? emailSubjectRef.current : emailBodyRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const currentValue = isSubject ? emailSubject : emailBody;
        const newValue =
            currentValue.substring(0, start) + placeholder + currentValue.substring(end);

        if (isSubject) {
            setEmailSubject(newValue);
        } else {
            setEmailBody(newValue);
        }

        // Set cursor position after inserted placeholder
        setTimeout(() => {
            if (textarea) {
                textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
                textarea.focus();
            }
        }, 0);
    };

    // Function to generate preview with sample data
    const generatePreview = () => {
        const students = isBulkAction
            ? bulkActionInfo?.selectedStudents || []
            : selectedStudent
              ? [selectedStudent]
              : [];

        if (!students.length) return { subject: emailSubject, body: emailBody };

        const sampleStudent = students[0];
        if (!sampleStudent) return { subject: emailSubject, body: emailBody };

        const currentDate = new Date().toLocaleDateString();

        const replacements = {
            '{{name}}': sampleStudent.full_name || t('previewSampleData.name'),
            '{{email}}': sampleStudent.email || 'john.doe@example.com',
            '{{mobile_number}}': sampleStudent.mobile_number || '+1234567890',
            '{{custom_message_text}}': customMessage,
            '{{course_name}}': t('previewSampleData.courseName'), // You can get this from student data
            '{{batch_name}}': t('previewSampleData.batchName'), // You can get this from student data
            '{{username}}': sampleStudent.email?.split('@')[0] || 'johndoe',
            '{{registration_date}}': '2024-01-15', // You can get this from student data
            '{{current_date}}': currentDate,
        };

        let previewSubject = emailSubject;
        let previewBody = emailBody;

        // Replace all placeholders
        Object.entries(replacements).forEach(([placeholder, value]) => {
            previewSubject = previewSubject.replace(
                new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'),
                value
            );
            previewBody = previewBody.replace(
                new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'),
                value
            );
        });

        return { subject: previewSubject, body: previewBody };
    };

    const handleSendBulkEmail = async () => {
        const trimmedEmailSubject = emailSubject.trim();
        const trimmedEmailBody = emailBody.trim();

        if (!trimmedEmailSubject || !trimmedEmailBody) {
            toast.error(t('toasts.subjectBodyRequired'));
            return;
        }

        if (studentEmailStatuses.length === 0) {
            toast.error(t('toasts.noValidRecipients'));
            return;
        }

        setIsBulkEmailSending(true);
        toast.info(t('toasts.processingEmails'), { id: 'bulk-email-progress' });

        setStudentEmailStatuses((prevStatuses) =>
            prevStatuses.map((s) => ({ ...s, status: 'sending' }))
        );

        const allStudents = isBulkAction
            ? bulkActionInfo?.selectedStudents || []
            : selectedStudent
              ? [selectedStudent]
              : [];

        // Only recipients we actually have an email-status entry for, with custom_message_text
        // attached so bulkEmailService's resolver can populate {{custom_message_text}}.
        const students = studentEmailStatuses
            .map((statusEntry) => {
                const student = allStudents.find((s) => s.user_id === statusEntry.userId);
                if (!student || !student.email) return null;
                return { ...student, custom_message_text: customMessage };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);

        if (students.length === 0) {
            toast.error(t('toasts.noPayloadPrepared'));
            setIsBulkEmailSending(false);
            setStudentEmailStatuses((prevStatuses) =>
                prevStatuses.map((s) => ({ ...s, status: 'pending' }))
            );
            return;
        }

        // Prepare email body (convert newlines to HTML breaks)
        const finalApiBody = trimmedEmailBody.replace(/\n/g, '<br />');

        try {
            // Delegate to bulkEmailService so every canonical variable in the picker
            // ({{course_name}}, {{batch_name}}, {{username}}, {{registration_date}}, ...) is
            // resolved per-student, not just the handful this dialog used to send manually.
            const result: BulkEmailResult = await bulkEmailService.sendBulkEmail({
                template: finalApiBody,
                subject: trimmedEmailSubject,
                students,
                context: 'student-management',
                notificationType: 'EMAIL',
                source: 'STUDENT_MANAGEMENT_BULK_EMAIL',
                sourceId: 'enroll-requests',
            });

            if (result.success) {
                if (result.failedStudents === 0) {
                    toast.success(
                        t('toasts.sendSuccess', { count: result.processedStudents }),
                        { id: 'bulk-email-progress' }
                    );
                } else {
                    toast.warning(
                        t('toasts.sendPartial', {
                            sent: result.processedStudents - result.failedStudents,
                            failed: result.failedStudents,
                        }),
                        { id: 'bulk-email-progress' }
                    );
                }

                setStudentEmailStatuses((prev) =>
                    prev.map((s) => {
                        const failed = result.errors.find((e) => e.studentId === s.userId);
                        return failed
                            ? { ...s, status: 'failed', error: failed.error }
                            : { ...s, status: 'sent' };
                    })
                );
            } else {
                toast.error(t('toasts.sendFailed'), { id: 'bulk-email-progress' });
                setStudentEmailStatuses((prev) =>
                    prev.map((s) => ({ ...s, status: 'failed', error: 'Send failed' }))
                );
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('toasts.unexpectedError');
            console.error('Error sending email:', error);
            toast.error(t('toasts.errorPrefix', { message }), { id: 'bulk-email-progress' });
            setStudentEmailStatuses((prev) =>
                prev.map((s) => ({ ...s, status: 'failed', error: message }))
            );
        }

        setIsBulkEmailSending(false);
    };

    const handleClose = () => {
        if (isBulkEmailSending) return;
        setEmailSubject('');
        setEmailBody('');
        setSelectedTemplateId('');
        setStudentEmailStatuses([]);
        closeAllDialogs();
    };

    // Initialize email statuses when dialog opens
    useEffect(() => {
        if (isSendEmailOpen) {
            const students = isBulkAction
                ? bulkActionInfo?.selectedStudents || []
                : selectedStudent
                  ? [selectedStudent]
                  : [];

            const studentsWithEmail = students.filter((student) => student.email);
            setStudentEmailStatuses(
                studentsWithEmail.map((student) => ({
                    userId: student.user_id,
                    name: student.full_name,
                    email: student.email,
                    status: 'pending' as EmailSendingStatus,
                }))
            );
        }
    }, [isSendEmailOpen, bulkActionInfo, selectedStudent, isBulkAction]);

    const recipientCount = studentEmailStatuses.length;

    return (
        <>
            <MyDialog
                heading={t('dialogTitle')}
                open={isSendEmailOpen}
                onOpenChange={handleClose}
                dialogWidth="w-dialog-md"
                footer={
                    <div className="flex items-center justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={handleClose}
                            disable={isBulkEmailSending}
                        >
                            {t('cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleSendBulkEmail}
                            disable={
                                !emailSubject.trim() ||
                                !emailBody.trim() ||
                                recipientCount === 0 ||
                                isBulkEmailSending
                            }
                            className="min-w-32 bg-blue-600 text-white hover:bg-blue-700"
                        >
                            {isBulkEmailSending ? (
                                <>
                                    <Spinner className="mr-2 size-4 animate-spin" />
                                    {t('sending')}
                                </>
                            ) : (
                                <>
                                    <PaperPlaneTilt className="mr-2 size-4" />
                                    {t('sendButton', { count: recipientCount })}
                                </>
                            )}
                        </MyButton>
                    </div>
                }
            >
                <div className="space-y-4">
                    <div className="mb-4 text-sm text-neutral-600">
                        {t('composeNotice', { count: recipientCount })}
                    </div>

                    {/* Template Selection */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-neutral-700">
                            {t('templateLabel')}
                        </label>
                        <Select
                            value={selectedTemplateId}
                            onValueChange={(value: string) => {
                                if (value && value !== 'none') {
                                    handleSelectEmailTemplate(value);
                                } else {
                                    setSelectedTemplateId('');
                                    setEmailSubject('');
                                    setEmailBody('');
                                }
                            }}
                            disabled={isBulkEmailSending}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={t('selectTemplatePlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">{t('noTemplateOption')}</SelectItem>
                                {emailTemplates.map((template) => (
                                    <SelectItem key={template.id} value={template.id}>
                                        {template.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Subject */}
                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <label className="text-sm font-medium text-neutral-700">
                                {t('subjectLabel')}
                            </label>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setShowPreviewModal(true)}
                                disabled={!emailSubject.trim() && !emailBody.trim()}
                                className="text-xs"
                            >
                                <Eye className="mr-1 size-3" />
                                {t('showPreview')}
                            </MyButton>
                        </div>
                        <MyInput
                            ref={emailSubjectRef}
                            inputType="text"
                            input={emailSubject}
                            onChangeFunction={(e) => setEmailSubject(e.target.value)}
                            inputPlaceholder={t('subjectPlaceholder')}
                            disabled={isBulkEmailSending}
                        />
                        <div className="mt-2 flex flex-wrap gap-1">
                            {placeholderVariables.slice(0, 4).map((placeholder) => (
                                <MyButton
                                    key={placeholder.value}
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => insertPlaceholder(placeholder.value, true)}
                                    disabled={isBulkEmailSending}
                                    className="px-2 py-1 text-xs"
                                >
                                    {placeholder.label}
                                </MyButton>
                            ))}
                        </div>
                    </div>

                    {/* Body */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-neutral-700">
                            {t('bodyLabel')}
                        </label>
                        <div className="mb-2 text-xs text-neutral-600">
                            {t('clickToInsertVariables')}
                        </div>
                        <div className="mb-3 flex flex-wrap gap-1">
                            {placeholderVariables.map((placeholder) => (
                                <MyButton
                                    key={placeholder.value}
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => insertPlaceholder(placeholder.value)}
                                    disabled={isBulkEmailSending}
                                    className="px-2 py-1 text-xs hover:bg-blue-50 hover:text-blue-700"
                                >
                                    {placeholder.label}
                                </MyButton>
                            ))}
                        </div>
                        <Textarea
                            ref={emailBodyRef}
                            value={emailBody}
                            onChange={(e) => setEmailBody(e.target.value)}
                            placeholder={t('bodyPlaceholder')}
                            disabled={isBulkEmailSending}
                            className="min-h-48"
                        />
                    </div>

                    {/* Custom Message Field */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-neutral-700">
                            {t('customMessageLabel')}
                        </label>
                        <MyInput
                            inputType="text"
                            input={customMessage}
                            onChangeFunction={(e) => setCustomMessage(e.target.value)}
                            inputPlaceholder={t('customMessagePlaceholder')}
                            disabled={isBulkEmailSending}
                        />
                    </div>

                    {/* Sending Progress */}
                    {isBulkEmailSending && studentEmailStatuses.length > 0 && (
                        <div className="max-h-48 space-y-2 overflow-y-auto pr-2">
                            <p className="mb-2 text-sm font-medium">
                                {t('sendingProgress', {
                                    done: studentEmailStatuses.filter(
                                        (s) => s.status === 'sent' || s.status === 'failed'
                                    ).length,
                                    total: studentEmailStatuses.length,
                                })}
                            </p>
                            {studentEmailStatuses.map((s) => (
                                <div
                                    key={s.userId}
                                    className="flex items-center justify-between rounded bg-neutral-100 p-1.5 text-xs"
                                >
                                    <span className="max-w-48 truncate">
                                        {s.name} ({s.email})
                                    </span>
                                    <div className="shrink-0">
                                        {s.status === 'pending' && (
                                            <span className="text-neutral-500">
                                                {t('status.pending')}
                                            </span>
                                        )}
                                        {s.status === 'sending' && (
                                            <Spinner className="size-3 animate-spin text-blue-500" />
                                        )}
                                        {s.status === 'sent' && (
                                            <span className="font-medium text-green-600">
                                                {t('status.sent')}
                                            </span>
                                        )}
                                        {s.status === 'failed' && (
                                            <span
                                                className="font-medium text-red-600"
                                                title={s.error}
                                            >
                                                {t('status.failed')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </MyDialog>

            {/* Email Preview Modal */}
            <MyDialog
                heading={t('preview.heading')}
                open={showPreviewModal}
                onOpenChange={setShowPreviewModal}
                dialogWidth="w-dialog-md"
                footer={
                    <div className="flex items-center justify-end">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setShowPreviewModal(false)}
                        >
                            {t('preview.close')}
                        </MyButton>
                    </div>
                }
            >
                <div className="space-y-4">
                    <div className="mb-4 flex items-center gap-2 text-sm text-neutral-600">
                        <Eye className="size-4 text-blue-600" />
                        <span>{t('preview.usingFirstStudent')}</span>
                    </div>

                    {generatePreview().subject && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-neutral-700">
                                {t('preview.subjectLabel')}
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-neutral-800">
                                {generatePreview().subject}
                            </div>
                        </div>
                    )}

                    {generatePreview().body && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-neutral-700">
                                {t('preview.bodyLabel')}
                            </div>
                            <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-neutral-800">
                                {generatePreview().body}
                            </div>
                        </div>
                    )}

                    {!generatePreview().subject && !generatePreview().body && (
                        <div className="py-8 text-center text-neutral-500">
                            <Eye className="mx-auto mb-2 size-8 opacity-50" />
                            <p>{t('preview.emptyState')}</p>
                        </div>
                    )}
                </div>
            </MyDialog>
        </>
    );
};
