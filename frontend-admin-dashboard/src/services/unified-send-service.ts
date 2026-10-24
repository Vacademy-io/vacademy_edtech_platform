/**
 * Unified Send Service
 *
 * Single API for sending WhatsApp, Email, Push, and System Alert notifications.
 * Handles sync (<=100 recipients) and async batch (>100) automatically.
 */

import { NOTIFICATION_SERVICE_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

const UNIFIED_SEND_BASE = `${NOTIFICATION_SERVICE_BASE}/send`;

// ==================== Types ====================

export interface UnifiedSendRecipient {
    phone?: string;
    email?: string;
    userId?: string;
    name?: string;
    variables?: Record<string, string>;
}

export interface UnifiedSendOptions {
    // Email
    emailSubject?: string;
    emailBody?: string;
    emailType?: 'UTILITY_EMAIL' | 'PROMOTIONAL_EMAIL' | 'TRANSACTIONAL_EMAIL';
    fromEmail?: string;
    fromName?: string;

    // WhatsApp
    headerType?: 'image' | 'video' | 'document';
    headerUrl?: string;
    buttonUrlParams?: Record<string, string>;

    // Push
    pushTitle?: string;
    pushBody?: string;
    pushData?: Record<string, string>;

    // General
    source?: string;
    sourceId?: string;
}

export interface UnifiedSendRequest {
    instituteId: string;
    channel: 'WHATSAPP' | 'EMAIL' | 'PUSH' | 'SYSTEM_ALERT';
    templateName?: string;
    languageCode?: string;
    recipients: UnifiedSendRecipient[];
    options?: UnifiedSendOptions;
    /**
     * Queue the send as a durable batch even under the 100-recipient sync
     * threshold. Set this for bulk sends — the sync path sends one provider
     * call per recipient inside the request and can hit gateway/internal
     * timeouts; the response then carries batchId for polling.
     */
    forceAsync?: boolean;
}

export interface RecipientResult {
    phone?: string;
    email?: string;
    success: boolean;
    status: 'SENT' | 'FAILED' | 'SKIPPED_OPT_OUT' | 'QUEUED';
    error?: string;
    /**
     * Provider message id (WhatsApp wamid) for an accepted send. Feed it to getDeliveryStatus to
     * find out what actually happened — `status: 'SENT'` above only means the provider took it.
     */
    messageId?: string;
}

export interface DeliveryStatus {
    messageId: string;
    /** PENDING = no verdict from the provider yet. It is a "still waiting", never a failure. */
    status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
    errorCode?: string;
    errorMessage?: string;
    reportedAt?: string;
    /** True once the outcome can no longer change, so a poller knows to stop. */
    settled: boolean;
}

export interface UnifiedSendResponse {
    batchId?: string;
    total: number;
    accepted: number;
    failed: number;
    status: 'COMPLETED' | 'PROCESSING' | 'PARTIAL' | 'FAILED';
    results?: RecipientResult[];
}

// ==================== API Functions ====================

/**
 * Send a notification via the unified API.
 * For <=100 recipients, returns results immediately.
 * For >100 recipients, returns a batchId for polling.
 */
export async function sendNotification(
    request: UnifiedSendRequest
): Promise<UnifiedSendResponse> {
    const response = await authenticatedAxiosInstance.post<UnifiedSendResponse>(
        UNIFIED_SEND_BASE,
        request
    );
    return response.data;
}

/**
 * Ask what the provider actually did with messages already sent.
 *
 * Sending returns as soon as WhatsApp accepts the message, and acceptance is not delivery: a message
 * accepted at 06:51:47 is regularly rejected at 06:51:48 (131042 payment issue, 131049 marketing
 * cap, 131026 undeliverable). Anything that shows the user an outcome should send, then poll this.
 */
export async function getDeliveryStatus(messageIds: string[]): Promise<DeliveryStatus[]> {
    if (messageIds.length === 0) return [];
    // Comma-joined, not an array param: axios serialises arrays as `messageIds[]=`, and the raw
    // brackets make the ingress reject the request with a 400 before it reaches the service.
    // Spring splits a comma-separated value into List<String> on its own.
    const response = await authenticatedAxiosInstance.get<DeliveryStatus[]>(
        `${UNIFIED_SEND_BASE}/delivery-status`,
        { params: { messageIds: messageIds.join(',') } }
    );
    return response.data;
}

/**
 * Poll batch status for async sends (>100 recipients).
 */
export async function getBatchStatus(
    batchId: string
): Promise<UnifiedSendResponse> {
    const response = await authenticatedAxiosInstance.get<UnifiedSendResponse>(
        `${UNIFIED_SEND_BASE}/${batchId}/status`
    );
    return response.data;
}

/**
 * Poll until batch completes. Returns final status.
 * Polls every 2 seconds, max 60 attempts (2 minutes).
 */
export async function waitForBatchCompletion(
    batchId: string,
    onProgress?: (status: UnifiedSendResponse) => void,
    maxAttempts = 60
): Promise<UnifiedSendResponse> {
    for (let i = 0; i < maxAttempts; i++) {
        const status = await getBatchStatus(batchId);
        onProgress?.(status);

        if (status.status !== 'PROCESSING') {
            return status;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error('Batch processing timed out');
}

// ==================== Convenience Helpers ====================

/**
 * Send WhatsApp template to multiple recipients.
 */
export function sendWhatsAppTemplate(
    instituteId: string,
    templateName: string,
    recipients: UnifiedSendRecipient[],
    options?: Partial<UnifiedSendOptions>
): Promise<UnifiedSendResponse> {
    return sendNotification({
        instituteId,
        channel: 'WHATSAPP',
        templateName,
        languageCode: 'en',
        recipients,
        options: options as UnifiedSendOptions,
    });
}

/**
 * Send email to multiple recipients.
 */
export function sendBulkEmail(
    instituteId: string,
    subject: string,
    body: string,
    recipients: UnifiedSendRecipient[],
    options?: Partial<UnifiedSendOptions>
): Promise<UnifiedSendResponse> {
    return sendNotification({
        instituteId,
        channel: 'EMAIL',
        recipients,
        options: {
            emailSubject: subject,
            emailBody: body,
            ...options,
        } as UnifiedSendOptions,
    });
}
