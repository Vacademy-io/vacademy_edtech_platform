import type { ReactNode } from 'react';
import {
    CalendarBlank,
    Clock,
    EnvelopeSimple,
    Flag,
    Funnel,
    PaperPlaneTilt,
    Prohibit,
    Tag,
    TextT,
    UsersThree,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { CreateAnnouncementRequest } from '@/services/announcement';
import type { AudienceRule, BatchOption } from '../-types';
import type { EmailCampaignDraft, EmailSectionId } from '../-types';

type Recipients = CreateAnnouncementRequest['recipients'];

interface CampaignSummaryProps {
    draft: EmailCampaignDraft;
    recipients: Recipients;
    batchById: Record<string, BatchOption>;
    tagNameById: Record<string, string>;
    senderLabel: string;
    tagReach: number | null;
    tagReachLoading: boolean;
    /** Compact rows for the side rail; full rows (with audience chips) for the review dialog. */
    variant?: 'rail' | 'review';
    onEditSection?: (section: EmailSectionId) => void;
}

function Row({
    Icon: RowIcon,
    label,
    children,
    muted,
}: {
    Icon: Icon;
    label: string;
    children: ReactNode;
    muted?: boolean;
}) {
    return (
        <div className="flex items-start gap-2 py-1.5">
            <RowIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <dt className="w-28 shrink-0 text-caption text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    'min-w-0 flex-1 truncate text-caption',
                    muted ? 'text-muted-foreground' : 'font-semibold text-foreground'
                )}
            >
                {children}
            </dd>
        </div>
    );
}

const formatLocal = (value: string) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export function describeRule(
    rule: AudienceRule,
    batchById: Record<string, BatchOption>,
    tagNameById: Record<string, string>,
    t: TFunction
): string {
    switch (rule.type) {
        case 'ROLE':
            if (rule.roleId === 'STUDENT')
                return t('summary.roles.all', {
                    noun: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                });
            if (rule.roleId === 'TEACHER')
                return t('summary.roles.all', {
                    noun: getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher),
                });
            return rule.roleId
                ? t(`summary.roles.${rule.roleId}`, { defaultValue: rule.roleId })
                : '—';
        case 'PACKAGE_SESSION': {
            const names = rule.packageSessionIds.map((id) => batchById[id]?.label ?? id);
            const role = rule.orgRole ? ` (${rule.orgRole})` : '';
            return names.length ? `${names.join(', ')}${role}` : '—';
        }
        case 'USER':
            return rule.userIds.length ? rule.userIds.join(', ') : '—';
        case 'TAG':
            return rule.tagIds.length
                ? rule.tagIds.map((id) => tagNameById[id] ?? id).join(', ')
                : '—';
        case 'AUDIENCE':
            return rule.campaignIds.length
                ? rule.campaignIds.map((id) => rule.campaignNames[id] || id).join(', ')
                : '—';
        case 'CUSTOM_FIELD_FILTER':
            return (
                rule.fieldFilters
                    .filter((f) => f.fieldId)
                    .map(
                        (f) =>
                            `${f.fieldName || f.fieldId} ${f.operator ?? '='} ${
                                Array.isArray(f.filterValue)
                                    ? f.filterValue.join('/')
                                    : f.filterValue
                            }`
                    )
                    .join('; ') || '—'
            );
        default:
            return '—';
    }
}

export function CampaignSummary({
    draft,
    recipients,
    batchById,
    tagNameById,
    senderLabel,
    tagReach,
    tagReachLoading,
    variant = 'rail',
    onEditSection,
}: CampaignSummaryProps) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    const batchNoun = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const exclusionCount = draft.rules.reduce(
        (sum, rule) => sum + rule.exclusions.filter((e) => e.exclusionId).length,
        0
    );
    const filterCount = draft.rules.reduce(
        (sum, rule) => sum + rule.fieldFilters.filter((f) => f.fieldId).length,
        0
    );
    const usesTags = draft.rules.some((rule) => rule.type === 'TAG' && rule.tagIds.length > 0);

    const schedule =
        draft.scheduleType === 'IMMEDIATE'
            ? t('summary.schedule.immediate')
            : draft.scheduleType === 'ONE_TIME'
              ? draft.oneTimeStart
                  ? t('summary.schedule.oneTime', { when: formatLocal(draft.oneTimeStart) })
                  : t('summary.schedule.oneTimeUnset')
              : draft.cronExpression
                ? t('summary.schedule.recurring', { cron: draft.cronExpression })
                : t('summary.schedule.recurringUnset');

    const audienceText =
        recipients.length === 0
            ? t('summary.audience.none')
            : t('summary.audience.count', { count: recipients.length });

    const editLink = (section: EmailSectionId) =>
        onEditSection ? (
            <button
                type="button"
                onClick={() => onEditSection(section)}
                className="ms-2 text-caption font-semibold text-primary-500 hover:underline"
            >
                {t('summary.edit')}
            </button>
        ) : null;

    return (
        <div className="space-y-3">
            <dl className="divide-y divide-border">
                <Row Icon={TextT} label={t('summary.campaignName')} muted={!draft.title}>
                    {draft.title || t('summary.notSet')}
                    {editLink('details')}
                </Row>
                <Row Icon={EnvelopeSimple} label={t('summary.subject')} muted={!draft.subject}>
                    {draft.subject || t('summary.notSet')}
                </Row>
                <Row
                    Icon={UsersThree}
                    label={t('summary.audience.label')}
                    muted={!recipients.length}
                >
                    {audienceText}
                    {editLink('audience')}
                </Row>
                {usesTags && (
                    <Row Icon={Tag} label={t('summary.tagReach')} muted={tagReach === null}>
                        {tagReachLoading
                            ? t('summary.estimating')
                            : tagReach === null
                              ? t('summary.unavailable')
                              : t('summary.people', { count: tagReach })}
                    </Row>
                )}
                <Row Icon={PaperPlaneTilt} label={t('summary.from')} muted={!senderLabel}>
                    {senderLabel || t('summary.notSet')}
                    {editLink('settings')}
                </Row>
                <Row Icon={Flag} label={t('summary.priority')}>
                    {t(`settings.priority.options.${draft.priority}`)}
                </Row>
                <Row Icon={CalendarBlank} label={t('summary.schedule.label')}>
                    {schedule}
                </Row>
                <Row Icon={Clock} label={t('summary.expires')} muted={!draft.expiresAt}>
                    {draft.expiresAt ? formatLocal(draft.expiresAt) : t('summary.notSet')}
                </Row>
                <Row Icon={Prohibit} label={t('summary.exclusions')} muted={exclusionCount === 0}>
                    {exclusionCount === 0 ? t('summary.none') : exclusionCount}
                </Row>
                <Row Icon={Funnel} label={t('summary.filters')} muted={filterCount === 0}>
                    {filterCount === 0 ? t('summary.none') : filterCount}
                </Row>
            </dl>

            {variant === 'review' && draft.rules.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                    <p className="text-caption font-semibold text-muted-foreground">
                        {t('summary.audience.breakdown')}
                    </p>
                    <ul className="flex flex-wrap gap-2">
                        {draft.rules.map((rule) => (
                            <li
                                key={rule.key}
                                className="max-w-full truncate rounded-full border bg-muted/40 px-2.5 py-1 text-caption"
                                title={describeRule(rule, batchById, tagNameById, t)}
                            >
                                <span className="font-semibold">
                                    {rule.type === 'PACKAGE_SESSION'
                                        ? batchNoun
                                        : t(`summary.ruleType.${rule.type}`)}
                                </span>
                                <span className="text-muted-foreground"> · </span>
                                {describeRule(rule, batchById, tagNameById, t)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
