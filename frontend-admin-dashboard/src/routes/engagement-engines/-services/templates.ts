import { ENGAGEMENT_TEMPLATES_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { EngagementTemplateProposal } from '../-types';
import type {
    EmailTemplate,
    EmailTemplateEditRequest,
    EmailTemplateGenerateRequest,
    EmailTemplatePreview,
    GenerateMode,
    GenerateOptions,
} from '../-types/templates';

/** Sibling of the WhatsApp proposals endpoint (…/engagement/email-templates). */
const ENGAGEMENT_EMAIL_TEMPLATES_BASE = ENGAGEMENT_TEMPLATES_BASE.replace(
    /\/template-proposals$/,
    '/email-templates'
);

// ---- WhatsApp: Generate with AI (purpose, count, language) ----
export const generateWhatsAppTemplates = async (
    engineId: string,
    instituteId: string,
    options: GenerateOptions
): Promise<EngagementTemplateProposal[]> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_TEMPLATES_BASE}/recommend`, null, {
        params: {
            instituteId,
            engineId,
            count: options.count,
            purpose: options.purpose || undefined,
            language: options.language || undefined,
        },
    });
    return res.data;
};

/** NEW alternatives, REGENERATE one draft, or MORE_LIKE_THIS an existing template. */
export const requestWhatsAppAlternatives = async (
    engineId: string,
    instituteId: string,
    mode: GenerateMode,
    options: GenerateOptions & { basedOnId?: string }
): Promise<EngagementTemplateProposal[]> => {
    const res = await authenticatedAxiosInstance.post(
        `${ENGAGEMENT_TEMPLATES_BASE}/request-alternatives`,
        {
            mode,
            basedOnId: options.basedOnId,
            purpose: options.purpose || undefined,
            language: options.language || undefined,
            count: options.count,
            feedback: options.feedback || undefined,
        },
        { params: { instituteId, engineId } }
    );
    return res.data;
};

// ---- Email templates ----
export const listEmailTemplates = async (engineId: string, instituteId: string): Promise<EmailTemplate[]> => {
    const res = await authenticatedAxiosInstance.get(ENGAGEMENT_EMAIL_TEMPLATES_BASE, {
        params: { instituteId, engineId },
    });
    return res.data;
};

export const generateEmailTemplates = async (
    engineId: string,
    instituteId: string,
    payload: EmailTemplateGenerateRequest
): Promise<EmailTemplate[]> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_EMAIL_TEMPLATES_BASE}/generate`, payload, {
        params: { instituteId, engineId },
    });
    return res.data;
};

export const editEmailTemplate = async (
    id: string,
    instituteId: string,
    payload: EmailTemplateEditRequest
): Promise<EmailTemplate> => {
    const res = await authenticatedAxiosInstance.put(`${ENGAGEMENT_EMAIL_TEMPLATES_BASE}/${id}`, payload, {
        params: { instituteId },
    });
    return res.data;
};

const emailTemplateAction = async (
    id: string,
    instituteId: string,
    verb: 'approve' | 'archive'
): Promise<EmailTemplate> => {
    const res = await authenticatedAxiosInstance.post(`${ENGAGEMENT_EMAIL_TEMPLATES_BASE}/${id}/${verb}`, null, {
        params: { instituteId },
    });
    return res.data;
};

export const approveEmailTemplate = (id: string, instituteId: string) =>
    emailTemplateAction(id, instituteId, 'approve');
export const archiveEmailTemplate = (id: string, instituteId: string) =>
    emailTemplateAction(id, instituteId, 'archive');

export const previewEmailTemplate = async (
    id: string,
    instituteId: string,
    values?: Record<string, string>
): Promise<EmailTemplatePreview> => {
    const res = await authenticatedAxiosInstance.post(
        `${ENGAGEMENT_EMAIL_TEMPLATES_BASE}/${id}/preview`,
        values ?? {},
        { params: { instituteId } }
    );
    return res.data;
};
