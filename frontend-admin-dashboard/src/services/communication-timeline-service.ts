import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import type { WhatsAppTemplateButton } from '@/components/shared/whatsapp/whatsapp-template-buttons';
import type { MessageOrigin } from '@/components/shared/whatsapp/message-origin';

export interface StatusEvent {
    status: string;
    timestamp: string;
    details?: string;
}

export interface CommunicationItem {
    id: string;
    channel: 'EMAIL' | 'WHATSAPP' | 'PUSH' | 'SMS';
    direction: 'OUTBOUND' | 'INBOUND';
    title: string;
    /**
     * Outbound email subject, as the send stored it. Absent for other channels and for rows written
     * before notification_service returned it — callers fall back to scraping `title`/`fullBody`.
     */
    subject?: string;
    bodyPreview: string;
    fullBody?: string;
    templateName?: string;
    /** WhatsApp template header type: NONE, TEXT, IMAGE, VIDEO, DOCUMENT. */
    headerType?: string;
    /** Media URL for an IMAGE/VIDEO/DOCUMENT template header. */
    headerMediaUrl?: string;
    /** WhatsApp template buttons, drawn under the message the way WhatsApp shows them. */
    buttons?: WhatsAppTemplateButton[] | null;
    /** Who sent this WhatsApp message — a workflow or a chatbot flow; null when unknown. */
    origin?: MessageOrigin | null;
    status: string;
    statusTimeline: StatusEvent[];
    senderInfo: string;
    recipientInfo: string;
    timestamp: string;
    source: string;
    sourceId: string;
    metadata?: Record<string, unknown>;
}

export interface CommunicationTimelineResponse {
    content: CommunicationItem[];
    totalPages: number;
    totalElements: number;
    last: boolean;
    numberOfElements: number;
    size: number;
    number: number;
    first: boolean;
    empty: boolean;
}

export interface CommunicationTimelineParams {
    /** User's email address — used as channelId for EMAIL logs. */
    email?: string;
    /** User's phone number — used as channelId for WhatsApp logs. */
    phone?: string;
    page: number;
    size: number;
    channels?: string[];
    direction?: string;
    fromDate?: string;
    toDate?: string;
}

export async function getUserCommunications(
    params: CommunicationTimelineParams
): Promise<CommunicationTimelineResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('page', String(params.page));
    searchParams.set('size', String(params.size));

    if (params.email) searchParams.set('email', params.email);
    if (params.phone) searchParams.set('phone', params.phone);

    if (params.channels && params.channels.length > 0) {
        params.channels.forEach((ch) => searchParams.append('channels', ch));
    }
    if (params.direction) {
        searchParams.set('direction', params.direction);
    }
    if (params.fromDate) {
        searchParams.set('fromDate', params.fromDate);
    }
    if (params.toDate) {
        searchParams.set('toDate', params.toDate);
    }

    const url = `${BASE_URL}/notification-service/v1/communications/by-channel?${searchParams.toString()}`;

    const response = await authenticatedAxiosInstance.get<CommunicationTimelineResponse>(url);
    return response.data;
}
