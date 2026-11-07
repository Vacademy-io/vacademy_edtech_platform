import { BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { UnifiedSendResponse } from '@/services/unified-send-service';

/**
 * Resending one already-sent message to the learner it went to.
 *
 * Routed through admin-core rather than straight to notification-service's unified send, even
 * though admin-core only forwards it: `/notification-service/v1/send` is permitAll, so nothing
 * there can say WHO resent a message. This endpoint is authenticated and `@Auditable`, so the
 * action lands in admin_activity_log next to course and learner actions.
 */

const RESEND_URL = `${BASE_URL}/admin-core-service/v1/communication/resend`;

export interface ResendCommunicationRequest {
    instituteId: string;
    channel: 'WHATSAPP' | 'EMAIL';
    /** notification_log row being replayed — becomes the audit row's entity id. */
    sourceLogId?: string;
    /** WhatsApp only. */
    templateName?: string;
    languageCode?: string;
    /** Phone (WhatsApp) or email address (EMAIL). */
    recipient: string;
    recipientUserId?: string;
    recipientName?: string;
    variables?: Record<string, string>;
    /** True when the admin edited a value first — the audit sentence says so. */
    variablesChanged?: boolean;
    /** EMAIL only. */
    emailSubject?: string;
    /** EMAIL only. */
    emailBody?: string;
    /** WhatsApp only: IMAGE / VIDEO / DOCUMENT. */
    headerType?: string;
    /** WhatsApp only. */
    headerUrl?: string;
}

export async function resendCommunication(
    request: ResendCommunicationRequest
): Promise<UnifiedSendResponse> {
    const response = await authenticatedAxiosInstance.post<UnifiedSendResponse>(
        RESEND_URL,
        request
    );
    return response.data;
}
