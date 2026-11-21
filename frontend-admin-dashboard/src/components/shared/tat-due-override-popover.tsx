import { useState } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { PencilSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { setLeadTatDueOverride } from '@/hooks/use-lead-sla-config';

interface TatDueOverridePopoverProps {
    responseId: string;
    /** Current effective TAT deadline (Date already parsed from the backend ISO). */
    dueDate: Date | null;
    /** True when the current deadline was set by hand. Shows the "Reset to automatic" action. */
    overridden?: boolean | null;
}

/**
 * Admin-only pencil next to the "Reach out in" deadline: set this lead's TAT deadline by hand,
 * or reset it to the automatic (working-hours) deadline. The server re-checks the ADMIN role.
 */
export function TatDueOverridePopover({ responseId, dueDate, overridden }: TatDueOverridePopoverProps) {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);

    const onOpenChange = (next: boolean) => {
        if (next) setValue(dueDate ? format(dueDate, "yyyy-MM-dd'T'HH:mm") : '');
        setOpen(next);
    };

    const submit = async (dueAtIso: string | null) => {
        setSaving(true);
        try {
            await setLeadTatDueOverride(responseId, dueAtIso);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['recent-leads'] }),
                queryClient.invalidateQueries({ queryKey: ['campaign-users'] }),
            ]);
            toast.success(dueAtIso ? 'TAT deadline updated' : 'TAT deadline reset to automatic');
            setOpen(false);
        } catch {
            toast.error('Could not update the TAT deadline');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="Change TAT deadline"
                    title="Change TAT deadline"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                    <PencilSimple className="size-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" onClick={(e) => e.stopPropagation()}>
                <div>
                    <p className="text-sm font-medium">TAT overdue at</p>
                    <p className="text-xs text-muted-foreground">
                        Overrides the automatic deadline for this lead only.
                    </p>
                </div>
                <Input
                    type="datetime-local"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                />
                <div className="flex items-center justify-between gap-2">
                    {overridden ? (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={saving}
                            onClick={() => submit(null)}
                        >
                            Reset to automatic
                        </MyButton>
                    ) : (
                        <span />
                    )}
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={saving || !value}
                        onClick={() => submit(new Date(value).toISOString())}
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </MyButton>
                </div>
            </PopoverContent>
        </Popover>
    );
}
