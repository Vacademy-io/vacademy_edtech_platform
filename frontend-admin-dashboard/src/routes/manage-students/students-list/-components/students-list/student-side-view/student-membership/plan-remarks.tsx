import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowsClockwise, ChatText } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    PLAN_REMARKS_QUERY_KEY,
    addPlanRemark,
    getPlanRemarks,
    type PlanRemark,
} from '@/services/user-plan';

const formatWhen = (iso: string): string => {
    try {
        return format(new Date(iso), 'dd MMM yyyy, h:mm a');
    } catch {
        return iso;
    }
};

const RemarkRow = ({ remark }: { remark: PlanRemark }) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const isRenewal = remark.action_type === 'MANUAL_RENEWAL';
    const Icon = isRenewal ? ArrowsClockwise : ChatText;
    return (
        <li className="flex gap-2 rounded-md border border-neutral-100 bg-neutral-50 p-2.5">
            <Icon className="mt-0.5 size-4 shrink-0 text-neutral-500" />
            <div className="min-w-0 flex-1 space-y-0.5">
                {isRenewal && (
                    <p className="text-xs font-semibold text-neutral-800">{remark.title}</p>
                )}
                {remark.description && (
                    <p className="whitespace-pre-wrap break-words text-sm text-neutral-700">
                        {remark.description}
                    </p>
                )}
                <p className="text-xs text-neutral-500">
                    {t('remarks.addedBy', { name: remark.actor_name || t('remarks.unknownAdmin') })}{' '}
                    · {formatWhen(remark.created_at)}
                </p>
            </div>
        </li>
    );
};

/**
 * Remarks on one membership — manual renewals and admin notes — visible to every admin of
 * the institute, newest first, with a box to add another.
 */
export const PlanRemarksPanel = ({
    userPlanId,
    instituteId,
    showComposer = true,
}: {
    userPlanId: string;
    instituteId: string;
    showComposer?: boolean;
}) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState('');

    useEffect(() => setDraft(''), [userPlanId]);

    const { data, isLoading, isError } = useQuery({
        queryKey: [PLAN_REMARKS_QUERY_KEY, userPlanId, instituteId],
        queryFn: () => getPlanRemarks(userPlanId, instituteId),
        enabled: Boolean(userPlanId) && Boolean(instituteId),
    });

    const mutation = useMutation({
        mutationFn: () => addPlanRemark(userPlanId, instituteId, draft.trim()),
        onSuccess: () => {
            setDraft('');
            queryClient.invalidateQueries({ queryKey: [PLAN_REMARKS_QUERY_KEY, userPlanId] });
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || t('remarks.saveFailed'));
        },
    });

    const remarks = data?.content ?? [];

    return (
        <div className="space-y-2">
            {showComposer && (
                <div className="space-y-2">
                    <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={t('remarks.placeholder')}
                        rows={2}
                    />
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            disable={!draft.trim() || mutation.isPending}
                            onClick={() => mutation.mutate()}
                        >
                            {mutation.isPending ? t('remarks.saving') : t('remarks.add')}
                        </MyButton>
                    </div>
                </div>
            )}
            {isLoading ? (
                <div className="flex justify-center py-4">
                    <DashboardLoader />
                </div>
            ) : isError ? (
                <p className="text-xs text-danger-600">{t('remarks.loadFailed')}</p>
            ) : remarks.length === 0 ? (
                <p className="text-xs text-neutral-500">{t('remarks.empty')}</p>
            ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                    {remarks.map((r) => (
                        <RemarkRow key={r.id} remark={r} />
                    ))}
                </ul>
            )}
        </div>
    );
};

export const PlanRemarksDialog = ({
    open,
    onOpenChange,
    userPlanId,
    instituteId,
    planLabel,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userPlanId: string | null;
    instituteId: string;
    planLabel?: string;
}) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-screen max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('remarks.title')}</DialogTitle>
                    {planLabel && <p className="text-sm text-neutral-500">{planLabel}</p>}
                </DialogHeader>
                {userPlanId && (
                    <PlanRemarksPanel userPlanId={userPlanId} instituteId={instituteId} />
                )}
            </DialogContent>
        </Dialog>
    );
};
