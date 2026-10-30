import type { OutcomeTab } from './outcomes-params';

/*
 * Where each number on the report leads: the Task Inbox (the engine's activity: messages,
 * calls, failures, decisions to wait) or the Leads & outcomes page (the people). A link always
 * carries the day, so it keeps showing the same numbers when shared or opened later, and the
 * engine when one is picked.
 */

export const INBOX_PATH = '/engagement-engines/inbox' as const;
export const OUTCOMES_PATH = '/engagement-engines/dashboard/outcomes' as const;

export interface ReportLinkTarget {
    to: typeof INBOX_PATH | typeof OUTCOMES_PATH;
    search: Record<string, string>;
}

export type InboxLinkFilter = 'sent' | 'failed' | 'waited';
export type LinkChannel = 'EMAIL' | 'WHATSAPP' | 'IN_APP' | 'AI_CALL';
/** What happened to a message or call, as the inbox's `outcome` filter spells it. */
export type InboxLinkOutcome =
    | 'delivered'
    | 'opened'
    | 'clicked'
    | 'bounced'
    | 'complained'
    | 'read'
    | 'replied'
    | 'failed'
    | 'connected'
    | 'no_answer'
    | 'busy'
    | 'call_failed';

export interface InboxLinkParams {
    filter: InboxLinkFilter;
    channel?: LinkChannel | string;
    outcome?: InboxLinkOutcome;
    /** A WhatsApp template name or an email subject, exactly as the report lists it. */
    template?: string;
    /** A different engine than the report's own (a row of the per-engine table). */
    engineId?: string | null;
}

export interface ReportLinks {
    inbox: (params: InboxLinkParams) => ReportLinkTarget | null;
    outcomes: (
        tab: OutcomeTab,
        filter?: string,
        engineId?: string | null
    ) => ReportLinkTarget | null;
}

/** Only the channels the inbox filters by; anything else is left out of the link. */
const CHANNELS = new Set(['EMAIL', 'WHATSAPP', 'IN_APP', 'AI_CALL']);

/**
 * Link builders for one report: the engine it covers (null = all engines, so no `engine`
 * param) and its day. Without a day there is nothing stable to link to, so no links are made.
 */
export const makeReportLinks = (engineId: string | null, date: string): ReportLinks => {
    const base = (engine: string | null | undefined): Record<string, string> => ({
        ...(engine ? { engine } : {}),
        date,
    });
    const engineOf = (override: string | null | undefined) =>
        override === undefined ? engineId : override;
    return {
        inbox: (p) => {
            if (!date) return null;
            return {
                to: INBOX_PATH,
                search: {
                    filter: p.filter,
                    ...(p.channel && CHANNELS.has(p.channel) ? { channel: p.channel } : {}),
                    ...(p.outcome ? { outcome: p.outcome } : {}),
                    ...(p.template ? { template: p.template } : {}),
                    ...base(engineOf(p.engineId)),
                },
            };
        },
        outcomes: (tab, filter, override) => {
            if (!date) return null;
            return {
                to: OUTCOMES_PATH,
                search: {
                    tab,
                    ...(filter ? { filter } : {}),
                    ...base(engineOf(override)),
                },
            };
        },
    };
};
