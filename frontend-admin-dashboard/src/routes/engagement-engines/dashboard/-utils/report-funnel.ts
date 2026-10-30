import type { TFunction } from 'i18next';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import { humanizeKey } from './report-format';

/**
 * True when some of the messages sent come from a channel that gives no delivery receipts
 * (email without tracking, WhatsApp on a provider with no receipts). The Delivered step then
 * leaves those messages out, so it is partial and cannot be compared with the steps around it.
 */
export const deliveryPartial = (data: EngagementDailyReport): boolean =>
    (data.email?.tracked === false && data.email.sent > 0) ||
    (data.whatsapp?.deliveryTracked === false && data.whatsapp.sent > 0);

/** Email replies are not tracked, so the Replied step counts WhatsApp replies only. */
export const emailRepliesUntracked = (data: EngagementDailyReport): boolean =>
    data.email?.repliesTracked === false;

export interface FunnelStep {
    stage: string;
    label: string;
    count: number;
    /** % lost against the previous step (negative = more than the step before); null = no figure. */
    dropOff: number | null;
    /** Delivered, when no channel that was used reports delivery: there is no real figure. */
    untracked: boolean;
    /** Delivered, when only some channels report delivery: the count is a lower bound. */
    partial: boolean;
}

/**
 * The funnel as shown on the page and in the PDF. Nothing is compared with the Delivered step
 * when it is partial or untracked: no drop-off into it and none out of it.
 */
export const buildFunnelSteps = (data: EngagementDailyReport, t: TFunction): FunnelStep[] => {
    const funnel = data.funnel;
    const incomplete = deliveryPartial(data);
    return funnel.map((s, i) => {
        const before = i > 0 ? funnel[i - 1] : undefined;
        const prev = before?.count ?? 0;
        const isDelivered = s.stage === 'DELIVERED';
        const skipDrop = incomplete && (isDelivered || before?.stage === 'DELIVERED');
        const dropOff =
            !skipDrop && before && prev > 0 ? Math.round((1 - s.count / prev) * 100) : null;
        return {
            stage: s.stage,
            label: t(`funnel.stage.${s.stage}`, { defaultValue: humanizeKey(s.stage) }),
            count: s.count,
            dropOff,
            untracked: isDelivered && incomplete && s.count === 0,
            partial: isDelivered && incomplete && s.count > 0,
        };
    });
};
