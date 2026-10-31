import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CATALOGUE_RESOURCE_DOWNLOADS, CATALOGUE_RESOURCE_LEAD_DOWNLOADS } from '@/constants/urls';

export interface FreebieResourceRow {
    title: string | null;
    url: string;
    downloads: number;
    /** Distinct leads; downloads by visitors who never filled a form are not in here. */
    leads: number;
    lastDownloadedAt: string | null;
}

export interface FreebieLeadRow {
    responseId: string;
    userId: string | null;
    name: string | null;
    email: string | null;
    mobileNumber: string | null;
    audienceName: string | null;
    downloads: number;
    /** Distinct freebies, newest first. */
    resources: string[];
    lastDownloadedAt: string | null;
}

export interface FreebieDownloadReport {
    totalDownloads: number;
    leadsWithDownloads: number;
    resources: FreebieResourceRow[];
    leads: FreebieLeadRow[];
}

/**
 * Who took which freebies from the institute's websites. With audienceId, only
 * that list's leads (the list page); without it, the whole institute.
 */
export const getFreebieDownloads = async (
    instituteId: string,
    days: number,
    audienceId?: string
): Promise<FreebieDownloadReport> => {
    const response = await authenticatedAxiosInstance.get<FreebieDownloadReport>(
        CATALOGUE_RESOURCE_DOWNLOADS,
        { params: { instituteId, days, ...(audienceId ? { audienceId } : {}) } }
    );
    return response.data;
};

export interface LeadFreebie {
    title: string | null;
    url: string;
    downloadedAt: string | null;
}

/** Every freebie one lead (auth user id) opened, newest first. */
export const getLeadFreebies = async (instituteId: string, userId: string): Promise<LeadFreebie[]> => {
    const response = await authenticatedAxiosInstance.get<LeadFreebie[]>(CATALOGUE_RESOURCE_LEAD_DOWNLOADS, {
        params: { instituteId, userId },
    });
    return response.data;
};
