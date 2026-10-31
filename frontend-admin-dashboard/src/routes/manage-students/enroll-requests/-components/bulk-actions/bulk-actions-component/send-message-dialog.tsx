import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { PaperPlaneTilt, Spinner } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useEnrollRequestsDialogStore } from '../bulk-actions-store';

// Define message templates. The content strings contain the app's own
// {{placeholder}} tokens (resolved later in processSendMessageQueue by simple
// string replacement, not by i18next) — each is translated with an identity
// interpolation value so the token text survives translation unchanged.
const buildMessageTemplates = (t: TFunction) => [
    {
        id: 'template1',
        name: t('templates.welcome.name'),
        content: t('templates.welcome.content', { name: '{{name}}' }),
    },
    {
        id: 'template2',
        name: t('templates.sessionReminder.name'),
        content: t('templates.sessionReminder.content', { name: '{{name}}' }),
    },
    {
        id: 'template3',
        name: t('templates.assignmentDue.name'),
        content: t('templates.assignmentDue.content', { name: '{{name}}' }),
    },
    {
        id: 'template4',
        name: t('templates.custom.name'),
        content: t('templates.custom.content', {
            name: '{{name}}',
            custom_message_text: '{{custom_message_text}}',
        }),
    },
];

type MessageSendingStatus = 'pending' | 'sending' | 'sent' | 'failed';

interface StudentMessageStatus {
    userId: string;
    name: string;
    status: MessageSendingStatus;
    error?: string;
}

export const SendMessageDialog = () => {
    const { t } = useTranslation('manageStudentsSendMessageDialogEnroll');
    const { isSendMessageOpen, bulkActionInfo, closeAllDialogs } = useEnrollRequestsDialogStore();

    const messageTemplates = useMemo(() => buildMessageTemplates(t), [t]);

    const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
        messageTemplates[0]?.id || ''
    );
    const [studentMessageStatuses, setStudentMessageStatuses] = useState<StudentMessageStatus[]>(
        []
    );
    const [isBulkSending, setIsBulkSending] = useState(false);

    // Mock API function - replace with your actual API
    const mockSendMessageAPI = (
        userId: string,
        userName: string,
        message: string
    ): Promise<void> => {
        return new Promise((resolve, reject) => {
            setTimeout(
                () => {
                    // Simulate success/failure randomly
                    if (Math.random() > 0.2) {
                        // 80% success rate
                        console.log(
                            `Mock API: Message sent to ${userName} (${userId}): ${message}`
                        );
                        resolve();
                    } else {
                        console.error(`Mock API: Failed to send to ${userName} (${userId})`);
                        reject(new Error('Simulated API Error'));
                    }
                },
                1000 + Math.random() * 1500
            ); // Simulate network delay
        });
    };

    const processSendMessageQueue = async () => {
        if (!selectedTemplateId || !bulkActionInfo) {
            toast.error(t('toasts.noTemplateOrStudents'));
            setIsBulkSending(false);
            return;
        }

        // Renamed the find() callback param from `t` to `tpl` — it would otherwise
        // shadow the outer translation function `t` from useTranslation() above.
        const template = messageTemplates.find((tpl) => tpl.id === selectedTemplateId);
        if (!template) {
            toast.error(t('toasts.templateNotFound'));
            setIsBulkSending(false);
            return;
        }

        setIsBulkSending(true);
        toast.info(t('toasts.startingSend'), { id: 'bulk-send-progress' });

        // Initialize status for all students
        const initialStatuses = bulkActionInfo.selectedStudents.map((student) => ({
            userId: student.user_id,
            name: student.full_name,
            status: 'pending' as MessageSendingStatus,
        }));
        setStudentMessageStatuses(initialStatuses);

        for (const student of bulkActionInfo.selectedStudents) {
            setStudentMessageStatuses((prev) =>
                prev.map((s) => (s.userId === student.user_id ? { ...s, status: 'sending' } : s))
            );

            try {
                // Replace placeholders in the message
                let messageContent = template.content.replace(/\{\{name\}\}/g, student.full_name);
                // Add other placeholder replacements as needed
                messageContent = messageContent.replace(
                    /\{\{mobile_number\}\}/g,
                    student.mobile_number || ''
                );
                messageContent = messageContent.replace(
                    /\{\{custom_message_text\}\}/g,
                    t('defaultCustomMessage')
                );

                await mockSendMessageAPI(student.user_id, student.full_name, messageContent);

                setStudentMessageStatuses((prev) =>
                    prev.map((s) => (s.userId === student.user_id ? { ...s, status: 'sent' } : s))
                );
            } catch (error: any) {
                setStudentMessageStatuses((prev) =>
                    prev.map((s) =>
                        s.userId === student.user_id
                            ? { ...s, status: 'failed', error: error.message }
                            : s
                    )
                );
            }
        }

        setIsBulkSending(false);
        const sentCount = studentMessageStatuses.filter((s) => s.status === 'sent').length;
        const failedCount = studentMessageStatuses.filter((s) => s.status === 'failed').length;
        toast.success(t('toasts.finished', { sent: sentCount, failed: failedCount }), {
            id: 'bulk-send-progress',
            duration: 5000,
        });
    };

    const handleClose = () => {
        if (isBulkSending) return;
        setStudentMessageStatuses([]);
        setSelectedTemplateId(messageTemplates[0]?.id || '');
        closeAllDialogs();
    };

    const selectedStudentsCount = bulkActionInfo?.selectedStudents.length || 0;

    return (
        <MyDialog
            heading={t('dialogTitle')}
            open={isSendMessageOpen}
            onOpenChange={handleClose}
            dialogWidth="max-w-md"
            footer={
                <div className="flex items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleClose}
                        disable={isBulkSending}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={processSendMessageQueue}
                        disable={
                            !selectedTemplateId || selectedStudentsCount === 0 || isBulkSending
                        }
                        className="min-w-32 bg-green-600 text-white hover:bg-green-700"
                    >
                        {isBulkSending ? (
                            <>
                                <Spinner className="mr-2 size-4 animate-spin" />
                                {t('sending')}
                            </>
                        ) : (
                            <>
                                <PaperPlaneTilt className="mr-2 size-4" />
                                {t('sendButton', { count: selectedStudentsCount })}
                            </>
                        )}
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-4">
                <div className="mb-4 text-sm text-neutral-600">
                    {t('selectTemplateNotice', { count: selectedStudentsCount })}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-medium text-neutral-700">
                        {t('templateLabel')}
                    </label>
                    <Select
                        value={selectedTemplateId}
                        onValueChange={(value: string) => setSelectedTemplateId(value)}
                        disabled={isBulkSending}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t('selectTemplatePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {messageTemplates.map((template) => (
                                <SelectItem key={template.id} value={template.id}>
                                    {template.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {selectedTemplateId && (
                    <div className="rounded-lg bg-neutral-50 p-3">
                        <div className="mb-1 text-sm font-medium text-neutral-700">
                            {t('previewLabel')}
                        </div>
                        <div className="text-sm text-neutral-600">
                            {messageTemplates.find((tpl) => tpl.id === selectedTemplateId)
                                ?.content || ''}
                        </div>
                    </div>
                )}

                {isBulkSending && studentMessageStatuses.length > 0 && (
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-2">
                        <p className="mb-2 text-sm font-medium">
                            {t('sendingProgress', {
                                done: studentMessageStatuses.filter(
                                    (s) => s.status === 'sent' || s.status === 'failed'
                                ).length,
                                total: studentMessageStatuses.length,
                            })}
                        </p>
                        {studentMessageStatuses.map((s) => (
                            <div
                                key={s.userId}
                                className="flex items-center justify-between rounded bg-neutral-100 p-1.5 text-xs"
                            >
                                <span className="max-w-36 truncate">{s.name}</span>
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
                                        <span className="font-medium text-red-600" title={s.error}>
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
    );
};
