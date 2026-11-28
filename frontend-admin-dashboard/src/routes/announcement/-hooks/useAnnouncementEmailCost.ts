import { useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { AnnouncementService, type CreateAnnouncementRequest } from '@/services/announcement';
import { useEmailCostEstimate } from '@/services/email-billing-service';

/**
 * Merge tags only login-detail and password-reset mail carries. The server classifies such an
 * email as free (never blocked), so the estimate must too — same rule as notification-service's
 * EmailBillingClassifier.
 */
const CREDENTIAL_TAG = /\{\{\s*(password|user_password|your_password|reset_password_link)\s*}}/i;

/**
 * What the email part of an announcement will cost, before it is created.
 *
 * The audience is resolved on the server exactly as delivery will (one row is enough to read the
 * total). It counts people, some of whom may have no email address, so the estimate can run a
 * little high — the same count delivery checks credits against. Fails open: no count, no estimate,
 * and `allowed` stays true.
 */
export function useAnnouncementEmailCost(
    recipients: CreateAnnouncementRequest['recipients'],
    enabled: boolean,
    content?: string
) {
    const instituteId = getInstituteId() ?? '';
    const active = enabled && recipients.length > 0;
    const sizeQuery = useQuery({
        queryKey: ['announcementAudienceSize', recipients],
        queryFn: () => AnnouncementService.previewRecipients({ recipients, page: 0, size: 1 }),
        enabled: active,
        staleTime: 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
    });
    const audienceSize = active && !sizeQuery.isError ? sizeQuery.data?.totalCount ?? 0 : 0;
    const estimateParams = {
        instituteId,
        recipients: audienceSize,
        billingClass: content && CREDENTIAL_TAG.test(content) ? ('FREE' as const) : undefined,
    };
    const { allowed } = useEmailCostEstimate(estimateParams, active);
    return { instituteId, audienceSize, estimateParams, allowed };
}
