import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { EMAIL_INBOX_BASE } from '@/constants/urls';

/** Where an outbound email came from (what the admin sees as a chip on the bubble). */
export type EmailOutgoingOrigin = 'CAMPAIGN' | 'INBOX_REPLY' | 'OTP' | 'AUTOMATION' | 'EMAIL';
/** What an inbound email is: a reply to something we sent, unsolicited, or a mail-system bounce. */
export type EmailIncomingOrigin = 'REPLY' | 'INCOMING' | 'BOUNCE';

export interface EmailConversation {
    email: string;
    name?: string;
    userId?: string;
    lastMessageDirection?: 'OUTGOING' | 'INCOMING';
    /** Subject when known, else a clean body snippet. No "You:" prefix — the list adds it. */
    lastMessagePreview?: string;
    lastMessageTime?: string;
    unreadCount?: number;
    /** The counterparty is a mail-system sender (mailer-daemon / postmaster / no-reply-aws). */
    system?: boolean;
    lastMessageSubject?: string;
    /** The counterparty sent at least one email with a real (non-inline) attachment. */
    hasAttachments?: boolean;
}

/** One file on an inbound email. Bytes come from getEmailAttachmentBlob(). */
export interface EmailAttachment {
    /** MIME part id ("2", "1.2") — pass back to the attachment endpoint. */
    id: string;
    filename: string;
    contentType: string;
    /** Decoded bytes; -1 when unknown. */
    size: number;
    /** An image the HTML body shows in place (cid:), not a file attached to the email. */
    inline: boolean;
}

export interface EmailMessage {
    id: string;
    direction: 'OUTGOING' | 'INCOMING';
    /** Populated for OUTGOING too when the backend knows it (payload subject or campaign title). */
    subject?: string;
    /** Clean plain text (entities decoded, hidden preheader characters removed), <= 120 chars. */
    bodyPreview?: string;
    /** OUTGOING: raw HTML. INCOMING: plain text, quoted chain included. */
    body?: string;
    counterpartyEmail: string;
    /** Display name of the other party when known (inbound From personal name). */
    counterpartyName?: string;
    instituteAddress?: string;
    timestamp: string;
    /**
     * Raw producer tag kept for compatibility ('unified-send', 'announcement-service', or — on
     * older inbound rows — the parent outbound log UUID). Never render it verbatim; use
     * resolveOrigin() from ../-utils/email-text instead.
     */
    source?: string;
    /** Absent from responses of a backend that predates the field; resolveOrigin() derives it. */
    origin?: EmailOutgoingOrigin | EmailIncomingOrigin;
    /** True for bounces / mail-system auto notifications. */
    system?: boolean;
    /** INCOMING only: the outbound notification_log id this replies to. */
    inReplyToId?: string;
    /**
     * OUTGOING only: FAILED / BOUNCED / DEFERRED / SENT when recorded. Absent = treat as sent.
     */
    deliveryStatus?: string;
    /** Why a FAILED / BOUNCED send did not go out. */
    deliveryErrorMessage?: string;
    /** INCOMING only: files on the email (empty when none / not yet indexed). */
    attachments?: EmailAttachment[];
    /** INCOMING only: the original HTML body is available from getInboundEmailHtml(). */
    hasHtml?: boolean;
}

export interface EmailInboxStatus {
    inboundConfigured: boolean;
}

export type EmailDirectionFilter = 'ALL' | 'SENT' | 'RECEIVED';

export interface EmailInboxFilters {
    /** Narrow to one institute sender. Empty/undefined = all configured senders. */
    instituteAddress?: string;
    /** Direction filter. ALL = both sent + received. */
    direction?: EmailDirectionFilter;
}

function buildFilterParams(filters?: EmailInboxFilters): Record<string, string | number> {
    const p: Record<string, string | number> = {};
    if (filters?.instituteAddress) p.instituteAddress = filters.instituteAddress;
    if (filters?.direction && filters.direction !== 'ALL') p.direction = filters.direction;
    return p;
}

export async function getEmailConversations(
    instituteId: string,
    offset = 0,
    limit = 30,
    filters?: EmailInboxFilters
): Promise<EmailConversation[]> {
    const { data } = await authenticatedAxiosInstance.get(`${EMAIL_INBOX_BASE}/conversations`, {
        params: { instituteId, offset, limit, ...buildFilterParams(filters) },
    });
    return data;
}

export async function getEmailMessages(
    email: string,
    instituteId: string,
    cursor?: string,
    limit = 50,
    filters?: EmailInboxFilters
): Promise<EmailMessage[]> {
    const params: Record<string, string | number> = {
        instituteId,
        limit,
        ...buildFilterParams(filters),
    };
    if (cursor) params.cursor = cursor;
    const { data } = await authenticatedAxiosInstance.get(
        `${EMAIL_INBOX_BASE}/conversations/${encodeURIComponent(email)}/messages`,
        { params }
    );
    return data;
}

export async function searchEmailConversations(
    instituteId: string,
    query: string,
    offset = 0,
    limit = 30,
    filters?: EmailInboxFilters
): Promise<EmailConversation[]> {
    const { data } = await authenticatedAxiosInstance.get(
        `${EMAIL_INBOX_BASE}/conversations/search`,
        {
            params: {
                instituteId,
                q: query,
                offset,
                limit,
                ...buildFilterParams(filters),
            },
        }
    );
    return data;
}

/** Institute's configured sender addresses, for populating the dropdown. */
export async function getInstituteSenders(instituteId: string): Promise<string[]> {
    const { data } = await authenticatedAxiosInstance.get<string[]>(`${EMAIL_INBOX_BASE}/senders`, {
        params: { instituteId },
    });
    return data;
}

export async function sendEmailReply(payload: {
    instituteId: string;
    toEmail: string;
    fromEmail?: string;
    subject?: string;
    body: string;
}): Promise<EmailMessage> {
    const { data } = await authenticatedAxiosInstance.post(`${EMAIL_INBOX_BASE}/reply`, payload);
    return data;
}

export async function getEmailInboxStatus(instituteId: string): Promise<EmailInboxStatus> {
    const { data } = await authenticatedAxiosInstance.get(`${EMAIL_INBOX_BASE}/status`, {
        params: { instituteId },
    });
    return data;
}

/** The bytes of one attachment of an inbound email (always a download on the API side). */
export async function getEmailAttachmentBlob(
    messageId: string,
    instituteId: string,
    part: string
): Promise<Blob> {
    const { data } = await authenticatedAxiosInstance.get<Blob>(
        `${EMAIL_INBOX_BASE}/messages/${encodeURIComponent(messageId)}/attachment`,
        { params: { instituteId, part }, responseType: 'blob' }
    );
    return data;
}

/** The inbound email's original HTML (cid: images inlined); null when it had none. */
export async function getInboundEmailHtml(
    messageId: string,
    instituteId: string
): Promise<string | null> {
    const { data } = await authenticatedAxiosInstance.get<{ html: string | null }>(
        `${EMAIL_INBOX_BASE}/messages/${encodeURIComponent(messageId)}/html`,
        { params: { instituteId } }
    );
    return data?.html ?? null;
}
