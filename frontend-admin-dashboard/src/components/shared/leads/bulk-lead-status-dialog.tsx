/**
 * BulkLeadStatusDialog — the "Change status" step of the leads list's Bulk actions menu.
 *
 * Status is the one bulk action with no destructive twin: nothing is removed, and the
 * change is fully reversible by running it again. So the dialog is a picker plus a
 * plain-language confirmation of scale, not a warning.
 *
 * The outcome is reported per bucket rather than as a single count, because partial
 * success is the normal case — a selection carried over from a stale page can name
 * leads that were since deleted, and leads already on the target status are a no-op.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { LeadStatus } from '@/hooks/use-lead-statuses';
import {
    bulkChangeLeadStatus,
    type BulkLeadStatusResult,
} from './services/bulk-lead-status';

interface BulkLeadStatusDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    /** audience_response ids — the row identity in the list, not user ids. */
    responseIds: string[];
    /** The institute's status catalog; inactive entries are filtered out here. */
    statuses: LeadStatus[];
    /** Fired after a run that actually moved something (refetch + clear selection). */
    onSuccess?: (result: BulkLeadStatusResult) => void;
}

export const BulkLeadStatusDialog = ({
    open,
    onOpenChange,
    instituteId,
    responseIds,
    statuses,
    onSuccess,
}: BulkLeadStatusDialogProps) => {
    const [statusId, setStatusId] = useState<string>('');

    const options = statuses
        .filter((s) => s.is_active !== false)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

    const mutation = useMutation({
        mutationFn: () => bulkChangeLeadStatus({ responseIds, statusId, instituteId }),
        onSuccess: (result) => {
            const label = options.find((s) => s.id === statusId)?.label ?? 'the new status';

            if (result.updated > 0) {
                toast.success(
                    result.updated === 1
                        ? `1 lead moved to ${label}`
                        : `${result.updated} leads moved to ${label}`
                );
            } else if (result.unchanged > 0 && result.failed === 0) {
                // Nothing moved but nothing broke — say so plainly rather than
                // showing a success toast for a no-op.
                toast.info(
                    result.unchanged === 1
                        ? 'That lead was already on this status'
                        : `All ${result.unchanged} leads were already on this status`
                );
            }
            if (result.failed > 0) {
                toast.error(
                    `${result.failed} could not be updated${
                        result.errors?.length ? `: ${result.errors[0]}` : ''
                    }`
                );
            }

            onSuccess?.(result);
            onOpenChange(false);
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { ex?: string } } })?.response?.data?.ex ??
                'Failed to change status. Please try again.';
            toast.error(message);
        },
    });

    return (
        <MyDialog
            heading="Change lead status"
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
                        disable={!statusId || mutation.isPending}
                    >
                        {mutation.isPending ? 'Updating…' : 'Change status'}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-4">
                <div className="flex items-start gap-3 rounded-md border border-primary-200 bg-primary-50 p-3">
                    <ArrowsLeftRight
                        weight="fill"
                        className="mt-0.5 size-5 shrink-0 text-primary-600"
                    />
                    <div className="flex flex-col gap-1">
                        <p className="text-subtitle font-semibold text-primary-700">
                            {responseIds.length === 1
                                ? 'Change the status of 1 lead'
                                : `Change the status of ${responseIds.length} leads`}
                        </p>
                        <p className="text-caption text-primary-700">
                            Each lead keeps its own status history, so you can see what it was
                            before. Any automation that listens for a status change will run.
                        </p>
                    </div>
                </div>

                {options.length === 0 ? (
                    <p className="text-caption text-neutral-400">
                        This institute has no active lead statuses yet.
                    </p>
                ) : (
                    <div className="flex flex-col gap-2">
                        <p className="text-caption font-medium text-neutral-500">Move them to</p>
                        <RadioGroup value={statusId} onValueChange={setStatusId}>
                            {options.map((status) => (
                                <div
                                    key={status.id}
                                    className={cn(
                                        'flex items-center gap-3 rounded-md border p-3',
                                        statusId === status.id
                                            ? 'border-primary-300 bg-primary-50'
                                            : 'border-neutral-200'
                                    )}
                                >
                                    <RadioGroupItem value={status.id} id={`bulk-status-${status.id}`} />
                                    <Label
                                        htmlFor={`bulk-status-${status.id}`}
                                        className="flex flex-1 cursor-pointer items-center gap-2"
                                    >
                                        <span
                                            className="size-2.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: status.color || '#9ca3af' }}
                                        />
                                        <span className="text-body">{status.label}</span>
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
