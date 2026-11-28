import type { TFunction } from 'i18next';
import type {
    DailyReportHealthSeverity,
    EngagementDailyReport,
} from '@/services/engagement-daily-report';
import { formatNumber, formatRate, humanizeKey } from './report-format';

export interface HealthBanner {
    key: string;
    severity: DailyReportHealthSeverity;
    title: string;
    text: string;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** "about 2 days", "less than a day", or "soon" when the server sent no figure. */
export const formatRunway = (days: number | null | undefined, t: TFunction): string => {
    if (days === null || days === undefined || !Number.isFinite(days)) return t('runway.soon');
    if (days < 1) return t('runway.lessThanDay');
    return t('runway.about', { count: Math.max(1, Math.round(days)) });
};

/**
 * Turns the server's health codes into plain-language banners, critical first.
 * The server only sends a code, a severity and one figure (a rate, a count or days
 * depending on the code), so the wording lives here. Where the figure is missing it
 * is read from the report itself.
 */
export const buildHealthBanners = (data: EngagementDailyReport, t: TFunction): HealthBanner[] => {
    const out: HealthBanner[] = [];
    const sorted = [...data.health].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    );

    // Copy is looked up per severity first (health.CODE.severity.title), then per code.
    const copy = (code: string, severity: string, vars: Record<string, unknown>) => ({
        title: t([`health.${code}.${severity}.title`, `health.${code}.title`], vars),
        text: t([`health.${code}.${severity}.text`, `health.${code}.text`], vars),
    });

    sorted.forEach((item, index) => {
        const key = `${item.code}-${index}`;
        const { severity, code } = item;
        const value = item.value ?? null;

        switch (code) {
            case 'EMAIL_BOUNCE_HIGH': {
                const rate = formatRate(value ?? data.email?.bounceRate ?? null);
                out.push({ key, severity, ...copy(code, severity, { rate }) });
                break;
            }
            case 'EMAIL_COMPLAINTS': {
                const count = Math.max(1, Math.round(value ?? data.email?.complained ?? 1));
                out.push({ key, severity, ...copy(code, severity, { count }) });
                break;
            }
            case 'WHATSAPP_FAILED_HIGH': {
                const sent = data.whatsapp?.sent ?? 0;
                const fallback = sent > 0 ? (data.whatsapp?.failed ?? 0) / sent : null;
                out.push({
                    key,
                    severity,
                    ...copy(code, severity, { rate: formatRate(value ?? fallback) }),
                });
                break;
            }
            case 'OPT_OUTS': {
                const count = Math.max(1, Math.round(value ?? data.summary?.optOuts ?? 1));
                out.push({ key, severity, ...copy(code, severity, { count }) });
                break;
            }
            case 'CREDITS_LOW': {
                const runway = formatRunway(value ?? data.summary?.creditRunwayDays, t);
                out.push({ key, severity, ...copy(code, severity, { runway }) });
                break;
            }
            case 'TRACKING_OFF': {
                // One item per channel when the server says which; otherwise the report does.
                const channel = item.channel?.toUpperCase();
                const emailOff =
                    channel === 'EMAIL' ||
                    (!channel && data.email?.tracked === false && data.email.sent > 0);
                const whatsappOff =
                    channel === 'WHATSAPP' ||
                    (!channel &&
                        data.whatsapp?.deliveryTracked === false &&
                        data.whatsapp.sent > 0);
                if (emailOff) {
                    out.push({
                        key: `${key}-email`,
                        severity,
                        title: t('health.TRACKING_OFF.email.title'),
                        text: t('health.TRACKING_OFF.email.text'),
                    });
                }
                if (whatsappOff) {
                    out.push({
                        key: `${key}-whatsapp`,
                        severity,
                        title: t('health.TRACKING_OFF.whatsapp.title'),
                        text: t('health.TRACKING_OFF.whatsapp.text'),
                    });
                }
                if (!emailOff && !whatsappOff) {
                    out.push({
                        key,
                        severity,
                        title: t('health.TRACKING_OFF.generic.title'),
                        text: t('health.TRACKING_OFF.generic.text'),
                    });
                }
                break;
            }
            default:
                out.push({
                    key,
                    severity,
                    title: t('health.unknown.title', { name: humanizeKey(code) }),
                    text: t('health.unknown.text', {
                        value: value === null ? '' : formatNumber(value),
                    }),
                });
        }
    });
    return out;
};
