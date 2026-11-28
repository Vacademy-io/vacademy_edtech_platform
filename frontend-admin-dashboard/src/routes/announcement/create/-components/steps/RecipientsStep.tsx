import type { ReactNode } from 'react';
import { GraduationCap, Plus, UsersThree } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import type { TagItem } from '@/services/tag-management';
import type { CampaignItem } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { RecipientCard } from '../RecipientCard';
import { EmptyState, FieldError, SectionCard } from '../primitives';
import type {
    AudienceRule,
    AudienceRuleType,
    BatchOption,
    CustomFieldOption,
    FieldErrors,
} from '../../-types';

interface RecipientsStepProps {
    rules: AudienceRule[];
    onAddRule: (type: AudienceRuleType, patch?: Partial<AudienceRule>) => void;
    onUpdateRule: (key: string, patch: Partial<AudienceRule>) => void;
    onRemoveRule: (key: string) => void;
    batches: BatchOption[];
    batchesLoading: boolean;
    batchNoun: string;
    batchNounPlural: string;
    learnerNounPlural: string;
    teacherNounPlural: string;
    tags: TagItem[];
    tagsLoading: boolean;
    tagsError: string | null;
    onReloadTags: () => void;
    campaigns: CampaignItem[];
    campaignsLoading: boolean;
    campaignsError: string | null;
    onReloadCampaigns: () => void;
    customFields: CustomFieldOption[];
    tagReach: number | null;
    tagReachLoading: boolean;
    errors: FieldErrors;
    showErrors: boolean;
    /** Replaces the section icon — the email campaign page numbers its sections. */
    badge?: ReactNode;
}

export function RecipientsStep(props: RecipientsStepProps) {
    const { t } = useTranslation('announcementCreateRecipientsStep');
    const { rules, onAddRule, showErrors, errors } = props;

    const quickAdds: Array<{ label: string; run: () => void }> = [
        {
            label: t('quickAdd.allLearners', { noun: props.learnerNounPlural }),
            run: () => onAddRule('ROLE', { roleId: 'STUDENT' }),
        },
        {
            label: t('quickAdd.allTeachers', { noun: props.teacherNounPlural }),
            run: () => onAddRule('ROLE', { roleId: 'TEACHER' }),
        },
        {
            label: t('quickAdd.specificBatches', { noun: props.batchNounPlural }),
            run: () => onAddRule('PACKAGE_SESSION'),
        },
        { label: t('quickAdd.byTag'), run: () => onAddRule('TAG') },
        { label: t('quickAdd.campaign'), run: () => onAddRule('AUDIENCE') },
    ];

    return (
        <div className="space-y-6">
            <SectionCard
                title={t('sectionTitle')}
                description={t('sectionDescription')}
                Icon={UsersThree}
                badge={props.badge}
                invalid={showErrors && Boolean(errors.recipients)}
                action={
                    <MyButton buttonType="primary" scale="small" onClick={() => onAddRule('ROLE')}>
                        <Plus className="mr-1 size-4" />
                        {t('addAudience')}
                    </MyButton>
                }
            >
                <div className="flex flex-wrap gap-2">
                    {quickAdds.map((quick) => (
                        <MyButton
                            key={quick.label}
                            buttonType="secondary"
                            scale="small"
                            onClick={quick.run}
                        >
                            <Plus className="mr-1 size-4" />
                            {quick.label}
                        </MyButton>
                    ))}
                </div>

                {rules.length === 0 ? (
                    <>
                        <EmptyState
                            Icon={GraduationCap}
                            title={t('emptyTitle')}
                            description={t('emptyDescription')}
                        />
                        <FieldError message={showErrors ? errors.recipients : undefined} />
                    </>
                ) : (
                    <div className="space-y-3">
                        {rules.map((rule, index) => (
                            <RecipientCard
                                key={rule.key}
                                rule={rule}
                                index={index}
                                errors={props.errors}
                                showErrors={props.showErrors}
                                batches={props.batches}
                                batchesLoading={props.batchesLoading}
                                batchNoun={props.batchNoun}
                                batchNounPlural={props.batchNounPlural}
                                learnerNounPlural={props.learnerNounPlural}
                                teacherNounPlural={props.teacherNounPlural}
                                tags={props.tags}
                                tagsLoading={props.tagsLoading}
                                tagsError={props.tagsError}
                                onReloadTags={props.onReloadTags}
                                campaigns={props.campaigns}
                                campaignsLoading={props.campaignsLoading}
                                campaignsError={props.campaignsError}
                                onReloadCampaigns={props.onReloadCampaigns}
                                customFields={props.customFields}
                                tagReach={props.tagReach}
                                tagReachLoading={props.tagReachLoading}
                                onChange={(patch) => props.onUpdateRule(rule.key, patch)}
                                onRemove={() => props.onRemoveRule(rule.key)}
                            />
                        ))}
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
