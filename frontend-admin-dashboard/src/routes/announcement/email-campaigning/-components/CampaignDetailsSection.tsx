import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SectionCard } from '../../create/-components/primitives';
import { CharCount, Field, StepBadge } from './primitives';
import { PREVIEW_SOFT_MAX, SUBJECT_SOFT_MAX, TITLE_MAX } from '../-utils/validation';
import type { FieldErrors } from '../-types';

interface CampaignDetailsSectionProps {
    title: string;
    onTitleChange: (value: string) => void;
    subject: string;
    onSubjectChange: (value: string) => void;
    previewText: string;
    onPreviewTextChange: (value: string) => void;
    errors: FieldErrors;
    showErrors: boolean;
    disabled?: boolean;
}

export function CampaignDetailsSection({
    title,
    onTitleChange,
    subject,
    onSubjectChange,
    previewText,
    onPreviewTextChange,
    errors,
    showErrors,
    disabled,
}: CampaignDetailsSectionProps) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    const err = (key: string) => (showErrors ? errors[key] : undefined);
    const invalid = Boolean(err('title') || err('subject'));
    const done = !invalid && title.trim().length > 0 && subject.trim().length > 0;

    return (
        <SectionCard
            title={t('details.title')}
            description={t('details.description')}
            badge={<StepBadge step={1} invalid={invalid} done={done} />}
            invalid={invalid}
        >
            <div className="grid gap-4 md:grid-cols-2">
                <Field
                    label={t('details.campaignName.label')}
                    hint={t('details.campaignName.hint')}
                    required
                    error={err('title')}
                    htmlFor="email-campaign-title"
                    trailing={<CharCount value={title.length} soft={TITLE_MAX} />}
                >
                    <Input
                        id="email-campaign-title"
                        value={title}
                        onChange={(e) => onTitleChange(e.target.value)}
                        placeholder={t('details.campaignName.placeholder')}
                        maxLength={TITLE_MAX}
                        disabled={disabled}
                        aria-invalid={Boolean(err('title'))}
                        className={cn(err('title') && 'border-danger-400')}
                    />
                </Field>

                <Field
                    label={t('details.subject.label')}
                    hint={t('details.subject.hint')}
                    required
                    error={err('subject')}
                    htmlFor="email-campaign-subject"
                    trailing={<CharCount value={subject.length} soft={SUBJECT_SOFT_MAX} />}
                >
                    <Input
                        id="email-campaign-subject"
                        value={subject}
                        onChange={(e) => onSubjectChange(e.target.value)}
                        placeholder={t('details.subject.placeholder')}
                        disabled={disabled}
                        aria-invalid={Boolean(err('subject'))}
                        className={cn(err('subject') && 'border-danger-400')}
                    />
                </Field>
            </div>

            <Field
                label={t('details.previewText.label')}
                hint={t('details.previewText.hint')}
                htmlFor="email-campaign-preview-text"
                trailing={<CharCount value={previewText.length} soft={PREVIEW_SOFT_MAX} />}
            >
                <Input
                    id="email-campaign-preview-text"
                    value={previewText}
                    onChange={(e) => onPreviewTextChange(e.target.value)}
                    placeholder={t('details.previewText.placeholder')}
                    disabled={disabled}
                />
            </Field>
        </SectionCard>
    );
}
