import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Buildings, CircleNotch } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { fetchCourseBatches } from '@/routes/admin-package-management/-services/package-service';
import type { PackageSessionDTO } from '@/routes/admin-package-management/-types/package-types';

interface SubOrgAssociatedCardProps {
    packageId: string;
}

/**
 * Course setting: when enabled, enrolling a learner into this course provisions a
 * sub-organization for them. Backed by package_session.is_org_associated for every
 * package session of the course (PUT /admin-core-service/batch/v1/sub-org-associated).
 * Lives in the course Settings tab alongside LMS Integration and Workflow Triggers.
 */
export const SubOrgAssociatedCard: React.FC<SubOrgAssociatedCardProps> = ({ packageId }) => {
    const { t } = useTranslation('studyLibrarySubOrgAssociatedCard');
    const queryClient = useQueryClient();
    const [pendingValue, setPendingValue] = useState<boolean | null>(null);

    const { data: batches = [], isLoading } = useQuery<PackageSessionDTO[]>({
        queryKey: ['COURSE_BATCHES', packageId],
        queryFn: () => fetchCourseBatches(packageId),
        enabled: !!packageId,
        staleTime: 5 * 60 * 1000,
    });

    const packageSessionIds = useMemo(() => batches.map((b) => b.id).filter(Boolean), [batches]);

    // Enabled when every package session of the course is marked sub-org associated.
    const derivedEnabled = batches.length > 0 && batches.every((b) => b.is_org_associated === true);
    const enabled = pendingValue ?? derivedEnabled;

    const mutation = useMutation({
        mutationFn: async (next: boolean) => {
            await authenticatedAxiosInstance.put(
                `${BASE_URL}/admin-core-service/batch/v1/sub-org-associated`,
                packageSessionIds,
                { params: { isOrgAssociated: next } }
            );
            return next;
        },
        onSuccess: (next) => {
            setPendingValue(next);
            queryClient.invalidateQueries({ queryKey: ['COURSE_BATCHES', packageId] });
            toast.success(next ? t('toast.enabled') : t('toast.disabled'));
        },
        onError: () => {
            toast.error(t('toast.updateFailed'));
        },
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Buildings className="size-5 text-primary-500" weight="fill" />
                    {t('cardTitle')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8 text-neutral-500">
                        <CircleNotch className="mr-2 size-5 animate-spin" /> {t('loading')}
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                        <div className="space-y-0.5">
                            <p className="text-sm font-semibold text-neutral-800">
                                {t('fieldLabel')}
                            </p>
                            <p className="text-sm text-neutral-500">{t('description')}</p>
                        </div>
                        <Switch
                            checked={enabled}
                            disabled={mutation.isPending || packageSessionIds.length === 0}
                            onCheckedChange={(next) => mutation.mutate(next)}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
