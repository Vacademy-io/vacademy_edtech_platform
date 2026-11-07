import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_SUB_ORGS_BY_PACKAGE_SESSION, SEARCH_SUB_ORGS } from '@/constants/urls';
import { PackageSessionSubOrg } from '../-types/bulk-assign-types';

const fetchSubOrgsForPackageSession = async (
    packageSessionId: string
): Promise<PackageSessionSubOrg[]> => {
    const response = await authenticatedAxiosInstance.get<PackageSessionSubOrg[]>(
        GET_SUB_ORGS_BY_PACKAGE_SESSION,
        { params: { packageSessionId } }
    );
    return response.data ?? [];
};

/**
 * Sub-organizations that already have members in one package session, each with its admins
 * (name + email). Only meaningful for batches flagged `is_org_associated`.
 */
export const useSubOrgsForPackageSession = ({
    packageSessionId,
    enabled = true,
}: {
    packageSessionId: string;
    enabled?: boolean;
}) => {
    return useQuery({
        queryKey: ['sub-orgs-for-ps', packageSessionId],
        queryFn: () => fetchSubOrgsForPackageSession(packageSessionId),
        enabled: enabled && !!packageSessionId,
        staleTime: 60 * 1000,
    });
};

/** The backend ignores shorter searches, so don't send them. */
export const SUB_ORG_SEARCH_MIN_CHARS = 2;

const searchSubOrgs = async (
    instituteId: string,
    search: string
): Promise<PackageSessionSubOrg[]> => {
    const response = await authenticatedAxiosInstance.get<PackageSessionSubOrg[]>(
        SEARCH_SUB_ORGS,
        { params: { instituteId, search } }
    );
    return response.data ?? [];
};

/**
 * Sub-organizations anywhere in the institute whose name contains `search` — not only the ones
 * already in a batch — so the enroll picker can find an organisation new to that batch.
 */
export const useSubOrgSearch = ({ instituteId, search }: { instituteId: string; search: string }) => {
    const term = search.trim();
    return useQuery({
        queryKey: ['sub-org-search', instituteId, term.toLowerCase()],
        queryFn: () => searchSubOrgs(instituteId, term),
        enabled: !!instituteId && term.length >= SUB_ORG_SEARCH_MIN_CHARS,
        staleTime: 60 * 1000,
    });
};
