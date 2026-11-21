import { CheckCircle, ListChecks, PencilSimple } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import type { MediumType, ModeType } from '@/services/announcement';
import type { CreateAnnouncementRequest } from '@/services/announcement';
import { buildMediumMeta, buildModeMeta } from '../../-utils/constants';
import { SectionCard, SummaryRow } from '../primitives';
import type { AudienceRule, BatchOption, ScheduleType, FormSectionId } from '../../-types';

interface ReviewStepProps {
    title: string;
    previewText: string;
    contentText: string;
    rules: AudienceRule[];
    batchById: Record<string, BatchOption>;
    tagNameById: Record<string, string>;
    recipients: CreateAnnouncementRequest['recipients'];
    modes: ModeType[];
    mediums: MediumType[];
    emailSenderLabel: string;
    whatsappTemplateName: string;
    scheduleType: ScheduleType;
    timezone: string;
    oneTimeStart: string;
    cronExpression: string;
    batchNounPlural: string;
    onEditSection: (step: FormSectionId) => void;
}

const Chip = ({ children }: { children: React.ReactNode }) => (
    <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-caption text-foreground">
        {children}
    </span>
);

function describeRule(
    rule: AudienceRule,
    batchById: Record<string, BatchOption>,
    tagNameById: Record<string, string>,
    batchNounPlural: string,
    t: TFunction
): string {
    switch (rule.type) {
        case 'ROLE':
            return t('rule.role', { role: rule.roleId.toLowerCase() });
        case 'PACKAGE_SESSION': {
            const names = rule.packageSessionIds
                .map((id) => batchById[id]?.label ?? id)
                .slice(0, 3)
                .join(', ');
            const extra = rule.packageSessionIds.length - 3;
            const roleSuffix = rule.orgRole
                ? t('rule.orgRoleSuffix', { role: rule.orgRole.toLowerCase() })
                : '';
            const extraSuffix = extra > 0 ? t('rule.andMore', { count: extra }) : '';
            return t('rule.packageSession', {
                count: rule.packageSessionIds.length,
                noun: batchNounPlural,
                roleSuffix,
                names,
                extraSuffix,
            });
        }
        case 'USER':
            return t('rule.specificPeople', { count: rule.userIds.length });
        case 'TAG':
            return t('rule.tag', {
                tags: rule.tagIds.map((id) => tagNameById[id] ?? id).join(', '),
            });
        case 'AUDIENCE':
            return t('rule.audience', {
                campaign: rule.campaignIds.map((id) => rule.campaignNames[id] || id).join(', '),
            });
        case 'CUSTOM_FIELD_FILTER':
            return t('rule.customFieldFilter', {
                filters: rule.fieldFilters
                    .filter((f) => f.fieldId)
                    .map(
                        (f) =>
                            `${f.fieldName} ${f.operator ?? 'is'} ${
                                Array.isArray(f.filterValue)
                                    ? f.filterValue.join('/')
                                    : f.filterValue
                            }`
                    )
                    .join('; '),
            });
        default:
            return '—';
    }
}

export function ReviewStep(props: ReviewStepProps) {
    const { t } = useTranslation('announcementCreateReviewStep');
    const modeMeta = buildModeMeta(t);
    const mediumMeta = buildMediumMeta(t);

    const scheduleLabel =
        props.scheduleType === 'IMMEDIATE'
            ? t('scheduleImmediate', { timezone: props.timezone })
            : props.scheduleType === 'ONE_TIME'
              ? t('scheduleOneTime', {
                    datetime: props.oneTimeStart.replace('T', ', ') || '—',
                    timezone: props.timezone,
                })
              : t('scheduleRecurring', {
                    cron: props.cronExpression || '—',
                    timezone: props.timezone,
                });

    const EditButton = ({ step }: { step: FormSectionId }) => (
        <MyButton buttonType="text" scale="small" onClick={() => props.onEditSection(step)}>
            <PencilSimple className="mr-1 size-4" />
            {t('editButton')}
        </MyButton>
    );

    return (
        <div className="space-y-6">
            <SectionCard
                title={t('messageSectionTitle')}
                Icon={ListChecks}
                action={<EditButton step="basics" />}
            >
                <dl className="divide-y">
                    <SummaryRow label={t('titleLabel')}>{props.title || '—'}</SummaryRow>
                    <SummaryRow label={t('previewTextLabel')}>
                        {props.previewText || '—'}
                    </SummaryRow>
                    <SummaryRow label={t('contentLabel')}>
                        <p className="line-clamp-3 text-muted-foreground">
                            {props.contentText || '—'}
                        </p>
                    </SummaryRow>
                </dl>
            </SectionCard>

            <SectionCard
                title={t('recipientsSectionTitle')}
                description={t('recipientsDescription', { count: props.recipients.length })}
                Icon={CheckCircle}
                action={<EditButton step="recipients" />}
            >
                {props.rules.length === 0 ? (
                    <p className="text-body text-muted-foreground">{t('noAudience')}</p>
                ) : (
                    <ul className="space-y-2">
                        {props.rules.map((rule) => (
                            <li
                                key={rule.key}
                                className="rounded-md border bg-muted/30 px-3 py-2 text-body"
                            >
                                {describeRule(
                                    rule,
                                    props.batchById,
                                    props.tagNameById,
                                    props.batchNounPlural,
                                    t
                                )}
                                {(rule.exclusions.length > 0 || rule.fieldFilters.length > 0) && (
                                    <span className="mt-1 flex flex-wrap gap-1.5">
                                        {rule.fieldFilters.length > 0 && (
                                            <Chip>
                                                {t('filterCount', {
                                                    count: rule.fieldFilters.length,
                                                })}
                                            </Chip>
                                        )}
                                        {rule.exclusions.length > 0 && (
                                            <Chip>
                                                {t('exclusionCount', {
                                                    count: rule.exclusions.length,
                                                })}
                                            </Chip>
                                        )}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </SectionCard>

            <SectionCard
                title={t('placementSectionTitle')}
                Icon={CheckCircle}
                action={<EditButton step="delivery" />}
            >
                <dl className="divide-y">
                    <SummaryRow label={t('appearsInLabel')}>
                        <span className="flex flex-wrap gap-1.5">
                            {props.modes.length === 0
                                ? '—'
                                : props.modes.map((mode) => (
                                      <Chip key={mode}>
                                          {modeMeta.find((m) => m.type === mode)?.label ?? mode}
                                      </Chip>
                                  ))}
                        </span>
                    </SummaryRow>
                    <SummaryRow label={t('deliveredViaLabel')}>
                        <span className="flex flex-wrap gap-1.5">
                            {props.mediums.length === 0
                                ? t('inProductOnly')
                                : props.mediums.map((medium) => (
                                      <Chip key={medium}>
                                          {mediumMeta.find((m) => m.type === medium)?.label ??
                                              medium}
                                      </Chip>
                                  ))}
                        </span>
                    </SummaryRow>
                    {props.mediums.includes('EMAIL') && (
                        <SummaryRow label={t('emailFromLabel')}>
                            {props.emailSenderLabel || '—'}
                        </SummaryRow>
                    )}
                    {props.mediums.includes('WHATSAPP') && (
                        <SummaryRow label={t('whatsappTemplateLabel')}>
                            {props.whatsappTemplateName || '—'}
                        </SummaryRow>
                    )}
                    <SummaryRow label={t('scheduleLabel')}>{scheduleLabel}</SummaryRow>
                </dl>
            </SectionCard>
        </div>
    );
}
