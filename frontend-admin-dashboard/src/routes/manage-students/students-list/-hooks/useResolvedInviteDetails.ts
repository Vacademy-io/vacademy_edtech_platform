import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INVITE_LINKS, GET_SINGLE_INVITE_DETAILS } from '@/constants/urls';
import type {
    EnrollInviteDTO,
    EnrollInviteProjection,
    PaymentOption,
} from '../-types/bulk-assign-types';

/**
 * How Auto mode found the invite:
 * - EXPLICIT: the admin picked one.
 * - DEFAULT: the package session's active DEFAULT-tagged invite (what the backend's
 *   DefaultInviteResolver uses too).
 * - ONLY_ACTIVE: no DEFAULT invite, but exactly one active invite. The backend would NOT
 *   pick it (it auto-creates a FREE invite instead), so callers must send this invite's id
 *   explicitly for the enrollment to match what the screen shows.
 * - AMBIGUOUS: no DEFAULT invite and several active ones; the admin has to choose.
 * - NONE: no usable invite; the backend enrolls through a new free default invite.
 */
export type InviteResolution = 'EXPLICIT' | 'DEFAULT' | 'ONLY_ACTIVE' | 'AMBIGUOUS' | 'NONE';

interface ResolvedDetails {
    invite: EnrollInviteDTO | null;
    paymentOption: PaymentOption | null;
    complexPaymentOptionId: string | null;
    /** True when no explicit invite id was provided and we resolved the DEFAULT one. */
    resolvedFromDefault: boolean;
    resolution: InviteResolution;
    /** Active invites to choose from when the resolution is AMBIGUOUS. */
    activeInviteCount: number;
}

const fetchInviteDetail = async (
    instituteId: string,
    enrollInviteId: string
): Promise<EnrollInviteDTO> => {
    const url = GET_SINGLE_INVITE_DETAILS
        .replace('{instituteId}', instituteId)
        .replace('{enrollInviteId}', enrollInviteId);
    const response = await authenticatedAxiosInstance.get<EnrollInviteDTO>(url);
    return response.data;
};

const fetchInvitesForPackageSession = async (
    instituteId: string,
    packageSessionId: string
): Promise<EnrollInviteProjection[]> => {
    const params = new URLSearchParams({
        instituteId,
        pageNo: '0',
        pageSize: '50',
    });
    const response = await authenticatedAxiosInstance.post<{
        content: EnrollInviteProjection[];
    }>(`${GET_INVITE_LINKS}?${params}`, {
        package_session_ids: [packageSessionId],
        sort_columns: { created_at: 'desc' },
    });
    return response.data?.content ?? [];
};

/**
 * Resolves the picked invite's PaymentOption for a specific package session.
 *
 * - When `enrollInviteId` is provided: fetches that invite's detail directly.
 * - When it is null (Auto mode): looks up the package session's invite list and picks the
 *   DEFAULT-tagged active invite, or the only active invite when there is no DEFAULT. With
 *   several active invites and no DEFAULT it does not guess (see {@link InviteResolution}).
 *   It used to fall back to "the first active", which the backend never did: the screen
 *   showed a fee plan while the enrollment silently went through a new FREE invite.
 */
export const useResolvedInviteDetails = ({
    instituteId,
    packageSessionId,
    enrollInviteId,
}: {
    instituteId: string;
    packageSessionId: string;
    enrollInviteId: string | null | undefined;
}) => {
    return useQuery<ResolvedDetails>({
        queryKey: ['invite-detail-resolution', instituteId, packageSessionId, enrollInviteId],
        queryFn: async () => {
            let resolvedInviteId = enrollInviteId;
            let resolution: InviteResolution = 'EXPLICIT';
            let activeInviteCount = 0;

            if (!resolvedInviteId) {
                const invites = await fetchInvitesForPackageSession(instituteId, packageSessionId);
                // Same set the invite picker offers: bare SUB_ORG invites are never used here.
                const active = invites.filter((i) => i.status === 'ACTIVE' && i.tag !== 'SUB_ORG');
                activeInviteCount = active.length;
                const defaultInvite = active.find((i) => i.tag === 'DEFAULT');
                const candidate = defaultInvite ?? (active.length === 1 ? active[0] : undefined);
                if (!candidate) {
                    return {
                        invite: null,
                        paymentOption: null,
                        complexPaymentOptionId: null,
                        resolvedFromDefault: false,
                        resolution: active.length > 1 ? 'AMBIGUOUS' : 'NONE',
                        activeInviteCount,
                    };
                }
                resolvedInviteId = candidate.id;
                resolution = defaultInvite ? 'DEFAULT' : 'ONLY_ACTIVE';
            }

            const invite = await fetchInviteDetail(instituteId, resolvedInviteId);
            const pso = invite.package_session_to_payment_options?.find(
                (p) => p.package_session_id === packageSessionId && p.status === 'ACTIVE'
            );
            const paymentOption = pso?.payment_option ?? null;
            return {
                invite,
                paymentOption,
                complexPaymentOptionId: paymentOption?.complex_payment_option_id ?? null,
                resolvedFromDefault: resolution === 'DEFAULT',
                resolution,
                activeInviteCount,
            };
        },
        enabled: !!instituteId && !!packageSessionId,
        staleTime: 60 * 1000,
    });
};
