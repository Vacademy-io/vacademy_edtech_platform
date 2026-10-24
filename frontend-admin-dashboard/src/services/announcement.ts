import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { NOTIFICATION_SERVICE_BASE } from '@/constants/urls';

const BASE = NOTIFICATION_SERVICE_BASE;

export type ModeType =
    | 'SYSTEM_ALERT'
    | 'DASHBOARD_PIN'
    | 'DM'
    | 'STREAM'
    | 'RESOURCES'
    | 'COMMUNITY'
    | 'TASKS'
    | 'APP_OVERLAY';

export type MediumType = 'WHATSAPP' | 'PUSH_NOTIFICATION' | 'EMAIL';

export type RecipientType = 'ROLE' | 'USER' | 'PACKAGE_SESSION' | 'PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES' | 'TAG' | 'CUSTOM_FIELD_FILTER' | 'AUDIENCE';

export interface CustomFieldFilter {
    customFieldId?: string; // Preferred way
    fieldName?: string; // Fallback for backward compatibility
    fieldValue: string | string[]; // For dropdown: array of selected values, for text/number: single value
    operator?: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'greaterThan'; // For text/number fields
}

export interface Exclusion {
    exclusionType: 'USER' | 'ROLE' | 'PACKAGE_SESSION' | 'TAG';
    exclusionId: string;
}

export interface CreateAnnouncementRequest {
    title: string;
    content: { type: 'text' | 'html' | 'video' | 'image'; content: string };
    instituteId: string;
    createdBy: string;
    createdByName?: string;
    createdByRole?: string;
    timezone?: string;
    recipients: Array<{
        recipientType: RecipientType;
        recipientId?: string;
        recipientName?: string;
        customFieldFilters?: CustomFieldFilter[]; // Per-recipient filters
        exclusions?: Exclusion[]; // Per-recipient exclusions
    }>;
    exclusions?: Exclusion[]; // Global exclusions (currently not processed, but kept for backward compatibility) - optional
    modes: Array<{
        modeType: ModeType;
        settings: Record<string, unknown>;
    }>;
    mediums: Array<{
        mediumType: MediumType;
        config: Record<string, unknown>;
    }>;
    scheduling?: {
        scheduleType: 'IMMEDIATE' | 'ONE_TIME' | 'RECURRING';
        cronExpression?: string;
        timezone?: string;
        startDate?: string;
        endDate?: string;
    };
}

// One row of GET /announcements/{id}/recipients — per-recipient delivery status.
export interface AnnouncementRecipientRow {
    recipientMessageId: string;
    userId: string;
    userName: string | null;
    modeType: ModeType;
    status: string;
    deliveredAt: string | null;
    readAt: string | null;
    dismissedAt: string | null;
}

// Spring Page envelope returned by the /recipients endpoint.
export interface AnnouncementRecipientsPage {
    content: AnnouncementRecipientRow[];
    totalPages: number;
    totalElements: number;
    number: number;
    size: number;
}

export const AnnouncementService = {
    create: async (
        payload: Omit<CreateAnnouncementRequest, 'instituteId'> & { instituteId?: string }
    ) => {
        const instituteId = payload.instituteId ?? getInstituteId();
        if (!instituteId) throw new Error('Missing instituteId');
        const body: CreateAnnouncementRequest = {
            ...payload,
            instituteId,
        } as CreateAnnouncementRequest;
        const { data } = await authenticatedAxiosInstance.post(`${BASE}/announcements`, body);
        return data;
    },

    getById: async (announcementId: string) => {
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/announcements/${announcementId}`
        );
        return data;
    },

    update: async (
        announcementId: string,
        payload: Omit<CreateAnnouncementRequest, 'instituteId'> & { instituteId?: string }
    ) => {
        const instituteId = payload.instituteId ?? getInstituteId();
        if (!instituteId) throw new Error('Missing instituteId');
        const body: CreateAnnouncementRequest = {
            ...payload,
            instituteId,
        } as CreateAnnouncementRequest;
        const { data } = await authenticatedAxiosInstance.put(
            `${BASE}/announcements/${announcementId}`,
            body
        );
        return data;
    },

    listByInstitute: async (params?: { page?: number; size?: number; status?: string }) => {
        const instituteId = getInstituteId();
        if (!instituteId) throw new Error('Missing instituteId');
        const search = new URLSearchParams();
        if (params?.page !== undefined) search.set('page', String(params.page));
        if (params?.size !== undefined) search.set('size', String(params.size));
        if (params?.status) search.set('status', params.status);
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/announcements/institute/${instituteId}?${search.toString()}`
        );
        return data;
    },

    planned: async (params?: { page?: number; size?: number; from?: string; to?: string }) => {
        const instituteId = getInstituteId();
        if (!instituteId) throw new Error('Missing instituteId');
        const search = new URLSearchParams();
        if (params?.page !== undefined) search.set('page', String(params.page));
        if (params?.size !== undefined) search.set('size', String(params.size));
        if (params?.from) search.set('from', params.from);
        if (params?.to) search.set('to', params.to);
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/announcements/institute/${instituteId}/planned?${search.toString()}`
        );
        return data;
    },

    past: async (params?: { page?: number; size?: number; from?: string; to?: string }) => {
        const instituteId = getInstituteId();
        if (!instituteId) throw new Error('Missing instituteId');
        const search = new URLSearchParams();
        if (params?.page !== undefined) search.set('page', String(params.page));
        if (params?.size !== undefined) search.set('size', String(params.size));
        if (params?.from) search.set('from', params.from);
        if (params?.to) search.set('to', params.to);
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/announcements/institute/${instituteId}/past?${search.toString()}`
        );
        return data;
    },

    updateStatus: async (announcementId: string, status: string) => {
        const { data } = await authenticatedAxiosInstance.put(
            `${BASE}/announcements/${announcementId}/status`,
            {
                status,
            }
        );
        return data;
    },

    remove: async (announcementId: string) => {
        const { data } = await authenticatedAxiosInstance.delete(
            `${BASE}/announcements/${announcementId}`
        );
        return data;
    },

    deliver: async (announcementId: string) => {
        const { data } = await authenticatedAxiosInstance.post(
            `${BASE}/announcements/${announcementId}/deliver`
        );
        return data;
    },

    stats: async (announcementId: string) => {
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/announcements/${announcementId}/stats`
        );
        return data;
    },

    recipients: async (
        announcementId: string,
        params: { modeType?: ModeType; page?: number; size?: number }
    ): Promise<AnnouncementRecipientsPage> => {
        const search = new URLSearchParams();
        if (params.modeType) search.set('modeType', params.modeType);
        if (params.page !== undefined) search.set('page', String(params.page));
        if (params.size !== undefined) search.set('size', String(params.size));
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/announcements/${announcementId}/recipients?${search.toString()}`
        );
        return data;
    },

    submitForApproval: async (announcementId: string, submittedByRole: string) => {
        const { data } = await authenticatedAxiosInstance.post(
            `${BASE}/announcements/${announcementId}/submit-approval?submittedByRole=${encodeURIComponent(
                submittedByRole
            )}`
        );
        return data;
    },

    approve: async (announcementId: string, approvedByRole: string) => {
        const { data } = await authenticatedAxiosInstance.post(
            `${BASE}/announcements/${announcementId}/approve?approvedByRole=${encodeURIComponent(
                approvedByRole
            )}`
        );
        return data;
    },

    reject: async (announcementId: string, rejectedByRole: string, reason: string) => {
        const { data } = await authenticatedAxiosInstance.post(
            `${BASE}/announcements/${announcementId}/reject?rejectedByRole=${encodeURIComponent(
                rejectedByRole
            )}&reason=${encodeURIComponent(reason)}`
        );
        return data;
    },
};

export const InstituteAnnouncementSettingsService = {
    get: async () => {
        const instituteId = getInstituteId();
        if (!instituteId) throw new Error('Missing instituteId');
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/institute-settings/institute/${instituteId}`
        );
        return data;
    },
    checkPermissions: async (params: { userRole: string; action: string; modeType: ModeType }) => {
        const instituteId = getInstituteId();
        if (!instituteId) throw new Error('Missing instituteId');
        const search = new URLSearchParams();
        search.set('userRole', params.userRole);
        search.set('action', params.action);
        search.set('modeType', params.modeType);
        const { data } = await authenticatedAxiosInstance.get(
            `${BASE}/institute-settings/institute/${instituteId}/permissions?${search.toString()}`
        );
        return data;
    },
};
