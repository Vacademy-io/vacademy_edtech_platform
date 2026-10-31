import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { WHATSAPP_TEMPLATE_BASE } from '@/constants/urls';

export interface TemplateButton {
    type: string;       // QUICK_REPLY, URL, PHONE_NUMBER
    text: string;
    url?: string;
    phoneNumber?: string;
    example?: string[];
}

export interface WhatsAppTemplateDTO {
    id?: string;
    instituteId: string;
    metaTemplateId?: string;
    name: string;
    language: string;
    category: string;
    status?: string;
    rejectionReason?: string;
    headerType: string;
    headerText?: string;
    headerSampleUrl?: string;
    bodyText: string;
    footerText?: string;
    buttons?: TemplateButton[];
    bodySampleValues?: string[];
    bodyVariableNames?: string[];  // semantic names: ["name", "course_name"]
    headerSampleValues?: string[];
    channelType?: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH';
    subject?: string;       // email subject
    content?: string;       // email HTML body
    contentType?: string;   // HTML, TEXT
    dynamicParameters?: string;
    canDelete?: boolean;
    templateCategory?: string;
    createdViaVacademy?: boolean;
    createdBy?: string;
    createdAt?: string;
    submittedAt?: string;
    approvedAt?: string;
}

export async function createTemplateDraft(dto: WhatsAppTemplateDTO): Promise<WhatsAppTemplateDTO> {
    const { data } = await authenticatedAxiosInstance.post(WHATSAPP_TEMPLATE_BASE, dto);
    return data;
}

/**
 * The institute's notification templates. `notification_template` holds every channel, so pass
 * `channelType` to get just the EMAIL or WHATSAPP ones; omit it for all of them.
 */
export async function listTemplates(
    instituteId: string,
    channelType?: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'
): Promise<WhatsAppTemplateDTO[]> {
    const params: Record<string, string> = { instituteId };
    if (channelType) params.channelType = channelType;
    const { data } = await authenticatedAxiosInstance.get(`${WHATSAPP_TEMPLATE_BASE}/list`, {
        params,
    });
    return data;
}

export async function getTemplate(id: string): Promise<WhatsAppTemplateDTO> {
    const { data } = await authenticatedAxiosInstance.get(`${WHATSAPP_TEMPLATE_BASE}/${id}`);
    return data;
}

export async function updateTemplate(id: string, dto: WhatsAppTemplateDTO): Promise<WhatsAppTemplateDTO> {
    const { data } = await authenticatedAxiosInstance.put(`${WHATSAPP_TEMPLATE_BASE}/${id}`, dto);
    return data;
}

export async function deleteTemplate(id: string): Promise<void> {
    await authenticatedAxiosInstance.delete(`${WHATSAPP_TEMPLATE_BASE}/${id}`);
}

export async function submitToMeta(id: string): Promise<WhatsAppTemplateDTO> {
    const { data } = await authenticatedAxiosInstance.post(`${WHATSAPP_TEMPLATE_BASE}/${id}/submit`);
    return data;
}

export async function syncTemplates(instituteId: string): Promise<{ synced: number }> {
    const { data } = await authenticatedAxiosInstance.post(`${WHATSAPP_TEMPLATE_BASE}/sync`, null, {
        params: { instituteId },
    });
    return data;
}
