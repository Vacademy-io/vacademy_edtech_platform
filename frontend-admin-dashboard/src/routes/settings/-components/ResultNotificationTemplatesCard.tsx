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
    clearResultTemplate,
    getResultTemplate,
    setResultTemplate,
    type ResultChannel,
} from '@/services/result-notification-templates';

/**
 * Which email and WhatsApp template go out when results are released, institute-wide.
 * An assessment can override these. With no email template chosen the platform's default
 * result email is sent, so learners always get their report; WhatsApp is sent only when a
 * template (approved by WhatsApp, with a document header) is chosen.
 */
function ResultTemplateChannel({ channel }: { channel: ResultChannel }) {
    const { t } = useTranslation('settingsResultNotification');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId() ?? '';
    const [selected, setSelected] = useState<MessageTemplate | null>(null);
    const queryKey = ['result-notification-template', instituteId, channel];
    const label = t(channel === 'EMAIL' ? 'email.label' : 'whatsapp.label');

    const { data: config, isLoading } = useQuery({
        queryKey,
        queryFn: () => getResultTemplate(instituteId, channel),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });

    useEffect(() => {
        if (!config?.template_id) {
            setSelected(null);
            return;
        }
        getMessageTemplate(config.template_id)
            .then(setSelected)
            .catch(() => setSelected(null));
    }, [config?.template_id]);

    const { mutate: save } = useMutation({
        mutationFn: (templateId: string | null) =>
            templateId
                ? setResultTemplate(instituteId, channel, templateId)
                : clearResultTemplate(instituteId, channel),
        onSuccess: () => {
            toast.success(t('toasts.updated', { label }));
            queryClient.invalidateQueries({ queryKey });
        },
        onError: () => toast.error(t('toasts.updateFailed', { label: label.toLowerCase() })),
    });

    return (
        <div className="flex flex-col gap-2">
            <Label>{label}</Label>
            <p className="text-caption text-neutral-500">
                {t(channel === 'EMAIL' ? 'email.description' : 'whatsapp.description')}
            </p>
            {isLoading ? (
                <div className="text-body text-neutral-500">{t('loading')}</div>
            ) : (
                <TemplateSelector
                    templateType={channel}
                    selectedTemplate={selected}
                    onTemplateSelect={(template: MessageTemplate | null) => {
                        setSelected(template);
                        save(template?.id ?? null);
                    }}
                    variant="dropdown"
                    placeholder={t(
                        channel === 'EMAIL' ? 'email.placeholder' : 'whatsapp.placeholder'
                    )}
                />
            )}
        </div>
    );
}

const RESULT_VARIABLES = [
    'student_name',
    'first_name',
    'assessment_name',
    'institute_name',
    'score',
    'max_score',
    'percentage',
    'rank',
    'participants',
    'enrollment_number',
    'result_date',
];

export default function ResultNotificationTemplatesCard() {
    const { t } = useTranslation('settingsResultNotification');
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <ResultTemplateChannel channel="EMAIL" />
                <ResultTemplateChannel channel="WHATSAPP" />
                <div className="flex flex-col gap-2 text-caption text-neutral-500">
                    <span>{t('variablesHelp')}</span>
                    <div className="flex flex-wrap gap-1">
                        {RESULT_VARIABLES.map((name) => (
                            <code
                                key={name}
                                className="rounded-sm bg-neutral-100 px-1 text-neutral-700"
                            >
                                {`{{${name}}}`}
                            </code>
                        ))}
                    </div>
                    <span>
                        {t('variablesProfile')}{' '}
                        <code className="rounded-sm bg-neutral-100 px-1 text-neutral-700">
                            {'{{scholarship_percent}}'}
                        </code>
                    </span>
                </div>
            </CardContent>
        </Card>
    );
}
