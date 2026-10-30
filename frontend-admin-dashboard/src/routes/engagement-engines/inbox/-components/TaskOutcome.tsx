import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { KeyValue, SubHeading } from '../../-components/engine-ui';
import { ToneBadge } from '../../-components/ToneBadge';
import type { EngagementAction, TaskOutcome } from '../../-types';
import { formatDateTime } from '../../-utils';
import { formatCallDuration, outcomeBadges, type OutcomeBadge } from '../-utils/outcome';

/** "DIALED" → "Dialed"; the dial status is a backend code with no translated wording. */
const humanize = (code: string) => {
    const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
};

/**
 * The badges for one task. A send that failed outright never went anywhere, so "not tracked"
 * or "sent" next to its Failed status would only be noise.
 */
function badgesFor(task: EngagementAction, outcome: TaskOutcome): OutcomeBadge[] {
    const badges = outcomeBadges(outcome, formatDateTime);
    return task.status === 'FAILED'
        ? badges.filter((b) => b.key !== 'notTracked' && b.key !== 'sent')
        : badges;
}

function badgeLabel(b: OutcomeBadge, t: TFunction): string {
    const label = t(`outcome.badge.${b.key}`);
    return b.detail ? `${label} · ${b.detail}` : label;
}

/** The compact outcome of one row: delivered / opened / bounced, read, connected 1:21, replied... */
export function TaskOutcomeBadges({
    task,
    outcome,
    loading,
}: {
    task: EngagementAction;
    outcome?: TaskOutcome;
    loading?: boolean;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    if (loading && !outcome) return <Skeleton className="h-5 w-24 rounded-md" />;
    if (!outcome) return null;
    const badges = badgesFor(task, outcome);
    if (badges.length === 0) return null;
    return (
        <span className="flex flex-wrap items-center gap-1.5">
            {badges.map((b) => (
                <ToneBadge key={b.key} label={badgeLabel(b, t)} tone={b.tone} />
            ))}
        </span>
    );
}

/** One yes / no row for an email flag. */
function FlagRow({ label, on, tone }: { label: string; on: boolean; tone?: 'danger' | 'success' }) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    return (
        <KeyValue label={label}>
            <span
                className={cn(
                    on && tone === 'danger' && 'text-danger-600',
                    on && tone === 'success' && 'text-success-700'
                )}
            >
                {on ? t('outcome.yes') : t('outcome.no')}
            </span>
        </KeyValue>
    );
}

/** The outcome section of the task detail: the same badges, then what each channel reports. */
export function TaskOutcomeDetail({
    task,
    outcome,
    loading,
}: {
    task: EngagementAction;
    outcome?: TaskOutcome;
    loading?: boolean;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    if (loading && !outcome) {
        return (
            <div>
                <SubHeading>{t('outcome.heading')}</SubHeading>
                <Skeleton className="h-16 w-full rounded-lg" />
            </div>
        );
    }
    if (!outcome) return null;
    const badges = badgesFor(task, outcome);
    const call = outcome.call;
    const notTracked = badges.some((b) => b.key === 'notTracked');
    // A failed send with no signal and no error code has nothing to add to its Failed status.
    if (badges.length === 0 && !outcome.errorCode && !outcome.repliedAt && !call) return null;

    return (
        <div>
            <SubHeading>{t('outcome.heading')}</SubHeading>
            {badges.length > 0 && (
                <span className="mb-1 flex flex-wrap items-center gap-1.5">
                    {badges.map((b) => (
                        <ToneBadge key={b.key} label={badgeLabel(b, t)} tone={b.tone} />
                    ))}
                </span>
            )}
            {notTracked && (
                <p className="text-neutral-500">
                    <span className="text-caption">{t('outcome.notTrackedText')}</span>
                </p>
            )}

            {outcome.channel === 'EMAIL' && outcome.tracked && (
                <>
                    <FlagRow label={t('outcome.fact.delivered')} on={outcome.delivered} />
                    <FlagRow label={t('outcome.fact.opened')} on={outcome.opened} />
                    <FlagRow label={t('outcome.fact.clicked')} on={outcome.clicked} />
                    <FlagRow label={t('outcome.fact.bounced')} on={outcome.bounced} tone="danger" />
                    <FlagRow label={t('outcome.fact.spam')} on={outcome.complained} tone="danger" />
                </>
            )}
            {outcome.channel === 'WHATSAPP' && outcome.deliveryStatus && (
                <KeyValue label={t('outcome.fact.delivery')}>
                    {t(`outcome.delivery.${outcome.deliveryStatus}`)}
                </KeyValue>
            )}
            {outcome.channel === 'AI_CALL' && call && (
                <>
                    <KeyValue label={t('outcome.fact.callStatus')}>
                        {humanize(call.status)}
                    </KeyValue>
                    {formatCallDuration(call.durationSeconds) && (
                        <KeyValue label={t('outcome.fact.callLength')}>
                            {formatCallDuration(call.durationSeconds)}
                        </KeyValue>
                    )}
                    {call.queueStatus && (
                        <KeyValue label={t('outcome.fact.dialStatus')}>
                            {humanize(call.queueStatus)}
                        </KeyValue>
                    )}
                </>
            )}
            {outcome.errorCode && (
                <KeyValue label={t('outcome.fact.errorCode')}>{outcome.errorCode}</KeyValue>
            )}
            {outcome.pricingCategory && outcome.channel === 'WHATSAPP' && (
                <KeyValue label={t('outcome.fact.category')}>
                    {humanize(outcome.pricingCategory)}
                </KeyValue>
            )}
            {outcome.repliedAt && (
                <KeyValue label={t('outcome.fact.repliedAt')}>
                    {formatDateTime(outcome.repliedAt)}
                </KeyValue>
            )}
        </div>
    );
}
