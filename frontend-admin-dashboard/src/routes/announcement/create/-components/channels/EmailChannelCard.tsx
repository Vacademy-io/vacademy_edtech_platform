import { useEffect } from 'react';
import { ArrowSquareOut, EnvelopeSimple, PaperPlaneTilt } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateSearchableSelect } from '@/components/templates/TemplateSearchableSelect';
import type { MessageTemplate } from '@/types/message-template-types';
import type { EmailConfiguration } from '@/services/email-configuration-service';
import { EmptyState, FieldError, FieldHint, LoadFailure } from '../primitives';
import type { EmailConfig, FieldErrors } from '../../-types';

const WRITE_FROM_SCRATCH = 'custom';

interface EmailChannelCardProps {
    config: EmailConfig;
    onChange: (patch: Partial<EmailConfig>) => void;
    onApplyTemplate: (templateId: string) => void;
    applying: boolean;
    templates: MessageTemplate[];
    templatesLoading: boolean;
    templatesError: string | null;
    onLoadTemplates: (force?: boolean) => void;
    senders: EmailConfiguration[];
    sendersLoading: boolean;
    sendersError: string | null;
    onReloadSenders: () => void;
    announcementTitle: string;
    errors: FieldErrors;
    showErrors: boolean;
}

export function EmailChannelCard({
    config,
    onChange,
    onApplyTemplate,
    applying,
    templates,
    templatesLoading,
    templatesError,
    onLoadTemplates,
    senders,
    sendersLoading,
    sendersError,
    onReloadSenders,
    announcementTitle,
    errors,
    showErrors,
}: EmailChannelCardProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('announcementCreateEmailChannelCard');
    const err = (key: string) => (showErrors ? errors[key] : undefined);

    // The email card only renders once EMAIL is selected, so this is the right moment to fetch.
    useEffect(() => {
        onLoadTemplates();
    }, [onLoadTemplates]);

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <div className="flex flex-wrap items-end justify-between gap-2">
                    <Label className="text-caption font-semibold">{t('emailTemplate')}</Label>
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() =>
                            navigate({ to: '/settings', search: { selectedTab: 'templates' } })
                        }
                    >
                        {t('manageTemplates')}
                        <ArrowSquareOut className="ml-1 size-4" />
                    </MyButton>
                </div>
                {templatesError ? (
                    <LoadFailure message={templatesError} onRetry={() => onLoadTemplates(true)} />
                ) : (
                    <TemplateSearchableSelect
                        options={templates.map((template) => ({
                            value: template.id,
                            name: template.name,
                            category: template.templateType,
                            preview: (template.subject || template.content || '')
                                .replace(/<[^>]*>/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim(),
                        }))}
                        value={config.templateId || WRITE_FROM_SCRATCH}
                        onChange={(value) =>
                            onApplyTemplate(value === WRITE_FROM_SCRATCH ? '' : value)
                        }
                        noneOption={{
                            value: WRITE_FROM_SCRATCH,
                            label: t('writeFromScratch'),
                        }}
                        loading={templatesLoading || applying}
                        placeholder={t('searchTemplates')}
                    />
                )}
                <FieldHint>
                    {config.templateId ? t('templateAppliedHint') : t('defaultContentHint')}
                </FieldHint>
            </div>

            <div className="space-y-1">
                <Label className="text-caption font-semibold">{t('sendFrom')}</Label>
                {sendersError ? (
                    <LoadFailure message={sendersError} onRetry={onReloadSenders} />
                ) : sendersLoading ? (
                    <Skeleton className="h-9 w-full rounded-md" />
                ) : senders.length === 0 ? (
                    <EmptyState
                        Icon={EnvelopeSimple}
                        title={t('noSenderTitle')}
                        description={t('noSenderDescription')}
                        action={
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() =>
                                    navigate({
                                        to: '/settings',
                                        search: { selectedTab: 'notification' },
                                    })
                                }
                            >
                                {t('configureSending')}
                            </MyButton>
                        }
                    />
                ) : (
                    <Select
                        value={config.fromKey}
                        onValueChange={(value) => onChange({ fromKey: value })}
                    >
                        <SelectTrigger className={cn(err('email.from') && 'border-danger-400')}>
                            <SelectValue placeholder={t('chooseSender')} />
                        </SelectTrigger>
                        <SelectContent>
                            {senders.map((sender, index) => (
                                <SelectItem
                                    key={`${sender.email}-${index}`}
                                    value={`${sender.email}-${sender.name}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <PaperPlaneTilt className="size-3.5 shrink-0" />
                                        {sender.name} ({sender.email})
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <FieldError message={err('email.from')} />
            </div>

            <div className="space-y-1">
                <Label className="text-caption font-semibold">{t('subject')}</Label>
                <Input
                    value={config.subjectOverride}
                    onChange={(e) => onChange({ subjectOverride: e.target.value })}
                    placeholder={announcementTitle || t('usesAnnouncementTitle')}
                />
                <FieldHint>{t('subjectHint')}</FieldHint>
            </div>
        </div>
    );
}
