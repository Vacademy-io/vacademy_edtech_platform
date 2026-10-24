/**
 * DeleteLeadsDialog — the confirm step for soft-deleting leads.
 *
 * Two shapes in one dialog, because they are the same decision at different scale:
 *
 *  - **Single lead** — the person may appear in several campaigns, and a row in the list is only
 *    ONE of them. So we ask what "delete" means here: just this campaign, or the person entirely.
 *    Their other campaigns are listed so the choice is informed rather than a guess.
 *  - **Bulk** — the selection already names the exact responses, so there is nothing to
 *    disambiguate; we only confirm the count.
 *
 * Deleting is reversible (leads are hidden, not removed) but it silently stops every campaign
 * send to that person, so the copy leads with consequence rather than mechanics.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Warning, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_USER_AUDIENCES } from '@/constants/urls';
import {
    deleteAudienceLeads,
    type LeadDeleteScope,
} from '@/routes/audience-manager/list/-services/delete-audience-lead';
import { cn } from '@/lib/utils';

/** One campaign the lead belongs to — mirrors UserAudienceMembershipDTO. */
interface AudienceMembership {
    audience_id: string;
    campaign_name: string | null;
    response_id: string;
    audience_status?: string | null;
}

interface DeleteLeadsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    /** The responses to delete. One entry = the single-lead flow; more = the bulk flow. */
    responseIds: string[];
    /** Used to look up the person's other campaigns in the single-lead flow. */
    userId?: string | null;
    /** Shown in the single-lead confirmation so the admin knows who they're removing. */
    leadName?: string;
    /** Fired after a successful delete (refetch + clear selection + close the sidebar). */
    onSuccess?: (deletedCount: number) => void;
}

export const DeleteLeadsDialog = ({
    open,
    onOpenChange,
    instituteId,
    responseIds,
    userId,
    leadName,
    onSuccess,
}: DeleteLeadsDialogProps) => {
    const isBulk = responseIds.length > 1;
    const [scope, setScope] = useState<LeadDeleteScope>('RESPONSE');

    // The person's other campaigns IN THIS INSTITUTE — only needed for the single-lead scope
    // choice, and the delete never reaches past this institute either. The endpoint
    // returns deleted memberships too, so they're filtered out here: they're already gone and
    // re-deleting them is a no-op that would only inflate the count.
    const { data: memberships, isLoading } = useQuery({
        queryKey: ['user-audiences', userId, instituteId],
        queryFn: async (): Promise<AudienceMembership[]> => {
            const res = await authenticatedAxiosInstance({
                method: 'GET',
                url: GET_USER_AUDIENCES,
                params: { userId, instituteId },
            });
            return res?.data ?? [];
        },
        enabled: open && !isBulk && !!userId && !!instituteId,
    });

    const liveMemberships = (memberships ?? []).filter(
        (m) => (m.audience_status ?? 'ACTIVE').toUpperCase() !== 'INACTIVE'
    );
    const otherCampaignCount = Math.max(0, liveMemberships.length - 1);

    const mutation = useMutation({
        mutationFn: () =>
            deleteAudienceLeads({
                responseIds,
                instituteId,
                scope: isBulk ? 'RESPONSE' : scope,
            }),
        onSuccess: (deleted) => {
            toast.success(deleted === 1 ? 'Lead deleted' : `${deleted} leads deleted`);
            onSuccess?.(deleted);
            onOpenChange(false);
        },
        onError: (error: unknown) => {
            // A converted lead can't be deleted — surface the backend's reason verbatim rather
            // than a generic failure, since it's actionable ("this one converted").
            const message =
                (error as { response?: { data?: { ex?: string } } })?.response?.data?.ex ??
                'Failed to delete. Please try again.';
            toast.error(message);
        },
    });

    const scopeOptions: { value: LeadDeleteScope; label: string; hint: string }[] = [
        {
            value: 'RESPONSE',
            label: 'This campaign only',
            hint: otherCampaignCount
                ? `Keeps their ${otherCampaignCount} other campaign${otherCampaignCount > 1 ? 's' : ''}.`
                : 'Removes this lead from the campaign it came from.',
        },
        {
            value: 'USER',
            label: 'Remove them entirely',
            hint: liveMemberships.length
                ? `Deletes all ${liveMemberships.length} of their leads across every campaign.`
                : 'Deletes every lead this person has, across every campaign.',
        },
    ];

    return (
        <MyDialog
            heading={isBulk ? 'Delete leads' : 'Delete lead'}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                        disable={mutation.isPending}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => mutation.mutate()}
                        disable={mutation.isPending}
                        className="bg-danger-600 hover:bg-danger-700"
                    >
                        {mutation.isPending ? 'Deleting…' : 'Delete'}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-4">
                <div className="flex items-start gap-3 rounded-md border border-danger-200 bg-danger-50 p-3">
                    <Warning weight="fill" className="mt-0.5 size-5 shrink-0 text-danger-600" />
                    <div className="flex flex-col gap-1">
                        <p className="text-subtitle font-semibold text-danger-700">
                            {isBulk
                                ? `Delete ${responseIds.length} leads?`
                                : `Delete ${leadName || 'this lead'}?`}
                        </p>
                        <p className="text-caption text-danger-700">
                            They will stop receiving campaign emails, WhatsApp messages and calls.
                            Deleted leads are hidden, not erased — you can restore them later.
                        </p>
                    </div>
                </div>

                {!isBulk && (
                    <div className="flex flex-col gap-2">
                        {isLoading ? (
                            <p className="text-caption text-neutral-400">Loading campaigns…</p>
                        ) : (
                            <>
                                <p className="text-caption font-medium uppercase tracking-wider text-neutral-500">
                                    What should we remove?
                                </p>
                                <RadioGroup
                                    value={scope}
                                    onValueChange={(v) => setScope(v as LeadDeleteScope)}
                                    className="flex flex-col gap-2"
                                >
                                    {scopeOptions.map((opt) => (
                                        <label
                                            key={opt.value}
                                            htmlFor={`scope-${opt.value}`}
                                            className={cn(
                                                'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                                                scope === opt.value
                                                    ? 'border-primary-300 bg-primary-50'
                                                    : 'border-neutral-200 hover:bg-neutral-50'
                                            )}
                                        >
                                            <RadioGroupItem
                                                value={opt.value}
                                                id={`scope-${opt.value}`}
                                                className="mt-0.5"
                                            />
                                            <div className="flex flex-col gap-0.5">
                                                <Label className="cursor-pointer text-body font-medium text-neutral-800">
                                                    {opt.label}
                                                </Label>
                                                <span className="text-caption text-neutral-500">
                                                    {opt.hint}
                                                </span>
                                            </div>
                                        </label>
                                    ))}
                                </RadioGroup>

                                {scope === 'USER' && liveMemberships.length > 1 && (
                                    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                                        <p className="text-caption font-medium uppercase tracking-wider text-neutral-500">
                                            Campaigns affected
                                        </p>
                                        {liveMemberships.map((m) => (
                                            <span
                                                key={m.response_id}
                                                className="truncate text-caption text-neutral-700"
                                            >
                                                · {m.campaign_name || 'Unnamed campaign'}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </MyDialog>
    );
};

/** Icon-only trigger used in the sidebar header. */
export const DeleteLeadTrigger = ({ onClick }: { onClick: () => void }) => (
    <button
        type="button"
        onClick={onClick}
        title="Delete lead"
        aria-label="Delete lead"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
    >
        <Trash className="size-4" />
    </button>
);

export default DeleteLeadsDialog;
