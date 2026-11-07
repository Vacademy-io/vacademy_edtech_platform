import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { TemplateSelector } from '@/components/templates';
import { MessageTemplate } from '@/types/message-template-types';
import { getMessageTemplate } from '@/services/message-template-service';
import { getInstituteId } from '@/constants/helper';
import {
    getCredentialTemplateConfig,
    setCredentialTemplateConfig,
    clearCredentialTemplateConfig,
    type CredentialChannel,
} from '@/services/student-list-section/updateStudentCredentials';

/**
 * Picks the template used whenever a learner is sent their portal credentials —
 * from the Portal Access → Edit Credentials dialog today, and from any future
 * flow bound to the same LEARNER_CREDENTIALS_SHARED event.
 *
 * One selector per channel, because they are bound independently server-side: an
 * institute can run email only, add WhatsApp later, or use wording on WhatsApp
 * that its provider has approved while email stays fully branded.
 *
 * A channel with nothing selected sends nothing. That is deliberate — falling
 * back to generic platform wording would put an unapproved message in front of
 * that institute's learners.
 */
function CredentialTemplateChannel({
    channel,
    label,
    description,
}: {
    channel: CredentialChannel;
    label: string;
    description: string;
}) {
    const { t } = useTranslation('settingsLearnerCredential');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId() ?? '';
    const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);

    const queryKey = ['learner-credential-template-config', instituteId, channel];

    const { data: config, isLoading } = useQuery({
        queryKey,
        queryFn: () => getCredentialTemplateConfig(instituteId, channel),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });

    useEffect(() => {
        if (!config?.template_id) {
            setSelectedTemplate(null);
            return;
        }
        getMessageTemplate(config.template_id)
            .then(setSelectedTemplate)
            .catch(() => setSelectedTemplate(null));
    }, [config?.template_id]);

    const { mutate: saveSelection } = useMutation({
        mutationFn: (templateId: string | null) =>
            templateId
                ? setCredentialTemplateConfig(instituteId, channel, templateId)
                : clearCredentialTemplateConfig(instituteId, channel),
        onSuccess: () => {
            toast.success(t('toasts.updated', { label }));
            queryClient.invalidateQueries({ queryKey });
        },
        onError: () => {
            toast.error(t('toasts.updateFailed', { label: label.toLowerCase() }));
        },
    });

    const handleTemplateSelect = (template: MessageTemplate | null) => {
        setSelectedTemplate(template);
        saveSelection(template?.id ?? null);
    };

    return (
        <div className="flex flex-col gap-2">
            <Label>{label}</Label>
            <p className="text-caption text-neutral-500">{description}</p>
            {isLoading ? (
                <div className="text-body text-neutral-500">{t('templateSelector.loading')}</div>
            ) : (
                <TemplateSelector
                    templateType={channel}
                    selectedTemplate={selectedTemplate}
                    onTemplateSelect={handleTemplateSelect}
                    variant="dropdown"
                    placeholder={t('templateSelector.placeholder', {
                        channelNoun: t(
                            channel === 'EMAIL' ? 'channelNoun.email' : 'channelNoun.whatsapp'
                        ),
                    })}
                />
            )}
        </div>
    );
}

export default function LearnerCredentialSettings() {
    const { t } = useTranslation('settingsLearnerCredential');

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>
                    {t('description.intro')} <code>{'{{user_name}}'}</code>,{' '}
                    <code>{'{{user_password}}'}</code>, <code>{'{{user_full_name}}'}</code>,{' '}
                    <code>{'{{portal_url}}'}</code> {t('description.and')}{' '}
                    <code>{'{{institute_name}}'}</code>.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <CredentialTemplateChannel
                    channel="EMAIL"
                    label={t('channels.email.label')}
                    description={t('channels.email.description')}
                />
                <CredentialTemplateChannel
                    channel="WHATSAPP"
                    label={t('channels.whatsapp.label')}
                    description={t('channels.whatsapp.description')}
                />
            </CardContent>
        </Card>
    );
}
