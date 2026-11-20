import { ArrowClockwise, FlowArrow, Robot } from '@phosphor-icons/react';

/** Who sent an outgoing message, as notification-service returns it. */
export interface MessageOrigin {
    /** WORKFLOW | CHATBOT_FLOW | ADMIN_RESEND (an admin resent it from the student timeline) */
    type: string;
    id?: string;
    /** Workflow / chatbot flow / admin name; absent when it could not be resolved. */
    name?: string;
}

/**
 * The i18n key (under `origin.`) for an origin line — each namespace that shows one carries
 * `origin.workflow`, `origin.workflowUnnamed`, `origin.chatbotFlow`, `origin.chatbotFlowUnnamed`,
 * `origin.adminResend`, `origin.adminResendUnnamed`.
 * Null for an origin type the UI does not know how to name.
 */
export function messageOriginKey(origin: MessageOrigin | null | undefined): string | null {
    if (!origin) return null;
    const named = !!origin.name;
    if (origin.type === 'WORKFLOW') return named ? 'origin.workflow' : 'origin.workflowUnnamed';
    if (origin.type === 'CHATBOT_FLOW')
        return named ? 'origin.chatbotFlow' : 'origin.chatbotFlowUnnamed';
    if (origin.type === 'ADMIN_RESEND')
        return named ? 'origin.adminResend' : 'origin.adminResendUnnamed';
    return null;
}

export function MessageOriginIcon({ type, size = 12 }: { type: string; size?: number }) {
    if (type === 'CHATBOT_FLOW') return <Robot size={size} />;
    if (type === 'ADMIN_RESEND') return <ArrowClockwise size={size} />;
    return <FlowArrow size={size} />;
}
