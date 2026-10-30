import type { TFunction } from 'i18next';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import { kpiFailed, partFailed } from './report-errors';
import type { ReportLinks, ReportLinkTarget } from './report-links';
import {
    DASH,
    deltaAgainst,
    formatCredits,
    formatMoneyPartial,
    formatNumber,
    previousDayPoint,
    todayIso,
} from './report-format';

export type KpiKey =
    | 'peopleAdded'
    | 'messagesSent'
    | 'replies'
    | 'callsConnected'
    | 'demosBooked'
    | 'conversions'
    | 'creditsSpent'
    | 'costPerDemo';

export interface ReportKpi {
    key: KpiKey;
    label: string;
    value: string;
    detail?: string;
    /** What the number means, for the info tooltip. */
    hint: string;
    /** % against the previous day; null when the trend cannot tell. */
    delta: number | null;
    /** For cost figures, where a rise is bad news. */
    lowerIsBetter?: boolean;
    /** The items behind the number; none for a figure that is not a list of things (credits). */
    link?: ReportLinkTarget | null;
}

const has = (n: number | null | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n);

const join = (parts: Array<string | false | null | undefined>) =>
    parts.filter((p): p is string => Boolean(p)).join(' · ');

/**
 * The eight headline numbers. Day-on-day change comes from the 7-day trend, which only
 * carries messages sent, replies, demos and credits, so the other cards show no change.
 * Today is a partial day, so comparing it with a full day before would mislead: no change
 * is shown for it.
 */
export const buildKpis = (
    data: EngagementDailyReport,
    t: TFunction,
    channelLabel: (channel: string) => string,
    links: ReportLinks
): ReportKpi[] => {
    const s = data.summary;
    if (!s) return [];
    const isToday = data.date === todayIso(data.timezone);
    const prev = isToday ? null : previousDayPoint(data.trend, data.date);
    const messages = s.emailsSent + s.whatsappSent + s.inAppSent;
    // The WhatsApp charges come from their own queries; when those failed there is no figure.
    const whatsappCost = partFailed(data.errors, 'whatsappCost') ? null : s.whatsappCost;

    const channelSplit = join([
        s.emailsSent > 0 && `${channelLabel('EMAIL')} ${formatNumber(s.emailsSent)}`,
        s.whatsappSent > 0 && `${channelLabel('WHATSAPP')} ${formatNumber(s.whatsappSent)}`,
        s.inAppSent > 0 && `${channelLabel('IN_APP')} ${formatNumber(s.inAppSent)}`,
    ]);

    const emailRepliesOff = data.email?.repliesTracked === false && data.email.sent > 0;

    const costParts = join([
        has(s.costPerReply) &&
            t('kpi.costPerDemo.perReply', { value: formatCredits(s.costPerReply) }),
        has(s.costPerConversion) &&
            t('kpi.costPerDemo.perConversion', { value: formatCredits(s.costPerConversion) }),
    ]);

    const creditsDetail = join([
        has(s.creditBalance) &&
            t('kpi.creditsSpent.balance', { value: formatCredits(s.creditBalance) }),
        !!whatsappCost &&
            whatsappCost.amount > 0 &&
            t('kpi.creditsSpent.whatsapp', {
                value: formatMoneyPartial(
                    whatsappCost.amount,
                    whatsappCost.currency,
                    whatsappCost.partial,
                    t
                ),
                estimated: whatsappCost.estimated ? t('estimatedSuffix') : '',
            }),
    ]);

    // Cost per demo the day before, from that day's credits and demos in the trend.
    const prevCostPerDemo = prev && prev.demosBooked > 0 ? prev.credits / prev.demosBooked : null;
    const costPerDemo = has(s.costPerDemo) ? s.costPerDemo : null;

    const kpis: ReportKpi[] = [
        {
            key: 'peopleAdded',
            label: t('kpi.peopleAdded.label'),
            value: formatNumber(s.leadsAdded),
            detail:
                s.leadsAdded > 0
                    ? t('kpi.peopleAdded.detail', {
                          created: formatNumber(s.newLeads),
                          existing: formatNumber(s.existingLeads),
                      })
                    : undefined,
            hint: t('kpi.peopleAdded.hint'),
            delta: null,
            link: s.leadsAdded > 0 ? links.outcomes('leads') : null,
        },
        {
            key: 'messagesSent',
            label: t('kpi.messagesSent.label'),
            value: formatNumber(messages),
            detail: channelSplit || t('kpi.messagesSent.none'),
            hint: t('kpi.messagesSent.hint'),
            delta: prev ? deltaAgainst(messages, prev.sent) : null,
            link: messages > 0 ? links.inbox({ filter: 'sent' }) : null,
        },
        {
            key: 'replies',
            label: t('kpi.replies.label'),
            value: formatNumber(s.replies),
            detail: emailRepliesOff ? t('kpi.replies.emailNotTracked') : undefined,
            hint: t('kpi.replies.hint'),
            delta: prev ? deltaAgainst(s.replies, prev.replies) : null,
            link: s.replies > 0 ? links.inbox({ filter: 'sent', outcome: 'replied' }) : null,
        },
        {
            key: 'callsConnected',
            label: t('kpi.callsConnected.label'),
            value: formatNumber(s.callsConnected),
            detail:
                s.callsPlaced > 0
                    ? t('kpi.callsConnected.detail', {
                          count: s.callsPlaced,
                          placed: formatNumber(s.callsPlaced),
                      })
                    : t('kpi.callsConnected.none'),
            hint: t('kpi.callsConnected.hint'),
            delta: null,
            link:
                s.callsConnected > 0
                    ? links.inbox({ filter: 'sent', channel: 'AI_CALL', outcome: 'connected' })
                    : null,
        },
        {
            key: 'demosBooked',
            label: t('kpi.demosBooked.label'),
            value: formatNumber(s.demosBooked),
            detail:
                s.demosScheduled > 0
                    ? t('kpi.demosBooked.scheduled', { count: s.demosScheduled })
                    : undefined,
            hint: t('kpi.demosBooked.hint'),
            delta: prev ? deltaAgainst(s.demosBooked, prev.demosBooked) : null,
            link: s.demosBooked > 0 ? links.outcomes('demos') : null,
        },
        {
            key: 'conversions',
            label: t('kpi.conversions.label'),
            value: formatNumber(s.conversions),
            detail:
                s.statusChanges > 0
                    ? t('kpi.conversions.statusChanges', { count: s.statusChanges })
                    : undefined,
            hint: t('kpi.conversions.hint'),
            delta: null,
            link: s.conversions > 0 ? links.outcomes('conversions') : null,
        },
        {
            key: 'creditsSpent',
            label: t('kpi.creditsSpent.label'),
            value: formatCredits(s.creditsSpent),
            detail: creditsDetail || undefined,
            hint: t('kpi.creditsSpent.hint'),
            delta: prev ? deltaAgainst(s.creditsSpent, prev.credits) : null,
            lowerIsBetter: true,
        },
        {
            key: 'costPerDemo',
            label: t('kpi.costPerDemo.label'),
            value: costPerDemo === null ? DASH : formatCredits(costPerDemo),
            detail: join([
                costPerDemo === null ? t('kpi.costPerDemo.noDemos') : t('kpi.costPerDemo.unit'),
                costParts,
            ]),
            hint: t('kpi.costPerDemo.hint'),
            delta:
                costPerDemo !== null && prevCostPerDemo !== null
                    ? deltaAgainst(costPerDemo, prevCostPerDemo)
                    : null,
            lowerIsBetter: true,
        },
    ];

    // A card whose query failed shows a dash and says so, instead of a 0 that looks real.
    return kpis.map((k) =>
        kpiFailed(data.errors, k.key)
            ? { ...k, value: DASH, detail: t('kpi.unavailable'), delta: null, link: null }
            : k
    );
};
