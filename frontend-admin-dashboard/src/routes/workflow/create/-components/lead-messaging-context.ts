import type { LeadWorkflowKind } from '@/components/shared/leads/lead-template-variables';

interface BuilderNodeLike {
    data?: { nodeType?: string; config?: unknown };
}

interface TriggerConfigLike {
    eventName: string;
    eventAppliedType: string;
    eventId?: string;
    eventIds?: string[];
}

/**
 * Whether a SEND_WHATSAPP node messages leads, and which: the lead who just
 * submitted a form (`{#ctx['user']}` under an AUDIENCE_LEAD_SUBMISSION trigger)
 * or a follow-up's rows (`#ctx['leads']`). Null for anything else — students,
 * enrolments, query results — which keep the generic variable picker.
 *
 * `audienceId` is set only when the workflow is scoped to exactly one lead list,
 * so that list's form fields can be offered.
 */
export function leadMessagingContext(
    on: string,
    triggerConfig: TriggerConfigLike,
    nodes: BuilderNodeLike[]
): { kind: LeadWorkflowKind; audienceId?: string } | null {
    const configs = nodes.map((n) => (n.data?.config ?? {}) as Record<string, unknown>);

    if (on === "#ctx['leads']") {
        const query = configs.find((c) => c.prebuiltKey === 'fetch_audience_responses_filtered');
        const params = (query?.params ?? {}) as Record<string, unknown>;
        const audienceId = typeof params.audienceId === 'string' ? params.audienceId : '';
        return { kind: 'followup', audienceId: audienceId || undefined };
    }

    const isLeadSubmission =
        triggerConfig.eventName === 'AUDIENCE_LEAD_SUBMISSION' ||
        nodes.some(
            (n, i) =>
                n.data?.nodeType === 'TRIGGER' &&
                configs[i]?.triggerEvent === 'AUDIENCE_LEAD_SUBMISSION'
        );
    if (on === "{#ctx['user']}" && isLeadSubmission) {
        const ids =
            triggerConfig.eventAppliedType === 'AUDIENCE'
                ? triggerConfig.eventIds?.length
                    ? triggerConfig.eventIds
                    : triggerConfig.eventId
                      ? [triggerConfig.eventId]
                      : []
                : [];
        return { kind: 'confirmation', audienceId: ids.length === 1 ? ids[0] : undefined };
    }

    return null;
}
