import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    getSubscriptionStatus,
    type SubOrgSubscriptionStatus,
} from '../../-services/custom-team-services';
import createInviteLink from '@/routes/manage-students/invite/-utils/createInviteLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

interface InviteLinkSectionProps {
    subOrgId: string;
}

/**
 * Renders the sub-org's primary invite link + invite code. Shared between the
 * sub-org detail modal and the institute-admin deep page so both surfaces show
 * the exact same UI. Uses the cached `sub-org-subscription-status` query key
 * so opening the modal after viewing the deep page is instant.
 */
export function InviteLinkSection({ subOrgId }: InviteLinkSectionProps) {
    const { t } = useTranslation('manageCustomTeamsInviteLinkSection');
    const { data: status, isLoading } = useQuery<SubOrgSubscriptionStatus>({
        queryKey: ['sub-org-subscription-status', subOrgId],
        queryFn: () => getSubscriptionStatus(subOrgId),
        enabled: !!subOrgId,
    });

    // Prefer the institute's white-label learner domain so the invite opens on the
    // institute's own portal instead of the global default. A backend `short_url`
    // (already domain-correct) still wins when present.
    const { instituteDetails } = useInstituteDetailsStore();
    const inviteUrl = status?.invite_code
        ? status.short_url ||
          createInviteLink(status.invite_code, instituteDetails?.learner_portal_base_url)
        : '';

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast.success(t('copied', { label }));
    };

    return (
        <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Link2 className="h-4 w-4" />
                {t('heading')}
            </h3>
            {isLoading ? (
                <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : status?.invite_code ? (
                <div className="space-y-2 rounded-md border bg-muted/50 p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                            {t('heading')}
                        </span>
                        {status.org_user_plan_status && (
                            <Badge
                                variant={
                                    status.org_user_plan_status === 'ACTIVE'
                                        ? 'default'
                                        : 'secondary'
                                }
                            >
                                {status.org_user_plan_status}
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2 rounded bg-white p-2">
                        <span className="min-w-0 flex-1 truncate select-all font-mono text-xs text-primary">
                            {inviteUrl}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 gap-1 px-2"
                            onClick={() => copyToClipboard(inviteUrl, t('inviteLink'))}
                        >
                            <Copy className="h-3 w-3" />
                            {t('copy')}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 gap-1 px-2"
                            onClick={() => window.open(inviteUrl, '_blank')}
                        >
                            <ExternalLink className="h-3 w-3" />
                            {t('open')}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{t('code')}</span>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">
                            {status.invite_code}
                        </code>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            onClick={() => copyToClipboard(status.invite_code, t('inviteCode'))}
                        >
                            <Copy className="h-3 w-3" />
                        </Button>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">{t('noInviteLink')}</p>
            )}
        </div>
    );
}
