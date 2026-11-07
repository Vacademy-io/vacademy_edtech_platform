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
// {{placeholder}} tokens (resolved later in handleSendMessage by simple
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

export const SendMessageDialogIndividual = () => {
    const { t } = useTranslation('manageStudentsSendMessageDialogIndividual');
    const { isSendMessageOpen, selectedStudent, closeAllDialogs } = useEnrollRequestsDialogStore();

    const messageTemplates = useMemo(() => buildMessageTemplates(t), [t]);

    const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
        messageTemplates[0]?.id || ''
    );
    const [messageStatus, setMessageStatus] = useState<MessageSendingStatus>('pending');
    const [isSending, setIsSending] = useState(false);

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

    const handleSendMessage = async () => {
        if (!selectedTemplateId || !selectedStudent) {
            toast.error(t('toasts.noTemplateOrStudent'));
            return;
        }

        // Renamed the find() callback param from `t` to `tpl` — it would otherwise
        // shadow the outer translation function `t` from useTranslation() above.
        const template = messageTemplates.find((tpl) => tpl.id === selectedTemplateId);
        if (!template) {
            toast.error(t('toasts.templateNotFound'));
            return;
        }

        setIsSending(true);
        setMessageStatus('sending');
        toast.info(t('toasts.sending'), { id: 'send-message-progress' });

        try {
            // Replace placeholders in the message
            let messageContent = template.content.replace(
                /\{\{name\}\}/g,
                selectedStudent.full_name
            );
            // Add other placeholder replacements as needed
            messageContent = messageContent.replace(
                /\{\{mobile_number\}\}/g,
                selectedStudent.mobile_number || ''
            );
            messageContent = messageContent.replace(
                /\{\{custom_message_text\}\}/g,
                t('defaultCustomMessage')
            );

            await mockSendMessageAPI(
                selectedStudent.user_id,
                selectedStudent.full_name,
                messageContent
            );

            setMessageStatus('sent');
            toast.success(t('toasts.sent'), {
                id: 'send-message-progress',
                duration: 5000,
            });
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : t('toasts.unknownError');
            setMessageStatus('failed');
            toast.error(t('toasts.failed', { error: errorMessage }), {
                id: 'send-message-progress',
                duration: 5000,
            });
        } finally {
            setIsSending(false);
        }
    };

    const handleClose = () => {
        if (isSending) return;
        setMessageStatus('pending');
        setSelectedTemplateId(messageTemplates[0]?.id || '');
        closeAllDialogs();
    };

    if (!selectedStudent) {
        return null;
    }

    return (
        <MyDialog
            heading={t('dialogTitle')}
            open={isSendMessageOpen}
            onOpenChange={handleClose}
            dialogWidth="w-dialog-md"
            footer={
                <div className="flex items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleClose}
                        disable={isSending}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={handleSendMessage}
                        disable={!selectedTemplateId || isSending}
                        className="min-w-32 bg-green-600 text-white hover:bg-green-700"
                    >
                        {isSending ? (
                            <>
                                <Spinner className="mr-2 size-4 animate-spin" />
                                {t('sending')}
                            </>
                        ) : (
                            <>
                                <PaperPlaneTilt className="mr-2 size-4" />
                                {t('sendButton')}
                            </>
                        )}
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-4">
                <div className="mb-4 text-sm text-neutral-600">
                    {t('sendMessageNotice')}{' '}
                    <span className="font-medium">{selectedStudent.full_name}</span>
                </div>

                <div>
                    <label className="mb-2 block text-sm font-medium text-neutral-700">
                        {t('templateLabel')}
                    </label>
                    <Select
                        value={selectedTemplateId}
                        onValueChange={(value: string) => setSelectedTemplateId(value)}
                        disabled={isSending}
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

                {isSending && (
                    <div className="rounded-lg bg-neutral-100 p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-neutral-700">
                                {t('sendingNotice', { name: selectedStudent.full_name })}
                            </span>
                            <Spinner className="size-4 animate-spin text-blue-500" />
                        </div>
                    </div>
                )}

                {messageStatus === 'sent' && (
                    <div className="rounded-lg bg-green-50 p-3">
                        <div className="flex items-center">
                            <span className="text-sm font-medium text-green-700">
                                {t('sentNotice', { name: selectedStudent.full_name })}
                            </span>
                        </div>
                    </div>
                )}

                {messageStatus === 'failed' && (
                    <div className="rounded-lg bg-red-50 p-3">
                        <div className="flex items-center">
                            <span className="text-sm font-medium text-red-700">
                                {t('failedNotice', { name: selectedStudent.full_name })}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
