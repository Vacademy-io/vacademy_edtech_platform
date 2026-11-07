import { FlowArrow, Robot } from '@phosphor-icons/react';

/** Who sent an outgoing WhatsApp message, as notification-service returns it. */
export interface MessageOrigin {
    /** WORKFLOW | CHATBOT_FLOW */
    type: string;
    id?: string;
    /** Workflow / chatbot flow name; absent when it could not be resolved. */
    name?: string;
}

/**
 * The i18n key (under `origin.`) for an origin line — each namespace that shows one carries
 * `origin.workflow`, `origin.workflowUnnamed`, `origin.chatbotFlow`, `origin.chatbotFlowUnnamed`.
 * Null for an origin type the UI does not know how to name.
 */
export function messageOriginKey(origin: MessageOrigin | null | undefined): string | null {
    if (!origin) return null;
    const named = !!origin.name;
    if (origin.type === 'WORKFLOW') return named ? 'origin.workflow' : 'origin.workflowUnnamed';
    if (origin.type === 'CHATBOT_FLOW')
        return named ? 'origin.chatbotFlow' : 'origin.chatbotFlowUnnamed';
    return null;
}

export function MessageOriginIcon({ type, size = 12 }: { type: string; size?: number }) {
    return type === 'CHATBOT_FLOW' ? <Robot size={size} /> : <FlowArrow size={size} />;
}
